import { buildActivitySnapshot } from "./activity-model.mjs";

const SOURCES = [
    {
        name: "issues",
        args: [
            "issue", "list", "--state", "all", "--limit", "1000",
            "--json", "number,title,body,state,url,labels,assignees,author,createdAt,updatedAt,closedAt,comments,milestone",
        ],
    },
    {
        name: "pull requests",
        key: "pullRequests",
        args: [
            "pr", "list", "--state", "all", "--limit", "1000",
            "--json", "number,title,body,state,url,isDraft,headRefName,author,labels,createdAt,updatedAt,closedAt,mergedAt,reviewDecision,latestReviews,reviewRequests,statusCheckRollup,closingIssuesReferences",
        ],
    },
    {
        name: "workflow runs",
        key: "workflowRuns",
        args: [
            "run", "list", "--limit", "1000",
            "--json", "databaseId,name,displayTitle,event,status,conclusion,workflowName,createdAt,updatedAt,url,headBranch,headSha",
        ],
    },
];
const JOB_RUNS_PER_GOAL = 2;
const JOB_RUNS_PER_REPOSITORY = 20;
const JOBS_PAGE_SIZE = 100;
const JOBS_MAX_PAGES = 10;
const WORKFLOW_JOBS_MAX_REQUESTS = JOB_RUNS_PER_REPOSITORY * JOBS_MAX_PAGES;

function errorMessage(error) {
    return String(error?.message || error || "Unknown GitHub error").trim().slice(0, 800);
}

function priorIssues(previous) {
    const byNumber = new Map();
    for (const goal of previous?.goals || []) {
        const labels = goal.issue?.labels || [];
        const comments = (goal.artifacts || []).map((artifact) => ({
            body: `\`\`\`json\n${JSON.stringify({
                squad_artifact: artifact.kind,
                schema_version: artifact.schemaVersion,
                origin_issue: artifact.originIssue,
                phases: artifact.phases,
            })}\n\`\`\``,
            createdAt: artifact.createdAt,
            url: artifact.url,
        }));
        if (
            !labels.some((label) => label === "squad" || label.startsWith("squad:")) &&
            comments.length === 0 &&
            !/(^|\s)\/squad(?:\s|$)/i.test(goal.issue?.body || "") &&
            !/^squad\b|\[squad\]/i.test(goal.issue?.title || "")
        ) {
            comments.push({ body: "/squad" });
        }
        byNumber.set(Number(goal.issue?.number), {
            ...goal.issue,
            labels,
            comments,
        });
        for (const dependency of goal.dependencies || []) {
            if (
                dependency.repository !== String(previous?.repository?.nameWithOwner || "").toLowerCase() ||
                byNumber.has(Number(dependency.issueNumber))
            ) {
                continue;
            }
            byNumber.set(Number(dependency.issueNumber), {
                number: dependency.issueNumber,
                title: dependency.title,
                body: "",
                state: dependency.phase === "completed" || dependency.status === "closed" ? "CLOSED" : "OPEN",
                url: dependency.url,
                labels: [],
                comments: [],
            });
        }
    }
    return [...byNumber.values()];
}

function priorPullRequests(previous) {
    const byNumber = new Map();
    for (const goal of previous?.goals || []) {
        for (const pullRequest of goal.pullRequests || []) {
            const existing = byNumber.get(Number(pullRequest.number));
            const issueNumbers = new Set(
                (existing?.closingIssuesReferences || []).map((issue) => Number(issue.number)),
            );
            issueNumbers.add(Number(goal.issue?.number));
            byNumber.set(Number(pullRequest.number), {
                number: pullRequest.number,
                title: pullRequest.title,
                url: pullRequest.url,
                state: pullRequest.state,
                isDraft: pullRequest.draft,
                headRefName: pullRequest.branch,
                reviewDecision: pullRequest.reviewDecision,
                ...(Array.isArray(pullRequest.reviews)
                    ? {
                        latestReviews: pullRequest.reviews.map((review) => ({
                            author: review.actor,
                            state: review.state,
                            submittedAt: review.submittedAt,
                        })),
                    }
                    : {}),
                ...(Array.isArray(pullRequest.reviewRequests)
                    ? {
                        reviewRequests: pullRequest.reviewRequests.map((request) => request.actor),
                    }
                    : {}),
                createdAt: pullRequest.createdAt,
                updatedAt: pullRequest.updatedAt,
                mergedAt: pullRequest.mergedAt,
                statusCheckRollup: (pullRequest.checks || []).map((check) => ({
                    name: check.name,
                    conclusion: check.status,
                    detailsUrl: check.url,
                    startedAt: check.startedAt,
                    completedAt: check.completedAt,
                })),
                closingIssuesReferences: [...issueNumbers]
                    .filter(Number.isInteger)
                    .map((number) => ({ number })),
            });
        }
    }
    return [...byNumber.values()];
}

