import assert from "node:assert/strict";
import test from "node:test";
import { buildActivitySnapshot } from "../activity-model.mjs";
import {
    GitHubSquadActivityAdapter,
    selectWorkflowJobRuns,
} from "../github-activity.mjs";

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
        body: "",
        state: "OPEN",
        url: "https://github.com/octodemo/demo/issues/12",
        labels: [{ name: "squad" }],
        comments: [],
        ...overrides,
    };
}

function pullRequest(overrides = {}) {
    return {
        number: 44,
        title: "Implement #12",
        body: "Closes #12",
        state: "OPEN",
        url: "https://github.com/octodemo/demo/pull/44",
        headRefName: "squad/implement-12-dashboard",
        isDraft: false,
        updatedAt: "2026-09-20T12:00:00Z",
        reviewDecision: "REVIEW_REQUIRED",
        latestReviews: [{
            author: { login: "reviewer" },
            state: "COMMENTED",
            submittedAt: "2026-09-20T12:00:00Z",
        }],
        reviewRequests: [{
            __typename: "User",
            login: "maintainer",
        }],
        ...overrides,
    };
}

function workflowRun(overrides = {}) {
    return {
        databaseId: 78,
        workflowName: "Squad Implement Worker",
        displayTitle: "Implement #12",
        status: "completed",
        conclusion: "failure",
        url: "https://github.com/octodemo/demo/actions/runs/78",
        headBranch: "squad/implement-12-dashboard",
        updatedAt: "2026-09-20T12:00:00Z",
        ...overrides,
    };
}

function workflowJobs(overrides = {}) {
    return {
        total_count: 1,
        jobs: [{
            id: 901,
            name: "test",
            status: "completed",
            conclusion: "success",
            html_url: "https://github.com/octodemo/demo/actions/runs/78/job/901",
            started_at: "2026-09-20T12:00:00Z",
            completed_at: "2026-09-20T12:01:00Z",
            steps: [{
                number: 1,
                name: "Run tests",
                status: "completed",
                conclusion: "success",
                started_at: "2026-09-20T12:00:00Z",
                completed_at: "2026-09-20T12:01:00Z",
            }],
        }],
        ...overrides,
    };
}

test("keeps the last known goals when issue discovery fails", async () => {
    const previous = buildActivitySnapshot({
        repository,
        issues: [issue()],
        pullRequests: [pullRequest()],
    });
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") throw new Error("rate limited");
            if (args[0] === "pr") return [pullRequest({ state: "MERGED", mergedAt: "2026-09-20T13:00:00Z" })];
            return [workflowRun({ conclusion: "success", updatedAt: "2026-09-20T13:00:00Z" })];
        },
    });
    const result = await adapter.discover({ previous });
    assert.equal(result.stale, true);
    assert.equal(result.partial, true);
    assert.equal(result.goals[0].phase, "completed");
    assert.deepEqual(result.staleSources, ["issues"]);
    assert.equal(result.errors[0].source, "issues");
});

test("preserves successful sources when another GitHub source fails", async () => {
    const previous = buildActivitySnapshot({
        repository,
        issues: [issue()],
        pullRequests: [pullRequest()],
    });
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue({ title: "Updated dashboard", body: "" })];
            if (args[0] === "pr") throw new Error("pull request permission denied");
            return [workflowRun({ conclusion: "success" })];
        },
    });
    const result = await adapter.discover({ previous });
    assert.equal(result.goals.length, 1);
    assert.equal(result.goals[0].phase, "reviewing");
    assert.equal(result.goals[0].issue.title, "Updated dashboard");
    assert.equal(result.goals[0].pullRequests[0].number, 44);
    assert.equal(result.goals[0].pullRequests[0].reviews[0].actor.login, "reviewer");
    assert.equal(result.goals[0].pullRequests[0].reviewRequests[0].actor.login, "maintainer");
    assert.equal(result.partial, true);
    assert.equal(result.stale, true);
    assert.deepEqual(result.staleSources, ["pullRequests"]);
    assert.equal(result.errors[0].source, "pull requests");
});

