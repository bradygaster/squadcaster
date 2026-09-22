export const AGENT_PROVENANCE_SCHEMA = "squad-agent-provenance/v1";
export const AGENT_PROVENANCE_VERSION = 1;
export const WORK_AGENT_BINDING_SCHEMA = "squad-work-agent-binding/v1";
export const WORK_AGENT_BINDING_VERSION = 1;
export const AGENT_IDENTITY_SOURCE_REVISION = 1;

const SOURCE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_AGENTS = 200;
const MAX_AVATARS = 40;
const MAX_AVATAR_BYTES = 256 * 1024;
const ACTIVATION_KINDS = new Set([
    "activated",
    "phases-activated",
    "plan-accepted",
    "phases-accepted",
]);
const AGENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value) {
    if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) {
        return "";
    }
    return new Date(value).toISOString();
}

function text(value, maxLength = 500) {
    return typeof value === "string" && value.trim() && value.length <= maxLength
        ? value.trim()
        : "";
}

function issueNumber(value) {
    const match = String(value || "").trim().match(/^#?([1-9][0-9]*)$/);
    return match ? Number(match[1]) : null;
}

function safeError(error) {
    return String(error?.message || error || "").trim().slice(0, 800);
}

function permissionDenied(message) {
    return /\b403\b|forbidden|resource not accessible|permission denied/i.test(message);
}

function missingResource(message) {
    return /\b404\b|not found/i.test(message);
}

function validateAvatar(value, id, diagnostics) {
    if (value === undefined) return null;
    const prefix = `.squad/agents/${id}/`;
    if (!isRecord(value) ||
        value.kind !== "repository-path" ||
        typeof value.path !== "string" ||
        !value.path.startsWith(prefix) ||
        value.path.length === prefix.length ||
        value.path.startsWith("/") ||
        value.path.includes("\\") ||
        value.path.split("/").some((segment) => segment === "." || segment === "..")) {
        diagnostics.push(`agents.${id}.avatar: path must stay under ${prefix}`);
        return null;
    }
    return { kind: "repository-path", path: value.path };
}

function parseAgentRecord(id, value, diagnostics) {
    const before = diagnostics.length;
    if (!AGENT_ID.test(id)) diagnostics.push(`agents.${id}: id must be lowercase kebab-case`);
    if (!isRecord(value)) {
        diagnostics.push(`agents.${id}: record must be an object`);
        return null;
    }
    const displayName = text(value.display_name, 160);
    const persistentName = text(value.persistent_name, 160);
    const role = text(value.role, 160);
    const universe = text(value.universe, 160);
    const createdAt = timestamp(value.created_at);
    const updatedAt = timestamp(value.updated_at);
    const retiredAt = value.status === "retired" ? timestamp(value.retired_at) : null;
    if (!displayName) diagnostics.push(`agents.${id}.display_name: required`);
    if (!persistentName || persistentName !== displayName) {
        diagnostics.push(`agents.${id}.persistent_name: must equal display_name`);
    }
    if (!role) diagnostics.push(`agents.${id}.role: required`);
    if (!universe) diagnostics.push(`agents.${id}.universe: required`);
    if (!["active", "inactive", "retired"].includes(value.status)) {
        diagnostics.push(`agents.${id}.status: unsupported`);
    }
    if (!createdAt) diagnostics.push(`agents.${id}.created_at: invalid`);
    if (!updatedAt) diagnostics.push(`agents.${id}.updated_at: invalid`);
    if (value.status === "retired" && !retiredAt) {
        diagnostics.push(`agents.${id}.retired_at: required`);
    }
    const avatar = validateAvatar(value.avatar, id, diagnostics);
    if (diagnostics.length !== before) return null;
    return {
        id,
        displayName,
        role,
        universe,
        status: value.status,
        createdAt,
        updatedAt,
        retiredAt,
        avatar,
    };
}

export function parseAgentProvenanceRegistry(value) {
    if (!isRecord(value)) throw new Error("Agent provenance registry root is malformed.");
    if (value.schema !== AGENT_PROVENANCE_SCHEMA ||
        value.schema_version !== AGENT_PROVENANCE_VERSION) {
        throw new Error(`Unsupported agent provenance schema; expected ${AGENT_PROVENANCE_SCHEMA}.`);
    }
    if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
        throw new Error("Agent provenance revision must be a positive integer.");
    }
    const generatedAt = timestamp(value.generated_at);
    if (!generatedAt) throw new Error("Agent provenance generated_at is invalid.");
    if (!isRecord(value.agents)) throw new Error("Agent provenance agents are malformed.");
    const entries = Object.entries(value.agents);
    if (entries.length > MAX_AGENTS) {
        throw new Error(`Agent provenance registry exceeded the ${MAX_AGENTS}-agent ceiling.`);
    }
    const diagnostics = [];
    const agents = {};
    const names = new Map();
    for (const [id, rawRecord] of entries) {
        const record = parseAgentRecord(id, rawRecord, diagnostics);
        if (!record) continue;
        const nameKey = record.displayName.toLocaleLowerCase("en-US");
        const collision = names.get(nameKey);
        if (collision) {
            diagnostics.push(`agents.${id}.display_name: collides with ${collision}`);
            delete agents[collision];
            continue;
        }
        names.set(nameKey, id);
        agents[id] = record;
    }
    return {
        registry: {
            schema: AGENT_PROVENANCE_SCHEMA,
            schemaVersion: AGENT_PROVENANCE_VERSION,
            revision: value.revision,
            generatedAt,
            agents,
        },
        completeness: diagnostics.length === 0 ? "complete" : "partial",
        diagnostics,
    };
}

