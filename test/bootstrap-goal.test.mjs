import assert from "node:assert/strict";
import test from "node:test";
import {
    aggregateActivitySnapshots,
    buildActivitySnapshot,
    integrateAutomaticBootstrapSnapshot,
} from "../activity-model.mjs";
import { classifyAutomaticBootstrap } from "../bootstrap-classifier.mjs";
import {
    castPullRequest,
    classifyInput,
    researchComment,
    researchIssue,
    workflowRun,
} from "./fixtures/bootstrap-classifier.mjs";

const repository = {
    name: "demo",
    nameWithOwner: "octodemo/demo",
    url: "https://github.com/octodemo/demo",
    defaultBranchRef: { name: "main" },
};

function artifactComment(kind, {
    originIssue = 6,
    schemaVersion = "1",
    phases = [],
    createdAt = "2026-09-21T11:00:00Z",
    bindings = null,
    url = `https://github.com/octodemo/demo/issues/6#issuecomment-${kind}`,
} = {}) {
    const bindingBlock = bindings
        ? `Activation bindings:\n\`\`\`json\n${JSON.stringify(bindings)}\n\`\`\`\n`
        : "";
    return {
        body: `${bindingBlock}Structured data:\n\`\`\`json\n${JSON.stringify({
            squad_artifact: kind,
            schema_version: schemaVersion,
            origin_issue: originIssue,
            phases,
        })}\n\`\`\``,
        createdAt,
        url,
    };
}

function goalIssue(number, title, labels, comments = []) {
    return {
        number,
        title,
        body: number === 6 ? "<!-- squad:bootstrap-opportunities schema=1 -->" : "",
        state: "OPEN",
        url: `https://github.com/octodemo/demo/issues/${number}`,
        labels: labels.map((name) => ({ name })),
        comments,
        createdAt: "2026-09-21T10:00:00Z",
        updatedAt: "2026-09-21T11:00:00Z",
    };
}

function completeBootstrap(overrides = {}) {
    return classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [researchComment()],
        workflowRuns: [workflowRun()],
        ...overrides,
    }));
}

function snapshotWithBootstrap({
    issues,
    pullRequests = [],
    workflowRuns = [],
    bootstrap = completeBootstrap(),
    bootstrapComments = null,
    bootstrapCommentsState = {},
}) {
    const snapshot = buildActivitySnapshot({
        repository,
        issues,
        pullRequests,
        workflowRuns,
        fetchedAt: "2026-09-21T12:00:00Z",
    });
    if (bootstrapComments) {
        snapshot.sourceState.bootstrap = {
            comments: {
                data: bootstrapComments,
                fetchedAt: "2026-09-21T12:00:00Z",
                status: "fresh",
                error: "",
                exhaustive: true,
                truncated: false,
                ...bootstrapCommentsState,
            },
        };
    }
    return integrateAutomaticBootstrapSnapshot({
        ...snapshot,
        bootstrap,
    });
}

test("attaches exact bootstrap evidence without turning the Cast PR or run into delivery work", () => {
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research", { createdAt: "2026-09-21T10:15:00Z" }),
    ]);
    const cast = {
        ...castPullRequest(),
        body: "Closes #6",
        statusCheckRollup: [],
    };
    const run = {
        ...workflowRun(),
        displayTitle: "Squad Bootstrap for #6",
    };
    const snapshot = snapshotWithBootstrap({
        issues: [root],
        pullRequests: [cast],
        workflowRuns: [run],
        bootstrap: completeBootstrap({
            pullRequests: [cast],
            workflowRuns: [run],
        }),
    });
    const goal = snapshot.goals[0];

    assert.equal(goal.id, "octodemo/demo#6");
    assert.equal(goal.phase, "researching");
    assert.equal(goal.bootstrap.status, "complete");
    assert.equal(goal.bootstrap.journeyPhase, "cast-review");
    assert.deepEqual(goal.pullRequests, []);
    assert.deepEqual(goal.workflowRuns, []);
    assert.deepEqual(goal.workItems, []);
    assert.ok(goal.evidence.some((item) =>
        item.kind === "bootstrap-cast" && item.confidence === "observed"));
    assert.ok(goal.evidence.some((item) =>
        item.kind === "bootstrap-workflow" && item.confidence === "observed"));
    assert.ok(goal.evidence.every((item) =>
        item.kind !== "pull-request" && item.kind !== "workflow"));
});

