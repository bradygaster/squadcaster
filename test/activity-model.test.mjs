import assert from "node:assert/strict";
import test from "node:test";
import {
    aggregateActivitySnapshots,
    buildActivitySnapshot,
    compareNewestFirst,
    dedupeSemantic,
    isCompleteActivitySnapshot,
    utcServerDayBoundary,
} from "../activity-model.mjs";

const repository = {
    name: "demo",
    nameWithOwner: "octodemo/demo",
    url: "https://github.com/octodemo/demo",
    defaultBranchRef: { name: "main" },
};

function issue(overrides = {}) {
    return {
        number: 12,
        title: "Ship the dashboard",
        body: "Depends on: #9",
        state: "OPEN",
        url: "https://github.com/octodemo/demo/issues/12",
        labels: [{ name: "squad" }, { name: "squad:frontend" }],
        assignees: [],
        comments: [],
        createdAt: "2026-09-20T10:00:00Z",
        updatedAt: "2026-09-20T11:00:00Z",
        ...overrides,
    };
}

test("derives blockers and Squad ownership from observed issue data", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        members: [{ id: "frontend", name: "Frontend", role: "UI" }],
        issues: [
            issue(),
            issue({
                number: 9,
                title: "Choose an API",
                body: "",
                labels: [],
                url: "https://github.com/octodemo/demo/issues/9",
            }),
        ],
    });
    assert.equal(snapshot.goals.length, 1);
    assert.equal(snapshot.goals[0].phase, "blocked");
    assert.equal(snapshot.goals[0].owner.name, "Frontend");
    assert.equal(snapshot.goals[0].blockers[0].issueNumber, 9);
});

test("normalizes mixed-case Squad labels for goal and owner matching", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        members: [{ id: "frontend", name: "Frontend", role: "UI" }],
        issues: [issue({
            body: "",
            labels: [{ name: "Squad:Frontend" }],
        })],
    });

    assert.equal(snapshot.goals.length, 1);
    assert.equal(snapshot.goals[0].owner.name, "Frontend");
    assert.equal(snapshot.goals[0].owner.source, "squad-label");
    assert.deepEqual(snapshot.goals[0].issue.labels, ["Squad:Frontend"]);
});

test("correlates durable worker provenance, checks, and workflow runs", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [{
            number: 44,
            title: "Implement #12",
            body: "Closes #12\n\n<!-- squad:implement issue=12 run=77 -->",
            state: "OPEN",
            url: "https://github.com/octodemo/demo/pull/44",
            headRefName: "squad/implement-12-dashboard",
            isDraft: false,
            updatedAt: "2026-09-20T12:00:00Z",
            statusCheckRollup: [{
                name: "test",
                conclusion: "SUCCESS",
                detailsUrl: "https://github.com/octodemo/demo/actions/runs/77",
            }],
        }],
        workflowRuns: [{
            databaseId: 77,
            workflowName: "Squad Implement Worker",
            displayTitle: "Implement #12",
            status: "completed",
            conclusion: "success",
            headBranch: "squad/implement-12-dashboard",
            url: "https://github.com/octodemo/demo/actions/runs/77",
            updatedAt: "2026-09-20T12:00:00Z",
        }],
    });
    const goal = snapshot.goals[0];
    assert.equal(goal.phase, "reviewing");
    assert.equal(goal.pullRequests[0].checks[0].status, "success");
    assert.ok(goal.evidence.some((item) => item.kind === "workflow" && item.confidence === "inferred"));
});

