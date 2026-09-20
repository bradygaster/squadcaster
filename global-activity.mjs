import { aggregateActivitySnapshots } from "./activity-model.mjs";
import { GitHubSquadActivityAdapter } from "./github-activity.mjs";

const DISCOVERY_TTL = 15 * 60 * 1000;
const ACTIVE_TTL = 60 * 1000;
const INACTIVE_TTL = 10 * 60 * 1000;
const MAX_CONCURRENCY = 3;
const REPOSITORY_PAGE_SIZE = 40;

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

function repositoryFromSearch(result) {
    const value = result?.repository;
    const nameWithOwner = clean(value?.nameWithOwner || value?.fullName, 300);
    if (!nameWithOwner.includes("/")) return null;
    return {
        name: nameWithOwner.split("/").at(-1),
        nameWithOwner,
        url: clean(value?.url || `https://github.com/${nameWithOwner}`),
        viewerPermission: "read",
        squadSource: {},
        issues: { totalCount: 1 },
        pullRequests: { totalCount: 0 },
    };
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
        error: previous.error || "",
    };
}

function due(repository, snapshot, currentRepository, now) {
    if (repository.nameWithOwner.toLowerCase() === currentRepository.toLowerCase()) return true;
    const last = repository.lastAttemptedRefresh
        ? Date.parse(repository.lastAttemptedRefresh)
        : Number.NaN;
    const active = Number(snapshot?.summary?.active || 0) > 0;
    return !Number.isFinite(last) || now - last >= (active ? ACTIVE_TTL : INACTIVE_TTL);
}

