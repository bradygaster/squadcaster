import { normalizeActivityContract } from "./activity-model.mjs";

export function emptyActivity() {
    const fetchedAt = null;
    return {
        schemaVersion: 3,
        fetchedAt,
        dayBoundary: null,
        snapshotDays: [],
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
        lifecycleHistory: isRecord(goal.lifecycleHistory)
            ? {
                incompleteBeforeFirstObservation: true,
                firstObservedAt: goal.lifecycleHistory.firstObservedAt || null,
                lastObservedAt: goal.lifecycleHistory.lastObservedAt || null,
                transitions: recordArray(goal.lifecycleHistory.transitions),
            }
            : {
                incompleteBeforeFirstObservation: true,
                firstObservedAt: null,
                lastObservedAt: null,
                transitions: [],
            },
    };
}

export function normalizeActivity(value) {
    const contract = normalizeActivityContract(value);
    if (!contract) return emptyActivity();
    return {
        ...contract,
        schemaVersion: 3,
        dayBoundary: contract.dayBoundary,
        snapshotDays: Array.isArray(contract.snapshotDays)
            ? contract.snapshotDays.map(String).filter(Boolean)
            : [],
        repository: isRecord(contract.repository) ? contract.repository : {},
        repositories: recordArray(contract.repositories).map(normalizeRepository),
        summary: isRecord(contract.summary) ? contract.summary : emptyActivity().summary,
        goals: recordArray(contract.goals).map(normalizeGoal),
        errors: recordArray(contract.errors),
    };
}

export function normalizePersistedState(value) {
    const source = isRecord(value) ? value : {};
    return {
        version: 4,
        activity: normalizeActivity(withoutUnvalidatedProvenance(source.activity)),
    };
}
