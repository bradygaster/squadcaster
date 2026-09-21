import assert from "node:assert/strict";
import test from "node:test";
import { aggregateActivitySnapshots, buildActivitySnapshot } from "../activity-model.mjs";
import { GitHubGlobalActivity, normalizeRegistry, refreshPolicy } from "../global-activity.mjs";

const repository = (nameWithOwner) => ({
    name: nameWithOwner.split("/")[1],
    nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    defaultBranchRef: { name: "main" },
});

const issue = (repositoryName, number, body = "", state = "OPEN") => ({
    number,
    title: `${repositoryName} work`,
    body,
    state,
    url: `https://github.com/${repositoryName}/issues/${number}`,
    labels: [{ name: "squad" }],
    comments: [],
    updatedAt: "2026-09-20T12:00:00Z",
});

test("resolves repository-qualified dependencies across snapshots", () => {
    const backend = buildActivitySnapshot({
        repository: repository("octodemo/backend"),
        issues: [issue("octodemo/backend", 41, "", "CLOSED")],
    });
    const frontend = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57, "Blocked by:\n- octodemo/backend#41")],
    });
    const aggregate = aggregateActivitySnapshots({
        snapshots: [frontend, backend],
        currentRepository: "octodemo/frontend",
    });
    const goal = aggregate.goals.find((candidate) => candidate.id === "octodemo/frontend#57");
    assert.equal(goal.dependencies[0].phase, "completed");
    assert.equal(goal.blockers.length, 0);
    assert.equal(goal.phase, "queued");
});

test("keeps unresolved cross-repository dependencies visible", () => {
    const frontend = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57, "Blocked by: https://github.com/octodemo/worker/issues/23")],
    });
    const aggregate = aggregateActivitySnapshots({ snapshots: [frontend] });
    assert.equal(aggregate.goals[0].phase, "blocked");
    assert.equal(aggregate.goals[0].blockers[0].id, "octodemo/worker#23");
    assert.equal(aggregate.goals[0].blockers[0].status, "unknown");
});

test("preserves an explicit blocked label without dependency references", () => {
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [{
            ...issue("octodemo/frontend", 57),
            labels: [{ name: "squad" }, { name: "blocked" }],
        }],
    });

    const aggregate = aggregateActivitySnapshots({ snapshots: [snapshot] });
    assert.equal(aggregate.goals[0].phase, "blocked");
});

test("terminal goal states take precedence over unresolved dependencies", () => {
    const completed = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue(
            "octodemo/frontend",
            57,
            "Depends on: octodemo/missing#1",
            "CLOSED",
        )],
    });
    const aggregate = aggregateActivitySnapshots({ snapshots: [completed] });
    assert.equal(aggregate.goals[0].phase, "completed");
    assert.equal(aggregate.summary.completed, 1);
    assert.equal(aggregate.summary.blocked, 0);
});

test("aggregation does not mutate cached repository snapshots", () => {
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57, "Depends on: octodemo/backend#41")],
    });
    const original = structuredClone(snapshot);
    aggregateActivitySnapshots({ snapshots: [snapshot] });
    assert.deepEqual(snapshot, original);
});

test("aggregation exposes partial and stale repository snapshots", () => {
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57)],
        errors: [{ source: "pull requests", message: "temporary failure" }],
        sourceState: {
            issues: { data: [issue("octodemo/frontend", 57)], status: "fresh" },
            pullRequests: { data: [], status: "stale", error: "temporary failure" },
            workflowRuns: { data: [], status: "fresh" },
        },
    });
    const aggregate = aggregateActivitySnapshots({ snapshots: [snapshot] });
    assert.equal(aggregate.partial, true);
    assert.equal(aggregate.stale, true);
    assert.deepEqual(aggregate.staleSources, [{
        repository: "octodemo/frontend",
        source: "pullRequests",
    }]);
    assert.equal(aggregate.errors[0].repository, "octodemo/frontend");
});

test("dependency resolution does not depend on snapshot order", () => {
    const dependent = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57, "Depends on: octodemo/backend#41")],
    });
    const dependency = buildActivitySnapshot({
        repository: repository("octodemo/backend"),
        issues: [issue("octodemo/backend", 41, "", "CLOSED")],
    });
    const forward = aggregateActivitySnapshots({ snapshots: [dependent, dependency] });
    const reverse = aggregateActivitySnapshots({ snapshots: [dependency, dependent] });
    assert.equal(forward.goals.find((goal) => goal.id === "octodemo/frontend#57").phase, "queued");
    assert.equal(reverse.goals.find((goal) => goal.id === "octodemo/frontend#57").phase, "queued");
});

