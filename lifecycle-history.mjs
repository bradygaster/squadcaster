const MAX_TRANSITIONS_PER_GOAL = 100;
const PHASES = new Set([
    "queued",
    "researching",
    "implementing",
    "reviewing",
    "blocked",
    "completed",
    "failed",
]);
const SOURCE_STATUSES = new Set(["fresh", "stale", "unavailable", "skipped"]);

function record(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, maxLength = 300) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function goalKey(repository, goal) {
    return text(goal?.id || `${repository}#${goal?.issue?.number || ""}`, 500).toLowerCase();
}

function normalizedFreshness(value) {
    const sources = record(value?.sources)
        ? Object.fromEntries(Object.entries(value.sources)
            .map(([name, status]) => [
                text(name, 80),
                SOURCE_STATUSES.has(status) ? status : "unavailable",
            ])
            .filter(([name]) => name))
        : {};
    return {
        status: value?.status === "complete" ? "complete" : "partial",
        sources,
    };
}

function normalizedTransition(value) {
    const from = text(value?.from, 40).toLowerCase();
    const to = text(value?.to, 40).toLowerCase();
    const observedAt = timestamp(value?.observedAt);
    if (!PHASES.has(from) || !PHASES.has(to) || from === to || !observedAt) return null;
    return {
        repository: text(value?.repository, 300),
        goalId: text(value?.goalId, 500),
        issueNumber: Number(value?.issueNumber) || null,
        from,
        to,
        observedAt,
        freshness: normalizedFreshness(value?.freshness),
    };
}

function normalizedGoal(value, repository) {
    const currentPhase = text(value?.currentPhase, 40).toLowerCase();
    const transitions = (Array.isArray(value?.transitions) ? value.transitions : [])
        .map(normalizedTransition)
        .filter(Boolean)
        .slice(-MAX_TRANSITIONS_PER_GOAL);
    return {
        repository: text(value?.repository || repository, 300),
        goalId: text(value?.goalId, 500),
        issueNumber: Number(value?.issueNumber) || null,
        currentPhase: PHASES.has(currentPhase) ? currentPhase : "",
        firstObservedAt: timestamp(value?.firstObservedAt),
        lastObservedAt: timestamp(value?.lastObservedAt),
        needsBaseline: Boolean(value?.needsBaseline),
        incompleteBeforeFirstObservation: true,
        transitions,
    };
}

function normalizedRepository(value, key) {
    const repository = text(value?.nameWithOwner || key, 300);
    const goals = record(value?.goals)
        ? Object.fromEntries(Object.entries(value.goals).map(([id, goal]) => [
            id.toLowerCase(),
            normalizedGoal(goal, repository),
        ]))
        : {};
    return {
        nameWithOwner: repository,
        included: value?.included !== false,
        needsBaseline: Boolean(value?.needsBaseline),
        lastObservedAt: timestamp(value?.lastObservedAt),
        goals,
    };
}

export function normalizeLifecycleHistory(value = {}) {
    return {
        version: 1,
        repositories: record(value?.repositories)
            ? Object.fromEntries(Object.entries(value.repositories).map(([key, repository]) => [
                key.toLowerCase(),
                normalizedRepository(repository, key),
            ]))
            : {},
    };
}

function observationFreshness(snapshot) {
    const sources = Object.fromEntries(Object.entries(record(snapshot?.sourceState)
        ? snapshot.sourceState
        : {}).map(([name, source]) => [
        text(name, 80),
        SOURCE_STATUSES.has(source?.status) ? source.status : "unavailable",
    ]));
    const statuses = Object.values(sources);
    const complete = !snapshot?.partial &&
        !snapshot?.stale &&
        !(snapshot?.errors?.length) &&
        statuses.every((status) => status === "fresh");
    const explicitlyPartial = statuses.includes("fresh") && (
        Boolean(snapshot?.partial) ||
        Boolean(snapshot?.stale) ||
        Boolean(snapshot?.errors?.length) ||
        statuses.some((status) => status !== "fresh")
    );
    if (!complete && !explicitlyPartial) return null;
    return {
        status: complete ? "complete" : "partial",
        sources,
    };
}

function monotonicTimestamp(candidate, previous) {
    const next = Date.parse(candidate || "");
    const prior = Date.parse(previous || "");
    if (!Number.isFinite(next)) return null;
    if (!Number.isFinite(prior) || next > prior) return new Date(next).toISOString();
    return new Date(prior + 1).toISOString();
}

function historyForGoal(repositoryState, goal) {
    return repositoryState?.goals?.[goalKey(repositoryState.nameWithOwner, goal)] || null;
}

