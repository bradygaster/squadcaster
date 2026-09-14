import assert from "node:assert/strict";
import test from "node:test";

import {
    SQUAD_WORKFLOW_PATHS,
    automationPullRequestState,
    castSpecialists,
    isActiveSquadAutomation,
    isSupportIdentity,
    missingSquadWorkflowPaths,
} from "../squad-contract.mjs";

function files(paths) {
    return paths.map((path) => ({ path }));
}

test("requires every supported Squad source and lock file", () => {
    const complete = automationPullRequestState({
        title: "ci: add Squad agentic workflow",
        files: files(SQUAD_WORKFLOW_PATHS),
    });

    assert.equal(complete.recognized, true);
    assert.equal(complete.complete, true);
    assert.deepEqual(complete.missingWorkflowPaths, []);
});

test("recognizes but does not complete partial legacy installations", () => {
    const partialPaths = [
        ".github/workflows/squad.md",
        ".github/workflows/squad.lock.yml",
        ".github/workflows/squad-implement-worker.md",
        ".github/workflows/squad-implement-worker.lock.yml",
        ".github/workflows/squad-review.md",
        ".github/workflows/squad-review.lock.yml",
    ];
    const partial = automationPullRequestState({
        title: "Install Squad automation",
        files: files(partialPaths),
    });

    assert.equal(partial.recognized, true);
    assert.equal(partial.complete, false);
    assert.equal(partial.missingWorkflowPaths.length, 6);
    assert.deepEqual(missingSquadWorkflowPaths(files(partialPaths)), partial.missingWorkflowPaths);
});

test("does not treat a matching title as a complete bootstrap", () => {
    const titleOnly = automationPullRequestState({
        title: "Squad automation bootstrap",
        files: [],
    });

    assert.equal(titleOnly.recognized, true);
    assert.equal(titleOnly.complete, false);
    assert.deepEqual(titleOnly.missingWorkflowPaths, SQUAD_WORKFLOW_PATHS);
});

test("activates automation only after a complete bootstrap is merged", () => {
    assert.equal(isActiveSquadAutomation({ status: "open", complete: true }), false);
    assert.equal(isActiveSquadAutomation({ status: "merged", complete: false }), false);
    assert.equal(isActiveSquadAutomation({ status: "merged", complete: true }), true);
});

test("matches workflow paths case-insensitively without accepting unrelated files", () => {
    const state = automationPullRequestState({
        title: "Generated workflow changes",
        files: files([
            ...SQUAD_WORKFLOW_PATHS.map((path) => path.toUpperCase()),
            ".github/workflows/squad-extra.md",
        ]),
    });

    assert.equal(state.recognized, true);
    assert.equal(state.complete, true);
    assert.equal(state.workflowPaths.length, SQUAD_WORKFLOW_PATHS.length);
});

test("excludes built-in support identities and Copilot from cast specialists", () => {
    const members = [
        { id: "lead", name: "Lead" },
        { id: "scribe", name: "Memory" },
        { id: "monitor", name: "Ralph" },
        { id: "rai", name: "Responsible AI" },
        { id: "fact-checker", name: "Verifier" },
        { id: "copilot", name: "@copilot" },
        { id: "backend", name: "Backend" },
    ];

    assert.equal(isSupportIdentity({ id: "custom", name: "Fact Checker" }), true);
    assert.deepEqual(castSpecialists(members).map((member) => member.id), ["lead", "backend"]);
});