test("registry normalization preserves inclusion preferences and snapshots", () => {
    const registry = normalizeRegistry({
        viewer: "octocat",
        repositories: [{ nameWithOwner: "octodemo/demo", included: false }],
        snapshots: { "octodemo/demo": { goals: [] } },
    });
    assert.equal(registry.repositories[0].included, false);
    assert.deepEqual(registry.snapshots["octodemo/demo"].goals, []);
});

test("repository discovery preserves exclusions and ignores non-Squad repositories", async () => {
    const registry = {
        repositories: [{ nameWithOwner: "octodemo/squad", included: false }],
    };
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry,
        runJson: async () => ({
            data: {
                viewer: {
                    login: "octocat",
                    repositories: {
                        nodes: [
                            {
                                ...repository("octodemo/squad"),
                                viewerPermission: "WRITE",
                                squadSource: { oid: "abc" },
                                issues: { totalCount: 0 },
                                pullRequests: { totalCount: 0 },
                            },
                            {
                                ...repository("octodemo/ordinary"),
                                viewerPermission: "READ",
                                issues: { totalCount: 0 },
                                pullRequests: { totalCount: 0 },
                            },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                    },
                },
                rateLimit: { remaining: 4999, resetAt: "2026-09-20T13:00:00Z" },
            },
        }),
    });
    await global.discoverRepositories({ force: true });
    assert.equal(global.registry.viewer, "octocat");
    assert.equal(global.registry.repositories.length, 1);
    assert.equal(global.registry.repositories[0].included, false);
    assert.equal(global.registry.rateLimit.remaining, 4999);
});