export function attachLifecycleHistory(snapshot, lifecycleHistory) {
    const normalized = normalizeLifecycleHistory(lifecycleHistory);
    const repositoryName = text(snapshot?.repository?.nameWithOwner, 300);
    const repositoryState = normalized.repositories[repositoryName.toLowerCase()];
    return {
        ...snapshot,
        goals: (Array.isArray(snapshot?.goals) ? snapshot.goals : []).map((goal) => {
            const history = historyForGoal(repositoryState, goal);
            return {
                ...goal,
                lifecycleHistory: history
                    ? {
                        incompleteBeforeFirstObservation: true,
                        firstObservedAt: history.firstObservedAt,
                        lastObservedAt: history.lastObservedAt,
                        transitions: history.transitions.map((transition) => ({ ...transition })),
                    }
                    : {
                        incompleteBeforeFirstObservation: true,
                        firstObservedAt: null,
                        lastObservedAt: null,
                        transitions: [],
                    },
            };
        }),
    };
}

export function setLifecycleRepositoryIncluded(lifecycleHistory, nameWithOwner, included) {
    const normalized = normalizeLifecycleHistory(lifecycleHistory);
    const key = text(nameWithOwner, 300).toLowerCase();
    if (!key) return normalized;
    const repository = normalized.repositories[key] || normalizedRepository({}, nameWithOwner);
    const nextIncluded = Boolean(included);
    if (repository.included !== nextIncluded) repository.needsBaseline = true;
    repository.included = nextIncluded;
    normalized.repositories[key] = repository;
    return normalized;
}

export function observeLifecycleSnapshot(lifecycleHistory, snapshot, { included = true } = {}) {
    const normalized = normalizeLifecycleHistory(lifecycleHistory);
    const repositoryName = text(snapshot?.repository?.nameWithOwner, 300);
    const key = repositoryName.toLowerCase();
    const freshness = observationFreshness(snapshot);
    if (!key || !included || !freshness) {
        return {
            lifecycleHistory: normalized,
            snapshot: attachLifecycleHistory(snapshot, normalized),
            appended: [],
        };
    }

    const repository = normalized.repositories[key] || normalizedRepository({}, repositoryName);
    repository.included = true;
    const observedAt = monotonicTimestamp(snapshot?.fetchedAt, repository.lastObservedAt);
    if (!observedAt) {
        return {
            lifecycleHistory: normalized,
            snapshot: attachLifecycleHistory(snapshot, normalized),
            appended: [],
        };
    }

    const appended = [];
    const seenGoalIds = new Set();
    for (const goal of Array.isArray(snapshot?.goals) ? snapshot.goals : []) {
        const phase = text(goal?.phase, 40).toLowerCase();
        if (!PHASES.has(phase)) continue;
        const id = goalKey(repositoryName, goal);
        seenGoalIds.add(id);
        const prior = repository.goals[id];
        if (!prior || prior.needsBaseline || repository.needsBaseline) {
            repository.goals[id] = {
                repository: repositoryName,
                goalId: text(goal?.id, 500),
                issueNumber: Number(goal?.issue?.number) || null,
                currentPhase: phase,
                firstObservedAt: prior?.firstObservedAt || observedAt,
                lastObservedAt: observedAt,
                needsBaseline: false,
                incompleteBeforeFirstObservation: true,
                transitions: prior?.transitions || [],
            };
            continue;
        }
        prior.lastObservedAt = observedAt;
        prior.needsBaseline = false;
        if (prior.currentPhase === phase) continue;
        const transition = {
            repository: repositoryName,
            goalId: text(goal?.id, 500),
            issueNumber: Number(goal?.issue?.number) || null,
            from: prior.currentPhase,
            to: phase,
            observedAt,
            freshness,
        };
        prior.currentPhase = phase;
        prior.transitions = [...prior.transitions, transition].slice(-MAX_TRANSITIONS_PER_GOAL);
        appended.push(transition);
    }
    for (const [id, storedGoal] of Object.entries(repository.goals)) {
        if (!seenGoalIds.has(id)) storedGoal.needsBaseline = true;
    }
    repository.needsBaseline = false;
    repository.lastObservedAt = observedAt;
    normalized.repositories[key] = repository;
    return {
        lifecycleHistory: normalized,
        snapshot: attachLifecycleHistory(snapshot, normalized),
        appended,
    };
}

export const lifecycleHistoryPolicy = {
    maxTransitionsPerGoal: MAX_TRANSITIONS_PER_GOAL,
};
