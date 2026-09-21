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
            "--json", "number,title,body,state,url,isDraft,headRefName,author,labels,createdAt,updatedAt,closedAt,mergedAt,reviewDecision,statusCheckRollup,closingIssuesReferences",
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

function errorMessage(error) {
    return String(error?.message || error || "Unknown GitHub error").trim().slice(0, 800);
}

function priorIssues(previous) {
    return (previous?.goals || []).map((goal) => ({
        ...goal.issue,
        labels: goal.issue?.labels || [],
        comments: (goal.artifacts || []).map((artifact) => ({
            body: `\`\`\`json\n${JSON.stringify({
                squad_artifact: artifact.kind,
                schema_version: artifact.schemaVersion,
                origin_issue: artifact.originIssue,
                phases: artifact.phases,
            })}\n\`\`\``,
            createdAt: artifact.createdAt,
            url: artifact.url,
        })),
    }));
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

function previousSource(previous, key) {
    const cached = previous?.sourceState?.[key];
    if (cached && Array.isArray(cached.data)) return cached;
    const fallback = key === "issues"
        ? priorIssues(previous)
        : key === "pullRequests"
            ? priorPullRequests(previous)
            : priorWorkflowRuns(previous);
    return {
        data: fallback,
        fetchedAt: previous?.fetchedAt || null,
        status: previous ? "fresh" : "skipped",
        error: "",
    };
}

export class GitHubSquadActivityAdapter {
    constructor({ runJson, cwd, repository = "" }) {
        this.runJson = runJson;
        this.cwd = cwd;
        this.repository = repository;
    }

    async discover({ members = [], previous = null, includeWorkflowRuns = true } = {}) {
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

        const sourceErrors = SOURCES
            .map((source) => {
                const key = source.key || source.name;
                return sourceState[key].error
                    ? { source: source.name, message: sourceState[key].error }
                    : null;
            })
            .filter(Boolean);
        return buildActivitySnapshot({
            repository,
            members,
            sourceState,
            errors: [...repositoryErrors, ...sourceErrors],
            fetchedAt: attemptedAt,
        });
    }
}
