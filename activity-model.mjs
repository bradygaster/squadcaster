const ACTIVE_STATES = new Set(["queued", "researching", "implementing", "reviewing", "blocked", "failed"]);
const FAILURE_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out", "startup_failure", "action_required"]);
const ARTIFACT_PHASES = {
    research: "researching",
    triage: "researching",
    program: "researching",
    implementation: "researching",
    validation: "researching",
    plan: "researching",
    "scope-accepted": "queued",
    "impl-accepted": "queued",
    "impl-phases-accepted": "queued",
    "plan-accepted": "queued",
    "phases-accepted": "queued",
    activated: "queued",
    "phases-activated": "queued",
};

function text(value, maxLength = 4000) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizedSourceState(value, data, fetchedAt) {
    const status = ["fresh", "stale", "unavailable", "skipped"].includes(value?.status)
        ? value.status
        : "fresh";
    return {
        data: Array.isArray(value?.data) ? value.data : data,
        fetchedAt: timestamp(value?.fetchedAt || fetchedAt),
        status,
        error: text(value?.error, 800),
    };
}

function latestTimestamp(values) {
    return values
        .map(timestamp)
        .filter(Boolean)
        .sort()
        .at(-1) || null;
}

function earliestTimestamp(values) {
    return values
        .map(timestamp)
        .filter(Boolean)
        .sort()
        .at(0) || null;
}

function labelsOf(item) {
    return (Array.isArray(item?.labels) ? item.labels : [])
        .map((label) => text(typeof label === "string" ? label : label?.name, 120))
        .filter(Boolean);
}

function normalizedLabelsOf(item) {
    return labelsOf(item).map((label) => label.toLowerCase());
}

function peopleOf(item) {
    return (Array.isArray(item?.assignees) ? item.assignees : [])
        .map((person) => text(person?.login || person?.name, 120))
        .filter(Boolean);
}

