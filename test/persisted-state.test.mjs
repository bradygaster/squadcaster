import assert from "node:assert/strict";
import test from "node:test";
import { emptyActivity, normalizePersistedState } from "../persisted-state.mjs";

test("normalizes legacy state without restoring mutation fields", () => {
    const activity = {
        ...emptyActivity(),
        fetchedAt: "2026-09-21T12:00:00Z",
        goals: [{ id: "octodemo/demo#20" }],
    };
    const normalized = normalizePersistedState({
        version: 1,
        signals: ["Uses Squad workflows"],
        summary: "Read-only context",
        members: [{
            id: "lead",
            name: "Lead",
            draftRole: "Mutated role",
            draftCharter: "Mutated charter",
            dirty: true,
        }],
        activity,
        mission: { goal: "Ship a mutation" },
        operation: { status: "running" },
        pullRequest: { url: "https://github.com/octodemo/demo/pull/1" },
        onboarding: { cast: { command: "/squad cast" } },
    });

    assert.equal(normalized.version, 4);
    assert.equal(normalized.activity.schemaVersion, 3);
    assert.equal(normalized.activity.dayBoundary.snapshotDay, "2026-09-21");
    assert.equal(normalized.activity.fetchedAt, "2026-09-21T12:00:00.000Z");
    assert.equal(normalized.activity.goals[0].id, activity.goals[0].id);
    assert.deepEqual(normalized.activity.goals[0].pullRequests, []);
    assert.deepEqual(normalized.activity.goals[0].lifecycleHistory, {
        incompleteBeforeFirstObservation: true,
        firstObservedAt: null,
        lastObservedAt: null,
        transitions: [],
    });
    assert.equal("signals" in normalized, false);
    assert.equal("summary" in normalized, false);
    assert.equal("members" in normalized, false);
    assert.equal("mission" in normalized, false);
    assert.equal("operation" in normalized, false);
    assert.equal("pullRequest" in normalized, false);
    assert.equal("onboarding" in normalized, false);
});

test("defaults malformed and unsupported persisted values safely", () => {
    for (const value of [null, undefined, "legacy", 42, [], { activity: { schemaVersion: 1 } }]) {
        const normalized = normalizePersistedState(value);
        assert.equal(normalized.version, 4);
        assert.deepEqual(normalized.activity, emptyActivity());
    }
});

test("ignores legacy proposal and unknown fields", () => {
    const normalized = normalizePersistedState({
        signals: Array.from({ length: 20 }, (_, index) => `Signal ${index + 1}`),
        members: [{ name: "Proposed member", dirty: true }],
        unknown: { status: "running" },
    });
    assert.equal("signals" in normalized, false);
    assert.equal("members" in normalized, false);
    assert.equal("unknown" in normalized, false);
});

test("migrates schema-v2 activity and coerces it into renderer-safe shapes", () => {
    const normalized = normalizePersistedState({
        activity: {
            schemaVersion: 2,
            fetchedAt: "2026-03-08T09:30:00-07:00",
            repository: [],
            repositories: {},
            summary: [],
            goals: [{
                repository: null,
                issue: "invalid",
                owner: [],
                blockers: {},
                evidence: [null, { title: "Observed" }],
                pullRequests: "invalid",
                workflowRuns: [null, { workflow: "Squad" }],
            }],
            errors: "invalid",
        },
    });

    assert.equal(normalized.activity.schemaVersion, 3);
    assert.equal(normalized.activity.fetchedAt, "2026-03-08T16:30:00.000Z");
    assert.equal(normalized.activity.dayBoundary.snapshotDay, "2026-03-08");
    assert.equal(normalized.activity.dayBoundary.timeZone, "UTC");
    assert.deepEqual(normalized.activity.repository, {});
    assert.deepEqual(normalized.activity.repositories, []);
    assert.deepEqual(normalized.activity.summary, emptyActivity().summary);
    assert.deepEqual(normalized.activity.errors, []);
    assert.equal(normalized.activity.goals.length, 1);
    assert.deepEqual(normalized.activity.goals[0].repository, {});
    assert.deepEqual(normalized.activity.goals[0].issue, {});
    assert.equal(normalized.activity.goals[0].owner, null);
    assert.deepEqual(normalized.activity.goals[0].blockers, []);
    assert.deepEqual(normalized.activity.goals[0].evidence, [{ title: "Observed" }]);
    assert.deepEqual(normalized.activity.goals[0].pullRequests, []);
    assert.deepEqual(normalized.activity.goals[0].workflowRuns, [{ workflow: "Squad" }]);
    assert.equal(normalized.activity.goals[0].handoff, null);
});

