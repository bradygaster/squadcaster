export const SQUAD_WORKFLOWS = Object.freeze([
    "squad",
    "squad-implement-worker",
    "squad-review",
    "squad-deps-worker",
    "squad-retro",
    "squad-improvement-worker",
]);

const IMMUTABLE_REVISION_PATTERN = /^[0-9a-f]{40}$/i;

export function squadWorkflowPaths() {
    return SQUAD_WORKFLOWS.flatMap((workflow) => [
        `.github/workflows/${workflow}.md`,
        `.github/workflows/${workflow}.lock.yml`,
    ]);
}

function isAllowedBootstrapPath(filePath) {
    const normalized = String(filePath || "").toLowerCase();
    if (normalized === ".gitattributes") return true;
    if (normalized === ".github/aw/logs/.gitignore") return true;
    if (normalized.startsWith(".github/aw/logs/")) return false;
    return normalized.startsWith(".github/aw/") ||
        normalized.startsWith(".github/workflows/") ||
        normalized.startsWith(".github/skills/");
}

export function squadSourceRefFromLocks(lockContents) {
    const sourceRefs = SQUAD_WORKFLOWS.map((workflow) => {
        const content = lockContents?.[workflow] || "";
        const escapedWorkflow = workflow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = content.match(new RegExp(
            `Source:\\s+bradygaster/squad/workflows/${escapedWorkflow}\\.md@(dev|[0-9a-f]{40})`,
            "i",
        ));
        return match?.[1]?.toLowerCase() || "";
    });
    if (sourceRefs.some((sourceRef) =>
        sourceRef !== "dev" && !IMMUTABLE_REVISION_PATTERN.test(sourceRef))) return "";
    return sourceRefs.every((sourceRef) => sourceRef === sourceRefs[0]) ? sourceRefs[0] : "";
}

export function isCompleteAutomationPullRequest(pullRequest, installedPaths, lockContents) {
    const files = Array.isArray(pullRequest?.files) ? pullRequest.files : [];
    if (files.length === 0 || files.some((file) =>
        file?.status === "removed" || !isAllowedBootstrapPath(file?.path))) return false;
    const changedPaths = new Set(files.map((file) => String(file?.path || "").toLowerCase()));
    const installed = new Set(
        (Array.isArray(installedPaths) ? installedPaths : [])
            .map((filePath) => String(filePath || "").toLowerCase()),
    );
    const expectedPaths = squadWorkflowPaths().map((filePath) => filePath.toLowerCase());
    const touchesSquadWorkflow = expectedPaths.some((filePath) => changedPaths.has(filePath));
    const hasCompleteSurface = expectedPaths.every((filePath) => installed.has(filePath));
    return touchesSquadWorkflow &&
        hasCompleteSurface &&
        Boolean(squadSourceRefFromLocks(lockContents));
}

