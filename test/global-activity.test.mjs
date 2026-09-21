import assert from "node:assert/strict";
import test from "node:test";
import { aggregateActivitySnapshots, buildActivitySnapshot } from "../activity-model.mjs";
import {
    applyRosterError,
    discoverCurrentRepositoryActivity,
    GitHubGlobalActivity,
    normalizeRegistry,
    refreshPolicy,
    repositoryRefreshDue,
    snapshotCrossedDayBoundary,
} from "../global-activity.mjs";

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

const teamMarkdown = (name, role) => `
# Squad Team

## Members

| Name | Role | Charter | Status |
| --- | --- | --- | --- |
| **${name}** | ${role} | \`.squad/agents/${name.toLowerCase()}.md\` | Active |
`;

function remoteActivityRunJson({ rosterByOid = {}, issues = [] } = {}) {
    const blobCalls = [];
    const runJson = async (args) => {
        if (args[0] === "api") {
            const oid = args[1].split("/").at(-1);
            blobCalls.push(oid);
            const configured = rosterByOid[oid];
            const roster = Array.isArray(configured) ? configured.shift() : configured;
            if (roster instanceof Error) throw roster;
            return {
                encoding: "base64",
                content: Buffer.from(roster || "").toString("base64"),
            };
        }
        if (args[0] === "repo") return repository("octodemo/backend");
        if (args[0] === "issue") return issues;
        return [];
    };
    return { blobCalls, runJson };
}

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

test("aggregation exposes attempted and fully successful refresh timestamps", () => {
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57)],
    });
    const aggregate = aggregateActivitySnapshots({
        snapshots: [snapshot],
        fetchedAt: "2026-09-20T14:00:00Z",
        repositories: [
            {
                nameWithOwner: "octodemo/frontend",
                included: true,
                lastAttemptedRefresh: "2026-09-20T14:00:00Z",
                lastSuccessfulRefresh: "2026-09-20T13:00:00Z",
            },
            {
                nameWithOwner: "octodemo/backend",
                included: true,
                lastAttemptedRefresh: "2026-09-20T13:30:00Z",
                lastSuccessfulRefresh: "2026-09-20T12:00:00Z",
            },
        ],
    });
    assert.equal(aggregate.lastAttemptedRefresh, "2026-09-20T14:00:00.000Z");
    assert.equal(aggregate.lastSuccessfulRefresh, "2026-09-20T12:00:00.000Z");
});

test("aggregation propagates a repository refresh failure with a retained fresh snapshot", () => {
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57)],
    });
    const aggregate = aggregateActivitySnapshots({
        snapshots: [snapshot],
        repositories: [{
            nameWithOwner: "octodemo/frontend",
            included: true,
            partial: true,
            stale: true,
            error: "refresh crashed",
            lastAttemptedRefresh: "2026-09-20T13:00:00Z",
            lastSuccessfulRefresh: "2026-09-20T12:00:00Z",
        }],
    });
    assert.equal(aggregate.partial, true);
    assert.equal(aggregate.stale, true);
    assert.deepEqual(aggregate.errors, [{
        source: "repository refresh",
        repository: "octodemo/frontend",
        message: "refresh crashed",
    }]);
    assert.equal(aggregate.lastSuccessfulRefresh, "2026-09-20T12:00:00.000Z");
});

test("aggregation retains a new total refresh failure after a partial snapshot", () => {
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57)],
        errors: [{ source: "pull requests", message: "temporary PR failure" }],
        sourceState: {
            issues: { data: [issue("octodemo/frontend", 57)], status: "fresh" },
            pullRequests: {
                data: [],
                status: "stale",
                error: "temporary PR failure",
            },
            workflowRuns: { data: [], status: "fresh" },
        },
    });
    const aggregate = aggregateActivitySnapshots({
        snapshots: [snapshot],
        repositories: [{
            nameWithOwner: "octodemo/frontend",
            included: true,
            partial: true,
            stale: true,
            error: "GitHub CLI exited before completing the repository refresh",
        }],
    });

    assert.deepEqual(aggregate.errors, [
        {
            source: "pull requests",
            repository: "octodemo/frontend",
            message: "temporary PR failure",
        },
        {
            source: "repository refresh",
            repository: "octodemo/frontend",
            message: "GitHub CLI exited before completing the repository refresh",
        },
    ]);
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
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/demo"),
        fetchedAt: "2026-09-20T12:00:00Z",
    });
    const registry = normalizeRegistry({
        viewer: "octocat",
        repositories: [{ nameWithOwner: "octodemo/demo", included: false }],
        snapshots: { "octodemo/demo": snapshot },
        restRateLimit: { remaining: 4321, reset: 1790028000 },
        discoverySignals: {
            "OCTODEMO/DEMO": {
                detected: true,
                checkedAt: "2026-09-20T12:00:00Z",
                labels: ["Squad:Frontend"],
            },
        },
    });
    assert.equal(registry.version, 2);
    assert.equal(registry.repositories[0].included, false);
    assert.deepEqual(registry.snapshots["octodemo/demo"].goals, []);
    assert.equal(registry.restRateLimit.remaining, 4321);
    assert.equal(registry.discoverySignals["octodemo/demo"].detected, true);
    assert.deepEqual(registry.lifecycleHistory, { version: 1, repositories: {} });
});