async function mapConcurrent(items, limit, mapper) {
    const results = new Array(items.length);
    let cursor = 0;
    async function worker() {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await mapper(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

export function normalizeRegistry(value = {}) {
    return {
        version: 1,
        viewer: clean(value.viewer, 120),
        discoveredAt: value.discoveredAt || null,
        rateLimit: value.rateLimit || null,
        repositories: Array.isArray(value.repositories) ? value.repositories : [],
        snapshots: value.snapshots && typeof value.snapshots === "object" ? value.snapshots : {},
        discoveryError: clean(value.discoveryError, 800),
    };
}

export class GitHubGlobalActivity {
    constructor({ runJson, cwd, registry = {} }) {
        this.runJson = runJson;
        this.cwd = cwd;
        this.registry = normalizeRegistry(registry);
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
        const repositories = [];
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
                    if (repository?.isArchived || !hasSquadSignal(repository)) continue;
                    repositories.push(registryRepository(
                        repository,
                        previous.get(String(repository.nameWithOwner).toLowerCase()),
                    ));
                }
                cursor = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
            } while (cursor);

            const searches = await Promise.allSettled([
                this.runJson(
                    ["search", "issues", "--label", "squad", "--state", "open", "--limit", "1000", "--json", "repository"],
                    this.cwd,
                ),
                this.runJson(
                    ["search", "issues", "squad_artifact", "--match", "comments", "--state", "open", "--limit", "1000", "--json", "repository"],
                    this.cwd,
                ),
            ]);
            const byName = new Map(repositories.map((repository) => [repository.nameWithOwner.toLowerCase(), repository]));
            for (const result of searches) {
                if (result.status !== "fulfilled") continue;
                for (const item of Array.isArray(result.value) ? result.value : []) {
                    const repository = repositoryFromSearch(item);
                    if (!repository || byName.has(repository.nameWithOwner.toLowerCase())) continue;
                    const normalized = registryRepository(
                        repository,
                        previous.get(repository.nameWithOwner.toLowerCase()),
                    );
                    repositories.push(normalized);
                    byName.set(normalized.nameWithOwner.toLowerCase(), normalized);
                }
            }

            this.registry.viewer = viewer;
            this.registry.repositories = repositories;
            this.registry.discoveredAt = new Date().toISOString();
            this.registry.rateLimit = rateLimit;
            this.registry.discoveryError = "";
        } catch (error) {
            this.registry.discoveryError = message(error);
        }
        return this.registry;
    }

    setIncluded(nameWithOwner, included) {
        const repository = this.registry.repositories.find(
            (candidate) => candidate.nameWithOwner.toLowerCase() === String(nameWithOwner).toLowerCase(),
        );
        if (repository) repository.included = Boolean(included);
        return Boolean(repository);
    }

    async refresh({
        currentRepository,
        currentSnapshot = null,
        currentMembers = [],
        currentSquadDetected = false,
        forceDiscovery = false,
        forceAll = false,
    }) {
        await this.discoverRepositories({ force: forceDiscovery });
        const currentKey = String(currentRepository || "").toLowerCase();
        if (currentSnapshot?.repository?.nameWithOwner) {
            this.registry.snapshots[currentKey] = currentSnapshot;
            let current = this.registry.repositories.find(
                (repository) => repository.nameWithOwner.toLowerCase() === currentKey,
            );
            if (!current && (currentSquadDetected || currentSnapshot.goals?.length)) {
                current = registryRepository({
                    ...currentSnapshot.repository,
                    nameWithOwner: currentRepository,
                    squadSource: {},
                });
                this.registry.repositories.unshift(current);
            }
            if (current) {
                current.lastSuccessfulRefresh = currentSnapshot.fetchedAt;
                current.lastAttemptedRefresh = currentSnapshot.fetchedAt;
                current.lastActivityAt = currentSnapshot.goals?.[0]?.updatedAt || null;
                current.error = "";
            }
        }

        const now = Date.now();
        const lowRateLimit = Number(this.registry.rateLimit?.remaining) < 100 &&
            Date.parse(this.registry.rateLimit?.resetAt || 0) > now;
        const candidates = this.registry.repositories.filter((repository) => {
            if (!repository.included) return false;
            if (lowRateLimit && repository.nameWithOwner.toLowerCase() !== currentKey) return false;
            const snapshot = this.registry.snapshots[repository.nameWithOwner.toLowerCase()];
            return forceAll || due(repository, snapshot, currentRepository, now);
        });

        await mapConcurrent(candidates, MAX_CONCURRENCY, async (repository) => {
            const key = repository.nameWithOwner.toLowerCase();
            if (key === currentKey && currentSnapshot) return;
            repository.lastAttemptedRefresh = new Date().toISOString();
            const previous = this.registry.snapshots[key] || null;
            try {
                const adapter = new GitHubSquadActivityAdapter({
                    runJson: this.runJson,
                    cwd: this.cwd,
                    repository: repository.nameWithOwner,
                });
                const snapshot = await adapter.discover({
                    members: key === currentKey ? currentMembers : [],
                    previous,
                    includeWorkflowRuns: key === currentKey || Number(previous?.summary?.active || 0) > 0,
                });
                this.registry.snapshots[key] = snapshot;
                repository.lastSuccessfulRefresh = snapshot.fetchedAt;
                repository.lastActivityAt = snapshot.goals?.[0]?.updatedAt || repository.lastActivityAt;
                repository.error = snapshot.errors?.length
                    ? snapshot.errors.map((error) => `${error.source}: ${error.message}`).join("; ").slice(0, 800)
                    : "";
            } catch (error) {
                repository.error = message(error);
            }
        });

        const included = this.registry.repositories.filter((repository) => repository.included);
        const snapshots = included
            .map((repository) => this.registry.snapshots[repository.nameWithOwner.toLowerCase()])
            .filter(Boolean);
        return aggregateActivitySnapshots({
            snapshots,
            currentRepository,
            viewer: this.registry.viewer,
            repositories: this.registry.repositories.map(({ ...repository }) => repository),
            errors: this.registry.discoveryError
                ? [{ source: "repository discovery", message: this.registry.discoveryError }]
                : lowRateLimit
                    ? [{
                        source: "rate limit",
                        message: `Background refresh paused until ${this.registry.rateLimit.resetAt}; the current repository still refreshes.`,
                    }]
                    : [],
        });
    }
}

export const refreshPolicy = {
    activeMilliseconds: ACTIVE_TTL,
    inactiveMilliseconds: INACTIVE_TTL,
    discoveryMilliseconds: DISCOVERY_TTL,
};
