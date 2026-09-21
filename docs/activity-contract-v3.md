# Activity contract v3 design

## Scope and compatibility

Repository and user-wide activity snapshots use `schemaVersion: 3`. Version 3
retains the version 2 authoritative review summaries and workflow job/step
drill-down, and adds an explicit, normalized calendar-day contract. No daily
aggregate is introduced by this version.

```js
dayBoundary: {
  version: 1,
  kind: "utc-server-day",
  timeZone: "UTC",
  snapshotDay: "2026-09-21",
  startsAt: "2026-09-21T00:00:00.000Z",
  nextBoundaryAt: "2026-09-22T00:00:00.000Z",
  cacheKey: "day-boundary-v1:utc:2026-09-21"
}
```

`fetchedAt`, `startsAt`, `nextBoundaryAt`, and all event timestamps are ISO 8601
UTC timestamps. For a complete repository snapshot, `snapshotDay` is derived
from `fetchedAt`. If a refresh retains stale source data, `snapshotDay` remains
the earliest retained stale source day until a complete refresh succeeds. The
browser locale and viewer timezone never select or rewrite it. A UTC server day begins at
`00:00:00.000Z` and ends at the exclusive `nextBoundaryAt`. UTC has no
daylight-saving transition, so spring-forward and fall-back changes in a
viewer's locale do not shorten, lengthen, repeat, or skip a contract day.

The day-boundary cache key includes the boundary contract version, timezone
semantics, and UTC date. Repository snapshots are refreshed when this key
changes even if their ordinary active/inactive TTL has not expired. A failed
refresh retains the prior `snapshotDay`; the renderer therefore cannot present
stale data as belonging to the new day. User-wide aggregate snapshots describe
their observation day in `dayBoundary` and list distinct repository input days
in `snapshotDays`. When those differ or span multiple days, the renderer labels
the input range and the aggregate observation day as refresh-pending.

Persisted activity schema v2 and registry v1 snapshots migrate on load to
schema v3 by deriving `dayBoundary` from their normalized `fetchedAt`. Malformed
or unsupported snapshots are discarded through the existing safe defaults.
Persisted state is version 4 and the repository registry is version 2.

The renderer labels the effective rule as `UTC server day YYYY-MM-DD
(00:00–24:00 UTC)`. For retained or mixed-day inputs it instead labels
`UTC server-day data START–END ... aggregate observed YYYY-MM-DD; refresh
pending`. These are contract labels only; they do not imply that any daily
count exists.

## Additive v2 fields retained

```js
pullRequest: {
  // Existing v1 fields remain unchanged.
  reviewDecision: "approved" | "changes_requested" | "review_required" | "unknown",
  reviews: null | [{
    actor: {
      login: string,
      type: "user" | "team" | "bot" | "mannequin" | "organization" | "unknown"
    },
    state: string,
    submittedAt: string | null
  }],
  reviewRequests: null | [{
    actor: {
      login: string,
      type: "user" | "team" | "bot" | "mannequin" | "organization" | "unknown"
    }
  }]
}
```

`reviews` is sourced from GitHub's `latestReviews` connection, not reconstructed
from comments or timeline events. `reviewRequests` is sourced from GitHub's
current review requests. An empty array means GitHub returned no entries. A
`null` connection means the field was absent from legacy cached data or has
never been fetched successfully. A missing login, type, or timestamp remains
empty, `unknown`, or `null`; the adapter does not infer it. These actors are
pull-request participants, not Squad agents and not goal owners.

```js
workflowRun: {
  // Existing v1 fields remain unchanged.
  jobsState: {
    status: "fresh" | "partial" | "stale" | "unavailable" | "not_selected",
    fetchedAt: string | null,
    error: string,
    truncated: boolean
  },
  jobs: null | [{
    id: number | null,
    name: string,
    status: string,
    conclusion: string,
    url: string,
    startedAt: string | null,
    completedAt: string | null,
    steps: [{
      number: number | null,
      name: string,
      status: string,
      conclusion: string,
      startedAt: string | null,
      completedAt: string | null
    }]
  }]
}
```

