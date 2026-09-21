import assert from "node:assert/strict";
import test from "node:test";
import { buildActivitySnapshot } from "../activity-model.mjs";

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