function decodeContent(response, label, maximumBytes) {
    if (!isRecord(response) ||
        response.encoding !== "base64" ||
        typeof response.content !== "string" ||
        !text(response.sha, 100)) {
        throw new Error(`${label} response is malformed.`);
    }
    const compact = response.content.replace(/\s/g, "");
    const bytes = Buffer.from(compact, "base64");
    if (bytes.length > maximumBytes || Number(response.size) > maximumBytes) {
        throw new Error(`${label} exceeded the ${maximumBytes}-byte ceiling.`);
    }
    if (bytes.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, "")) {
        throw new Error(`${label} base64 content is malformed.`);
    }
    return bytes;
}

function avatarMediaType(bytes) {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
        return "image/gif";
    }
    if (bytes.length >= 12 &&
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP") {
        return "image/webp";
    }
    return "";
}

function validatedAvatarDataUrl(value) {
    const match = typeof value === "string"
        ? value.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/)
        : null;
    if (!match) return "";
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > MAX_AVATAR_BYTES ||
        bytes.toString("base64").replace(/=+$/, "") !== match[2].replace(/=+$/, "") ||
        avatarMediaType(bytes) !== match[1]) {
        return "";
    }
    return value;
}

async function fetchAvatar({
    runJson,
    cwd,
    repository,
    id,
    reference,
    attemptedAt,
    reserveRequest,
}) {
    try {
        if (!reserveRequest()) {
            throw new Error("Avatar REST budget exhausted before the content request.");
        }
        const encodedPath = reference.path.split("/").map(encodeURIComponent).join("/");
        const response = await runJson([
            "api",
            `repos/${repository}/contents/${encodedPath}`,
        ], cwd);
        const bytes = decodeContent(response, `Avatar for ${id}`, MAX_AVATAR_BYTES);
        const mediaType = avatarMediaType(bytes);
        if (!mediaType) throw new Error(`Avatar for ${id} has an unsupported media type.`);
        return {
            status: "fresh",
            reference,
            revision: response.sha,
            fetchedAt: attemptedAt,
            dataUrl: `data:${mediaType};base64,${bytes.toString("base64")}`,
            error: "",
        };
    } catch (error) {
        const message = safeError(error);
        return {
            status: missingResource(message)
                ? "missing"
                : permissionDenied(message)
                    ? "forbidden"
                    : /malformed|unsupported|exceeded|invalid/i.test(message)
                        ? "malformed"
                        : "unavailable",
            reference,
            revision: "",
            fetchedAt: attemptedAt,
            dataUrl: "",
            error: message,
        };
    }
}

