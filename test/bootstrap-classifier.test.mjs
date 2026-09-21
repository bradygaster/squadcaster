import assert from "node:assert/strict";
import test from "node:test";
import {
    BOOTSTRAP_IDENTIFIERS,
    classifyAutomaticBootstrap,
    selectAutomaticBootstrapCandidates,
} from "../bootstrap-classifier.mjs";
import {
    NOW,
    castPullRequest,
    classifyInput,
    researchComment,
    researchIssue,
    workflow,
    workflowRun,
} from "./fixtures/bootstrap-classifier.mjs";

test("exports the canonical automatic-bootstrap identifiers", () => {
    assert.deepEqual(BOOTSTRAP_IDENTIFIERS, {
        workflow: "Squad Bootstrap",
        castBranch: "squad/bootstrap-cast",
        castPullRequestTitle: "[squad] Cast your Squad",
        researchIssueTitle: "[Research Proposals] Agent-discovered repo opportunities",
        researchIssueMarker: "<!-- squad:bootstrap-opportunities schema=1 -->",
        researchArtifactKind: "research",
        researchSchemaVersion: "1",
        researchAuthor: "github-actions[bot]",
    });
});

test("selects unique canonical candidates for discovery without duplicating identity logic", () => {
    const selected = selectAutomaticBootstrapCandidates({
        repository: classifyInput().repository,
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
    });
    assert.equal(selected.canonicalCastPullRequest.number, 3);
    assert.equal(selected.canonicalResearchIssue.number, 6);
    assert.deepEqual(selected.reasons, []);

    const ambiguous = selectAutomaticBootstrapCandidates({
        repository: classifyInput().repository,
        pullRequests: [castPullRequest(), castPullRequest({ number: 4 })],
        issues: [researchIssue({ body: "missing marker" })],
    });
    assert.equal(ambiguous.canonicalCastPullRequest, null);
    assert.equal(ambiguous.canonicalResearchIssue, null);
    assert.deepEqual(
        new Set(ambiguous.reasons.map((item) => item.code)),
        new Set(["duplicate-cast-pull-request", "malformed-research-issue"]),
    );
});

test("classifies every documented materialization state deterministically", () => {
    const cases = [
        ["pending", classifyInput({ workflows: [workflow()] })],
        ["delayed", classifyInput({
            workflowRuns: [workflowRun({
                status: "in_progress",
                conclusion: null,
                updatedAt: "2026-09-21T11:44:59Z",
            })],
        })],
        ["partial", classifyInput({ pullRequests: [castPullRequest()] })],
        ["failed", classifyInput({
            workflowRuns: [workflowRun({ conclusion: "failure" })],
        })],
        ["retried", classifyInput({
            workflowRuns: [
                workflowRun({ databaseId: 19, conclusion: "failure", updatedAt: "2026-09-21T10:10:00Z" }),
                workflowRun({
                    databaseId: 20,
                    status: "in_progress",
                    conclusion: null,
                    updatedAt: "2026-09-21T11:55:00Z",
                }),
            ],
        })],
        ["complete", classifyInput({
            pullRequests: [castPullRequest()],
            issues: [researchIssue()],
            comments: [researchComment()],
        })],
        ["ambiguous", classifyInput({
            pullRequests: [castPullRequest(), castPullRequest({ number: 4 })],
        })],
        ["malformed", classifyInput({
            pullRequests: [castPullRequest({ baseRefName: "release" })],
        })],
        ["opted_out", classifyInput({
            pullRequests: [castPullRequest({ state: "CLOSED" })],
        })],
    ];

    for (const [expected, input] of cases) {
        assert.equal(classifyAutomaticBootstrap(input).status, expected);
    }
});

test("applies ambiguity before malformed and preserves every reason", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [
            castPullRequest({ baseRefName: "release" }),
            castPullRequest({ number: 4, title: "Wrong title" }),
        ],
        issues: [
            researchIssue({ body: "marker missing" }),
            researchIssue({ number: 7 }),
        ],
    }));

    assert.equal(result.status, "ambiguous");
    assert.deepEqual(
        new Set(result.reasons.map((item) => item.code)),
        new Set([
            "duplicate-cast-pull-request",
            "malformed-cast-pull-request",
            "duplicate-research-issue",
            "malformed-research-issue",
        ]),
    );
});

