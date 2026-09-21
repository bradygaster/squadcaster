# Implementation session provenance consumer contract

## Decision status

Squad commit `fa739bd6` published the authoritative v1 producer schema and
fixtures. Squadcaster consumes that contract from exactly one pull-request
conversation comment authored by `github-actions[bot]`, headed
`Squad implementation provenance:`, and followed by exactly one fenced `json`
object.

Squadcaster must not invent a session identifier or derive one from a branch,
GitHub actor, workflow run, pull request, timestamp, issue text, or textual
similarity. When the producer payload is absent, lacks its declared session
identifier, or cannot be validated, implementation session provenance is
unknown.

## Existing correlation audit

The existing goal, pull-request, and workflow-run relationships remain valid
independently of authoritative session provenance.

| Relationship | Current source | Consumer classification |
|---|---|---|
| Goal to pull request | GitHub `closingIssuesReferences` with exact repository and issue match | Observed |
| Goal to pull request | Local or repository-qualified closing keyword with exact repository and issue match | Observed |
| Goal to pull request | `squad:implement issue={number} run={number}` marker | Observed explicit marker |
| Goal to pull request | `squad/implement-{issue}-*` branch convention | Inferred |
| Goal to workflow run | Issue reference in run display metadata | Inferred |
| Goal to workflow run | Implementation branch naming or equality with an already-correlated PR branch | Inferred |
| Pull request to check | GitHub pull-request status-check rollup | Observed |
| Goal, pull request, and run to implementation session | Validated Squad v1 post-create PR comment | Observed |

An observed closing reference or explicit marker takes precedence when the
same pull request also matches the branch convention. Branch-only correlation
continues to work, but its evidence must be labeled `inferred`.

## Validation boundary

The consumer copies the producer's exact-key, schema, identifier, goal, and
replacement validation. It additionally resolves the payload against the
observed repository, pull request number and head, origin and related goals,
replacement pull requests, dispatcher run, and worker run. Unsupported,
partial, malformed, duplicated, unresolved, extra-key, and runtime-mismatched
payloads are invalid. The PR body, non-bot comments, actors, timestamps,
branches, closing text, and similarity never supply session identity.

## Source and cache semantics

`implementationProvenance` is an independent source. Squadcaster selects the
20 newest repository pull requests, retrieves up to three pages of 100
conversation comments for each, and requires pagination to complete. A fresh
result is cached by the pull request's observed revision for ten minutes, so
unchanged valid, missing, and invalid entries avoid rapid polling but are still
periodically revalidated to detect comment additions, edits, and removals.

- A successful valid response replaces the last valid payload for that source.
- A fetch or permission failure retains the last valid payload and marks only
  the provenance source stale.
- A fresh malformed or invalid replacement hides cached fields for that pull
  request and is rendered as invalid.
- An unsupported schema version is malformed, not an empty successful result.
- A successful producer response with no record for a goal means session
  provenance is unknown, not that no implementation session exists.
- A record without the producer-declared session identifier is invalid for
  session provenance and cannot be repaired from correlated GitHub data.
- Issues, pull requests, runs, and checks continue refreshing independently
  when provenance is stale, unavailable, or malformed.
- Aggregate freshness preserves repository and source identity. Valid records
  aggregate by producer plus opaque session ID, so reruns and replacement PRs
  remain one session while a newly minted session remains distinct.

## Normalized and rendering behavior

The normalized model exposes only validated camel-case records and
source revision, status, fetched time, and error metadata.

The renderer will:

- show an implementation session only when a valid producer record supplies
  the session identifier;
- label closing-reference and explicit-marker links as observed;
- label branch-derived relationships as inferred;
- display `Unknown` for absent session provenance without substituting a
  branch, actor, run, pull request, timestamp, or issue;
- identify stale or unavailable provenance separately from fresh GitHub issue,
  pull-request, run, and check evidence;
- render the opaque session ID without inventing a session URL;
- link only explicit GitHub repository, issue, pull-request, and run references;
- identify payload relationships as observed while keeping branch correlation
  explicitly inferred.

Persisted state version 5 permits only the normalized
`implementationProvenance` paths. Arbitrary or nested legacy session-like
fields continue to be removed recursively.
