export const BOOTSTRAP_IDENTIFIERS = Object.freeze({
    workflow: "Squad Bootstrap",
    castBranch: "squad/bootstrap-cast",
    castPullRequestTitle: "[squad] Cast your Squad",
    researchIssueTitle: "[Research Proposals] Agent-discovered repo opportunities",
    researchIssueMarker: "<!-- squad:bootstrap-opportunities schema=1 -->",
    researchArtifactKind: "research",
    researchSchemaVersion: "1",
    researchAuthor: "github-actions[bot]",
});

export const BOOTSTRAP_STATUSES = Object.freeze([
    "pending",
    "delayed",
    "partial",
    "failed",
    "retried",
    "complete",
    "ambiguous",
    "malformed",
    "opted_out",
    "unknown",
]);

const FAILURE_CONCLUSIONS = new Set([
    "failure",
    "cancelled",
    "timed_out",
    "startup_failure",
    "action_required",
]);
const ACTIVE_RUN_STATUSES = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
const SOURCE_STATUSES = new Set(["fresh", "stale", "unavailable"]);
const RESEARCH_KEYS = ["origin_issue", "phases", "schema_version", "squad_artifact"];
const DEFAULT_DELAY_MS = 15 * 60 * 1000;
const DEFAULT_DISCOVERY_INTERVAL_MS = 5 * 60 * 1000;