test("applies malformed before closed-unmerged opt-out", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest({ state: "CLOSED", baseRefName: "release" })],
    }));
    assert.equal(result.status, "malformed");
});

test("applies opt-out before complete and never replaces a closed-unmerged Cast PR", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest({ state: "CLOSED" })],
        issues: [researchIssue()],
        comments: [researchComment()],
        workflowRuns: [workflowRun({ conclusion: "failure" })],
    }));
    assert.equal(result.status, "opted_out");
    assert.equal(result.reasons[0].code, "closed-unmerged-cast-pull-request");
});

test("applies complete before retry and failure history", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [researchComment()],
        workflowRuns: [
            workflowRun({ databaseId: 19, conclusion: "failure" }),
            workflowRun({ databaseId: 20, updatedAt: "2026-09-21T11:00:00Z" }),
        ],
    }));
    assert.equal(result.status, "complete");
    assert.equal(result.workflowAttempts.length, 2);
});

test("accepts merged Cast pull requests and closed research issues as durable complete evidence", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest({
            state: "MERGED",
            mergedAt: "2026-09-21T11:00:00Z",
        })],
        issues: [researchIssue({
            state: "CLOSED",
            closedAt: "2026-09-21T11:30:00Z",
        })],
        comments: [researchComment()],
    }));
    assert.equal(result.status, "complete");
    assert.equal(result.castPullRequest.state, "merged");
    assert.equal(result.researchIssue.state, "closed");
});

test("applies retry before partial and retains failed attempts", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        workflowRuns: [
            workflowRun({ databaseId: 19, conclusion: "failure" }),
            workflowRun({
                databaseId: 20,
                status: "completed",
                conclusion: "success",
                updatedAt: "2026-09-21T11:00:00Z",
            }),
        ],
    }));
    assert.equal(result.status, "retried");
    assert.deepEqual(result.workflowAttempts.map((run) => run.id), [19, 20]);
});

test("applies partial before latest workflow failure", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        issues: [researchIssue()],
        workflowRuns: [workflowRun({ conclusion: "failure" })],
    }));
    assert.equal(result.status, "partial");
    assert.ok(result.reasons.some((item) => item.code === "missing-cast-pull-request"));
});

test("applies failure before delayed and pending", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        workflowRuns: [workflowRun({
            conclusion: "failure",
            updatedAt: "2026-09-21T10:00:00Z",
        })],
    }));
    assert.equal(result.status, "failed");
});

test("uses exact delay boundaries for active attempts and installed workflows", () => {
    assert.equal(classifyAutomaticBootstrap(classifyInput({
        workflowRuns: [workflowRun({
            status: "queued",
            conclusion: null,
            updatedAt: "2026-09-21T11:45:01Z",
        })],
    })).status, "pending");
    assert.equal(classifyAutomaticBootstrap(classifyInput({
        workflowRuns: [workflowRun({
            status: "queued",
            conclusion: null,
            updatedAt: "2026-09-21T11:45:00Z",
        })],
    })).status, "delayed");
    assert.equal(classifyAutomaticBootstrap(classifyInput({
        workflows: [workflow({ observedAt: "2026-09-21T11:39:59Z" })],
    })).status, "delayed");
    assert.equal(classifyAutomaticBootstrap(classifyInput({
        workflows: [workflow({ observedAt: "2026-09-21T11:40:01Z" })],
    })).status, "pending");
});

test("validates exact Cast and research issue identity across all states", () => {
    for (const pullRequest of [
        castPullRequest({ title: "Cast your Squad" }),
        castPullRequest({ headRefName: "squad/bootstrap" }),
        castPullRequest({ baseRefName: "release" }),
        castPullRequest({ state: "MERGED", mergedAt: "2026-09-21T11:00:00Z", baseRefName: "release" }),
    ]) {
        assert.equal(classifyAutomaticBootstrap(classifyInput({
            pullRequests: [pullRequest],
        })).status, "malformed");
    }
    for (const issue of [
        researchIssue({ title: "Research proposals" }),
        researchIssue({ body: "missing marker" }),
        researchIssue({
            body: `${BOOTSTRAP_IDENTIFIERS.researchIssueMarker}\n${BOOTSTRAP_IDENTIFIERS.researchIssueMarker}`,
        }),
        researchIssue({ state: "CLOSED", body: "missing marker" }),
    ]) {
        assert.equal(classifyAutomaticBootstrap(classifyInput({
            issues: [issue],
        })).status, "malformed");
    }
});

