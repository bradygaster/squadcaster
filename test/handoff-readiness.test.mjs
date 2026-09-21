import assert from "node:assert/strict";
import test from "node:test";
import { aggregateActivitySnapshots, buildActivitySnapshot } from "../activity-model.mjs";
import {
    extractAcceptanceCriteria,
    parseActivationEvidence,
} from "../handoff-readiness.mjs";

const repository = {
    name: "demo",
    nameWithOwner: "octodemo/demo",
    url: "https://github.com/octodemo/demo",
    defaultBranchRef: { name: "main" },
};

function issue(number, overrides = {}) {
    return {
        number,
        title: `Issue ${number}`,
        body: "",
        state: "OPEN",
        url: `https://github.com/octodemo/demo/issues/${number}`,
        labels: [{ name: "squad" }],
        assignees: [],
        comments: [],
        createdAt: "2026-09-21T18:00:00Z",
        updatedAt: "2026-09-21T19:00:00Z",
        ...overrides,
    };
}

function binding(overrides = {}) {
    return {
        task: "3",
        issue: "#12",
        epic: "2.1",
        epic_issue: "#11",
        agent: "Kint",
        epic_agents: ["kint"],
        label: "squad:kint",
        epic_label: "squad:kint",
        ...overrides,
    };
}

function activationComment(bindings = [binding()], overrides = {}) {
    return {
        body: `## Plan activated

Activation bindings:
\`\`\`json
${JSON.stringify(bindings)}
\`\`\`

Structured data:
\`\`\`json
${JSON.stringify({
        squad_artifact: "activated",
        schema_version: "1",
        origin_issue: 10,
        phases: [],
    })}
\`\`\``,
        url: "https://github.com/octodemo/demo/issues/10#issuecomment-100",
        createdAt: "2026-09-21T18:30:00Z",
        ...overrides,
    };
}

function readyIssues(taskOverrides = {}, rootOverrides = {}) {
    return [
        issue(10, {
            title: "Root plan",
            comments: [activationComment()],
            ...rootOverrides,
        }),
        issue(11, {
            title: "Epic",
            labels: [{ name: "squad" }, { name: "squad:kint" }],
        }),
        issue(12, {
            title: "Implement the dashboard",
            body: "## Acceptance Criteria\n- Shows readiness\n- Preserves source links",
            labels: [{ name: "squad" }, { name: "squad:kint" }],
            ...taskOverrides,
        }),
    ];
}

function snapshot({
    task = {},
    root = {},
    issues = null,
    pullRequests = [],
    workflowRuns = [],
    sourceState = null,
    copilotTasks = {},
    localSessions = {},
    mechanismAvailability = {},
} = {}) {
    return buildActivitySnapshot({
        repository,
        issues: issues || readyIssues(task, root),
        pullRequests,
        workflowRuns,
        sourceState,
        copilotTasks,
        localSessions,
        mechanismAvailability,
        fetchedAt: "2026-09-21T20:00:00Z",
    });
}

function taskGoal(value) {
    return value.goals.find((goal) => goal.issue.number === 12);
}

test("derives ready only from complete activated leaf evidence", () => {
    const handoff = taskGoal(snapshot()).handoff;

    assert.equal(handoff.readiness.state, "ready");
    assert.deepEqual(handoff.readiness.reasons, []);
    assert.equal(handoff.activation.rootIssue, "octodemo/demo#10");
    assert.equal(handoff.activation.issue, "octodemo/demo#12");
    assert.equal(handoff.activation.epicIssue, "octodemo/demo#11");
    assert.equal(handoff.activation.agent, "Kint");
    assert.deepEqual(
        handoff.acceptanceCriteria.map((criterion) => criterion.text),
        ["Shows readiness", "Preserves source links"],
    );
    assert.equal(handoff.acceptanceCriteriaComplete, true);
    assert.equal(handoff.issueRevision, "2026-09-21T19:00:00.000Z");
    assert.equal(handoff.readiness.automatedHandoffAvailable, false);
});

