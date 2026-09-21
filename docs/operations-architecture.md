# Squad operations architecture

## Activity contract

`activity-model.mjs` produces a versioned repository snapshot:

- `repository`: GitHub identity, URL, and default branch
- `summary`: lifecycle counts plus repository bootstrap status totals
- `goals`: issue-backed intents with lifecycle, owner, work items, blockers,
  artifacts, pull requests, workflow runs, next action, evidence, and a
  read-only `handoff` readiness contract plus an optional bootstrap facet on
  the canonical research goal
- `bootstrap`: the repository-level automatic-bootstrap classification
- `errors`: source-specific discovery failures

Repository snapshots use activity contract version 3. Pull requests retain the
version 1 fields and v2 adds `reviews` and `reviewRequests`. `reviews` contains the
latest review exposed by GitHub for each reviewer, with the observed review
state and submission timestamp. `reviewRequests` contains the currently
requested GitHub users or teams. Actor identity is limited to the login or team
name and an observed GraphQL type when available; it is not treated as Squad
agent identity. A successful response with no entries is `[]`; legacy or
unavailable review connections are `null`.

Stable Squad agent identity is intentionally absent. The consumer boundary,
candidate-field audit, future schema, and fail-closed cache and renderer
semantics are defined in
[`agent-identity-consumer-contract.md`](agent-identity-consumer-contract.md).
Goal owners, GitHub participants, and roster entries remain separate concepts.

Version 3 adds a normalized `dayBoundary` object using UTC server-day semantics.
It carries the contract version, `UTC` timezone, UTC calendar date, inclusive
start, exclusive next boundary, and a date-partitioned cache key. All timestamps
remain ISO 8601 UTC. Browser locale and viewer timezone do not alter the
boundary, and daylight-saving changes therefore do not change the day length.
Crossing UTC midnight makes cached repository snapshots due immediately. Failed
refreshes retain the earliest stale source's prior-day key. User-wide snapshots
list their repository input days, and the renderer distinguishes retained or
mixed-day data from the aggregate observation day. No daily metric is part of
this contract slice.

Selected workflow runs add an independent `workflowJobs` source. Before making
jobs requests, the adapter selects the two newest correlated runs per goal,
deduplicates them, and caps the repository at 20 runs. Each run uses at most 10
pages of 100 jobs from GitHub's run-jobs REST endpoint with `filter=latest`.
Positive job IDs are deduplicated across pages. Runs outside the bound are
explicitly not selected. The cache is per run: failures retain the last
successful jobs for that run without staling issue, pull-request, or run data.
A successful empty jobs response remains distinct from unavailable data.

Job pagination shares an explicit REST core budget across the refresh. Each
page reserves one request before querying, and polling stops at the
100-request reserve. The jobs slice therefore makes at most
`min(200, max(0, observedRemaining - 100))` requests. Budget exhaustion marks
affected runs partial, stale, or unavailable according to whether an observed
prefix or successful cache exists; it does not allow later selected runs to
cross the reserve.

The renderer keeps workflow-run summaries and workflow job/step drill-down in
separate sections. It shows only GitHub-observed names, statuses, conclusions,
URLs, and timestamps. It does not infer progress, duration, failure reason, or
causality, and the polling path never downloads logs.

The supported lifecycle is `queued`, `researching`, `implementing`, `reviewing`,
`blocked`, `completed`, and `failed`. GitHub state has precedence over inferred
planning state: closed or merged work is complete; unresolved dependencies are
blocked; current workflow/check failure is failed; a ready PR is reviewing; a
draft PR or active run is implementing.

## Observed lifecycle history

Lifecycle history is persisted separately from GitHub evidence in registry
contract version 2. It begins with the first eligible observation after the
feature is enabled. That observation establishes a baseline only, so every goal
reports that history is incomplete before its first observation. Squadcaster
does not inspect existing issue, pull request, check, artifact, workflow, or
run timestamps to manufacture earlier transitions.

A transition record contains only repository and goal identity, `from`, `to`,
the Squadcaster `observedAt` timestamp, and the freshness of each source used by
that snapshot. Complete observations and explicitly partial observations with
at least one fresh source may append a transition. Intentionally skipped
sources make the observation partial; they are never labeled complete. A
stale-only, unavailable-only, failed, or unrefreshed snapshot cannot append
one. Empty or malformed legacy source state is also ineligible because it
provides no freshness evidence. Partial transitions remain visibly labeled partial. Cross-repository
dependency changes are observed at the aggregate boundary and include the
dependency repositories' source freshness.

Observation timestamps order the local log; they are not GitHub or Squad action
times. If the local clock moves backward or repeats a timestamp, Squadcaster
advances the next observation by one millisecond from the prior observation so
the persisted order remains deterministic without claiming external timing.
Each goal retains the newest 100 transitions. Older entries are dropped; there
is no time-based deletion and no reconstruction after retention.