test("preserves ordinary pull request and workflow correlation beside bootstrap evidence", () => {
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research", { createdAt: "2026-09-21T10:15:00Z" }),
    ]);
    const ordinaryPullRequest = {
        number: 44,
        title: "Implement a research follow-up",
        body: "Closes #6",
        state: "OPEN",
        url: "https://github.com/octodemo/demo/pull/44",
        headRefName: "squad/implement-6-follow-up",
        isDraft: false,
    };
    const ordinaryRun = {
        databaseId: 45,
        workflowName: "Squad Implement Worker",
        displayTitle: "Implement #6",
        headBranch: "squad/implement-6-follow-up",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/octodemo/demo/actions/runs/45",
    };
    const snapshot = snapshotWithBootstrap({
        issues: [root],
        pullRequests: [castPullRequest(), ordinaryPullRequest],
        workflowRuns: [workflowRun(), ordinaryRun],
    });
    const goal = snapshot.goals[0];

    assert.deepEqual(goal.pullRequests.map((pullRequest) => pullRequest.number), [44]);
    assert.deepEqual(goal.workflowRuns.map((run) => run.id), [45]);
    assert.equal(goal.phase, "reviewing");
    assert.ok(goal.evidence.some((item) => item.kind === "pull-request"));
    assert.ok(goal.evidence.some((item) => item.kind === "workflow"));
    assert.ok(goal.evidence.some((item) => item.kind === "bootstrap-cast"));
    assert.ok(goal.evidence.some((item) => item.kind === "bootstrap-workflow"));
});

test("preserves malformed Cast lookalikes as ordinary pull request correlation", () => {
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research"),
    ]);
    const lookalike = {
        number: 46,
        title: "Ordinary bootstrap branch work",
        body: "Closes #6",
        state: "OPEN",
        url: "https://github.com/octodemo/demo/pull/46",
        headRefName: "squad/bootstrap-cast",
        baseRefName: "release",
        isDraft: false,
    };
    const snapshot = snapshotWithBootstrap({
        issues: [root],
        pullRequests: [lookalike],
    });
    const goal = snapshot.goals[0];

    assert.deepEqual(goal.pullRequests.map((pullRequest) => pullRequest.number), [46]);
    assert.equal(goal.phase, "reviewing");
    assert.ok(goal.evidence.some((item) =>
        item.kind === "pull-request" && item.url === lookalike.url));
});

test("preserves duplicate exact Cast candidates as ordinary pull request correlation", () => {
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research"),
    ]);
    const duplicateCasts = [
        castPullRequest({ body: "Closes #6" }),
        castPullRequest({
            number: 4,
            body: "Closes #6",
            url: "https://github.com/octodemo/demo/pull/4",
        }),
    ];
    const bootstrap = classifyAutomaticBootstrap(classifyInput({
        pullRequests: duplicateCasts,
        issues: [researchIssue()],
        comments: [researchComment()],
    }));
    const snapshot = snapshotWithBootstrap({
        issues: [root],
        pullRequests: duplicateCasts,
        bootstrap,
    });
    const goal = snapshot.goals[0];

    assert.equal(bootstrap.status, "ambiguous");
    assert.deepEqual(goal.pullRequests.map((pullRequest) => pullRequest.number), [3, 4]);
    assert.equal(goal.phase, "implementing");
    assert.equal(
        goal.evidence.filter((item) => item.kind === "pull-request").length,
        2,
    );
});

test("keeps unsupported and malformed artifacts visible without advancing journey or lifecycle", () => {
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research", { createdAt: "2026-09-21T10:15:00Z" }),
        artifactComment("triage", {
            schemaVersion: "2",
            createdAt: "2026-09-21T11:00:00Z",
        }),
        {
            body: "Structured data:\n```json\n{\"squad_artifact\":\"program\",\n```",
            createdAt: "2026-09-21T11:30:00Z",
            url: "https://github.com/octodemo/demo/issues/6#issuecomment-broken",
        },
    ]);
    const bootstrap = completeBootstrap({
        pullRequests: [castPullRequest({
            state: "MERGED",
            mergedAt: "2026-09-21T10:45:00Z",
        })],
    });

    const snapshot = snapshotWithBootstrap({ issues: [root], bootstrap });
    const goal = snapshot.goals[0];

    assert.equal(goal.phase, "researching");
    assert.equal(goal.bootstrap.journeyPhase, "research");
    assert.equal(goal.artifacts.find((item) => item.kind === "triage").validation, "unsupported");
    assert.equal(goal.artifacts.find((item) => item.kind === "unknown").validation, "malformed");
    assert.ok(goal.evidence.some((item) =>
        item.kind === "artifact" && item.classification === "unsupported"));
    assert.ok(goal.evidence.some((item) =>
        item.kind === "artifact" && item.classification === "malformed"));
});

