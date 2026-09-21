import {
    aggregateActivitySnapshots,
    isCompleteActivitySnapshot,
    normalizeActivityContract,
    utcServerDayBoundary,
} from "./activity-model.mjs";
import { GitHubSquadActivityAdapter } from "./github-activity.mjs";
import {
    attachLifecycleHistory,
    normalizeLifecycleHistory,
    observeLifecycleSnapshot,
    setLifecycleRepositoryIncluded,
} from "./lifecycle-history.mjs";
import { normalizeMembers, parseTeamMarkdown } from "./squad-roster.mjs";

const DISCOVERY_TTL = 15 * 60 * 1000;
const ACTIVE_TTL = 60 * 1000;
const INACTIVE_TTL = 10 * 60 * 1000;
const PREFIX_SIGNAL_TTL = 60 * 60 * 1000;
const MAX_CONCURRENCY = 3;
const REPOSITORY_PAGE_SIZE = 40;
const LABEL_PAGE_SIZE = 100;
const REST_RATE_LIMIT_RESERVE = 100;

const DISCOVERY_QUERY = `
query SquadcasterRepositories($cursor: String) {
  viewer {
    login
    repositories(
      first: ${REPOSITORY_PAGE_SIZE}
      after: $cursor
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      nodes {
        name
        nameWithOwner
        url
        isArchived
        pushedAt
        viewerPermission
        defaultBranchRef { name }
        squadSource: object(expression: "HEAD:.github/workflows/squad.md") { ... on Blob { oid } }
        squadLock: object(expression: "HEAD:.github/workflows/squad.lock.yml") { ... on Blob { oid } }
        squadTeam: object(expression: "HEAD:.squad/team.md") { ... on Blob { oid } }
        issues(first: 1, states: OPEN, labels: ["squad"]) { totalCount }
        pullRequests(first: 1, states: OPEN, labels: ["squad"]) { totalCount }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
  rateLimit { remaining resetAt }
}`;

function clean(value, maxLength = 500) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function message(error) {
    return clean(error?.message || error || "Unknown GitHub error", 800);
}

function hasSquadSignal(repository) {
    return Boolean(
        repository?.squadSource ||
        repository?.squadLock ||
        repository?.squadTeam ||
        repository?.issues?.totalCount ||
        repository?.pullRequests?.totalCount
    );
}

function repositoryNameFromSearch(result) {
    const value = result?.repository;
    const nameWithOwner = clean(value?.nameWithOwner || value?.fullName, 300);
    return nameWithOwner.includes("/") ? nameWithOwner : "";
}

function normalizedDiscoverySignal(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
        detected: Boolean(source.detected),
        checkedAt: source.checkedAt || null,
        labels: Array.isArray(source.labels)
            ? source.labels.map((label) => clean(label, 160)).filter(Boolean)
            : [],
        error: clean(source.error, 800),
    };
}

function signalFresh(signal, now = Date.now()) {
    const checkedAt = Date.parse(signal?.checkedAt || "");
    return Number.isFinite(checkedAt) && now - checkedAt < PREFIX_SIGNAL_TTL;
}

function resetAt(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * 1000).toISOString();
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizedRestRateLimit(value) {
    const source = value && typeof value === "object" ? value : {};
    const remaining = source.remaining === null || source.remaining === undefined
        ? Number.NaN
        : Number(source.remaining);
    return {
        remaining: Number.isFinite(remaining) ? remaining : null,
        resetAt: resetAt(source.resetAt || source.reset),
        error: clean(source.error, 800),
    };
}