function priorWorkflowRuns(previous) {
    const byId = new Map();
    for (const goal of previous?.goals || []) {
        for (const run of goal.workflowRuns || []) {
            const key = run.id || `${run.workflow}:${run.branch}:${run.updatedAt}`;
            byId.set(key, {
                databaseId: run.id,
                displayTitle: run.name || `Workflow for #${goal.issue?.number}`,
                workflowName: run.workflow,
                status: run.status,
                conclusion: run.conclusion,
                url: run.url,
                headBranch: run.branch,
                createdAt: run.createdAt,
                updatedAt: run.updatedAt,
            });
        }
    }
    return [...byId.values()];
}

function priorWorkflowJobs(previous) {
    const byRunId = new Map();
    for (const goal of previous?.goals || []) {
        for (const run of goal.workflowRuns || []) {
            if (!Number.isInteger(Number(run.id)) || !run.jobsState) continue;
            byRunId.set(Number(run.id), {
                runId: Number(run.id),
                fetchedAt: run.jobsState.fetchedAt,
                status: run.jobsState.status,
                error: run.jobsState.error,
                truncated: Boolean(run.jobsState.truncated),
                jobs: Array.isArray(run.jobs) ? run.jobs : null,
            });
        }
    }
    return [...byRunId.values()];
}

function previousSource(previous, key) {
    const cached = previous?.sourceState?.[key];
    if (cached && Array.isArray(cached.data)) return cached;
    const fallback = key === "issues"
        ? priorIssues(previous)
        : key === "pullRequests"
            ? priorPullRequests(previous)
            : key === "workflowRuns"
                ? priorWorkflowRuns(previous)
                : priorWorkflowJobs(previous);
    return {
        data: fallback,
        fetchedAt: previous?.fetchedAt || null,
        status: previous ? "fresh" : "skipped",
        error: "",
    };
}

function compareRunsNewest(left, right) {
    return String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || "")) ||
        String(right?.createdAt || "").localeCompare(String(left?.createdAt || "")) ||
        Number(right?.id) - Number(left?.id);
}

export function selectWorkflowJobRuns(snapshot) {
    const selected = new Map();
    for (const goal of snapshot?.goals || []) {
        const newest = [...(goal.workflowRuns || [])]
            .filter((run) => Number.isInteger(Number(run?.id)) && Number(run.id) > 0)
            .sort(compareRunsNewest)
            .slice(0, JOB_RUNS_PER_GOAL);
        for (const run of newest) selected.set(Number(run.id), run);
    }
    return [...selected.values()]
        .sort(compareRunsNewest)
        .slice(0, JOB_RUNS_PER_REPOSITORY);
}

function reserveRestRequest(restBudget) {
    if (!restBudget) return true;
    const remaining = Number(restBudget.remaining);
    const reserve = Number(restBudget.reserve);
    if (!Number.isFinite(remaining) || !Number.isFinite(reserve) || remaining <= reserve) {
        return false;
    }
    restBudget.remaining = remaining - 1;
    return true;
}

function restBudgetError(jobs = []) {
    const error = new Error("Workflow jobs REST budget exhausted before the next page request.");
    error.partialJobs = jobs;
    return error;
}

