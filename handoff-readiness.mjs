const ACTIVATION_KINDS = new Set([
    "activated",
    "phases-activated",
    "plan-accepted",
    "phases-accepted",
]);
const COMPLETE_SOURCE = new Set(["complete", "fresh"]);
const ACTIVE_RUN_STATES = new Set(["queued", "in_progress", "pending", "requested", "waiting"]);
const COPILOT_LOGINS = new Set(["copilot-swe-agent", "copilot"]);
const REQUIRED_READINESS_SOURCES = new Set([
    "issue",
    "issueAssignees",
    "issueComments",
    "subIssues",
    "dependencies",
    "pullRequests",
    "workflowRuns",
]);

function clean(value, maxLength = 4000) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function normalized(value) {
    return clean(value, 300).toLowerCase();
}

function timestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function issueNumber(value) {
    const match = /^#([1-9][0-9]*)$/.exec(clean(value, 80));
    return match ? Number(match[1]) : null;
}

function unresolvedReference(value) {
    return /^#?aw_[A-Za-z0-9_]{3,40}$/i.test(clean(value, 80));
}

function sourceReadiness(state, { enabled = true } = {}) {
    if (!enabled) return "skipped";
    const status = normalized(state?.status || "fresh");
    if (status === "unauthorized") return "unauthorized";
    if (status === "stale") return "stale";
    if (status === "unavailable") return "unavailable";
    if (status === "skipped") return "skipped";
    if (status === "incomplete" || state?.exhaustive === false || state?.truncated) {
        return "incomplete";
    }
    return COMPLETE_SOURCE.has(status) ? "complete" : "unknown";
}

function sourceReason(name, state) {
    const label = name.replace(/([A-Z])/g, " $1").toLowerCase();
    if (state === "complete") return "";
    if (state === "skipped") return `${label} evidence was not refreshed.`;
    if (state === "stale") return `${label} evidence is stale.`;
    if (state === "incomplete") return `${label} evidence is capped, truncated, or incomplete.`;
    if (state === "unauthorized") return `${label} evidence is not authorized.`;
    if (state === "unavailable") return `${label} evidence is unavailable.`;
    return `${label} evidence completeness is unknown.`;
}

function parseJsonBlock(body, heading) {
    const pattern = new RegExp(`${heading}:\\s*\`\`\`json\\s*([\\s\\S]*?)\`\`\``, "gi");
    const blocks = [...String(body || "").matchAll(pattern)];
    if (blocks.length !== 1) {
        return {
            value: null,
            error: blocks.length === 0
                ? `${heading} JSON is missing.`
                : `${heading} JSON is duplicated.`,
        };
    }
    try {
        return { value: JSON.parse(blocks[0][1]), error: "" };
    } catch (error) {
        return { value: null, error: `${heading} JSON is malformed: ${error.message}` };
    }
}

function parseStructuredArtifact(body) {
    const pattern = /Structured data:\s*```json\s*([\s\S]*?)```/gi;
    const blocks = [...String(body || "").matchAll(pattern)];
    if (blocks.length === 0) return { artifact: null, error: "" };
    const values = [];
    for (const block of blocks) {
        try {
            values.push(JSON.parse(block[1]));
        } catch (error) {
            const activationMentioned = /"(?:squad_artifact)"\s*:\s*"?(?:activated|phases-activated|plan-accepted|phases-accepted)/i
                .test(block[1]);
            if (activationMentioned) {
                return {
                    artifact: null,
                    error: `Activation structured data is malformed: ${error.message}`,
                };
            }
        }
    }
    const activationArtifacts = values.filter((value) =>
        ACTIVATION_KINDS.has(value?.squad_artifact));
    if (activationArtifacts.length > 1) {
        return { artifact: null, error: "Activation structured data is duplicated." };
    }
    return { artifact: activationArtifacts[0] || values.at(-1) || null, error: "" };
}

