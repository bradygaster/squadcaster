import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    agentIdentityPolicy,
    discoverAgentIdentity,
    parseAgentProvenanceRegistry,
    resolveAgentIdentities,
    validateWorkAgentBindings,
} from "../agent-identity.mjs";
import { buildActivitySnapshot } from "../activity-model.mjs";

const registry = JSON.parse(await readFile(new URL(
    "./fixtures/agent-identity/registry-v1.json",
    import.meta.url,
), "utf8"));
const bindings = JSON.parse(await readFile(new URL(
    "./fixtures/agent-identity/bindings-v1.json",
    import.meta.url,
), "utf8"));
const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
);

function content(value, sha = "registry-sha") {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    return {
        type: "file",
        encoding: "base64",
        content: bytes.toString("base64"),
        size: bytes.length,
        sha,
    };
}

function sourceApi(registryValue = registry, avatarValue = png) {
    return async (args) => {
        const route = args[1];
        if (route.endsWith("/.squad/casting/registry.json")) {
            return content(registryValue);
        }
        if (route.endsWith("/.squad/agents/runtime-engineer/avatar.png")) {
            if (avatarValue instanceof Error) throw avatarValue;
            return content(avatarValue, "avatar-sha");
        }
        throw new Error(`Unexpected route ${route}`);
    };
}

function source(overrides = {}) {
    const parsed = parseAgentProvenanceRegistry(registry);
    return {
        revision: 1,
        status: "fresh",
        lastAttemptedRefresh: "2026-09-22T12:00:00.000Z",
        lastSuccessfulRefresh: "2026-09-22T12:00:00.000Z",
        transportRevision: "registry-sha",
        registry: parsed.registry,
        avatars: {},
        diagnostics: [],
        error: "",
        ...overrides,
    };
}

function artifact(bindingValues = bindings, overrides = {}) {
    return {
        kind: "activated",
        originIssue: 45,
        validation: "supported",
        validationReason: "",
        activationCandidate: true,
        createdAt: "2026-09-22T12:00:00.000Z",
        bindings: bindingValues,
        ...overrides,
    };
}

test("parses complete producer fixtures and preserves immutable ids across rename", () => {
    const initial = parseAgentProvenanceRegistry(registry);
    const renamed = parseAgentProvenanceRegistry({
        ...registry,
        revision: 5,
        agents: {
            ...registry.agents,
            "runtime-engineer": {
                ...registry.agents["runtime-engineer"],
                display_name: "Curie",
                persistent_name: "Curie",
                updated_at: "2026-09-22T13:00:00.000Z",
            },
        },
    });
    assert.equal(initial.completeness, "complete");
    assert.equal(renamed.registry.agents["runtime-engineer"].id, "runtime-engineer");
    assert.equal(renamed.registry.agents["runtime-engineer"].displayName, "Curie");
    assert.equal(renamed.registry.agents["retired-reviewer"].status, "retired");
});

test("rejects malformed roots, future schemas, caps, traversal, and display collisions", () => {
    assert.throws(() => parseAgentProvenanceRegistry({
        ...registry,
        schema: "squad-agent-provenance/v2",
        schema_version: 2,
    }), /unsupported/i);
    assert.throws(() => parseAgentProvenanceRegistry({
        ...registry,
        agents: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [
            `agent-${index}`,
            registry.agents["runtime-engineer"],
        ])),
    }), /ceiling/i);
    for (const candidate of [
        {
            ...registry,
            agents: {
                ...registry.agents,
                "runtime-engineer": {
                    ...registry.agents["runtime-engineer"],
                    avatar: {
                        kind: "repository-path",
                        path: ".squad/agents/runtime-engineer/../secret.png",
                    },
                },
            },
        },
        {
            ...registry,
            agents: {
                ...registry.agents,
                duplicate: {
                    ...registry.agents["runtime-engineer"],
                    avatar: undefined,
                },
            },
        },
    ]) {
        const result = parseAgentProvenanceRegistry(candidate);
        assert.equal(result.completeness, "partial");
    }
});

test("validates only complete explicit work bindings and rejects collisions", () => {
    const registrySource = source();
    assert.equal(validateWorkAgentBindings(bindings, registrySource, {
        repository: "octodemo/demo",
        originIssue: 45,
        artifact: "activated",
    })[0].agentId, "runtime-engineer");
    const cases = [
        bindings.map((binding) => ({ ...binding, binding_schema: "squad-work-agent-binding/v2" })),
        bindings.map((binding) => ({ ...binding, registry_revision: 5 })),
        bindings.map((binding) => ({ ...binding, agent_id: "unknown-agent" })),
        [...bindings, { ...bindings[0] }],
        bindings.map((binding) => ({ ...binding, epic_agent_ids: [] })),
    ];
    for (const value of cases) {
        assert.throws(() => validateWorkAgentBindings(value, registrySource, {
            repository: "octodemo/demo",
            originIssue: 45,
            artifact: "activated",
        }));
    }
    assert.throws(() => validateWorkAgentBindings(bindings, source({ status: "partial" }), {
        repository: "octodemo/demo",
        originIssue: 45,
        artifact: "activated",
    }), /complete validated registry/i);
});

