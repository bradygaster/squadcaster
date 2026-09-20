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

export class GitHubSquadActivityAdapter {
    constructor({ runJson, cwd, repository = "" }) {
        this.runJson = runJson;
        this.cwd = cwd;
        this.repository = repository;
    }

    async discover({ members = [], previous = null, includeWorkflowRuns = true } = {}) {
        let repository = previous?.repository || {};
        const errors = [];
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
            errors.push({ source: "repository", message: errorMessage(error) });
        }

        const sources = includeWorkflowRuns
            ? SOURCES
            : SOURCES.filter((source) => source.key !== "workflowRuns");
        const results = await Promise.allSettled(
            sources.map((source) => this.runJson(
                [...source.args, ...(this.repository ? ["--repo", this.repository] : [])],
                this.cwd,
            )),
        );
        const data = { issues: [], pullRequests: [], workflowRuns: [] };
        results.forEach((result, index) => {
            const source = sources[index];
            const key = source.key || source.name;
            if (result.status === "fulfilled" && Array.isArray(result.value)) {
                data[key] = result.value;
            } else {
                errors.push({
                    source: source.name,
                    message: result.status === "rejected"
                        ? errorMessage(result.reason)
                        : "GitHub returned an unexpected response.",
                });
            }
        });

        const issueFailure = errors.some((error) => error.source === "issues");
        if (issueFailure && previous?.goals?.length) {
            return {
                ...previous,
                fetchedAt: new Date().toISOString(),
                errors,
                stale: true,
            };
        }
        return buildActivitySnapshot({ repository, members, errors, ...data });
    }
}
