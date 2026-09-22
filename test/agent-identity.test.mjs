import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    agentIdentitiesForGoals,
    agentIdentityPolicy,
    discoverAgentIdentityProvenance,
    normalizePersistedAgentIdentitySource,
    parseAgentProvenanceRegistry,
    parseWorkAgentBindings,
} from "../agent-identity.mjs";
import { buildActivitySnapshot } from "../activity-model.mjs";
import { normalizePersistedState } from "../persisted-state.mjs";

const registryWire = JSON.parse(await readFile(new URL(
    "./fixtures/agent-identity/registry-v1.json",
    import.meta.url,
), "utf8"));
const bindingWire = JSON.parse(await readFile(new URL(
    "./fixtures/agent-identity/bindings-v1.json",
    import.meta.url,
), "utf8"));
const parsedRegistry = parseAgentProvenanceRegistry(registryWire).registry;

function content(value = registryWire, overrides = {}) {
    const bytes = Buffer.from(JSON.stringify(value));
    return {
        type: "file",
        encoding: "base64",
        content: bytes.toString("base64"),
        size: bytes.length,
        sha: "registry-blob-2",
        ...overrides,
    };
}

function source(overrides = {}) {
    return {
        revision: 1,
        schema: "squadcaster-agent-identity-source/v1",
        schemaVersion: 1,
        producer: "squadcaster",
        data: {
            schema: "squadcaster-agent-identity-cache/v1",
            schemaVersion: 1,
            producer: "squad",
            repository: "octodemo/demo",
            blobSha: "registry-blob-2",
            registry: parsedRegistry,
        },
        lastAttemptedRefresh: "2026-09-22T12:00:00.000Z",
        lastSuccessfulRefresh: "2026-09-22T12:00:00.000Z",
        status: "fresh",
        error: null,
        ...overrides,
    };
}

function artifact(bindings = bindingWire) {
    return {
        kind: "activated",
        schemaVersion: "1",
        originIssue: 10,
        validation: "supported",
        validationReason: "",
        bindings,
        author: {
            databaseId: 41898282,
            login: "renamed-squad-app[bot]",
            type: "Bot",
        },
    };
}

function identityGoals(bindings = bindingWire) {
    return [{
        issue: { number: 10 },
        artifacts: [artifact(bindings)],
    }, {
        issue: { number: 11 },
        artifacts: [],
    }, {
        issue: { number: 12 },
        artifacts: [],
    }];
}

function issue(number, comments = []) {
    return {
        number,
        title: `Goal ${number}`,
        body: "",
        state: "OPEN",
        url: `https://github.com/octodemo/demo/issues/${number}`,
        labels: [{ name: "squad" }],
        comments,
    };
}

function activationComment(bindings = bindingWire) {
    return {
        createdAt: "2026-09-22T12:00:00Z",
        url: "https://github.com/octodemo/demo/issues/10#issuecomment-1",
        author: {
            databaseId: 41898282,
            login: "renamed-squad-app[bot]",
            type: "Bot",
        },
        body: `Activation bindings:
\`\`\`json
${JSON.stringify(bindings)}
\`\`\`
Structured data:
\`\`\`json
${JSON.stringify({
    squad_artifact: "activated",
    schema_version: "1",
    origin_issue: 10,
    phases: [],
})}
\`\`\``,
    };
}

test("accepts the producer v1 registry and confines avatar paths", () => {
    const result = parseAgentProvenanceRegistry(registryWire);
    assert.equal(result.completeness, "complete");
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.registry.agents[0].avatar, {
        kind: "repository-path",
        path: ".squad/agents/runtime-engineer/avatar.png",
    });

    for (const avatarPath of [
        ".squad/agents/other/avatar.png",
        ".squad/agents/runtime-engineer/../secret.png",
        ".squad\\agents\\runtime-engineer\\avatar.png",
        "/.squad/agents/runtime-engineer/avatar.png",
    ]) {
        const candidate = structuredClone(registryWire);
        candidate.agents["runtime-engineer"].avatar.path = avatarPath;
        assert.equal(parseAgentProvenanceRegistry(candidate).completeness, "partial");
    }
});

