import {
    deriveHandoff,
    parseActivationEvidence,
    reconcileHandoffDependencies,
} from "./handoff-readiness.mjs";

const ACTIVE_STATES = new Set(["queued", "researching", "implementing", "reviewing", "blocked", "failed"]);
const FAILURE_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out", "startup_failure", "action_required"]);
const DAY_BOUNDARY_VERSION = 1;
const UTC_DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
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

function stableIdentity(value) {
    return [
        value?.repository?.nameWithOwner,
        value?.goal?.id,
        value?.kind,
        value?.id,
        value?.number,
        value?.workflow,
        value?.branch,
        value?.name,
        value?.title,
        value?.url,
        value?.status,
        value?.conclusion,
    ].map((part) => text(part, 500).toLowerCase()).join("|");
}

export function compareNewestFirst(left, right) {
    const leftTimestamp = timestamp(
        left?.timestamp || left?.updatedAt || left?.createdAt || left?.mergedAt,
    );
    const rightTimestamp = timestamp(
        right?.timestamp || right?.updatedAt || right?.createdAt || right?.mergedAt,
    );
    if (leftTimestamp && rightTimestamp && leftTimestamp !== rightTimestamp) {
        return rightTimestamp.localeCompare(leftTimestamp);
    }
    if (leftTimestamp !== rightTimestamp) return leftTimestamp ? -1 : 1;
    return stableIdentity(left).localeCompare(stableIdentity(right));
}

export function dedupeSemantic(items, identity) {
    const values = Array.isArray(items) ? items : [];
    const keyFor = typeof identity === "function" ? identity : stableIdentity;
    const unique = new Map();
    for (const value of [...values].sort(compareNewestFirst)) {
        const key = text(keyFor(value), 2000).toLowerCase();
        if (!unique.has(key)) unique.set(key, value);
    }
    return [...unique.values()].sort(compareNewestFirst);
}

export function utcServerDayBoundary(value = new Date().toISOString()) {
    const observedAt = timestamp(value) || new Date().toISOString();
    const snapshotDay = observedAt.slice(0, 10);
    const startsAt = `${snapshotDay}T00:00:00.000Z`;
    return {
        version: DAY_BOUNDARY_VERSION,
        kind: "utc-server-day",
        timeZone: "UTC",
        snapshotDay,
        startsAt,
        nextBoundaryAt: new Date(Date.parse(startsAt) + UTC_DAY_MILLISECONDS).toISOString(),
        cacheKey: `day-boundary-v${DAY_BOUNDARY_VERSION}:utc:${snapshotDay}`,
    };
}

export function normalizeActivityContract(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
    if (![2, 3].includes(snapshot.schemaVersion)) return null;
    const fetchedAt = timestamp(snapshot.fetchedAt);
    if (!fetchedAt) return null;
    const persistedDay = snapshot.schemaVersion === 3 &&
        /^\d{4}-\d{2}-\d{2}$/.test(snapshot.dayBoundary?.snapshotDay || "")
        ? snapshot.dayBoundary.snapshotDay
        : "";
    const dayBoundary = utcServerDayBoundary(
        persistedDay ? `${persistedDay}T00:00:00.000Z` : fetchedAt,
    );
    if (snapshot.schemaVersion === 3 &&
        snapshot.fetchedAt === fetchedAt &&
        Object.entries(dayBoundary).every(([key, value]) => snapshot.dayBoundary?.[key] === value)) {
        return snapshot;
    }
    return {
        ...snapshot,
        schemaVersion: 3,
        fetchedAt,
        dayBoundary,
    };
}

function normalizedSourceState(value, data, fetchedAt) {
    const status = [
        "fresh",
        "complete",
        "partial",
        "incomplete",
        "stale",
        "unavailable",
        "unauthorized",
        "skipped",
    ].includes(value?.status)
        ? value.status
        : "fresh";
    return {
        data: Array.isArray(value?.data) ? value.data : data,
        fetchedAt: timestamp(value?.fetchedAt || fetchedAt),
        status,
        error: text(value?.error, 800),
        exhaustive: value?.exhaustive !== false,
        truncated: Boolean(value?.truncated),
        enabled: value?.enabled === true,
    };
}