test("normalizes authoritative pull request review states and requests", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [{
            number: 44,
            title: "Implement #12",
            body: "Closes #12",
            state: "OPEN",
            url: "https://github.com/octodemo/demo/pull/44",
            reviewDecision: "CHANGES_REQUESTED",
            latestReviews: [
                {
                    author: { login: "approver" },
                    state: "APPROVED",
                    submittedAt: "2026-09-20T12:30:00Z",
                },
                {
                    author: { login: "former-reviewer" },
                    state: "DISMISSED",
                    submittedAt: "2026-09-20T12:20:00Z",
                },
                {
                    author: { login: "pending-reviewer" },
                    state: "PENDING",
                },
                {
                    author: { login: "changes-requester" },
                    state: "CHANGES_REQUESTED",
                    submittedAt: "2026-09-20T12:40:00Z",
                },
            ],
            reviewRequests: [{
                __typename: "Team",
                name: "maintainers",
            }],
        }],
    });

    const pullRequest = snapshot.goals[0].pullRequests[0];
    assert.equal(snapshot.schemaVersion, 3);
    assert.equal(pullRequest.reviewDecision, "changes_requested");
    assert.deepEqual(pullRequest.reviews, [
        {
            actor: { login: "approver", type: "unknown" },
            state: "approved",
            submittedAt: "2026-09-20T12:30:00.000Z",
        },
        {
            actor: { login: "former-reviewer", type: "unknown" },
            state: "dismissed",
            submittedAt: "2026-09-20T12:20:00.000Z",
        },
        {
            actor: { login: "pending-reviewer", type: "unknown" },
            state: "pending",
            submittedAt: null,
        },
        {
            actor: { login: "changes-requester", type: "unknown" },
            state: "changes_requested",
            submittedAt: "2026-09-20T12:40:00.000Z",
        },
    ]);
    assert.deepEqual(pullRequest.reviewRequests, [{
        actor: { login: "maintainers", type: "team" },
    }]);
});

test("distinguishes successful empty review connections from unavailable legacy data", () => {
    const successful = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [{
            number: 44,
            title: "Implement #12",
            body: "Closes #12",
            state: "OPEN",
            latestReviews: [],
            reviewRequests: [],
        }],
    }).goals[0].pullRequests[0];
    const legacy = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [{
            number: 44,
            title: "Implement #12",
            body: "Closes #12",
            state: "OPEN",
        }],
    }).goals[0].pullRequests[0];

    assert.deepEqual(successful.reviews, []);
    assert.deepEqual(successful.reviewRequests, []);
    assert.equal(legacy.reviews, null);
    assert.equal(legacy.reviewRequests, null);
});

test("does not infer stable agent identity from owners or GitHub participants", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        members: [{ id: "octocat", name: "octocat", role: "Reviewer" }],
        issues: [issue({
            body: "",
            labels: [{ name: "squad" }],
            assignees: [{ login: "octocat" }],
            author: { login: "octocat" },
        })],
        pullRequests: [{
            number: 44,
            title: "Implement #12",
            body: "Closes #12",
            state: "OPEN",
            headRefName: "squad/implement-12-octocat",
            author: { login: "octocat" },
            latestReviews: [{
                author: { login: "octocat", __typename: "User" },
                state: "APPROVED",
            }],
            reviewRequests: [{ login: "octocat", __typename: "User" }],
        }],
    });

    const goal = snapshot.goals[0];
    assert.deepEqual(goal.owner, {
        id: "octocat",
        name: "octocat",
        source: "assignee",
    });
    assert.equal(goal.pullRequests[0].reviews[0].actor.login, "octocat");
    assert.equal(goal.pullRequests[0].reviewRequests[0].actor.login, "octocat");
    assert.equal(goal.agentIdentity.status, "unknown");
    assert.equal(goal.agentIdentity.record, null);
    assert.equal(goal.agentIdentity.source.status, "missing");
    assert.equal("avatar" in goal.owner, false);
});

test("surfaces failed automation before review state", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        workflowRuns: [{
            databaseId: 78,
            workflowName: "Squad Implement Worker",
            displayTitle: "Implement #12",
            status: "completed",
            conclusion: "failure",
            url: "https://github.com/octodemo/demo/actions/runs/78",
        }],
    });
    assert.equal(snapshot.goals[0].phase, "failed");
    assert.equal(snapshot.summary.failed, 1);
});

test("uses structured artifacts to expose research progress", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({
            labels: [],
            body: "Investigate the API",
            comments: [{
                body: "Structured data:\n```json\n{\"squad_artifact\":\"research\",\"schema_version\":\"1\",\"origin_issue\":12,\"phases\":[]}\n```",
                url: "https://github.com/octodemo/demo/issues/12#issuecomment-1",
                createdAt: "2026-09-20T11:30:00Z",
            }],
        })],
    });
    assert.equal(snapshot.goals[0].phase, "researching");
    assert.equal(snapshot.goals[0].artifacts[0].kind, "research");
});