test("rejects unsupported roots and reports partial records without accepting them", () => {
    assert.throws(
        () => parseAgentProvenanceRegistry({ ...registryWire, schema_version: 2 }),
        /unsupported/i,
    );
    const partial = structuredClone(registryWire);
    partial.agents.broken = {
        display_name: "Broken",
        persistent_name: "Different",
        role: "",
        universe: "descriptive",
        status: "active",
        created_at: "not-a-date",
        updated_at: "not-a-date",
    };
    const result = parseAgentProvenanceRegistry(partial);
    assert.equal(result.completeness, "partial");
    assert.equal(result.registry.agents.length, 1);
    assert.ok(result.diagnostics.length > 0);
});

test("validates explicit work bindings against a complete registry", () => {
    const result = parseWorkAgentBindings(bindingWire, parsedRegistry, {
        repository: "octodemo/demo",
        originIssue: 10,
        artifact: "activated",
    });
    assert.equal(result[0].agentId, "runtime-engineer");
    assert.deepEqual(result[0].epicAgentIds, ["runtime-engineer"]);

    const external = structuredClone(bindingWire);
    external[0].agent_id = null;
    external[0].identity_omission_reason = "external-agent";
    external[0].epic_agent_ids = [];
    external[0].epic_identity_omission_reason = "partial";
    assert.equal(parseWorkAgentBindings(external, parsedRegistry, {
        repository: "octodemo/demo",
        originIssue: 10,
        artifact: "activated",
    })[0].agentId, null);
});

test("fails closed on missing, duplicate, conflicting, future, and partial bindings", () => {
    const context = {
        repository: "octodemo/demo",
        originIssue: 10,
        artifact: "activated",
    };
    assert.throws(() => parseWorkAgentBindings([], parsedRegistry, context), /non-empty/i);
    for (const candidate of [
        [{ ...bindingWire[0], binding_version: 2 }],
        [{ ...bindingWire[0], repository: "octodemo/other" }],
        [{ ...bindingWire[0], registry_revision: 3 }],
        [{ ...bindingWire[0], agent_id: "unknown-agent" }],
        [{ ...bindingWire[0], attacker_controlled: true }],
        [...bindingWire, { ...bindingWire[0], task: "2" }],
        [...bindingWire, {
            ...bindingWire[0],
            task: "2",
            issue: "#13",
            epic_issue: "#99",
        }],
    ]) {
        assert.throws(
            () => parseWorkAgentBindings(candidate, parsedRegistry, context),
            /malformed|partial/i,
        );
    }
});

test("refreshes and persists only complete normalized registry envelopes", async () => {
    const fresh = await discoverAgentIdentityProvenance({
        runJson: async () => content(),
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: null,
        attemptedAt: "2026-09-22T12:00:00.000Z",
    });
    assert.equal(fresh.status, "fresh");
    assert.equal(fresh.data.registry.agents[0].id, "runtime-engineer");
    assert.equal(fresh.lastAttemptedRefresh, fresh.lastSuccessfulRefresh);

    const partialWire = structuredClone(registryWire);
    partialWire.agents.broken = { display_name: "Broken" };
    const partial = await discoverAgentIdentityProvenance({
        runJson: async () => content(partialWire, { sha: "partial" }),
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: fresh } },
        attemptedAt: "2026-09-22T13:00:00.000Z",
    });
    assert.equal(partial.status, "stale");
    assert.equal(partial.data.blobSha, "registry-blob-2");
    assert.equal(partial.lastSuccessfulRefresh, fresh.lastSuccessfulRefresh);
    assert.equal(partial.lastAttemptedRefresh, "2026-09-22T13:00:00.000Z");
    assert.equal(partial.error.kind, "partial");

    const persisted = normalizePersistedState({
        activity: {
            schemaVersion: 3,
            fetchedAt: "2026-09-22T13:00:00.000Z",
            dayBoundary: {
                version: 1,
                kind: "utc-server-day",
                timeZone: "UTC",
                snapshotDay: "2026-09-22",
                startsAt: "2026-09-22T00:00:00.000Z",
                nextBoundaryAt: "2026-09-23T00:00:00.000Z",
                cacheKey: "day-boundary-v1:utc:2026-09-22",
            },
            goals: [],
            sourceState: { agentIdentity: partial },
        },
    });
    assert.equal(
        persisted.activity.sourceState.agentIdentity.data.registry.agents[0].id,
        "runtime-engineer",
    );
});