test("preserves normalized read-only handoff readiness across cache migration", () => {
    const normalized = normalizePersistedState({
        version: 2,
        activity: {
            ...emptyActivity(),
            schemaVersion: 2,
            fetchedAt: "2026-09-21T12:00:00Z",
            goals: [{
                id: "octodemo/demo#12",
                handoff: {
                    schemaVersion: 1,
                    readiness: {
                        state: "ready",
                        reasons: [],
                        sourceStates: {
                            issue: "complete",
                            issueAssignees: "complete",
                            issueComments: "complete",
                            subIssues: "complete",
                            dependencies: "complete",
                            pullRequests: "complete",
                            workflowRuns: "complete",
                        },
                        automatedHandoffAvailable: false,
                    },
                    activation: { issue: "octodemo/demo#12" },
                    acceptanceCriteria: [{ text: "Ship it", sourceUrl: "https://example.test/12" }],
                    acceptanceCriteriaComplete: true,
                    leaf: { subIssues: [], complete: true },
                    existingImplementation: {
                        state: "none",
                        pullRequests: [],
                        workflowRuns: [],
                        sessions: [],
                        links: [],
                    },
                    mechanisms: [{ kind: "manual", availability: "available", reasons: [] }],
                },
            }],
        },
    });

    const handoff = normalized.activity.goals[0].handoff;
    assert.equal(handoff.readiness.state, "ready");
    assert.equal(handoff.activation.issue, "octodemo/demo#12");
    assert.equal(handoff.acceptanceCriteria[0].text, "Ship it");
    assert.equal(handoff.existingImplementation.state, "none");
});

test("coerces malformed handoff cache fields into renderer-safe shapes", () => {
    const normalized = normalizePersistedState({
        activity: {
            ...emptyActivity(),
            schemaVersion: 2,
            fetchedAt: "2026-09-21T12:00:00Z",
            goals: [{
                id: "octodemo/demo#12",
                handoff: {
                    schemaVersion: 1,
                    readiness: {
                        reasons: "invalid",
                        sourceStates: [],
                        automatedHandoffAvailable: "yes",
                    },
                    activation: [],
                    acceptanceCriteria: [null, { text: "Observed" }],
                    leaf: { subIssues: "invalid" },
                    existingImplementation: {
                        pullRequests: "invalid",
                        workflowRuns: [null, { id: 1 }],
                    },
                    mechanisms: "invalid",
                },
            }],
        },
    });

    const handoff = normalized.activity.goals[0].handoff;
    assert.equal(handoff.readiness.state, "unknown");
    assert.deepEqual(handoff.readiness.reasons, []);
    assert.deepEqual(handoff.readiness.sourceStates, {});
    assert.equal(handoff.activation, null);
    assert.deepEqual(handoff.acceptanceCriteria, [{ text: "Observed" }]);
    assert.deepEqual(handoff.leaf.subIssues, []);
    assert.deepEqual(handoff.existingImplementation.pullRequests, []);
    assert.deepEqual(handoff.existingImplementation.workflowRuns, [{ id: 1 }]);
    assert.deepEqual(handoff.mechanisms, []);
});

test("fails closed on unsupported or incomplete cached ready contracts", () => {
    for (const handoff of [
        {
            schemaVersion: 99,
            readiness: {
                state: "ready",
                automatedHandoffAvailable: true,
            },
        },
        {
            schemaVersion: 1,
            readiness: {
                state: "ready",
                sourceStates: { issue: "complete" },
                automatedHandoffAvailable: true,
            },
            acceptanceCriteria: [],
            acceptanceCriteriaComplete: false,
            leaf: { subIssues: [], complete: false },
            existingImplementation: { state: "none" },
        },
    ]) {
        const normalized = normalizePersistedState({
            activity: {
                ...emptyActivity(),
                schemaVersion: 2,
                fetchedAt: "2026-09-21T12:00:00Z",
                goals: [{ id: "octodemo/demo#12", handoff }],
            },
        }).activity.goals[0].handoff;
        assert.equal(normalized.readiness.state, "unknown");
        assert.equal(normalized.readiness.automatedHandoffAvailable, false);
    }
});

function containsAgentIdentity(value) {
    if (Array.isArray(value)) return value.some(containsAgentIdentity);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(
        ([key, nested]) => key === "agentIdentity" || containsAgentIdentity(nested),
    );
}

test("drops unvalidated stable agent identity recursively from persisted activity", () => {
    const normalized = normalizePersistedState({
        activity: {
            ...emptyActivity(),
            agentIdentity: { status: "resolved" },
            goals: [{
                id: "octodemo/demo#12",
                owner: {
                    id: "octocat",
                    name: "octocat",
                    source: "assignee",
                    agentIdentity: { status: "resolved" },
                },
                issue: {
                    number: 12,
                    agentIdentity: { status: "resolved" },
                },
                agentIdentity: {
                    status: "resolved",
                    record: {
                        schemaVersion: 1,
                        id: "candidate-agent",
                        displayName: "Candidate",
                    },
                },
                pullRequests: [{
                    number: 44,
                    agentIdentity: { status: "resolved" },
                    reviews: [{
                        actor: {
                            login: "octocat",
                            agentIdentity: { status: "resolved" },
                        },
                    }],
                }],
                workflowRuns: [{
                    id: 77,
                    agentIdentity: { status: "resolved" },
                }],
            }],
        },
    });

    assert.equal(containsAgentIdentity(normalized), false);
    assert.equal(normalized.activity.goals[0].owner.name, "octocat");
    assert.equal(normalized.activity.goals[0].pullRequests[0].reviews[0].actor.login, "octocat");
    assert.equal(normalized.activity.goals[0].workflowRuns[0].id, 77);
});