function priorSource(previous) {
    const value = previous?.sourceState?.agentIdentity;
    return isRecord(value) && value.revision === AGENT_IDENTITY_SOURCE_REVISION
        ? value
        : {
            revision: AGENT_IDENTITY_SOURCE_REVISION,
            status: "unavailable",
            lastAttemptedRefresh: null,
            lastSuccessfulRefresh: null,
            transportRevision: "",
            registry: null,
            avatars: {},
            diagnostics: [],
            error: "",
        };
}

export async function discoverAgentIdentity({
    runJson,
    cwd,
    repository,
    previous,
    attemptedAt,
    reserveRequest = () => true,
}) {
    const prior = priorSource(previous);
    const attemptedTime = Date.parse(attemptedAt);
    const previousAttempt = Date.parse(prior.lastAttemptedRefresh || "");
    if (["fresh", "missing"].includes(prior.status) &&
        Number.isFinite(attemptedTime) &&
        Number.isFinite(previousAttempt) &&
        attemptedTime - previousAttempt < SOURCE_REFRESH_INTERVAL_MS) {
        return prior;
    }
    try {
        if (!repository) throw new Error("Identity repository is unavailable.");
        if (!reserveRequest()) {
            throw new Error("Agent identity REST budget exhausted before the registry request.");
        }
        const response = await runJson([
            "api",
            `repos/${repository}/contents/.squad/casting/registry.json`,
        ], cwd);
        if (Array.isArray(response) && response.length === 0) {
            throw new Error("HTTP 404: Agent provenance registry not found.");
        }
        const bytes = decodeContent(response, "Agent provenance registry", MAX_REGISTRY_BYTES);
        let payload;
        try {
            payload = JSON.parse(bytes.toString("utf8"));
        } catch {
            throw new Error("Agent provenance registry JSON is malformed.");
        }
        const parsed = parseAgentProvenanceRegistry(payload);
        if (prior.registry && parsed.registry.revision < prior.registry.revision) {
            throw new Error(
                `Agent provenance revision rollback from ${prior.registry.revision} to ` +
                `${parsed.registry.revision} is invalid.`,
            );
        }
        if (prior.registry &&
            parsed.registry.revision === prior.registry.revision &&
            prior.transportRevision &&
            prior.transportRevision !== response.sha) {
            throw new Error(
                `Agent provenance revision ${parsed.registry.revision} was reused with different content.`,
            );
        }
        const avatarEntries = Object.values(parsed.registry.agents)
            .filter((agent) => agent.avatar);
        if (avatarEntries.length > MAX_AVATARS) {
            throw new Error(`Agent provenance avatars exceeded the ${MAX_AVATARS}-avatar ceiling.`);
        }
        const avatars = Object.fromEntries(await Promise.all(avatarEntries.map(async (agent) => [
            agent.id,
            await fetchAvatar({
                runJson,
                cwd,
                repository,
                id: agent.id,
                reference: agent.avatar,
                attemptedAt,
                reserveRequest,
            }),
        ])));
        if (parsed.completeness === "partial" &&
            prior.registry &&
            ["fresh", "stale"].includes(prior.status)) {
            return {
                ...prior,
                status: "stale",
                lastAttemptedRefresh: attemptedAt,
                diagnostics: parsed.diagnostics,
                error: "Agent provenance replacement was partial; retained the last complete registry.",
            };
        }
        return {
            revision: AGENT_IDENTITY_SOURCE_REVISION,
            status: parsed.completeness === "complete" ? "fresh" : "partial",
            lastAttemptedRefresh: attemptedAt,
            lastSuccessfulRefresh: parsed.completeness === "complete" ? attemptedAt : null,
            transportRevision: response.sha,
            registry: parsed.registry,
            avatars,
            diagnostics: parsed.diagnostics,
            error: parsed.diagnostics.join("; ").slice(0, 800),
        };
    } catch (error) {
        const message = safeError(error);
        if (missingResource(message)) {
            return {
                revision: AGENT_IDENTITY_SOURCE_REVISION,
                status: "missing",
                lastAttemptedRefresh: attemptedAt,
                lastSuccessfulRefresh: attemptedAt,
                transportRevision: "",
                registry: null,
                avatars: {},
                diagnostics: [],
                error: "",
            };
        }
        const status = permissionDenied(message)
            ? "forbidden"
            : /malformed|unsupported|exceeded|invalid/i.test(message)
                ? "malformed"
                : "unavailable";
        if (prior.registry && ["fresh", "stale"].includes(prior.status)) {
            return {
                ...prior,
                status: "stale",
                lastAttemptedRefresh: attemptedAt,
                error: message,
            };
        }
        return {
            revision: AGENT_IDENTITY_SOURCE_REVISION,
            status,
            lastAttemptedRefresh: attemptedAt,
            lastSuccessfulRefresh: prior.lastSuccessfulRefresh || null,
            transportRevision: "",
            registry: null,
            avatars: {},
            diagnostics: [],
            error: message,
        };
    }
}

