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

function requirement(prompt, number) {
    const match = prompt.match(new RegExp(
        `^${number}\\. ([\\s\\S]*?)(?=^${number + 1}\\. |\\nIf npm access)`,
        "m",
    ));
    assert.ok(match, `requirement ${number} should exist`);
    return match[1];
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

    const unrelatedWorkflow = completePullRequest();
    unrelatedWorkflow.files.push({ path: ".github/workflows/release.yml" });
    assert.equal(
        isCompleteAutomationPullRequest(unrelatedWorkflow, INSTALLED_PATHS, locks()),
        false,
    );
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

test("clean install and upgrade commands use distinct documented revisions", () => {
    const prompt = automationPullRequestPrompt("/repo");
    const cleanInstall = requirement(prompt, 5);
    const upgrade = requirement(prompt, 6);
    const cleanRefs = [...cleanInstall.matchAll(
        /bradygaster\/squad\/workflows\/([a-z-]+)\.md@dev/g,
    )].map((match) => match[1]);
    const upgradeRefs = [...upgrade.matchAll(
        /bradygaster\/squad\/workflows\/([a-z-]+)\.md@\$\{SQUAD_SHA\}/g,
    )].map((match) => match[1]);

    assert.deepEqual(cleanRefs, SQUAD_WORKFLOWS);
    assert.deepEqual(upgradeRefs, SQUAD_WORKFLOWS);
    assert.doesNotMatch(cleanInstall, /\n\s+--force/);
    assert.doesNotMatch(cleanInstall, /SQUAD_SHA/);
    assert.match(upgrade, /SQUAD_SHA=.*commits\/dev/);
    assert.equal((upgrade.match(/commits\/dev/g) || []).length, 1);
    assert.match(upgrade, /test "\$\{#SQUAD_SHA\}" -eq 40/);
    assert.match(upgrade, /--force/);
    assert.match(upgrade, /do not use gh aw update/i);
    assert.match(upgrade, /Never manually edit a generated \.lock\.yml file/);
});

test("upgrade refreshes exactly the documented shared resources at the same revision", () => {
    const shared = requirement(automationPullRequestPrompt("/repo"), 7);
    const sources = [...shared.matchAll(
        /bradygaster\/squad\/\$\{SQUAD_SHA\}\/workflows\/shared\/([^"]+)/g,
    )].map((match) => match[1]);
    const outputs = [...shared.matchAll(
        /--output \.github\/workflows\/shared\/([^\s]+)/g,
    )].map((match) => match[1]);
    const expected = [
        "squad.md",
        "squad-cast-validator.mjs",
        "squad-planning-ontology.md",
        "squad-planning-policy.md",
    ];

    assert.deepEqual(sources, expected);
    assert.deepEqual(outputs, expected);
    assert.doesNotMatch(shared, /@dev|\/dev\//);
});

test("safe-update approval is conditional on the exact documented allowlist", () => {
    const safeUpdate = requirement(automationPullRequestPrompt("/repo"), 8);
    const entries = [...safeUpdate.matchAll(/^\s+- (.+)$/gm)].map((match) => match[1]);

    assert.deepEqual(entries, [
        "SQUAD_GITHUB_APP_PRIVATE_KEY",
        "SQUAD_GITHUB_TOKEN",
        "bradygaster/squad/.github/actions/squad-init",
    ]);
    assert.match(safeUpdate, /only when the complete report contains exactly/i);
    assert.match(safeUpdate, /Only in that exact case run: gh aw compile --strict --approve/);
    assert.match(safeUpdate, /Stop and surface every unexpected secret or action/i);
});

test("permission changes are covered by explicit confirmation and runtime repository resolution", () => {
    const prompt = automationPullRequestPrompt("/repo");
    const preflight = requirement(prompt, 1);
    const permissions = requirement(prompt, 3);

    assert.match(prompt, /user's confirmation.*authorizes.*Actions workflow-permission update/is);
    assert.match(preflight, /gh auth status/);
    assert.match(preflight, /gh repo view --json nameWithOwner/);
    assert.match(preflight, /gh repo view --json defaultBranchRef/);
    assert.match(prompt, /Install github\/gh-aw only if it is missing/);
    assert.match(permissions, /repos\/\$\{owner_repo\}\/actions\/permissions\/workflow/);
    assert.match(permissions, /default_workflow_permissions=read/);
    assert.match(permissions, /can_approve_pull_request_reviews=true/);
});

test("validation fails closed before review and excludes non-bootstrap output", () => {
    const prompt = automationPullRequestPrompt("/repo");
    const validation = requirement(prompt, 10);
    const exclusions = requirement(prompt, 11);
    const staging = requirement(prompt, 12);

    assert.match(validation, /for workflow in squad squad-implement-worker squad-review squad-deps-worker squad-retro squad-improvement-worker/);
    assert.ok(validation.includes(
        String.raw`grep -nE '\$\{\{[^}]*\\u00(26|3[cCeE])' .github/workflows/*.lock.yml`,
    ));
    assert.match(validation, /Treat any matching line as a failure/);
    assert.match(exclusions, /\.squad\/\*\*/);
    assert.match(exclusions, /\.github\/agents\/squad\.agent\.md/);
    assert.match(exclusions, /meet-the-squad\.md/);
    assert.match(exclusions, /\.github\/aw\/logs\/\*\*/);
    assert.match(exclusions, /\.vscode\/settings\.json/);
    assert.match(staging, /git add -- \.gitattributes \.github\/aw\/ \.github\/workflows\/ \.github\/skills\//);
    assert.match(staging, /git diff --cached --diff-filter=D/);
    assert.match(staging, /Never use git add \., git add -A, or git commit -a/);
});

test("bootstrap never hardcodes a consumer issue or activates before merge", () => {
    const prompt = automationPullRequestPrompt("/repo");

    assert.doesNotMatch(prompt, /(?:issues?|pulls?)\/\d+/i);
    assert.doesNotMatch(prompt, /(?:Closes|Fixes|Resolves|Link issue)\s+#\d+/i);
    assert.match(prompt, /Never merge the pull request/);
    assert.equal(isActiveSquadAutomation({ status: "open", complete: true }), false);
    assert.equal(isActiveSquadAutomation({ status: "merged", complete: false }), false);
    assert.equal(isActiveSquadAutomation({ status: "merged", complete: true }), true);
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
    for (const identity of ["scribe", "ralph", "rai", "fact-checker"]) {
        assert.equal(isSupportIdentity({ id: identity, name: "Custom" }), true);
    }
    assert.deepEqual(castSpecialists(members).map((member) => member.id), ["lead", "backend"]);
});