test("preserves implementing state when pull request refresh fails", async () => {
    const previous = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        pullRequests: [pullRequest({ isDraft: true })],
    });
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue({ title: "Updated implementation", body: "" })];
            if (args[0] === "pr") throw new Error("temporary PR failure");
            return [];
        },
    });
    const result = await adapter.discover({ previous });
    assert.equal(previous.goals[0].phase, "implementing");
    assert.equal(result.goals[0].phase, "implementing");
    assert.equal(result.goals[0].issue.title, "Updated implementation");
    assert.equal(result.goals[0].pullRequests[0].draft, true);
});

test("preserves failed workflow evidence and recovers on a later successful refresh", async () => {
    const previous = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        workflowRuns: [workflowRun()],
    });
    const failingAdapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue({ title: "Updated failed work", body: "" })];
            if (args[0] === "pr") return [];
            throw new Error("workflow service unavailable");
        },
    });
    const partial = await failingAdapter.discover({ previous });
    assert.equal(previous.goals[0].phase, "failed");
    assert.equal(partial.goals[0].phase, "failed");
    assert.equal(partial.goals[0].issue.title, "Updated failed work");
    assert.equal(partial.errors[0].source, "workflow runs");
    assert.deepEqual(partial.staleSources, ["workflowRuns"]);

    const recoveredAdapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue({ title: "Recovered work", body: "" })];
            if (args[0] === "pr") return [];
            if (args[0] === "api") return workflowJobs();
            return [workflowRun({
                databaseId: 79,
                conclusion: "success",
                updatedAt: "2026-09-20T13:00:00Z",
            })];
        },
    });
    const recovered = await recoveredAdapter.discover({ previous: partial });
    assert.equal(recovered.goals[0].phase, "queued");
    assert.equal(recovered.goals[0].issue.title, "Recovered work");
    assert.equal(recovered.partial, false);
    assert.equal(recovered.stale, false);
    assert.deepEqual(recovered.staleSources, []);
    assert.deepEqual(recovered.errors, []);
    assert.equal(recovered.sourceState.workflowRuns.data[0].databaseId, 79);
});

test("selects the two newest correlated runs per goal and caps the repository at twenty", () => {
    const goals = Array.from({ length: 12 }, (_, goalIndex) => ({
        workflowRuns: Array.from({ length: 3 }, (_, runIndex) => ({
            id: goalIndex * 10 + runIndex + 1,
            updatedAt: `2026-09-${String(20 - goalIndex).padStart(2, "0")}T1${runIndex}:00:00Z`,
        })),
    }));

    const selected = selectWorkflowJobRuns({ goals });

    assert.equal(selected.length, 20);
    assert.ok(selected.every((run) => run.id % 10 !== 1));
    assert.deepEqual(selected.slice(0, 2).map((run) => run.id), [3, 2]);
});

test("orders selected runs by updated time, created time, then run id", () => {
    const selected = selectWorkflowJobRuns({
        goals: [{
            workflowRuns: [
                {
                    id: 9,
                    updatedAt: "2026-09-20T12:00:00Z",
                    createdAt: "2026-09-20T10:00:00Z",
                },
                {
                    id: 7,
                    updatedAt: "2026-09-20T12:00:00Z",
                    createdAt: "2026-09-20T11:00:00Z",
                },
                {
                    id: 8,
                    updatedAt: "2026-09-20T12:00:00Z",
                    createdAt: "2026-09-20T11:00:00Z",
                },
            ],
        }],
    });

    assert.deepEqual(selected.map((run) => run.id), [8, 7]);
});

test("paginates selected workflow jobs and preserves only observed job and step fields", async () => {
    const calls = [];
    const firstPageJobs = Array.from({ length: 100 }, (_, index) => ({
        id: 1000 + index,
        name: `job-${index}`,
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-20T12:00:00Z",
        completed_at: "2026-09-20T12:01:00Z",
        steps: [],
    }));
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            calls.push(args);
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue({ body: "" })];
            if (args[0] === "pr") return [];
            if (args[0] === "run") return [workflowRun()];
            if (args.includes("page=1")) return workflowJobs({
                total_count: 101,
                jobs: firstPageJobs,
            });
            return workflowJobs({
                total_count: 101,
                jobs: [{
                    id: 1100,
                    name: "final-job",
                    status: "completed",
                    conclusion: "failure",
                    started_at: "invalid",
                    completed_at: null,
                    steps: [{
                        number: 1,
                        name: "Observed failure",
                        status: "completed",
                        conclusion: "failure",
                    }],
                }],
            });
        },
    });

    const result = await adapter.discover();
    const run = result.goals[0].workflowRuns[0];

    assert.equal(result.sourceState.workflowJobs.status, "fresh");
    assert.equal(run.jobsState.status, "fresh");
    assert.equal(run.jobs.length, 101);
    assert.deepEqual(run.jobs.at(-1), {
        id: 1100,
        name: "final-job",
        status: "completed",
        conclusion: "failure",
        url: "",
        startedAt: null,
        completedAt: null,
        steps: [{
            number: 1,
            name: "Observed failure",
            status: "completed",
            conclusion: "failure",
            startedAt: null,
            completedAt: null,
        }],
    });
    assert.equal(calls.filter((args) => args[0] === "api").length, 2);
    assert.ok(calls.every((args) => !args.some((arg) => String(arg).includes("logs"))));
});

