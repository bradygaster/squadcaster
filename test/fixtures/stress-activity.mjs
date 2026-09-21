const PHASES = ["queued", "researching", "implementing", "reviewing", "completed", "blocked", "failed"];

function timestamp(offsetMinutes) {
    return new Date(Date.UTC(2026, 8, 21, 18, 0) - offsetMinutes * 60_000).toISOString();
}

function longText(prefix, size) {
    return `${prefix} ${"deterministic-production-scale-content-".repeat(Math.ceil(size / 39))}`.slice(0, size);
}

function goal(repository, repositoryIndex, goalIndex) {
    const number = repositoryIndex * 1000 + goalIndex + 1;
    const phase = PHASES[(repositoryIndex + goalIndex) % PHASES.length];
    const id = `${repository.nameWithOwner}#${number}`;
    const owner = longText(`Owner ${repositoryIndex}-${goalIndex}`, 96);
    const pullRequests = Array.from({ length: 4 }, (_, pullRequestIndex) => ({
        number: number * 10 + pullRequestIndex,
        title: longText(`Pull request ${pullRequestIndex}`, 180),
        url: `https://example.test/${repository.nameWithOwner}/pull/${number * 10 + pullRequestIndex}`,
        state: pullRequestIndex === 0 ? "open" : "closed",
        draft: pullRequestIndex === 0,
        reviewDecision: pullRequestIndex === 0 ? "review_required" : "approved",
        branch: longText(`squad/implement-${number}`, 180),
        checks: Array.from({ length: 16 }, (_, checkIndex) => ({
            name: longText(`Check ${checkIndex}`, 120),
            status: checkIndex % 9 === 0 ? "failure" : "success",
            url: `https://example.test/check/${number}-${checkIndex}`,
        })),
    }));
    const workflowRuns = Array.from({ length: 10 }, (_, runIndex) => ({
        id: number * 100 + runIndex,
        name: longText(`Workflow run ${runIndex}`, 180),
        workflow: longText(`Workflow ${runIndex}`, 120),
        status: runIndex < 2 ? "in_progress" : "completed",
        conclusion: runIndex < 2 ? "" : "success",
        url: `https://example.test/run/${number}-${runIndex}`,
        branch: longText(`squad/implement-${number}`, 180),
        createdAt: timestamp(goalIndex * 20 + runIndex),
        updatedAt: timestamp(goalIndex * 20 + runIndex),
    }));
    const dependencies = Array.from({ length: 8 }, (_, dependencyIndex) => ({
        id: `${repository.nameWithOwner}#${number + dependencyIndex + 1}`,
        repository: repository.nameWithOwner,
        issueNumber: number + dependencyIndex + 1,
        title: longText(`Dependency ${dependencyIndex}`, 180),
        url: `https://example.test/${repository.nameWithOwner}/issues/${number + dependencyIndex + 1}`,
        status: dependencyIndex % 2 ? "open" : "closed",
        phase: dependencyIndex % 2 ? "queued" : "completed",
    }));
    const evidence = Array.from({ length: 30 }, (_, evidenceIndex) => ({
        kind: ["issue", "owner", "artifact", "workflow", "pull-request", "check"][evidenceIndex % 6],
        title: longText(`Evidence ${evidenceIndex}`, 170),
        url: `https://example.test/evidence/${number}-${evidenceIndex}`,
        timestamp: timestamp(goalIndex * 30 + evidenceIndex),
        confidence: evidenceIndex % 5 === 0 ? "inferred" : "observed",
    }));

    return {
        id,
        repository,
        issue: {
            number,
            title: longText(`Goal ${number}`, 240),
            body: longText("Issue body", 900),
            state: phase === "completed" ? "closed" : "open",
            url: `https://example.test/${repository.nameWithOwner}/issues/${number}`,
        },
        phase,
        phaseWithoutBlockers: phase,
        owner: { id: `owner-${repositoryIndex}-${goalIndex}`, name: owner, source: "assignee" },
        artifacts: [],
        workItems: [],
        pullRequests,
        workflowRuns,
        dependencies,
        blockers: phase === "blocked" ? dependencies.filter((item) => item.phase !== "completed") : [],
        nextAction: phase === "completed" ? "No action required." : "Inspect observed GitHub evidence.",
        evidence,
        updatedAt: timestamp(goalIndex),
    };
}

export function createStressCanvasState() {
    const repositories = Array.from({ length: 10 }, (_, index) => ({
        name: longText(`repository-${index}`, 100),
        nameWithOwner: `very-long-owner-${index}/${longText(`repository-${index}`, 120).replaceAll(" ", "-")}`,
        url: `https://example.test/repository-${index}`,
        owner: `very-long-owner-${index}`,
        included: true,
        permission: index % 3 === 0 ? "read" : "write",
        lastSuccessfulRefresh: timestamp(index),
        error: index === 8 ? "Cached data shown after a deterministic refresh failure." : "",
    }));
    const goals = repositories.flatMap((repository, repositoryIndex) =>
        Array.from({ length: 14 }, (_, goalIndex) => goal(repository, repositoryIndex, goalIndex)));
    const count = (phase) => goals.filter((item) => item.phase === phase).length;

    return {
        version: 4,
        mode: "active",
        repoName: "stress-fixture",
        members: [],
        operation: null,
        squad: { installed: true, rosterAvailable: false, memberCount: 0 },
        activity: {
            schemaVersion: 3,
            scope: "user",
            fetchedAt: timestamp(0),
            dayBoundary: {
                version: 1,
                kind: "utc-server-day",
                timeZone: "UTC",
                snapshotDay: "2026-09-21",
                startsAt: "2026-09-21T00:00:00.000Z",
                nextBoundaryAt: "2026-09-22T00:00:00.000Z",
                cacheKey: "day-boundary-v1:utc:2026-09-21",
            },
            currentRepository: repositories[0].nameWithOwner,
            repositories,
            goals,
            stale: true,
            errors: [{
                source: "GitHub",
                repository: repositories[8].nameWithOwner,
                message: repositories[8].error,
            }],
            summary: {
                active: goals.filter((item) => item.phase !== "completed").length,
                queued: count("queued"),
                blocked: count("blocked"),
                failed: count("failed"),
                awaitingReview: count("reviewing"),
                implementing: count("implementing"),
                researching: count("researching"),
                completed: count("completed"),
            },
        },
    };
}

export function updateStressRepositoryInclusion(state, allGoals, nameWithOwner, included) {
    const repository = state.activity.repositories.find((item) => item.nameWithOwner === nameWithOwner);
    if (!repository) return false;
    repository.included = Boolean(included);
    const includedRepositories = new Set(
        state.activity.repositories
            .filter((item) => item.included)
            .map((item) => item.nameWithOwner),
    );
    state.activity.goals = allGoals.filter((item) =>
        includedRepositories.has(item.repository.nameWithOwner));
    state.activity.errors = state.activity.repositories
        .filter((item) => item.included && item.error)
        .map((item) => ({
            source: "GitHub",
            repository: item.nameWithOwner,
            message: item.error,
        }));
    state.activity.stale = state.activity.errors.length > 0;
    const count = (phase) => state.activity.goals.filter((item) => item.phase === phase).length;
    state.activity.summary = {
        active: state.activity.goals.filter((item) => item.phase !== "completed").length,
        queued: count("queued"),
        blocked: count("blocked"),
        failed: count("failed"),
        awaitingReview: count("reviewing"),
        implementing: count("implementing"),
        researching: count("researching"),
        completed: count("completed"),
    };
    return true;
}