test("persists observed lifecycle transitions across registry restart", async () => {
    const nameWithOwner = "octodemo/frontend";
    const baseline = buildActivitySnapshot({
        repository: repository(nameWithOwner),
        issues: [issue(nameWithOwner, 57)],
        fetchedAt: "2026-09-21T12:00:00Z",
    });

    const registry = {
        discoveredAt: new Date().toISOString(),
        repositories: [{
            ...repository(nameWithOwner),
            owner: "octodemo",
            included: true,
            squadDetected: true,
        }],
    };
    const first = new GitHubGlobalActivity({
        cwd: "/repo",
        registry,
        runJson: async () => {
            throw new Error("No GitHub request expected.");
        },
    });
    const initial = await first.refresh({
        currentRepository: nameWithOwner,
        currentSnapshot: baseline,
    });
    assert.deepEqual(initial.goals[0].lifecycleHistory.transitions, []);
    assert.equal(
        initial.goals[0].lifecycleHistory.firstObservedAt,
        "2026-09-21T12:00:00.000Z",
    );

    const afterRestart = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: JSON.parse(JSON.stringify(first.registry)),
        runJson: async () => {
            throw new Error("No GitHub request expected.");
        },
    });
    const completed = buildActivitySnapshot({
        repository: repository(nameWithOwner),
        issues: [issue(nameWithOwner, 57, "", "CLOSED")],
        fetchedAt: "2026-09-21T12:05:00Z",
    });
    const refreshed = await afterRestart.refresh({
        currentRepository: nameWithOwner,
        currentSnapshot: completed,
    });
    assert.deepEqual(
        refreshed.goals[0].lifecycleHistory.transitions.map((transition) => ({
            from: transition.from,
            to: transition.to,
            observedAt: transition.observedAt,
        })),
        [{
            from: "queued",
            to: "completed",
            observedAt: "2026-09-21T12:05:00.000Z",
        }],
    );
    assert.equal(
        afterRestart.registry.snapshots[nameWithOwner].goals[0]
            .lifecycleHistory.transitions.length,
        1,
    );
});

test("records dependency-driven aggregate phase changes with dependency freshness", async () => {
    const frontendName = "octodemo/frontend";
    const backendName = "octodemo/backend";
    const frontend = buildActivitySnapshot({
        repository: repository(frontendName),
        issues: [issue(frontendName, 57, `Blocked by:\n- ${backendName}#41`)],
        fetchedAt: "2026-09-21T12:00:00Z",
    });
    const backendBlocked = buildActivitySnapshot({
        repository: repository(backendName),
        issues: [issue(backendName, 41)],
        fetchedAt: "2026-09-21T12:00:00Z",
    });
    const registry = {
        discoveredAt: new Date().toISOString(),
        repositories: [
            {
                ...repository(frontendName),
                owner: "octodemo",
                included: true,
                squadDetected: true,
            },
            {
                ...repository(backendName),
                owner: "octodemo",
                included: true,
                squadDetected: true,
            },
        ],
        snapshots: {
            [frontendName]: frontend,
            [backendName]: backendBlocked,
        },
    };
    const baseline = new GitHubGlobalActivity({
        cwd: "/repo",
        registry,
        runJson: async () => {
            throw new Error("No GitHub request expected.");
        },
    });
    await baseline.refresh({
        currentRepository: frontendName,
        currentSnapshot: frontend,
    });

    const restarted = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: JSON.parse(JSON.stringify(baseline.registry)),
        runJson: async () => {
            throw new Error("No GitHub request expected.");
        },
    });
    const backendCompleted = buildActivitySnapshot({
        repository: repository(backendName),
        issues: [issue(backendName, 41, "", "CLOSED")],
        fetchedAt: "2026-09-21T12:05:00Z",
    });
    const aggregate = await restarted.refresh({
        currentRepository: backendName,
        currentSnapshot: backendCompleted,
    });
    const frontendGoal = aggregate.goals.find((goal) => goal.id === `${frontendName}#57`);
    assert.equal(frontendGoal.phase, "queued");
    assert.equal(frontendGoal.lifecycleHistory.transitions.length, 1);
    assert.equal(frontendGoal.lifecycleHistory.transitions[0].from, "blocked");
    assert.equal(frontendGoal.lifecycleHistory.transitions[0].to, "queued");
    assert.equal(frontendGoal.lifecycleHistory.transitions[0].freshness.status, "partial");
    assert.equal(
        frontendGoal.lifecycleHistory.transitions[0].freshness.sources[
            `dependency:${backendName}:issues`
        ],
        "fresh",
    );
});