async function probeSquadPrefixedLabels({
    runJson,
    cwd,
    repository,
    cached,
    budget,
    force = false,
}) {
    const prior = normalizedDiscoverySignal(cached);
    if (!force && signalFresh(prior)) return prior;

    const request = async (args) => {
        if (!budget || !Number.isFinite(budget.remaining) ||
            budget.remaining <= REST_RATE_LIMIT_RESERVE) {
            throw new Error("REST API rate-limit budget is too low for prefix-label discovery.");
        }
        budget.remaining -= 1;
        return runJson(args, cwd);
    };

    try {
        const labels = [];
        for (let page = 1; ; page += 1) {
            const pageLabels = await request([
                "api", `repos/${repository.nameWithOwner}/labels`,
                "--method", "GET",
                "-f", `per_page=${LABEL_PAGE_SIZE}`,
                "-f", `page=${page}`,
                "--jq", "[.[].name]",
            ]);
            if (!Array.isArray(pageLabels)) {
                throw new Error("GitHub returned an unexpected repository-label response.");
            }
            labels.push(...pageLabels.filter((label) => /^squad:/i.test(clean(label, 160))));
            if (pageLabels.length < LABEL_PAGE_SIZE) break;
        }

        const prefixLabels = [...new Map(
            labels.map((label) => [label.toLowerCase(), label]),
        ).values()];
        let detected = false;
        for (const label of prefixLabels) {
            const count = await request([
                "api", `repos/${repository.nameWithOwner}/issues`,
                "--method", "GET",
                "-f", "state=open",
                "-f", `labels=${label}`,
                "-f", "per_page=1",
                "-f", "page=1",
                "--jq", "length",
            ]);
            if (Number(count) > 0) {
                detected = true;
                break;
            }
        }
        return {
            detected,
            checkedAt: new Date().toISOString(),
            labels: prefixLabels,
            error: "",
        };
    } catch (error) {
        return {
            ...prior,
            error: message(error),
        };
    }
}

function registryRepository(repository, previous = {}) {
    return {
        name: clean(repository?.name, 160),
        nameWithOwner: clean(repository?.nameWithOwner, 300),
        url: clean(repository?.url),
        owner: clean(repository?.nameWithOwner, 300).split("/")[0],
        defaultBranch: clean(repository?.defaultBranchRef?.name, 240),
        permission: clean(repository?.viewerPermission, 40).toLowerCase(),
        included: previous.included !== false,
        squadDetected: hasSquadSignal(repository),
        archived: Boolean(repository?.isArchived),
        pushedAt: repository?.pushedAt || null,
        lastSuccessfulRefresh: previous.lastSuccessfulRefresh || null,
        lastAttemptedRefresh: previous.lastAttemptedRefresh || null,
        lastActivityAt: previous.lastActivityAt || null,
        partial: Boolean(previous.partial),
        stale: Boolean(previous.stale),
        staleSources: Array.isArray(previous.staleSources) ? previous.staleSources : [],
        error: previous.error || "",
        squadTeamOid: clean(repository?.squadTeam?.oid, 160),
    };
}

export function snapshotCrossedDayBoundary(snapshot, lastAttemptedRefresh, now = Date.now()) {
    const currentBoundary = utcServerDayBoundary(new Date(now).toISOString());
    const lastAttemptedAt = Date.parse(lastAttemptedRefresh || "");
    return snapshot?.dayBoundary?.cacheKey !== currentBoundary.cacheKey &&
        (!Number.isFinite(lastAttemptedAt) || lastAttemptedAt < Date.parse(currentBoundary.startsAt));
}

export function repositoryRefreshDue(repository, snapshot, currentRepository, now) {
    if (repository.nameWithOwner.toLowerCase() === String(currentRepository || "").toLowerCase()) return true;
    const last = repository.lastAttemptedRefresh
        ? Date.parse(repository.lastAttemptedRefresh)
        : Number.NaN;
    if (!Number.isFinite(last) || now < last) return true;
    if (snapshotCrossedDayBoundary(snapshot, repository.lastAttemptedRefresh, now)) return true;
    const active = Number(snapshot?.summary?.active || 0) > 0;
    return now - last >= (active ? ACTIVE_TTL : INACTIVE_TTL);
}