test("uses only the latest activation artifact for handoff authority", () => {
    const issues = readyIssues();
    issues[0].comments.push(activationComment([
        binding({
            task: "4",
            issue: "#13",
        }),
    ], {
        url: "https://github.com/octodemo/demo/issues/10#issuecomment-101",
        createdAt: "2026-09-21T18:45:00Z",
    }));
    issues.push(issue(13, {
        labels: [{ name: "squad" }, { name: "squad:kint" }],
    }));

    const evidence = parseActivationEvidence({
        issues,
        repository: repository.nameWithOwner,
    });

    assert.equal(evidence.get(12).activation, null);
    assert.equal(evidence.get(13).activation?.issue, "octodemo/demo#13");
});

test("keeps task readiness independent from mechanism availability", () => {
    const handoff = taskGoal(snapshot({
        mechanismAvailability: {
            "local-session": {
                availability: "available",
                reasons: [],
            },
            "copilot-cloud-agent": {
                availability: "policy-blocked",
                reasons: ["Repository policy disables cloud agents."],
            },
        },
    })).handoff;

    assert.equal(handoff.readiness.state, "ready");
    assert.equal(handoff.readiness.automatedHandoffAvailable, true);
    assert.equal(
        handoff.mechanisms.find((mechanism) => mechanism.kind === "copilot-cloud-agent").availability,
        "policy-blocked",
    );
});

test("blocks when every declared dependency is not observed complete", () => {
    const issues = readyIssues({
        body: "Depends on:\n- #9\n\n## Acceptance Criteria\n- Shows readiness",
    });
    issues.push(issue(9, {
        title: "Choose the API",
        labels: [],
        state: "OPEN",
    }));

    const handoff = taskGoal(snapshot({ issues })).handoff;
    assert.equal(handoff.readiness.state, "blocked");
    assert.match(handoff.readiness.reasons.join(" "), /dependency is open or unresolved/i);
});

test("cross-repository aggregation resolves a fresh closed non-Squad dependency", () => {
    const frontendIssues = readyIssues({
        body: "Depends on: octodemo/backend#9\n\n## Acceptance Criteria\n- Shows readiness",
    });
    const frontend = buildActivitySnapshot({
        repository,
        issues: frontendIssues,
        fetchedAt: "2026-09-21T20:00:00Z",
    });
    const backend = buildActivitySnapshot({
        repository: {
            name: "backend",
            nameWithOwner: "octodemo/backend",
            url: "https://github.com/octodemo/backend",
            defaultBranchRef: { name: "main" },
        },
        issues: [issue(9, {
            title: "Dependency",
            state: "CLOSED",
            labels: [],
            url: "https://github.com/octodemo/backend/issues/9",
        })],
        fetchedAt: "2026-09-21T20:00:00Z",
    });

    assert.equal(taskGoal(frontend).handoff.readiness.state, "blocked");
    const aggregate = aggregateActivitySnapshots({ snapshots: [frontend, backend] });
    assert.equal(taskGoal(aggregate).handoff.readiness.state, "ready");
});