function validateBinding(raw, repository, issueByNumber) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { error: "Activation binding is not an object." };
    }
    if (unresolvedReference(raw.issue)) {
        return { error: `Activation binding issue ${clean(raw.issue)} is unresolved.` };
    }
    const number = issueNumber(raw.issue);
    if (!number) return { error: "Activation binding issue is not a resolved #<number> reference." };
    if (unresolvedReference(raw.epic_issue)) {
        return { error: `Activation binding epic issue ${clean(raw.epic_issue)} is unresolved.` };
    }
    const epicIssueNumber = issueNumber(raw.epic_issue);
    if (!epicIssueNumber) {
        return { error: `Activation binding for #${number} has no resolved epic issue.` };
    }
    const task = clean(raw.task, 80);
    const epic = clean(raw.epic, 80);
    const agent = clean(raw.agent, 160);
    const epicAgents = Array.isArray(raw.epic_agents)
        ? raw.epic_agents.map((value) => normalized(value)).filter(Boolean)
        : [];
    if (!task) return { error: `Activation binding for #${number} has no task identifier.` };
    if (!epic) return { error: `Activation binding for #${number} has no epic identifier.` };
    if (!agent) return { error: `Activation binding for #${number} has no agent.` };
    if (
        epicAgents.length === 0 ||
        new Set(epicAgents).size !== epicAgents.length ||
        !epicAgents.includes(normalized(agent))
    ) {
        return {
            error: `Activation binding for #${number} has invalid or ambiguous epic agents.`,
        };
    }
    if (!issueByNumber.has(number)) {
        return { error: `Activation binding task issue #${number} does not exist in ${repository}.` };
    }
    if (!issueByNumber.has(epicIssueNumber)) {
        return { error: `Activation binding epic issue #${epicIssueNumber} does not exist in ${repository}.` };
    }
    const label = clean(raw.label, 160);
    const epicLabel = clean(raw.epic_label, 160);
    const taskLabels = new Set(
        (Array.isArray(issueByNumber.get(number)?.labels) ? issueByNumber.get(number).labels : [])
            .map((value) => normalized(typeof value === "string" ? value : value?.name))
            .filter(Boolean),
    );
    const epicLabels = new Set(
        (Array.isArray(issueByNumber.get(epicIssueNumber)?.labels)
            ? issueByNumber.get(epicIssueNumber).labels
            : [])
            .map((value) => normalized(typeof value === "string" ? value : value?.name))
            .filter(Boolean),
    );
    if (label && !taskLabels.has(normalized(label))) {
        return { error: `Activation binding label ${label} is not observed on task issue #${number}.` };
    }
    if (epicLabel && !epicLabels.has(normalized(epicLabel))) {
        return {
            error: `Activation binding epic label ${epicLabel} is not observed on epic issue #${epicIssueNumber}.`,
        };
    }
    return {
        binding: {
            task,
            issue: `${repository}#${number}`,
            issueNumber: number,
            epic,
            epicIssue: `${repository}#${epicIssueNumber}`,
            epicIssueNumber,
            agent,
            epicAgents,
            label,
            epicLabel,
            omissionReason: clean(raw.omission_reason, 80),
            epicOmissionReason: clean(raw.epic_omission_reason, 80),
        },
        error: "",
    };
}