export function validateWorkAgentBindings(value, source, context) {
    if (!["fresh", "stale"].includes(source?.status) || !source.registry) {
        throw new Error("Work-agent bindings require a complete validated registry.");
    }
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error("Work-agent bindings must be a non-empty array.");
    }
    const registry = source.registry;
    const bindings = [];
    const issues = new Set();
    const tasks = new Set();
    for (const raw of value) {
        if (!isRecord(raw) ||
            raw.binding_schema !== WORK_AGENT_BINDING_SCHEMA ||
            raw.binding_version !== WORK_AGENT_BINDING_VERSION ||
            raw.producer !== "squad" ||
            raw.repository !== context.repository ||
            raw.origin_issue !== context.originIssue ||
            raw.artifact !== context.artifact ||
            raw.registry_schema !== AGENT_PROVENANCE_SCHEMA ||
            !Number.isSafeInteger(raw.registry_revision) ||
            raw.registry_revision < 1 ||
            raw.registry_revision > registry.revision ||
            !text(raw.task, 80) ||
            !issueNumber(raw.issue) ||
            !text(raw.epic, 80) ||
            !issueNumber(raw.epic_issue) ||
            !Array.isArray(raw.epic_agent_ids)) {
            throw new Error("Work-agent bindings are malformed or unsupported.");
        }
        if (raw.agent_id === null) {
            if (!["external-agent", "non-roster", "legacy-plan-missing-id"]
                .includes(raw.identity_omission_reason)) {
                throw new Error("Null agent_id lacks an authoritative omission reason.");
            }
        } else if (!AGENT_ID.test(raw.agent_id) ||
            !registry.agents[raw.agent_id] ||
            raw.identity_omission_reason !== undefined) {
            throw new Error("Work-agent binding references an unknown or conflicting agent_id.");
        }
        const epicAgentIds = raw.epic_agent_ids.map((id) => text(id, 160));
        if (epicAgentIds.some((id) => !AGENT_ID.test(id) || !registry.agents[id]) ||
            new Set(epicAgentIds).size !== epicAgentIds.length ||
            (raw.agent_id !== null && !epicAgentIds.includes(raw.agent_id)) ||
            (raw.epic_identity_omission_reason !== undefined &&
                raw.epic_identity_omission_reason !== "partial")) {
            throw new Error("Work-agent binding has invalid epic_agent_ids.");
        }
        const number = issueNumber(raw.issue);
        const task = raw.task.trim();
        if (issues.has(number) || tasks.has(task)) {
            throw new Error("Work-agent bindings contain duplicate tasks or issues.");
        }
        issues.add(number);
        tasks.add(task);
        bindings.push({
            registryRevision: raw.registry_revision,
            task,
            issueNumber: number,
            epic: raw.epic.trim(),
            epicIssueNumber: issueNumber(raw.epic_issue),
            agentId: raw.agent_id,
            epicAgentIds: [...epicAgentIds].sort(),
            identityOmissionReason: raw.identity_omission_reason || "",
            epicIdentityOmissionReason: raw.epic_identity_omission_reason || "",
        });
    }
    const revision = bindings[0].registryRevision;
    const epicIssueById = new Map();
    const epicIdByIssue = new Map();
    const byEpic = new Map();
    for (const binding of bindings) {
        if (binding.registryRevision !== revision) {
            throw new Error("Work-agent bindings contain conflicting registry revisions.");
        }
        if (epicIssueById.has(binding.epic) &&
            epicIssueById.get(binding.epic) !== binding.epicIssueNumber) {
            throw new Error("Work-agent bindings contain conflicting epic mappings.");
        }
        if (epicIdByIssue.has(binding.epicIssueNumber) &&
            epicIdByIssue.get(binding.epicIssueNumber) !== binding.epic) {
            throw new Error("Work-agent bindings contain conflicting epic mappings.");
        }
        epicIssueById.set(binding.epic, binding.epicIssueNumber);
        epicIdByIssue.set(binding.epicIssueNumber, binding.epic);
        const group = byEpic.get(binding.epicIssueNumber) || [];
        group.push(binding);
        byEpic.set(binding.epicIssueNumber, group);
    }
    for (const group of byEpic.values()) {
        const expected = [...new Set(group.map((binding) => binding.agentId).filter(Boolean))].sort();
        const partial = group.some((binding) => binding.agentId === null);
        for (const binding of group) {
            if (binding.epicAgentIds.join("\0") !== expected.join("\0") ||
                (partial && binding.epicIdentityOmissionReason !== "partial") ||
                (!partial && binding.epicIdentityOmissionReason)) {
                throw new Error("Work-agent bindings contain incomplete or inconsistent epic identity.");
            }
        }
    }
    return bindings;
}

