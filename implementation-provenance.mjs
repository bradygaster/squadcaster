export const IMPLEMENTATION_PROVENANCE_LABEL = "Squad implementation provenance:";
export const IMPLEMENTATION_PROVENANCE_SCHEMA =
    "https://bradygaster.github.io/squad/schemas/implementation-provenance/v1";
export const IMPLEMENTATION_PROVENANCE_REVISION = 1;
export const IMPLEMENTATION_PROVENANCE_BOT = "github-actions[bot]";

const SESSION_ID = /^squad-implementation-session\/v1\/[1-9][0-9]*\/[1-9][0-9]*$/;
const TEMPORARY_ID = /#?aw_[A-Za-z0-9_]{3,12}/;
const TOP_LEVEL_KEYS = [
    "schema",
    "schema_version",
    "producer",
    "repository",
    "origin_issue",
    "implementation_session_id",
    "session_origin",
    "workflow_run",
    "pull_request",
    "goals",
    "replaces",
];
const SESSION_ORIGIN_KEYS = ["repository", "workflow", "run_id", "run_attempt"];
const WORKFLOW_RUN_KEYS = ["repository", "workflow", "run_id", "run_attempt", "event"];
const PULL_REQUEST_KEYS = ["repository", "number", "head_ref"];
const GOAL_KEYS = ["repository", "issue", "relationship"];
const REPLACEMENT_KEYS = ["repository", "number"];
const DISPATCH_WORKFLOWS = new Set([
    ".github/workflows/squad.lock.yml",
    ".github/workflows/squad-retro.lock.yml",
]);
const MAX_PULL_REQUESTS = 20;
const COMMENT_PAGE_SIZE = 100;
const COMMENT_MAX_PAGES = 3;
const SOURCE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

function normalizeText(value) {
    return String(value ?? "").replace(/\r\n/g, "\n");
}

function exactKeys(value, keys) {
    return Boolean(value) &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function repositoryName(value) {
    return typeof value === "string" && /^[^/\s]+\/[^/\s]+$/.test(value);
}

function containsUnresolvedSentinel(value) {
    if (typeof value === "string") return value === "self" || TEMPORARY_ID.test(value);
    if (Array.isArray(value)) return value.some(containsUnresolvedSentinel);
    if (value && typeof value === "object") {
        return Object.values(value).some(containsUnresolvedSentinel);
    }
    return false;
}

function provenanceLikeBody(body) {
    const value = normalizeText(body);
    return /Squad implementation provenance/i.test(value) ||
        value.includes(IMPLEMENTATION_PROVENANCE_SCHEMA) ||
        /"(?:schema|schema_version|producer|origin_issue|implementation_session_id|session_origin|workflow_run|pull_request|goals|replaces)"\s*:/.test(value);
}

export function extractImplementationProvenance(body) {
    const lines = normalizeText(body).split("\n");
    const candidates = [];
    let fence = null;
    let htmlComment = false;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (fence) {
            if (new RegExp(`^ {0,3}\\${fence.char}{${fence.length},}[ \\t]*$`).test(line)) {
                fence = null;
            }
            continue;
        }
        if (htmlComment) {
            if (line.includes("-->")) htmlComment = false;
            continue;
        }
        if (line.includes("<!--")) {
            htmlComment = !line.includes("-->");
            continue;
        }
        const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (opening) {
            fence = { char: opening[1][0], length: opening[1].length };
            continue;
        }
        if (line.replace(/[ \t]+$/, "") !== IMPLEMENTATION_PROVENANCE_LABEL) continue;
        let cursor = index + 1;
        while (cursor < lines.length && /^[ \t]*$/.test(lines[cursor])) cursor += 1;
        if (!/^ {0,3}```json[ \t]*$/.test(lines[cursor] || "")) {
            candidates.push({ malformed: true });
            continue;
        }
        cursor += 1;
        const jsonLines = [];
        let closed = false;
        for (; cursor < lines.length; cursor += 1) {
            if (/^ {0,3}`{3,}[ \t]*$/.test(lines[cursor])) {
                closed = true;
                break;
            }
            jsonLines.push(lines[cursor]);
        }
        candidates.push(closed ? { json: jsonLines.join("\n") } : { malformed: true });
        index = closed ? cursor : lines.length;
    }
    if (candidates.length === 0) return null;
    if (candidates.length !== 1 || candidates[0].malformed) return undefined;
    try {
        const value = JSON.parse(candidates[0].json);
        return value && typeof value === "object" && !Array.isArray(value)
            ? value
            : undefined;
    } catch {
        return undefined;
    }
}