test("separates missing, forbidden, and transport failures from successful freshness", async () => {
    const missing = await discoverAgentIdentityProvenance({
        runJson: async () => {
            throw new Error("HTTP 404: Not Found");
        },
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: source() } },
        attemptedAt: "2026-09-22T13:00:00.000Z",
    });
    assert.equal(missing.status, "missing");
    assert.equal(missing.data, null);
    assert.equal(missing.lastSuccessfulRefresh, missing.lastAttemptedRefresh);
    const unavailableAfterMissing = await discoverAgentIdentityProvenance({
        runJson: async () => {
            throw new Error("network timeout");
        },
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: missing } },
        attemptedAt: "2026-09-22T14:00:00.000Z",
    });
    assert.equal(
        normalizePersistedAgentIdentitySource(unavailableAfterMissing)
            .lastSuccessfulRefresh,
        missing.lastSuccessfulRefresh,
    );

    for (const [message, status, kind] of [
        ["HTTP 403: Resource not accessible", "stale", "permission_denied"],
        ["network timeout", "stale", "fetch_failed"],
    ]) {
        const failed = await discoverAgentIdentityProvenance({
            runJson: async () => {
                throw new Error(message);
            },
            cwd: "/repo",
            repository: "octodemo/demo",
            previous: { sourceState: { agentIdentity: source() } },
            attemptedAt: "2026-09-22T13:00:00.000Z",
        });
        assert.equal(failed.status, status);
        assert.equal(failed.error.kind, kind);
        assert.equal(failed.lastSuccessfulRefresh, "2026-09-22T12:00:00.000Z");
    }
});

test("resolves only explicit ids and preserves rename and retirement semantics", () => {
    const identities = agentIdentitiesForGoals({
        goals: identityGoals(),
        source: source(),
        repository: "octodemo/demo",
    });

    assert.equal(identities.get(12).status, "resolved");
    assert.equal(identities.get(12).record.id, "runtime-engineer");
    assert.equal(identities.get(12).record.displayName, "Kepler");
    assert.equal(identities.get(10).status, "unknown");

    const renamedRegistry = structuredClone(parsedRegistry);
    renamedRegistry.revision = 3;
    renamedRegistry.agents[0].displayName = "Nova";
    const renamed = agentIdentitiesForGoals({
        goals: identityGoals([{ ...bindingWire[0], registry_revision: 2 }]),
        source: source({
            data: {
                ...source().data,
                blobSha: "registry-blob-3",
                registry: renamedRegistry,
            },
        }),
        repository: "octodemo/demo",
    });
    assert.equal(renamed.get(12).record.id, "runtime-engineer");
    assert.equal(renamed.get(12).record.displayName, "Nova");

    const retiredRegistry = structuredClone(renamedRegistry);
    retiredRegistry.revision = 4;
    retiredRegistry.generatedAt = "2026-09-22T15:00:00.000Z";
    retiredRegistry.agents[0] = {
        ...retiredRegistry.agents[0],
        status: "retired",
        updatedAt: "2026-09-22T14:00:00.000Z",
        retiredAt: "2026-09-22T14:00:00.000Z",
    };
    const retired = agentIdentitiesForGoals({
        goals: identityGoals(),
        source: source({
            data: {
                ...source().data,
                blobSha: "registry-blob-4",
                registry: retiredRegistry,
            },
        }),
        repository: "octodemo/demo",
    });
    assert.equal(retired.get(12).status, "deleted");
    assert.equal(retired.get(12).record, null);
    assert.equal(retired.get(12).binding.agentId, "runtime-engineer");
});

