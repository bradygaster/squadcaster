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

function positiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function qualifiedIssueMatches(value, repository, number) {
    return String(value || "").toLowerCase() ===
        `${String(repository || "").toLowerCase()}#${number}`;
}

function normalizeActivation(value, expectedRepository, expectedIssueNumber) {
    if (!isRecord(value)) return null;
    const issueNumber = value.issueNumber;
    const epicIssueNumber = value.epicIssueNumber;
    const rootIssueNumber = value.rootIssueNumber;
    const identityFieldsAreStrings = ["task", "epic", "agent"]
        .every((field) => typeof value[field] === "string" && value[field].trim());
    const epicAgents = Array.isArray(value.epicAgents) &&
        value.epicAgents.every((agent) => typeof agent === "string" && agent.trim())
        ? value.epicAgents.map((agent) => agent.trim())
        : [];
    const normalizedAgent = typeof value.agent === "string"
        ? value.agent.trim().toLowerCase()
        : "";
    const normalizedEpicAgents = epicAgents.map((agent) => agent.toLowerCase());
    const valid = value.schemaVersion === "1" &&
        ["activated", "phases-activated", "plan-accepted", "phases-accepted"]
            .includes(value.artifactKind) &&
        positiveInteger(issueNumber) &&
        positiveInteger(epicIssueNumber) &&
        positiveInteger(rootIssueNumber) &&
        issueNumber === expectedIssueNumber &&
        issueNumber !== epicIssueNumber &&
        issueNumber !== rootIssueNumber &&
        epicIssueNumber !== rootIssueNumber &&
        Boolean(String(expectedRepository || "").trim()) &&
        qualifiedIssueMatches(value.issue, expectedRepository, issueNumber) &&
        qualifiedIssueMatches(value.epicIssue, expectedRepository, epicIssueNumber) &&
        qualifiedIssueMatches(value.rootIssue, expectedRepository, rootIssueNumber) &&
        identityFieldsAreStrings &&
        Boolean(normalizedAgent) &&
        epicAgents.length > 0 &&
        new Set(normalizedEpicAgents).size === epicAgents.length &&
        normalizedEpicAgents.includes(normalizedAgent) &&
        Boolean(String(value.rootIssueUrl || "").trim()) &&
        Boolean(String(value.artifactUrl || "").trim());
    return valid
        ? {
            ...value,
            epicAgents,
        }
        : null;
}

function normalizeHandoff(handoff, expectedRepository, expectedIssueNumber) {
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
        activation: normalizeActivation(
            handoff.activation,
            expectedRepository,
            expectedIssueNumber,
        ),
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
        bootstrap: isRecord(goal.bootstrap)
            ? {
                ...goal.bootstrap,
                generatedGoals: recordArray(goal.bootstrap.generatedGoals),
            }
            : undefined,
        handoff: normalizeHandoff(
            goal.handoff,
            goal.repository?.nameWithOwner,
            Number(goal.issue?.number),
        ),
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