export function parseActivationEvidence({
    issues = [],
    repository = "",
    comments = null,
    commentsComplete = true,
} = {}) {
    const issueByNumber = new Map(issues.map((issue) => [Number(issue?.number), issue]));
    const commentsByIssue = new Map();
    if (Array.isArray(comments)) {
        for (const comment of comments) {
            const number = Number(comment?.issueNumber || String(comment?.issue_url || "").match(/\/issues\/(\d+)$/)?.[1]);
            if (!Number.isInteger(number)) continue;
            const current = commentsByIssue.get(number) || [];
            current.push(comment);
            commentsByIssue.set(number, current);
        }
    } else {
        for (const issue of issues) {
            commentsByIssue.set(Number(issue?.number), Array.isArray(issue?.comments) ? issue.comments : []);
        }
    }

    const candidatesByIssue = new Map();
    const errorsByIssue = new Map();
    const globalErrors = [];
    const addError = (number, reason) => {
        const current = errorsByIssue.get(number) || [];
        current.push(reason);
        errorsByIssue.set(number, current);
    };

    for (const [rootNumber, issueComments] of commentsByIssue) {
        for (const comment of issueComments) {
            const body = String(comment?.body || "");
            const { artifact, error } = parseStructuredArtifact(body);
            if (error) {
                addError(rootNumber, error);
                globalErrors.push(error);
                continue;
            }
            if (!ACTIVATION_KINDS.has(artifact?.squad_artifact)) continue;
            if (artifact.schema_version !== "1") {
                const reason = "Activation artifact schema version is unsupported.";
                addError(rootNumber, reason);
                globalErrors.push(reason);
                continue;
            }
            if (!Number.isInteger(artifact.origin_issue) || artifact.origin_issue !== rootNumber) {
                const reason = "Activation artifact origin issue does not match its comment issue.";
                addError(rootNumber, reason);
                globalErrors.push(reason);
                continue;
            }
            const rootIssue = issueByNumber.get(rootNumber);
            if (!clean(rootIssue?.url, 500) || !clean(comment?.url || comment?.html_url, 500)) {
                const reason = "Activation provenance is missing a root issue or artifact source URL.";
                addError(rootNumber, reason);
                globalErrors.push(reason);
                continue;
            }
            const parsedBindings = parseJsonBlock(body, "Activation bindings");
            if (parsedBindings.error) {
                addError(rootNumber, parsedBindings.error);
                globalErrors.push(parsedBindings.error);
                continue;
            }
            if (!Array.isArray(parsedBindings.value) || parsedBindings.value.length === 0) {
                const reason = "Activation bindings JSON must be a non-empty array.";
                addError(rootNumber, reason);
                globalErrors.push(reason);
                continue;
            }
            const validatedBindings = [];
            const envelopeErrors = [];
            for (const rawBinding of parsedBindings.value) {
                const validated = validateBinding(rawBinding, repository, issueByNumber);
                if (validated.error) {
                    const target = issueNumber(rawBinding?.issue);
                    envelopeErrors.push({ reason: validated.error, target });
                    continue;
                }
                validatedBindings.push(validated.binding);
            }
            const issueAssignments = new Map();
            const taskIssues = new Map();
            const epicIssues = new Map();
            const seenTaskIssues = new Set();
            for (const binding of validatedBindings) {
                if (
                    binding.issueNumber === rootNumber ||
                    binding.epicIssueNumber === rootNumber
                ) {
                    envelopeErrors.push({
                        reason: `Activation root issue #${rootNumber} cannot be assigned as generated work.`,
                        target: binding.issueNumber === rootNumber
                            ? binding.issueNumber
                            : binding.epicIssueNumber,
                    });
                }
                if (binding.issueNumber === binding.epicIssueNumber) {
                    envelopeErrors.push({
                        reason: `Activation binding issue #${binding.issueNumber} cannot be both a task and an epic.`,
                        target: binding.issueNumber,
                    });
                }
                if (seenTaskIssues.has(binding.issueNumber)) {
                    envelopeErrors.push({
                        reason: `Activation binding for #${binding.issueNumber} is duplicated.`,
                        target: binding.issueNumber,
                    });
                }
                seenTaskIssues.add(binding.issueNumber);
                const taskAssignment = issueAssignments.get(binding.issueNumber);
                const epicAssignment = issueAssignments.get(binding.epicIssueNumber);
                if (
                    taskAssignment &&
                    (taskAssignment.role !== "task" || taskAssignment.identity !== binding.task)
                ) {
                    envelopeErrors.push({
                        reason: `Activation binding issue #${binding.issueNumber} has conflicting identities.`,
                        target: binding.issueNumber,
                    });
                }
                if (
                    epicAssignment &&
                    (epicAssignment.role !== "epic" || epicAssignment.identity !== binding.epic)
                ) {
                    envelopeErrors.push({
                        reason: `Activation binding issue #${binding.epicIssueNumber} has conflicting identities.`,
                        target: binding.epicIssueNumber,
                    });
                }
                issueAssignments.set(binding.issueNumber, {
                    role: "task",
                    identity: binding.task,
                });
                issueAssignments.set(binding.epicIssueNumber, {
                    role: "epic",
                    identity: binding.epic,
                });
                const priorTaskIssue = taskIssues.get(binding.task);
                if (priorTaskIssue && priorTaskIssue !== binding.issueNumber) {
                    envelopeErrors.push({
                        reason: `Activation task ${binding.task} resolves to multiple issues.`,
                        target: binding.issueNumber,
                    });
                }
                taskIssues.set(binding.task, binding.issueNumber);
                const normalizedEpicAgents = [...binding.epicAgents].sort();
                const priorEpic = epicIssues.get(binding.epic);
                if (priorEpic && (
                    priorEpic.issueNumber !== binding.epicIssueNumber ||
                    priorEpic.agents.join("\0") !== normalizedEpicAgents.join("\0")
                )) {
                    envelopeErrors.push({
                        reason: `Activation epic ${binding.epic} has conflicting identity or agents.`,
                        target: binding.epicIssueNumber,
                    });
                }
                epicIssues.set(binding.epic, {
                    issueNumber: binding.epicIssueNumber,
                    agents: normalizedEpicAgents,
                });
            }
            if (envelopeErrors.length > 0) {
                for (const { reason, target } of envelopeErrors) {
                    addError(rootNumber, reason);
                    if (target) addError(target, reason);
                    globalErrors.push(reason);
                }
                continue;
            }
            for (const binding of validatedBindings) {
                const candidate = {
                    ...binding,
                    rootIssue: `${repository}#${rootNumber}`,
                    rootIssueNumber: rootNumber,
                    rootIssueUrl: clean(rootIssue?.url, 500),
                    artifactKind: artifact.squad_artifact,
                    artifactUrl: clean(comment?.url || comment?.html_url, 500),
                    schemaVersion: artifact.schema_version,
                    createdAt: timestamp(comment?.createdAt || comment?.created_at),
                };
                const current = candidatesByIssue.get(binding.issueNumber) || [];
                current.push(candidate);
                candidatesByIssue.set(binding.issueNumber, current);
            }
        }
    }

    const result = new Map();
    for (const issue of issues) {
        const number = Number(issue?.number);
        const candidates = candidatesByIssue.get(number) || [];
        const relatedErrors = [
            ...(errorsByIssue.get(number) || []),
            ...candidates.flatMap((candidate) => errorsByIssue.get(candidate.rootIssueNumber) || []),
            ...(candidates.length === 0 ? globalErrors : []),
        ];
        if (!commentsComplete) {
            relatedErrors.push("Activation artifact comments are incomplete.");
        }
        if (candidates.length > 1) {
            relatedErrors.push(`Multiple activation bindings resolve to #${number}.`);
        }
        result.set(number, {
            activation: candidates.length === 1 ? candidates[0] : null,
            errors: [...new Set(relatedErrors)],
        });
    }
    return result;
}