test("trusts immutable allowlisted bot ids, not login or author association", () => {
    const trusted = buildActivitySnapshot({
        repository: {
            name: "demo",
            nameWithOwner: "octodemo/demo",
        },
        issues: [issue(10, [activationComment()]), issue(11), issue(12)],
        sourceState: { agentIdentity: source() },
    });
    assert.equal(
        trusted.goals.find((goal) => goal.issue.number === 12).agentIdentity.status,
        "resolved",
    );
    const persisted = normalizePersistedState({ activity: trusted });
    assert.equal(
        persisted.activity.goals.find((goal) =>
            goal.issue.number === 10).artifacts[0].author.databaseId,
        41898282,
    );

    for (const [author, candidateSource] of [
        [{ databaseId: 999, login: "github-actions[bot]", type: "Bot" }, source()],
        [{ databaseId: null, login: "renamed-squad-app[bot]", type: "Bot" }, source()],
        [{ databaseId: 41898282, login: "renamed-squad-app[bot]", type: "User" }, source()],
        [
            { databaseId: 41898282, login: "renamed-squad-app[bot]", type: "Bot" },
            source({
                data: {
                    ...source().data,
                    registry: {
                        ...parsedRegistry,
                        trustedCommentActorIds: [],
                    },
                },
            }),
        ],
    ]) {
        const comment = activationComment();
        comment.author = author;
        comment.authorAssociation = "OWNER";
        const snapshot = buildActivitySnapshot({
            repository: {
                name: "demo",
                nameWithOwner: "octodemo/demo",
            },
            issues: [issue(10, [comment]), issue(11), issue(12)],
            sourceState: { agentIdentity: candidateSource },
        });
        const identity = snapshot.goals.find((goal) =>
            goal.issue.number === 12).agentIdentity;
        assert.equal(identity.status, "unknown");
        assert.equal(identity.source.status, "malformed");
        assert.match(identity.source.error.message, /actor is not trusted/i);
    }
});

test("fails the complete identity source closed on malformed identity evidence only", () => {
    const trustedAuthor = activationComment().author;
    const candidates = [
        "```json\n{\"binding_schema\":\"squad-work-agent-binding/v1\"\n```",
        "```json\n{\"binding_schema\":\"squad-work-agent-binding/v1\"}\n```",
        `${activationComment().body}\n\`\`\`json\n${JSON.stringify(bindingWire)}\n\`\`\``,
        activationComment([{
            ...bindingWire[0],
            unexpected_identity_field: "attacker",
        }]).body,
        activationComment().body.replace(
            '"producer":"squad"',
            '"producer":"squad","producer":"squad"',
        ),
        activationComment().body.replace(
            '"phases":[]',
            '"phases":[],"agent_id":"runtime-engineer"',
        ),
        `${activationComment().body}\nStructured data:\n\`\`\`json\n${JSON.stringify({
            squad_artifact: "phases-activated",
            schema_version: "1",
            origin_issue: 10,
            phases: [],
        })}\n\`\`\``,
    ];
    for (const body of candidates) {
        const snapshot = buildActivitySnapshot({
            repository: {
                name: "demo",
                nameWithOwner: "octodemo/demo",
            },
            issues: [
                issue(10, [{
                    ...activationComment(),
                    body,
                    author: trustedAuthor,
                }]),
                issue(11),
                issue(12),
            ],
            sourceState: { agentIdentity: source() },
        });
        const identity = snapshot.goals.find((goal) =>
            goal.issue.number === 12).agentIdentity;
        assert.equal(identity.status, "unknown");
        assert.equal(identity.source.status, "malformed");
    }

    const unrelated = buildActivitySnapshot({
        repository: {
            name: "demo",
            nameWithOwner: "octodemo/demo",
        },
        issues: [
            issue(10, [{
                body: "Diagnostic:\n```json\n{\"status\":\"ok\",\"agent_id\":\"display-only\"}\n```",
                createdAt: "2026-09-22T12:00:00Z",
                author: { databaseId: 999, login: "person", type: "User" },
            }]),
            issue(11),
            issue(12),
        ],
        sourceState: { agentIdentity: source() },
    });
    assert.equal(
        unrelated.goals.find((goal) => goal.issue.number === 12).agentIdentity.source.status,
        "missing",
    );
});

