# Squad operations architecture

## Activity contract

`activity-model.mjs` produces a versioned repository snapshot:

- `repository`: GitHub identity, URL, and default branch
- `summary`: active, blocked, failed, awaiting-review, and completed counts
- `goals`: issue-backed intents with lifecycle, owner, work items, blockers,
  artifacts, pull requests, workflow runs, next action, and evidence
- `errors`: source-specific discovery failures

Repository snapshots use activity contract version 2. Pull requests retain the
version 1 fields and add `reviews` and `reviewRequests`. `reviews` contains the
latest review exposed by GitHub for each reviewer, with the observed review
state and submission timestamp. `reviewRequests` contains the currently
requested GitHub users or teams. Actor identity is limited to the login or team
name and an observed GraphQL type when available; it is not treated as Squad
agent identity. A successful response with no entries is `[]`; legacy or
unavailable review connections are `null`.

The supported lifecycle is `queued`, `researching`, `implementing`, `reviewing`,
`blocked`, `completed`, and `failed`. GitHub state has precedence over inferred
planning state: closed or merged work is complete; unresolved dependencies are
blocked; current workflow/check failure is failed; a ready PR is reviewing; a
draft PR or active run is implementing.

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

Only the newest run for a workflow and branch affects failure state. Historical
failed attempts remain visible as evidence but do not override a successful
retry. Dependencies come from `Depends on:` or `Blocked by:` issue-body lines;
an unavailable referenced issue remains an explicit unknown blocker rather than
being silently ignored.

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

## Squad compatibility

Squadcaster observes existing Squad workflow output and repository-owned roster
files. It does not install, update, or execute Squad, and it does not expose a
setup or onboarding protocol. When Squad is not detected, the canvas links to
the external Squad installation guidance.

The provider contract is limited to opening the canvas, returning current
read-only state, and refreshing discovery. The loopback HTTP surface similarly
supports state/events, refresh, and local repository inclusion preferences.
Legacy persisted state is normalized on load so obsolete onboarding or mission
fields are ignored rather than restored.

## Security and failure behavior

- Discovery is read-only.
- The only POST routes update local inclusion preferences or request read-only refresh.
- The local renderer binds only to loopback.
- Renderer output is escaped before insertion.
- Independent API failures appear in the canvas.
- Each failed activity source retains its last-known evidence while successful
  issue, pull-request, and workflow sources continue to update.
- Partial snapshots expose source-specific errors and identify retained evidence
  as stale until that source refreshes successfully.
- Repository and aggregate refresh metadata distinguish the latest attempt from
  the last complete successful synchronization. Partial or stale snapshots do
  not advance the successful timestamp.
- Unknown relationships are not promoted to observed facts.