Jobs come from `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`. The
selection bound is fixed before any jobs request: for each correlated goal,
select its two newest runs by observed `updatedAt`, then `createdAt`, then run
ID; deduplicate shared runs; sort the combined set by the same keys; and keep at
most 20 runs per repository refresh. Runs outside that set use
`jobsState.status: "not_selected"` and do not trigger a request.

Each selected run is fetched with `per_page=100`, one page at a time, stopping
when GitHub returns fewer than 100 jobs, the observed `total_count` is reached,
or 10 pages have been read. Reaching the 1,000-job ceiling before
`total_count` marks that run and the `workflowJobs` source `partial`; returned
jobs remain the authoritative observed prefix. Requests include
`filter=latest`, so a successful refresh replaces cached jobs with the latest
attempt for that run ID. Positive job IDs repeated across pages are
deduplicated; entries without a positive ID are preserved because they cannot
be proven identical. Completion and ceiling checks use the deduplicated
observed count. Polling never requests workflow logs.

Job and step names, IDs, URLs, statuses, conclusions, and timestamps are copied
only from GitHub's response. Missing values remain empty or `null`. The model
does not calculate progress, duration, failure reason, causal relationships, or
state transitions.

## Source, cost, permissions, and cache behavior

The implemented review fields are added to the existing `gh pr list` GraphQL
query. They do not add per-pull-request requests or a new polling loop. They
use the same repository read permission as pull-request discovery. The
generated `gh` query adds `latestReviews(first: 100)` and
`reviewRequests(first: 100)` to every pull-request page. A measurement against
the current repository increased one page from 1 to 2 GraphQL points. The
exact cost remains GitHub-calculated and data-dependent.

The existing limit is 1,000 pull requests, fetched in pages of up to 100. At the
measured cost, a full 1,000-PR refresh is approximately 20 points instead of
10. The current repository can refresh every 10 seconds, which is approximately
720 points/hour for the PR source at that measured cost. Each additional active
repository refreshed every minute is approximately 120 points/hour; each
inactive repository refreshed every ten minutes is approximately 12
points/hour. The existing combined rate-limit guard pauses background refresh
when the GraphQL budget is low. This slice keeps the established bounds and
polling policy; it does not claim budget neutrality.

Review data belongs to the `pullRequests` source. If that query fails, the
adapter retains the last successful pull-request payload, including review
details, marks the source `stale`, and exposes the source-specific error. If no
pull-request query has ever succeeded, review data is unavailable rather than
represented as current empty arrays. Legacy cached pull requests also normalize
both review connections to `null`. The renderer distinguishes unavailable
connections from successful empty arrays, displays only returned participants,
and never derives approval, identity, or pending-review state from comments,
checks, authorship, assignees, or goal ownership.

Workflow jobs belong to an independent `workflowJobs` source. A jobs failure
does not discard or stale issues, pull requests, workflow runs, or other cached
evidence. Cache entries are maintained per selected run. A failed refresh keeps
that run's last successful jobs and marks its jobs state `stale`; a run that
has never returned jobs is `unavailable`. A successful `{ jobs: [] }` response
is `fresh` with an empty array and is not treated as unavailable. Mixed fresh
and unavailable or pagination-limited results mark the source `partial`.

The jobs endpoint requires Actions read access to the repository. GitHub App
and fine-grained token configurations need Actions repository permission;
classic tokens need repository access appropriate to the repository
visibility. Permission errors remain source-specific and retain any prior
successful per-run jobs.

Every page reserves one observed REST core request before it is sent. A refresh
shares one mutable budget across repositories and never reduces the observed
remaining count below the 100-request reserve. Therefore the jobs slice issues
at most `min(200, max(0, observedRemaining - 100))` REST calls per refresh:
20 selected runs times 10 pages is the absolute ceiling, while the reserve is
the effective ceiling. If the budget is exhausted before a run starts, cached
jobs become stale or uncached jobs are unavailable. If it is exhausted after
one or more pages and no successful cache exists, the observed prefix is
partial. A later successful latest-attempt response replaces stale or partial
jobs for that run.