test("accepts one exact schema-1 envelope and rejects every malformed field", () => {
    const malformed = [
        { squad_artifact: "research", schema_version: "1", origin_issue: 7, phases: [] },
        { squad_artifact: "research", schema_version: "1", origin_issue: 6, phases: ["phase"] },
        { squad_artifact: "research", schema_version: "1", origin_issue: 6 },
        { squad_artifact: "research", schema_version: "1", origin_issue: 6, phases: [], extra: true },
        { squad_artifact: "research", origin_issue: 6, phases: [] },
    ];
    for (const envelope of malformed) {
        const result = classifyAutomaticBootstrap(classifyInput({
            pullRequests: [castPullRequest()],
            issues: [researchIssue()],
            comments: [researchComment({ envelope })],
        }));
        assert.equal(result.status, "malformed");
    }
});

test("keeps unsupported schemas visible but non-advancing", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [researchComment({
            envelope: {
                squad_artifact: "research",
                schema_version: "2",
                origin_issue: 6,
                phases: [],
                future: true,
            },
        })],
    }));
    assert.equal(result.status, "partial");
    assert.equal(result.unsupportedResearchArtifacts.length, 1);
    assert.equal(result.unsupportedResearchArtifacts[0].schemaVersion, "2");
    assert.equal(result.reasons[0].code, "unsupported-research-schema");
});

test("treats invalid schema-version field types as malformed", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [researchComment({
            envelope: {
                squad_artifact: "research",
                schema_version: 1,
                origin_issue: 6,
                phases: [],
            },
        })],
    }));
    assert.equal(result.status, "malformed");
    assert.equal(result.reasons[0].code, "malformed-research-envelope");
});

test("ignores non-bot research envelopes without advancing state", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [researchComment({ author: { login: "octocat" } })],
    }));
    assert.equal(result.status, "partial");
    assert.equal(result.ignoredResearchArtifacts[0].reason, "non-canonical-author");
});

test("non-bot malformed and duplicate envelopes cannot poison canonical bot evidence", () => {
    const foreignEnvelope = JSON.stringify({
        squad_artifact: "research",
        schema_version: "1",
        origin_issue: 6,
        phases: [],
    });
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [
            researchComment(),
            researchComment({
                id: 10,
                author: { login: "octocat" },
                body: [
                    `Structured data:\n\`\`\`json\n${foreignEnvelope}\n\`\`\``,
                    `Structured data:\n\`\`\`json\n${foreignEnvelope}\n\`\`\``,
                    'Structured data:\n```json\n{"squad_artifact":"research",\n```',
                ].join("\n\n"),
            }),
        ],
    }));
    assert.equal(result.status, "complete");
    assert.equal(result.ignoredResearchArtifacts.length, 2);
    assert.deepEqual(result.reasons, []);
});

test("fails closed for duplicate artifacts and multiple envelopes in one comment", () => {
    const duplicate = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [
            researchComment(),
            researchComment({
                id: 10,
                url: "https://github.com/octodemo/demo/issues/6#issuecomment-10",
            }),
        ],
    }));
    assert.equal(duplicate.status, "ambiguous");
    assert.equal(
        duplicate.reasons.filter((item) => item.code === "duplicate-research-artifact").length,
        2,
    );

    const first = researchComment();
    const envelope = JSON.stringify({
        squad_artifact: "research",
        schema_version: "1",
        origin_issue: 6,
        phases: [],
    });
    const multiple = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [{
            ...first,
            body: `${first.body}\n\nStructured data:\n\`\`\`json\n${envelope}\n\`\`\``,
        }],
    }));
    assert.equal(multiple.status, "ambiguous");
    assert.ok(multiple.reasons.some((item) => item.code === "multiple-research-envelopes"));
});