function text(value, maxLength = 1000) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function timestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function occurrenceCount(value, needle) {
    return String(value ?? "").split(needle).length - 1;
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function authorLogin(comment) {
    return text(comment?.author?.login || comment?.user?.login, 160);
}

function pullHead(pullRequest) {
    return text(pullRequest?.headRefName || pullRequest?.head?.ref, 240);
}

function pullBase(pullRequest) {
    return text(pullRequest?.baseRefName || pullRequest?.base?.ref, 240);
}

function objectUrl(value) {
    return text(value?.url || value?.html_url, 500);
}

function reason(code, source, message, value = {}) {
    return {
        code,
        source,
        message,
        number: Number.isInteger(Number(value?.number)) ? Number(value.number) : null,
        commentId: text(value?.commentId || value?.id || value?.databaseId, 120) || null,
        url: objectUrl(value),
    };
}

function normalizeRepository(repository) {
    const nameWithOwner = text(repository?.nameWithOwner || repository?.fullName, 300);
    const defaultBranch = text(
        repository?.defaultBranch || repository?.defaultBranchRef?.name,
        240,
    );
    if (!nameWithOwner || !/^[^/\s]+\/[^/\s]+$/.test(nameWithOwner) || !defaultBranch) {
        throw new TypeError("Bootstrap classification requires repository.nameWithOwner and repository.defaultBranch.");
    }
    return { nameWithOwner, defaultBranch };
}

function normalizeSourceState(sourceState, name) {
    const value = sourceState?.[name];
    const status = value?.status === undefined ? "fresh" : text(value.status, 40).toLowerCase();
    if (!SOURCE_STATUSES.has(status)) {
        throw new TypeError(`Bootstrap source ${name} has unsupported status ${status || "(empty)"}.`);
    }
    return {
        status,
        fetchedAt: timestamp(value?.fetchedAt),
        error: text(value?.error, 800),
    };
}

function normalizePullRequest(pullRequest) {
    const mergedAt = timestamp(pullRequest?.mergedAt || pullRequest?.merged_at);
    const state = mergedAt || pullRequest?.merged === true
        ? "merged"
        : text(pullRequest?.state || "unknown", 40).toLowerCase();
    return {
        number: Number(pullRequest?.number) || null,
        title: text(pullRequest?.title, 240),
        url: objectUrl(pullRequest),
        state,
        draft: Boolean(pullRequest?.isDraft ?? pullRequest?.draft),
        branch: pullHead(pullRequest),
        baseBranch: pullBase(pullRequest),
        createdAt: timestamp(pullRequest?.createdAt || pullRequest?.created_at),
        updatedAt: timestamp(pullRequest?.updatedAt || pullRequest?.updated_at),
        mergedAt,
        source: pullRequest,
    };
}

function normalizeIssue(issue) {
    return {
        number: Number(issue?.number) || null,
        title: text(issue?.title, 240),
        body: String(issue?.body ?? ""),
        url: objectUrl(issue),
        state: text(issue?.state || "unknown", 40).toLowerCase(),
        createdAt: timestamp(issue?.createdAt || issue?.created_at),
        updatedAt: timestamp(issue?.updatedAt || issue?.updated_at),
        closedAt: timestamp(issue?.closedAt || issue?.closed_at),
        source: issue,
    };
}

function normalizeRun(run) {
    return {
        id: Number(run?.databaseId || run?.id) || null,
        workflow: text(run?.workflowName || run?.workflow?.name || run?.name, 160),
        name: text(run?.displayTitle || run?.name || run?.workflowName || "Workflow run", 240),
        branch: text(run?.headBranch || run?.head_branch, 240),
        status: text(run?.status || "unknown", 40).toLowerCase(),
        conclusion: text(run?.conclusion, 40).toLowerCase(),
        url: objectUrl(run),
        createdAt: timestamp(run?.createdAt || run?.created_at),
        updatedAt: timestamp(run?.updatedAt || run?.updated_at),
    };
}

function normalizeWorkflow(workflow) {
    return {
        name: text(workflow?.name || workflow?.workflowName, 160),
        path: text(workflow?.path, 300),
        state: text(workflow?.state || "active", 40).toLowerCase(),
        url: objectUrl(workflow),
        createdAt: timestamp(workflow?.createdAt || workflow?.created_at),
        updatedAt: timestamp(workflow?.updatedAt || workflow?.updated_at),
        observedAt: timestamp(workflow?.observedAt),
    };
}

function structuredBlocks(comment) {
    return [...String(comment?.body ?? "").matchAll(
        /Structured data:\s*```json\s*([\s\S]*?)```/gi,
    )].map((match) => match[1]);
}

function inspectResearchComments(comments, issueNumber) {
    const valid = [];
    const unsupported = [];
    const ignored = [];
    const malformedReasons = [];
    const ambiguousReasons = [];

    for (const comment of comments) {
        const blocks = structuredBlocks(comment);
        const researchEnvelopes = [];
        let researchParseFailure = false;
        for (const block of blocks) {
            let envelope;
            try {
                envelope = JSON.parse(block);
            } catch {
                if (/squad_artifact|research/i.test(block)) researchParseFailure = true;
                continue;
            }
            if (envelope?.squad_artifact === BOOTSTRAP_IDENTIFIERS.researchArtifactKind) {
                researchEnvelopes.push(envelope);
            }
        }

        if (researchParseFailure) {
            malformedReasons.push(reason(
                "malformed-research-envelope",
                "comments",
                "A structured research block is not valid JSON.",
                comment,
            ));
        }
        if (researchEnvelopes.length > 1) {
            ambiguousReasons.push(reason(
                "multiple-research-envelopes",
                "comments",
                "A comment contains multiple structured research envelopes.",
                comment,
            ));
        }

        for (const envelope of researchEnvelopes) {
            const observed = {
                commentId: text(comment?.id || comment?.databaseId, 120) || null,
                url: objectUrl(comment),
                author: authorLogin(comment),
                createdAt: timestamp(comment?.createdAt || comment?.created_at),
                schemaVersion: envelope.schema_version ?? null,
                originIssue: envelope.origin_issue ?? null,
                phases: envelope.phases,
                envelope,
            };
            if (observed.author !== BOOTSTRAP_IDENTIFIERS.researchAuthor) {
                ignored.push({ ...observed, reason: "non-canonical-author" });
                continue;
            }
            if (typeof envelope.schema_version !== "string") {
                malformedReasons.push(reason(
                    "malformed-research-envelope",
                    "comments",
                    "A canonical-author research envelope has a missing or invalid schema_version type.",
                    comment,
                ));
                continue;
            }
            if (envelope.schema_version !== BOOTSTRAP_IDENTIFIERS.researchSchemaVersion) {
                unsupported.push(observed);
                continue;
            }
            const keys = Object.keys(envelope).sort();
            const exactKeys = JSON.stringify(keys) === JSON.stringify(RESEARCH_KEYS);
            const canonical = exactKeys &&
                envelope.squad_artifact === BOOTSTRAP_IDENTIFIERS.researchArtifactKind &&
                envelope.origin_issue === issueNumber &&
                Array.isArray(envelope.phases) &&
                envelope.phases.length === 0;
            if (!canonical) {
                malformedReasons.push(reason(
                    envelope.origin_issue !== issueNumber
                        ? "conflicting-research-origin"
                        : "malformed-research-envelope",
                    "comments",
                    "A schema-1 research envelope does not have the exact canonical keys, origin, or empty phases.",
                    comment,
                ));
                continue;
            }
            valid.push(observed);
        }
    }

    if (valid.length > 1) {
        for (const artifact of valid) {
            ambiguousReasons.push({
                code: "duplicate-research-artifact",
                source: "comments",
                message: "More than one canonical bootstrap research artifact exists.",
                number: issueNumber,
                commentId: artifact.commentId,
                url: artifact.url,
            });
        }
    }
    return { valid, unsupported, ignored, malformedReasons, ambiguousReasons };
}

function candidateSets({ pullRequests, issues, comments, repository }) {
    const castCandidates = pullRequests
        .map(normalizePullRequest)
        .filter((pullRequest) =>
            pullRequest.branch === BOOTSTRAP_IDENTIFIERS.castBranch ||
            pullRequest.title === BOOTSTRAP_IDENTIFIERS.castPullRequestTitle);
    const issueCandidates = issues
        .map(normalizeIssue)
        .filter((issue) =>
            issue.title === BOOTSTRAP_IDENTIFIERS.researchIssueTitle ||
            issue.body.includes(BOOTSTRAP_IDENTIFIERS.researchIssueMarker));
    const ambiguousReasons = [];
    const malformedReasons = [];

    if (castCandidates.length > 1) {
        for (const pullRequest of castCandidates) {
            ambiguousReasons.push(reason(
                "duplicate-cast-pull-request",
                "pullRequests",
                "More than one pull request matches the canonical Cast branch or title.",
                pullRequest,
            ));
        }
    }
    for (const pullRequest of castCandidates) {
        if (
            pullRequest.branch !== BOOTSTRAP_IDENTIFIERS.castBranch ||
            pullRequest.title !== BOOTSTRAP_IDENTIFIERS.castPullRequestTitle ||
            pullRequest.baseBranch !== repository.defaultBranch
        ) {
            malformedReasons.push(reason(
                "malformed-cast-pull-request",
                "pullRequests",
                "A Cast candidate does not have the exact canonical branch, title, and default-branch base.",
                pullRequest,
            ));
        }
    }

    if (issueCandidates.length > 1) {
        for (const issue of issueCandidates) {
            ambiguousReasons.push(reason(
                "duplicate-research-issue",
                "issues",
                "More than one issue matches the canonical research title or marker.",
                issue,
            ));
        }
    }
    for (const issue of issueCandidates) {
        if (
            issue.title !== BOOTSTRAP_IDENTIFIERS.researchIssueTitle ||
            occurrenceCount(issue.body, BOOTSTRAP_IDENTIFIERS.researchIssueMarker) !== 1
        ) {
            malformedReasons.push(reason(
                "malformed-research-issue",
                "issues",
                "A research issue candidate does not have the exact title and one durable marker.",
                issue,
            ));
        }
    }

    const uniqueIssue = issueCandidates.length === 1 ? issueCandidates[0] : null;
    const uniquePullRequest = castCandidates.length === 1 ? castCandidates[0] : null;
    if (uniqueIssue && uniquePullRequest) {
        const linkedPullRequestNumbers = [
            ...uniqueIssue.body.matchAll(new RegExp(
                `https://github\\.com/${escapeRegExp(repository.nameWithOwner)}/pull/([1-9][0-9]*)\\b`,
                "g",
            )),
        ].map((match) => Number(match[1]));
        if (
            linkedPullRequestNumbers.length > 0 &&
            !linkedPullRequestNumbers.includes(uniquePullRequest.number)
        ) {
            ambiguousReasons.push(reason(
                "conflicting-cast-link",
                "issues",
                "The canonical research issue links repository pull requests but not the canonical Cast pull request.",
                uniqueIssue,
            ));
        }
    }
    const research = uniqueIssue
        ? inspectResearchComments(comments, uniqueIssue.number)
        : { valid: [], unsupported: [], ignored: [], malformedReasons: [], ambiguousReasons: [] };
    ambiguousReasons.push(...research.ambiguousReasons);
    malformedReasons.push(...research.malformedReasons);

    return {
        castCandidates,
        issueCandidates,
        research,
        ambiguousReasons,
        malformedReasons,
    };
}

export function selectAutomaticBootstrapCandidates({
    repository,
    pullRequests = [],
    issues = [],
} = {}) {
    const normalizedRepository = normalizeRepository(repository);
    if (!Array.isArray(pullRequests) || !Array.isArray(issues)) {
        throw new TypeError("Bootstrap candidate selection requires pullRequests and issues arrays.");
    }
    const candidates = candidateSets({
        pullRequests,
        issues,
        comments: [],
        repository: normalizedRepository,
    });
    const canonicalCastPullRequest = candidates.castCandidates.length === 1 &&
        candidates.castCandidates[0].branch === BOOTSTRAP_IDENTIFIERS.castBranch &&
        candidates.castCandidates[0].title === BOOTSTRAP_IDENTIFIERS.castPullRequestTitle &&
        candidates.castCandidates[0].baseBranch === normalizedRepository.defaultBranch
        ? candidates.castCandidates[0]
        : null;
    const canonicalResearchIssue = candidates.issueCandidates.length === 1 &&
        candidates.issueCandidates[0].title === BOOTSTRAP_IDENTIFIERS.researchIssueTitle &&
        occurrenceCount(
            candidates.issueCandidates[0].body,
            BOOTSTRAP_IDENTIFIERS.researchIssueMarker,
        ) === 1
        ? candidates.issueCandidates[0]
        : null;
    return {
        repository: normalizedRepository.nameWithOwner,
        castPullRequests: candidates.castCandidates,
        researchIssues: candidates.issueCandidates,
        canonicalCastPullRequest,
        canonicalResearchIssue,
        reasons: [...candidates.ambiguousReasons, ...candidates.malformedReasons],
    };
}

function sourceGuard({ sourceState, candidates, previous, workflowRuns }) {
    const required = ["pullRequests", "issues"];
    const uniqueCast = candidates.castCandidates.length === 1
        ? candidates.castCandidates[0]
        : null;
    const uniqueIssue = candidates.issueCandidates.length === 1
        ? candidates.issueCandidates[0]
        : null;
    const structurallyValidIssue = uniqueIssue &&
        uniqueIssue.title === BOOTSTRAP_IDENTIFIERS.researchIssueTitle &&
        occurrenceCount(uniqueIssue.body, BOOTSTRAP_IDENTIFIERS.researchIssueMarker) === 1;
    if (
        structurallyValidIssue ||
        previous?.researchIssue ||
        previous?.researchArtifact
    ) {
        required.push("comments");
    }
    const closedUnmerged = uniqueCast?.state === "closed" && !uniqueCast.mergedAt;
    const complete = uniqueCast && uniqueIssue && candidates.research.valid.length === 1;
    const partial = Boolean(uniqueCast) || Boolean(uniqueIssue);
    const artifactDecision = candidates.ambiguousReasons.length > 0 ||
        candidates.malformedReasons.length > 0 ||
        closedUnmerged ||
        complete ||
        partial;
    if (!artifactDecision) {
        required.push("workflowRuns");
        if (workflowRuns.length === 0 && sourceState?.workflows !== undefined) {
            required.push("workflows");
        }
    }

    const normalized = Object.fromEntries(
        [...new Set(required)].map((name) => [name, normalizeSourceState(sourceState, name)]),
    );
    const guarded = Object.entries(normalized)
        .filter(([, value]) => value.status !== "fresh");
    return {
        sources: normalized,
        guarded,
        staleSources: guarded.map(([name]) => name),
        reasons: guarded.map(([name, value]) => ({
            code: value.status === "stale" ? "stale-source" : "unavailable-source",
            source: name,
            message: `${name} is ${value.status}; bootstrap state cannot advance safely.`,
            number: null,
            commentId: null,
            url: "",
        })),
    };
}

function lastChangedAt(run) {
    return run?.updatedAt || run?.createdAt || null;
}

function ageAtLeast(value, nowMs, durationMs) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) && nowMs - parsed >= durationMs;
}