test("dependency observation does not contaminate raw repository snapshots across recovery", async () => {
    const frontendName = "octodemo/frontend";
    const backendName = "octodemo/backend";
    const frontend = buildActivitySnapshot({
        repository: repository(frontendName),
        issues: [issue(frontendName, 57, `Blocked by:\n- ${backendName}#41`)],
        fetchedAt: "2026-09-21T12:00:00Z",
    });
    const backendOpen = buildActivitySnapshot({
        repository: repository(backendName),
        issues: [issue(backendName, 41)],
        fetchedAt: "2026-09-21T12:00:00Z",
    });
    const registry = {
        discoveredAt: new Date().toISOString(),
        repositories: [
            {
                ...repository(frontendName),
                owner: "octodemo",
                included: true,
                squadDetected: true,
            },
            {
                ...repository(backendName),
                owner: "octodemo",
                included: true,
                squadDetected: true,
            },
        ],
        snapshots: {
            [frontendName]: frontend,
            [backendName]: backendOpen,
        },
    };
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry,
        runJson: async () => {
            throw new Error("No GitHub request expected.");
        },
    });
    await global.refresh({
        currentRepository: frontendName,
        currentSnapshot: frontend,
    });
    global.registry.repositories.find(
        (candidate) => candidate.nameWithOwner === frontendName,
    ).lastAttemptedRefresh = new Date().toISOString();

    const backendPartialClosed = buildActivitySnapshot({
        repository: repository(backendName),
        fetchedAt: "2026-09-21T12:01:00Z",
        sourceState: {
            issues: {
                data: [issue(backendName, 41, "", "CLOSED")],
                fetchedAt: "2026-09-21T12:01:00Z",
                status: "fresh",
            },
            pullRequests: {
                data: [],
                fetchedAt: "2026-09-21T12:00:00Z",
                status: "stale",
                error: "temporary failure",
            },
            workflowRuns: {
                data: [],
                fetchedAt: "2026-09-21T12:01:00Z",
                status: "fresh",
            },
        },
        errors: [{ source: "pull requests", message: "temporary failure" }],
    });
    const partial = await global.refresh({
        currentRepository: backendName,
        currentSnapshot: backendPartialClosed,
    });
    const partialFrontend = partial.goals.find((goal) => goal.id === `${frontendName}#57`);
    assert.equal(partialFrontend.phase, "queued");
    assert.equal(partialFrontend.lifecycleHistory.transitions.at(-1).freshness.status, "partial");
    assert.equal(global.registry.snapshots[frontendName].stale, false);
    assert.deepEqual(global.registry.snapshots[frontendName].errors, []);
    assert.equal(
        Object.keys(global.registry.snapshots[frontendName].sourceState)
            .some((source) => source.startsWith("dependency:")),
        false,
    );

    const backendRecoveredOpen = buildActivitySnapshot({
        repository: repository(backendName),
        issues: [issue(backendName, 41)],
        fetchedAt: "2026-09-21T12:02:00Z",
    });
    const recovered = await global.refresh({
        currentRepository: backendName,
        currentSnapshot: backendRecoveredOpen,
    });
    const recoveredFrontend = recovered.goals.find((goal) => goal.id === `${frontendName}#57`);
    assert.equal(recoveredFrontend.phase, "blocked");
    assert.equal(recoveredFrontend.lifecycleHistory.transitions.at(-1).from, "queued");
    assert.equal(recoveredFrontend.lifecycleHistory.transitions.at(-1).to, "blocked");
    assert.equal(recovered.stale, false);
    assert.deepEqual(recovered.errors, []);
    assert.deepEqual(global.registry.snapshots[frontendName].errors, []);
});

