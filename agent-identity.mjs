export const AGENT_PROVENANCE_SCHEMA = "squad-agent-provenance/v1";
export const AGENT_PROVENANCE_VERSION = 1;
export const WORK_AGENT_BINDING_SCHEMA = "squad-work-agent-binding/v1";
export const WORK_AGENT_BINDING_VERSION = 1;
export const AGENT_IDENTITY_SOURCE_REVISION = 1;

const REGISTRY_PATH = ".squad/casting/registry.json";
const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_AGENTS = 500;
const MAX_BINDINGS = 500;
const MAX_ERROR_LENGTH = 800;
const ACTIVATION_KINDS = new Set([
    "activated",
    "phases-activated",
    "plan-accepted",
    "phases-accepted",
]);
const IDENTITY_OMISSION_REASONS = new Set([
    "external-agent",
    "non-roster",
    "legacy-plan-missing-id",
]);

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value) {
    const parsed = Date.parse(value || "");
    return typeof value === "string" && value.length > 0 && Number.isFinite(parsed)
        ? new Date(parsed).toISOString()
        : null;
}

function clean(value, maxLength = 500) {
    return typeof value === "string" && value.trim().length <= maxLength
        ? value.trim()
        : "";
}

function canonicalId(value) {
    return typeof value === "string" &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function issueReference(value) {
    const match = /^#([1-9][0-9]*)$/.exec(clean(value, 40));
    return match ? Number(match[1]) : null;
}

function repositoryName(value) {
    return typeof value === "string" &&
        value.length <= 300 &&
        /^[^/\s]+\/[^/\s]+$/.test(value);
}

function errorMessage(value) {
    return String(value?.message || value || "Agent identity provenance unavailable.")
        .trim()
        .slice(0, MAX_ERROR_LENGTH);
}

function permissionDenied(value) {
    return /(?:\b401\b|\b403\b|forbidden|resource not accessible|permission)/i
        .test(errorMessage(value));
}

function missingSource(value) {
    return /(?:\b404\b|not found)/i.test(errorMessage(value));
}

function avatarReference(value, id, diagnostics, path) {
    if (value === undefined) return null;
    if (!isRecord(value) ||
        value.kind !== "repository-path" ||
        typeof value.path !== "string") {
        diagnostics.push(`${path}: avatar must be a repository-path reference`);
        return null;
    }
    const expectedPrefix = `.squad/agents/${id}/`;
    const segments = value.path.split("/");
    if (!value.path.startsWith(expectedPrefix) ||
        value.path.length === expectedPrefix.length ||
        value.path.startsWith("/") ||
        value.path.includes("\\") ||
        segments.includes("..") ||
        segments.includes(".")) {
        diagnostics.push(`${path}.path: avatar path must stay under ${expectedPrefix}`);
        return null;
    }
    return { kind: "repository-path", path: value.path };
}

function parseAgentRecord(id, value, diagnostics) {
    const path = `agents.${id}`;
    if (!canonicalId(id)) {
        diagnostics.push(`${path}: agent id must be lowercase kebab-case`);
        return null;
    }
    if (!isRecord(value)) {
        diagnostics.push(`${path}: agent record must be an object`);
        return null;
    }
    const displayName = clean(value.display_name, 240);
    const persistentName = clean(value.persistent_name, 240);
    const role = clean(value.role, 240);
    const universe = clean(value.universe, 120);
    const status = ["active", "inactive", "retired"].includes(value.status)
        ? value.status
        : "";
    const createdAt = timestamp(value.created_at);
    const updatedAt = timestamp(value.updated_at);
    const retiredAt = value.status === "retired" ? timestamp(value.retired_at) : null;
    if (!displayName) diagnostics.push(`${path}.display_name: display name is required`);
    if (!persistentName) {
        diagnostics.push(`${path}.persistent_name: compatibility alias is required`);
    } else if (displayName && persistentName !== displayName) {
        diagnostics.push(`${path}.persistent_name: must equal display_name`);
    }
    if (!role) diagnostics.push(`${path}.role: role is required`);
    if (!universe) diagnostics.push(`${path}.universe: universe is required`);
    if (!status) diagnostics.push(`${path}.status: unsupported status`);
    if (!createdAt) diagnostics.push(`${path}.created_at: timestamp is invalid`);
    if (!updatedAt) diagnostics.push(`${path}.updated_at: timestamp is invalid`);
    if (value.status === "retired" && !retiredAt) {
        diagnostics.push(`${path}.retired_at: retired records require a timestamp`);
    }
    const beforeAvatar = diagnostics.length;
    const avatar = avatarReference(value.avatar, id, diagnostics, `${path}.avatar`);
    if (diagnostics.some((diagnostic, index) =>
        index >= beforeAvatar && diagnostic.startsWith(`${path}.avatar`)) ||
        diagnostics.some((diagnostic) =>
            diagnostic.startsWith(`${path}.`) && !diagnostic.startsWith(`${path}.avatar`))) {
        return null;
    }
    return {
        id,
        displayName,
        role,
        universe,
        status,
        createdAt,
        updatedAt,
        retiredAt,
        avatar,
        legacyNamed: value.legacy_named === true,
    };
}

export function parseAgentProvenanceRegistry(value) {
    if (!isRecord(value)) throw new Error("Agent provenance registry root must be an object.");
    if (value.schema !== AGENT_PROVENANCE_SCHEMA ||
        value.schema_version !== AGENT_PROVENANCE_VERSION) {
        throw new Error(`Unsupported agent provenance schema; expected ${AGENT_PROVENANCE_SCHEMA}.`);
    }
    if (!positiveInteger(value.revision)) {
        throw new Error("Agent provenance revision must be a positive integer.");
    }
    const generatedAt = timestamp(value.generated_at);
    if (!generatedAt) throw new Error("Agent provenance generated_at must be an ISO-8601 timestamp.");
    if (!isRecord(value.agents)) throw new Error("Agent provenance agents must be an object.");
    const entries = Object.entries(value.agents);
    if (entries.length > MAX_AGENTS) {
        throw new Error(`Agent provenance registry exceeded the ${MAX_AGENTS}-agent ceiling.`);
    }
    const diagnostics = [];
    const agents = [];
    const displayNames = new Map();
    for (const [id, recordValue] of entries) {
        const record = parseAgentRecord(id, recordValue, diagnostics);
        if (!record) continue;
        const displayKey = record.displayName.toLocaleLowerCase("en-US");
        const duplicate = displayNames.get(displayKey);
        if (duplicate) {
            diagnostics.push(
                `agents.${id}.display_name: display name collides with agent ${duplicate}`,
            );
            continue;
        }
        displayNames.set(displayKey, id);
        agents.push(record);
    }
    return {
        registry: {
            schemaVersion: 1,
            producer: "squad",
            revision: value.revision,
            generatedAt,
            agents: agents.sort((left, right) => left.id.localeCompare(right.id)),
        },
        completeness: diagnostics.length === 0 ? "complete" : "partial",
        diagnostics: diagnostics.slice(0, 20),
    };
}

function normalizedRegistryToWire(value) {
    if (!isRecord(value) ||
        value.schemaVersion !== 1 ||
        value.producer !== "squad" ||
        !positiveInteger(value.revision) ||
        !timestamp(value.generatedAt) ||
        !Array.isArray(value.agents) ||
        value.agents.length > MAX_AGENTS) {
        return null;
    }
    const agents = {};
    for (const record of value.agents) {
        if (!isRecord(record) || !canonicalId(record.id)) return null;
        agents[record.id] = {
            display_name: record.displayName,
            persistent_name: record.displayName,
            role: record.role,
            universe: record.universe,
            status: record.status,
            created_at: record.createdAt,
            updated_at: record.updatedAt,
            ...(record.retiredAt ? { retired_at: record.retiredAt } : {}),
            ...(record.avatar ? {
                avatar: {
                    kind: record.avatar.kind,
                    path: record.avatar.path,
                },
            } : {}),
            ...(record.legacyNamed ? { legacy_named: true } : {}),
        };
    }
    return {
        schema: AGENT_PROVENANCE_SCHEMA,
        schema_version: AGENT_PROVENANCE_VERSION,
        revision: value.revision,
        generated_at: value.generatedAt,
        agents,
    };
}

export function validateNormalizedAgentRegistry(value) {
    const wire = normalizedRegistryToWire(value);
    if (!wire) return null;
    try {
        const parsed = parseAgentProvenanceRegistry(wire);
        return parsed.completeness === "complete" ? parsed.registry : null;
    } catch {
        return null;
    }
}

function normalizedSource(previous) {
    const source = previous?.sourceState?.agentIdentity;
    if (!isRecord(source)) {
        return {
            revision: AGENT_IDENTITY_SOURCE_REVISION,
            data: null,
            lastAttemptedRefresh: null,
            lastSuccessfulRefresh: null,
            status: "unavailable",
            error: null,
        };
    }
    return normalizePersistedAgentIdentitySource(source);
}

function failureSource(prior, attemptedAt, status, kind, message) {
    return {
        ...prior,
        revision: AGENT_IDENTITY_SOURCE_REVISION,
        lastAttemptedRefresh: attemptedAt,
        status: prior.data ? "stale" : status,
        error: { kind, message: errorMessage(message) },
    };
}

export async function discoverAgentIdentityProvenance({
    runJson,
    cwd,
    repository,
    previous,
    attemptedAt,
    requestAllowed = true,
}) {
    const prior = normalizedSource(previous);
    if (!requestAllowed) {
        return failureSource(
            prior,
            attemptedAt,
            "unavailable",
            "fetch_failed",
            "Agent identity REST budget is exhausted.",
        );
    }
    if (!repositoryName(repository)) {
        return failureSource(
            prior,
            attemptedAt,
            "unavailable",
            "fetch_failed",
            "Agent identity repository is unavailable.",
        );
    }
    try {
        const response = await runJson([
            "api",
            `repos/${repository}/contents/${REGISTRY_PATH}`,
        ], cwd);
        if (!isRecord(response) ||
            response.type !== "file" ||
            response.encoding !== "base64" ||
            typeof response.content !== "string" ||
            typeof response.sha !== "string" ||
            response.sha.length === 0) {
            throw new Error("Agent provenance content response is malformed.");
        }
        const encoded = response.content.replace(/\s/g, "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
            throw new Error("Agent provenance content encoding is malformed.");
        }
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.length > MAX_REGISTRY_BYTES ||
            (positiveInteger(response.size) && response.size !== bytes.length)) {
            throw new Error("Agent provenance content was truncated or exceeded its size ceiling.");
        }
        let wire;
        try {
            wire = JSON.parse(bytes.toString("utf8"));
        } catch {
            throw new Error("Agent provenance registry JSON is malformed.");
        }
        const parsed = parseAgentProvenanceRegistry(wire);
        if (parsed.completeness !== "complete") {
            return failureSource(
                prior,
                attemptedAt,
                "partial",
                "partial",
                `Agent provenance registry is partial: ${parsed.diagnostics.join("; ")}`,
            );
        }
        if (prior.data &&
            (parsed.registry.revision < prior.data.registry.revision ||
                (parsed.registry.revision === prior.data.registry.revision &&
                    response.sha !== prior.data.blobSha))) {
            return failureSource(
                prior,
                attemptedAt,
                "malformed",
                "malformed",
                "Agent provenance revision regressed or changed without advancing.",
            );
        }
        return {
            revision: AGENT_IDENTITY_SOURCE_REVISION,
            data: {
                schemaVersion: 1,
                producer: "squad",
                repository,
                blobSha: response.sha,
                registry: parsed.registry,
            },
            lastAttemptedRefresh: attemptedAt,
            lastSuccessfulRefresh: attemptedAt,
            status: "fresh",
            error: null,
        };
    } catch (error) {
        if (missingSource(error)) {
            return {
                revision: AGENT_IDENTITY_SOURCE_REVISION,
                data: null,
                lastAttemptedRefresh: attemptedAt,
                lastSuccessfulRefresh: attemptedAt,
                status: "missing",
                error: null,
            };
        }
        if (permissionDenied(error)) {
            return failureSource(
                prior,
                attemptedAt,
                "forbidden",
                "permission_denied",
                error,
            );
        }
        const malformed = /(?:malformed|unsupported|partial|truncated|ceiling|regressed)/i
            .test(errorMessage(error));
        return failureSource(
            prior,
            attemptedAt,
            malformed ? "malformed" : "unavailable",
            malformed ? "malformed" : "fetch_failed",
            error,
        );
    }
}

