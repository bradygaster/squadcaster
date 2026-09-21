import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    discoverImplementationProvenance,
    extractImplementationProvenance,
    IMPLEMENTATION_PROVENANCE_LABEL,
    implementationProvenancePolicy,
    selectImplementationProvenancePullRequests,
    validateImplementationProvenance,
} from "../implementation-provenance.mjs";
import { buildActivitySnapshot } from "../activity-model.mjs";

const valid = JSON.parse(await readFile(new URL(
    "./fixtures/implementation-provenance/valid-v1.json",
    import.meta.url,
), "utf8"));
const replacement = JSON.parse(await readFile(new URL(
    "./fixtures/implementation-provenance/multi-goal-replacement-v1.json",
    import.meta.url,
), "utf8"));

function comment(payload = valid, overrides = {}) {
    return {
        user: { login: "github-actions[bot]" },
        body: `${IMPLEMENTATION_PROVENANCE_LABEL}\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
        ...overrides,
    };
}

function pull(number = 101, headRefName = "squad/implement-42-example") {
    return {
        number,
        title: `PR ${number}`,
        body: number === 101 ? "Closes #42" : "",
        state: "OPEN",
        url: `https://github.com/octo/example/pull/${number}`,
        headRefName,
        updatedAt: "2026-09-21T12:00:00Z",
    };
}

function issue(number) {
    return {
        number,
        title: `Goal ${number}`,
        body: "",
        state: "OPEN",
        url: `https://github.com/octo/example/issues/${number}`,
        labels: [{ name: "squad" }],
        comments: [],
    };
}

function run(payload) {
    return {
        id: payload.run_id,
        run_attempt: payload.run_attempt,
        repository: { full_name: payload.repository },
        path: `${payload.workflow}@refs/heads/main`,
        event: payload.event,
        head_branch: payload.head_ref,
    };
}

function discoveryApi({
    comments = [comment()],
    workerPayload = valid,
    dispatcherPayload = valid,
    failComments = null,
} = {}) {
    return async (args) => {
        const route = args[1];
        if (route.endsWith("/comments")) {
            if (failComments) throw new Error(failComments);
            const page = Number(String(args.at(-1)).split("=").at(-1));
            return page === 1 ? comments : [];
        }
        if (route.endsWith(`/actions/runs/${workerPayload.workflow_run.run_id}`)) {
            return run({
                ...workerPayload.workflow_run,
                head_ref: workerPayload.pull_request.head_ref,
            });
        }
        if (route.endsWith(`/actions/runs/${dispatcherPayload.session_origin.run_id}`)) {
            return run({
                ...dispatcherPayload.session_origin,
                event: "workflow_dispatch",
                head_ref: "main",
            });
        }
        throw new Error(`Unexpected route ${route}`);
    };
}

function discover(overrides = {}) {
    const selectedPull = overrides.pullRequest || pull();
    return discoverImplementationProvenance({
        runJson: discoveryApi(overrides.api),
        cwd: "/repo",
        repository: "octo/example",
        pullRequests: [selectedPull],
        allPullRequests: [pull(100, "old"), pull(), pull(102, "squad/implement-42-replacement")],
        issues: [issue(42), issue(43)],
        workflowRuns: [],
        previous: overrides.previous,
        attemptedAt: "2026-09-21T12:00:00.000Z",
    });
}

test("copies and accepts the final producer fixtures", () => {
    assert.deepEqual(validateImplementationProvenance(valid), []);
    assert.deepEqual(validateImplementationProvenance(replacement), []);
});

test("extracts exactly one visible json block after the authoritative heading", () => {
    assert.deepEqual(extractImplementationProvenance(comment().body), valid);
    assert.equal(extractImplementationProvenance("No provenance"), null);
    assert.equal(
        extractImplementationProvenance(
            `${comment().body}\n\n${comment().body}`,
        ),
        undefined,
    );
    assert.equal(
        extractImplementationProvenance(
            `${IMPLEMENTATION_PROVENANCE_LABEL}\n\`\`\`json\n{`,
        ),
        undefined,
    );
});

test("rejects unsupported, extra, partial, unresolved, and duplicate records", () => {
    const cases = [
        { ...valid, schema_version: "2" },
        { ...valid, extra: true },
        Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "goals")),
        { ...valid, implementation_session_id: "self" },
        { ...valid, implementation_session_id: "squad-implementation-session/v1/aw_1/2" },
        { ...valid, goals: [...valid.goals, { ...valid.goals[0] }] },
        { ...valid, replaces: [{ repository: "octo/example", number: 100 }, { repository: "octo/example", number: 100 }] },
    ];
    for (const value of cases) {
        assert.notDeepEqual(validateImplementationProvenance(value), [], JSON.stringify(value));
    }
});