test("fails closed when the research issue links a different repository pull request", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue({
            body: `${BOOTSTRAP_IDENTIFIERS.researchIssueMarker}\nhttps://github.com/octodemo/demo/pull/44`,
        })],
        comments: [researchComment()],
    }));
    assert.equal(result.status, "ambiguous");
    assert.equal(result.reasons[0].code, "conflicting-cast-link");
});

test("fails closed when the canonical issue mixes canonical and foreign Cast links", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue({
            body: [
                BOOTSTRAP_IDENTIFIERS.researchIssueMarker,
                "https://github.com/octodemo/demo/pull/3",
                "https://github.com/octodemo/demo/pull/44",
            ].join("\n"),
        })],
        comments: [researchComment()],
    }));
    assert.equal(result.status, "ambiguous");
    assert.equal(result.reasons[0].code, "conflicting-cast-link");
});

test("requires a positive research issue number and non-null origin identity", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue({ number: null })],
        comments: [researchComment({
            envelope: {
                squad_artifact: "research",
                schema_version: "1",
                origin_issue: null,
                phases: [],
            },
        })],
    }));
    assert.equal(result.status, "malformed");
    assert.ok(result.reasons.some((item) => item.code === "malformed-research-issue"));
    assert.equal(result.researchArtifact, null);
});

test("reports malformed JSON research candidates without swallowing the reason", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [researchComment({
            body: 'Structured data:\n```json\n{"squad_artifact":"research",\n```',
        })],
    }));
    assert.equal(result.status, "malformed");
    assert.equal(result.reasons[0].code, "malformed-research-envelope");
});

test("filters workflow attempts by exact workflow and default branch identity", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        workflowRuns: [
            workflowRun({ databaseId: 1, workflowName: "Squad bootstrap", conclusion: "failure" }),
            workflowRun({ databaseId: 2, headBranch: "release", conclusion: "failure" }),
            workflowRun({
                databaseId: 3,
                status: "in_progress",
                conclusion: null,
                updatedAt: "2026-09-21T11:59:00Z",
            }),
        ],
    }));
    assert.equal(result.status, "pending");
    assert.deepEqual(result.workflowAttempts.map((run) => run.id), [3]);
});

test("retains the last classification when a required source is stale", () => {
    const previous = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [researchComment()],
    }));
    const result = classifyAutomaticBootstrap(classifyInput({
        previous,
        pullRequests: [],
        issues: [],
        comments: [],
        sourceState: {
            pullRequests: { status: "fresh", fetchedAt: NOW },
            issues: { status: "unavailable", fetchedAt: NOW, error: "rate limited" },
            comments: { status: "stale", fetchedAt: "2026-09-21T11:00:00Z" },
            workflowRuns: { status: "fresh", fetchedAt: NOW },
        },
    }));
    assert.equal(result.status, "complete");
    assert.equal(result.stale, true);
    assert.deepEqual(result.staleSources, ["issues", "comments"]);
    assert.equal(result.castPullRequest.number, 3);
});

test("does not require workflow history to establish complete artifact materialization", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [researchComment()],
        sourceState: {
            pullRequests: { status: "fresh" },
            issues: { status: "fresh" },
            comments: { status: "fresh" },
            workflowRuns: { status: "unavailable" },
        },
    }));
    assert.equal(result.status, "complete");
    assert.equal(result.stale, false);
});

test("replaces stale-source diagnostics across repeated guarded refreshes", () => {
    const complete = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [castPullRequest()],
        issues: [researchIssue()],
        comments: [researchComment()],
    }));
    const staleIssues = classifyAutomaticBootstrap(classifyInput({
        previous: complete,
        sourceState: {
            pullRequests: { status: "fresh" },
            issues: { status: "unavailable" },
            comments: { status: "fresh" },
        },
    }));
    const staleComments = classifyAutomaticBootstrap(classifyInput({
        previous: staleIssues,
        sourceState: {
            pullRequests: { status: "fresh" },
            issues: { status: "fresh" },
            comments: { status: "unavailable" },
        },
    }));
    assert.equal(staleComments.status, "complete");
    assert.deepEqual(staleComments.staleSources, ["comments"]);
    assert.equal(
        staleComments.reasons.some((item) =>
            item.source === "issues" && item.code === "unavailable-source"),
        false,
    );
});