export function normalizePersistedAgentIdentitySource(value) {
    if (!isRecord(value)) return normalizedSource(null);
    const registry = validateNormalizedAgentRegistry(value.data?.registry);
    const repository = clean(value.data?.repository, 300);
    const blobSha = clean(value.data?.blobSha, 160);
    const data = registry && repositoryName(repository) && blobSha
        ? {
            schemaVersion: 1,
            producer: "squad",
            repository,
            blobSha,
            registry,
        }
        : null;
    const status = [
        "fresh",
        "stale",
        "unavailable",
        "missing",
        "malformed",
        "forbidden",
        "partial",
    ].includes(value.status)
        ? value.status
        : "unavailable";
    const errorKind = [
        "fetch_failed",
        "permission_denied",
        "malformed",
        "partial",
    ].includes(value.error?.kind)
        ? value.error.kind
        : null;
    return {
        revision: AGENT_IDENTITY_SOURCE_REVISION,
        data,
        lastAttemptedRefresh: timestamp(value.lastAttemptedRefresh),
        lastSuccessfulRefresh: timestamp(value.lastSuccessfulRefresh),
        status: data || ["missing", "unavailable", "malformed", "forbidden", "partial"].includes(status)
            ? status
            : "unavailable",
        error: errorKind
            ? {
                kind: errorKind,
                message: clean(value.error?.message, MAX_ERROR_LENGTH) ||
                    "Agent identity provenance is unavailable.",
            }
            : null,
    };
}