Excluding a repository suspends observation. Re-enabling it requires a new
baseline, so a phase difference spanning the exclusion window is not recorded
as if Squadcaster had observed the transition. Registry version 1 and malformed
history migrate to an empty version 2 history. Persisted baselines and
transitions survive extension and process restarts; missing pre-feature history
remains explicitly incomplete. If a previously tracked goal is absent from an
eligible observation, its baseline is invalidated; a later reappearance
establishes a new baseline while preserving transitions recorded before the
gap.

## Correlation rules

The GitHub adapter reads repository metadata, issues, pull requests, and Actions
runs independently through `gh`.

A goal is an issue with at least one of:

- a `squad` or `squad:*` label
- a `/squad` command in its body or comments
- structured data containing a `squad_artifact`
- a Squad-prefixed title

Pull requests correlate through repository-qualified GitHub closing references
and closing keywords, with unqualified references resolved against the pull
request repository. Correlation requires an exact repository and issue-number
match. The standalone `squad:implement issue={number} run={number}` marker and
the `squad/implement-{issue}-*` branch convention are local to that repository.
Workflow runs correlate through an issue reference or an already-correlated
implementation branch. Branch/run correlation is marked as inferred in the
evidence timeline.

Closing references, closing keywords, and the explicit Squad implementation
marker are observed correlations. A branch-only pull-request correlation is
inferred, even though the pull request itself is observed. If both are present,
the observed correlation takes precedence. Implementation session provenance
remains unknown until Squad publishes and validates a versioned producer
payload; the consumer gate is defined in
[`session-provenance-consumer-contract.md`](session-provenance-consumer-contract.md).

The canonical Cast pull request and exact default-branch `Squad Bootstrap` runs
are excluded from those implementation rules. They attach to the canonical
research goal as observed bootstrap evidence and never become work items,
closing pull requests, or ordinary inferred workflow evidence. All other
pull-request and workflow correlation remains unchanged.

Only the newest run for a workflow and branch affects failure state. Historical
failed attempts remain visible as evidence but do not override a successful
retry. Dependencies come from `Depends on:` or `Blocked by:` issue-body lines;
an unavailable referenced issue remains an explicit unknown blocker rather than
being silently ignored.

## Read-only handoff readiness

`handoff-readiness.mjs` derives `goal.handoff` without exposing a launch or
mutation adapter. The contract records:

- the exact root issue, activation artifact, task, task issue, epic, epic
  issue, agent, agent set, and reported labels from one recognized
  `activated`, `phases-activated`, `plan-accepted`, or `phases-accepted`
  artifact;
- acceptance criteria extracted from the untruncated task issue body, together
  with the issue revision and an explicit completeness marker;
- native GitHub parent/sub-issue evidence plus the supported `Parent:` and
  `Sub-issues:` body fallback;
- repository-qualified dependency observations;
- correlated pull requests, workflow runs, actual Copilot assignment/tasks
  when enabled, and app-local session bindings when enabled;
- source-by-source completeness and mechanism availability as independent
  dimensions.

Activation bindings are mandatory, non-empty JSON. References must be resolved
`#<number>` strings. Malformed JSON, surviving `#aw_*` references, missing
issues, duplicate or ambiguous bindings, label mismatches, stale evidence,
authorization failures, and capped results all fail closed as `unknown`.
`squad:copilot` is activation routing provenance only; actual assignment
requires an observed Copilot assignee or authoritative task evidence.

Readiness is `ready` only for an open activated leaf with complete acceptance
criteria, completed dependencies, exhaustive fresh enabled sources, and no
existing implementation. Active work is `already-in-progress`; a closed issue
or merged pull request is `completed`; a closed-unmerged pull request is an
ambiguous prior attempt and remains `unknown`. Cross-repository aggregation
reconciles dependency states without weakening any other readiness gate.

## User-wide aggregation

`GitHubSquadActivityAdapter` implements discovery and returns the normalized
snapshot without exposing GitHub CLI response shapes to the renderer.
`GitHubGlobalActivity` discovers repositories readable by the authenticated
user across owner, collaborator, and organization-member affiliations. It
maintains a user-level registry and combines repository snapshots using
`repository.nameWithOwner` plus the immutable issue number as the goal key.
Workflow and roster-file presence plus exact `squad` label signals are read
during paginated affiliation discovery. Repositories without those direct
signals use cached repository-scoped prefix discovery: Squad-prefixed label
definitions are paged, then exact-label open existence is checked with
`per_page=1` until a match is found. The probe accounts for the REST core budget,
keeps prior positive signals when a refresh is inconclusive, and is followed by
the repository-scoped structured-artifact fallback. These paths never add a
repository outside the affiliated set and deduplicate identities
case-insensitively. Roster-file content loading is a separate refresh concern.
Discovery also records each repository's `.squad/team.md` blob OID. Non-current
repository refreshes load and parse that blob inside the existing bounded
three-worker pool, then pass the repository-specific members into activity
normalization so `squad:<member>` labels resolve correctly.