async function fetchRunJobs(runJson, cwd, repository, runId, restBudget) {
    const jobs = [];
    const seenJobIds = new Set();
    let totalCount = null;
    for (let page = 1; page <= JOBS_MAX_PAGES; page += 1) {
        if (!reserveRestRequest(restBudget)) throw restBudgetError(jobs);
        const response = await runJson([
            "api", `repos/${repository}/actions/runs/${runId}/jobs`,
            "--method", "GET",
            "-f", "filter=latest",
            "-f", `per_page=${JOBS_PAGE_SIZE}`,
            "-f", `page=${page}`,
        ], cwd);
        if (!response || !Array.isArray(response.jobs)) {
            throw new Error("GitHub returned an unexpected workflow-jobs response.");
        }
        const observedTotal = Number(response.total_count);
        if (Number.isFinite(observedTotal) && observedTotal >= 0) totalCount = observedTotal;
        for (const job of response.jobs) {
            const jobId = Number(job?.id);
            if (Number.isInteger(jobId) && jobId > 0) {
                if (seenJobIds.has(jobId)) continue;
                seenJobIds.add(jobId);
            }
            jobs.push(job);
        }
        if (totalCount !== null && jobs.length >= totalCount) {
            return { jobs, truncated: false };
        }
        if (response.jobs.length < JOBS_PAGE_SIZE) {
            return { jobs, truncated: totalCount !== null && jobs.length < totalCount };
        }
    }
    return {
        jobs,
        truncated: totalCount === null || jobs.length < totalCount,
    };
}

async function workflowJobsSource({
    runJson,
    cwd,
    repository,
    selectedRuns,
    previous,
    attemptedAt,
    restBudget,
}) {
    if (selectedRuns.length === 0) {
        return {
            data: [],
            fetchedAt: attemptedAt,
            status: "fresh",
            error: "",
        };
    }
    const priorByRunId = new Map((previous?.data || [])
        .map((entry) => [Number(entry?.runId), entry])
        .filter(([runId]) => Number.isInteger(runId) && runId > 0));
    const data = [];
    const errors = [];
    let freshCount = 0;
    let staleCount = 0;
    let unavailableCount = 0;
    let partialCount = 0;

    for (const run of selectedRuns) {
        const runId = Number(run.id);
        try {
            const result = await fetchRunJobs(runJson, cwd, repository, runId, restBudget);
            freshCount += 1;
            if (result.truncated) partialCount += 1;
            data.push({
                runId,
                jobs: result.jobs,
                fetchedAt: attemptedAt,
                status: result.truncated ? "partial" : "fresh",
                error: result.truncated
                    ? `Workflow jobs exceeded the ${JOBS_MAX_PAGES * JOBS_PAGE_SIZE}-job pagination bound.`
                    : "",
                truncated: result.truncated,
            });
            if (result.truncated) errors.push(`run ${runId}: pagination bound reached`);
        } catch (error) {
            const message = errorMessage(error);
            const prior = priorByRunId.get(runId);
            if (prior?.fetchedAt && Array.isArray(prior.jobs)) {
                staleCount += 1;
                data.push({
                    ...prior,
                    runId,
                    status: "stale",
                    error: message,
                });
            } else if (Array.isArray(error?.partialJobs) && error.partialJobs.length > 0) {
                partialCount += 1;
                data.push({
                    runId,
                    jobs: error.partialJobs,
                    fetchedAt: attemptedAt,
                    status: "partial",
                    error: message,
                    truncated: true,
                });
            } else {
                unavailableCount += 1;
                data.push({
                    runId,
                    jobs: null,
                    fetchedAt: null,
                    status: "unavailable",
                    error: message,
                    truncated: false,
                });
            }
            errors.push(`run ${runId}: ${message}`);
        }
    }

    const status = staleCount > 0
        ? "stale"
        : partialCount > 0
            ? "partial"
            : unavailableCount > 0
                ? freshCount > 0 ? "partial" : "unavailable"
                : "fresh";
    return {
        data,
        fetchedAt: freshCount > 0 ? attemptedAt : previous?.fetchedAt || null,
        status,
        error: errors.join("; ").slice(0, 800),
    };
}

export class GitHubSquadActivityAdapter {
    constructor({ runJson, cwd, repository = "" }) {
        this.runJson = runJson;
        this.cwd = cwd;
        this.repository = repository;
    }