test("marks merged work complete", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [{
            number: 44,
            title: "Implement #12",
            body: "Closes #12",
            state: "MERGED",
            mergedAt: "2026-09-20T12:00:00Z",
            url: "https://github.com/octodemo/demo/pull/44",
        }],
    });
    assert.equal(snapshot.goals[0].phase, "completed");
    assert.equal(snapshot.summary.completed, 1);
});

test("does not correlate an incidental pull request issue mention", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [{
            number: 45,
            title: "Unrelated cleanup",
            body: "This is similar to #12 but does not close it.",
            state: "OPEN",
            url: "https://github.com/octodemo/demo/pull/45",
            headRefName: "cleanup",
        }],
    });
    assert.equal(snapshot.goals[0].pullRequests.length, 0);
    assert.equal(snapshot.goals[0].phase, "queued");
    assert.equal(snapshot.summary.queued, 1);
});

test("does not correlate qualified external closing references with a same-number local goal", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [
            {
                number: 45,
                title: "Close an external API issue",
                body: "Fixes octodemo/backend#12",
                state: "OPEN",
                url: "https://github.com/octodemo/demo/pull/45",
            },
            {
                number: 46,
                title: "Close another external API issue",
                body: "",
                state: "OPEN",
                url: "https://github.com/octodemo/demo/pull/46",
                closingIssuesReferences: [{
                    number: 12,
                    repository: {
                        name: "backend",
                        owner: { login: "octodemo" },
                    },
                }],
            },
        ],
    });
    assert.equal(snapshot.goals[0].pullRequests.length, 0);
    assert.equal(snapshot.goals[0].phase, "queued");
});

test("correlates qualified and unqualified closing references in the pull request repository", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [
            {
                number: 47,
                title: "Qualified local close",
                body: "Fixes octodemo/demo#12",
                state: "OPEN",
                url: "https://github.com/octodemo/demo/pull/47",
            },
            {
                number: 48,
                title: "Unqualified local close",
                body: "Closes #12",
                state: "OPEN",
                url: "https://github.com/octodemo/demo/pull/48",
            },
            {
                number: 49,
                title: "GitHub local close",
                body: "",
                state: "OPEN",
                url: "https://github.com/octodemo/demo/pull/49",
                closingIssuesReferences: [{
                    number: 12,
                    repository: {
                        nameWithOwner: "octodemo/demo",
                    },
                }],
            },
        ],
    });
    assert.deepEqual(
        snapshot.goals[0].pullRequests.map((pullRequest) => pullRequest.number),
        [47, 48, 49],
    );
    assert.equal(snapshot.goals[0].phase, "reviewing");
    assert.ok(snapshot.goals[0].evidence
        .filter((item) => item.kind === "pull-request")
        .every((item) => item.confidence === "observed"));
});

test("preserves explicit marker correlation as observed", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [{
            number: 50,
            title: "Squad implementation",
            body: "<!-- squad:implement issue=12 run=77 -->",
            state: "OPEN",
            url: "https://github.com/octodemo/demo/pull/50",
            headRefName: "feature-without-issue-number",
        }],
    });

    assert.equal(snapshot.goals[0].pullRequests[0].number, 50);
    assert.equal(
        snapshot.goals[0].evidence.find((item) => item.kind === "pull-request").confidence,
        "observed",
    );
});

test("labels branch-only pull request correlation inferred", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [{
            number: 51,
            title: "Squad implementation",
            body: "",
            state: "OPEN",
            url: "https://github.com/octodemo/demo/pull/51",
            headRefName: "squad/implement-12-dashboard",
        }],
    });

    assert.equal(snapshot.goals[0].pullRequests[0].number, 51);
    assert.equal(
        snapshot.goals[0].evidence.find((item) => item.kind === "pull-request").confidence,
        "inferred",
    );
    assert.equal("sessionId" in snapshot.goals[0], false);
});

test("uses only the latest run outcome for the same workflow branch", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        workflowRuns: [
            {
                databaseId: 78,
                workflowName: "Squad Implement Worker",
                displayTitle: "Implement #12",
                status: "completed",
                conclusion: "failure",
                headBranch: "squad/implement-12-dashboard",
                updatedAt: "2026-09-20T11:00:00Z",
            },
            {
                databaseId: 79,
                workflowName: "Squad Implement Worker",
                displayTitle: "Implement #12",
                status: "completed",
                conclusion: "success",
                headBranch: "squad/implement-12-dashboard",
                updatedAt: "2026-09-20T12:00:00Z",
            },
        ],
    });

    assert.equal(snapshot.goals[0].phase, "queued");
});