export function extractAcceptanceCriteria(body, sourceUrl = "") {
    const lines = String(body || "").replace(/\r/g, "").split("\n");
    const start = lines.findIndex((line) =>
        /^#{1,6}\s+(?:acceptance criteria|success criteria)\s*:?\s*$/i.test(line.trim()));
    if (start < 0) return [];
    const level = lines[start].match(/^#+/)?.[0].length || 6;
    const section = [];
    for (const line of lines.slice(start + 1)) {
        const heading = line.match(/^(#{1,6})\s+/);
        if (heading && heading[1].length <= level) break;
        section.push(line);
    }
    const criteria = [];
    let current = "";
    const flush = () => {
        if (!current) return;
        criteria.push({ text: current, sourceUrl: clean(sourceUrl, 500) });
        current = "";
    };
    for (const line of section) {
        const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/);
        if (item) {
            flush();
            current = clean(item[1], 12000);
        } else if (current && line.trim() && !/^#{1,6}\s+/.test(line)) {
            current = `${current} ${clean(line, 12000)}`.trim();
        } else if (!line.trim()) {
            flush();
        }
    }
    flush();
    return criteria.filter((criterion) => criterion.text);
}

function fallbackParentNumber(issue) {
    const body = String(issue?.body || "");
    const match = body.match(/^\s*(?:[-*]\s*)?(?:parent|parent issue)\s*:\s*#([1-9][0-9]*)\b/im);
    return match ? Number(match[1]) : null;
}

function fallbackChildNumbers(issue) {
    const children = new Set();
    let inBlock = false;
    for (const line of String(issue?.body || "").split(/\r?\n/)) {
        if (/^\s*(?:[-*]\s*)?(?:sub-?issues?|child(?:ren)?|child issues?)\s*:/i.test(line)) {
            inBlock = true;
        } else if (!line.trim() || /^#{1,6}\s/.test(line) || (!/^\s*[-*]\s+/.test(line) && inBlock)) {
            inBlock = false;
        }
        if (!inBlock) continue;
        for (const match of line.matchAll(/#([1-9][0-9]*)\b/g)) children.add(Number(match[1]));
    }
    return [...children];
}

export function deriveSubIssueEvidence(issue, issues, native = null) {
    const issueByNumber = new Map(issues.map((candidate) => [Number(candidate?.number), candidate]));
    const nativeChildren = Array.isArray(native?.subIssues)
        ? native.subIssues
        : Array.isArray(issue?.subIssues)
            ? issue.subIssues
            : [];
    const childNumbers = new Set(nativeChildren.map((child) => Number(child?.number)).filter(Number.isInteger));
    for (const number of fallbackChildNumbers(issue)) childNumbers.add(number);
    for (const candidate of issues) {
        const parentNumber = Number(candidate?.parent?.number || fallbackParentNumber(candidate));
        if (parentNumber === Number(issue?.number)) childNumbers.add(Number(candidate?.number));
    }
    const children = [...childNumbers].map((number) => {
        const observed = issueByNumber.get(number) ||
            nativeChildren.find((candidate) => Number(candidate?.number) === number);
        return {
            number,
            state: normalized(observed?.state || "unknown"),
            title: clean(observed?.title || "Status unknown", 240),
            url: clean(observed?.url || "", 500),
        };
    });
    return {
        parentIssueNumber: Number(native?.parent?.number || issue?.parent?.number || fallbackParentNumber(issue)) || null,
        children,
        openChildren: children.filter((child) => child.state !== "closed"),
    };
}

function existingImplementation({ issue, pullRequests, workflowRuns, copilotTasks, localSessions }) {
    const pullRequestStates = pullRequests.map((pullRequest) => normalized(pullRequest?.state));
    const merged = pullRequests.filter((pullRequest) => normalized(pullRequest?.state) === "merged");
    const openPullRequests = pullRequests.filter((pullRequest) => normalized(pullRequest?.state) === "open");
    const closedUnmerged = pullRequests.filter((pullRequest) => normalized(pullRequest?.state) === "closed");
    const activeRuns = workflowRuns.filter((run) => ACTIVE_RUN_STATES.has(normalized(run?.status)));
    const priorRuns = workflowRuns.filter((run) =>
        normalized(run?.status) === "completed" && !["skipped", "neutral"].includes(normalized(run?.conclusion)));
    const actualCopilotAssignment = (Array.isArray(issue?.assignees) ? issue.assignees : [])
        .some((assignee) => COPILOT_LOGINS.has(normalized(assignee?.login || assignee?.name)));
    const activeCopilotTasks = copilotTasks.filter((task) =>
        !["completed", "closed", "cancelled", "failed"].includes(normalized(task?.status)));
    const activeLocalSessions = localSessions.filter((session) =>
        !["completed", "closed", "archived", "failed"].includes(normalized(session?.status)));
    const links = [
        ...pullRequests.map((item) => ({
            kind: "pull-request",
            title: `PR #${item.number}: ${item.title}`,
            url: item.url,
            state: item.state,
        })),
        ...workflowRuns.map((item) => ({
            kind: "workflow-run",
            title: item.name || item.workflow,
            url: item.url,
            state: item.status,
        })),
        ...copilotTasks.map((item) => ({
            kind: "copilot-task",
            title: item.title || "Copilot task",
            url: item.url,
            state: item.status,
        })),
        ...localSessions.map((item) => ({
            kind: "local-session",
            title: item.title || "Local session",
            url: item.appUrl || item.url,
            state: item.status,
        })),
        ...(actualCopilotAssignment ? [{
            kind: "copilot-assignment",
            title: "Copilot is assigned to the task issue",
            url: issue?.url,
            state: "assigned",
        }] : []),
    ];
    if (merged.length > 0) return { state: "completed", links, conflict: pullRequestStates.length > 1 };
    if (
        openPullRequests.length > 0 ||
        activeRuns.length > 0 ||
        actualCopilotAssignment ||
        activeCopilotTasks.length > 0 ||
        activeLocalSessions.length > 0
    ) {
        return {
            state: "active",
            links,
            conflict: openPullRequests.length + activeRuns.length +
                activeCopilotTasks.length + activeLocalSessions.length > 1,
        };
    }
    if (closedUnmerged.length > 0 || priorRuns.length > 0) {
        return {
            state: "ambiguous-prior-attempt",
            links,
            conflict: pullRequests.length + workflowRuns.length > 1,
        };
    }
    return { state: "none", links, conflict: false };
}

function mechanismsFor(config = {}) {
    const defaults = [
        ["local-session", "unavailable"],
        ["copilot-cloud-agent", "unavailable"],
        ["squad-implement", "unavailable"],
        ["manual", "available"],
    ];
    return defaults.map(([kind, fallback]) => {
        const configured = config[kind];
        return {
            kind,
            availability: clean(configured?.availability || configured || fallback, 80),
            reasons: Array.isArray(configured?.reasons)
                ? configured.reasons.map((reason) => clean(reason, 800)).filter(Boolean)
                : [],
        };
    });
}

export function deriveHandoff({
    goalId,
    repository,
    issue,
    issues = [],
    activationEvidence,
    dependencies = [],
    pullRequests = [],
    workflowRuns = [],
    sourceState = {},
    nativeSubIssues = null,
    copilotTasks = [],
    localSessions = [],
    mechanismAvailability = {},
    evaluatedAt = new Date().toISOString(),
} = {}) {
    const issueSource = sourceReadiness(sourceState.issues);
    const sourceStates = {
        issue: issueSource,
        issueAssignees: sourceReadiness(sourceState.issueAssignees || sourceState.issues),
        issueComments: sourceReadiness(sourceState.issueComments || sourceState.issues),
        subIssues: sourceReadiness(sourceState.subIssues || sourceState.issues),
        dependencies: sourceReadiness(sourceState.dependencies || sourceState.issues),
        pullRequests: sourceReadiness(sourceState.pullRequests),
        workflowRuns: sourceReadiness(sourceState.workflowRuns),
        copilotTasks: sourceReadiness(sourceState.copilotTasks, {
            enabled: sourceState.copilotTasks?.enabled === true,
        }),
        localSessions: sourceReadiness(sourceState.localSessions, {
            enabled: sourceState.localSessions?.enabled === true,
        }),
    };
    const criteria = extractAcceptanceCriteria(issue?.body, issue?.url);
    const acceptanceCriteriaComplete = issueSource === "complete" && criteria.length > 0;
    const subIssues = deriveSubIssueEvidence(issue, issues, nativeSubIssues);
    const implementation = existingImplementation({
        issue,
        pullRequests,
        workflowRuns,
        copilotTasks,
        localSessions,
    });
    const mechanisms = mechanismsFor(mechanismAvailability);
    const reasons = [];
    let state = "ready";

    if (normalized(issue?.state) === "closed" || implementation.state === "completed") {
        state = "completed";
        reasons.push(normalized(issue?.state) === "closed"
            ? "The task issue is closed."
            : "A correlated implementation pull request is merged.");
    } else if (implementation.state === "active") {
        state = "already-in-progress";
        reasons.push("Authoritative evidence shows implementation is already in progress.");
        if (implementation.conflict) reasons.push("Multiple active implementation records require reconciliation.");
    } else if (implementation.state === "ambiguous-prior-attempt") {
        state = "unknown";
        reasons.push("A correlated pull request was closed without merging; retry is ambiguous.");
    } else {
        for (const [name, source] of Object.entries(sourceStates)) {
            if (source === "skipped" && !REQUIRED_READINESS_SOURCES.has(name)) continue;
            const reason = sourceReason(name, source);
            if (reason) reasons.push(reason);
        }
        const incompleteSources = Object.entries(sourceStates).some(([name, source]) =>
            source !== "complete" &&
            (source !== "skipped" || REQUIRED_READINESS_SOURCES.has(name)));
        if (incompleteSources) {
            state = "unknown";
        } else if (activationEvidence?.errors?.length) {
            state = "unknown";
            reasons.push(...activationEvidence.errors);
        } else if (!activationEvidence?.activation) {
            state = "ineligible";
            reasons.push("No exact activation binding resolves to this task issue.");
        } else if (subIssues.openChildren.length > 0) {
            state = "ineligible";
            reasons.push("The task is not a leaf because it has open or unresolved sub-issues.");
        } else if (criteria.length === 0) {
            state = "ineligible";
            reasons.push("The task issue has no complete Acceptance Criteria or Success Criteria section.");
        } else if (dependencies.some((dependency) => dependency.phase !== "completed")) {
            state = "blocked";
            reasons.push("At least one declared dependency is open or unresolved.");
        }
    }

    const automatedHandoffAvailable = state === "ready" && mechanisms.some((mechanism) =>
        mechanism.kind !== "manual" && mechanism.availability === "available");
    return {
        schemaVersion: 1,
        goalId,
        readiness: {
            state,
            reasons: [...new Set(reasons)],
            evaluatedAt: timestamp(evaluatedAt) || new Date().toISOString(),
            automatedHandoffAvailable,
            sourceStates,
        },
        activation: activationEvidence?.activation || null,
        acceptanceCriteria: criteria,
        acceptanceCriteriaComplete,
        issueRevision: timestamp(issue?.updatedAt),
        leaf: {
            parentIssueNumber: subIssues.parentIssueNumber,
            subIssues: subIssues.children,
            complete: sourceStates.subIssues === "complete",
        },
        existingImplementation: {
            state: implementation.state,
            pullRequests: pullRequests.map((item) => ({
                number: item.number,
                url: item.url,
                state: item.state,
            })),
            workflowRuns: workflowRuns.map((item) => ({
                id: item.id,
                url: item.url,
                status: item.status,
            })),
            sessions: implementation.links.filter((item) =>
                item.kind === "copilot-task" || item.kind === "local-session"),
            links: implementation.links,
        },
        mechanisms,
    };
}

export function reconcileHandoffDependencies(handoff, dependencies = []) {
    if (!handoff?.readiness) return handoff;
    const copy = structuredClone(handoff);
    const preserved = new Set(["completed", "already-in-progress", "unknown"]);
    if (preserved.has(copy.readiness.state)) return copy;

    const dependencyReasons = copy.readiness.reasons.filter((reason) =>
        !/declared dependency is open or unresolved/i.test(reason));
    const incompleteEvidence = dependencies.find((dependency) =>
        dependency.evidenceState && dependency.evidenceState !== "complete");
    if (incompleteEvidence) {
        copy.readiness.state = "unknown";
        copy.readiness.reasons = [
            ...dependencyReasons,
            `Dependency ${incompleteEvidence.id} evidence is ${incompleteEvidence.evidenceState}.`,
        ];
        copy.readiness.automatedHandoffAvailable = false;
        return copy;
    }
    if (dependencies.some((dependency) => dependency.phase !== "completed")) {
        copy.readiness.state = "blocked";
        copy.readiness.reasons = [
            ...dependencyReasons,
            "At least one declared dependency is open or unresolved.",
        ];
        copy.readiness.automatedHandoffAvailable = false;
        return copy;
    }
    if (copy.readiness.state !== "blocked") return copy;

    const sourcesComplete = Object.entries(copy.readiness.sourceStates || {})
        .every(([name, source]) =>
            source === "complete" ||
            (source === "skipped" && !REQUIRED_READINESS_SOURCES.has(name)));
    if (!sourcesComplete) {
        copy.readiness.state = "unknown";
    } else if (!copy.activation || !copy.acceptanceCriteriaComplete) {
        copy.readiness.state = "ineligible";
    } else if ((copy.leaf?.subIssues || []).some((child) => child.state !== "closed")) {
        copy.readiness.state = "ineligible";
    } else {
        copy.readiness.state = "ready";
    }
    copy.readiness.reasons = dependencyReasons;
    copy.readiness.automatedHandoffAvailable = copy.readiness.state === "ready" &&
        (copy.mechanisms || []).some((mechanism) =>
            mechanism.kind !== "manual" && mechanism.availability === "available");
    return copy;
}