Parsed rosters are persisted by repository and observed blob OID. An unchanged
OID reuses the cached roster without another download; a changed OID is fetched
once and replaces the cache only after successful parsing. Missing rosters
surface an unavailable source and use assignee/Unknown ownership fallback.
Malformed or permission-denied replacements preserve the last valid roster,
mark it stale, and expose the failure in the aggregate errors.

The repository used to open the canvas is refreshed every 10 seconds. Other
repositories with active work refresh every minute, and inactive repositories
refresh every ten minutes. Repository discovery runs every fifteen minutes.
Actions are queried for the current repository and repositories already known
to have active work. A low GraphQL or REST core rate-limit budget pauses
background refresh until the limiting budgets reset while preserving
current-repository refresh and cached state.

Users may include or exclude discovered repositories locally. Aggregation does
not weaken GitHub permissions: only repositories readable through the active
`gh` identity can appear. Each evidence item retains its repository URL and
states whether the relationship is observed or inferred.

Dependencies support local issue numbers, `owner/repository#number`, and full
GitHub issue URLs. The aggregate resolves these references against goals in
other included repositories. Missing or excluded targets remain visible with an
unknown state instead of being treated as complete.

Repository bootstrap classifications aggregate separately under `bootstraps`.
Each entry retains its repository identity, status, stale guard, reasons, and
canonical links. Aggregate bootstrap summary counts include unknown, partial,
malformed, and every other classifier state without adding a lifecycle column
or changing active-goal totals.

## Squad compatibility

Squadcaster observes existing Squad workflow output and repository-owned roster
files. It does not install, update, or execute Squad, and it does not expose a
setup or onboarding protocol. When Squad is not detected, the canvas links to
the external Squad installation guidance.

The provider contract is limited to opening the canvas, returning current
read-only state, and refreshing discovery. The loopback HTTP surface similarly
supports state/events, refresh, and local repository inclusion preferences.
Legacy persisted state is normalized on load so obsolete onboarding or mission
fields are ignored rather than restored. Persisted activity v2 and registry v1
snapshots migrate to activity v3 by deriving their UTC boundary from `fetchedAt`.

The optional transition from activated work to an implementation mechanism is
documented in
[the handoff design](optional-handoff-design.md). The design keeps this
read-only architecture as the baseline. Activation provenance, acceptance
criteria, readiness, source completeness, and existing-work reconciliation are
now normalized; mutation, permission checks, confirmation, and idempotent
launch adapters remain separately approved slices.

Automatic bootstrap is a repository-level, read-only status facet rather than
a new goal lifecycle phase. The canonical research-proposals issue remains the
goal; the deterministic Cast pull request and bootstrap workflow attempts are
attached as bootstrap evidence without pretending the Cast pull request closes
the issue. Candidate validation is exact and fail-closed, closed-unmerged Cast
pull requests are explicit human opt-outs, and stale sources retain the last
complete classification.

Downstream `journeyPhase` is distinct from the goal's lifecycle `phase`.
Supported schema-1 artifacts can move the journey through research, triage,
planning, acceptance, activation, generated delivery, and done while existing
goal phases remain authoritative. Unsupported and malformed artifacts stay
visible but non-advancing. Generated task and epic goals are linked only from
validated activation bindings whose structured references and observed Squad
labels agree; issue-number prose is never sufficient. See
[Automatic-bootstrap observability](automatic-bootstrap-observability.md) for
the authoritative state model, evidence mapping, and renderer decision.

## Security and failure behavior

- Discovery is read-only.
- The only POST routes update local inclusion preferences or request read-only refresh.
- The local renderer binds only to loopback.
- Renderer output is escaped before insertion.
- Independent API failures appear in the canvas.
- Each failed activity source retains its last-known evidence while successful
  issue, pull-request, workflow-run, and workflow-job sources continue to
  update independently.
- Partial snapshots expose source-specific errors and identify retained evidence
  as stale until that source refreshes successfully.
- Repository and aggregate refresh metadata distinguish the latest attempt from
  the last complete successful synchronization. Partial or stale snapshots do
  not advance the successful timestamp.
- Unknown relationships are not promoted to observed facts.
- Unvalidated stable agent identity fields are discarded from persisted
  activity rather than restored or inferred.
- Candidate implementation-session provenance fields are discarded from
  persisted activity until the producer contract is validated.