test("distinguishes a successful empty jobs response from unavailable jobs", async () => {
    const emptyAdapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue({ body: "" })];
            if (args[0] === "pr") return [];
            if (args[0] === "run") return [workflowRun()];
            return { total_count: 0, jobs: [] };
        },
    });
    const empty = await emptyAdapter.discover();
    assert.equal(empty.goals[0].workflowRuns[0].jobsState.status, "fresh");
    assert.deepEqual(empty.goals[0].workflowRuns[0].jobs, []);

    const deniedAdapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue({ body: "" })];
            if (args[0] === "pr") return [];
            if (args[0] === "run") return [workflowRun()];
            throw new Error("HTTP 403: Resource not accessible by integration");
        },
    });
    const denied = await deniedAdapter.discover();
    assert.equal(denied.sourceState.workflowJobs.status, "unavailable");
    assert.equal(denied.goals[0].workflowRuns[0].jobsState.status, "unavailable");
    assert.equal(denied.goals[0].workflowRuns[0].jobs, null);
    assert.equal(denied.partial, true);
    assert.equal(denied.stale, false);
    assert.equal(denied.errors.at(-1).source, "workflow jobs");
});

test("preserves each selected run's last successful jobs when only the jobs source fails", async () => {
    const previous = buildActivitySnapshot({
        repository,
        issues: [issue({ body: "" })],
        workflowRuns: [workflowRun()],
        sourceState: {
            issues: { data: [issue({ body: "" })], status: "fresh" },
            pullRequests: { data: [], status: "fresh" },
            workflowRuns: { data: [workflowRun()], status: "fresh" },
            workflowJobs: {
                data: [{
                    runId: 78,
                    fetchedAt: "2026-09-20T12:02:00Z",
                    status: "fresh",
                    error: "",
                    truncated: false,
                    jobs: workflowJobs().jobs,
                }],
                fetchedAt: "2026-09-20T12:02:00Z",
                status: "fresh",
                error: "",
            },
        },
    });
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue({ title: "Updated", body: "" })];
            if (args[0] === "pr") return [];
            if (args[0] === "run") return [workflowRun({ conclusion: "success" })];
            throw new Error("workflow jobs permission denied");
        },
    });

    const result = await adapter.discover({ previous });
    const run = result.goals[0].workflowRuns[0];

    assert.equal(result.goals[0].issue.title, "Updated");
    assert.equal(result.sourceState.issues.status, "fresh");
    assert.equal(result.sourceState.workflowRuns.status, "fresh");
    assert.equal(result.sourceState.workflowJobs.status, "stale");
    assert.deepEqual(result.staleSources, ["workflowJobs"]);
    assert.equal(run.jobsState.status, "stale");
    assert.equal(run.jobs[0].name, "test");
});

test("marks the jobs source partial when the pagination ceiling is reached", async () => {
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue({ body: "" })];
            if (args[0] === "pr") return [];
            if (args[0] === "run") return [workflowRun()];
            return {
                total_count: 1001,
                jobs: Array.from({ length: 100 }, (_, index) => ({
                    id: Number(args.find((arg) => String(arg).startsWith("page=")).split("=")[1]) * 1000 + index,
                    name: `job-${index}`,
                })),
            };
        },
    });

    const result = await adapter.discover();

    assert.equal(result.sourceState.workflowJobs.status, "partial");
    assert.equal(result.goals[0].workflowRuns[0].jobsState.truncated, true);
    assert.equal(result.goals[0].workflowRuns[0].jobs.length, 1000);
    assert.equal(result.partial, true);
});

