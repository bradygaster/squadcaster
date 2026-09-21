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

test("fallback discovery accepts affiliated repositories and rejects unrelated public repositories", async () => {
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        runJson: async (args) => {
            calls.push(args);
            if (args[0] === "api") {
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
                                ],
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                    },
                };
            }
            if (args.includes("squad_artifact")) {
                return [
                    { repository: { nameWithOwner: "octodemo/artifacts" } },
                    { repository: { nameWithOwner: "unrelated/public" } },
                ];
            }
            return [];
        },
    });

    await global.discoverRepositories({ force: true });

    assert.deepEqual(
        global.registry.repositories.map((candidate) => candidate.nameWithOwner),
        ["octodemo/artifacts"],
    );
    assert.equal(global.registry.repositories[0].squadDetected, true);
    assert.equal(calls.filter((args) => args[0] === "search").length, 2);
    const discoveryQuery = calls.find((args) => args[0] === "api").find(
        (argument) => argument.startsWith("query="),
    );
    assert.match(discoveryQuery, /affiliations: \[OWNER, COLLABORATOR, ORGANIZATION_MEMBER\]/);
});

test("fallback discovery uses all affiliated pages and deduplicates search results", async () => {
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "api") {
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
                                ],
                                pageInfo: { hasNextPage: true, endCursor: "page-2" },
                            },
                        },
                    },
                };
            }
            return [
                { repository: { nameWithOwner: "octodemo/already-detected" } },
                { repository: { nameWithOwner: "octodemo/second-page" } },
                { repository: { nameWithOwner: "OCTODEMO/SECOND-PAGE" } },
            ];
        },
    });

    await global.discoverRepositories({ force: true });

    assert.deepEqual(
        global.registry.repositories.map((candidate) => candidate.nameWithOwner),
        ["octodemo/already-detected", "octodemo/second-page"],
    );
    assert.equal(global.registry.repositories[1].permission, "write");
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
