export function emptyActivity() {
    return {
        schemaVersion: 2,
        fetchedAt: null,
        repository: {},
        repositories: [],
        summary: { active: 0, blocked: 0, failed: 0, awaitingReview: 0, completed: 0 },
        goals: [],
        errors: [],
    };
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordArray(value) {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeRepository(repository) {
    return {
        ...repository,
        nameWithOwner: String(repository.nameWithOwner || ""),
    };
}

function normalizeGoal(goal) {
    return {
        ...goal,
        repository: isRecord(goal.repository) ? normalizeRepository(goal.repository) : {},
        issue: isRecord(goal.issue) ? goal.issue : {},
        owner: isRecord(goal.owner) ? goal.owner : null,
        blockers: recordArray(goal.blockers),
        evidence: recordArray(goal.evidence),
        pullRequests: recordArray(goal.pullRequests),
        workflowRuns: recordArray(goal.workflowRuns),
    };
}

export function normalizeActivity(value) {
    if (!isRecord(value) || value.schemaVersion !== 2) return emptyActivity();
    return {
        ...value,
        schemaVersion: 2,
        repository: isRecord(value.repository) ? value.repository : {},
        repositories: recordArray(value.repositories).map(normalizeRepository),
        summary: isRecord(value.summary) ? value.summary : emptyActivity().summary,
        goals: recordArray(value.goals).map(normalizeGoal),
        errors: recordArray(value.errors),
    };
}

export function normalizePersistedState(value) {
    const source = isRecord(value) ? value : {};
    return {
        version: 3,
        activity: normalizeActivity(source.activity),
    };
}
