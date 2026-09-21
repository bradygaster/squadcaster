export function emptyActivity() {
    return {
        schemaVersion: 2,
        fetchedAt: null,
        repository: {},
        repositories: [],
        summary: {
            active: 0,
            queued: 0,
            researching: 0,
            implementing: 0,
            blocked: 0,
            failed: 0,
            awaitingReview: 0,
            completed: 0,
        },
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

function isUnvalidatedSessionProvenanceField(key) {
    return String(key).replace(/[^a-z0-9]/gi, "").toLowerCase().includes("session");
}

function withoutUnvalidatedSessionProvenance(value) {
    if (Array.isArray(value)) return value.map(withoutUnvalidatedSessionProvenance);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !isUnvalidatedSessionProvenanceField(key))
            .map(([key, nestedValue]) => [
                key,
                withoutUnvalidatedSessionProvenance(nestedValue),
            ]),
    );
}

function normalizeGoal(goal) {
    const supportedGoal = withoutUnvalidatedSessionProvenance(goal);
    return {
        ...supportedGoal,
        repository: isRecord(supportedGoal.repository)
            ? normalizeRepository(supportedGoal.repository)
            : {},
        issue: isRecord(supportedGoal.issue) ? supportedGoal.issue : {},
        owner: isRecord(supportedGoal.owner) ? supportedGoal.owner : null,
        blockers: recordArray(supportedGoal.blockers),
        evidence: recordArray(supportedGoal.evidence),
        pullRequests: recordArray(supportedGoal.pullRequests),
        workflowRuns: recordArray(supportedGoal.workflowRuns),
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