test("matches producer goal uniqueness including relationship", () => {
    const value = {
        ...valid,
        goals: [
            ...valid.goals,
            {
                repository: valid.repository,
                issue: valid.origin_issue,
                relationship: "relates",
            },
        ],
    };
    assert.deepEqual(validateImplementationProvenance(value), []);
});

test("selects bounded repository PRs independently of legacy goal correlation", () => {
    const selected = selectImplementationProvenancePullRequests([
        pull(103, "dependency-worker-branch"),
        pull(102, "unrelated-branch"),
    ]);
    assert.deepEqual(selected.map((item) => item.number), [103, 102]);
});

test("ignores non-bot comments and marks absent provenance missing", async () => {
    const result = await discover({
        api: {
            comments: [comment(valid, { user: { login: "octocat" } })],
        },
    });
    assert.equal(result.status, "fresh");
    assert.equal(result.data[0].status, "missing");
    assert.equal(result.data[0].record, null);
});

test("fails duplicate bot candidates and malformed payloads closed", async () => {
    const duplicate = await discover({
        api: { comments: [comment(), comment()] },
    });
    assert.equal(duplicate.data[0].status, "invalid");
    assert.equal(duplicate.data[0].record, null);

    const malformed = await discover({
        api: {
            comments: [{
                user: { login: "github-actions[bot]" },
                body: `${IMPLEMENTATION_PROVENANCE_LABEL}\n\`\`\`json\n{`,
            }],
        },
    });
    assert.equal(malformed.data[0].status, "invalid");
    assert.equal(malformed.data[0].record, null);
});

test("accepts a fully resolved runtime-matched record", async () => {
    const result = await discover();
    assert.equal(result.status, "fresh");
    assert.equal(result.data[0].status, "valid");
    assert.equal(
        result.data[0].record.implementationSessionId,
        valid.implementation_session_id,
    );
});

test("reuses fresh PR-revision results without polling comments or runs", async () => {
    const fresh = await discover();
    let requests = 0;
    const cached = await discoverImplementationProvenance({
        runJson: async () => {
            requests += 1;
            throw new Error("unchanged entries must not fetch");
        },
        cwd: "/repo",
        repository: "octo/example",
        pullRequests: [pull()],
        allPullRequests: [pull()],
        issues: [issue(42)],
        workflowRuns: [],
        previous: { sourceState: { implementationProvenance: fresh } },
        attemptedAt: "2026-09-21T12:01:00.000Z",
    });

    test("periodically revalidates unchanged PRs to detect comment removal", async () => {
        const fresh = await discover();
        let requests = 0;
        const refreshed = await discoverImplementationProvenance({
            runJson: async (args) => {
                requests += 1;
                return args[1].endsWith("/comments") ? [] : {};
            },
            cwd: "/repo",
            repository: "octo/example",
            pullRequests: [pull()],
            allPullRequests: [pull()],
            issues: [issue(42)],
            workflowRuns: [],
            previous: { sourceState: { implementationProvenance: fresh } },
            attemptedAt: "2026-09-21T12:11:00.000Z",
        });
        assert.equal(requests, 1);
        assert.equal(refreshed.status, "fresh");
        assert.equal(refreshed.data[0].status, "missing");
        assert.equal(refreshed.data[0].record, null);
    });
    assert.equal(requests, 0);
    assert.equal(cached.status, "fresh");
    assert.equal(cached.data[0].status, "valid");
    assert.equal(cached.data[0].revision, pull().updatedAt);
});

test("requires every replacement PR to carry matching authoritative provenance", async () => {
    const runFor = (payload) => ({
        id: payload.run_id,
        run_attempt: payload.run_attempt,
        repository: { full_name: payload.repository },
        path: `${payload.workflow}@refs/heads/main`,
        event: payload.event,
        head_branch: payload.head_ref,
    });
    const api = async (args) => {
        const route = args[1];
        if (route.endsWith("/issues/102/comments")) return [comment(replacement)];
        if (route.endsWith("/issues/101/comments")) return [comment(valid)];
        if (route.endsWith("/actions/runs/70002")) {
            return runFor({
                ...replacement.workflow_run,
                head_ref: replacement.pull_request.head_ref,
            });
        }
        if (route.endsWith("/actions/runs/70001")) {
            return runFor({
                ...valid.workflow_run,
                head_ref: valid.pull_request.head_ref,
            });
        }
        if (route.endsWith("/actions/runs/67890")) {
            return runFor({
                ...valid.session_origin,
                event: "workflow_dispatch",
                head_ref: "main",
            });
        }
        throw new Error(`Unexpected route ${route}`);
    };
    const base = {
        runJson: api,
        cwd: "/repo",
        repository: "octo/example",
        pullRequests: [pull(102, replacement.pull_request.head_ref)],
        allPullRequests: [
            pull(101, valid.pull_request.head_ref),
            pull(102, replacement.pull_request.head_ref),
        ],
        issues: [issue(42), issue(43)],
        workflowRuns: [],
        attemptedAt: "2026-09-21T12:00:00.000Z",
    };
    const accepted = await discoverImplementationProvenance(base);
    assert.equal(accepted.data[0].status, "valid");

    const unrelated = structuredClone(valid);
    unrelated.implementation_session_id =
        "squad-implementation-session/v1/12345/99999";
    const rejected = await discoverImplementationProvenance({
        ...base,
        runJson: async (args) =>
            args[1].endsWith("/issues/101/comments")
                ? [comment(unrelated)]
                : api(args),
    });
    assert.equal(rejected.data[0].status, "invalid");
    assert.equal(rejected.data[0].record, null);
    assert.match(rejected.data[0].error, /replacement-unrelated/);
});