function validateGoals(goals, repository, originIssue) {
    if (!Array.isArray(goals) ||
        goals.length === 0 ||
        goals.some((goal) =>
            !exactKeys(goal, GOAL_KEYS) ||
            !repositoryName(goal.repository) ||
            !positiveInteger(goal.issue) ||
            !["closes", "relates"].includes(goal.relationship))) {
        return ["goals-invalid"];
    }
    const references = goals.map((goal) =>
        `${goal.repository}\0${goal.issue}\0${goal.relationship}`);
    if (new Set(references).size !== references.length ||
        !goals.some((goal) =>
            goal.repository === repository &&
            goal.issue === originIssue &&
            goal.relationship === "closes")) {
        return ["goals-inconsistent"];
    }
    return [];
}

function validateReplacements(replaces) {
    if (!Array.isArray(replaces) ||
        replaces.some((replacement) =>
            !exactKeys(replacement, REPLACEMENT_KEYS) ||
            !repositoryName(replacement.repository) ||
            !positiveInteger(replacement.number))) {
        return ["replacements-invalid"];
    }
    const references = replaces.map((value) => `${value.repository}\0${value.number}`);
    return new Set(references).size === references.length
        ? []
        : ["replacements-duplicate"];
}

export function validateImplementationProvenance(value, expected = {}) {
    if (!exactKeys(value, TOP_LEVEL_KEYS)) return ["shape-invalid"];
    const violations = [];
    if (containsUnresolvedSentinel(value)) violations.push("unresolved-sentinel");
    if (value.schema !== IMPLEMENTATION_PROVENANCE_SCHEMA ||
        value.schema_version !== "1" ||
        value.producer !== "squad") {
        violations.push("unsupported-schema");
    }
    if (!repositoryName(value.repository)) violations.push("repository-invalid");
    if (!positiveInteger(value.origin_issue)) violations.push("origin-issue-invalid");
    if (!SESSION_ID.test(String(value.implementation_session_id ?? ""))) {
        violations.push("session-invalid");
    }
    if (!exactKeys(value.session_origin, SESSION_ORIGIN_KEYS) ||
        !repositoryName(value.session_origin?.repository) ||
        !DISPATCH_WORKFLOWS.has(value.session_origin?.workflow) ||
        !positiveInteger(value.session_origin?.run_id) ||
        !positiveInteger(value.session_origin?.run_attempt)) {
        violations.push("session-origin-invalid");
    }
    if (!exactKeys(value.workflow_run, WORKFLOW_RUN_KEYS) ||
        !repositoryName(value.workflow_run?.repository) ||
        typeof value.workflow_run?.workflow !== "string" ||
        !/^\.github\/workflows\/[^/]+\.lock\.yml$/.test(value.workflow_run?.workflow || "") ||
        !positiveInteger(value.workflow_run?.run_id) ||
        !positiveInteger(value.workflow_run?.run_attempt) ||
        !["workflow_dispatch", "pull_request"].includes(value.workflow_run?.event)) {
        violations.push("workflow-run-invalid");
    }
    if (!exactKeys(value.pull_request, PULL_REQUEST_KEYS) ||
        !repositoryName(value.pull_request?.repository) ||
        !positiveInteger(value.pull_request?.number) ||
        typeof value.pull_request?.head_ref !== "string" ||
        value.pull_request.head_ref.length === 0) {
        violations.push("pull-request-invalid");
    }
    violations.push(...validateGoals(value.goals, value.repository, value.origin_issue));
    violations.push(...validateReplacements(value.replaces));
    const comparisons = [
        [value.repository, expected.repository],
        [value.pull_request?.repository, expected.repository],
        [value.pull_request?.number, expected.pullRequestNumber],
        [value.pull_request?.head_ref, expected.headRef],
    ];
    if (comparisons.some(([actual, wanted]) => wanted !== undefined && actual !== wanted)) {
        violations.push("runtime-mismatch");
    }
    return [...new Set(violations)];
}

function runPath(run) {
    return String(run?.path || "").split("@")[0];
}

function validatesRun(run, expected) {
    return Number(run?.id) === expected.run_id &&
        Number(run?.run_attempt) === expected.run_attempt &&
        run?.repository?.full_name === expected.repository &&
        runPath(run) === expected.workflow &&
        run?.event === expected.event &&
        run?.head_branch === expected.head_ref;
}