test("recursively drops unvalidated implementation session provenance from persisted goals", () => {
    const normalized = normalizePersistedState({
        activity: {
            ...emptyActivity(),
            goals: [{
                id: "octodemo/demo#12",
                sessionId: "candidate-session",
                implementationSessionId: "candidate-implementation-session",
                implementationSession: { id: "candidate-record" },
                implementationSessions: [{ id: "candidate-record" }],
                sessionProvenance: { source: "candidate" },
                implementationSessionProvenance: { source: "candidate" },
                issue: {
                    number: 12,
                    legacy_session_id: "nested-issue-session",
                },
                owner: {
                    name: "Owner",
                    session: { id: "nested-owner-session" },
                },
                evidence: [{
                    title: "Observed",
                    producerSessionMetadata: { id: "nested-evidence-session" },
                }],
                pullRequests: [{
                    number: 44,
                    implementation_session_ref: "nested-pr-session",
                }],
                workflowRuns: [{
                    id: 77,
                    deeply: {
                        nested: {
                            sessionIdentifier: "nested-run-session",
                        },
                    },
                }],
                supportedFutureField: "preserved",
            }],
        },
    });

    const goal = normalized.activity.goals[0];
    for (const field of [
        "sessionId",
        "implementationSessionId",
        "implementationSession",
        "implementationSessions",
        "sessionProvenance",
        "implementationSessionProvenance",
    ]) {
        assert.equal(field in goal, false, field);
    }
    assert.equal(goal.supportedFutureField, "preserved");
    assert.equal("legacy_session_id" in goal.issue, false);
    assert.equal("session" in goal.owner, false);
    assert.equal("producerSessionMetadata" in goal.evidence[0], false);
    assert.equal("implementation_session_ref" in goal.pullRequests[0], false);
    assert.equal("sessionIdentifier" in goal.workflowRuns[0].deeply.nested, false);
    assert.equal(goal.issue.number, 12);
    assert.equal(goal.owner.name, "Owner");
    assert.equal(goal.evidence[0].title, "Observed");
    assert.equal(goal.pullRequests[0].number, 44);
    assert.equal(goal.workflowRuns[0].id, 77);
});

test("preserves a stale v3 snapshot boundary across persisted-state reload", () => {
    const normalized = normalizePersistedState({
        version: 4,
        activity: {
            schemaVersion: 3,
            fetchedAt: "2026-09-22T00:05:00.000Z",
            dayBoundary: {
                version: 1,
                kind: "utc-server-day",
                timeZone: "UTC",
                snapshotDay: "2026-09-21",
                startsAt: "2026-09-21T00:00:00.000Z",
                nextBoundaryAt: "2026-09-22T00:00:00.000Z",
                cacheKey: "day-boundary-v1:utc:2026-09-21",
            },
            snapshotDays: ["2026-09-21"],
        },
    });

    assert.equal(normalized.activity.fetchedAt, "2026-09-22T00:05:00.000Z");
    assert.equal(normalized.activity.dayBoundary.snapshotDay, "2026-09-21");
    assert.deepEqual(normalized.activity.snapshotDays, ["2026-09-21"]);
});

test("adds bootstrap defaults to older schema-v2 activity", () => {
    const normalized = normalizePersistedState({
        activity: {
            schemaVersion: 2,
            fetchedAt: "2026-09-21T12:00:00Z",
            summary: {
                active: 1,
                queued: 1,
            },
            goals: [],
        },
    });

    assert.equal(normalized.activity.summary.active, 1);
    assert.equal(normalized.activity.summary.queued, 1);
    assert.equal(normalized.activity.summary.bootstrap.total, 0);
    assert.equal(normalized.activity.summary.bootstrap.unknown, 0);
    assert.deepEqual(normalized.activity.bootstraps, []);
});

test("normalizes malformed persisted generated goals to an empty collection", () => {
    const normalized = normalizePersistedState({
        activity: {
            schemaVersion: 3,
            fetchedAt: "2026-09-21T12:00:00Z",
            dayBoundary: {
                schemaVersion: 1,
                snapshotDay: "2026-09-21",
                nextBoundaryAt: "2026-09-22T00:00:00.000Z",
            },
            summary: {},
            goals: [{
                id: "octodemo/demo#6",
                repository: { nameWithOwner: "octodemo/demo" },
                issue: { number: 6 },
                bootstrap: {
                    status: "complete",
                    generatedGoals: "corrupt",
                },
            }],
        },
    });

    assert.deepEqual(normalized.activity.goals[0].bootstrap.generatedGoals, []);
});
