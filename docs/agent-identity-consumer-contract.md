# Agent identity consumer contract

## Status

Squadcaster consumes the producer-owned `squad-agent-provenance/v1` registry
and `squad-work-agent-binding/v1` activation bindings introduced by
`bradygaster/squad#2066`. These are the only authoritative identity inputs.
Squadcaster remains read-only and never mutates Squad state, labels,
assignments, workflow runs, installations, pull requests, or registries.

## Authoritative sources

The registry is fetched from `.squad/casting/registry.json` using repository
Contents read permission. The root must have schema
`squad-agent-provenance/v1`, schema version `1`, a positive monotonic revision,
a valid generation timestamp, and at most 200 records. The object key is the
opaque immutable agent ID. Display name, role, universe, lifecycle state, and
timestamps are producer-owned metadata.

Activation comments contain a non-empty `Activation bindings:` JSON array.
Every accepted row must use `squad-work-agent-binding/v1`, binding version `1`,
producer `squad`, the current repository and activation origin, the matching
activation kind, registry schema `squad-agent-provenance/v1`, and a registry
revision no newer than the fetched registry. A complete validated registry is
required before any binding resolves.

Squadcaster never derives identity from goal labels, roster names, display
names, owners, assignees, authors, reviewers, workflow actors, branch names,
timestamps, avatar filenames, or equality between any of those values.

## Registry validation

- IDs are lowercase kebab-case and unique by object key.
- Case-folded display names must be unique. Colliding records are rejected.
- `persistent_name` must exactly equal `display_name`.
- Role, universe, lifecycle timestamps, and status are required.
- Supported lifecycle values are `active`, `inactive`, and `retired`.
- Retired records require `retired_at` and remain resolvable tombstones. Their
  immutable IDs are never transferred or synthesized.
- A rename changes mutable presentation metadata without changing the ID.
- Unsupported or future roots, malformed JSON, oversized payloads, and
  excessive agent or avatar counts fail closed.
- A partial registry may expose diagnostics, but cannot resolve work identity.

## Binding validation

The whole binding document is atomic. Squadcaster rejects missing, empty,
partially valid, malformed, future, wrong-repository, wrong-origin,
unknown-ID, future-revision, duplicate, conflicting, or inconsistent binding
arrays rather than salvaging rows.

Within one document:

- issue and task bindings are unique;
- all rows use one registry revision;
- every non-null `agent_id` exists in the complete registry;
- null IDs require an allowed producer omission reason;
- `epic_agent_ids` are unique, sorted during normalization, contain each
  non-null task ID, and equal the complete known task-agent set for the epic;
- epic identifiers and epic issues map one-to-one; and
- partial epic omission markers appear on every row exactly when any task in
  that epic omits an ID.

A task goal resolves from its explicit `agent_id`. An epic resolves only when
its complete binding set names exactly one immutable ID. Multiple authoritative
IDs for one rendered goal are a conflict and produce `Unknown agent`.

## Independent cache and freshness

The identity cache has source revision `1` and is independent from issue, pull
request, workflow, roster, and implementation-provenance freshness.

| Condition | Source state | Cached identity behavior |
|---|---|---|
| Valid complete registry | `fresh` | Atomically replace registry and avatars; advance attempted and successful timestamps. |
| Registry absent (404) | `missing` | Clear prior identity and advance both timestamps. |
| Permission denial without cache | `forbidden` | Resolve no identity; advance attempted timestamp only. |
| Malformed, future, capped, or partial input without cache | `malformed` or `partial` | Resolve no identity; advance attempted timestamp only. |
| Fetch or validation failure after a complete cache | `stale` | Preserve the last complete registry and successful timestamp; advance attempted timestamp only and visibly label retained identities stale. |

Successful refreshes within ten minutes reuse the immutable cached response
without moving either timestamp. Persisted envelopes are revalidated on load;
unsupported cache revisions, invalid registries, invalid data URLs, and
unrecognized fields are discarded. The Squadcaster persisted-state version is
`6`.

## Avatar handling

An avatar is optional and must be a producer reference with kind
`repository-path` beneath the exact, case-sensitive
`.squad/agents/{agent-id}/` directory. Absolute paths, backslashes, dot
segments, traversal, empty targets, unsupported media, payloads over 256 KiB,
and more than 40 referenced avatars fail closed.

Avatar content uses a separate Contents fetch. Only validated PNG, JPEG, GIF,
or WebP bytes become an in-memory/persisted data URL. Missing, forbidden,
malformed, stale, retired, or absent avatars render no image. Squadcaster does
not generate initials, use GitHub avatars, inspect filenames for identity, or
produce any other fallback.

## Model and renderer

Each goal and related work item carries an `agentIdentity` envelope:

```js
{
  status: "resolved" | "retired" | "unknown",
  record: null | {
    id: string,
    displayName: string,
    role: string,
    universe: string,
    lifecycleStatus: "active" | "inactive" | "retired",
    avatar: null | { ref: string, dataUrl: string }
  },
  binding: null | {
    relation: "task" | "epic",
    task: string,
    epic: string,
    registryRevision: number
  },
  source: {
    revision: 1,
    status: "fresh" | "stale" | "missing" | "partial" |
      "forbidden" | "malformed" | "unavailable",
    lastAttemptedRefresh: string | null,
    lastSuccessfulRefresh: string | null,
    avatarStatus?: string,
    error: string
  }
}
```

Owners remain owners and GitHub participants remain participants. The
renderer labels agent identity separately, exposes source degradation, shows a
retired tombstone as retired, uses accessible avatar alt text, and renders
`Unknown agent` without a synthesized name or avatar whenever authoritative
resolution fails.