test("discovers repositories whose only Squad signal is an open prefixed label", async () => {
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        runJson: async (args) => {
            calls.push(args);
            if (args[1] === "graphql") {
                return {
                    data: {
                        viewer: {
                            login: "octocat",
                            repositories: {
                                nodes: [{
                                    ...repository("octodemo/prefix-only"),
                                    viewerPermission: "WRITE",
                                    issues: { totalCount: 0 },
                                    pullRequests: { totalCount: 0 },
                                }],
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                };
            }
            if (args[1] === "repos/octodemo/prefix-only/issues") {
                return "squad:frontend";
            }
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    await global.discoverRepositories({ force: true });

    assert.deepEqual(
        global.registry.repositories.map((candidate) => candidate.nameWithOwner),
        ["octodemo/prefix-only"],
    );
    assert.equal(global.registry.repositories[0].squadDetected, true);
    const labelCall = calls.find((args) => args[1] === "repos/octodemo/prefix-only/issues");
    assert.ok(labelCall.includes("--paginate"));
    assert.equal(labelCall.includes("--slurp"), false);
    assert.ok(labelCall.includes(".[] | .labels[]?.name | @json"));
    assert.equal(calls.some((args) => args[0] === "search"), false);
});

test("multiple prefixed labels discover a repository only once", async () => {
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[1] === "graphql") {
                return {
                    data: {
                        viewer: {
                            login: "octocat",
                            repositories: {
                                nodes: [{
                                    ...repository("octodemo/multiple-prefixes"),
                                    viewerPermission: "READ",
                                    issues: { totalCount: 0 },
                                    pullRequests: { totalCount: 0 },
                                }],
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                };
            }
            if (args[1] === "repos/octodemo/multiple-prefixes/issues") {
                return [["squad:frontend", "squad:backend"], ["squad:frontend"]];
            }
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    await global.discoverRepositories({ force: true });

    assert.equal(global.registry.repositories.length, 1);
    assert.equal(global.registry.repositories[0].nameWithOwner, "octodemo/multiple-prefixes");
});

test("prefixed label matching and repository deduplication are case-insensitive", async () => {
    let page = 0;
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[1] === "graphql") {
                page += 1;
                return {
                    data: {
                        viewer: {
                            login: "octocat",
                            repositories: {
                                nodes: [{
                                    ...repository(page === 1
                                        ? "octodemo/case-test"
                                        : "OCTODEMO/CASE-TEST"),
                                    viewerPermission: "WRITE",
                                    issues: { totalCount: 0 },
                                    pullRequests: { totalCount: 0 },
                                }],
                                pageInfo: page === 1
                                    ? { hasNextPage: true, endCursor: "page-2" }
                                    : { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                };
            }
            if (args[1] === "repos/OCTODEMO/CASE-TEST/issues") return ["Squad:Frontend"];
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    await global.discoverRepositories({ force: true });

    assert.equal(global.registry.repositories.length, 1);
    assert.equal(global.registry.repositories[0].nameWithOwner.toLowerCase(), "octodemo/case-test");
    assert.equal(global.registry.repositories[0].squadDetected, true);
});

test("fallback discovery searches each affiliated repository and rejects unrelated results", async () => {
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        runJson: async (args) => {
            calls.push(args);
            if (args[1] === "graphql") {
                return {
                    data: {
                        viewer: {
                            login: "octocat",
                            repositories: {
                                nodes: [
                                    {
                                        ...repository("octodemo/artifacts"),
                                        viewerPermission: "READ",
                                        issues: { totalCount: 0 },
                                        pullRequests: { totalCount: 0 },
                                    },
                                    {
                                        ...repository("octodemo/ordinary"),
                                        viewerPermission: "READ",
                                        issues: { totalCount: 0 },
                                        pullRequests: { totalCount: 0 },
                                    },
                                ],
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                };
            }
            if (args[0] === "api") return [];
            if (args.includes("octodemo/artifacts")) {
                return [
                    { repository: { nameWithOwner: "octodemo/artifacts" } },
                    { repository: { nameWithOwner: "unrelated/public" } },
                ];
            }
            return [{ repository: { nameWithOwner: "unrelated/public" } }];
        },
    });

    await global.discoverRepositories({ force: true });

    assert.deepEqual(
        global.registry.repositories.map((candidate) => candidate.nameWithOwner),
        ["octodemo/artifacts"],
    );
    assert.equal(global.registry.repositories[0].squadDetected, true);
    assert.equal(calls.filter((args) => args[0] === "search").length, 2);
    assert.ok(calls.filter((args) => args[0] === "search").every((args) => args.includes("--repo")));
    assert.ok(calls.filter((args) => args[0] === "search").every((args) => args.includes("1")));
    const discoveryQuery = calls.find((args) => args[1] === "graphql").find(
        (argument) => argument.startsWith("query="),
    );
    assert.match(discoveryQuery, /affiliations: \[OWNER, COLLABORATOR, ORGANIZATION_MEMBER\]/);
});

test("fallback discovery keeps every paginated affiliated repository eligible", async () => {
    const searchCalls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[1] === "graphql") {
                const cursorIndex = args.indexOf("cursor=page-2");
                if (cursorIndex >= 0) {
                    return {
                        data: {
                            viewer: {
                                login: "octocat",
                                repositories: {
                                    nodes: [
                                        {
                                            ...repository("octodemo/second-page"),
                                            viewerPermission: "WRITE",
                                            issues: { totalCount: 0 },
                                            pullRequests: { totalCount: 0 },
                                        },
                                    ],
                                    pageInfo: { hasNextPage: false, endCursor: null },
                                },
                            },
                        },
                    };
                }
                return {
                    data: {
                        viewer: {
                            login: "octocat",
                            repositories: {
                                nodes: [
                                    {
                                        ...repository("octodemo/already-detected"),
                                        viewerPermission: "ADMIN",
                                        squadSource: { oid: "abc" },
                                        issues: { totalCount: 0 },
                                        pullRequests: { totalCount: 0 },
                                    },
                                    {
                                        ...repository("octodemo/first-page"),
                                        viewerPermission: "READ",
                                        issues: { totalCount: 0 },
                                        pullRequests: { totalCount: 0 },
                                    },
                                ],
                                pageInfo: { hasNextPage: true, endCursor: "page-2" },
                            },
                        },
                    },
                };
            }
            if (args[0] === "api") return [];
            searchCalls.push(args);
            assert.ok(args.includes("--repo"), "fallback searches must never use a global result window");
            return args.includes("octodemo/second-page")
                ? [{ repository: { nameWithOwner: "OCTODEMO/SECOND-PAGE" } }]
                : Array.from({ length: 1001 }, () => ({
                    repository: { nameWithOwner: "unrelated/public" },
                }));
        },
    });

    await global.discoverRepositories({ force: true });

    assert.deepEqual(
        global.registry.repositories.map((candidate) => candidate.nameWithOwner),
        ["octodemo/already-detected", "octodemo/second-page"],
    );
    assert.equal(global.registry.repositories[1].permission, "write");
    assert.equal(searchCalls.length, 2);
    assert.deepEqual(
        new Set(searchCalls.map((args) => args[args.indexOf("--repo") + 1])),
        new Set(["octodemo/first-page", "octodemo/second-page"]),
    );
});

test("refresh policy gives active repositories a shorter interval", () => {
    assert.ok(refreshPolicy.activeMilliseconds < refreshPolicy.inactiveMilliseconds);
    assert.ok(refreshPolicy.inactiveMilliseconds < refreshPolicy.discoveryMilliseconds);
});

test("aggregate refresh skips excluded repositories and reuses the current snapshot", async () => {
    const current = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57)],
    });
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            repositories: [
                { ...repository("octodemo/frontend"), owner: "octodemo", included: true },
                { ...repository("octodemo/backend"), owner: "octodemo", included: false },
            ],
            snapshots: {},
        },
        runJson: async (args) => {
            calls.push(args);
            return [];
        },
    });
    const aggregate = await global.refresh({
        currentRepository: "octodemo/frontend",
        currentSnapshot: current,
    });
    assert.equal(aggregate.repositories.length, 2);
    assert.equal(aggregate.goals.length, 1);
    assert.equal(calls.length, 0);
});

