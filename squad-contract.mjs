export const SQUAD_WORKFLOW_NAMES = Object.freeze([
    "squad",
    "squad-implement-worker",
    "squad-review",
    "squad-deps-worker",
    "squad-retro",
    "squad-improvement-worker",
]);

export const SQUAD_WORKFLOW_PATHS = Object.freeze(
    SQUAD_WORKFLOW_NAMES.flatMap((name) => [
        `.github/workflows/${name}.md`,
        `.github/workflows/${name}.lock.yml`,
    ]),
);

const SQUAD_WORKFLOW_PATH_SET = new Set(SQUAD_WORKFLOW_PATHS);
const SUPPORT_IDENTITY_IDS = new Set(["scribe", "ralph", "rai", "fact-checker"]);

function normalizedPath(value) {
    return String(value || "").trim().replaceAll("\\", "/").toLowerCase();
}

export function squadWorkflowPaths(files) {
    return [...new Set(
        (Array.isArray(files) ? files : [])
            .map((file) => normalizedPath(file?.path))
            .filter((filePath) => SQUAD_WORKFLOW_PATH_SET.has(filePath)),
    )];
}

export function missingSquadWorkflowPaths(files) {
    const present = new Set(squadWorkflowPaths(files));
    return SQUAD_WORKFLOW_PATHS.filter((filePath) => !present.has(filePath));
}

export function automationPullRequestState(pullRequest) {
    const workflowPaths = squadWorkflowPaths(pullRequest?.files);
    const missingWorkflowPaths = missingSquadWorkflowPaths(pullRequest?.files);
    return {
        recognized: /(?:squad.*automation|automation.*squad)/i.test(pullRequest?.title || "") ||
            workflowPaths.length > 0,
        complete: missingWorkflowPaths.length === 0,
        workflowPaths,
        missingWorkflowPaths,
    };
}

export function isActiveSquadAutomation(automation) {
    return automation?.status === "merged" && automation?.complete === true;
}

export function isSupportIdentity(member) {
    const id = String(member?.id || "").trim().toLowerCase();
    const name = String(member?.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return SUPPORT_IDENTITY_IDS.has(id) || SUPPORT_IDENTITY_IDS.has(name);
}

export function castSpecialists(members) {
    return (Array.isArray(members) ? members : []).filter((member) =>
        !isSupportIdentity(member) && !String(member?.name || "").trim().startsWith("@"));
}