test("rejects stale prior classifications from another repository", () => {
    const foreignPrevious = {
        ...classifyAutomaticBootstrap(classifyInput({
            pullRequests: [castPullRequest()],
            issues: [researchIssue()],
            comments: [researchComment()],
        })),
        repository: "octodemo/other",
    };
    const result = classifyAutomaticBootstrap(classifyInput({
        previous: foreignPrevious,
        sourceState: {
            pullRequests: { status: "unavailable" },
            issues: { status: "fresh" },
            workflowRuns: { status: "fresh" },
        },
    }));
    assert.equal(result.status, "unknown");
    assert.equal(result.castPullRequest, null);
    assert.equal(result.lastClassified, null);
});

test("returns unknown when source guarding has no prior classification", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        sourceState: {
            pullRequests: { status: "unavailable" },
            issues: { status: "fresh" },
            workflowRuns: { status: "fresh" },
        },
    }));
    assert.equal(result.status, "unknown");
    assert.equal(result.stale, true);
    assert.deepEqual(result.staleSources, ["pullRequests"]);
    assert.equal(result.reasons[0].code, "unavailable-source");
});

test("requires fresh comments before classifying an observed research issue", () => {
    const result = classifyAutomaticBootstrap(classifyInput({
        issues: [researchIssue()],
        sourceState: {
            pullRequests: { status: "fresh" },
            issues: { status: "fresh" },
            comments: { status: "unavailable" },
            workflowRuns: { status: "fresh" },
        },
    }));
    assert.equal(result.status, "unknown");
    assert.deepEqual(result.staleSources, ["comments"]);
});

test("does not claim pending when no bootstrap workflow, run, or artifact is observed", () => {
    const result = classifyAutomaticBootstrap(classifyInput());
    assert.equal(result.status, "unknown");
    assert.equal(result.stale, false);
    assert.equal(result.reasons[0].code, "bootstrap-not-observed");
});

test("candidate and diagnostic output is stable across input permutations", () => {
    const pullRequests = [
        castPullRequest({ number: 9, baseRefName: "release" }),
        castPullRequest({ number: 3 }),
    ];
    const issues = [
        researchIssue({ number: 8, body: "missing marker" }),
        researchIssue({ number: 6 }),
    ];
    const comments = [
        researchComment({ id: 12 }),
        researchComment({ id: 9 }),
    ];
    const forward = classifyAutomaticBootstrap(classifyInput({
        pullRequests,
        issues,
        comments,
    }));
    const reversed = classifyAutomaticBootstrap(classifyInput({
        pullRequests: [...pullRequests].reverse(),
        issues: [...issues].reverse(),
        comments: [...comments].reverse(),
    }));
    assert.deepEqual(forward.castPullRequest, reversed.castPullRequest);
    assert.deepEqual(forward.researchIssue, reversed.researchIssue);
    assert.deepEqual(forward.reasons, reversed.reasons);
    assert.deepEqual(
        selectAutomaticBootstrapCandidates({
            repository: classifyInput().repository,
            pullRequests,
            issues,
        }),
        selectAutomaticBootstrapCandidates({
            repository: classifyInput().repository,
            pullRequests: [...pullRequests].reverse(),
            issues: [...issues].reverse(),
        }),
    );
});

test("rejects malformed classifier inputs instead of guessing", () => {
    assert.throws(() => classifyAutomaticBootstrap(), /repository/);
    assert.throws(() => classifyAutomaticBootstrap(classifyInput({
        pullRequests: null,
    })), /pullRequests/);
    assert.throws(() => classifyAutomaticBootstrap(classifyInput({
        sourceState: { issues: { status: "skipped" } },
    })), /unsupported status/);
    assert.throws(() => classifyAutomaticBootstrap(classifyInput({
        now: "not-a-time",
    })), /valid now timestamp/);
});