test("rejects repository, PR, head, run, goal, and replacement mismatches", async () => {
    const payloads = [
        { ...valid, repository: "octo/other" },
        { ...valid, pull_request: { ...valid.pull_request, number: 999 } },
        { ...valid, pull_request: { ...valid.pull_request, head_ref: "wrong" } },
        { ...valid, goals: [{ repository: "octo/example", issue: 999, relationship: "closes" }], origin_issue: 999 },
        { ...valid, replaces: [{ repository: "octo/example", number: 999 }] },
    ];
    for (const payload of payloads) {
        const result = await discover({
            api: {
                comments: [comment(payload)],
                workerPayload: payload,
                dispatcherPayload: payload,
            },
        });
        assert.equal(result.data[0].status, "invalid");
        assert.equal(result.data[0].record, null);
    }

    const mismatchedRunApi = discoveryApi();
    const result = await discoverImplementationProvenance({
        runJson: async (args) => {
            const value = await mismatchedRunApi(args);
            return args[1].includes("/actions/runs/70001")
                ? { ...value, head_branch: "wrong" }
                : value;
        },
        cwd: "/repo",
        repository: "octo/example",
        pullRequests: [pull()],
        allPullRequests: [pull()],
        issues: [issue(42)],
        workflowRuns: [],
        attemptedAt: "2026-09-21T12:00:00.000Z",
    });
    assert.equal(result.data[0].status, "invalid");
});

test("retains only the last valid cache on transport and permission failures", async () => {
    const fresh = await discover();
    const previous = { sourceState: { implementationProvenance: fresh } };
    for (const message of ["network timeout", "HTTP 403: Resource not accessible"]) {
        const result = await discover({
            previous,
            api: { failComments: message },
            pullRequest: {
                ...pull(),
                updatedAt: "2026-09-21T13:00:00Z",
            },
        });

        assert.equal(result.status, "stale");
        assert.equal(result.data[0].status, "valid");
        assert.match(result.error, new RegExp(message.split(":")[0], "i"));
    }
});

test("fails closed when PR or issue discovery prerequisites are incomplete", async () => {
    const fresh = await discover();
    const stale = await discoverImplementationProvenance({
        runJson: discoveryApi(),
        cwd: "/repo",
        repository: "octo/example",
        pullRequests: [],
        allPullRequests: [],
        issues: [],
        workflowRuns: [],
        previous: { sourceState: { implementationProvenance: fresh } },
        attemptedAt: "2026-09-21T13:00:00.000Z",
        prerequisitesComplete: false,
    });
    assert.equal(stale.status, "stale");
    assert.equal(stale.data[0].status, "valid");
    assert.match(stale.error, /prerequisites are incomplete/i);

    const unavailable = await discoverImplementationProvenance({
        runJson: discoveryApi(),
        cwd: "/repo",
        repository: "octo/example",
        pullRequests: [],
        allPullRequests: [],
        issues: [],
        workflowRuns: [],
        previous: null,
        attemptedAt: "2026-09-21T13:00:00.000Z",
        prerequisitesComplete: false,
    });
    assert.equal(unavailable.status, "unavailable");
    assert.deepEqual(unavailable.data, []);
});

test("fresh missing and invalid responses remove active cached fields atomically", async () => {
    const fresh = await discover();
    const previous = { sourceState: { implementationProvenance: fresh } };
    const changedPull = {
        ...pull(),
        updatedAt: "2026-09-21T13:00:00Z",
    };
    const missing = await discover({
        previous,
        api: { comments: [] },
        pullRequest: changedPull,
    });
    assert.equal(missing.status, "fresh");
    assert.equal(missing.data[0].status, "missing");
    assert.equal(missing.data[0].record, null);

    const invalid = await discover({
        previous,
        api: { comments: [comment({ ...valid, extra: true })] },
        pullRequest: changedPull,
    });
    assert.equal(invalid.status, "fresh");
    assert.equal(invalid.data[0].status, "invalid");
    assert.equal(invalid.data[0].record, null);
});