export function parseWorkAgentBindings(value, registry, context) {
    const normalizedRegistry = validateNormalizedAgentRegistry(registry);
    if (!normalizedRegistry) {
        throw new Error("Work-agent bindings require a complete validated registry.");
    }
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error("Work-agent bindings must be a non-empty array.");
    }
    if (!repositoryName(context?.repository) ||
        !positiveInteger(context?.originIssue) ||
        !ACTIVATION_KINDS.has(context?.artifact)) {
        throw new Error("Work-agent binding context is malformed.");
    }
    if (value.length > MAX_BINDINGS) {
        throw new Error(`Work-agent bindings exceeded the ${MAX_BINDINGS}-row ceiling.`);
    }
    const agents = new Set(normalizedRegistry.agents.map((agent) => agent.id));
    const bindings = [];
    const issues = new Set();
    const tasks = new Set();
    const diagnostics = [];
    for (const [index, raw] of value.entries()) {
        const path = `bindings.${index}`;
        if (!isRecord(raw)) {
            diagnostics.push(`${path}: binding must be an object`);
            continue;
        }
        const issueNumber = issueReference(raw.issue);
        const epicIssueNumber = issueReference(raw.epic_issue);
        const agentId = raw.agent_id === null ? null : clean(raw.agent_id, 160);
        const epicAgentIds = Array.isArray(raw.epic_agent_ids)
            ? raw.epic_agent_ids.map((id) => clean(id, 160))
            : [];
        const binding = {
            schemaVersion: 1,
            producer: "squad",
            repository: clean(raw.repository, 300),
            originIssue: raw.origin_issue,
            artifact: clean(raw.artifact, 40),
            registryRevision: raw.registry_revision,
            task: clean(raw.task, 80),
            issueNumber,
            epic: clean(raw.epic, 80),
            epicIssueNumber,
            agentId,
            epicAgentIds: [...epicAgentIds].sort(),
            identityOmissionReason: clean(raw.identity_omission_reason, 80) || null,
            epicIdentityOmissionReason: clean(raw.epic_identity_omission_reason, 80) || null,
        };
        if (raw.binding_schema !== WORK_AGENT_BINDING_SCHEMA ||
            raw.binding_version !== WORK_AGENT_BINDING_VERSION) {
            diagnostics.push(`${path}: unsupported binding schema`);
        }
        if (raw.producer !== "squad" ||
            binding.repository !== context.repository ||
            binding.originIssue !== context.originIssue ||
            binding.artifact !== context.artifact ||
            raw.registry_schema !== AGENT_PROVENANCE_SCHEMA) {
            diagnostics.push(`${path}: binding authority does not match its activation artifact`);
        }
        if (!positiveInteger(binding.registryRevision) ||
            binding.registryRevision > normalizedRegistry.revision) {
            diagnostics.push(`${path}.registry_revision: unavailable registry revision`);
        }
        if (!binding.task || !issueNumber || !binding.epic || !epicIssueNumber) {
            diagnostics.push(`${path}: work references are malformed`);
        }
        if (agentId === null) {
            if (!IDENTITY_OMISSION_REASONS.has(binding.identityOmissionReason)) {
                diagnostics.push(`${path}.identity_omission_reason: explicit omission is required`);
            }
        } else if (!canonicalId(agentId) ||
            !agents.has(agentId) ||
            binding.identityOmissionReason) {
            diagnostics.push(`${path}.agent_id: agent id is unresolved or inconsistent`);
        }
        if (!Array.isArray(raw.epic_agent_ids) ||
            epicAgentIds.some((id) => !canonicalId(id) || !agents.has(id)) ||
            new Set(epicAgentIds).size !== epicAgentIds.length ||
            (agentId !== null && !epicAgentIds.includes(agentId)) ||
            (binding.epicIdentityOmissionReason &&
                binding.epicIdentityOmissionReason !== "partial")) {
            diagnostics.push(`${path}.epic_agent_ids: epic identity set is malformed`);
        }
        if (issueNumber && issues.has(issueNumber)) {
            diagnostics.push(`${path}.issue: duplicate task issue`);
        }
        if (binding.task && tasks.has(binding.task)) {
            diagnostics.push(`${path}.task: duplicate task identifier`);
        }
        if (issueNumber) issues.add(issueNumber);
        if (binding.task) tasks.add(binding.task);
        bindings.push(binding);
    }
    const expectedRevision = bindings[0]?.registryRevision;
    const epicIssueById = new Map();
    const epicIdByIssue = new Map();
    const byEpicIssue = new Map();
    for (const [index, binding] of bindings.entries()) {
        if (binding.registryRevision !== expectedRevision) {
            diagnostics.push(`bindings.${index}.registry_revision: mixed registry revisions`);
        }
        const priorIssue = epicIssueById.get(binding.epic);
        const priorEpic = epicIdByIssue.get(binding.epicIssueNumber);
        if (priorIssue !== undefined && priorIssue !== binding.epicIssueNumber) {
            diagnostics.push(`bindings.${index}.epic_issue: conflicting epic mapping`);
        }
        if (priorEpic !== undefined && priorEpic !== binding.epic) {
            diagnostics.push(`bindings.${index}.epic: conflicting reverse epic mapping`);
        }
        epicIssueById.set(binding.epic, binding.epicIssueNumber);
        epicIdByIssue.set(binding.epicIssueNumber, binding.epic);
        const group = byEpicIssue.get(binding.epicIssueNumber) || [];
        group.push({ binding, index });
        byEpicIssue.set(binding.epicIssueNumber, group);
    }
    for (const group of byEpicIssue.values()) {
        const expectedIds = [...new Set(group
            .map(({ binding }) => binding.agentId)
            .filter(Boolean))].sort();
        const partial = group.some(({ binding }) => binding.agentId === null);
        for (const { binding, index } of group) {
            if (binding.epicAgentIds.join("\0") !== expectedIds.join("\0")) {
                diagnostics.push(`bindings.${index}.epic_agent_ids: incomplete epic identity set`);
            }
            if (partial !== (binding.epicIdentityOmissionReason === "partial")) {
                diagnostics.push(`bindings.${index}.epic_identity_omission_reason: inconsistent omission`);
            }
        }
    }
    if (diagnostics.length > 0) {
        throw new Error(
            `Work-agent bindings are malformed or partial: ${diagnostics.slice(0, 8).join("; ")}`,
        );
    }
    return bindings;
}