test("rejects inconsistent persisted source envelopes instead of coercing them", () => {
    const valid = source();
    assert.equal(normalizePersistedAgentIdentitySource(valid).status, "fresh");
    const stale = normalizePersistedAgentIdentitySource(source({
        status: "stale",
        lastAttemptedRefresh: "2026-09-22T13:00:00.000Z",
        error: { kind: "fetch_failed", message: "timeout" },
    }));
    assert.equal(stale.status, "stale");
    assert.equal(stale.data.registry.revision, 2);
    const unavailableAfterMissing = normalizePersistedAgentIdentitySource({
        ...source(),
        data: null,
        status: "unavailable",
        lastAttemptedRefresh: "2026-09-22T13:00:00.000Z",
        lastSuccessfulRefresh: "2026-09-22T12:00:00.000Z",
        error: { kind: "fetch_failed", message: "timeout" },
    });
    assert.equal(unavailableAfterMissing.status, "unavailable");
    assert.equal(
        unavailableAfterMissing.lastSuccessfulRefresh,
        "2026-09-22T12:00:00.000Z",
    );
    for (const candidate of [
        { ...valid, revision: 2 },
        { ...valid, schema: "future/v2" },
        { ...valid, schemaVersion: 2 },
        { ...valid, producer: "squad" },
        { ...valid, data: { ...valid.data, schema: "future/v2" } },
        { ...valid, data: { ...valid.data, producer: "attacker" } },
        {
            ...valid,
            data: {
                ...valid.data,
                registry: {
                    ...parsedRegistry,
                    unsupported: true,
                },
            },
        },
        {
            ...valid,
            data: {
                ...valid.data,
                registry: {
                    ...parsedRegistry,
                    agents: [
                        parsedRegistry.agents[0],
                        parsedRegistry.agents[0],
                    ],
                },
            },
        },
        { ...valid, status: "missing" },
        { ...valid, status: "fresh", lastSuccessfulRefresh: null },
        { ...valid, lastAttemptedRefresh: "2026-09-22T12:00:00Z" },
        { ...valid, status: "fresh", error: { kind: "malformed", message: "contradiction" } },
        {
            ...valid,
            status: "partial",
            error: { kind: "partial", message: "partial" },
        },
        {
            ...valid,
            status: "malformed",
            error: { kind: "malformed", message: "malformed" },
        },
        {
            ...valid,
            status: "forbidden",
            error: { kind: "permission_denied", message: "forbidden" },
        },
    ]) {
        const normalized = normalizePersistedAgentIdentitySource(candidate);
        assert.equal(normalized.status, "unavailable");
        assert.equal(normalized.data, null);
        assert.equal(normalized.lastSuccessfulRefresh, null);
    }
});

