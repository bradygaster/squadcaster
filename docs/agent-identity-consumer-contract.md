# Agent identity consumer contract

## Status

Squadcaster consumes the Squad-owned `squad-agent-provenance/v1` registry at
`.squad/casting/registry.json` and explicit
`squad-work-agent-binding/v1` activation bindings. These two envelopes are the
only supported stable agent identity evidence.

GitHub owners, issue assignees, authors, reviewers, workflow actors, branch
names, timestamps, avatars, roster rows, display names, and labels remain
participation, configuration, or correlation evidence. They never create or
resolve a stable agent identity.

## Authoritative registry

The registry object key is the opaque immutable agent ID. `display_name` is
mutable presentation data and `persistent_name` is a compatibility alias that
must equal it.

```json
{
  "schema": "squad-agent-provenance/v1",
  "schema_version": 1,
  "revision": 4,
  "generated_at": "2026-09-21T20:00:00.000Z",
  "agents": {
    "runtime-engineer": {
      "display_name": "Kepler",
      "persistent_name": "Kepler",
      "role": "Runtime Engineer",
      "universe": "descriptive",
      "status": "active",
      "created_at": "2026-09-20T20:00:00.000Z",
      "updated_at": "2026-09-21T20:00:00.000Z",
      "avatar": {
        "kind": "repository-path",
        "path": ".squad/agents/runtime-engineer/avatar.png"
      }
    }
  }
}
```

Squadcaster accepts only schema version 1, a positive monotonic revision, valid
timestamps, canonical lowercase kebab-case IDs, unique case-folded display
names, valid lifecycle records, and avatar paths confined to the owning
`.squad/agents/{id}/` directory. Unsupported roots, malformed records,
duplicate identities, partial registries, capped responses, revision
regressions, and same-revision content changes fail closed.

Rename and recast preserve the object key and `created_at`. Retirement
preserves a tombstone with `status: "retired"` and `retired_at`; the ID is
never transferred to another logical agent. A retired binding remains
historically attributable by ID, but Squadcaster does not render the former
name or avatar as current.

## Authoritative work binding

Stable identity requires an explicit binding against a complete validated
registry:

```json
[
  {
    "binding_schema": "squad-work-agent-binding/v1",
    "binding_version": 1,
    "producer": "squad",
    "repository": "owner/repository",
    "origin_issue": 45,
    "artifact": "activated",
    "registry_schema": "squad-agent-provenance/v1",
    "registry_revision": 4,
    "task": "1",
    "issue": "#2066",
    "epic": "1.1",
    "epic_issue": "#2065",
    "agent_id": "runtime-engineer",
    "epic_agent_ids": ["runtime-engineer"]
  }
]
```

The complete binding array is validated atomically. Squadcaster rejects
missing, empty, malformed, partially valid, wrong-repository, wrong-origin,
unsupported or future-version, unknown-ID, future-revision, duplicate,
conflicting, mixed-revision, capped, or inconsistent evidence. It does not
salvage valid-looking rows.

`agent_id: null` is accepted only with an explicit producer omission reason:
`external-agent`, `non-roster`, or `legacy-plan-missing-id`. If any task in an
epic omits an ID, every row for that epic must declare
`epic_identity_omission_reason: "partial"` and carry the same sorted
`epic_agent_ids` set containing every known task agent ID.

## Normalized model

```js
agentIdentity: {
  status: "resolved" | "unknown" | "deleted",
  record: null | {
    schemaVersion: 1,
    id: string,
    displayName: string,
    role: string,
    universe: string,
    lifecycleStatus: "active" | "inactive",
    avatar: null | {
      kind: "repository-path",
      path: string
    }
  },
  binding: null | {
    schemaVersion: 1,
    producer: "squad",
    repository: string,
    originIssue: number,
    artifact: string,
    registryRevision: number,
    task: string,
    issueNumber: number,
    epic: string,
    epicIssueNumber: number,
    agentId: string | null,
    epicAgentIds: string[]
  },
  source: {
    producer: "squad",
    revision: string,
    registryRevision: number | null,
    status: "fresh" | "stale" | "unavailable" | "missing" |
      "malformed" | "forbidden" | "partial",
    lastAttemptedRefresh: string | null,
    lastSuccessfulRefresh: string | null,
    error: null | {
      kind: "fetch_failed" | "permission_denied" | "malformed" | "partial",
      message: string
    }
  }
}
```

Only a non-retired `agent_id` resolved through the complete registry produces
`status: "resolved"`. An explicit omission or absent binding is `unknown`. A
retired registry record is `deleted`; its immutable ID remains in the binding,
while current presentation fields are withheld.

## Source and cache semantics

The registry requires one repository Contents read. Squadcaster persists only
the validated normalized registry envelope, keyed by the returned immutable
blob SHA. Identity refresh timestamps are independent of issues, pull
requests, workflow runs, rosters, and implementation provenance.

| Condition | Source status | Cache behavior |
|---|---|---|
| Complete valid registry | `fresh` | Atomically replace the cache and advance both timestamps. |
| Missing registry | `missing` | Clear the prior registry and advance both timestamps. |
| Fetch failure | `stale` with cache, otherwise `unavailable` | Preserve only the last valid registry and advance only the attempt timestamp. |
| Permission denial | `stale` with cache, otherwise `forbidden` | Preserve only the last valid registry and advance only the attempt timestamp. |
| Malformed, unsupported, inconsistent, or capped replacement | `stale` with cache, otherwise `malformed` | Reject atomically and advance only the attempt timestamp. |
| Partial registry | `stale` with cache, otherwise `partial` | Reject atomically; partial records never resolve work bindings. |

Errors are bounded presentation-safe summaries. Raw producer payloads are not
persisted. A successful refresh of another GitHub source cannot make identity
fresh, and an identity failure cannot make another source stale.

## Renderer and accessibility behavior

- Resolved fresh identity may show the authoritative display name. A confined
  avatar reference is fetched through Squadcaster's read-only same-origin
  endpoint, limited to 512 KiB, and accepted only as PNG, JPEG, GIF, or WebP.
- Resolved stale identity may show only the cached authoritative record with a
  visible source-status label and diagnostic.
- Unknown, deleted, malformed, partial, forbidden, unavailable, or unresolved
  identity displays `Unknown agent` and never synthesizes a name, initials,
  avatar, link, or GitHub fallback.
- Owner and participant surfaces remain labeled as owner or participant even
  when their text matches the authoritative agent display name.
- The drawer exposes a dedicated heading and status region, immutable ID,
  registry revision, lifecycle state, binding context, freshness, and bounded
  diagnostics.

Squadcaster remains read-only: it fetches and renders producer evidence but
never edits the registry, activation artifact, issues, pull requests, labels,
or roster.