function validatesDispatcherRun(run, expected) {
    return Number(run?.id) === expected.run_id &&
        Number(run?.run_attempt) === expected.run_attempt &&
        run?.repository?.full_name === expected.repository &&
        runPath(run) === expected.workflow;
}

function normalizedRecord(value) {
    return {
        schemaVersion: 1,
        producer: "squad",
        repository: value.repository,
        originIssue: value.origin_issue,
        implementationSessionId: value.implementation_session_id,
        sessionOrigin: {
            repository: value.session_origin.repository,
            workflow: value.session_origin.workflow,
            runId: value.session_origin.run_id,
            runAttempt: value.session_origin.run_attempt,
        },
        workflowRun: {
            repository: value.workflow_run.repository,
            workflow: value.workflow_run.workflow,
            runId: value.workflow_run.run_id,
            runAttempt: value.workflow_run.run_attempt,
            event: value.workflow_run.event,
        },
        pullRequest: {
            repository: value.pull_request.repository,
            number: value.pull_request.number,
            headRef: value.pull_request.head_ref,
        },
        goals: value.goals.map((goal) => ({
            repository: goal.repository,
            issue: goal.issue,
            relationship: goal.relationship,
        })),
        replaces: value.replaces.map((replacement) => ({
            repository: replacement.repository,
            number: replacement.number,
        })),
    };
}

function wireRecord(value) {
    return {
        schema: IMPLEMENTATION_PROVENANCE_SCHEMA,
        schema_version: "1",
        producer: value?.producer,
        repository: value?.repository,
        origin_issue: value?.originIssue,
        implementation_session_id: value?.implementationSessionId,
        session_origin: {
            repository: value?.sessionOrigin?.repository,
            workflow: value?.sessionOrigin?.workflow,
            run_id: value?.sessionOrigin?.runId,
            run_attempt: value?.sessionOrigin?.runAttempt,
        },
        workflow_run: {
            repository: value?.workflowRun?.repository,
            workflow: value?.workflowRun?.workflow,
            run_id: value?.workflowRun?.runId,
            run_attempt: value?.workflowRun?.runAttempt,
            event: value?.workflowRun?.event,
        },
        pull_request: {
            repository: value?.pullRequest?.repository,
            number: value?.pullRequest?.number,
            head_ref: value?.pullRequest?.headRef,
        },
        goals: value?.goals,
        replaces: value?.replaces,
    };
}

export function validateNormalizedImplementationProvenanceRecord(value) {
    const wire = wireRecord(value);
    const violations = validateImplementationProvenance(wire);
    if (violations.length > 0) return violations;
    const repositories = [
        wire.session_origin.repository,
        wire.workflow_run.repository,
        wire.pull_request.repository,
        ...wire.goals.map((goal) => goal.repository),
        ...wire.replaces.map((replacement) => replacement.repository),
    ];
    if (repositories.some((repository) => repository !== wire.repository)) {
        violations.push("repository-mismatch");
    }
    return violations;
}

async function fetchComments(runJson, cwd, repository, pullRequestNumber) {
    const comments = [];
    for (let page = 1; page <= COMMENT_MAX_PAGES; page += 1) {
        const values = await runJson([
            "api",
            `repos/${repository}/issues/${pullRequestNumber}/comments`,
            "--method", "GET",
            "-f", `per_page=${COMMENT_PAGE_SIZE}`,
            "-f", `page=${page}`,
        ], cwd);
        if (!Array.isArray(values)) throw new Error("GitHub returned invalid PR comments.");
        comments.push(...values);
        if (values.length < COMMENT_PAGE_SIZE) return comments;
    }
    throw new Error(`PR #${pullRequestNumber} comments exceeded the pagination ceiling.`);
}

function priorSource(previous) {
    const source = previous?.sourceState?.implementationProvenance;
    if (!source || !Array.isArray(source.data)) {
        return {
            revision: IMPLEMENTATION_PROVENANCE_REVISION,
            data: [],
            fetchedAt: null,
            status: "unavailable",
            error: "",
        };
    }
    return source;
}

function pullRequestRevision(pullRequest) {
    return String(pullRequest?.updatedAt || pullRequest?.updated_at || "");
}

function invalidEntry(pullRequest, error) {
    return {
        pullRequestNumber: Number(pullRequest.number),
        revision: pullRequestRevision(pullRequest),
        fetchedAt: null,
        status: "invalid",
        error,
        record: null,
    };
}

