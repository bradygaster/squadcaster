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

    assert.equal(normalized.version, 3);
    assert.equal(normalized.activity.fetchedAt, activity.fetchedAt);
    assert.equal(normalized.activity.goals[0].id, activity.goals[0].id);
    assert.deepEqual(normalized.activity.goals[0].pullRequests, []);
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
        assert.equal(normalized.version, 3);
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

test("coerces malformed schema-v2 activity into renderer-safe shapes", () => {
    const normalized = normalizePersistedState({
        activity: {
            schemaVersion: 2,
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
});