## Candidate field audit

| Candidate | Authoritative source | API and permission impact | Missing, stale, and partial semantics | Renderer requirement | Slice |
|---|---|---|---|---|---|
| Review participants and decision | Pull request `reviewDecision`, `latestReviews`, and `reviewRequests` | Existing GraphQL PR query; repository read access; larger nested response but no extra request | Empty only after a successful source response; retained and marked stale with the PR source | Show latest observed states and pending requests; never equate reviewer with agent or owner | Implemented in v2 |
| Workflow jobs and steps | `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs?filter=latest` | Up to `min(200, max(0, observedRemaining - 100))` calls: 20 selected runs, 10 pages per run, 100 jobs per page; Actions read access | Independent `workflowJobs` source and per-run cache; retain last successful jobs; distinguish fresh empty, partial, stale, unavailable, and not selected | Separate bounded drill-down; show observed fields only | Implemented in v2 |
| Workflow failure detail | Job and step conclusions; optional logs only with an explicit bounded fetch | Job calls above; log downloads add redirects, large payloads, and short-lived URLs | No synthesized reason when GitHub exposes only `failure`; logs must fail independently and expire | Display conclusion without a causal explanation; no logs in polling | Job conclusions implemented; logs deferred |
| Stable agent identity and avatar | No validated Squad source currently exists in this repository | Unknown until Squad publishes a durable identity/provenance record; GitHub actor lookup alone is insufficient | Must remain unavailable, not copied from assignees, reviewers, PR authors, branches, or roster display names | Renderer needs a distinct agent identity surface separate from goal owner and GitHub participants | Blocked follow-up |
| Lifecycle transition history | Future persisted observation log or an authoritative event stream | Snapshot polling alone cannot reconstruct transitions between observations; timeline APIs add pagination and still do not define Squad lifecycle transitions | Record only transitions observed after the feature is enabled, with observation time and source freshness; never backfill inferred history | Explicitly label observed-at time, source state, and incomplete history | Follow-up |
| Durable goal/run/PR/session links | Existing closing references and explicit Squad markers cover goals, runs, and PRs; no validated implementation-session identifier exists | Existing correlations are bounded; session linkage requires an explicit producer contract | Preserve explicit identifiers only; unknown session link remains absent | Separate observed durable links from inferred branch correlation | Follow-up |
| Daily aggregate timezone | The v3 snapshot contract defines UTC server-day without adding a daily aggregate | No API cost | Any future daily aggregate must use the normalized `dayBoundary` and its cache key; stale prior-day snapshots stay prior-day | Already labels UTC server-day and date | Contract implemented; metric deferred |

## Independently shippable slices

1. **Review drill-down:** ship the additive review arrays, adapter query fields,
   stale preservation, renderer output, tests, and this contract documentation.
2. **Workflow job drill-down:** implemented with a separately cached
   `workflowJobs` source, fixed run and pagination bounds, and a distinct
   job/step renderer without logs or inferred failure reasons.
3. **Optional failure evidence:** add an explicit on-demand log fetch with size,
   lifetime, permission, and redaction rules. Do not persist expiring URLs.
4. **Observed lifecycle history:** persist transitions seen by Squadcaster after
   activation, including observation time and source freshness. Do not
   reconstruct earlier transitions.
5. **Squad provenance contract:** define and validate durable agent and
   implementation-session identifiers at the producer before exposing them in
   this consumer. The consumer validation gate and current correlation audit
   are documented in
   [the implementation session provenance consumer contract](session-provenance-consumer-contract.md).
6. **Daily aggregation semantics:** reuse the v3 `dayBoundary` contract when an
   actual daily aggregate is proposed; do not infer a browser-local day.
