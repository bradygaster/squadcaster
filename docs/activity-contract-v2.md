# Activity contract v2 design

## Scope and compatibility

Repository activity snapshots use `schemaVersion: 2`. Version 2 is additive:
all version 1 fields remain available, and pull requests add authoritative
review summaries. User-wide aggregate snapshots remain `schemaVersion: 2`
because their envelope is unchanged; each nested goal carries the repository
contract's additive pull-request shape.

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

## Candidate field audit

| Candidate | Authoritative source | API and permission impact | Missing, stale, and partial semantics | Renderer requirement | Slice |
|---|---|---|---|---|---|
| Review participants and decision | Pull request `reviewDecision`, `latestReviews`, and `reviewRequests` | Existing GraphQL PR query; repository read access; larger nested response but no extra request | Empty only after a successful source response; retained and marked stale with the PR source | Show latest observed states and pending requests; never equate reviewer with agent or owner | Implemented in v2 |
| Workflow jobs and steps | `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` | At least one paginated REST request per selected run; repository read access, `repo` scope for classic tokens on private repositories | Separate jobs source per repository or run; retain last successful jobs independently; distinguish unavailable from a successful empty job list | Lazy or bounded drill-down; show observed status/conclusion/timestamps only | Follow-up |
| Workflow failure detail | Job and step conclusions; optional logs only with an explicit bounded fetch | Job calls above; log downloads add redirects, large payloads, and short-lived URLs | No synthesized reason when GitHub exposes only `failure`; logs must fail independently and expire | Display conclusion separately from optional log excerpt; never generate a causal explanation | Follow-up with jobs |
| Stable agent identity and avatar | No validated Squad source currently exists in this repository | Unknown until Squad publishes a durable identity/provenance record; GitHub actor lookup alone is insufficient | Must remain unavailable, not copied from assignees, reviewers, PR authors, branches, or roster display names | Renderer needs a distinct agent identity surface separate from goal owner and GitHub participants | Blocked follow-up |
| Lifecycle transition history | Future persisted observation log or an authoritative event stream | Snapshot polling alone cannot reconstruct transitions between observations; timeline APIs add pagination and still do not define Squad lifecycle transitions | Record only transitions observed after the feature is enabled, with observation time and source freshness; never backfill inferred history | Explicitly label observed-at time, source state, and incomplete history | Follow-up |
| Durable goal/run/PR/session links | Existing closing references and explicit Squad markers cover goals, runs, and PRs; no validated implementation-session identifier exists | Existing correlations are bounded; session linkage requires an explicit producer contract | Preserve explicit identifiers only; unknown session link remains absent | Separate observed durable links from inferred branch correlation | Follow-up |
| Daily aggregate timezone | No daily aggregate exists in the current contract | No API cost until introduced | A future aggregate must carry an explicit IANA timezone or UTC server-day definition | Label the day boundary and timezone | Defer until a daily aggregate is proposed |

## Independently shippable slices

1. **Review drill-down:** ship the additive review arrays, adapter query fields,
   stale preservation, renderer output, tests, and this contract documentation.
2. **Workflow job drill-down:** add a separately cached `workflowJobs` source,
   fetch jobs only for a bounded set of relevant runs, and render jobs and steps
   without logs or inferred failure reasons.
3. **Optional failure evidence:** add an explicit on-demand log fetch with size,
   lifetime, permission, and redaction rules. Do not persist expiring URLs.
4. **Observed lifecycle history:** persist transitions seen by Squadcaster after
   activation, including observation time and source freshness. Do not
   reconstruct earlier transitions.
5. **Squad provenance contract:** define and validate durable agent and
   implementation-session identifiers at the producer before exposing them in
   this consumer.
6. **Daily aggregation semantics:** define timezone and day-boundary fields only
   with the first actual daily aggregate.