test("registry normalization discards malformed and unsupported snapshots", () => {
    const registry = normalizeRegistry({
        snapshots: {
            unsupported: { schemaVersion: 99, fetchedAt: "2026-09-20T12:00:00Z", goals: [{ id: "bad" }] },
            malformed: { schemaVersion: 2, fetchedAt: "not-a-date", goals: [{ id: "bad" }] },
        },
    });

    assert.deepEqual(registry.snapshots, {});
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
                                squadTeam: { oid: "team-abc" },
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
    assert.equal(global.registry.repositories[0].squadTeamOid, "team-abc");
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
            if (args[1] === "rate_limit") {
                return { resources: { core: { remaining: 5000, reset: 1790028000 } } };
            }
            if (args[1] === "repos/octodemo/prefix-only/labels") {
                return ["bug", "squad:frontend"];
            }
            if (args[1] === "repos/octodemo/prefix-only/issues") {
                return 1;
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
    const labelCall = calls.find((args) => args[1] === "repos/octodemo/prefix-only/labels");
    assert.ok(labelCall.includes("per_page=100"));
    assert.equal(labelCall.includes("--paginate"), false);
    const issueCall = calls.find((args) => args[1] === "repos/octodemo/prefix-only/issues");
    assert.ok(issueCall.includes("labels=squad:frontend"));
    assert.ok(issueCall.includes("per_page=1"));
    assert.equal(global.registry.restRateLimit.remaining, 4998);
    assert.equal(calls.some((args) => args[0] === "search"), false);
});

test("multiple prefixed labels discover a repository only once", async () => {
    const issueCalls = [];
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
            if (args[1] === "rate_limit") {
                return { resources: { core: { remaining: 5000, reset: 1790028000 } } };
            }
            if (args[1] === "repos/octodemo/multiple-prefixes/labels") {
                return ["squad:frontend", "squad:backend", "SQUAD:FRONTEND", "squad:unused"];
            }
            if (args[1] === "repos/octodemo/multiple-prefixes/issues") {
                issueCalls.push(args);
                return args.includes("labels=squad:backend") ? 1 : 0;
            }
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    await global.discoverRepositories({ force: true });

    assert.equal(global.registry.repositories.length, 1);
    assert.equal(global.registry.repositories[0].nameWithOwner, "octodemo/multiple-prefixes");
    assert.equal(issueCalls.length, 2);
    assert.equal(issueCalls.some((args) => args.includes("labels=squad:unused")), false);
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
            if (args[1] === "rate_limit") {
                return { resources: { core: { remaining: 5000, reset: 1790028000 } } };
            }
            if (args[1] === "repos/OCTODEMO/CASE-TEST/labels") return ["Squad:Frontend"];
            if (args[1] === "repos/OCTODEMO/CASE-TEST/issues") return 1;
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    await global.discoverRepositories({ force: true });

    assert.equal(global.registry.repositories.length, 1);
    assert.equal(global.registry.repositories[0].nameWithOwner.toLowerCase(), "octodemo/case-test");
    assert.equal(global.registry.repositories[0].squadDetected, true);
});

test("fresh prefix discovery cache avoids REST probes", async () => {
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoverySignals: {
                "octodemo/cached": {
                    detected: true,
                    checkedAt: new Date().toISOString(),
                    labels: ["squad:frontend"],
                },
            },
        },
        runJson: async (args) => {
            calls.push(args);
            if (args[1] === "graphql") {
                return {
                    data: {
                        viewer: {
                            login: "octocat",
                            repositories: {
                                nodes: [{
                                    ...repository("octodemo/cached"),
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
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    await global.discoverRepositories();

    assert.deepEqual(
        global.registry.repositories.map((candidate) => candidate.nameWithOwner),
        ["octodemo/cached"],
    );
    assert.equal(calls.length, 1);
});

test("low REST budget preserves a prior positive prefix signal", async () => {
    const checkedAt = "2026-09-20T12:00:00Z";
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoverySignals: {
                "octodemo/stale-positive": {
                    detected: true,
                    checkedAt,
                    labels: ["squad:frontend"],
                },
            },
        },
        runJson: async (args) => {
            calls.push(args);
            if (args[1] === "graphql") {
                return {
                    data: {
                        viewer: {
                            login: "octocat",
                            repositories: {
                                nodes: [{
                                    ...repository("octodemo/stale-positive"),
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
            if (args[1] === "rate_limit") {
                return { resources: { core: { remaining: 100, reset: 1790028000 } } };
            }
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    await global.discoverRepositories({ force: true });

    assert.equal(global.registry.repositories[0].nameWithOwner, "octodemo/stale-positive");
    assert.equal(global.registry.discoverySignals["octodemo/stale-positive"].checkedAt, checkedAt);
    assert.match(
        global.registry.discoverySignals["octodemo/stale-positive"].error,
        /rate-limit budget is too low/,
    );
    assert.match(global.registry.discoveryError, /rate-limit budget is too low/);
    assert.equal(calls.some((args) => /\/(?:labels|issues)$/.test(args[1] || "")), false);
});

test("failed prefix refresh retains the prior positive cache", async () => {
    const checkedAt = "2026-09-20T12:00:00Z";
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoverySignals: {
                "octodemo/transient": {
                    detected: true,
                    checkedAt,
                    labels: ["squad:frontend"],
                },
            },
        },
        runJson: async (args) => {
            if (args[1] === "graphql") {
                return {
                    data: {
                        viewer: {
                            login: "octocat",
                            repositories: {
                                nodes: [{
                                    ...repository("octodemo/transient"),
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
            if (args[1] === "rate_limit") {
                return { resources: { core: { remaining: 5000, reset: 1790028000 } } };
            }
            if (args[1] === "repos/octodemo/transient/labels") {
                throw new Error("temporary labels failure");
            }
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    await global.discoverRepositories({ force: true });

    assert.equal(global.registry.repositories[0].nameWithOwner, "octodemo/transient");
    assert.equal(global.registry.discoverySignals["octodemo/transient"].checkedAt, checkedAt);
    assert.match(
        global.registry.discoverySignals["octodemo/transient"].error,
        /temporary labels failure/,
    );
    assert.match(global.registry.discoveryError, /temporary labels failure/);
});

test("failed prefix refresh preserves a repository discovered before signal caching", async () => {
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            repositories: [{
                ...repository("octodemo/previously-discovered"),
                included: true,
                squadDetected: true,
            }],
        },
        runJson: async (args) => {
            if (args[1] === "graphql") {
                return {
                    data: {
                        viewer: {
                            login: "octocat",
                            repositories: {
                                nodes: [{
                                    ...repository("octodemo/previously-discovered"),
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
            if (args[1] === "rate_limit") {
                return { resources: { core: { remaining: 5000, reset: 1790028000 } } };
            }
            if (args[1] === "repos/octodemo/previously-discovered/labels") {
                throw new Error("temporary labels failure");
            }
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    await global.discoverRepositories({ force: true });

    assert.equal(
        global.registry.repositories[0].nameWithOwner,
        "octodemo/previously-discovered",
    );
    assert.equal(
        global.registry.discoverySignals["octodemo/previously-discovered"].detected,
        true,
    );
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

test("cache validity ends exactly at UTC midnight when the last attempt predates the boundary", () => {
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        fetchedAt: "2026-09-21T23:59:59Z",
    });

    assert.equal(snapshotCrossedDayBoundary(
        snapshot,
        "2026-09-21T23:59:59.999Z",
        Date.parse("2026-09-21T23:59:59.999Z"),
    ), false);
    assert.equal(snapshotCrossedDayBoundary(
        snapshot,
        "2026-09-21T23:59:59.999Z",
        Date.parse("2026-09-22T00:00:00.000Z"),
    ), true);
});

test("failed post-midnight refreshes use the normal active TTL before retrying", () => {
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57)],
        fetchedAt: "2026-09-22T00:00:05Z",
        sourceState: {
            issues: {
                data: [issue("octodemo/frontend", 57)],
                fetchedAt: "2026-09-21T23:59:50Z",
                status: "stale",
            },
            pullRequests: { data: [], status: "fresh" },
            workflowRuns: { data: [], status: "fresh" },
        },
    });
    const cachedRepository = {
        ...repository("octodemo/frontend"),
        lastAttemptedRefresh: "2026-09-22T00:00:05Z",
    };

    assert.equal(snapshot.dayBoundary.snapshotDay, "2026-09-21");
    assert.equal(repositoryRefreshDue(
        cachedRepository,
        snapshot,
        "octodemo/other",
        Date.parse("2026-09-22T00:00:10Z"),
    ), false);
    assert.equal(repositoryRefreshDue(
        cachedRepository,
        snapshot,
        "octodemo/other",
        Date.parse("2026-09-22T00:01:05Z"),
    ), true);
});

test("a future last-attempt timestamp is due after backward wall-clock movement", () => {
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        fetchedAt: "2026-09-22T00:03:00Z",
    });
    const cachedRepository = {
        ...repository("octodemo/frontend"),
        lastAttemptedRefresh: "2026-09-22T00:05:00Z",
    };

    assert.equal(repositoryRefreshDue(
        cachedRepository,
        snapshot,
        "octodemo/other",
        Date.parse("2026-09-22T00:04:00Z"),
    ), true);
});

test("stale roster data crossing midnight retains its prior UTC snapshot day", () => {
    const snapshot = buildActivitySnapshot({
        repository: repository("octodemo/backend"),
        members: [{ id: "frontend", name: "Frontend", role: "Frontend Lead" }],
        issues: [{
            ...issue("octodemo/backend", 41),
            labels: [{ name: "squad" }, { name: "squad:frontend" }],
        }],
        fetchedAt: "2026-09-22T00:00:05Z",
    });

    applyRosterError(snapshot, {
        status: "stale",
        fetchedAt: "2026-09-21T23:59:50Z",
        blobOid: "oid-a",
        observedOid: "oid-b",
        error: "HTTP 403: Resource not accessible",
    });

    assert.equal(snapshot.goals[0].owner.name, "Frontend");
    assert.equal(snapshot.stale, true);
    assert.deepEqual(snapshot.staleSources, ["roster"]);
    assert.equal(snapshot.dayBoundary.snapshotDay, "2026-09-21");
    assert.equal(snapshot.sourceState.roster.fetchedAt, "2026-09-21T23:59:50Z");
});

test("registry migration versions and partitions cached snapshots by UTC day", () => {
    const registry = normalizeRegistry({
        version: 1,
        snapshots: {
            "OCTODEMO/FRONTEND": {
                ...buildActivitySnapshot({
                    repository: repository("octodemo/frontend"),
                    fetchedAt: "2026-09-21T18:00:00Z",
                }),
                schemaVersion: 2,
                dayBoundary: undefined,
            },
        },
    });

    assert.equal(registry.version, 2);
    assert.equal(registry.snapshots["octodemo/frontend"].schemaVersion, 3);
    assert.equal(
        registry.snapshots["octodemo/frontend"].dayBoundary.cacheKey,
        "day-boundary-v1:utc:2026-09-21",
    );
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

test("excluded cached activity preserves refresh timestamps and resumes after re-enabling", async () => {
    const nameWithOwner = "octodemo/frontend";
    const cached = buildActivitySnapshot({
        repository: repository(nameWithOwner),
        issues: [issue(nameWithOwner, 57)],
    });
    cached.fetchedAt = "2026-09-21T12:00:00Z";
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            repositories: [
                {
                    ...repository(nameWithOwner),
                    owner: "octodemo",
                    included: false,
                    lastAttemptedRefresh: "2026-09-21T14:00:00Z",
                    lastSuccessfulRefresh: "2026-09-21T13:00:00Z",
                },
            ],
            snapshots: { [nameWithOwner]: cached },
        },
        runJson: async (args) => {
            calls.push(args);
            if (args[0] === "repo") return repository(nameWithOwner);
            if (args[0] === "issue") return [issue(nameWithOwner, 58)];
            return [];
        },
    });

    const excludedActivity = await discoverCurrentRepositoryActivity({
        runJson: global.runJson,
        cwd: global.cwd,
        registry: global.registry,
        currentRepository: nameWithOwner,
        previous: cached,
    });
    const excluded = await global.refresh({
        currentRepository: nameWithOwner,
        currentSnapshot: excludedActivity.snapshot,
        currentSnapshotRefreshed: excludedActivity.refreshed,
    });

    assert.equal(excludedActivity.snapshot, cached);
    assert.equal(excludedActivity.refreshed, false);
    assert.equal(calls.length, 0);
    assert.equal(excluded.goals.length, 0);
    assert.equal(excluded.repositories.length, 1);
    assert.equal(excluded.repositories[0].included, false);
    assert.equal(global.registry.snapshots[nameWithOwner], cached);
    assert.equal(global.registry.repositories[0].lastAttemptedRefresh, "2026-09-21T14:00:00Z");
    assert.equal(global.registry.repositories[0].lastSuccessfulRefresh, "2026-09-21T13:00:00Z");

    assert.equal(global.setIncluded(nameWithOwner, true), true);
    const refreshedActivity = await discoverCurrentRepositoryActivity({
        runJson: global.runJson,
        cwd: global.cwd,
        registry: global.registry,
        currentRepository: nameWithOwner,
        previous: cached,
    });
    const refreshed = await global.refresh({
        currentRepository: nameWithOwner,
        currentSnapshot: refreshedActivity.snapshot,
        currentSnapshotRefreshed: refreshedActivity.refreshed,
    });

    assert.equal(refreshedActivity.refreshed, true);
    assert.deepEqual(calls.map((args) => args[0]), ["repo", "issue", "pr", "run"]);
    assert.equal(refreshed.goals.length, 1);
    assert.equal(refreshed.goals[0].id, `${nameWithOwner}#58`);
    assert.equal(refreshed.repositories[0].included, true);
});

test("current repository identity is resolved before excluded activity is refreshed", async () => {
    const nameWithOwner = "octodemo/frontend";
    const cached = buildActivitySnapshot({
        repository: repository(nameWithOwner),
        issues: [issue(nameWithOwner, 57)],
    });
    const calls = [];
    const activity = await discoverCurrentRepositoryActivity({
        cwd: "/repo",
        registry: {
            repositories: [
                { ...repository(nameWithOwner), owner: "octodemo", included: false },
            ],
            snapshots: { [nameWithOwner]: cached },
        },
        currentRepository: "",
        runJson: async (args) => {
            calls.push(args);
            if (args[0] === "repo") return repository(nameWithOwner);
            throw new Error(`Unexpected activity call: ${args[0]}`);
        },
    });

    assert.equal(activity.snapshot, cached);
    assert.equal(activity.refreshed, false);
    assert.deepEqual(calls.map((args) => args[0]), ["repo"]);
});

test("forced discovery omission preserves the current repository exclusion", async () => {
    const nameWithOwner = "octodemo/frontend";
    const cached = buildActivitySnapshot({
        repository: repository(nameWithOwner),
        issues: [issue(nameWithOwner, 57)],
    });
    const remoteIssue = {
        ...issue(nameWithOwner, 58),
        labels: [{ name: "squad" }, { name: "squad:frontend" }],
    };
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            repositories: [
                {
                    ...repository(nameWithOwner),
                    owner: "octodemo",
                    included: false,
                    squadDetected: true,
                    squadTeamOid: "oid-a",
                },
            ],
            snapshots: { [nameWithOwner]: cached },
            rosters: {
                [nameWithOwner]: {
                    blobOid: "oid-a",
                    observedOid: "oid-a",
                    members: [{
                        id: "frontend",
                        name: "Frontend",
                        role: "Frontend Lead",
                        lead: true,
                    }],
                    status: "fresh",
                    fetchedAt: "2026-09-21T12:00:00Z",
                    error: "",
                },
            },
        },
        runJson: async (args) => {
            calls.push(args);
            if (args[0] === "api" && args[1] === "graphql") {
                return {
                    data: {
                        viewer: {
                            login: "octocat",
                            repositories: {
                                nodes: [],
                                pageInfo: { hasNextPage: false, endCursor: null },
                            },
                        },
                        rateLimit: { remaining: 4999, resetAt: "2026-09-21T22:00:00Z" },
                    },
                };
            }
            if (args[0] === "repo") return repository(nameWithOwner);
            if (args[0] === "issue") return [remoteIssue];
            if (args[0] === "pr" || args[0] === "run") return [];
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    const aggregate = await global.refresh({
        currentRepository: nameWithOwner,
        currentSnapshot: cached,
        forceDiscovery: true,
        forceAll: true,
    });
    const excludedActivity = await discoverCurrentRepositoryActivity({
        runJson: global.runJson,
        cwd: global.cwd,
        registry: global.registry,
        currentRepository: nameWithOwner,
        previous: cached,
    });

    assert.deepEqual(calls.map((args) => args[0]), ["api"]);
    assert.equal(global.registry.repositories.length, 1);
    assert.equal(global.registry.repositories[0].included, false);
    assert.equal(global.registry.repositories[0].squadTeamOid, "oid-a");
    assert.equal(global.registry.snapshots[nameWithOwner], cached);
    assert.equal(excludedActivity.snapshot, cached);
    assert.equal(excludedActivity.refreshed, false);
    assert.equal(aggregate.goals.length, 0);

    assert.equal(global.setIncluded(nameWithOwner, true), true);
    const refreshed = await global.refresh({
        currentRepository: "octodemo/other",
        forceAll: true,
    });

    assert.deepEqual(calls.map((args) => args[0]), ["api", "repo", "issue", "pr", "run"]);
    assert.equal(global.registry.rosters[nameWithOwner].status, "fresh");
    assert.equal(global.registry.rosters[nameWithOwner].members.length, 1);
    assert.equal(refreshed.goals[0].owner.name, "Frontend");
});

test("combined rate-limit guard reports the later limiting reset", async () => {
    const current = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57)],
    });
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            rateLimit: {
                remaining: 50,
                resetAt: "2099-09-21T13:00:00.000Z",
            },
            restRateLimit: {
                remaining: 100,
                resetAt: "2099-09-21T14:00:00.000Z",
            },
            repositories: [
                { ...repository("octodemo/frontend"), owner: "octodemo", included: true },
                { ...repository("octodemo/backend"), owner: "octodemo", included: true },
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

    assert.equal(calls.length, 0);
    assert.match(aggregate.errors[0].message, /2099-09-21T14:00:00.000Z/);
});

test("loads and reuses a non-current repository roster for squad ownership", async () => {
    const remoteIssue = {
        ...issue("octodemo/backend", 41),
        labels: [{ name: "squad" }, { name: "squad:frontend" }],
    };
    const { blobCalls, runJson } = remoteActivityRunJson({
        rosterByOid: { "oid-a": teamMarkdown("Frontend", "Frontend Lead") },
        issues: [remoteIssue],
    });
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            repositories: [{
                ...repository("octodemo/backend"),
                owner: "octodemo",
                included: true,
                squadDetected: true,
                squadTeamOid: "oid-a",
            }],
        },
        runJson,
    });

    const first = await global.refresh({ currentRepository: "octodemo/frontend", forceAll: true });
    const second = await global.refresh({ currentRepository: "octodemo/frontend", forceAll: true });

    assert.equal(first.goals[0].owner.name, "Frontend");
    assert.equal(first.goals[0].owner.source, "squad-label");
    assert.equal(second.goals[0].owner.name, "Frontend");
    assert.deepEqual(blobCalls, ["oid-a"]);
});

test("reloads a remote roster when its discovered blob OID changes", async () => {
    const remoteIssue = {
        ...issue("octodemo/backend", 41),
        labels: [{ name: "squad" }, { name: "squad:backend" }],
    };
    const { blobCalls, runJson } = remoteActivityRunJson({
        rosterByOid: {
            "oid-a": teamMarkdown("Frontend", "Frontend Lead"),
            "oid-b": teamMarkdown("Backend", "Backend Lead"),
        },
        issues: [remoteIssue],
    });
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            repositories: [{
                ...repository("octodemo/backend"),
                owner: "octodemo",
                included: true,
                squadDetected: true,
                squadTeamOid: "oid-a",
            }],
        },
        runJson,
    });

    await global.refresh({ forceAll: true });
    global.registry.repositories[0].squadTeamOid = "oid-b";
    const refreshed = await global.refresh({ forceAll: true });

    assert.deepEqual(blobCalls, ["oid-a", "oid-b"]);
    assert.equal(refreshed.goals[0].owner.name, "Backend");
});

test("surfaces a malformed remote roster and keeps Unknown fallback", async () => {
    const { runJson } = remoteActivityRunJson({
        rosterByOid: { malformed: "# No members table" },
        issues: [issue("octodemo/backend", 41)],
    });
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            repositories: [{
                ...repository("octodemo/backend"),
                included: true,
                squadDetected: true,
                squadTeamOid: "malformed",
            }],
        },
        runJson,
    });

    const aggregate = await global.refresh({ forceAll: true });

    assert.equal(aggregate.goals[0].owner.name, "Unknown");
    assert.equal(aggregate.partial, true);
    assert.match(aggregate.errors[0].message, /valid Members table/);
});

test("surfaces a missing remote roster without downloading and uses assignee fallback", async () => {
    const calls = [];
    const remoteIssue = {
        ...issue("octodemo/backend", 41),
        assignees: [{ login: "octocat" }],
    };
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            repositories: [{
                ...repository("octodemo/backend"),
                included: true,
                squadDetected: true,
                squadTeamOid: "",
            }],
        },
        runJson: async (args) => {
            calls.push(args);
            if (args[0] === "repo") return repository("octodemo/backend");
            if (args[0] === "issue") return [remoteIssue];
            return [];
        },
    });

    const aggregate = await global.refresh({ forceAll: true });

    assert.equal(aggregate.goals[0].owner.name, "octocat");
    assert.equal(aggregate.goals[0].owner.source, "assignee");
    assert.equal(calls.filter((args) => args[0] === "api").length, 0);
    assert.match(aggregate.errors[0].message, /does not contain .squad\/team.md/);
});

test("preserves a cached valid roster and retries a changed blob after a source error", async () => {
    const remoteIssue = {
        ...issue("octodemo/backend", 41),
        labels: [{ name: "squad" }, { name: "squad:frontend" }],
    };
    const { blobCalls, runJson } = remoteActivityRunJson({
        rosterByOid: {
            "oid-b": [
                new Error("HTTP 403: Resource not accessible"),
                teamMarkdown("Frontend", "Frontend Lead"),
            ],
        },
        issues: [remoteIssue],
    });
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            repositories: [{
                ...repository("octodemo/backend"),
                included: true,
                squadDetected: true,
                squadTeamOid: "oid-b",
            }],
            rosters: {
                "octodemo/backend": {
                    blobOid: "oid-a",
                    observedOid: "oid-a",
                    members: [{
                        id: "frontend",
                        name: "Frontend",
                        role: "Frontend Lead",
                        lead: true,
                    }],
                    status: "fresh",
                    fetchedAt: "2026-09-20T12:00:00Z",
                    error: "",
                },
            },
        },
        runJson,
    });

    const first = await global.refresh({ forceAll: true });
    const second = await global.refresh({ forceAll: true });

    assert.equal(first.goals[0].owner.name, "Frontend");
    assert.equal(first.partial, true);
    assert.equal(first.stale, true);
    assert.match(first.errors[0].message, /403/);
    assert.equal(second.goals[0].owner.name, "Frontend");
    assert.equal(second.partial, false);
    assert.equal(second.stale, false);
    assert.deepEqual(blobCalls, ["oid-b", "oid-b"]);
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
    assert.equal(global.registry.repositories[0].partial, true);
    assert.equal(global.registry.repositories[0].stale, true);
    assert.ok(global.registry.repositories[0].lastAttemptedRefresh);
    assert.equal(partial.lastSuccessfulRefresh, "2026-09-20T12:00:00.000Z");
    assert.ok(partial.lastAttemptedRefresh);
    assert.equal(partial.errors.length, 1);
    assert.match(global.registry.repositories[0].error, /pull requests: temporary PR failure/);

    failPullRequests = false;
    const recovered = await global.refresh({ forceAll: true });
    assert.equal(recovered.goals[0].phase, "queued");
    assert.notEqual(global.registry.repositories[0].lastSuccessfulRefresh, successfulAt);
    assert.equal(global.registry.repositories[0].partial, false);
    assert.equal(global.registry.repositories[0].stale, false);
    assert.equal(global.registry.repositories[0].error, "");
    assert.equal(recovered.partial, false);
    assert.equal(recovered.stale, false);
});

test("stale current snapshots never advance successful refresh time and later recovery clears state", async () => {
    const successfulAt = "2026-09-20T12:00:00Z";
    const stale = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57)],
        fetchedAt: "2026-09-20T13:00:00Z",
        sourceState: {
            issues: {
                data: [issue("octodemo/frontend", 57)],
                fetchedAt: successfulAt,
                status: "stale",
                error: "",
            },
            pullRequests: { data: [], status: "fresh" },
            workflowRuns: { data: [], status: "fresh" },
        },
    });
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
            snapshots: {},
        },
        runJson: async () => [],
    });

    const partial = await global.refresh({
        currentRepository: "octodemo/frontend",
        currentSnapshot: stale,
    });
    assert.equal(global.registry.repositories[0].lastSuccessfulRefresh, successfulAt);
    assert.equal(global.registry.repositories[0].lastAttemptedRefresh, "2026-09-20T13:00:00.000Z");
    assert.equal(partial.partial, true);
    assert.equal(partial.stale, true);

    const recovered = buildActivitySnapshot({
        repository: repository("octodemo/frontend"),
        issues: [issue("octodemo/frontend", 57)],
        fetchedAt: "2026-09-20T14:00:00Z",
    });
    const fresh = await global.refresh({
        currentRepository: "octodemo/frontend",
        currentSnapshot: recovered,
    });
    assert.equal(global.registry.repositories[0].lastSuccessfulRefresh, "2026-09-20T14:00:00.000Z");
    assert.equal(global.registry.repositories[0].partial, false);
    assert.equal(global.registry.repositories[0].stale, false);
    assert.equal(fresh.partial, false);
    assert.equal(fresh.stale, false);
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
            if (args[0] === "api") return { total_count: 0, jobs: [] };
            return [];
        },
    });

    const recovered = await global.refresh({ forceAll: true });
    assert.ok(calls.some((args) => args[0] === "run"));
    assert.equal(recovered.partial, false);
    assert.equal(recovered.stale, false);
    assert.notEqual(global.registry.repositories[0].lastSuccessfulRefresh, successfulAt);
});