export function selectImplementationProvenancePullRequests(snapshot) {
    const selected = new Map();
    for (const pullRequest of Array.isArray(snapshot) ? snapshot : []) {
        selected.set(Number(pullRequest.number), pullRequest);
    }
    return [...selected.values()]
        .filter((pullRequest) => positiveInteger(Number(pullRequest.number)))
        .sort((left, right) =>
            String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")) ||
            Number(right.number) - Number(left.number))
        .slice(0, MAX_PULL_REQUESTS);
}

async function validateRuntimePayload({
    payload,
    runJson,
    cwd,
    repository,
    issueNumbers,
    pullByNumber,
    runById,
}) {
    const violations = [];
    if (payload.goals.some((goal) =>
        goal.repository !== repository || !issueNumbers.has(goal.issue))) {
        violations.push("unresolved-goal");
    }
    if (payload.replaces.some((replacement) =>
        replacement.repository !== repository ||
        !pullByNumber.has(replacement.number))) {
        violations.push("unresolved-replacement");
    }
    if (violations.length > 0) return violations;
    const workerRun = await runJson([
        "api",
        `repos/${repository}/actions/runs/${payload.workflow_run.run_id}`,
    ], cwd);
    const dispatcherRun = payload.session_origin.run_id === payload.workflow_run.run_id
        ? workerRun
        : await runJson([
            "api",
            `repos/${repository}/actions/runs/${payload.session_origin.run_id}`,
        ], cwd);
    if (!validatesRun(workerRun, {
        ...payload.workflow_run,
        head_ref: payload.pull_request.head_ref,
    }) || !validatesDispatcherRun(dispatcherRun, payload.session_origin)) {
        violations.push("runtime-mismatch");
    }
    const listedRun = runById.get(payload.workflow_run.run_id);
    if (listedRun && (
        String(listedRun.headBranch || listedRun.branch || "") !==
            payload.pull_request.head_ref ||
        String(listedRun.event || "") !== payload.workflow_run.event
    )) {
        violations.push("runtime-mismatch");
    }
    return violations;
}