function resultBase({
    repository,
    status,
    reasons,
    castPullRequest,
    researchIssue,
    researchArtifact,
    research,
    workflowAttempts,
    sources,
}) {
    return {
        schemaVersion: 1,
        repository: repository.nameWithOwner,
        status,
        stale: false,
        staleSources: [],
        reasons,
        castPullRequest,
        researchIssue,
        researchArtifact,
        unsupportedResearchArtifacts: research.unsupported,
        ignoredResearchArtifacts: research.ignored,
        workflowAttempts,
        sources,
    };
}

export function classifyAutomaticBootstrap({
    repository,
    pullRequests = [],
    issues = [],
    comments = [],
    workflowRuns = [],
    workflows = [],
    sourceState = {},
    previous = null,
    now = new Date().toISOString(),
    delayedAfterMs = DEFAULT_DELAY_MS,
    discoveryIntervalMs = DEFAULT_DISCOVERY_INTERVAL_MS,
} = {}) {
    const normalizedRepository = normalizeRepository(repository);
    for (const [name, value] of Object.entries({
        pullRequests,
        issues,
        comments,
        workflowRuns,
        workflows,
    })) {
        if (!Array.isArray(value)) {
            throw new TypeError(`Bootstrap classification requires ${name} to be an array.`);
        }
    }
    if (!Number.isFinite(delayedAfterMs) || delayedAfterMs < 0) {
        throw new TypeError("delayedAfterMs must be a non-negative finite number.");
    }
    if (!Number.isFinite(discoveryIntervalMs) || discoveryIntervalMs < 0) {
        throw new TypeError("discoveryIntervalMs must be a non-negative finite number.");
    }
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new TypeError("Bootstrap classification requires a valid now timestamp.");

    const candidates = candidateSets({
        pullRequests,
        issues,
        comments,
        repository: normalizedRepository,
    });
    const guard = sourceGuard({ sourceState, candidates, previous, workflowRuns });
    if (guard.guarded.length > 0) {
        const priorClassification = previous?.lastClassified || previous;
        const retained = priorClassification && BOOTSTRAP_STATUSES.includes(priorClassification.status)
            ? {
                ...priorClassification,
                stale: false,
                staleSources: [],
                reasons: (priorClassification.reasons || []).filter((item) =>
                    !["stale-source", "unavailable-source"].includes(item.code)),
                lastClassified: undefined,
            }
            : {
                schemaVersion: 1,
                repository: normalizedRepository.nameWithOwner,
                status: "unknown",
                reasons: [],
                castPullRequest: null,
                researchIssue: null,
                researchArtifact: null,
                unsupportedResearchArtifacts: [],
                ignoredResearchArtifacts: [],
                workflowAttempts: [],
            };
        return {
            ...retained,
            repository: normalizedRepository.nameWithOwner,
            stale: true,
            staleSources: guard.staleSources,
            reasons: [...(retained.reasons || []), ...guard.reasons],
            sources: guard.sources,
            lastClassified: retained.status === "unknown" ? null : retained,
        };
    }

    const castPullRequest = candidates.castCandidates.length === 1
        ? candidates.castCandidates[0]
        : null;
    const researchIssue = candidates.issueCandidates.length === 1
        ? candidates.issueCandidates[0]
        : null;
    const researchArtifact = candidates.research.valid.length === 1
        ? candidates.research.valid[0]
        : null;
    const workflowAttempts = workflowRuns
        .map(normalizeRun)
        .filter((run) =>
            run.workflow === BOOTSTRAP_IDENTIFIERS.workflow &&
            run.branch === normalizedRepository.defaultBranch)
        .sort((left, right) =>
            String(lastChangedAt(left)).localeCompare(String(lastChangedAt(right))) ||
            Number(left.id || 0) - Number(right.id || 0));
    const installedWorkflows = workflows
        .map(normalizeWorkflow)
        .filter((workflow) =>
            workflow.name === BOOTSTRAP_IDENTIFIERS.workflow &&
            workflow.state !== "disabled");
    const common = {
        repository: normalizedRepository,
        castPullRequest,
        researchIssue,
        researchArtifact,
        research: candidates.research,
        workflowAttempts,
        sources: guard.sources,
    };

    if (candidates.ambiguousReasons.length > 0) {
        return resultBase({
            ...common,
            status: "ambiguous",
            reasons: [...candidates.ambiguousReasons, ...candidates.malformedReasons],
        });
    }
    if (candidates.malformedReasons.length > 0) {
        return resultBase({
            ...common,
            status: "malformed",
            reasons: candidates.malformedReasons,
        });
    }
    if (castPullRequest?.state === "closed" && !castPullRequest.mergedAt) {
        return resultBase({
            ...common,
            status: "opted_out",
            reasons: [reason(
                "closed-unmerged-cast-pull-request",
                "pullRequests",
                "The canonical Cast pull request was closed without merge.",
                castPullRequest,
            )],
        });
    }
    if (castPullRequest && researchIssue && researchArtifact) {
        return resultBase({ ...common, status: "complete", reasons: [] });
    }

    const newestAttempt = workflowAttempts.at(-1) || null;
    const failedAttempts = workflowAttempts.filter((run) =>
        run.status === "completed" && FAILURE_CONCLUSIONS.has(run.conclusion));
    const latestFailure = failedAttempts.at(-1) || null;
    const newerThanFailure = latestFailure &&
        newestAttempt !== latestFailure &&
        String(lastChangedAt(newestAttempt)) > String(lastChangedAt(latestFailure));
    const retryAdvanced = newerThanFailure && (
        ACTIVE_RUN_STATUSES.has(newestAttempt.status) ||
        (newestAttempt.status === "completed" && newestAttempt.conclusion === "success")
    );
    if (retryAdvanced) {
        return resultBase({
            ...common,
            status: "retried",
            reasons: [reason(
                "newer-attempt-after-failure",
                "workflowRuns",
                "A newer canonical workflow attempt follows a terminal failed attempt.",
                newestAttempt,
            )],
        });
    }

    const validArtifactCount = Number(Boolean(castPullRequest)) + Number(Boolean(researchIssue));
    if (validArtifactCount === 1 || (castPullRequest && researchIssue && !researchArtifact)) {
        const reasons = [];
        if (!castPullRequest) {
            reasons.push(reason(
                "missing-cast-pull-request",
                "pullRequests",
                "The canonical Cast pull request is absent.",
            ));
        }
        if (!researchIssue) {
            reasons.push(reason(
                "missing-research-issue",
                "issues",
                "The canonical research issue is absent.",
            ));
        }
        if (castPullRequest && researchIssue && !researchArtifact) {
            reasons.push(reason(
                candidates.research.unsupported.length > 0
                    ? "unsupported-research-schema"
                    : "missing-research-artifact",
                "comments",
                candidates.research.unsupported.length > 0
                    ? "Research evidence uses an unsupported schema and cannot advance bootstrap state."
                    : "The canonical schema-1 research artifact is absent.",
                candidates.research.unsupported[0] || {},
            ));
        }
        return resultBase({ ...common, status: "partial", reasons });
    }

    if (
        newestAttempt?.status === "completed" &&
        FAILURE_CONCLUSIONS.has(newestAttempt.conclusion)
    ) {
        return resultBase({
            ...common,
            status: "failed",
            reasons: [reason(
                "latest-workflow-attempt-failed",
                "workflowRuns",
                "The newest canonical workflow attempt ended with a failure conclusion.",
                newestAttempt,
            )],
        });
    }

    const activeAttempt = newestAttempt && ACTIVE_RUN_STATUSES.has(newestAttempt.status)
        ? newestAttempt
        : null;
    const activeAttemptDelayed = activeAttempt &&
        ageAtLeast(lastChangedAt(activeAttempt), nowMs, delayedAfterMs);
    const installedWorkflow = installedWorkflows.at(-1) || null;
    const installedObservedAt = installedWorkflow?.observedAt ||
        installedWorkflow?.updatedAt ||
        installedWorkflow?.createdAt;
    const installedWithoutRunDelayed = installedWorkflow &&
        workflowAttempts.length === 0 &&
        ageAtLeast(installedObservedAt, nowMs, discoveryIntervalMs + delayedAfterMs);
    if (activeAttemptDelayed || installedWithoutRunDelayed) {
        return resultBase({
            ...common,
            status: "delayed",
            reasons: [reason(
                activeAttemptDelayed ? "pending-attempt-delayed" : "installed-workflow-delayed",
                activeAttemptDelayed ? "workflowRuns" : "workflows",
                activeAttemptDelayed
                    ? "The pending canonical workflow attempt has not changed within the delay threshold."
                    : "The installed canonical workflow has no observed run or artifact after a discovery interval and delay threshold.",
                activeAttempt || installedWorkflow,
            )],
        });
    }

    if (newestAttempt || installedWorkflow) {
        return resultBase({
            ...common,
            status: "pending",
            reasons: [reason(
                newestAttempt ? "workflow-attempt-pending" : "bootstrap-evidence-pending",
                newestAttempt ? "workflowRuns" : "workflows",
                newestAttempt
                    ? "The canonical workflow attempt is awaiting materialization evidence."
                    : "Canonical bootstrap materialization evidence has not been observed.",
                newestAttempt || installedWorkflow,
            )],
        });
    }

    return resultBase({
        ...common,
        status: "unknown",
        reasons: [reason(
            "bootstrap-not-observed",
            "workflows",
            "No canonical automatic-bootstrap workflow, run, or artifact has been observed.",
        )],
    });
}