test("enforces registry continuity atomically while preserving stale cache", async () => {
    const fresh = source();
    const refresh = (wire) => discoverAgentIdentityProvenance({
        runJson: async () => content(wire, { sha: `blob-${wire.revision}` }),
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: fresh } },
        attemptedAt: "2026-09-22T13:00:00.000Z",
    });
    const next = structuredClone(registryWire);
    next.revision = 3;
    next.generated_at = "2026-09-22T13:00:00.000Z";

    const removed = structuredClone(next);
    delete removed.agents["runtime-engineer"];
    const tombstoneRemoved = await refresh(removed);
    assert.equal(tombstoneRemoved.status, "stale");
    assert.equal(tombstoneRemoved.data.registry.revision, 2);

    for (const mutate of [
        (wire) => { wire.agents["runtime-engineer"].created_at = "2026-09-19T20:00:00.000Z"; },
        (wire) => { wire.agents["runtime-engineer"].role = "Transferred identity"; },
        (wire) => {
            wire.agents["runtime-engineer"].status = "retired";
            wire.agents["runtime-engineer"].retired_at = "2026-09-20T19:00:00.000Z";
            wire.agents["runtime-engineer"].updated_at = "2026-09-22T12:00:00.000Z";
        },
    ]) {
        const candidate = structuredClone(next);
        mutate(candidate);
        const result = await refresh(candidate);
        assert.equal(result.status, "stale");
        assert.equal(result.data.registry.revision, 2);
    }

    const retired = structuredClone(next);
    retired.agents["runtime-engineer"].status = "retired";
    retired.agents["runtime-engineer"].retired_at = "2026-09-22T12:00:00.000Z";
    retired.agents["runtime-engineer"].updated_at = "2026-09-22T12:00:00.000Z";
    const validRetirement = await refresh(retired);
    assert.equal(validRetirement.status, "fresh");
    assert.equal(validRetirement.data.registry.agents[0].status, "retired");

    const removedTombstone = structuredClone(retired);
    removedTombstone.revision = 4;
    removedTombstone.generated_at = "2026-09-22T14:00:00.000Z";
    delete removedTombstone.agents["runtime-engineer"];
    const rejectedTombstoneRemoval = await discoverAgentIdentityProvenance({
        runJson: async () => content(removedTombstone, { sha: "blob-4-removed" }),
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: validRetirement } },
        attemptedAt: "2026-09-22T14:00:00.000Z",
    });
    assert.equal(rejectedTombstoneRemoval.status, "stale");
    assert.equal(rejectedTombstoneRemoval.data.registry.agents[0].status, "retired");

    const invalidReactivation = structuredClone(retired);
    invalidReactivation.revision = 4;
    invalidReactivation.generated_at = "2026-09-22T14:00:00.000Z";
    invalidReactivation.agents["runtime-engineer"].status = "active";
    delete invalidReactivation.agents["runtime-engineer"].retired_at;
    const rejectedReactivation = await discoverAgentIdentityProvenance({
        runJson: async () => content(invalidReactivation, { sha: "blob-4-invalid" }),
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: validRetirement } },
        attemptedAt: "2026-09-22T14:00:00.000Z",
    });
    assert.equal(rejectedReactivation.status, "stale");

    const reactivated = structuredClone(retired);
    reactivated.revision = 4;
    reactivated.generated_at = "2026-09-22T14:00:00.000Z";
    reactivated.agents["runtime-engineer"].status = "active";
    reactivated.agents["runtime-engineer"].updated_at = "2026-09-22T14:00:00.000Z";
    delete reactivated.agents["runtime-engineer"].retired_at;
    const validReactivation = await discoverAgentIdentityProvenance({
        runJson: async () => content(reactivated, { sha: "blob-4" }),
        cwd: "/repo",
        repository: "octodemo/demo",
        previous: { sourceState: { agentIdentity: validRetirement } },
        attemptedAt: "2026-09-22T14:00:00.000Z",
    });
    assert.equal(validReactivation.status, "fresh");
    assert.equal(validReactivation.data.registry.agents[0].status, "active");
});