test("partial refresh retains the last fully successful timestamp and later recovers", async () => {
    const previous = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57)],
        pullRequests: [{
            number: 44,
            title: "Implement #57",
            body: "Closes #57",
            state: "OPEN",
            url: "https://github.com/octodemo/frontend/pull/44",
            headRefName: "squad/implement-57-dashboard",
        }],
    });
    const successfulAt = "2026-09-20T12:00:00Z";
    let failPullRequests = true;
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            repositories: [{
                ...repository("octodemo/frontend"),
                owner: "octodemo",
                included: true,
                lastSuccessfulRefresh: successfulAt,
            }],
            snapshots: { "octodemo/frontend": previous },
        },
        runJson: async (args) => {
            if (args[0] === "repo") return repository("octodemo/frontend");
            if (args[0] === "issue") return [issue("octodemo/frontend", 57)];
            if (args[0] === "pr" && failPullRequests) throw new Error("temporary PR failure");
            return [];
        },
    });

    const partial = await global.refresh({ forceAll: true });
    assert.equal(partial.goals[0].phase, "reviewing");
    assert.equal(global.registry.repositories[0].lastSuccessfulRefresh, successfulAt);
    assert.match(global.registry.repositories[0].error, /pull requests: temporary PR failure/);

    failPullRequests = false;
    const recovered = await global.refresh({ forceAll: true });
    assert.equal(recovered.goals[0].phase, "queued");
    assert.notEqual(global.registry.repositories[0].lastSuccessfulRefresh, successfulAt);
    assert.equal(global.registry.repositories[0].error, "");
    assert.equal(recovered.partial, false);
    assert.equal(recovered.stale, false);
});

test("background refresh retries stale workflow sources for inactive repositories", async () => {
    const previous = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57, "", "CLOSED")],
        workflowRuns: [{
            databaseId: 78,
            workflowName: "Squad Implement Worker",
            displayTitle: "Implement #57",
            status: "completed",
            conclusion: "success",
            headBranch: "squad/implement-57-dashboard",
        }],
    });
    previous.sourceState.workflowRuns.status = "stale";
    previous.sourceState.workflowRuns.error = "workflow service unavailable";
    previous.partial = true;
    previous.stale = true;
    previous.staleSources = ["workflowRuns"];
    previous.errors = [{ source: "workflow runs", message: "workflow service unavailable" }];
    const successfulAt = "2026-09-20T12:00:00Z";
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            repositories: [{
                ...repository("octodemo/frontend"),
                owner: "octodemo",
                included: true,
                lastSuccessfulRefresh: successfulAt,
            }],
            snapshots: { "octodemo/frontend": previous },
        },
        runJson: async (args) => {
            calls.push(args);
            if (args[0] === "repo") return repository("octodemo/frontend");
            if (args[0] === "issue") return [issue("octodemo/frontend", 57, "", "CLOSED")];
            return [];
        },
    });

    const recovered = await global.refresh({ forceAll: true });
    assert.ok(calls.some((args) => args[0] === "run"));
    assert.equal(recovered.partial, false);
    assert.equal(recovered.stale, false);
    assert.notEqual(global.registry.repositories[0].lastSuccessfulRefresh, successfulAt);
});
