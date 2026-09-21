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

function isUnvalidatedProvenanceField(key) {
    const normalized = String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
    return normalized === "agentidentity" || normalized.includes("session");
}

function withoutUnvalidatedProvenance(value) {
    if (Array.isArray(value)) return value.map(withoutUnvalidatedProvenance);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !isUnvalidatedProvenanceField(key))
            .map(([key, nestedValue]) => [
                key,
                withoutUnvalidatedProvenance(nestedValue),
            ]),
    );
}

function normalizeGoal(goal) {
    return {
        ...goal,
        repository: isRecord(goal.repository)
            ? normalizeRepository(goal.repository)
            : {},
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
        activity: normalizeActivity(withoutUnvalidatedProvenance(source.activity)),
    };
}
