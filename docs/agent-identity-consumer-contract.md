# Agent identity consumer contract

## Status

This document defines Squadcaster's consumer boundary for a future
Squad-produced identity record. It does not activate stable agent identity.
No authoritative producer source has been validated, so the current consumer
state is **unknown** and the activity contract must not contain or render an
agent identity.

## Current field audit

The current fields describe GitHub participation or repository configuration,
not stable Squad identity:

| Field | Current source and meaning | Identity rule |
|---|---|---|
| `goal.owner` | A matching `squad:<roster-id>` issue label, otherwise the first GitHub issue assignee, otherwise `Unknown` | Goal-routing label only. It is not an agent record. |
| Issue `assignees` | GitHub issue assignment used only as the owner fallback | GitHub account participation is not Squad identity. |
| Issue and PR `author` | Returned by the GitHub CLI query; not normalized into the activity snapshot | Authorship must not create or resolve an agent. |
| `pullRequest.reviews[].actor` | GitHub's latest observed reviewer login/type | Review participation only. |
| `pullRequest.reviewRequests[].actor` | GitHub's currently requested user or team | Pending review participation only. |
| Workflow actor | Not queried or exposed by the current workflow-run source | A future GitHub workflow actor would still be an execution participant, not Squad identity. |
| `members[]` roster entry | Repository-owned `.squad/team.md` display name, role, charter metadata, and slug derived from the display name | Configuration and goal-label matching only. A roster slug or display name is not stable identity. |
| Repository `owner` | GitHub repository namespace used by repository filtering | Repository ownership only. |
| Branch names and run/PR correlation | Bounded correlation conventions such as `squad/implement-{issue}-*` | Correlation evidence must never synthesize identity. |

Equal strings across these fields do not make them the same entity. In
particular, a roster name matching an assignee, reviewer, author, branch
fragment, or workflow actor remains coincidental.

## Future normalized schema

Squadcaster may add the following shape only after the paired Squad producer
validates and versions an authoritative source:

```js
agentIdentity: {
  status: "resolved" | "unknown" | "deleted",
  record: null | {
    schemaVersion: 1,
    id: string,             // Opaque, immutable, producer-scoped ID.
    displayName: string,    // Producer-owned mutable presentation value.
    avatar: null | {
      ref: string           // Producer-owned reference; not inferred from GitHub.
    }
  },
  source: null | {
    producer: string,       // Stable producer namespace.
    revision: string,       // Opaque producer revision or content identity.
    status: "fresh" | "stale" | "unavailable" | "missing" |
      "malformed" | "forbidden" | "partial",
    lastAttemptedRefresh: string,
    lastSuccessfulRefresh: string | null,
    error: null | {
      kind: "fetch_failed" | "permission_denied" | "malformed" | "partial",
      message: string
    }
  }
}
```

The producer must also emit an explicit, versioned binding from the observed
Squad work record to `id`. Squadcaster must not bind an identity by display
name, roster slug, GitHub login, issue assignment, review participation,
workflow actor, branch, or other correlation evidence.

`producer + id` is the uniqueness key. An `id` remains stable across display
name and avatar changes. Reusing an ID for another logical agent is invalid.
Two records with the same key but conflicting values make the affected
response malformed. A producer deletion must be an explicit tombstone; it
must not be inferred from a temporary fetch failure.

## Source and cache semantics

| Condition | Normalized status | Cache behavior |
|---|---|---|
| No validated producer is configured | Field absent in the current contract | Do not consult candidate fields. |
| Successful fetch with an explicit valid binding and record | Identity `resolved`; source `fresh` | Replace the cached record atomically, and set both refresh timestamps to the attempt time. |
| Successful fetch with no binding or no record | Identity `unknown`; source `missing` | Treat the identity as absent, clear the work item's prior record, and advance both refresh timestamps. |
| Explicit producer tombstone | Identity `deleted`; source `fresh` | Remove the cached active record, retain the tombstone revision, and never render the old name or avatar as current. |
| Fetch failure after a valid cached record | Identity `resolved`; source `stale` | Preserve the last valid record and successful timestamp; advance only the attempted timestamp and expose `fetch_failed`. |
| Fetch failure without a valid cached record | Identity `unknown`; source `unavailable` | Keep `record: null`; advance only the attempted timestamp and expose `fetch_failed`. |
| Permission denial after a valid cached record | Identity `resolved`; source `stale` | Preserve the last valid record and successful timestamp; advance only the attempted timestamp and expose `permission_denied`. |
| Permission denial without a valid cached record | Identity `unknown`; source `forbidden` | Keep `record: null`; advance only the attempted timestamp and expose `permission_denied`. |
| Malformed replacement after a valid cached record | Identity `resolved`; source `stale` | Reject the replacement atomically, preserve the last valid record and successful timestamp, advance only the attempted timestamp, and expose `malformed`. |
| Malformed data without a valid cached record | Identity `unknown`; source `malformed` | Keep `record: null`; advance only the attempted timestamp and expose `malformed`. |
| Partially valid producer response | Identity per valid binding; source `partial` | Accept independently valid records only if the producer contract permits partial responses; advance the successful timestamp only for accepted records and expose a bounded `partial` error for affected bindings. |

Identity cache freshness must be independent from issues, pull requests,
workflow runs, and rosters. A successful refresh of those sources cannot make
identity fresh, and an identity failure cannot make their observed fields
stale. `lastAttemptedRefresh` records every completed attempt.
`lastSuccessfulRefresh` records only the latest accepted authoritative record
or authoritative missing result; errors never advance it. Error messages are
bounded presentation-safe summaries, not raw producer payloads.

## Renderer behavior

- Until a producer is validated, render goal owners as **owners**, roster
  entries as **roster entries**, and GitHub users or teams as participants.
  Do not show an agent identity or avatar surface.
- Identity `resolved` with source `fresh` may show the authoritative display
  name and optional avatar.
- Identity `resolved` with source `stale` or `partial` may show the cached
  authoritative record only with a visible source-status label and error
  affordance.
- Identity `unknown` or `deleted`, and any source state without a valid cached
  record, shows no synthesized name, initials, avatar, or link. If the surface
  must be present, its value is `Unknown agent`.
- An avatar reference is optional. Its absence does not permit a GitHub avatar
  lookup. Any future fetch must follow the producer's permission, URL, size,
  media-type, and cache rules.
- Owner, reviewer, assignee, author, actor, and roster displays remain separate
  even when their text matches an authoritative agent display name.

## Activation gate

Stable identity remains blocked until the Squad producer session supplies:

1. a validated authoritative source and explicit work-to-agent binding;
2. producer fixtures for rename, deletion, collision, missing, malformed,
   partial, permission-denied, and stale cases;
3. matching producer and Squadcaster contract tests; and
4. a reviewed migration and cache-version plan.

Only then may Squadcaster version its activity schema and add renderer work.