export async function discoverImplementationProvenance({
    runJson,
    cwd,
    repository,
    pullRequests,
    allPullRequests = pullRequests,
    issues,
    workflowRuns,
    previous,
    attemptedAt,
    prerequisitesComplete = true,
}) {
    const prior = priorSource(previous);
    try {
        if (!prerequisitesComplete) {
            throw new Error(
                "Implementation provenance prerequisites are incomplete or unavailable.",
            );
        }
        const selected = pullRequests.slice(0, MAX_PULL_REQUESTS);
        const issueNumbers = new Set(issues.map((issue) => Number(issue?.number)));
        const pullByNumber = new Map(allPullRequests.map((pullRequest) => [
            Number(pullRequest?.number),
            pullRequest,
        ]));
        const runById = new Map(workflowRuns.map((run) => [
            Number(run?.databaseId || run?.id),
            run,
        ]));
        const priorByPullRequest = new Map(prior.data.map((entry) => [
            Number(entry?.pullRequestNumber),
            entry,
        ]));
        const attemptedTime = Date.parse(attemptedAt);
        const data = [];
        for (const pullRequest of selected) {
            const revision = pullRequestRevision(pullRequest);
            const cached = priorByPullRequest.get(Number(pullRequest.number));
            const cachedTime = Date.parse(cached?.fetchedAt || "");
            if (prior.status === "fresh" &&
                cached?.revision &&
                cached.revision === revision &&
                Number.isFinite(attemptedTime) &&
                Number.isFinite(cachedTime) &&
                attemptedTime - cachedTime < SOURCE_REFRESH_INTERVAL_MS) {
                data.push(cached);
                continue;
            }
            const comments = await fetchComments(
                runJson,
                cwd,
                repository,
                Number(pullRequest.number),
            );
            const candidates = comments.filter((comment) =>
                (comment?.user?.login ?? comment?.author?.login ?? comment?.author) ===
                    IMPLEMENTATION_PROVENANCE_BOT &&
                provenanceLikeBody(comment?.body));
            if (candidates.length === 0) {
                data.push({
                    pullRequestNumber: Number(pullRequest.number),
                    revision,
                    fetchedAt: attemptedAt,
                    status: "missing",
                    error: "",
                    record: null,
                });
                continue;
            }
            if (candidates.length !== 1) {
                data.push(invalidEntry(pullRequest, "duplicate authoritative comments"));
                continue;
            }
            const payload = extractImplementationProvenance(candidates[0].body);
            const violations = payload
                ? validateImplementationProvenance(payload, {
                    repository,
                    pullRequestNumber: Number(pullRequest.number),
                    headRef: String(pullRequest.headRefName || pullRequest.branch || ""),
                })
                : ["malformed-comment"];
            if (payload && violations.length === 0) {
                violations.push(...await validateRuntimePayload({
                    payload,
                    runJson,
                    cwd,
                    repository,
                    issueNumbers,
                    pullByNumber,
                    runById,
                }));
            }
            if (payload && violations.length === 0) {
                for (const replacement of payload.replaces) {
                    const replacementPull = pullByNumber.get(replacement.number);
                    const replacementRevision = pullRequestRevision(replacementPull);
                    const cachedReplacement = [
                        ...data,
                        ...(prior.status === "fresh"
                            ? prior.data.filter((entry) => {
                                const fetchedTime = Date.parse(entry?.fetchedAt || "");
                                return Number.isFinite(attemptedTime) &&
                                    Number.isFinite(fetchedTime) &&
                                    attemptedTime - fetchedTime <
                                        SOURCE_REFRESH_INTERVAL_MS;
                            })
                            : []),
                    ].find((entry) =>
                        entry.pullRequestNumber === replacement.number &&
                        entry.status === "valid" &&
                        entry.revision === replacementRevision);
                    let replacementPayload = null;
                    if (cachedReplacement?.record) {
                        replacementPayload = wireRecord(cachedReplacement.record);
                    } else {
                        const replacementComments = await fetchComments(
                            runJson,
                            cwd,
                            repository,
                            replacement.number,
                        );
                        const replacementCandidates = replacementComments.filter((comment) =>
                            (comment?.user?.login ??
                                comment?.author?.login ??
                                comment?.author) === IMPLEMENTATION_PROVENANCE_BOT &&
                            provenanceLikeBody(comment?.body));
                        replacementPayload = replacementCandidates.length === 1
                            ? extractImplementationProvenance(replacementCandidates[0].body)
                            : null;
                    }
                    const replacementViolations = replacementPayload
                        ? validateImplementationProvenance(replacementPayload, {
                            repository,
                            pullRequestNumber: replacement.number,
                            headRef: String(
                                replacementPull?.headRefName ||
                                replacementPull?.branch ||
                                "",
                            ),
                        })
                        : ["replacement-unrelated"];
                    if (replacementPayload && (
                        replacementPayload.origin_issue !== payload.origin_issue ||
                        replacementPayload.implementation_session_id !==
                            payload.implementation_session_id
                    )) {
                        replacementViolations.push("replacement-unrelated");
                    }
                    if (replacementPayload && replacementViolations.length === 0) {
                        replacementViolations.push(...await validateRuntimePayload({
                            payload: replacementPayload,
                            runJson,
                            cwd,
                            repository,
                            issueNumbers,
                            pullByNumber,
                            runById,
                        }));
                    }
                    if (replacementViolations.length > 0) {
                        violations.push("replacement-unrelated");
                        break;
                    }
                }
            }
            data.push(violations.length > 0
                ? {
                    ...invalidEntry(
                        pullRequest,
                        [...new Set(violations)].join(", "),
                    ),
                    fetchedAt: attemptedAt,
                }
                : {
                    pullRequestNumber: Number(pullRequest.number),
                    revision,
                    fetchedAt: attemptedAt,
                    status: "valid",
                    error: "",
                    record: normalizedRecord(payload),
                });
        }
        const oldestFetchedAt = data
            .map((entry) => entry.fetchedAt)
            .filter(Boolean)
            .sort()
            .at(0) || attemptedAt;
        return {
            revision: IMPLEMENTATION_PROVENANCE_REVISION,
            data,
            fetchedAt: oldestFetchedAt,
            status: "fresh",
            error: "",
        };
    } catch (error) {
        const retained = prior.data.filter((entry) =>
            entry?.status === "valid" && entry.record);
        return {
            ...prior,
            revision: IMPLEMENTATION_PROVENANCE_REVISION,
            data: retained,
            status: prior.fetchedAt && retained.length > 0 ? "stale" : "unavailable",
            error: String(error?.message || error || "Implementation provenance unavailable")
                .trim()
                .slice(0, 800),
        };
    }
}

export function implementationProvenancePolicy() {
    return {
        maxPullRequests: MAX_PULL_REQUESTS,
        commentPageSize: COMMENT_PAGE_SIZE,
        commentMaxPages: COMMENT_MAX_PAGES,
        refreshIntervalMs: SOURCE_REFRESH_INTERVAL_MS,
    };
}