test("uses exhaustive canonical comment discovery to advance the authoritative issue goal", () => {
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], []);
    const research = artifactComment("research", {
        createdAt: "2026-09-21T10:15:00Z",
    });
    const accepted = artifactComment("scope-accepted", {
        createdAt: "2026-09-21T11:15:00Z",
    });
    const snapshot = snapshotWithBootstrap({
        issues: [root],
        bootstrap: completeBootstrap({
            pullRequests: [castPullRequest({
                state: "MERGED",
                mergedAt: "2026-09-21T10:45:00Z",
            })],
        }),
        bootstrapComments: [research, accepted],
    });
    const goal = snapshot.goals[0];

    assert.equal(goal.id, "octodemo/demo#6");
    assert.deepEqual(goal.artifacts.map((artifact) => artifact.kind), ["research", "scope-accepted"]);
    assert.equal(goal.phase, "queued");
    assert.equal(goal.bootstrap.journeyPhase, "activation-ready");
    assert.equal(snapshot.summary.queued, 1);
    assert.equal(snapshot.summary.researching, 0);
    assert.ok(goal.evidence.some((item) =>
        item.kind === "artifact" && item.title.includes("scope-accepted")));
});

test("keeps retained stale scope acceptance visible without advancing authoritative state", () => {
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research", { createdAt: "2026-09-21T10:15:00Z" }),
    ]);
    const accepted = artifactComment("scope-accepted", {
        createdAt: "2026-09-21T11:15:00Z",
    });
    const snapshot = snapshotWithBootstrap({
        issues: [root],
        bootstrapComments: [accepted],
        bootstrapCommentsState: {
            status: "stale",
        },
    });
    const goal = snapshot.goals[0];
    const acceptedArtifact = goal.artifacts.find((artifact) =>
        artifact.kind === "scope-accepted");

    assert.equal(acceptedArtifact.advancing, false);
    assert.equal(goal.phase, "researching");
    assert.equal(goal.bootstrap.journeyPhase, "cast-review");
    assert.ok(goal.evidence.some((item) =>
        item.kind === "artifact" && item.title.includes("scope-accepted")));
});

test("keeps partial activation metadata visible without linking generated goals", () => {
    const bindings = [{
        task: "1",
        issue: "#21",
        epic: "1.1",
        epic_issue: "#20",
        agent: "Dev",
        epic_agents: ["dev"],
        label: "squad:dev",
        epic_label: "squad:dev",
    }];
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research", { createdAt: "2026-09-21T10:15:00Z" }),
    ]);
    const partial = classifyAutomaticBootstrap(classifyInput({
        issues: [researchIssue()],
        comments: [researchComment()],
    }));
    const snapshot = snapshotWithBootstrap({
        issues: [
            root,
            goalIssue(20, "Epic 1.1", ["squad", "squad:dev"]),
            goalIssue(21, "Implement the feature", ["squad", "squad:dev"]),
        ],
        bootstrap: partial,
        bootstrapComments: [artifactComment("activated", {
            bindings,
            createdAt: "2026-09-21T11:00:00Z",
        })],
        bootstrapCommentsState: {
            status: "partial",
            exhaustive: false,
            truncated: true,
        },
    });
    const goal = snapshot.goals.find((candidate) => candidate.issue.number === 6);
    const activatedArtifact = goal.artifacts.find((artifact) =>
        artifact.kind === "activated");

    assert.equal(activatedArtifact.advancing, false);
    assert.equal(goal.phase, "researching");
    assert.equal(goal.bootstrap.journeyPhase, "research");
    assert.deepEqual(goal.bootstrap.generatedGoals, []);
    assert.equal(
        goal.evidence.filter((item) => item.kind === "generated-goal").length,
        0,
    );
});