test("repository refresh shares the observed REST budget and never crosses the reserve", async () => {
    const previous = buildActivitySnapshot({
        repository: repository("octodemo/backend"),
        issues: [issue("octodemo/backend", 57)],
        workflowRuns: [
            {
                databaseId: 79,
                workflowName: "Squad Implement Worker",
                displayTitle: "Implement #57",
                status: "completed",
                conclusion: "success",
                headBranch: "squad/implement-57-dashboard",
                updatedAt: "2026-09-20T13:00:00Z",
            },
            {
                databaseId: 78,
                workflowName: "Squad Implement Worker",
                displayTitle: "Implement #57",
                status: "completed",
                conclusion: "failure",
                headBranch: "squad/implement-57-dashboard",
                updatedAt: "2026-09-20T12:00:00Z",
            },
        ],
    });
    const calls = [];
    const global = new GitHubGlobalActivity({
        cwd: "/repo",
        registry: {
            discoveredAt: new Date().toISOString(),
            restRateLimit: {
                remaining: 101,
                resetAt: "2099-09-21T14:00:00.000Z",
            },
            repositories: [{
                ...repository("octodemo/backend"),
                owner: "octodemo",
                included: true,
            }],
            snapshots: { "octodemo/backend": previous },
        },
        runJson: async (args) => {
            calls.push(args);
            if (args[0] === "repo") return repository("octodemo/backend");
            if (args[0] === "issue") return [issue("octodemo/backend", 57)];
            if (args[0] === "pr") return [];
            if (args[0] === "run") return previous.sourceState.workflowRuns.data;
            if (args[0] === "api") return { total_count: 0, jobs: [] };
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        },
    });

    const aggregate = await global.refresh({
        currentRepository: "octodemo/frontend",
        forceAll: true,
    });

    assert.equal(calls.filter((args) => args[0] === "api").length, 1);
    assert.equal(global.registry.restRateLimit.remaining, 100);
    assert.equal(aggregate.partial, true);
    assert.equal(
        global.registry.snapshots["octodemo/backend"].sourceState.workflowJobs.status,
        "partial",
    );
});