test("cross-repository aggregation never completes a dependency from stale evidence", () => {
    const frontendIssues = readyIssues({
        body: "Depends on: octodemo/backend#9\n\n## Acceptance Criteria\n- Shows readiness",
    });
    const frontend = buildActivitySnapshot({
        repository,
        issues: frontendIssues,
        fetchedAt: "2026-09-21T20:00:00Z",
    });
    const backendIssue = issue(9, {
        title: "Dependency",
        state: "CLOSED",
        labels: [],
        url: "https://github.com/octodemo/backend/issues/9",
    });
    const backend = buildActivitySnapshot({
        repository: {
            name: "backend",
            nameWithOwner: "octodemo/backend",
            url: "https://github.com/octodemo/backend",
            defaultBranchRef: { name: "main" },
        },
        sourceState: {
            issues: { data: [backendIssue], status: "stale" },
            pullRequests: { data: [], status: "fresh" },
            workflowRuns: { data: [], status: "fresh" },
        },
        fetchedAt: "2026-09-21T20:00:00Z",
    });

    const aggregate = aggregateActivitySnapshots({ snapshots: [frontend, backend] });
    const handoff = taskGoal(aggregate).handoff;
    assert.equal(handoff.readiness.state, "unknown");
    assert.match(handoff.readiness.reasons.join(" "), /dependency octodemo\/backend#9 evidence is stale/i);
});

test("cross-repository aggregation keeps a fresh open non-Squad dependency blocked", () => {
    const frontend = buildActivitySnapshot({
        repository,
        issues: readyIssues({
            body: "Depends on: octodemo/backend#9\n\n## Acceptance Criteria\n- Shows readiness",
        }),
    });
    const backendIssue = issue(9, {
        title: "Open dependency",
        state: "OPEN",
        labels: [],
        url: "https://github.com/octodemo/backend/issues/9",
    });
    const backend = buildActivitySnapshot({
        repository: {
            name: "backend",
            nameWithOwner: "octodemo/backend",
            url: "https://github.com/octodemo/backend",
        },
        issues: [backendIssue],
    });

    const handoff = taskGoal(aggregateActivitySnapshots({ snapshots: [frontend, backend] })).handoff;
    assert.equal(handoff.readiness.state, "blocked");
});

test("cross-repository aggregation fails closed for missing, excluded, and errored target evidence", () => {
    const frontend = buildActivitySnapshot({
        repository,
        issues: readyIssues({
            body: "Depends on: octodemo/backend#9\n\n## Acceptance Criteria\n- Shows readiness",
        }),
    });
    const backendRepository = {
        name: "backend",
        nameWithOwner: "octodemo/backend",
        url: "https://github.com/octodemo/backend",
    };
    const cases = [
        {
            name: "missing",
            snapshot: buildActivitySnapshot({
                repository: backendRepository,
                issues: [issue(8, { labels: [] })],
            }),
            repositories: [],
            reason: /evidence is missing/i,
        },
        {
            name: "excluded",
            snapshot: buildActivitySnapshot({
                repository: backendRepository,
                issues: [issue(9, { state: "CLOSED", labels: [] })],
            }),
            repositories: [{ nameWithOwner: "octodemo/backend", included: false }],
            reason: /evidence is excluded/i,
        },
        {
            name: "source error",
            snapshot: buildActivitySnapshot({
                repository: backendRepository,
                sourceState: {
                    issues: {
                        data: [issue(9, { state: "CLOSED", labels: [] })],
                        status: "unavailable",
                        error: "issue access denied",
                    },
                    pullRequests: { data: [], status: "fresh" },
                    workflowRuns: { data: [], status: "fresh" },
                },
                errors: [{ source: "issues", message: "issue access denied" }],
            }),
            repositories: [],
            reason: /evidence is unavailable/i,
        },
        {
            name: "truncated",
            snapshot: buildActivitySnapshot({
                repository: backendRepository,
                sourceState: {
                    issues: {
                        data: [issue(9, { state: "CLOSED", labels: [] })],
                        status: "incomplete",
                        exhaustive: false,
                        truncated: true,
                    },
                    pullRequests: { data: [], status: "fresh" },
                    workflowRuns: { data: [], status: "fresh" },
                },
            }),
            repositories: [],
            reason: /evidence is incomplete/i,
        },
    ];

    for (const candidate of cases) {
        const aggregate = aggregateActivitySnapshots({
            snapshots: [frontend, candidate.snapshot],
            repositories: candidate.repositories,
        });
        const handoff = taskGoal(aggregate).handoff;
        assert.equal(handoff.readiness.state, "unknown", candidate.name);
        assert.match(handoff.readiness.reasons.join(" "), candidate.reason, candidate.name);
    }
});

test("cross-repository dependency identity cannot collide with the same issue number elsewhere", () => {
    const frontend = buildActivitySnapshot({
        repository,
        issues: readyIssues({
            body: "Depends on: octodemo/backend#9\n\n## Acceptance Criteria\n- Shows readiness",
        }),
    });
    const other = buildActivitySnapshot({
        repository: {
            name: "backend",
            nameWithOwner: "otherdemo/backend",
            url: "https://github.com/otherdemo/backend",
        },
        issues: [issue(9, {
            state: "CLOSED",
            labels: [],
            url: "https://github.com/otherdemo/backend/issues/9",
        })],
    });

    const handoff = taskGoal(aggregateActivitySnapshots({ snapshots: [frontend, other] })).handoff;
    assert.equal(handoff.readiness.state, "unknown");
    assert.match(handoff.readiness.reasons.join(" "), /evidence is unavailable/i);
});

test("cross-repository aggregation rejects ambiguous duplicate target issues", () => {
    const frontend = buildActivitySnapshot({
        repository,
        issues: readyIssues({
            body: "Depends on: octodemo/backend#9\n\n## Acceptance Criteria\n- Shows readiness",
        }),
    });
    const duplicate = issue(9, {
        state: "CLOSED",
        labels: [],
        url: "https://github.com/octodemo/backend/issues/9",
    });
    const backend = buildActivitySnapshot({
        repository: {
            name: "backend",
            nameWithOwner: "octodemo/backend",
            url: "https://github.com/octodemo/backend",
        },
        sourceState: {
            issues: { data: [duplicate, { ...duplicate }], status: "fresh" },
            pullRequests: { data: [], status: "fresh" },
            workflowRuns: { data: [], status: "fresh" },
        },
    });

    const handoff = taskGoal(aggregateActivitySnapshots({ snapshots: [frontend, backend] })).handoff;
    assert.equal(handoff.readiness.state, "unknown");
    assert.match(handoff.readiness.reasons.join(" "), /evidence is ambiguous/i);
});

test("is ineligible when acceptance criteria are absent or empty", () => {
    for (const body of ["No criteria", "## Acceptance Criteria\n\n## Notes\nLater"]) {
        const handoff = taskGoal(snapshot({ task: { body } })).handoff;
        assert.equal(handoff.readiness.state, "ineligible");
        assert.equal(handoff.acceptanceCriteriaComplete, false);
    }
});

test("extracts acceptance criteria before the display body is truncated", () => {
    const criterion = `Preserve ${"all-source-evidence ".repeat(160)}`.trim();
    const handoff = taskGoal(snapshot({
        task: {
            body: `${"Context ".repeat(400)}\n\n## Acceptance Criteria\n- ${criterion}`,
        },
    })).handoff;
    const goal = taskGoal(snapshot({
        task: {
            body: `${"Context ".repeat(400)}\n\n## Acceptance Criteria\n- ${criterion}`,
        },
    }));

    assert.ok(goal.issue.body.length <= 1800);
    assert.equal(handoff.acceptanceCriteria[0].text, criterion);
    assert.ok(handoff.acceptanceCriteria[0].text.length > goal.issue.body.length);
});

test("fails closed on unresolved, malformed, duplicate, and ambiguous bindings", () => {
    const cases = [
        [activationComment([binding({ issue: "#aw_task3" })]), /unresolved/i],
        [activationComment([], {
            body: `Activation bindings:\n\`\`\`json\nnot-json\n\`\`\`\n\nStructured data:\n\`\`\`json\n{"squad_artifact":"activated","schema_version":"1","origin_issue":10,"phases":[]}\n\`\`\``,
        }), /malformed/i],
        [activationComment([binding(), binding()]), /duplicated/i],
    ];
    for (const [comment, reason] of cases) {
        const handoff = taskGoal(snapshot({
            root: { comments: [comment] },
        })).handoff;
        assert.equal(handoff.readiness.state, "unknown");
        assert.match(handoff.readiness.reasons.join(" "), reason);
    }

    const ambiguous = taskGoal(snapshot({
        root: {
            comments: [
                activationComment(),
                activationComment([binding({ task: "4" })], {
                    url: "https://github.com/octodemo/demo/issues/10#issuecomment-101",
                }),
            ],
        },
    })).handoff;
    assert.equal(ambiguous.readiness.state, "unknown");
    assert.match(ambiguous.readiness.reasons.join(" "), /multiple activation bindings/i);
});

test("requires exact task and epic issue identity and observed binding labels", () => {
    const missingEpic = readyIssues();
    missingEpic.splice(missingEpic.findIndex((candidate) => candidate.number === 11), 1);
    assert.equal(taskGoal(snapshot({ issues: missingEpic })).handoff.readiness.state, "unknown");

    const missingLabel = readyIssues({
        labels: [{ name: "squad" }],
    });

    const handoff = taskGoal(snapshot({ issues: missingLabel })).handoff;
    assert.equal(handoff.readiness.state, "unknown");
    assert.match(handoff.readiness.reasons.join(" "), /ownership is not validated/i);

    const omittedLabels = readyIssues({
        labels: [{ name: "squad" }],
    });
    omittedLabels.find((candidate) => candidate.number === 11).labels = [{ name: "squad" }];
    omittedLabels[0].comments = [activationComment([
        binding({ label: "", epic_label: "" }),
    ])];
    const omitted = taskGoal(snapshot({ issues: omittedLabels })).handoff;
    assert.equal(omitted.readiness.state, "unknown");
    assert.match(omitted.readiness.reasons.join(" "), /ownership is not validated/i);
});

test("activation identity collisions fail the whole envelope closed", () => {
    const issues = readyIssues();
    issues.push(issue(13, {
        title: "Second task",
        body: "## Acceptance Criteria\n- Remains fail closed",
        labels: [{ name: "squad" }, { name: "squad:kint" }],
    }));
    issues[0].comments = [activationComment([
        binding(),
        binding({ issue: "#13" }),
    ])];

    const taskEvidence = parseActivationEvidence({
        issues,
        repository: "octodemo/demo",
    });

    test("activation identity fields require raw strings", () => {
        const issues = readyIssues();
        issues[0].comments = [activationComment([binding({
            task: { id: "3" },
            epic: ["2.1"],
            agent: 7,
            epic_agents: [7],
        })])];
        const evidence = parseActivationEvidence({
            issues,
            repository: "octodemo/demo",
        });

        assert.equal(evidence.get(12).activation, null);
        assert.match(evidence.get(12).errors.join(" "), /must be strings/i);

        const oversized = "x".repeat(200);
        issues[0].comments = [activationComment([binding({
            agent: oversized,
            epic_agents: [oversized],
        })])];
        const oversizedEvidence = parseActivationEvidence({
            issues,
            repository: "octodemo/demo",
        });
        assert.equal(oversizedEvidence.get(12).activation, null);
        assert.match(oversizedEvidence.get(12).errors.join(" "), /must be strings/i);
    });

    assert.equal(taskEvidence.get(12).activation, null);
    assert.equal(taskEvidence.get(13).activation, null);
    assert.match(
        [...taskEvidence.get(12).errors, ...taskEvidence.get(13).errors].join(" "),
        /task 3 resolves to multiple issues/i,
    );

    issues[0].comments = [activationComment([
        binding({ issue: "#11" }),
    ])];
    const roleCollision = parseActivationEvidence({
        issues,
        repository: "octodemo/demo",
    });

    assert.equal(roleCollision.get(11).activation, null);
    assert.match(
        roleCollision.get(11).errors.join(" "),
        /both a task and an epic/i,
    );

    issues[0].comments = [activationComment([
        binding({ issue: "#10", label: "", omission_reason: "non-roster" }),
    ])];
    const rootCollision = parseActivationEvidence({
        issues,
        repository: "octodemo/demo",
    });
    assert.equal(rootCollision.get(10).activation, null);
    assert.match(rootCollision.get(10).errors.join(" "), /root issue/i);

    issues[0].comments = [activationComment([
        binding(),
        binding({
            task: "4",
            issue: "#13",
            epic_agents: ["kint", "other"],
            agent: "Other",
        }),
    ])];
    const epicAgentCollision = parseActivationEvidence({
        issues,
        repository: "octodemo/demo",
    });
    assert.equal(epicAgentCollision.get(12).activation, null);
    assert.equal(epicAgentCollision.get(13).activation, null);
    assert.match(
        [...epicAgentCollision.get(12).errors, ...epicAgentCollision.get(13).errors].join(" "),
        /conflicting identity or agents/i,
    );
});

test("uses native and fallback sub-issue relationships to reject non-leaf tasks", () => {
    const native = taskGoal(snapshot({
        task: {
            subIssues: [{
                number: 13,
                title: "Child",
                state: "OPEN",
                url: "https://github.com/octodemo/demo/issues/13",
            }],
            subIssuesSummary: { total: 1 },
        },
        issues: [
            ...readyIssues({
                subIssues: [{
                    number: 13,
                    title: "Child",
                    state: "OPEN",
                    url: "https://github.com/octodemo/demo/issues/13",
                }],
                subIssuesSummary: { total: 1 },
            }),
            issue(13, { title: "Child", labels: [] }),
        ],
    })).handoff;
    assert.equal(native.readiness.state, "ineligible");

    const fallbackIssues = readyIssues();
    fallbackIssues.push(issue(13, {
        title: "Fallback child",
        body: "Parent: #12",
        labels: [],
    }));
    const fallback = taskGoal(snapshot({ issues: fallbackIssues })).handoff;
    assert.equal(fallback.readiness.state, "ineligible");
});

test("reports existing work, completion, and ambiguous closed-unmerged attempts", () => {
    const open = taskGoal(snapshot({
        pullRequests: [{
            number: 44,
            title: "Implement readiness",
            body: "Closes #12",
            state: "OPEN",
            url: "https://github.com/octodemo/demo/pull/44",
        }],
    })).handoff;
    assert.equal(open.readiness.state, "already-in-progress");
    assert.equal(open.existingImplementation.links[0].url, "https://github.com/octodemo/demo/pull/44");

    const merged = taskGoal(snapshot({
        pullRequests: [{
            number: 44,
            title: "Implement readiness",
            body: "Closes #12",
            state: "MERGED",
            mergedAt: "2026-09-21T20:00:00Z",
            url: "https://github.com/octodemo/demo/pull/44",
        }],
    })).handoff;
    assert.equal(merged.readiness.state, "completed");

    const closed = taskGoal(snapshot({
        pullRequests: [{
            number: 44,
            title: "Abandoned readiness attempt",
            body: "Closes #12",
            state: "CLOSED",
            url: "https://github.com/octodemo/demo/pull/44",
        }],
    })).handoff;
    assert.equal(closed.readiness.state, "unknown");
    assert.match(closed.readiness.reasons.join(" "), /closed without merging/i);
});

test("does not treat a branch convention alone as authoritative pull request evidence", () => {
    const handoff = taskGoal(snapshot({
        pullRequests: [{
            number: 44,
            title: "Unlinked branch",
            body: "",
            state: "OPEN",
            headRefName: "squad/implement-12-readiness",
            url: "https://github.com/octodemo/demo/pull/44",
        }],
    })).handoff;

    assert.equal(handoff.readiness.state, "ready");
    assert.deepEqual(handoff.existingImplementation.pullRequests, []);
});

test("uses active runs, authoritative Copilot assignment, and enabled session evidence", () => {
    const run = taskGoal(snapshot({
        workflowRuns: [{
            databaseId: 77,
            workflowName: "Squad Implement Worker",
            displayTitle: "Implement #12",
            status: "in_progress",
            headBranch: "squad/implement-12-readiness",
            url: "https://github.com/octodemo/demo/actions/runs/77",
        }],
    })).handoff;
    assert.equal(run.readiness.state, "already-in-progress");

    const labelOnly = taskGoal(snapshot({
        task: {
            labels: [{ name: "squad" }, { name: "squad:copilot" }, { name: "squad:kint" }],
        },
    })).handoff;
    assert.equal(labelOnly.readiness.state, "unknown");
    assert.match(labelOnly.readiness.reasons.join(" "), /ownership is not validated/i);

    const assigned = taskGoal(snapshot({
        task: {
            assignees: [{ login: "copilot-swe-agent" }],
        },
    })).handoff;
    assert.equal(assigned.readiness.state, "already-in-progress");

    const local = taskGoal(snapshot({
        sourceState: {
            issues: { data: readyIssues(), status: "fresh" },
            pullRequests: { data: [], status: "fresh" },
            workflowRuns: { data: [], status: "fresh" },
            localSessions: { status: "fresh", enabled: true },
        },
        localSessions: {
            "octodemo/demo#12": [{
                title: "Issue 12 implementation",
                appUrl: "copilot://session/12",
                status: "active",
            }],
        },
    })).handoff;
    assert.equal(local.readiness.state, "already-in-progress");
});

test("requires authoritative implementation-run identity and preserves prior attempts", () => {
    const generic = taskGoal(snapshot({
        workflowRuns: [{
            databaseId: 70,
            workflowName: "CI",
            displayTitle: "Validate #12",
            status: "in_progress",
            headBranch: "feature/readiness",
            url: "https://github.com/octodemo/demo/actions/runs/70",
        }],
    })).handoff;
    assert.equal(generic.readiness.state, "ready");

    const failedAttempt = taskGoal(snapshot({
        workflowRuns: [{
            databaseId: 71,
            workflowName: "Squad Implement Worker",
            displayTitle: "Implement #12",
            status: "completed",
            conclusion: "failure",
            headBranch: "squad/implement-12-readiness",
            url: "https://github.com/octodemo/demo/actions/runs/71",
        }],
    })).handoff;
    assert.equal(failedAttempt.readiness.state, "unknown");
    assert.equal(failedAttempt.existingImplementation.state, "ambiguous-prior-attempt");
});

test("maps stale, capped, partial, and unauthorized sources to unknown", () => {
    for (const [key, state] of [
        ["issues", { status: "stale" }],
        ["pullRequests", { status: "incomplete", exhaustive: false, truncated: true }],
        ["workflowRuns", { status: "unauthorized" }],
    ]) {
        const issues = readyIssues();
        const handoff = taskGoal(snapshot({
            sourceState: {
                issues: { data: issues, status: "fresh" },
                pullRequests: { data: [], status: "fresh" },
                workflowRuns: { data: [], status: "fresh" },
                [key]: {
                    data: key === "issues" ? issues : [],
                    ...state,
                },
            },
        })).handoff;
        assert.equal(handoff.readiness.state, "unknown");
    }
});

test("closed task issues are completed even when reconciliation sources are stale", () => {
    const issues = readyIssues({ state: "CLOSED" });
    const handoff = taskGoal(snapshot({
        issues,
        sourceState: {
            issues: { data: issues, status: "stale" },
            pullRequests: { data: [], status: "stale" },
            workflowRuns: { data: [], status: "unavailable" },
        },
    })).handoff;

    assert.equal(handoff.readiness.state, "completed");
});

test("parses conservative acceptance headings and preserves source URLs", () => {
    assert.deepEqual(
        extractAcceptanceCriteria(
            "## Success Criteria\n1. First result\n2. Second result\n\n## Notes\nIgnored",
            "https://github.com/octodemo/demo/issues/12",
        ),
        [
            {
                text: "First result",
                sourceUrl: "https://github.com/octodemo/demo/issues/12",
            },
            {
                text: "Second result",
                sourceUrl: "https://github.com/octodemo/demo/issues/12",
            },
        ],
    );
});

test("activation parser rejects duplicated activation JSON blocks", () => {
    const issues = readyIssues();
    issues[0].comments = [{
        ...activationComment(),
        body: `${activationComment().body}\n\nActivation bindings:\n\`\`\`json\n${JSON.stringify([binding()])}\n\`\`\``,
    }];
    const evidence = parseActivationEvidence({
        issues,
        repository: "octodemo/demo",
    }).get(12);

    assert.equal(evidence.activation, null);
    assert.match(evidence.errors.join(" "), /duplicated/i);
});