test("links generated implementation goals only from validated activation bindings", () => {
    const bindings = [{
        task: "1",
        issue: "#21",
        epic: "1.1",
        epic_issue: "#20",
        agent: "Dev",
        epic_agents: ["dev"],
        label: "squad:dev",
        epic_label: "squad:dev",
    }];
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research", { createdAt: "2026-09-21T10:15:00Z" }),
        artifactComment("activated", {
            bindings,
            createdAt: "2026-09-21T11:00:00Z",
        }),
    ]);
    const epic = goalIssue(20, "Epic 1.1", ["squad", "squad:dev"]);
    const taskIssue = goalIssue(21, "Implement the feature", ["squad", "squad:dev"]);
    const snapshot = snapshotWithBootstrap({
        issues: [root, epic, taskIssue],
        pullRequests: [{
            number: 44,
            title: "Implement the feature",
            body: "Closes #21",
            state: "OPEN",
            url: "https://github.com/octodemo/demo/pull/44",
            headRefName: "squad/implement-21-feature",
            isDraft: false,
        }],
        bootstrap: completeBootstrap({
            pullRequests: [castPullRequest({
                state: "MERGED",
                mergedAt: "2026-09-21T10:45:00Z",
            })],
        }),
    });
    const rootGoal = snapshot.goals.find((goal) => goal.issue.number === 6);

    assert.equal(rootGoal.bootstrap.journeyPhase, "delivery");
    assert.deepEqual(
        rootGoal.bootstrap.generatedGoals.map((goal) => [goal.issueNumber, goal.relation]),
        [[20, "epic"], [21, "task"]],
    );
    assert.equal(
        rootGoal.evidence.filter((item) => item.kind === "generated-goal").length,
        2,
    );

    const invalidRoot = goalIssue(6, root.title, [], [
        artifactComment("research", { createdAt: "2026-09-21T10:15:00Z" }),
        artifactComment("activated", {
            bindings: [{ ...bindings[0], label: "squad:other" }],
            createdAt: "2026-09-21T11:00:00Z",
        }),
    ]);
    const invalid = snapshotWithBootstrap({
        issues: [invalidRoot, epic, taskIssue],
        bootstrap: snapshot.bootstrap,
    }).goals.find((goal) => goal.issue.number === 6);
    assert.deepEqual(invalid.bootstrap.generatedGoals, []);
    assert.ok(invalid.evidence.some((item) =>
        item.kind === "bootstrap-diagnostic" &&
        item.code === "unvalidated-generated-goal"));
});

test("does not attach ambiguous, malformed, or unknown bootstrap state to a guessed goal", () => {
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research"),
    ]);
    for (const bootstrap of [
        completeBootstrap({
            pullRequests: [castPullRequest({ baseRefName: "release" })],
        }),
        classifyAutomaticBootstrap(classifyInput({
            pullRequests: [castPullRequest(), castPullRequest({ number: 4 })],
        })),
        classifyAutomaticBootstrap(classifyInput()),
    ]) {
        const snapshot = snapshotWithBootstrap({ issues: [root], bootstrap });
        assert.equal(snapshot.goals[0].bootstrap, undefined);
        assert.equal(snapshot.summary.bootstrap[bootstrap.status], 1);
    }
});

test("attaches retained stale and partial bootstrap state without advancing it", () => {
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research"),
    ]);
    const partial = classifyAutomaticBootstrap(classifyInput({
        issues: [researchIssue()],
        comments: [researchComment()],
    }));
    const snapshot = snapshotWithBootstrap({
        issues: [root],
        bootstrap: {
            ...partial,
            stale: true,
            staleSources: ["pullRequests"],
            reasons: [
                ...partial.reasons,
                {
                    code: "stale-source",
                    source: "pullRequests",
                    message: "pullRequests is stale; bootstrap state cannot advance safely.",
                    number: null,
                    commentId: null,
                    url: "",
                },
            ],
        },
    });
    const goal = snapshot.goals[0];

    assert.equal(goal.bootstrap.status, "partial");
    assert.equal(goal.bootstrap.stale, true);
    assert.deepEqual(goal.bootstrap.staleSources, ["pullRequests"]);
    assert.equal(goal.bootstrap.journeyPhase, "research");
    assert.equal(snapshot.summary.bootstrap.partial, 1);
    assert.equal(snapshot.summary.bootstrap.stale, 1);
    assert.ok(goal.evidence.some((item) =>
        item.kind === "bootstrap-diagnostic" &&
        item.confidence === "derived" &&
        item.code === "stale-source"));
});