async function mapConcurrent(items, limit, mapper) {
    const results = new Array(items.length);
    let cursor = 0;
    async function worker() {
        while (cursor < items.length) {
            // JavaScript runs this increment synchronously before the mapper yields.
            const index = cursor++;
            results[index] = await mapper(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

export function normalizeRegistry(value = {}) {
    const snapshots = value.snapshots && typeof value.snapshots === "object"
        ? Object.fromEntries(Object.entries(value.snapshots)
            .map(([key, snapshot]) => [key.toLowerCase(), normalizeActivityContract(snapshot)])
            .filter(([, snapshot]) => snapshot))
        : {};
    return {
        version: 2,
        viewer: clean(value.viewer, 120),
        discoveredAt: value.discoveredAt || null,
        rateLimit: value.rateLimit || null,
        restRateLimit: normalizedRestRateLimit(value.restRateLimit),
        repositories: Array.isArray(value.repositories) ? value.repositories : [],
        snapshots,
        discoverySignals: value.discoverySignals && typeof value.discoverySignals === "object"
            ? Object.fromEntries(
                Object.entries(value.discoverySignals).map(([key, signal]) => [
                    key.toLowerCase(),
                    normalizedDiscoverySignal(signal),
                ]),
            )
            : {},
        rosters: value.rosters && typeof value.rosters === "object" ? value.rosters : {},
        lifecycleHistory: normalizeLifecycleHistory(value.lifecycleHistory),
        discoveryError: clean(value.discoveryError, 800),
    };
}

export function applyRosterError(snapshot, roster) {
    if (!roster?.error) return snapshot;
    snapshot.sourceState = {
        ...snapshot.sourceState,
        roster: {
            status: roster.status,
            fetchedAt: roster.fetchedAt || null,
            blobOid: roster.blobOid || "",
            observedOid: roster.observedOid || "",
            error: roster.error,
        },
    };
    snapshot.errors = [
        ...(snapshot.errors || []).filter((error) => error.source !== "roster"),
        { source: "roster", message: roster.error },
    ];
    snapshot.partial = true;
    if (roster.status === "stale") {
        snapshot.stale = true;
        snapshot.staleSources = [...new Set([...(snapshot.staleSources || []), "roster"])];
        const staleFetchedAt = Object.values(snapshot.sourceState)
            .filter((state) => state?.status === "stale")
            .map((state) => Date.parse(state?.fetchedAt || ""))
            .filter(Number.isFinite);
        if (staleFetchedAt.length) {
            snapshot.dayBoundary = utcServerDayBoundary(
                new Date(Math.min(...staleFetchedAt)).toISOString(),
            );
        }
    }
    return snapshot;
}

export async function discoverCurrentRepositoryActivity({
    runJson,
    cwd,
    registry,
    currentRepository,
    members = [],
    previous = null,
}) {
    const normalized = normalizeRegistry(registry);
    let resolvedRepository = String(currentRepository || "");
    let resolvedPrevious = previous;
    if (!resolvedRepository) {
        const identity = await runJson(
            ["repo", "view", "--json", "name,nameWithOwner,url,defaultBranchRef"],
            cwd,
        );
        resolvedRepository = identity?.nameWithOwner || "";
        resolvedPrevious = normalized.snapshots[resolvedRepository.toLowerCase()] || previous;
    }

    const currentKey = resolvedRepository.toLowerCase();
    const registered = normalized.repositories.find(
        (repository) => repository.nameWithOwner.toLowerCase() === currentKey,
    );
    if (registered?.included === false) {
        return { snapshot: resolvedPrevious, refreshed: false };
    }

    const adapter = new GitHubSquadActivityAdapter({ runJson, cwd });
    return {
        snapshot: await adapter.discover({ members, previous: resolvedPrevious }),
        refreshed: true,
    };
}

export class GitHubGlobalActivity {
    constructor({ runJson, cwd, registry = {} }) {
        this.runJson = runJson;
        this.cwd = cwd;
        this.registry = normalizeRegistry(registry);
    }

    async loadRoster(repository) {
        const key = repository.nameWithOwner.toLowerCase();
        const observedOid = clean(repository.squadTeamOid, 160);
        const cached = this.registry.rosters[key];
        if (!observedOid) {
            const missing = {
                blobOid: "",
                observedOid: "",
                members: [],
                status: "missing",
                fetchedAt: new Date().toISOString(),
                error: "The repository does not contain .squad/team.md.",
            };
            this.registry.rosters[key] = missing;
            return missing;
        }
        if (cached?.observedOid === observedOid && cached.status === "fresh") {
            return {
                ...cached,
                members: normalizeMembers(cached.members),
            };
        }

        const fetchedAt = new Date().toISOString();
        try {
            const blob = await this.runJson(
                ["api", `repos/${repository.nameWithOwner}/git/blobs/${observedOid}`],
                this.cwd,
            );
            if (blob?.encoding !== "base64" || typeof blob?.content !== "string") {
                throw new Error("GitHub returned an invalid Squad roster blob.");
            }
            const content = Buffer.from(blob.content.replace(/\s/g, ""), "base64").toString("utf8");
            const members = await parseTeamMarkdown(content);
            const loaded = {
                blobOid: observedOid,
                observedOid,
                members,
                status: "fresh",
                fetchedAt,
                error: "",
            };
            this.registry.rosters[key] = loaded;
            return loaded;
        } catch (error) {
            const priorMembers = normalizeMembers(cached?.members);
            const failed = {
                blobOid: clean(cached?.blobOid, 160),
                observedOid,
                members: priorMembers,
                status: priorMembers.length ? "stale" : "unavailable",
                fetchedAt: cached?.fetchedAt || null,
                error: message(error),
            };
            this.registry.rosters[key] = failed;
            return failed;
        }
    }

    async discoverRepositories({ force = false } = {}) {
        const discoveredAt = this.registry.discoveredAt
            ? Date.parse(this.registry.discoveredAt)
            : Number.NaN;
        if (!force && Number.isFinite(discoveredAt) && Date.now() - discoveredAt < DISCOVERY_TTL) {
            return this.registry;
        }

        const previous = new Map(
            this.registry.repositories.map((repository) => [repository.nameWithOwner.toLowerCase(), repository]),
        );
        const repositories = new Map();
        const affiliated = new Map();
        const addRepository = (repository) => {
            const key = String(repository?.nameWithOwner || "").toLowerCase();
            if (!key || repositories.has(key)) return;
            repositories.set(key, registryRepository(repository, previous.get(key)));
        };
        let cursor = null;
        let viewer = "";
        let rateLimit = null;
        try {
            do {
                const args = ["api", "graphql", "-f", `query=${DISCOVERY_QUERY}`];
                if (cursor) args.push("-f", `cursor=${cursor}`);
                const page = await this.runJson(args, this.cwd);
                viewer = clean(page?.data?.viewer?.login, 120);
                rateLimit = page?.data?.rateLimit || rateLimit;
                const connection = page?.data?.viewer?.repositories;
                for (const repository of connection?.nodes || []) {
                    if (repository?.isArchived) continue;
                    affiliated.set(String(repository.nameWithOwner).toLowerCase(), repository);
                    if (!hasSquadSignal(repository)) continue;
                    addRepository(repository);
                }
                cursor = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
            } while (cursor);

            const fallbackCandidates = [...affiliated.values()].filter((repository) => !hasSquadSignal(repository));
            const signals = { ...this.registry.discoverySignals };
            const needsRestBudget = fallbackCandidates.some((repository) => {
                const signal = signals[String(repository.nameWithOwner).toLowerCase()];
                return force || !signalFresh(signal);
            });
            let restBudget = null;
            if (needsRestBudget) {
                try {
                    const response = await this.runJson(["api", "rate_limit"], this.cwd);
                    const core = response?.resources?.core || {};
                    restBudget = normalizedRestRateLimit(core);
                } catch (error) {
                    restBudget = normalizedRestRateLimit({ error: message(error) });
                }
            } else {
                restBudget = normalizedRestRateLimit(this.registry.restRateLimit);
            }
            const artifactRepositories = await mapConcurrent(
                fallbackCandidates,
                MAX_CONCURRENCY,
                async (repository) => {
                    const key = String(repository.nameWithOwner).toLowerCase();
                    const signal = await probeSquadPrefixedLabels({
                        runJson: this.runJson,
                        cwd: this.cwd,
                        repository,
                        cached: signals[key] || (previous.has(key)
                            ? { detected: true, checkedAt: null, labels: [] }
                            : null),
                        budget: restBudget,
                        force,
                    });
                    signals[key] = signal;
                    if (signal.detected) return repository;
                    try {
                        const results = await this.runJson(
                            [
                                "search", "issues", "squad_artifact",
                                "--match", "comments",
                                "--state", "open",
                                "--limit", "1",
                                "--repo", repository.nameWithOwner,
                                "--json", "repository",
                            ],
                            this.cwd,
                        );
                        const artifactDetected = Array.isArray(results) && results.some(
                            (item) => repositoryNameFromSearch(item).toLowerCase() === key,
                        );
                        return artifactDetected || (signal.error && previous.has(key))
                            ? repository
                            : null;
                    } catch {
                        return previous.has(key) ? repository : null;
                    }
                },
            );
            for (const repository of artifactRepositories) {
                if (!repository) continue;
                addRepository({
                    ...repository,
                    issues: { totalCount: 1 },
                });
            }

            this.registry.viewer = viewer;
            this.registry.repositories = [...repositories.values()];
            this.registry.discoveredAt = new Date().toISOString();
            this.registry.rateLimit = rateLimit;
            this.registry.restRateLimit = {
                ...normalizedRestRateLimit(restBudget),
                error: restBudget?.error || "",
            };
            this.registry.discoverySignals = Object.fromEntries(
                [...affiliated.keys()]
                    .filter((key) => signals[key])
                    .map((key) => [key, signals[key]]),
            );
            const signalErrors = [...affiliated.keys()]
                .map((key) => signals[key]?.error
                    ? `${affiliated.get(key).nameWithOwner}: ${signals[key].error}`
                    : "")
                .filter(Boolean);
            this.registry.discoveryError = clean(
                [restBudget?.error, ...signalErrors].filter(Boolean).join("; "),
                800,
            );
        } catch (error) {
            this.registry.discoveryError = message(error);
        }
        return this.registry;
    }

    setIncluded(nameWithOwner, included) {
        const repository = this.registry.repositories.find(
            (candidate) => candidate.nameWithOwner.toLowerCase() === String(nameWithOwner).toLowerCase(),
        );
        if (repository) {
            repository.included = Boolean(included);
            this.registry.lifecycleHistory = setLifecycleRepositoryIncluded(
                this.registry.lifecycleHistory,
                repository.nameWithOwner,
                repository.included,
            );
        }
        return Boolean(repository);
    }

    async refresh({
        currentRepository,
        currentSnapshot = null,
        currentSnapshotRefreshed = true,
        currentMembers = [],
        currentSquadDetected = false,
        forceDiscovery = false,
        forceAll = false,
    }) {
        const currentKey = String(currentRepository || "").toLowerCase();
        const observedKeys = new Set();
        const previousCurrent = this.registry.repositories.find(
            (repository) => repository.nameWithOwner.toLowerCase() === currentKey,
        );
        await this.discoverRepositories({ force: forceDiscovery });
        if (currentSnapshot?.repository?.nameWithOwner) {
            this.registry.snapshots[currentKey] = currentSnapshot;
            if (currentSnapshotRefreshed) observedKeys.add(currentKey);
            let current = this.registry.repositories.find(
                (repository) => repository.nameWithOwner.toLowerCase() === currentKey,
            );
            if (!current && (currentSquadDetected || currentSnapshot.goals?.length)) {
                current = registryRepository({
                    ...currentSnapshot.repository,
                    nameWithOwner: currentRepository,
                    squadSource: {},
                    squadTeam: previousCurrent?.squadTeamOid
                        ? { oid: previousCurrent.squadTeamOid }
                        : null,
                }, previousCurrent);
                this.registry.repositories.unshift(current);
            }
            if (current && currentSnapshotRefreshed) {
                current.lastAttemptedRefresh = currentSnapshot.fetchedAt;
                if (isCompleteActivitySnapshot(currentSnapshot)) {
                    current.lastSuccessfulRefresh = currentSnapshot.fetchedAt;
                }
                current.lastActivityAt = currentSnapshot.goals?.[0]?.updatedAt || null;
                current.partial = Boolean(currentSnapshot.partial);
                current.stale = Boolean(currentSnapshot.stale);
                current.staleSources = [...(currentSnapshot.staleSources || [])];
                current.error = currentSnapshot.errors?.length
                    ? currentSnapshot.errors.map((error) => `${error.source}: ${error.message}`).join("; ").slice(0, 800)
                    : "";
            }
        }

        const now = Date.now();
        const remaining = Number(this.registry.rateLimit?.remaining);
        const resetAt = this.registry.rateLimit?.resetAt
            ? Date.parse(this.registry.rateLimit.resetAt)
            : Number.NaN;
        const lowGraphqlRateLimit = Number.isFinite(remaining) && remaining < 100 &&
            (!Number.isFinite(resetAt) || resetAt > now);
        const restRemaining = this.registry.restRateLimit?.remaining === null ||
            this.registry.restRateLimit?.remaining === undefined
            ? Number.NaN
            : Number(this.registry.restRateLimit.remaining);
        const restResetAt = this.registry.restRateLimit?.resetAt
            ? Date.parse(this.registry.restRateLimit.resetAt)
            : Number.NaN;
        const lowRestRateLimit = Number.isFinite(restRemaining) &&
            restRemaining <= REST_RATE_LIMIT_RESERVE &&
            (!Number.isFinite(restResetAt) || restResetAt > now);
        const lowRateLimit = lowGraphqlRateLimit || lowRestRateLimit;
        const limitingResetTimes = [
            lowGraphqlRateLimit ? resetAt : Number.NaN,
            lowRestRateLimit ? restResetAt : Number.NaN,
        ].filter(Number.isFinite);
        const rateLimitResetAt = limitingResetTimes.length > 0
            ? new Date(Math.max(...limitingResetTimes)).toISOString()
            : null;
        const candidates = this.registry.repositories.filter((repository) => {
            if (!repository.included) return false;
            if (lowRateLimit && repository.nameWithOwner.toLowerCase() !== currentKey) return false;
            const snapshot = this.registry.snapshots[repository.nameWithOwner.toLowerCase()];
            return forceAll || repositoryRefreshDue(repository, snapshot, currentRepository, now);
        });

        await mapConcurrent(candidates, MAX_CONCURRENCY, async (repository) => {
            const key = repository.nameWithOwner.toLowerCase();
            if (key === currentKey && currentSnapshot) return;
            repository.lastAttemptedRefresh = new Date().toISOString();
            const previous = this.registry.snapshots[key] || null;
            try {
                const roster = key === currentKey
                    ? { members: currentMembers, status: "fresh", error: "" }
                    : repository.squadDetected
                        ? await this.loadRoster(repository)
                        : { members: [], status: "skipped", error: "" };
                const adapter = new GitHubSquadActivityAdapter({
                    runJson: this.runJson,
                    cwd: this.cwd,
                    repository: repository.nameWithOwner,
                });
                const snapshot = applyRosterError(await adapter.discover({
                    members: roster.members,
                    previous,
                    includeWorkflowRuns: key === currentKey ||
                        Number(previous?.summary?.active || 0) > 0 ||
                        Boolean(previous?.sourceState?.workflowRuns?.error) ||
                        ["stale", "unavailable"].includes(previous?.sourceState?.workflowRuns?.status),
                }), roster);
                this.registry.snapshots[key] = snapshot;
                observedKeys.add(key);
                if (isCompleteActivitySnapshot(snapshot)) {
                    repository.lastSuccessfulRefresh = snapshot.fetchedAt;
                }
                repository.lastActivityAt = snapshot.goals?.[0]?.updatedAt || repository.lastActivityAt;
                repository.partial = Boolean(snapshot.partial);
                repository.stale = Boolean(snapshot.stale);
                repository.staleSources = [...(snapshot.staleSources || [])];
                repository.error = snapshot.errors?.length
                    ? snapshot.errors.map((error) => `${error.source}: ${error.message}`).join("; ").slice(0, 800)
                    : "";
            } catch (error) {
                repository.error = message(error);
                repository.partial = true;
                repository.stale = Boolean(previous);
            }
        });

        const included = this.registry.repositories.filter((repository) => repository.included);
        let snapshots = included
            .map((repository) => this.registry.snapshots[repository.nameWithOwner.toLowerCase()])
            .filter(Boolean);
        const preliminary = aggregateActivitySnapshots({
            snapshots,
            currentRepository,
            viewer: this.registry.viewer,
            repositories: this.registry.repositories.map(({ ...repository }) => repository),
            errors: this.registry.discoveryError
                ? [{ source: "repository discovery", message: this.registry.discoveryError }]
                : lowRateLimit
                    ? [{
                        source: "rate limit",
                        message: rateLimitResetAt
                            ? `Background refresh paused until ${rateLimitResetAt}; the current repository still refreshes.`
                            : "Background refresh paused due to the low GitHub API rate limit; the current repository still refreshes.",
                    }]
                    : [],
        });
        const snapshotByRepository = new Map(snapshots.map((snapshot) => [
            snapshot.repository?.nameWithOwner?.toLowerCase(),
            snapshot,
        ]));
        for (const repository of included) {
            const key = repository.nameWithOwner.toLowerCase();
            const snapshot = this.registry.snapshots[key];
            if (!snapshot) continue;
            const aggregateGoals = preliminary.goals.filter(
                (goal) => goal.repository?.nameWithOwner?.toLowerCase() === key,
            );
            const dependencyKeys = [...new Set(aggregateGoals.flatMap((goal) =>
                (goal.dependencies || []).map((dependency) => dependency.repository?.toLowerCase())
                    .filter(Boolean)))];
            const dependencySnapshots = dependencyKeys
                .map((dependencyKey) => snapshotByRepository.get(dependencyKey))
                .filter(Boolean);
            const dependencySourceState = Object.fromEntries(dependencySnapshots.flatMap(
                (dependencySnapshot) => Object.entries(dependencySnapshot.sourceState || {})
                    .map(([source, state]) => [
                        `dependency:${dependencySnapshot.repository.nameWithOwner}:${source}`,
                        state,
                    ]),
            ));
            const dependencyChanged = dependencyKeys.some((dependencyKey) => observedKeys.has(dependencyKey));
            const observingOwner = observedKeys.has(key);
            const aggregateSnapshot = {
                ...snapshot,
                fetchedAt: observingOwner ? snapshot.fetchedAt : preliminary.fetchedAt,
                goals: aggregateGoals,
                sourceState: {
                    ...snapshot.sourceState,
                    ...dependencySourceState,
                },
                partial: Boolean(snapshot.partial) ||
                    !observingOwner ||
                    dependencySnapshots.some((dependencySnapshot) =>
                        dependencySnapshot.partial || dependencySnapshot.stale),
                stale: Boolean(snapshot.stale) ||
                    dependencySnapshots.some((dependencySnapshot) => dependencySnapshot.stale),
                errors: [
                    ...(snapshot.errors || []),
                    ...dependencySnapshots.flatMap((dependencySnapshot) =>
                        dependencySnapshot.errors || []),
                ],
            };
            if (observingOwner || dependencyChanged) {
                const observed = observeLifecycleSnapshot(
                    this.registry.lifecycleHistory,
                    aggregateSnapshot,
                    { included: true },
                );
                this.registry.lifecycleHistory = observed.lifecycleHistory;
                this.registry.snapshots[key] = attachLifecycleHistory(
                    snapshot,
                    this.registry.lifecycleHistory,
                );
            } else {
                this.registry.snapshots[key] = attachLifecycleHistory(
                    snapshot,
                    this.registry.lifecycleHistory,
                );
            }
        }
        snapshots = included
            .map((repository) => this.registry.snapshots[repository.nameWithOwner.toLowerCase()])
            .filter(Boolean);
        return aggregateActivitySnapshots({
            snapshots,
            currentRepository,
            viewer: this.registry.viewer,
            repositories: this.registry.repositories.map(({ ...repository }) => repository),
            errors: preliminary.errors
                .filter((error) => !error.repository)
                .map(({ source, message: errorMessage }) => ({ source, message: errorMessage })),
        });
    }
}

export const refreshPolicy = {
    activeMilliseconds: ACTIVE_TTL,
    inactiveMilliseconds: INACTIVE_TTL,
    discoveryMilliseconds: DISCOVERY_TTL,
};