test("enforces complete bounded comment pagination", async () => {
    const policy = implementationProvenancePolicy();
    assert.deepEqual(policy, {
        maxPullRequests: 20,
        commentPageSize: 100,
        commentMaxPages: 3,
        refreshIntervalMs: 600000,
    });
    let pages = 0;
    const result = await discoverImplementationProvenance({
        runJson: async (args) => {
            if (args[1].endsWith("/comments")) {
                pages += 1;
                return Array.from({ length: 100 }, () => ({
                    user: { login: "octocat" },
                    body: "ordinary comment",
                }));
            }
            throw new Error("unexpected");
        },
        cwd: "/repo",
        repository: "octo/example",
        pullRequests: [pull()],
        allPullRequests: [pull()],
        issues: [issue(42)],
        workflowRuns: [],
        attemptedAt: "2026-09-21T12:00:00.000Z",
    });
    assert.equal(pages, 3);
    assert.equal(result.status, "unavailable");
    assert.match(result.error, /pagination ceiling/);
});

test("aggregates multi-PR sessions and correlates exact worker runs", () => {
    const second = structuredClone(replacement);
    const entries = [
        {
            pullRequestNumber: 101,
            status: "valid",
            error: "",
            record: {
                schemaVersion: 1,
                producer: "squad",
                repository: valid.repository,
                originIssue: valid.origin_issue,
                implementationSessionId: valid.implementation_session_id,
                sessionOrigin: {
                    repository: valid.session_origin.repository,
                    workflow: valid.session_origin.workflow,
                    runId: valid.session_origin.run_id,
                    runAttempt: valid.session_origin.run_attempt,
                },
                workflowRun: {
                    repository: valid.workflow_run.repository,
                    workflow: valid.workflow_run.workflow,
                    runId: valid.workflow_run.run_id,
                    runAttempt: valid.workflow_run.run_attempt,
                    event: valid.workflow_run.event,
                },
                pullRequest: {
                    repository: valid.pull_request.repository,
                    number: valid.pull_request.number,
                    headRef: valid.pull_request.head_ref,
                },
                goals: valid.goals,
                replaces: valid.replaces,
            },
        },
        {
            pullRequestNumber: 102,
            status: "valid",
            error: "",
            record: {
                schemaVersion: 1,
                producer: "squad",
                repository: second.repository,
                originIssue: second.origin_issue,
                implementationSessionId: second.implementation_session_id,
                sessionOrigin: {
                    repository: second.session_origin.repository,
                    workflow: second.session_origin.workflow,
                    runId: second.session_origin.run_id,
                    runAttempt: second.session_origin.run_attempt,
                },
                workflowRun: {
                    repository: second.workflow_run.repository,
                    workflow: second.workflow_run.workflow,
                    runId: second.workflow_run.run_id,
                    runAttempt: second.workflow_run.run_attempt,
                    event: second.workflow_run.event,
                },
                pullRequest: {
                    repository: second.pull_request.repository,
                    number: second.pull_request.number,
                    headRef: second.pull_request.head_ref,
                },
                goals: second.goals,
                replaces: second.replaces,
            },
        },
    ];
    const snapshot = buildActivitySnapshot({
        repository: {
            name: "example",
            nameWithOwner: "octo/example",
            url: "https://github.com/octo/example",
        },
        issues: [issue(42), issue(43)],
        pullRequests: [pull(), pull(102, second.pull_request.head_ref)],
        workflowRuns: [{
            databaseId: 70002,
            workflowName: "Squad Implement Worker",
            displayTitle: "unrelated title",
            event: "workflow_dispatch",
            status: "completed",
            conclusion: "success",
            url: "https://github.com/octo/example/actions/runs/70002",
            headBranch: second.pull_request.head_ref,
        }],
        sourceState: {
            implementationProvenance: {
                revision: 1,
                data: entries,
                fetchedAt: "2026-09-21T12:00:00.000Z",
                status: "fresh",
                error: "",
            },
        },
    });
    const origin = snapshot.goals.find((goal) => goal.issue.number === 42);
    const related = snapshot.goals.find((goal) => goal.issue.number === 43);
    assert.equal(origin.implementationProvenance.sessions.length, 1);
    assert.equal(origin.implementationProvenance.sessions[0].pullRequests.length, 2);
    assert.equal(origin.implementationProvenance.sessions[0].workflowRuns.length, 2);
    assert.equal(related.implementationProvenance.sessions.length, 1);
    assert.equal(related.pullRequests[0].number, 102);
    assert.equal(related.workflowRuns[0].id, 70002);
});
