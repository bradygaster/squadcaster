# Implementation session provenance consumer contract

## Decision status

This document is the Squadcaster consumer contract for issue #44. It is a
design and validation gate, not a producer wire schema.

Implementation session parsing, normalization, caching, and rendering are
**blocked** until Squad publishes a versioned payload and the payload is
validated against producer fixtures. PR #47 defines activity contract v2 but
explicitly defers implementation-session provenance. No session identifier is
currently available from an authoritative source.

Squadcaster must not invent a session identifier or derive one from a branch,
GitHub actor, workflow run, pull request, timestamp, issue text, or textual
similarity. When the producer payload is absent, lacks its declared session
identifier, or cannot be validated, implementation session provenance is
unknown.

## Existing correlation audit

The current goal, pull-request, and workflow-run relationships remain valid
independently of future session provenance.

| Relationship | Current source | Consumer classification |
|---|---|---|
| Goal to pull request | GitHub `closingIssuesReferences` with exact repository and issue match | Observed |
| Goal to pull request | Local or repository-qualified closing keyword with exact repository and issue match | Observed |
| Goal to pull request | `squad:implement issue={number} run={number}` marker | Observed explicit marker |
| Goal to pull request | `squad/implement-{issue}-*` branch convention | Inferred |
| Goal to workflow run | Issue reference in run display metadata | Inferred |
| Goal to workflow run | Implementation branch naming or equality with an already-correlated PR branch | Inferred |
| Pull request to check | GitHub pull-request status-check rollup | Observed |
| Any entity to implementation session | No validated producer source | Unknown |

An observed closing reference or explicit marker takes precedence when the
same pull request also matches the branch convention. Branch-only correlation
continues to work, but its evidence must be labeled `inferred`.

## Producer validation gate

The producer owns the exact serialization, field names, identifier format, and
identifier lifecycle. The consumer may add implementation only after all of
the following are available:

1. A producer-owned schema version and fixtures accepted by both Squad and
   Squadcaster.
2. An explicit repository identity, origin issue identity, opaque
   implementation-session identifier, and explicit workflow-run and
   pull-request references.
3. Producer rules for identifier lifetime across retries, workflow reruns,
   replacement pull requests, and multiple pull requests from one session.
4. Producer rules for a pull request serving multiple goals and for one goal
   receiving multiple implementation sessions.
5. A declared publication location, read permission, pagination or selection
   rules, and update/retention behavior.
6. Negative fixtures for an absent session identifier, unsupported schema
   version, malformed payload, repository mismatch, and dangling run or pull
   request references.

The consumer must validate repository and origin-issue identity exactly. It
must treat run and pull-request references as links supplied by the producer,
not as permission to infer a missing session identifier in the reverse
direction.

## Planned source and cache semantics

After producer validation, implementation-session provenance will be a
source-specific input rather than part of the existing issues, pull requests,
or workflow-runs source. The final source name and transport remain blocked on
the producer contract.

- A successful valid response replaces the last valid payload for that source.
- A fetch or permission failure retains the last valid payload and marks only
  the provenance source stale.
- A malformed replacement never overwrites the last valid payload. It produces
  a source-specific error and stale state when a prior valid payload exists;
  without one, the source is unavailable.
- An unsupported schema version is malformed, not an empty successful result.
- A successful producer response with no record for a goal means session
  provenance is unknown, not that no implementation session exists.
- A record without the producer-declared session identifier is invalid for
  session provenance and cannot be repaired from correlated GitHub data.
- Issues, pull requests, runs, and checks continue refreshing independently
  when provenance is stale, unavailable, or malformed.
- Aggregate freshness must preserve repository and source identity so stale
  provenance in one repository does not taint valid provenance in another.

Retention, replacement, and deduplication keys cannot be implemented until the
producer defines session identifier lifetime and replay behavior.

## Planned normalized and rendering behavior

The eventual normalized model will expose only producer-validated identifiers
and explicit references. Exact property names and activity-contract version
are intentionally undecided until the producer schema is accepted.

The renderer will:

- show an implementation session only when a valid producer record supplies
  the session identifier;
- label closing-reference and explicit-marker links as observed;
- label branch-derived relationships as inferred;
- display `Unknown` for absent session provenance without substituting a
  branch, actor, run, pull request, timestamp, or issue;
- identify stale or unavailable provenance separately from fresh GitHub issue,
  pull-request, run, and check evidence;
- avoid links until the producer declares a stable, authorized session URL or
  another explicit navigation target.

No parser, cache entry, normalized session field, or renderer surface should be
added from this design document alone.