    async discover({
        members = [],
        previous = null,
        includeWorkflowRuns = true,
        workflowJobsRestBudget = null,
    } = {}) {
        let repository = previous?.repository || {};
        const repositoryErrors = [];
        try {
            repository = await this.runJson(
                [
                    "repo", "view",
                    ...(this.repository ? [this.repository] : []),
                    "--json", "name,nameWithOwner,url,defaultBranchRef",
                ],
                this.cwd,
            );
        } catch (error) {
            repositoryErrors.push({ source: "repository", message: errorMessage(error) });
        }

        const sources = includeWorkflowRuns
            ? SOURCES
            : SOURCES.filter((source) => source.key !== "workflowRuns");
        const attemptedAt = new Date().toISOString();
        const results = await Promise.allSettled(
            sources.map((source) => this.runJson(
                [...source.args, ...(this.repository ? ["--repo", this.repository] : [])],
                this.cwd,
            )),
        );
        const sourceState = {
            issues: previousSource(previous, "issues"),
            pullRequests: previousSource(previous, "pullRequests"),
            workflowRuns: includeWorkflowRuns
                ? previousSource(previous, "workflowRuns")
                : {
                    ...previousSource(previous, "workflowRuns"),
                    status: previous?.sourceState?.workflowRuns?.status || "skipped",
                },
            workflowJobs: includeWorkflowRuns
                ? previousSource(previous, "workflowJobs")
                : {
                    ...previousSource(previous, "workflowJobs"),
                    status: previous?.sourceState?.workflowJobs?.status || "skipped",
                },
        };
        results.forEach((result, index) => {
            const source = sources[index];
            const key = source.key || source.name;
            if (result.status === "fulfilled" && Array.isArray(result.value)) {
                sourceState[key] = {
                    data: result.value,
                    fetchedAt: attemptedAt,
                    status: "fresh",
                    error: "",
                };
            } else {
                const message = result.status === "rejected"
                    ? errorMessage(result.reason)
                    : "GitHub returned an unexpected response.";
                const prior = sourceState[key];
                const hasAuthoritativePriorState = prior.status !== "unavailable" &&
                    Boolean(prior.fetchedAt);
                sourceState[key] = {
                    ...prior,
                    status: hasAuthoritativePriorState ? "stale" : "unavailable",
                    error: message,
                };
            }
        });

        const provisional = buildActivitySnapshot({
            repository,
            members,
            sourceState,
            errors: repositoryErrors,
            fetchedAt: attemptedAt,
        });
        if (includeWorkflowRuns) {
            const selectedRuns = selectWorkflowJobRuns(provisional);
            const restBudget = selectedRuns.length > 0 && typeof workflowJobsRestBudget === "function"
                ? await workflowJobsRestBudget()
                : workflowJobsRestBudget;
            sourceState.workflowJobs = await workflowJobsSource({
                runJson: this.runJson,
                cwd: this.cwd,
                repository: repository?.nameWithOwner || this.repository,
                selectedRuns,
                previous: previousSource(previous, "workflowJobs"),
                attemptedAt,
                restBudget,
            });
        }

        const sourceErrors = [
            ...SOURCES
            .map((source) => {
                const key = source.key || source.name;
                return sourceState[key].error
                    ? { source: source.name, message: sourceState[key].error }
                    : null;
            })
            .filter(Boolean),
            sourceState.workflowJobs.error
                ? { source: "workflow jobs", message: sourceState.workflowJobs.error }
                : null,
        ].filter(Boolean);
        return buildActivitySnapshot({
            repository,
            members,
            sourceState,
            errors: [...repositoryErrors, ...sourceErrors],
            fetchedAt: attemptedAt,
        });
    }
}

export const workflowJobsPolicy = {
    runsPerGoal: JOB_RUNS_PER_GOAL,
    runsPerRepository: JOB_RUNS_PER_REPOSITORY,
    pageSize: JOBS_PAGE_SIZE,
    maxPages: JOBS_MAX_PAGES,
    maxRequests: WORKFLOW_JOBS_MAX_REQUESTS,
};