test("rejects noncanonical, impossible, and misordered lifecycle timestamps", () => {
    const timestampMutations = [
        (wire) => { wire.generated_at = "9/21/2026, 8:00:00 PM"; },
        (wire) => { wire.generated_at = "2026-09-21T20:00:00Z"; },
        (wire) => { wire.generated_at = "2026-09-21T13:00:00.000-07:00"; },
        (wire) => { wire.generated_at = "2026-02-30T20:00:00.000Z"; },
        (wire) => { wire.agents["runtime-engineer"].created_at = "2026-09-20T20:00:00Z"; },
        (wire) => { wire.agents["runtime-engineer"].updated_at = "2026-09-21T13:00:00.000-07:00"; },
        (wire) => { wire.agents["runtime-engineer"].created_at = "2026-09-22T20:00:00.000Z"; },
        (wire) => { wire.agents["runtime-engineer"].updated_at = "2026-09-19T20:00:00.000Z"; },
        (wire) => {
            wire.agents["runtime-engineer"].updated_at = "2026-09-21T21:00:00.000Z";
            wire.agents["runtime-engineer"].retired_at = "2026-09-21T21:00:00Z";
        },
        (wire) => { wire.agents["runtime-engineer"].retired_at = "2026-09-19T20:00:00.000Z"; },
    ];
    for (const mutate of timestampMutations) {
        const candidate = structuredClone(registryWire);
        mutate(candidate);
        if (candidate.agents["runtime-engineer"].retired_at) {
            candidate.agents["runtime-engineer"].status = "retired";
        }
        assert.throws(
            () => {
                const parsed = parseAgentProvenanceRegistry(candidate);
                if (parsed.completeness !== "complete") {
                    throw new Error(parsed.diagnostics.join("; "));
                }
            },
            /timestamp|generated_at|created_at|updated_at|retired_at|lifecycle/i,
        );
    }
});

test("builds goal identity from authoritative registry and binding without owner inference", () => {
    const snapshot = buildActivitySnapshot({
        repository: {
            name: "demo",
            nameWithOwner: "octodemo/demo",
            url: "https://github.com/octodemo/demo",
        },
        members: [{ id: "runtime-engineer", name: "Kepler", role: "Runtime Engineer" }],
        issues: [
            issue(10, [activationComment()]),
            issue(11),
            {
                ...issue(12),
                assignees: [{ login: "someone-else" }],
                author: { login: "runtime-engineer" },
            },
        ],
        sourceState: {
            agentIdentity: source(),
        },
    });
    const task = snapshot.goals.find((goal) => goal.issue.number === 12);
    assert.equal(task.owner.name, "someone-else");
    assert.equal(task.agentIdentity.status, "resolved");
    assert.equal(task.agentIdentity.record.id, "runtime-engineer");

    const noBinding = buildActivitySnapshot({
        repository: {
            name: "demo",
            nameWithOwner: "octodemo/demo",
        },
        members: [{ id: "runtime-engineer", name: "Kepler", role: "Runtime Engineer" }],
        issues: [{
            ...issue(12),
            labels: [{ name: "squad:runtime-engineer" }],
            assignees: [{ login: "runtime-engineer" }],
        }],
        sourceState: { agentIdentity: source() },
    }).goals[0];
    assert.equal(noBinding.agentIdentity.status, "unknown");
    assert.equal(noBinding.agentIdentity.record, null);
});

test("fails every goal closed when one authoritative binding document conflicts", () => {
    const conflicting = [
        bindingWire[0],
        {
            ...bindingWire[0],
            task: "2",
            issue: "#13",
            epic_agent_ids: [],
        },
    ];
    const identities = agentIdentitiesForGoals({
        goals: identityGoals(conflicting),
        source: source(),
        repository: "octodemo/demo",
    });
    assert.equal(identities.get(12).status, "unknown");
    assert.equal(identities.get(12).source.status, "malformed");
    assert.equal(identities.get(12).source.error.kind, "malformed");
});

test("publishes bounded source policy", () => {
    assert.deepEqual(agentIdentityPolicy(), {
        registryPath: ".squad/casting/registry.json",
        maxRegistryBytes: 1024 * 1024,
        maxAgents: 500,
        maxBindings: 500,
        maxTrustedCommentActors: 20,
    });
});