function issueReferences(value) {
    const found = new Set();
    const content = String(value || "");
    for (const match of content.matchAll(/(?:#|issues\/)([1-9][0-9]*)\b/gi)) found.add(Number(match[1]));
    return [...found];
}

function dependencyReferences(body, currentRepository) {
    const found = new Map();
    let inDependencyBlock = false;
    for (const line of String(body || "").split(/\r?\n/)) {
        const heading = /^\s*(?:[-*]\s*)?(?:depends on|blocked by)\s*:/i.test(line);
        if (heading) inDependencyBlock = true;
        else if (!line.trim() || /^#{1,6}\s/.test(line) || !/^\s*[-*]\s+/.test(line)) inDependencyBlock = false;
        if (!heading && !inDependencyBlock) continue;
        for (const match of line.matchAll(
            /(?:https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#|#)([1-9][0-9]*)\b/gi,
        )) {
            const repository = text(match[1] || match[2] || currentRepository, 300).toLowerCase();
            const number = Number(match[3]);
            found.set(`${repository}#${number}`, { repository, number });
        }
    }
    return [...found.values()];
}

function parseArtifacts(comments) {
    const artifacts = [];
    for (const comment of Array.isArray(comments) ? comments : []) {
        const body = String(comment?.body || "");
        const blocks = body.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
        for (const block of blocks) {
            try {
                const value = JSON.parse(block[1]);
                if (!value?.squad_artifact) continue;
                artifacts.push({
                    kind: text(value.squad_artifact, 80),
                    schemaVersion: text(value.schema_version || "unknown", 20),
                    originIssue: Number(value.origin_issue) || null,
                    phases: Array.isArray(value.phases) ? value.phases.slice(0, 100) : [],
                    createdAt: timestamp(comment?.createdAt || comment?.created_at),
                    url: text(comment?.url || comment?.html_url, 500),
                });
            } catch {
                // A fenced block that is not structured Squad data is ordinary issue content.
            }
        }
    }
    return artifacts.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

function isSquadGoal(issue, artifacts) {
    const labels = normalizedLabelsOf(issue);
    const comments = Array.isArray(issue?.comments) ? issue.comments : [];
    return labels.some((label) => label === "squad" || label.startsWith("squad:")) ||
        artifacts.length > 0 ||
        /(^|\s)\/squad(?:\s|$)/i.test(`${issue?.body || ""}\n${comments.map((comment) => comment?.body || "").join("\n")}`) ||
        /^squad\b|\[squad\]/i.test(text(issue?.title));
}

function issueKey(repository, number) {
    const repositoryKey = text(repository, 300).toLowerCase();
    const issueNumber = Number(number);
    return repositoryKey && Number.isInteger(issueNumber)
        ? `${repositoryKey}#${issueNumber}`
        : "";
}

function closingReferenceRepository(reference, currentRepository) {
    const repository = reference?.repository;
    return text(
        repository?.nameWithOwner ||
        (repository?.owner?.login && repository?.name
            ? `${repository.owner.login}/${repository.name}`
            : "") ||
        currentRepository,
        300,
    ).toLowerCase();
}

function linkedIssueKeys(pullRequest, currentRepository) {
    const keys = new Set(
        (Array.isArray(pullRequest?.closingIssuesReferences) ? pullRequest.closingIssuesReferences : [])
            .map((reference) => issueKey(
                closingReferenceRepository(reference, currentRepository),
                reference?.number,
            ))
            .filter(Boolean),
    );
    for (const match of String(pullRequest?.body || "").matchAll(
        /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#([1-9][0-9]*)\b/gi,
    )) {
        keys.add(issueKey(match[1] || currentRepository, match[2]));
    }
    const marker = String(pullRequest?.body || "").match(/<!--\s*squad:implement\s+issue=([1-9][0-9]*)\s+run=/i);
    if (marker) keys.add(issueKey(currentRepository, marker[1]));
    const branch = String(pullRequest?.headRefName || "").match(/^squad\/implement-([1-9][0-9]*)-/i);
    if (branch) keys.add(issueKey(currentRepository, branch[1]));
    return [...keys].filter(Boolean);
}

function linkedRunNumbers(run) {
    const numbers = new Set(issueReferences(`${run?.displayTitle || ""}\n${run?.name || ""}`));
    const branch = String(run?.headBranch || "").match(/^squad\/implement-([1-9][0-9]*)-/i);
    if (branch) numbers.add(Number(branch[1]));
    return [...numbers];
}

function normalizeCheck(check) {
    const conclusion = text(check?.conclusion || check?.state || check?.status, 40).toLowerCase();
    return {
        id: text(check?.name || check?.context || "check", 160),
        name: text(check?.name || check?.context || "Check", 160),
        status: conclusion || "unknown",
        url: text(check?.detailsUrl || check?.targetUrl || check?.url, 500),
        startedAt: timestamp(check?.startedAt),
        completedAt: timestamp(check?.completedAt),
    };
}

function normalizePullRequest(pullRequest) {
    const checks = (Array.isArray(pullRequest?.statusCheckRollup) ? pullRequest.statusCheckRollup : [])
        .map(normalizeCheck);
    const state = pullRequest?.mergedAt
        ? "merged"
        : text(pullRequest?.state || "unknown", 40).toLowerCase();
    return {
        number: Number(pullRequest?.number),
        title: text(pullRequest?.title, 240),
        url: text(pullRequest?.url, 500),
        state,
        draft: Boolean(pullRequest?.isDraft),
        branch: text(pullRequest?.headRefName, 240),
        reviewDecision: text(pullRequest?.reviewDecision || "unknown", 80).toLowerCase(),
        createdAt: timestamp(pullRequest?.createdAt),
        updatedAt: timestamp(pullRequest?.updatedAt),
        mergedAt: timestamp(pullRequest?.mergedAt),
        checks,
    };
}

function normalizeRun(run) {
    return {
        id: Number(run?.databaseId || run?.id) || null,
        name: text(run?.displayTitle || run?.name || run?.workflowName || "Workflow run", 240),
        workflow: text(run?.workflowName || run?.name || "Workflow", 160),
        status: text(run?.status || "unknown", 40).toLowerCase(),
        conclusion: text(run?.conclusion || "", 40).toLowerCase(),
        url: text(run?.url || run?.html_url, 500),
        branch: text(run?.headBranch, 240),
        createdAt: timestamp(run?.createdAt || run?.created_at),
        updatedAt: timestamp(run?.updatedAt || run?.updated_at),
    };
}

function ownerFor(issue, members) {
    const labels = normalizedLabelsOf(issue);
    const member = (Array.isArray(members) ? members : []).find((candidate) => {
        const id = text(candidate?.id).toLowerCase();
        const name = text(candidate?.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return labels.includes(`squad:${id}`) || labels.includes(`squad:${name}`);
    });
    if (member) return { id: member.id, name: member.name, source: "squad-label" };
    const assignee = peopleOf(issue)[0];
    return assignee
        ? { id: assignee, name: assignee, source: "assignee" }
        : { id: "", name: "Unknown", source: "unknown" };
}

function phaseFor({ issue, artifacts, pullRequests, workflowRuns, blockers, ignoreBlockers = false }) {
    if (String(issue?.state).toUpperCase() === "CLOSED" || pullRequests.some((pullRequest) => pullRequest.state === "merged")) {
        return "completed";
    }
    const latestRuns = [...workflowRuns]
        .sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)))
        .filter((run, index, runs) =>
            runs.findIndex((candidate) => `${candidate.workflow}:${candidate.branch}` === `${run.workflow}:${run.branch}`) === index);
    const currentRuns = latestRuns.filter((run) => run.status !== "completed");
    const failedRuns = latestRuns.filter((run) => run.status === "completed" && FAILURE_CONCLUSIONS.has(run.conclusion));
    const failedChecks = pullRequests.flatMap((pullRequest) => pullRequest.checks)
        .filter((check) => FAILURE_CONCLUSIONS.has(check.status));
    if (failedRuns.length > 0 || failedChecks.length > 0) return "failed";
    if ((!ignoreBlockers && blockers.length > 0) ||
        labelsOf(issue).some((label) => /^(blocked|status:blocked)$/i.test(label))) {
        return "blocked";
    }
    if (pullRequests.some((pullRequest) => pullRequest.state === "open" && !pullRequest.draft)) return "reviewing";
    if (pullRequests.some((pullRequest) => pullRequest.state === "open") || currentRuns.length > 0) return "implementing";
    const latestArtifact = artifacts.at(-1);
    return ARTIFACT_PHASES[latestArtifact?.kind] || "queued";
}

function nextActionFor(phase, pullRequests, workflowRuns, artifacts) {
    if (phase === "blocked") return "Resolve the listed dependencies or blocker.";
    if (phase === "failed") return "Inspect the failed workflow or check and retry when corrected.";
    if (phase === "reviewing") return "Review the pull request and required checks.";
    if (phase === "implementing") return "Wait for the active implementation or workflow run.";
    if (phase === "completed") return "No action required.";
    const latestArtifact = artifacts.at(-1)?.kind;
    if (latestArtifact === "research") return "Triage the research findings.";
    if (latestArtifact === "triage") return "Create or approve the program plan.";
    if (["program", "implementation", "validation", "plan"].includes(latestArtifact)) {
        return "Review and accept the plan before activation.";
    }
    if (pullRequests.length === 0 && workflowRuns.length === 0) return "Start the next Squad command from the issue.";
    return "Await the next GitHub event.";
}

function evidenceFor(issue, pullRequests, workflowRuns, artifacts, owner) {
    const evidence = [{
        kind: "issue",
        title: `Issue #${issue.number} is ${text(issue.state || "unknown").toLowerCase()}`,
        url: text(issue.url, 500),
        timestamp: timestamp(issue.updatedAt || issue.createdAt),
        confidence: "observed",
    }];
    if (owner.source !== "unknown") {
        evidence.push({
            kind: "owner",
            title: `Owner ${owner.name} from ${owner.source === "squad-label" ? "Squad label" : "GitHub assignment"}`,
            url: text(issue.url, 500),
            timestamp: timestamp(issue.updatedAt),
            confidence: "observed",
        });
    }
    for (const artifact of artifacts) {
        evidence.push({
            kind: "artifact",
            title: `Squad ${artifact.kind} artifact (schema ${artifact.schemaVersion})`,
            url: artifact.url || text(issue.url, 500),
            timestamp: artifact.createdAt,
            confidence: "observed",
        });
    }
    for (const run of workflowRuns) {
        evidence.push({
            kind: "workflow",
            title: `${run.workflow}: ${run.conclusion || run.status}`,
            url: run.url,
            timestamp: run.updatedAt || run.createdAt,
            confidence: "inferred",
        });
    }
    for (const pullRequest of pullRequests) {
        evidence.push({
            kind: "pull-request",
            title: `PR #${pullRequest.number}: ${pullRequest.state}${pullRequest.draft ? " (draft)" : ""}`,
            url: pullRequest.url,
            timestamp: pullRequest.mergedAt || pullRequest.updatedAt || pullRequest.createdAt,
            confidence: "observed",
        });
        for (const check of pullRequest.checks) {
            evidence.push({
                kind: "check",
                title: `${check.name}: ${check.status}`,
                url: check.url || pullRequest.url,
                timestamp: check.completedAt || check.startedAt,
                confidence: "observed",
            });
        }
    }
    return evidence.sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
}

export function buildActivitySnapshot({
    repository,
    issues = [],
    pullRequests = [],
    workflowRuns = [],
    members = [],
    errors = [],
    sourceState = null,
    fetchedAt = new Date().toISOString(),
} = {}) {
    const normalizedSources = {
        issues: normalizedSourceState(sourceState?.issues, issues, fetchedAt),
        pullRequests: normalizedSourceState(sourceState?.pullRequests, pullRequests, fetchedAt),
        workflowRuns: normalizedSourceState(sourceState?.workflowRuns, workflowRuns, fetchedAt),
    };
    issues = normalizedSources.issues.data;
    pullRequests = normalizedSources.pullRequests.data;
    workflowRuns = normalizedSources.workflowRuns.data;
    const issueByNumber = new Map(issues.map((issue) => [Number(issue?.number), issue]));
    const repositoryName = text(repository?.nameWithOwner || repository?.name || "repository", 300);
    const repositoryKey = repositoryName.toLowerCase();
    const normalizedPullRequests = pullRequests.map((pullRequest) => ({
        source: pullRequest,
        value: normalizePullRequest(pullRequest),
        issueKeys: linkedIssueKeys(pullRequest, repositoryKey),
    }));
    const normalizedRuns = workflowRuns.map((run) => ({
        source: run,
        value: normalizeRun(run),
        issueNumbers: linkedRunNumbers(run),
    }));
    const goals = [];

    for (const issue of issues) {
        const artifacts = parseArtifacts(issue?.comments);
        if (!isSquadGoal(issue, artifacts)) continue;
        const number = Number(issue?.number);
        const goalKey = issueKey(repositoryKey, number);
        const relatedPullRequests = normalizedPullRequests
            .filter((pullRequest) => pullRequest.issueKeys.includes(goalKey))
            .map((pullRequest) => pullRequest.value);
        const relatedRuns = normalizedRuns
            .filter((run) => run.issueNumbers.includes(number) ||
                relatedPullRequests.some((pullRequest) => pullRequest.branch && pullRequest.branch === run.value.branch))
            .map((run) => run.value);
        const dependencies = dependencyReferences(issue?.body, repositoryKey)
            .map((dependency) => {
                const blocker = dependency.repository === repositoryKey
                    ? issueByNumber.get(dependency.number)
                    : null;
                return {
                    id: `${dependency.repository}#${dependency.number}`,
                    repository: dependency.repository,
                    issueNumber: dependency.number,
                    title: text(blocker?.title || "Status unknown", 240),
                    url: text(
                        blocker?.url ||
                        `https://github.com/${dependency.repository}/issues/${dependency.number}`,
                        500,
                    ),
                    status: blocker ? text(blocker.state || "unknown", 40).toLowerCase() : "unknown",
                    phase: blocker && String(blocker.state).toUpperCase() === "CLOSED" ? "completed" : "unknown",
                };
            });
        const blockers = dependencies.filter((dependency) => dependency.phase !== "completed");
        const owner = ownerFor(issue, members);
        const phaseWithoutBlockers = phaseFor({
            issue,
            artifacts,
            pullRequests: relatedPullRequests,
            workflowRuns: relatedRuns,
            blockers: [],
            ignoreBlockers: true,
        });
        const phase = phaseFor({
            issue,
            artifacts,
            pullRequests: relatedPullRequests,
            workflowRuns: relatedRuns,
            blockers,
        });
        goals.push({
            id: `${repositoryName}#${number}`,
            repository: {
                name: text(repository?.name || String(repository?.nameWithOwner || "").split("/").at(-1), 160),
                nameWithOwner: text(repository?.nameWithOwner, 300),
                url: text(repository?.url, 500),
            },
            issue: {
                number,
                title: text(issue?.title, 240),
                body: text(issue?.body, 1800),
                state: text(issue?.state || "unknown", 40).toLowerCase(),
                url: text(issue?.url, 500),
                createdAt: timestamp(issue?.createdAt),
                updatedAt: timestamp(issue?.updatedAt),
                closedAt: timestamp(issue?.closedAt),
                labels: labelsOf(issue),
            },
            phase,
            phaseWithoutBlockers,
            owner,
            artifacts,
            workItems: relatedPullRequests.map((pullRequest) => ({
                id: `pr-${pullRequest.number}`,
                title: pullRequest.title,
                status: pullRequest.state,
                owner,
                pullRequest,
            })),
            pullRequests: relatedPullRequests,
            workflowRuns: relatedRuns,
            dependencies,
            blockers,
            nextAction: nextActionFor(phase, relatedPullRequests, relatedRuns, artifacts),
            evidence: evidenceFor(issue, relatedPullRequests, relatedRuns, artifacts, owner),
            updatedAt: [
                timestamp(issue?.updatedAt),
                ...relatedPullRequests.map((pullRequest) => pullRequest.updatedAt),
                ...relatedRuns.map((run) => run.updatedAt),
            ].filter(Boolean).sort().at(-1) || null,
        });
    }

    goals.sort((left, right) => {
        const leftActive = ACTIVE_STATES.has(left.phase) ? 1 : 0;
        const rightActive = ACTIVE_STATES.has(right.phase) ? 1 : 0;
        return rightActive - leftActive || String(right.updatedAt).localeCompare(String(left.updatedAt));
    });
    const count = (phase) => goals.filter((goal) => phase.includes(goal.phase)).length;
    const normalizedErrors = (Array.isArray(errors) ? errors : []).map((error) => ({
        source: text(error?.source || "GitHub", 80),
        message: text(error?.message || error, 800),
    }));
    const staleSources = Object.entries(normalizedSources)
        .filter(([, state]) => state.status === "stale")
        .map(([source]) => source);
    const incompleteSources = Object.values(normalizedSources)
        .some((state) => ["stale", "unavailable"].includes(state.status));
    return {
        schemaVersion: 1,
        fetchedAt: timestamp(fetchedAt) || new Date().toISOString(),
        repository: {
            name: text(repository?.name, 160),
            nameWithOwner: text(repository?.nameWithOwner, 300),
            url: text(repository?.url, 500),
            defaultBranch: text(repository?.defaultBranchRef?.name || repository?.defaultBranch, 240),
        },
        summary: {
            active: goals.filter((goal) => ACTIVE_STATES.has(goal.phase)).length,
            blocked: count(["blocked"]),
            failed: count(["failed"]),
            awaitingReview: count(["reviewing"]),
            implementing: count(["implementing"]),
            researching: count(["researching"]),
            completed: count(["completed"]),
        },
        goals,
        sourceState: normalizedSources,
        partial: incompleteSources ||
            normalizedErrors.length > 0 ||
            Object.values(normalizedSources).some((state) => Boolean(state.error)),
        stale: staleSources.length > 0,
        staleSources,
        errors: normalizedErrors,
    };
}

export function aggregateActivitySnapshots({
    snapshots = [],
    currentRepository = "",
    repositories = [],
    viewer = "",
    errors = [],
    fetchedAt = new Date().toISOString(),
} = {}) {
    const goals = snapshots.flatMap((snapshot) =>
        (Array.isArray(snapshot?.goals) ? snapshot.goals : []).map((goal) => ({
            ...goal,
            dependencies: [...(goal.dependencies || [])],
            blockers: [...(goal.blockers || [])],
        })));
    const goalsById = new Map(goals.map((goal) => [String(goal.id).toLowerCase(), goal]));

    for (const goal of goals) {
        goal.dependencies = (goal.dependencies || []).map((dependency) => {
            const target = goalsById.get(String(dependency.id).toLowerCase());
            return target
                ? {
                    ...dependency,
                    title: target.issue.title,
                    url: target.issue.url,
                    status: target.issue.state,
                    phase: target.phaseWithoutBlockers || target.phase,
                }
                : dependency;
        });
        goal.blockers = goal.dependencies.filter((dependency) => dependency.phase !== "completed");
        const basePhase = goal.phaseWithoutBlockers || goal.phase;
        goal.phase = goal.blockers.length && !["completed", "failed"].includes(basePhase)
            ? "blocked"
            : basePhase;
        goal.nextAction = nextActionFor(goal.phase, goal.pullRequests, goal.workflowRuns, goal.artifacts);
    }

    goals.sort((left, right) => {
        const leftActive = ACTIVE_STATES.has(left.phase) ? 1 : 0;
        const rightActive = ACTIVE_STATES.has(right.phase) ? 1 : 0;
        return rightActive - leftActive || String(right.updatedAt).localeCompare(String(left.updatedAt));
    });
    const count = (phase) => goals.filter((goal) => phase.includes(goal.phase)).length;
    const snapshotErrors = snapshots.flatMap((snapshot) =>
        (snapshot?.errors || []).map((error) => ({
            ...error,
            repository: snapshot?.repository?.nameWithOwner || "",
        })));
    const includedRepositories = repositories.filter((repository) => repository?.included !== false);
    const snapshotByRepository = new Map(snapshots.map((snapshot) => [
        String(snapshot?.repository?.nameWithOwner || "").toLowerCase(),
        snapshot,
    ]));
    const repositoryErrors = includedRepositories.flatMap((repository) => {
        const snapshot = snapshotByRepository.get(String(repository?.nameWithOwner || "").toLowerCase());
        if (!repository?.error) return [];
        const snapshotErrorsForRepository = snapshot?.errors || [];
        const mirroredSnapshotError = snapshotErrorsForRepository
            .map((error) => `${error.source}: ${error.message}`)
            .join("; ")
            .slice(0, 800);
        const duplicatesSnapshotError = repository.error === mirroredSnapshotError ||
            snapshotErrorsForRepository.some((error) =>
                repository.error === error.message ||
                repository.error === `${error.source}: ${error.message}`);
        if (duplicatesSnapshotError) return [];
        return [{
            source: "repository refresh",
            repository: repository.nameWithOwner,
            message: repository.error,
        }];
    });
    const aggregateErrors = [...snapshotErrors, ...repositoryErrors, ...errors].map((error) => ({
        source: text(error?.source || "GitHub", 80),
        repository: text(error?.repository || "", 300),
        message: text(error?.message || error, 800),
    }));
    const staleSources = snapshots.flatMap((snapshot) =>
        (snapshot?.staleSources || []).map((source) => ({
            repository: snapshot?.repository?.nameWithOwner || "",
            source,
        })));
    const attemptedRefreshes = includedRepositories.map((repository) => repository?.lastAttemptedRefresh);
    const successfulRefreshes = includedRepositories.map((repository) => repository?.lastSuccessfulRefresh);
    const allRepositoriesSucceeded = includedRepositories.length > 0 &&
        successfulRefreshes.every((value) => timestamp(value));
    return {
        schemaVersion: 2,
        scope: "user",
        fetchedAt: timestamp(fetchedAt) || new Date().toISOString(),
        lastAttemptedRefresh: latestTimestamp(attemptedRefreshes) || timestamp(fetchedAt),
        lastSuccessfulRefresh: allRepositoriesSucceeded
            ? earliestTimestamp(successfulRefreshes)
            : null,
        currentRepository: text(currentRepository, 300),
        viewer: text(viewer, 120),
        repositories,
        summary: {
            active: goals.filter((goal) => ACTIVE_STATES.has(goal.phase)).length,
            blocked: count(["blocked"]),
            failed: count(["failed"]),
            awaitingReview: count(["reviewing"]),
            implementing: count(["implementing"]),
            researching: count(["researching"]),
            completed: count(["completed"]),
        },
        goals,
        partial: aggregateErrors.length > 0 ||
            snapshots.some((snapshot) => snapshot?.partial) ||
            includedRepositories.some((repository) => repository?.partial),
        stale: snapshots.some((snapshot) => snapshot?.stale) ||
            includedRepositories.some((repository) => repository?.stale),
        staleSources,
        errors: aggregateErrors,
    };
}

export function isCompleteActivitySnapshot(snapshot) {
    return Boolean(snapshot) &&
        !snapshot.partial &&
        !snapshot.stale &&
        !(snapshot.errors?.length) &&
        !Object.values(snapshot.sourceState || {})
            .some((state) => ["stale", "unavailable"].includes(state?.status));
}

export const activityModel = {
    phases: ["queued", "researching", "implementing", "reviewing", "blocked", "completed", "failed"],
    schemaVersion: 1,
};