test("deduplicates repeated semantic evidence and workflow runs", () => {
    const duplicateRun = {
        databaseId: 79,
        workflowName: "Squad Implement Worker",
        displayTitle: "Implement #12",
        status: "in_progress",
        headBranch: "squad/implement-12-dashboard",
        url: "https://github.com/octodemo/demo/actions/runs/79",
        updatedAt: "2026-09-20T12:00:00Z",
    };
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        workflowRuns: [duplicateRun, structuredClone(duplicateRun)],
    });

    assert.equal(snapshot.goals[0].workflowRuns.length, 1);
    assert.equal(snapshot.goals[0].evidence.filter((item) => item.kind === "workflow").length, 1);

    const aggregate = aggregateActivitySnapshots({
        snapshots: [snapshot, structuredClone(snapshot)],
        repositories: [{ nameWithOwner: repository.nameWithOwner, included: true }],
    });
    assert.equal(aggregate.goals.length, 1);
});

test("orders missing and equal timestamps deterministically", () => {
    const values = [
        { kind: "workflow", title: "Zulu", timestamp: null, url: "/z" },
        { kind: "issue", title: "Beta", timestamp: "2026-09-20T12:00:00Z", url: "/b" },
        { kind: "issue", title: "Alpha", timestamp: "2026-09-20T12:00:00Z", url: "/a" },
        { kind: "artifact", title: "Older", timestamp: "2026-09-20T11:00:00Z", url: "/o" },
    ];

    assert.deepEqual(
        [...values].sort(compareNewestFirst).map((item) => item.title),
        ["Alpha", "Beta", "Older", "Zulu"],
    );
    assert.deepEqual(
        dedupeSemantic(
            [values[1], { ...values[1], timestamp: "2026-09-20T13:00:00Z" }],
            (item) => `${item.kind}|${item.title}|${item.url}`,
        ).map((item) => item.timestamp),
        ["2026-09-20T13:00:00Z"],
    );
});

test("normalizes authoritative workflow jobs and steps without inferred metrics or reasons", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        workflowRuns: [{
            databaseId: 78,
            workflowName: "Squad Implement Worker",
            displayTitle: "Implement #12",
            status: "completed",
            conclusion: "failure",
        }],
        workflowJobs: [{
            runId: 78,
            fetchedAt: "2026-09-20T12:02:00Z",
            status: "fresh",
            jobs: [{
                id: 901,
                name: "test",
                status: "completed",
                conclusion: "failure",
                started_at: "2026-09-20T12:00:00Z",
                completed_at: "2026-09-20T12:01:00Z",
                steps: [{
                    number: 1,
                    name: "Run tests",
                    status: "completed",
                    conclusion: "failure",
                }],
            }],
        }],
    });
    const run = snapshot.goals[0].workflowRuns[0];

    assert.equal(run.jobsState.status, "fresh");
    assert.equal(run.jobs[0].conclusion, "failure");
    assert.equal(run.jobs[0].steps[0].conclusion, "failure");
    assert.equal(run.jobs[0].startedAt, "2026-09-20T12:00:00.000Z");
    assert.equal("duration" in run.jobs[0], false);
    assert.equal("progress" in run.jobs[0], false);
    assert.equal("reason" in run.jobs[0], false);
    assert.equal("cause" in run.jobs[0], false);
});

test("treats stale or unavailable source state as incomplete without requiring an error", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        fetchedAt: "2026-09-20T13:00:00Z",
        sourceState: {
            issues: {
                data: [issue({ body: "" })],
                fetchedAt: "2026-09-20T12:00:00Z",
                status: "stale",
                error: "",
            },
            pullRequests: { data: [], status: "fresh" },
            workflowRuns: { data: [], status: "unavailable", error: "" },
        },
    });

    assert.equal(snapshot.fetchedAt, "2026-09-20T13:00:00.000Z");
    assert.equal(snapshot.sourceState.issues.fetchedAt, "2026-09-20T12:00:00.000Z");
    assert.equal(snapshot.partial, true);
    assert.equal(snapshot.stale, true);
    assert.deepEqual(snapshot.staleSources, ["issues"]);
    assert.equal(isCompleteActivitySnapshot(snapshot), false);
});

