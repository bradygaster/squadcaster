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
            bootstrap: {
                total: 0,
                pending: 0,
                delayed: 0,
                partial: 0,
                failed: 0,
                retried: 0,
                complete: 0,
                ambiguous: 0,
                malformed: 0,
                opted_out: 0,
                unknown: 0,
                stale: 0,
            },
        },
        goals: [],
        bootstraps: [],
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

function safeUnknownHandoff(reason) {
    return {
        schemaVersion: 1,
        readiness: {
            state: "unknown",
            reasons: reason ? [reason] : [],
            sourceStates: {},
            automatedHandoffAvailable: false,
        },
        activation: null,
        acceptanceCriteria: [],
        acceptanceCriteriaComplete: false,
        leaf: { parentIssueNumber: null, subIssues: [], complete: false },
        existingImplementation: {
            state: "none",
            pullRequests: [],
            workflowRuns: [],
            sessions: [],
            links: [],
        },
        mechanisms: [],
    };
}

function normalizeHandoff(handoff) {
    if (!isRecord(handoff)) return null;
    if (Number(handoff.schemaVersion) !== 1) {
        return safeUnknownHandoff("Cached handoff readiness uses an unsupported schema.");
    }
    const readiness = isRecord(handoff.readiness) ? handoff.readiness : {};
    const allowedStates = new Set([
        "ready",
        "blocked",
        "already-in-progress",
        "completed",
        "ineligible",
        "unknown",
    ]);
    const normalized = {
        ...handoff,
        schemaVersion: 1,
        readiness: {
            ...readiness,
            state: allowedStates.has(readiness.state) ? readiness.state : "unknown",
            reasons: Array.isArray(readiness.reasons)
                ? readiness.reasons.map((reason) => String(reason)).filter(Boolean)
                : [],
            sourceStates: isRecord(readiness.sourceStates) ? readiness.sourceStates : {},
            automatedHandoffAvailable: Boolean(readiness.automatedHandoffAvailable),
        },
        activation: isRecord(handoff.activation) ? handoff.activation : null,
        acceptanceCriteria: recordArray(handoff.acceptanceCriteria),
        acceptanceCriteriaComplete: Boolean(handoff.acceptanceCriteriaComplete),
        leaf: isRecord(handoff.leaf)
            ? {
                ...handoff.leaf,
                subIssues: recordArray(handoff.leaf.subIssues),
                complete: Boolean(handoff.leaf.complete),
            }
            : { parentIssueNumber: null, subIssues: [], complete: false },
        existingImplementation: isRecord(handoff.existingImplementation)
            ? {
                ...handoff.existingImplementation,
                pullRequests: recordArray(handoff.existingImplementation.pullRequests),
                workflowRuns: recordArray(handoff.existingImplementation.workflowRuns),
                sessions: recordArray(handoff.existingImplementation.sessions),
                links: recordArray(handoff.existingImplementation.links),
            }
            : {
                state: "none",
                pullRequests: [],
                workflowRuns: [],
                sessions: [],
                links: [],
            },
        mechanisms: recordArray(handoff.mechanisms),
    };
    const requiredSources = [
            "issue",
            "issueAssignees",
            "issueComments",
            "subIssues",
            "dependencies",
            "pullRequests",
            "workflowRuns",
    ];
    const readyIsConsistent = normalized.readiness.state !== "ready" || (
            normalized.activation &&
            normalized.acceptanceCriteriaComplete &&
            normalized.acceptanceCriteria.length > 0 &&
            normalized.leaf.complete &&
            normalized.leaf.subIssues.every((child) => String(child.state).toLowerCase() === "closed") &&
            normalized.existingImplementation.state === "none" &&
            requiredSources.every((source) => normalized.readiness.sourceStates[source] === "complete")
    );
    if (!readyIsConsistent) {
            normalized.readiness.state = "unknown";
            normalized.readiness.reasons = [
                ...normalized.readiness.reasons,
                "Cached ready state was incomplete and must be refreshed.",
            ];
            normalized.readiness.automatedHandoffAvailable = false;
    } else {
            normalized.readiness.automatedHandoffAvailable =
                normalized.readiness.state === "ready" &&
                Boolean(readiness.automatedHandoffAvailable);
    }
    return normalized;
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
        handoff: normalizeHandoff(goal.handoff),
    };
}

export function normalizeActivity(value) {
    const contract = normalizeActivityContract(value) ||
        (isRecord(value) && value.schemaVersion === 3 && value.fetchedAt === null
            ? { ...value, dayBoundary: null }
            : null);
    if (!contract) return emptyActivity();
    const defaults = emptyActivity();
    const summary = isRecord(contract.summary)
        ? {
            ...defaults.summary,
            ...contract.summary,
            bootstrap: isRecord(contract.summary.bootstrap)
                ? { ...defaults.summary.bootstrap, ...contract.summary.bootstrap }
                : defaults.summary.bootstrap,
        }
        : defaults.summary;
    return {
        ...contract,
        schemaVersion: 3,
        dayBoundary: contract.dayBoundary,
        snapshotDays: Array.isArray(contract.snapshotDays)
            ? contract.snapshotDays.map(String).filter(Boolean)
            : [],
        repository: isRecord(contract.repository) ? contract.repository : {},
        repositories: recordArray(contract.repositories).map(normalizeRepository),
        summary,
        goals: recordArray(contract.goals).map(normalizeGoal),
        bootstraps: recordArray(contract.bootstraps),
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