test("aggregates bootstrap summaries across repositories including stale, unknown, and partial state", () => {
    const first = snapshotWithBootstrap({
        issues: [goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
            artifactComment("research"),
        ])],
    });
    const secondBootstrap = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
    }));
    const second = {
        ...snapshotWithBootstrap({
            issues: [],
            bootstrap: secondBootstrap,
        }),
        repository: {
            name: "backend",
            nameWithOwner: "octodemo/backend",
            url: "https://github.com/octodemo/backend",
            defaultBranch: "main",
        },
        bootstrap: {
            ...secondBootstrap,
            repository: "octodemo/backend",
            stale: true,
            staleSources: ["issues"],
        },
    };
    second.summary.bootstrap = {
        ...second.summary.bootstrap,
        stale: 1,
    };
    const thirdBootstrap = classifyAutomaticBootstrap(classifyInput());
    const third = {
        ...snapshotWithBootstrap({ issues: [], bootstrap: thirdBootstrap }),
        repository: {
            name: "worker",
            nameWithOwner: "octodemo/worker",
            url: "https://github.com/octodemo/worker",
            defaultBranch: "main",
        },
        bootstrap: {
            ...thirdBootstrap,
            repository: "octodemo/worker",
        },
    };

    const aggregate = aggregateActivitySnapshots({ snapshots: [first, second, third] });
    assert.equal(aggregate.bootstraps.length, 3);
    assert.equal(aggregate.summary.bootstrap.complete, 1);
    assert.equal(aggregate.summary.bootstrap.partial, 1);
    assert.equal(aggregate.summary.bootstrap.unknown, 1);
    assert.equal(aggregate.summary.bootstrap.total, 2);
    assert.equal(aggregate.summary.bootstrap.stale, 1);
});

test("recomputes generated-goal journey after cross-repository dependency resolution", () => {
    const bindings = [{
        task: "1",
        issue: "#21",
        epic: "1.1",
        epic_issue: "#20",
        agent: "Dev",
        epic_agents: ["dev"],
        label: "squad:dev",
        epic_label: "squad:dev",
    }];
    const root = goalIssue(6, "[Research Proposals] Agent-discovered repo opportunities", [], [
        artifactComment("research", { createdAt: "2026-09-21T10:15:00Z" }),
        artifactComment("activated", {
            bindings,
            createdAt: "2026-09-21T11:00:00Z",
        }),
    ]);
    const epic = goalIssue(20, "Epic 1.1", ["squad", "squad:dev"]);
    const taskIssue = {
        ...goalIssue(21, "Implement the feature", ["squad", "squad:dev"]),
        body: "Blocked by: octodemo/backend#41",
    };
    const frontend = snapshotWithBootstrap({
        issues: [root, epic, taskIssue],
        bootstrap: completeBootstrap({
            pullRequests: [castPullRequest({
                state: "MERGED",
                mergedAt: "2026-09-21T10:45:00Z",
            })],
        }),
    });
    assert.equal(
        frontend.goals.find((goal) => goal.issue.number === 6).bootstrap.journeyPhase,
        "delivery",
    );
    const backend = buildActivitySnapshot({
        repository: {
            name: "backend",
            nameWithOwner: "octodemo/backend",
            url: "https://github.com/octodemo/backend",
            defaultBranchRef: { name: "main" },
        },
        issues: [{
            ...goalIssue(41, "Backend dependency", ["squad"]),
            url: "https://github.com/octodemo/backend/issues/41",
            state: "CLOSED",
        }],
    });
    const frontendBefore = structuredClone(frontend);
    const aggregate = aggregateActivitySnapshots({ snapshots: [frontend, backend] });
    const rootGoal = aggregate.goals.find((goal) => goal.id === "octodemo/demo#6");

    assert.equal(rootGoal.bootstrap.journeyPhase, "activated");
    assert.equal(
        rootGoal.bootstrap.generatedGoals.find((goal) => goal.issueNumber === 21).phase,
        "queued",
    );
    assert.deepEqual(frontend, frontendBefore);
});