function unknownIdentity(source, status = "missing", error = "") {
    return {
        status: "unknown",
        record: null,
        binding: null,
        source: {
            revision: AGENT_IDENTITY_SOURCE_REVISION,
            status,
            lastAttemptedRefresh: source?.lastAttemptedRefresh || null,
            lastSuccessfulRefresh: source?.lastSuccessfulRefresh || null,
            error: error || source?.error || "",
        },
    };
}

export function resolveAgentIdentities({ repository, issues, source }) {
    const resolved = new Map();
    if (!["fresh", "stale"].includes(source?.status) || !source.registry) return resolved;
    const candidates = new Map();
    const markInvalid = (issue, activation, error) => {
        const targets = new Set([Number(issue.issue?.number)]);
        for (const binding of Array.isArray(activation?.bindings) ? activation.bindings : []) {
            const task = issueNumber(binding?.issue);
            const epic = issueNumber(binding?.epic_issue);
            if (task) targets.add(task);
            if (epic) targets.add(epic);
        }
        for (const number of targets) {
            candidates.set(number, { invalid: true, error });
        }
    };
    for (const issue of issues) {
        const artifacts = Array.isArray(issue?.artifacts) ? issue.artifacts : [];
        const activation = artifacts
            .filter((artifact) => artifact.activationCandidate)
            .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
        if (!activation) continue;
        if (activation.validation !== "supported" || !ACTIVATION_KINDS.has(activation.kind)) {
            markInvalid(
                issue,
                activation,
                activation.validationReason || "invalid activation artifact",
            );
            continue;
        }
        let bindings;
        try {
            bindings = validateWorkAgentBindings(activation.bindings, source, {
                repository,
                originIssue: activation.originIssue,
                artifact: activation.kind,
            });
        } catch (error) {
            markInvalid(issue, activation, safeError(error));
            continue;
        }
        for (const binding of bindings) {
            const relationships = [
                [binding.issueNumber, binding.agentId, "task"],
                ...binding.epicAgentIds.map((id) => [binding.epicIssueNumber, id, "epic"]),
            ];
            for (const [number, id, relation] of relationships) {
                const values = candidates.get(number) || [];
                if (!Array.isArray(values)) continue;
                values.push({ binding, id, relation });
                candidates.set(number, values);
            }
        }
    }
    for (const issue of issues) {
        const number = Number(issue.issue?.number);
        const values = candidates.get(number);
        if (!values) continue;
        if (!Array.isArray(values)) {
            resolved.set(number, unknownIdentity(source, "malformed", values.error));
            continue;
        }
        const ids = [...new Set(values.map((value) => value.id).filter(Boolean))];
        if (ids.length !== 1) {
            resolved.set(number, unknownIdentity(
                source,
                ids.length === 0 ? "missing" : "malformed",
                ids.length > 1 ? "Conflicting authoritative agent bindings." : "",
            ));
            continue;
        }
        const id = ids[0];
        const agent = source.registry.agents[id];
        if (!agent) {
            resolved.set(number, unknownIdentity(source, "malformed", "Bound agent is absent."));
            continue;
        }
        const avatar = source.avatars?.[id];
        resolved.set(number, {
            status: agent.status === "retired" ? "retired" : "resolved",
            record: {
                id,
                displayName: agent.displayName,
                role: agent.role,
                universe: agent.universe,
                lifecycleStatus: agent.status,
                createdAt: agent.createdAt,
                updatedAt: agent.updatedAt,
                retiredAt: agent.retiredAt,
                avatar: source.status === "fresh" && agent.avatar && avatar?.status === "fresh"
                    ? { ref: agent.avatar.path, dataUrl: avatar.dataUrl }
                    : null,
            },
            binding: {
                relation: values[0].relation,
                task: values[0].binding.task,
                epic: values[0].binding.epic,
                registryRevision: values[0].binding.registryRevision,
            },
            source: {
                revision: AGENT_IDENTITY_SOURCE_REVISION,
                status: source.status,
                lastAttemptedRefresh: source.lastAttemptedRefresh,
                lastSuccessfulRefresh: source.lastSuccessfulRefresh,
                avatarStatus: agent.avatar
                    ? source.status === "stale"
                        ? "stale"
                        : avatar?.status || "missing"
                    : "absent",
                error: agent.avatar && avatar?.status !== "fresh" ? avatar?.error || "" : "",
            },
        });
    }
    return resolved;
}