test("refreshes registry and avatar independently with authoritative timestamps", async () => {
    const fresh = await discoverAgentIdentity({
        runJson: sourceApi(),
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: null,
        attemptedAt: "2026-09-22T12:00:00.000Z",
    });
    assert.equal(fresh.status, "fresh");
    assert.equal(fresh.lastAttemptedRefresh, "2026-09-22T12:00:00.000Z");
    assert.equal(fresh.lastSuccessfulRefresh, "2026-09-22T12:00:00.000Z");
    assert.equal(fresh.avatars["runtime-engineer"].status, "fresh");
    assert.match(fresh.avatars["runtime-engineer"].dataUrl, /^data:image\/png;base64,/);

    const cached = await discoverAgentIdentity({
        runJson: async () => {
            throw new Error("fresh cache must not fetch");
        },
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: fresh } },
        attemptedAt: "2026-09-22T12:01:00.000Z",
    });
    assert.deepEqual(cached, fresh);

    const stale = await discoverAgentIdentity({
        runJson: async () => {
            throw new Error("HTTP 403: Resource not accessible");
        },
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: fresh } },
        attemptedAt: "2026-09-22T12:11:00.000Z",
    });
    assert.equal(stale.status, "stale");
    assert.equal(stale.lastAttemptedRefresh, "2026-09-22T12:11:00.000Z");
    assert.equal(stale.lastSuccessfulRefresh, "2026-09-22T12:00:00.000Z");
    assert.equal(stale.registry.agents["runtime-engineer"].id, "runtime-engineer");
    const staleResolved = resolveAgentIdentities({
        repository: "octodemo/demo",
        issues: [
            { issue: { number: 45 }, artifacts: [artifact()] },
            { issue: { number: 47 }, artifacts: [] },
        ],
        source: stale,
    });
    assert.equal(staleResolved.get(47).source.status, "stale");
    assert.equal(staleResolved.get(47).record.avatar, null);
    assert.equal(staleResolved.get(47).source.avatarStatus, "stale");
});

test("rejects registry rollback and retries partial producer state immediately", async () => {
    const revisionFive = {
        ...registry,
        revision: 5,
        generated_at: "2026-09-22T13:00:00.000Z",
    };
    const fresh = await discoverAgentIdentity({
        runJson: sourceApi(revisionFive),
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: null,
        attemptedAt: "2026-09-22T13:00:00.000Z",
    });
    const rollback = await discoverAgentIdentity({
        runJson: sourceApi(registry),
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: fresh } },
        attemptedAt: "2026-09-22T13:11:00.000Z",
    });
    assert.equal(rollback.status, "stale");
    assert.equal(rollback.registry.revision, 5);
    assert.match(rollback.error, /rollback/i);

    const partialRegistry = structuredClone(registry);
    partialRegistry.agents.broken = {
        ...registry.agents["runtime-engineer"],
        display_name: "Kepler",
        persistent_name: "Different",
    };
    const partial = await discoverAgentIdentity({
        runJson: sourceApi(partialRegistry),
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: null,
        attemptedAt: "2026-09-22T12:00:00.000Z",
    });
    let requests = 0;
    const recovered = await discoverAgentIdentity({
        runJson: async (...args) => {
            requests += 1;
            return sourceApi()(...args);
        },
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: partial } },
        attemptedAt: "2026-09-22T12:01:00.000Z",
    });
    assert.ok(requests > 0);
    assert.equal(recovered.status, "fresh");
});

test("fails closed for missing, partial, permission, malformed, and avatar failures", async () => {
    const partialRegistry = structuredClone(registry);
    partialRegistry.agents.broken = {
        ...registry.agents["runtime-engineer"],
        display_name: "Kepler",
        persistent_name: "Different",
    };
    const partial = await discoverAgentIdentity({
        runJson: sourceApi(partialRegistry),
        cwd: "/repo",
        repository: "octodemo/demo",
        attemptedAt: "2026-09-22T12:00:00.000Z",
    });
    assert.equal(partial.status, "partial");
    assert.equal(partial.lastSuccessfulRefresh, null);

    for (const [message, status] of [
        ["HTTP 404: Not Found", "missing"],
        ["HTTP 403: Forbidden", "forbidden"],
        ["network returned invalid bytes", "malformed"],
        ["network timeout", "unavailable"],
    ]) {
        const result = await discoverAgentIdentity({
            runJson: async () => {
                throw new Error(message);
            },
            cwd: "/repo",
            repository: "octodemo/demo",
            attemptedAt: "2026-09-22T12:00:00.000Z",
        });
        assert.equal(result.status, status);
        assert.equal(result.registry, null);
    }

    const missingAvatar = await discoverAgentIdentity({
        runJson: sourceApi(registry, new Error("HTTP 404: Not Found")),
        cwd: "/repo",
        repository: "octodemo/demo",
        attemptedAt: "2026-09-22T12:00:00.000Z",
    });
    assert.equal(missingAvatar.status, "fresh");
    assert.equal(missingAvatar.avatars["runtime-engineer"].status, "missing");
    assert.equal(missingAvatar.avatars["runtime-engineer"].dataUrl, "");
});

