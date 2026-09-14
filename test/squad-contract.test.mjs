import assert from "node:assert/strict";
import test from "node:test";
import {
    automationPullRequestPrompt,
    automationPullRequestState,
    castSpecialists,
    isActiveSquadAutomation,
    isCompleteAutomationPullRequest,
    isSupportIdentity,
    squadSourceRefFromLocks,
    squadWorkflowPaths,
    SQUAD_WORKFLOWS,
} from "../squad-contract.mjs";

const REVISION = "f1229ed7e67009e41e25e264b0df7a36ad929b9a";
const INSTALLED_PATHS = squadWorkflowPaths();

function completePullRequest() {
    return { files: INSTALLED_PATHS.map((path) => ({ path })) };
}

function locks(revision = REVISION) {
    return Object.fromEntries(SQUAD_WORKFLOWS.map((workflow) => [
        workflow,
        `# Source: bradygaster/squad/workflows/${workflow}.md@${revision}\n`,
    ]));
}

test("requires all six workflow source and lock paths", () => {
    const pullRequest = completePullRequest();
    const incompletePaths = INSTALLED_PATHS.slice(0, -1);
    assert.equal(isCompleteAutomationPullRequest(pullRequest, incompletePaths, locks()), false);
});

test("rejects deletions and changes outside the bootstrap surface", () => {
    const deletion = completePullRequest();
    deletion.files[0].status = "removed";
    assert.equal(isCompleteAutomationPullRequest(deletion, INSTALLED_PATHS, locks()), false);

    const unrelated = completePullRequest();
    unrelated.files.push({ path: "src/app.mjs" });
    assert.equal(isCompleteAutomationPullRequest(unrelated, INSTALLED_PATHS, locks()), false);

    const logs = completePullRequest();
    logs.files.push({ path: ".github/aw/logs/run.json" });
    assert.equal(isCompleteAutomationPullRequest(logs, INSTALLED_PATHS, locks()), false);
});

test("rejects mixed or moving workflow revisions", () => {
    const mixed = locks();
    mixed["squad-review"] = "# Source: bradygaster/squad/workflows/squad-review.md@dev\n";
    assert.equal(squadSourceRefFromLocks(mixed), "");
    assert.equal(isCompleteAutomationPullRequest(completePullRequest(), INSTALLED_PATHS, mixed), false);
});

test("recognizes the complete workflow set at one immutable revision", () => {
    assert.equal(squadSourceRefFromLocks(locks()), REVISION);
    assert.equal(isCompleteAutomationPullRequest(completePullRequest(), INSTALLED_PATHS, locks()), true);
});

test("recognizes a complete clean install from the single documented dev channel", () => {
    assert.equal(squadSourceRefFromLocks(locks("dev")), "dev");
    assert.equal(isCompleteAutomationPullRequest(
        completePullRequest(),
        INSTALLED_PATHS,
        locks("dev"),
    ), true);
});

test("recognizes an upgrade when unchanged installed files are absent from the diff", () => {
    const pullRequest = {
        files: [
            { path: ".github/workflows/squad.lock.yml" },
            { path: ".github/workflows/shared/squad.md" },
        ],
    };
    assert.equal(isCompleteAutomationPullRequest(
        pullRequest,
        INSTALLED_PATHS,
        locks(),
    ), true);
});

test("bootstrap prompt preserves the supported safety and review contract", () => {
    const prompt = automationPullRequestPrompt("/repo");
    for (const workflow of SQUAD_WORKFLOWS) {
        assert.ok(prompt.includes(`workflows/${workflow}.md@dev`));
        assert.ok(prompt.includes(`workflows/${workflow}.md@\${SQUAD_SHA}`));
    }
    for (const allowed of [
        "SQUAD_GITHUB_APP_PRIVATE_KEY",
        "SQUAD_GITHUB_TOKEN",
        "bradygaster/squad/.github/actions/squad-init",
    ]) {
        assert.match(prompt, new RegExp(allowed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(prompt, /--force/);
    assert.match(prompt, /clean first install has none/i);
    assert.match(prompt, /existing or partial installation/i);
    assert.match(prompt, /do not use gh aw update/i);
    for (const shared of [
        "shared/squad.md",
        "shared/squad-cast-validator.mjs",
        "shared/squad-planning-ontology.md",
        "shared/squad-planning-policy.md",
    ]) {
        assert.ok(prompt.includes(shared));
    }
    assert.match(prompt, /gh aw compile --strict without --approve/);
    assert.match(prompt, /default_workflow_permissions=read/);
    assert.match(prompt, /git add -- \.gitattributes \.github\/aw\/ \.github\/workflows\/ \.github\/skills\//);
    assert.match(prompt, /git diff --cached --diff-filter=D/);
    assert.match(prompt, /gh pr edit --add-reviewer @copilot/);
    assert.match(prompt, /gh pr checks --watch/);
    assert.match(prompt, /Never merge/);
    assert.match(prompt, /Never manually edit a generated \.lock\.yml file/);
    assert.doesNotMatch(prompt, /(?:Closes|Fixes|Resolves)\s+#\d+/i);
    assert.doesNotMatch(prompt, /Link issue #\d+/i);
});

test("tracks a complete automation candidate separately from merge activation", () => {
    const state = automationPullRequestState(
        { title: "ci: add Squad agentic workflow", ...completePullRequest() },
        INSTALLED_PATHS,
        locks("dev"),
    );

    assert.equal(state.recognized, true);
    assert.equal(state.complete, true);
    assert.deepEqual(state.missingWorkflowPaths, []);
    assert.equal(isActiveSquadAutomation({ status: "open", complete: true }), false);
    assert.equal(isActiveSquadAutomation({ status: "merged", complete: true }), true);
});

test("recognizes partial legacy automation without treating it as complete", () => {
    const partialPaths = INSTALLED_PATHS.slice(0, 6);
    const partial = automationPullRequestState(
        {
            title: "Install Squad automation",
            files: partialPaths.map((path) => ({ path })),
        },
        partialPaths,
        locks("dev"),
    );

    assert.equal(partial.recognized, true);
    assert.equal(partial.complete, false);
    assert.equal(partial.missingWorkflowPaths.length, 6);
    assert.equal(isActiveSquadAutomation({ status: "merged", complete: false }), false);
});

test("does not treat a matching title as a complete bootstrap", () => {
    const titleOnly = automationPullRequestState(
        { title: "Squad automation bootstrap", files: [] },
        [],
        {},
    );

    assert.equal(titleOnly.recognized, true);
    assert.equal(titleOnly.complete, false);
    assert.deepEqual(titleOnly.missingWorkflowPaths, INSTALLED_PATHS);
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