export function agentIdentityPolicy() {
    return {
        sourceRevision: AGENT_IDENTITY_SOURCE_REVISION,
        refreshIntervalMs: SOURCE_REFRESH_INTERVAL_MS,
        maxRegistryBytes: MAX_REGISTRY_BYTES,
        maxAgents: MAX_AGENTS,
        maxAvatars: MAX_AVATARS,
        maxAvatarBytes: MAX_AVATAR_BYTES,
    };
}

export function normalizePersistedAgentIdentitySource(value) {
    if (!isRecord(value) || value.revision !== AGENT_IDENTITY_SOURCE_REVISION) return null;
    const allowedStatuses = new Set([
        "fresh", "stale", "unavailable", "forbidden", "malformed", "partial", "missing",
    ]);
    let registry = null;
    if (value.registry) {
        try {
            const wire = {
                schema: value.registry.schema,
                schema_version: value.registry.schemaVersion,
                revision: value.registry.revision,
                generated_at: value.registry.generatedAt,
                agents: Object.fromEntries(Object.entries(value.registry.agents || {}).map(
                    ([id, agent]) => [id, {
                        display_name: agent.displayName,
                        persistent_name: agent.displayName,
                        role: agent.role,
                        universe: agent.universe,
                        status: agent.status,
                        created_at: agent.createdAt,
                        updated_at: agent.updatedAt,
                        ...(agent.retiredAt ? { retired_at: agent.retiredAt } : {}),
                        ...(agent.avatar ? { avatar: agent.avatar } : {}),
                    }],
                )),
            };
            const parsed = parseAgentProvenanceRegistry(wire);
            registry = parsed.completeness === "complete" ? parsed.registry : null;
        } catch {
            registry = null;
        }
    }
    const avatars = Object.fromEntries(Object.entries(
        isRecord(value.avatars) ? value.avatars : {},
    ).flatMap(([id, avatar]) => {
        const authoritativeReference = registry?.agents?.[id]?.avatar;
        if (!AGENT_ID.test(id) ||
            !isRecord(avatar) ||
            !["fresh", "missing", "forbidden", "malformed", "unavailable"].includes(avatar.status) ||
            !isRecord(avatar.reference) ||
            avatar.reference.kind !== "repository-path" ||
            typeof avatar.reference.path !== "string" ||
            !authoritativeReference ||
            authoritativeReference.kind !== "repository-path" ||
            avatar.reference.path !== authoritativeReference.path) return [];
        const dataUrl = avatar.status === "fresh"
            ? validatedAvatarDataUrl(avatar.dataUrl)
            : "";
        return [[id, {
            status: avatar.status === "fresh" && !dataUrl ? "malformed" : avatar.status,
            reference: {
                kind: "repository-path",
                path: authoritativeReference.path,
            },
            revision: text(avatar.revision, 100),
            fetchedAt: timestamp(avatar.fetchedAt) || null,
            dataUrl,
            error: safeError(avatar.error || ""),
        }]];
    }));
    const status = allowedStatuses.has(value.status) ? value.status : "unavailable";
    return {
        revision: AGENT_IDENTITY_SOURCE_REVISION,
        status: registry || status === "missing" ? status : "unavailable",
        lastAttemptedRefresh: timestamp(value.lastAttemptedRefresh) || null,
        lastSuccessfulRefresh: timestamp(value.lastSuccessfulRefresh) || null,
        transportRevision: text(value.transportRevision, 100),
        registry,
        avatars,
        diagnostics: Array.isArray(value.diagnostics)
            ? value.diagnostics.map((item) => text(item, 500)).filter(Boolean).slice(0, 100)
            : [],
        error: safeError(value.error || ""),
    };
}