function sourceForIdentity(source, status = source.status, error = source.error) {
    return {
        producer: "squad",
        revision: source.data?.blobSha || "",
        registryRevision: source.data?.registry?.revision || null,
        status,
        lastAttemptedRefresh: source.lastAttemptedRefresh,
        lastSuccessfulRefresh: source.lastSuccessfulRefresh,
        error,
    };
}

function unknownIdentity(source, status = source.status, error = source.error, binding = null) {
    return {
        status: "unknown",
        record: null,
        binding,
        source: sourceForIdentity(source, status, error),
    };
}

export function agentIdentitiesForGoals({
    goals,
    source,
    repository,
    bindingSourceComplete = true,
}) {
    const normalizedSource = normalizePersistedAgentIdentitySource(source);
    const result = new Map();
    if (!normalizedSource.data) {
        for (const goal of goals) {
            result.set(Number(goal?.issue?.number), unknownIdentity(normalizedSource));
        }
        return result;
    }
    if (normalizedSource.data.repository.toLowerCase() !== repository.toLowerCase()) {
        const error = {
            kind: "malformed",
            message: "Agent provenance registry repository does not match the activity repository.",
        };
        for (const goal of goals) {
            result.set(
                Number(goal?.issue?.number),
                unknownIdentity(normalizedSource, "malformed", error),
            );
        }
        return result;
    }
    if (!bindingSourceComplete) {
        const error = {
            kind: "fetch_failed",
            message: "Authoritative work-agent binding evidence is stale, capped, or incomplete.",
        };
        for (const goal of goals) {
            result.set(
                Number(goal?.issue?.number),
                unknownIdentity(normalizedSource, "stale", error),
            );
        }
        return result;
    }
    const bindingsByIssue = new Map();
    let invalid = "";
    for (const goal of goals) {
        for (const artifact of Array.isArray(goal?.artifacts) ? goal.artifacts : []) {
            if (!artifact?.identityCandidate &&
                !Array.isArray(artifact?.bindings)) {
                continue;
            }
            if (!ACTIVATION_KINDS.has(artifact?.kind) ||
                artifact.validation !== "supported" ||
                !Array.isArray(artifact.bindings)) {
                invalid = artifact?.validationReason ||
                    "Authoritative work-agent binding evidence is malformed.";
                break;
            }
            const authoritative = artifact.bindings.some((binding) =>
                binding?.binding_schema === WORK_AGENT_BINDING_SCHEMA ||
                binding?.registry_schema === AGENT_PROVENANCE_SCHEMA);
            if (!authoritative) continue;
            try {
                const bindings = parseWorkAgentBindings(
                    artifact.bindings,
                    normalizedSource.data.registry,
                    {
                        repository,
                        originIssue: artifact.originIssue,
                        artifact: artifact.kind,
                    },
                );
                for (const binding of bindings) {
                    const existing = bindingsByIssue.get(binding.issueNumber);
                    if (existing) {
                        throw new Error(
                            `Duplicate work-agent bindings for issue #${binding.issueNumber}.`,
                        );
                    }
                    bindingsByIssue.set(binding.issueNumber, binding);
                }
            } catch (error) {
                invalid = errorMessage(error);
                break;
            }
        }
        if (invalid) break;
    }
    if (invalid) {
        const error = { kind: "malformed", message: invalid };
        for (const goal of goals) {
            result.set(
                Number(goal?.issue?.number),
                unknownIdentity(normalizedSource, "malformed", error),
            );
        }
        return result;
    }
    const agents = new Map(normalizedSource.data.registry.agents.map((agent) => [
        agent.id,
        agent,
    ]));
    for (const goal of goals) {
        const issueNumber = Number(goal?.issue?.number);
        const binding = bindingsByIssue.get(issueNumber) || null;
        if (!binding) {
            result.set(
                issueNumber,
                normalizedSource.status === "fresh"
                    ? unknownIdentity(normalizedSource, "missing", null)
                    : unknownIdentity(normalizedSource),
            );
            continue;
        }
        if (binding.agentId === null) {
            result.set(
                issueNumber,
                unknownIdentity(
                    normalizedSource,
                    normalizedSource.status,
                    normalizedSource.error,
                    binding,
                ),
            );
            continue;
        }
        const agent = agents.get(binding.agentId);
        if (!agent) {
            result.set(
                issueNumber,
                unknownIdentity(normalizedSource, "malformed", {
                    kind: "malformed",
                    message: "Bound agent id is absent from the validated registry.",
                }),
            );
            continue;
        }
        result.set(issueNumber, {
            status: agent.status === "retired" ? "deleted" : "resolved",
            record: agent.status === "retired"
                ? null
                : {
                    schemaVersion: 1,
                    id: agent.id,
                    displayName: agent.displayName,
                    role: agent.role,
                    universe: agent.universe,
                    lifecycleStatus: agent.status,
                    avatar: agent.avatar,
                },
            binding,
            source: sourceForIdentity(normalizedSource),
        });
    }
    return result;
}

export function agentIdentityPolicy() {
    return {
        registryPath: REGISTRY_PATH,
        maxRegistryBytes: MAX_REGISTRY_BYTES,
        maxAgents: MAX_AGENTS,
        maxBindings: MAX_BINDINGS,
    };
}