test("keeps a never-successful source unavailable across repeated failures", async () => {
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") throw new Error("issues unavailable");
            return [];
        },
    });
    const first = await adapter.discover();
    const second = await adapter.discover({ previous: first });
    assert.equal(first.sourceState.issues.status, "unavailable");
    assert.equal(second.sourceState.issues.status, "unavailable");
    assert.equal(second.stale, false);
    assert.deepEqual(second.staleSources, []);
});

test("keeps review connections unavailable when pull request discovery has never succeeded", async () => {
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue()];
            if (args[0] === "pr") throw new Error("pull request access denied");
            return [];
        },
    });

    const result = await adapter.discover();
    assert.equal(result.sourceState.pullRequests.status, "unavailable");
    assert.equal(result.goals[0].pullRequests.length, 0);
});

test("preserves unavailable legacy review connections while stale and populates them after recovery", async () => {
    const previous = buildActivitySnapshot({
        repository,
        issues: [issue()],
        pullRequests: [pullRequest({
            latestReviews: undefined,
            reviewRequests: undefined,
        })],
    });
    delete previous.sourceState;

    const failingAdapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue()];
            if (args[0] === "pr") throw new Error("temporary pull request failure");
            return [];
        },
    });
    const stale = await failingAdapter.discover({ previous });
    assert.equal(stale.goals[0].pullRequests[0].reviews, null);
    assert.equal(stale.goals[0].pullRequests[0].reviewRequests, null);
    assert.equal(stale.sourceState.pullRequests.status, "stale");

    const recoveredAdapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue()];
            if (args[0] === "pr") return [pullRequest({
                reviewDecision: "",
                latestReviews: [],
                reviewRequests: [],
            })];
            return [];
        },
    });
    const recovered = await recoveredAdapter.discover({ previous: stale });
    assert.deepEqual(recovered.goals[0].pullRequests[0].reviews, []);
    assert.deepEqual(recovered.goals[0].pullRequests[0].reviewRequests, []);
    assert.equal(recovered.sourceState.pullRequests.status, "fresh");
});

test("legacy snapshot recovery preserves pull requests linked to multiple goals", async () => {
    const secondIssue = issue({
        number: 13,
        title: "Ship the API",
        url: "https://github.com/octodemo/demo/issues/13",
    });
    const previous = buildActivitySnapshot({
        repository,
        issues: [issue(), secondIssue],
        pullRequests: [pullRequest({ body: "Closes #12 and closes #13" })],
    });
    delete previous.sourceState;
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue(), secondIssue];
            if (args[0] === "pr") throw new Error("temporary PR failure");
            return [];
        },
    });
    const result = await adapter.discover({ previous });
    assert.equal(result.goals.find((goal) => goal.issue.number === 12).phase, "reviewing");
    assert.equal(result.goals.find((goal) => goal.issue.number === 13).phase, "reviewing");
});

test("legacy issue failure preserves a command-comment-only goal", async () => {
    const previous = buildActivitySnapshot({
        repository,
        issues: [issue({
            labels: [],
            comments: [{ body: "/squad investigate the dashboard" }],
        })],
    });
    delete previous.sourceState;
    assert.equal(previous.goals.length, 1);

    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") throw new Error("temporary issue failure");
            return [];
        },
    });
    const result = await adapter.discover({ previous });
    assert.equal(result.goals.length, 1);
    assert.equal(result.goals[0].id, "octodemo/demo#12");
    assert.equal(result.stale, true);
    assert.deepEqual(result.staleSources, ["issues"]);
});

test("legacy issue failure preserves closed non-goal dependency state", async () => {
    const dependency = issue({
        number: 9,
        title: "Choose an API",
        state: "CLOSED",
        labels: [],
        url: "https://github.com/octodemo/demo/issues/9",
    });
    const previous = buildActivitySnapshot({
        repository,
        issues: [
            issue({ body: "Depends on: #9" }),
            dependency,
        ],
    });
    delete previous.sourceState;
    assert.equal(previous.goals[0].phase, "queued");
    assert.equal(previous.goals[0].dependencies[0].phase, "completed");

    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") throw new Error("temporary issue failure");
            return [];
        },
    });
    const result = await adapter.discover({ previous });
    assert.equal(result.goals[0].phase, "queued");
    assert.equal(result.goals[0].blockers.length, 0);
    assert.equal(result.goals[0].dependencies[0].phase, "completed");
});