test("rolls the UTC server-day contract at midnight with an exclusive next boundary", () => {
    const beforeMidnight = utcServerDayBoundary("2026-09-21T23:59:59.999Z");
    const atMidnight = utcServerDayBoundary("2026-09-22T00:00:00.000Z");

    assert.deepEqual(beforeMidnight, {
        version: 1,
        kind: "utc-server-day",
        timeZone: "UTC",
        snapshotDay: "2026-09-21",
        startsAt: "2026-09-21T00:00:00.000Z",
        nextBoundaryAt: "2026-09-22T00:00:00.000Z",
        cacheKey: "day-boundary-v1:utc:2026-09-21",
    });
    assert.equal(atMidnight.snapshotDay, "2026-09-22");
    assert.equal(atMidnight.startsAt, beforeMidnight.nextBoundaryAt);
    assert.notEqual(atMidnight.cacheKey, beforeMidnight.cacheKey);
});

test("keeps UTC days fixed across viewer DST forward and backward transitions", () => {
    const springForward = utcServerDayBoundary("2026-03-08T09:30:00-07:00");
    const fallBack = utcServerDayBoundary("2026-11-01T01:30:00-08:00");

    assert.equal(springForward.snapshotDay, "2026-03-08");
    assert.equal(
        Date.parse(springForward.nextBoundaryAt) - Date.parse(springForward.startsAt),
        24 * 60 * 60 * 1000,
    );
    assert.equal(fallBack.snapshotDay, "2026-11-01");
    assert.equal(
        Date.parse(fallBack.nextBoundaryAt) - Date.parse(fallBack.startsAt),
        24 * 60 * 60 * 1000,
    );
});

test("uses the same day boundary for viewers in different locales", () => {
    const fetchedAt = "2026-09-22T00:30:00Z";
    const snapshot = buildActivitySnapshot({ repository, fetchedAt });
    const tokyo = aggregateActivitySnapshots({
        snapshots: [snapshot],
        viewer: "tokyo-viewer",
        fetchedAt,
    });
    const losAngeles = aggregateActivitySnapshots({
        snapshots: [snapshot],
        viewer: "los-angeles-viewer",
        fetchedAt,
    });

    assert.deepEqual(tokyo.dayBoundary, losAngeles.dayBoundary);
    assert.equal(tokyo.dayBoundary.snapshotDay, "2026-09-22");
});

test("keeps stale evidence on the snapshot day when refresh crosses midnight", () => {
    const snapshot = buildActivitySnapshot({
        repository,
        fetchedAt: "2026-09-22T00:05:00Z",
        sourceState: {
            issues: {
                data: [issue({ body: "" })],
                fetchedAt: "2026-09-21T23:50:00Z",
                status: "stale",
            },
            pullRequests: { data: [], status: "fresh" },
            workflowRuns: { data: [], status: "fresh" },
        },
    });

    assert.equal(snapshot.stale, true);
    assert.equal(snapshot.dayBoundary.snapshotDay, "2026-09-21");
    assert.equal(snapshot.fetchedAt, "2026-09-22T00:05:00.000Z");
    assert.equal(snapshot.sourceState.issues.fetchedAt, "2026-09-21T23:50:00.000Z");
});

test("reports retained repository days separately from aggregate observation day", () => {
    const stale = buildActivitySnapshot({
        repository,
        fetchedAt: "2026-09-22T00:05:00Z",
        sourceState: {
            issues: {
                data: [issue({ body: "" })],
                fetchedAt: "2026-09-21T23:50:00Z",
                status: "stale",
            },
            pullRequests: { data: [], status: "fresh" },
            workflowRuns: { data: [], status: "fresh" },
        },
    });
    const aggregate = aggregateActivitySnapshots({
        snapshots: [stale],
        fetchedAt: "2026-09-22T00:06:00Z",
    });

    assert.equal(aggregate.dayBoundary.snapshotDay, "2026-09-22");
    assert.deepEqual(aggregate.snapshotDays, ["2026-09-21"]);
});