export function automationPullRequestPrompt(repoRoot) {
    return `Create the first of two Squad onboarding pull requests in ${repoRoot}.

This pull request bootstraps repository automation only. The approved Squad proposal remains in the canvas and will be delivered later through a separate Cast pull request. The user's confirmation in Squadcaster authorizes the documented Actions workflow-permission update and creation of this bootstrap pull request; it does not authorize any merge.

Work in the current Copilot project-session worktree and keep its existing branch as the isolated bootstrap branch.

Requirements:
1. Verify GitHub access and resolve the target repository and default branch at runtime:
   gh auth status
   owner_repo="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
   default_branch="$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')"
2. Verify the GitHub Agentic Workflows extension is available. Install github/gh-aw only if it is missing.
3. Keep the default workflow token read-only while allowing Actions-created pull requests:
   gh api --method PUT "repos/\${owner_repo}/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
4. Detect installation state before adding anything. A clean first install has none of the six Squad source or lock files. If any one exists, treat the repository as an existing or partial installation and use the upgrade path.
5. Clean first install: add all six supported workflows in dispatcher-first order from the documented development channel, without --force:
   gh aw add \\
     bradygaster/squad/workflows/squad.md@dev \\
     bradygaster/squad/workflows/squad-implement-worker.md@dev \\
     bradygaster/squad/workflows/squad-review.md@dev \\
     bradygaster/squad/workflows/squad-deps-worker.md@dev \\
     bradygaster/squad/workflows/squad-retro.md@dev \\
     bradygaster/squad/workflows/squad-improvement-worker.md@dev
6. Existing or partial installation: resolve the current Squad dev head exactly once, require a full immutable commit SHA, and save any repository-owned source customizations before overwriting the six Squad sources. Reapply those customizations before the final compile, and stop for human reconciliation if they cannot be preserved safely. Never manually edit a generated .lock.yml file and do not use gh aw update for this flow.
   SQUAD_SHA="$(gh api repos/bradygaster/squad/commits/dev --jq '.sha')"
   test "\${#SQUAD_SHA}" -eq 40
   gh aw add \\
     bradygaster/squad/workflows/squad.md@\${SQUAD_SHA} \\
     bradygaster/squad/workflows/squad-implement-worker.md@\${SQUAD_SHA} \\
     bradygaster/squad/workflows/squad-review.md@\${SQUAD_SHA} \\
     bradygaster/squad/workflows/squad-deps-worker.md@\${SQUAD_SHA} \\
     bradygaster/squad/workflows/squad-retro.md@\${SQUAD_SHA} \\
     bradygaster/squad/workflows/squad-improvement-worker.md@\${SQUAD_SHA} \\
     --force
7. On the existing/partial upgrade path, refresh the documented shared imports and resources from the same SQUAD_SHA:
   mkdir -p .github/workflows/shared
   curl --fail --silent --show-error --location "https://raw.githubusercontent.com/bradygaster/squad/\${SQUAD_SHA}/workflows/shared/squad.md" --output .github/workflows/shared/squad.md
   curl --fail --silent --show-error --location "https://raw.githubusercontent.com/bradygaster/squad/\${SQUAD_SHA}/workflows/shared/squad-cast-validator.mjs" --output .github/workflows/shared/squad-cast-validator.mjs
   curl --fail --silent --show-error --location "https://raw.githubusercontent.com/bradygaster/squad/\${SQUAD_SHA}/workflows/shared/squad-planning-ontology.md" --output .github/workflows/shared/squad-planning-ontology.md
   curl --fail --silent --show-error --location "https://raw.githubusercontent.com/bradygaster/squad/\${SQUAD_SHA}/workflows/shared/squad-planning-policy.md" --output .github/workflows/shared/squad-planning-policy.md
8. If gh-aw reports a restricted-secret safe-update warning, approve it only when the complete report contains exactly these documented entries and no others:
   - SQUAD_GITHUB_APP_PRIVATE_KEY
   - SQUAD_GITHUB_TOKEN
   - bradygaster/squad/.github/actions/squad-init
   Only in that exact case run: gh aw compile --strict --approve
   Stop and surface every unexpected secret or action instead of approving it.
9. Always finish with gh aw compile --strict without --approve. Require all six workflows to succeed. The only permitted warning is squad.md's documented combined slash-command and github-actions[bot] trigger warning; stop on any other warning or error.
10. Verify all twelve source/lock files exist:
    for workflow in squad squad-implement-worker squad-review squad-deps-worker squad-retro squad-improvement-worker; do
      test -f ".github/workflows/\${workflow}.md"
      test -f ".github/workflows/\${workflow}.lock.yml"
    done
    On a clean install, verify every lock contains its matching "Source: bradygaster/squad/workflows/<name>.md@dev" marker. On an upgrade, verify every lock contains its matching "Source: bradygaster/squad/workflows/<name>.md@\${SQUAD_SHA}" marker. Reject JSON-escaped operators inside GitHub expressions with:
    grep -nE '\\$\\{\\{[^}]*\\\\u00(26|3[cCeE])' .github/workflows/*.lock.yml
    Treat any matching line as a failure.
11. Do not generate or modify .squad/**, .github/agents/squad.agent.md, meet-the-squad.md, unrelated workflows, or application files in this pull request. Do not commit .github/aw/logs/** diagnostic output or the optional .vscode/settings.json editor setting. If .github/aw/logs/.gitignore is needed, it may contain only the documented ignore-all/keep-this-file rules.
12. Stage only the documented bootstrap surface with explicit paths, inspect it, and reject every deletion:
    git add -- .gitattributes .github/aw/ .github/workflows/ .github/skills/
    git diff --cached --stat
    test -z "$(git diff --cached --diff-filter=D --name-only)"
    Stop on anything outside that bootstrap surface. Never use git add ., git add -A, or git commit -a.
13. Commit, push the current project-session branch, and open a reviewable pull request against \${default_branch}. Request @copilot review and watch the pull-request checks:
    git commit -m "ci: add Squad agentic workflow"
    git push -u origin HEAD
    gh pr create --base "\${default_branch}" --title "ci: add Squad agentic workflow" --body "Installs or upgrades and strictly compiles the complete supported Squad GH-AW workflow set."
    gh pr edit --add-reviewer @copilot
    gh pr checks --watch
14. Never merge the pull request, enable auto-merge, change any other repository setting, or bypass branch protection.

If npm access becomes necessary, first run:
npm config set registry "https://packagefeedproxy.microsoft.io/npm/"

Finish with the pull request URL on its own line.`;
}