function sourceEvidenceState(state) {
    if (!state) return "unknown";
    if (state.status === "stale") return "stale";
    if (state.status === "unauthorized") return "unauthorized";
    if (state.status === "unavailable") return "unavailable";
    if (
        state.status === "partial" ||
        state.status === "incomplete" ||
        state.exhaustive === false ||
        state.truncated
    ) {
        return "incomplete";
    }
    if (state.status === "fresh" || state.status === "complete") return "complete";
    return "unknown";
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

function linkedIssueLinks(pullRequest, currentRepository) {
    const links = new Map();
    const addLink = (key, method, confidence) => {
        if (!key) return;
        const existing = links.get(key);
        if (!existing || (existing.confidence === "inferred" && confidence === "observed")) {
            links.set(key, { key, method, confidence });
        }
    };
    for (const reference of Array.isArray(pullRequest?.closingIssuesReferences)
        ? pullRequest.closingIssuesReferences
        : []) {
        addLink(
            issueKey(
                closingReferenceRepository(reference, currentRepository),
                reference?.number,
            ),
            "closing-reference",
            "observed",
        );
    }
    for (const match of String(pullRequest?.body || "").matchAll(
        /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#([1-9][0-9]*)\b/gi,
    )) {
        addLink(
            issueKey(match[1] || currentRepository, match[2]),
            "closing-keyword",
            "observed",
        );
    }
    const marker = String(pullRequest?.body || "").match(/<!--\s*squad:implement\s+issue=([1-9][0-9]*)\s+run=/i);
    if (marker) {
        addLink(
            issueKey(currentRepository, marker[1]),
            "squad-implement-marker",
            "observed",
        );
    }
    const branch = String(pullRequest?.headRefName || "").match(/^squad\/implement-([1-9][0-9]*)-/i);
    if (branch) {
        addLink(
            issueKey(currentRepository, branch[1]),
            "implementation-branch",
            "inferred",
        );
    }
    return [...links.values()];
}

function linkedRunNumbers(run) {
    const numbers = new Set(issueReferences(`${run?.displayTitle || ""}\n${run?.name || ""}`));
    const branch = String(run?.headBranch || "").match(/^squad\/implement-([1-9][0-9]*)-/i);
    if (branch) numbers.add(Number(branch[1]));
    return [...numbers];
}

function authoritativeRunNumbers(run) {
    const numbers = new Set();
    const branch = String(run?.headBranch || "").match(/^squad\/implement-([1-9][0-9]*)-/i);
    if (branch) numbers.add(Number(branch[1]));
    if (/squad.*implement|implement.*squad/i.test(`${run?.workflowName || ""}\n${run?.name || ""}`)) {
        for (const number of issueReferences(`${run?.displayTitle || ""}\n${run?.name || ""}`)) {
            numbers.add(number);
        }
    }
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

function normalizeReviewActor(actor) {
    const type = text(actor?.__typename || actor?.type, 40).toLowerCase();
    return {
        login: text(actor?.login || actor?.name, 120),
        type: ["user", "team", "bot", "mannequin", "organization"].includes(type)
            ? type
            : "unknown",
    };
}

function normalizeReview(review) {
    return {
        actor: normalizeReviewActor(review?.author || review?.actor),
        state: text(review?.state || "unknown", 40).toLowerCase(),
        submittedAt: timestamp(review?.submittedAt || review?.submitted_at),
    };
}

function normalizeReviewRequest(request) {
    return {
        actor: normalizeReviewActor(request?.requestedReviewer || request?.actor || request),
    };
}

function normalizePullRequest(pullRequest) {
    const checks = dedupeSemantic(
        (Array.isArray(pullRequest?.statusCheckRollup) ? pullRequest.statusCheckRollup : [])
            .map(normalizeCheck),
        (check) => `${check.name}|${check.url}|${check.status}`,
    );
    const reviews = Array.isArray(pullRequest?.latestReviews)
        ? pullRequest.latestReviews.map(normalizeReview)
        : null;
    const reviewRequests = Array.isArray(pullRequest?.reviewRequests)
        ? pullRequest.reviewRequests.map(normalizeReviewRequest)
        : null;
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
        reviews,
        reviewRequests,
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

function normalizeStep(step) {
    return {
        number: Number(step?.number) || null,
        name: text(step?.name, 240),
        status: text(step?.status, 40).toLowerCase(),
        conclusion: text(step?.conclusion, 40).toLowerCase(),
        startedAt: timestamp(step?.started_at || step?.startedAt),
        completedAt: timestamp(step?.completed_at || step?.completedAt),
    };
}

function normalizeJob(job) {
    return {
        id: Number(job?.id) || null,
        name: text(job?.name, 240),
        status: text(job?.status, 40).toLowerCase(),
        conclusion: text(job?.conclusion, 40).toLowerCase(),
        url: text(job?.html_url || job?.url, 500),
        startedAt: timestamp(job?.started_at || job?.startedAt),
        completedAt: timestamp(job?.completed_at || job?.completedAt),
        steps: (Array.isArray(job?.steps) ? job.steps : []).map(normalizeStep),
    };
}

function normalizeWorkflowJobs(runId, workflowJobs) {
    const entry = workflowJobs.get(runId);
    if (!entry) {
        return {
            status: "not_selected",
            fetchedAt: null,
            error: "",
            truncated: false,
            jobs: null,
        };
    }
    return {
        status: text(entry.status, 40).toLowerCase(),
        fetchedAt: timestamp(entry.fetchedAt),
        error: text(entry.error, 800),
        truncated: Boolean(entry.truncated),
        jobs: Array.isArray(entry.jobs) ? entry.jobs.map(normalizeJob) : null,
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
        .sort(compareNewestFirst)
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

function evidenceFor(issue, pullRequests, workflowRuns, artifacts, owner, pullRequestLinks = new Map()) {
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
        const link = pullRequestLinks.get(pullRequest.number);
        evidence.push({
            kind: "pull-request",
            title: `PR #${pullRequest.number}: ${pullRequest.state}${pullRequest.draft ? " (draft)" : ""}`,
            url: pullRequest.url,
            timestamp: pullRequest.mergedAt || pullRequest.updatedAt || pullRequest.createdAt,
            confidence: link?.confidence || "inferred",
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
    return dedupeSemantic(
        evidence,
        (item) => `${item.kind}|${item.title}|${item.url}`,
    );
}

export function buildActivitySnapshot({
    repository,
    issues = [],
    pullRequests = [],
    workflowRuns = [],
    workflowJobs = [],
    members = [],
    errors = [],
    sourceState = null,
    issueComments = null,
    nativeSubIssues = {},
    copilotTasks = {},
    localSessions = {},
    mechanismAvailability = {},
    fetchedAt = new Date().toISOString(),
} = {}) {
    const normalizedSources = {
        issues: normalizedSourceState(sourceState?.issues, issues, fetchedAt),
        pullRequests: normalizedSourceState(sourceState?.pullRequests, pullRequests, fetchedAt),
        workflowRuns: normalizedSourceState(sourceState?.workflowRuns, workflowRuns, fetchedAt),
        workflowJobs: normalizedSourceState(sourceState?.workflowJobs, workflowJobs, fetchedAt),
        issueComments: normalizedSourceState(
            sourceState?.issueComments,
            Array.isArray(issueComments) ? issueComments : [],
            fetchedAt,
        ),
        subIssues: normalizedSourceState(sourceState?.subIssues, [], fetchedAt),
        copilotTasks: normalizedSourceState(sourceState?.copilotTasks, [], fetchedAt),
        localSessions: normalizedSourceState(sourceState?.localSessions, [], fetchedAt),
    };
    issues = normalizedSources.issues.data;
    pullRequests = normalizedSources.pullRequests.data;
    workflowRuns = normalizedSources.workflowRuns.data;
    workflowJobs = normalizedSources.workflowJobs.data;
    const issueByNumber = new Map(issues.map((issue) => [Number(issue?.number), issue]));
    const repositoryName = text(repository?.nameWithOwner || repository?.name || "repository", 300);
    const repositoryKey = repositoryName.toLowerCase();
    const activationEvidence = parseActivationEvidence({
        issues,
        repository: repositoryKey,
        comments: Array.isArray(issueComments) ? normalizedSources.issueComments.data : null,
        commentsComplete: normalizedSources.issueComments.status === "complete" ||
            (
                normalizedSources.issueComments.status === "fresh" &&
                normalizedSources.issueComments.exhaustive &&
                !normalizedSources.issueComments.truncated
            ),
    });
    const normalizedPullRequests = dedupeSemantic(
        pullRequests.map((pullRequest) => ({
            source: pullRequest,
            value: normalizePullRequest(pullRequest),
            issueLinks: linkedIssueLinks(pullRequest, repositoryKey),
            number: Number(pullRequest?.number) || null,
            url: text(pullRequest?.url, 500),
            createdAt: timestamp(pullRequest?.createdAt),
            updatedAt: timestamp(pullRequest?.updatedAt || pullRequest?.mergedAt),
        })),
        (pullRequest) => pullRequest.value.number || pullRequest.value.url,
    );
    const normalizedRuns = dedupeSemantic(
        workflowRuns.map((run) => ({
            source: run,
            value: normalizeRun(run),
            issueNumbers: linkedRunNumbers(run),
            authoritativeIssueNumbers: authoritativeRunNumbers(run),
            id: Number(run?.databaseId || run?.id) || null,
            url: text(run?.url || run?.html_url, 500),
            workflow: text(run?.workflowName || run?.name, 160),
            branch: text(run?.headBranch, 240),
            createdAt: timestamp(run?.createdAt || run?.created_at),
            updatedAt: timestamp(run?.updatedAt || run?.updated_at),
        })),
        (run) => run.id || run.url ||
            `${run.workflow}|${run.branch}|${run.createdAt}|${run.value.status}|${run.value.conclusion}`,
    );
    const workflowJobsByRun = new Map(workflowJobs
        .map((entry) => [Number(entry?.runId), entry])
        .filter(([runId]) => Number.isInteger(runId) && runId > 0));
    for (const run of normalizedRuns) {
        run.value.jobsState = normalizeWorkflowJobs(run.value.id, workflowJobsByRun);
        run.value.jobs = run.value.jobsState.jobs;
    }
    const goals = [];

    for (const issue of issues) {
        const artifacts = parseArtifacts(issue?.comments);
        if (!isSquadGoal(issue, artifacts)) continue;
        const number = Number(issue?.number);
        const goalKey = issueKey(repositoryKey, number);
        const relatedPullRequestMatches = normalizedPullRequests
            .map((pullRequest) => ({
                value: pullRequest.value,
                link: pullRequest.issueLinks.find((link) => link.key === goalKey),
            }))
            .filter((pullRequest) => pullRequest.link);
        const relatedPullRequests = relatedPullRequestMatches.map((pullRequest) => pullRequest.value);
        const pullRequestLinks = new Map(relatedPullRequestMatches.map((pullRequest) => [
            pullRequest.value.number,
            pullRequest.link,
        ]));
        const authoritativePullRequests = relatedPullRequestMatches
            .filter((pullRequest) =>
                ["closing-reference", "closing-keyword"].includes(pullRequest.link.method))
            .map((pullRequest) => pullRequest.value);
        const relatedRuns = normalizedRuns
            .filter((run) => run.issueNumbers.includes(number) ||
                relatedPullRequests.some((pullRequest) => pullRequest.branch && pullRequest.branch === run.value.branch))
            .map((run) => run.value);
        const authoritativeRuns = normalizedRuns
            .filter((run) => run.authoritativeIssueNumbers.includes(number) ||
                authoritativePullRequests.some((pullRequest) =>
                    pullRequest.branch && pullRequest.branch === run.value.branch))
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
                    ...(blocker ? { evidenceState: sourceEvidenceState(normalizedSources.issues) } : {}),
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
        const goal = {
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
            evidence: evidenceFor(
                issue,
                relatedPullRequests,
                relatedRuns,
                artifacts,
                owner,
                pullRequestLinks,
            ),
            updatedAt: [
                timestamp(issue?.updatedAt),
                ...relatedPullRequests.map((pullRequest) => pullRequest.updatedAt),
                ...relatedRuns.map((run) => run.updatedAt),
            ].filter(Boolean).sort().at(-1) || null,
        };
        goal.handoff = deriveHandoff({
            goalId: goal.id,
            repository: repositoryKey,
            issue,
            issues,
            activationEvidence: activationEvidence.get(number),
            dependencies,
            pullRequests: authoritativePullRequests,
            workflowRuns: authoritativeRuns,
            sourceState: {
                issues: normalizedSources.issues,
                issueAssignees: normalizedSources.issues,
                issueComments: normalizedSources.issueComments,
                subIssues: normalizedSources.subIssues,
                dependencies: normalizedSources.issues,
                pullRequests: normalizedSources.pullRequests,
                workflowRuns: normalizedSources.workflowRuns,
                copilotTasks: normalizedSources.copilotTasks,
                localSessions: normalizedSources.localSessions,
            },
            nativeSubIssues: nativeSubIssues?.[number] || null,
            copilotTasks: copilotTasks?.[number] || [],
            localSessions: localSessions?.[goal.id.toLowerCase()] || [],
            mechanismAvailability,
            evaluatedAt: fetchedAt,
        });
        goals.push(goal);
    }

    goals.sort((left, right) => {
        const leftActive = ACTIVE_STATES.has(left.phase) ? 1 : 0;
        const rightActive = ACTIVE_STATES.has(right.phase) ? 1 : 0;
        return rightActive - leftActive || compareNewestFirst(left, right);
    });
    const count = (phase) => goals.filter((goal) => phase.includes(goal.phase)).length;
    const normalizedErrors = (Array.isArray(errors) ? errors : []).map((error) => ({
        source: text(error?.source || "GitHub", 80),
        message: text(error?.message || error, 800),
    }));
    const staleSources = ["issues", "pullRequests", "workflowRuns", "workflowJobs"]
        .map((source) => [source, normalizedSources[source]])
        .filter(([, state]) => state.status === "stale")
        .map(([source]) => source);
    const incompleteSources = Object.values(normalizedSources)
        .some((state) => [
            "partial",
            "incomplete",
            "stale",
            "unavailable",
            "unauthorized",
        ].includes(state.status) || state.truncated || state.exhaustive === false);
    const normalizedFetchedAt = timestamp(fetchedAt) || new Date().toISOString();
    const retainedStaleFetchedAt = earliestTimestamp(
        Object.values(normalizedSources)
            .filter((state) => state.status === "stale")
            .map((state) => state.fetchedAt),
    );
    return {
        schemaVersion: 3,
        fetchedAt: normalizedFetchedAt,
        dayBoundary: utcServerDayBoundary(retainedStaleFetchedAt || normalizedFetchedAt),
        repository: {
            name: text(repository?.name, 160),
            nameWithOwner: text(repository?.nameWithOwner, 300),
            url: text(repository?.url, 500),
            defaultBranch: text(repository?.defaultBranchRef?.name || repository?.defaultBranch, 240),
        },
        summary: {
            active: goals.filter((goal) => ACTIVE_STATES.has(goal.phase)).length,
            queued: count(["queued"]),
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
    const goals = dedupeSemantic(
        snapshots.flatMap((snapshot) =>
            (Array.isArray(snapshot?.goals) ? snapshot.goals : []).map((goal) => ({
                ...goal,
                dependencies: [...(goal.dependencies || [])],
                blockers: [...(goal.blockers || [])],
            }))),
        (goal) => goal.id,
    );
    const goalsById = new Map(goals.map((goal) => [String(goal.id).toLowerCase(), goal]));
    const snapshotByRepository = new Map(snapshots.map((snapshot) => [
        String(snapshot?.repository?.nameWithOwner || "").toLowerCase(),
        snapshot,
    ]));
    const includedByRepository = new Map(repositories.map((repository) => [
        String(repository?.nameWithOwner || "").toLowerCase(),
        repository?.included !== false,
    ]));
    const observedIssuesById = new Map();
    for (const snapshot of snapshots) {
        const repositoryKey = String(snapshot?.repository?.nameWithOwner || "").toLowerCase();
        for (const issue of snapshot?.sourceState?.issues?.data || []) {
            const key = issueKey(repositoryKey, issue?.number);
            if (!key) continue;
            const observed = observedIssuesById.get(key) || [];
            observed.push(issue);
            observedIssuesById.set(key, observed);
        }
    }

    for (const goal of goals) {
        goal.dependencies = (goal.dependencies || []).map((dependency) => {
            const dependencyRepository = String(dependency.repository || "").toLowerCase();
            const goalRepository = String(goal.repository?.nameWithOwner || "").toLowerCase();
            if (dependencyRepository === goalRepository) return dependency;
            const target = goalsById.get(String(dependency.id).toLowerCase());
            const targetSnapshot = snapshotByRepository.get(dependencyRepository);
            const observedIssues = observedIssuesById.get(String(dependency.id).toLowerCase()) || [];
            const issueSourceState = targetSnapshot?.sourceState?.issues;
            const issueSourceError = (targetSnapshot?.errors || []).some((error) =>
                /^(?:issues?|repository)$/i.test(String(error?.source || "")));
            let evidenceState = sourceEvidenceState(issueSourceState);
            if (includedByRepository.get(dependencyRepository) === false) evidenceState = "excluded";
            else if (!targetSnapshot) evidenceState = "unavailable";
            else if (issueSourceError) evidenceState = "unavailable";
            else if (evidenceState === "complete" && observedIssues.length === 0) evidenceState = "missing";
            else if (evidenceState === "complete" && observedIssues.length > 1) evidenceState = "ambiguous";

            if (target) {
                return {
                    ...dependency,
                    title: target.issue.title,
                    url: target.issue.url,
                    status: target.issue.state,
                    phase: target.phaseWithoutBlockers || target.phase,
                    evidenceState,
                };
            }
            if (observedIssues.length === 1) {
                const observed = observedIssues[0];
                const closed = String(observed?.state || "").toUpperCase() === "CLOSED";
                return {
                    ...dependency,
                    title: text(observed?.title || dependency.title, 240),
                    url: text(observed?.url || dependency.url, 500),
                    status: text(observed?.state || "unknown", 40).toLowerCase(),
                    phase: closed ? "completed" : "unknown",
                    evidenceState,
                };
            }
            return {
                ...dependency,
                evidenceState,
            };
        });
        goal.blockers = goal.dependencies.filter((dependency) => dependency.phase !== "completed");
        goal.handoff = reconcileHandoffDependencies(goal.handoff, goal.dependencies);
        const basePhase = goal.phaseWithoutBlockers || goal.phase;
        goal.phase = goal.blockers.length && !["completed", "failed"].includes(basePhase)
            ? "blocked"
            : basePhase;
        goal.nextAction = nextActionFor(goal.phase, goal.pullRequests, goal.workflowRuns, goal.artifacts);
    }

    goals.sort((left, right) => {
        const leftActive = ACTIVE_STATES.has(left.phase) ? 1 : 0;
        const rightActive = ACTIVE_STATES.has(right.phase) ? 1 : 0;
        return rightActive - leftActive || compareNewestFirst(left, right);
    });
    const count = (phase) => goals.filter((goal) => phase.includes(goal.phase)).length;
    const snapshotErrors = snapshots.flatMap((snapshot) =>
        (snapshot?.errors || []).map((error) => ({
            ...error,
            repository: snapshot?.repository?.nameWithOwner || "",
        })));
    const includedRepositories = repositories.filter((repository) => repository?.included !== false);
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
    const normalizedFetchedAt = timestamp(fetchedAt) || new Date().toISOString();
    const snapshotDays = [...new Set(snapshots
        .map((snapshot) => snapshot?.dayBoundary?.snapshotDay)
        .filter(Boolean))]
        .sort();
    return {
        schemaVersion: 3,
        scope: "user",
        fetchedAt: normalizedFetchedAt,
        dayBoundary: utcServerDayBoundary(normalizedFetchedAt),
        snapshotDays,
        lastAttemptedRefresh: latestTimestamp(attemptedRefreshes) || timestamp(fetchedAt),
        lastSuccessfulRefresh: allRepositoriesSucceeded
            ? earliestTimestamp(successfulRefreshes)
            : null,
        currentRepository: text(currentRepository, 300),
        viewer: text(viewer, 120),
        repositories,
        summary: {
            active: goals.filter((goal) => ACTIVE_STATES.has(goal.phase)).length,
            queued: count(["queued"]),
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
            .some((state) => [
                "partial",
                "incomplete",
                "stale",
                "unavailable",
                "unauthorized",
            ].includes(state?.status) || state?.truncated || state?.exhaustive === false);
}

export const activityModel = {
    phases: ["queued", "researching", "implementing", "reviewing", "blocked", "completed", "failed"],
    schemaVersion: 3,
    dayBoundaryVersion: DAY_BOUNDARY_VERSION,
};