export function normalizePersistedGoalAgentIdentity(value) {
    const unavailable = {
        status: "unknown",
        record: null,
        binding: null,
        source: {
            revision: 1,
            status: "unavailable",
            lastAttemptedRefresh: null,
            lastSuccessfulRefresh: null,
            error: "",
        },
    };
    if (!isRecord(value)) return unavailable;
    const source = isRecord(value.source) ? {
        revision: 1,
        status: text(value.source.status, 40) || "unavailable",
        lastAttemptedRefresh: timestamp(value.source.lastAttemptedRefresh) || null,
        lastSuccessfulRefresh: timestamp(value.source.lastSuccessfulRefresh) || null,
        avatarStatus: text(value.source.avatarStatus, 40) || undefined,
        error: safeError(value.source.error || ""),
    } : unavailable.source;
    if (!["resolved", "retired"].includes(value.status) ||
        !isRecord(value.record) ||
        !AGENT_ID.test(String(value.record.id || ""))) {
        return { ...unavailable, source };
    }
    const id = value.record.id;
    const displayName = text(value.record.displayName, 160);
    const role = text(value.record.role, 160);
    const universe = text(value.record.universe, 160);
    if (!displayName || !role || !universe ||
        !["active", "inactive", "retired"].includes(value.record.lifecycleStatus)) {
        return { ...unavailable, source };
    }
    const avatar = isRecord(value.record.avatar) &&
        typeof value.record.avatar.ref === "string" &&
        value.record.avatar.ref.startsWith(`.squad/agents/${id}/`) &&
        /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/
            .test(value.record.avatar.dataUrl)
        ? {
            ref: value.record.avatar.ref.slice(0, 500),
            dataUrl: value.record.avatar.dataUrl,
        }
        : null;
    return {
        status: value.record.lifecycleStatus === "retired" ? "retired" : "resolved",
        record: {
            id,
            displayName,
            role,
            universe,
            lifecycleStatus: value.record.lifecycleStatus,
            createdAt: timestamp(value.record.createdAt) || null,
            updatedAt: timestamp(value.record.updatedAt) || null,
            retiredAt: timestamp(value.record.retiredAt) || null,
            avatar,
        },
        binding: isRecord(value.binding) ? {
            relation: ["task", "epic"].includes(value.binding.relation)
                ? value.binding.relation
                : "",
            task: text(value.binding.task, 80),
            epic: text(value.binding.epic, 80),
            registryRevision: Number.isSafeInteger(value.binding.registryRevision)
                ? value.binding.registryRevision
                : null,
        } : null,
        source,
    };
}