test("resolves task and epic identity without consulting incidental fields", () => {
    const issues = [{
        issue: { number: 45 },
        owner: { name: "Wrong owner" },
        artifacts: [artifact()],
    }, {
        issue: { number: 46, assignees: [{ login: "runtime-engineer" }] },
        owner: { name: "Kepler" },
        artifacts: [],
    }, {
        issue: { number: 47, author: { login: "runtime-engineer" } },
        owner: { name: "Someone else" },
        artifacts: [],
    }];
    const resolved = resolveAgentIdentities({
        repository: "octodemo/demo",
        issues,
        source: source(),
    });
    assert.equal(resolved.get(47).record.id, "runtime-engineer");
    assert.equal(resolved.get(46).record.id, "runtime-engineer");
    assert.equal(resolved.has(45), false);

    const absent = resolveAgentIdentities({
        repository: "octodemo/demo",
        issues: issues.map((issue) => ({ ...issue, artifacts: [] })),
        source: source(),
    });
    assert.equal(absent.size, 0);

    const malformed = resolveAgentIdentities({
        repository: "octodemo/demo",
        issues: [
            {
                issue: { number: 45 },
                artifacts: [artifact(bindings.map((binding) => ({
                    ...binding,
                    agent_id: "unknown-agent",
                })))],
            },
            { issue: { number: 47 }, artifacts: [] },
        ],
        source: source(),
    });
    assert.equal(malformed.get(47).status, "unknown");
    assert.equal(malformed.get(47).source.status, "malformed");
});

test("preserves retired tombstones and rejects conflicting identity evidence", () => {
    const retiredBindings = bindings.map((binding) => ({
        ...binding,
        agent_id: "retired-reviewer",
        epic_agent_ids: ["retired-reviewer"],
    }));
    const retired = resolveAgentIdentities({
        repository: "octodemo/demo",
        issues: [
            { issue: { number: 45 }, artifacts: [artifact(retiredBindings)] },
            { issue: { number: 46 }, artifacts: [] },
            { issue: { number: 47 }, artifacts: [] },
        ],
        source: source(),
    });
    assert.equal(retired.get(47).status, "retired");
    assert.equal(retired.get(47).record.id, "retired-reviewer");
    assert.equal(retired.get(47).record.avatar, null);

    const secondBinding = [{
        ...bindings[0],
        origin_issue: 49,
        task: "2",
        issue: "#48",
        agent_id: "retired-reviewer",
        epic_agent_ids: ["retired-reviewer"],
    }];
    const conflict = resolveAgentIdentities({
        repository: "octodemo/demo",
        issues: [
            { issue: { number: 45 }, artifacts: [artifact()] },
            {
                issue: { number: 49 },
                artifacts: [artifact(secondBinding, { originIssue: 49 })],
            },
            { issue: { number: 46 }, artifacts: [] },
        ],
        source: source(),
    });
    assert.equal(conflict.get(46).status, "unknown");
    assert.equal(conflict.get(46).source.status, "malformed");
});

test("wires authoritative identity into goals and work items", () => {
    const comment = `Activation bindings:
\`\`\`json
${JSON.stringify(bindings)}
\`\`\`

Structured data:
\`\`\`json
${JSON.stringify({
        squad_artifact: "activated",
        schema_version: "1",
        origin_issue: 45,
        phases: [],
    })}
\`\`\``;
    const snapshot = buildActivitySnapshot({
        repository: {
            name: "demo",
            nameWithOwner: "octodemo/demo",
            url: "https://github.com/octodemo/demo",
        },
        issues: [
            { number: 45, title: "Root", state: "OPEN", labels: [{ name: "squad" }], comments: [{ body: comment }] },
            { number: 46, title: "Epic", state: "OPEN", labels: [{ name: "squad" }], comments: [] },
            { number: 47, title: "Task", state: "OPEN", labels: [{ name: "squad" }], comments: [] },
        ],
        sourceState: {
            agentIdentity: source(),
        },
        fetchedAt: "2026-09-22T12:00:00.000Z",
    });
    const task = snapshot.goals.find((goal) => goal.issue.number === 47);
    assert.equal(task.agentIdentity.record.id, "runtime-engineer");
    assert.equal(task.agentIdentity.binding.relation, "task");
    assert.equal(task.owner.name, "Unknown");
});

test("publishes bounded cache policy", () => {
    assert.deepEqual(agentIdentityPolicy(), {
        sourceRevision: 1,
        refreshIntervalMs: 600000,
        maxRegistryBytes: 1048576,
        maxAgents: 200,
        maxAvatars: 40,
        maxAvatarBytes: 262144,
    });
});
