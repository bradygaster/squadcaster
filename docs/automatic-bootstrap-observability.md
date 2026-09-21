# Automatic-bootstrap observability

## Decision

Squadcaster observes automatic bootstrap as a read-only, repository-level
status facet backed exclusively by canonical GitHub artifacts and workflow
evidence. It does not reproduce Squad's recovery actions, create missing
artifacts, post commands, rerun workflows, or infer success from incomplete
evidence.

The canonical research-proposals issue remains the goal in the existing
normalized activity model. The bootstrap Cast pull request and bootstrap
workflow runs are attached to that goal as related evidence, but the Cast pull
request is not treated as an implementation pull request: it intentionally has
no closing reference to the research issue.

Bootstrap warrants a compact dedicated treatment in repository context and
goal details because it describes a repository-wide prerequisite and a pair of
artifacts rather than one delivery stage. It does **not** warrant another
factory-floor lifecycle column. Research, triage, planning, activation, and
the resulting implementation work continue to use the existing goal phases,
attention surfaces, filters, and evidence timeline.

## Authority and read-only boundary

Squad's installed workflow and its validated GitHub output are authoritative.
The current canonical contract is:

- workflow: `Squad Bootstrap`, running on the repository default branch
- Cast branch: `squad/bootstrap-cast`
- Cast pull-request title: `[squad] Cast your Squad`
- research issue title:
  `[Research Proposals] Agent-discovered repo opportunities`
- research issue marker:
  `<!-- squad:bootstrap-opportunities schema=1 -->`
- initial structured research artifact: a `github-actions[bot]` comment with
  exactly `squad_artifact`, `schema_version`, `origin_issue`, and `phases`
  fields, where the values are `research`, `"1"`, the canonical issue number,
  and an empty array

Squadcaster may read repository metadata, workflow presence, workflow runs,
issues, comments, pull requests, checks, and the timestamps and links already
present on GitHub. Its output is derived display state only. No bootstrap state
is persisted back to GitHub, and local cache state never becomes evidence.

## Candidate validation

A candidate is canonical only when every identity field matches. Validation is
repository-scoped and case-sensitive where GitHub and Squad treat the value as
an exact contract.

### Cast pull request

A pull request is a bootstrap candidate when either its head branch is
`squad/bootstrap-cast` or its title is `[squad] Cast your Squad`. A candidate
is valid only when all of these are true:

- the head branch is exactly `squad/bootstrap-cast`
- the title is exactly `[squad] Cast your Squad`
- the base branch is the repository's current default branch
- no second candidate matches by branch or title

Draft is the expected open state, but a human may mark the pull request ready.
Merged is a valid terminal Cast state. Closed without merge is an explicit
opt-out and must never be reinterpreted as failure or missing work.

### Research-proposals issue

An issue is a bootstrap candidate when either its title is the canonical title
or its body contains the bootstrap marker. It is valid only when both identity
fields match and the marker appears exactly once. More than one candidate is
ambiguous.

The issue may be open or closed. Closing the issue does not erase the bootstrap
record. Downstream lifecycle rendering follows normal goal semantics, while
the bootstrap facet retains its last validated materialization result.

### Initial research artifact

Only a `github-actions[bot]` comment with one canonical structured research
envelope qualifies as the bootstrap research seed. The envelope must have the
exact four-key shape, schema `"1"`, the canonical issue number as
`origin_issue`, and `phases: []`.

A later focused `/squad research ...` run may replace the concise bootstrap
seed through Squad's normal research upsert behavior. Such a canonical
`research` artifact remains valid bootstrap evidence even when its prose is no
longer the bootstrap seed. A later triage or planning artifact does not make a
missing or malformed research envelope valid retroactively.

## Authoritative state model

The derived `bootstrap.status` is one of the following values. Classification
uses the complete fetched candidate sets, not whichever item happened to sort
first.

| Status | Required evidence | Meaning and UI behavior |
|---|---|---|
| `pending` | The bootstrap workflow exists or has a queued/in-progress run, and no canonical artifact pair exists yet. | Normal transient state. Link the run when available. Do not call it stuck or successful. |
| `delayed` | A pending run has not changed for 15 minutes, or the workflow is installed on the default branch but no run or artifact is observed after one full repository-discovery interval plus 15 minutes. | Attention-worthy warning, not failure. State that GitHub evidence has not advanced and show the timestamps used. Suppress this conclusion when relevant sources are stale or unavailable. |
| `partial` | Exactly one valid canonical artifact exists, or both exist but the canonical research artifact is absent. | Show the artifact that exists and name the missing evidence. This mirrors Squad's `create_issue`, `create_pr`, and `create_research` recovery states without executing them. |
| `failed` | The newest canonical workflow attempt is terminal with a failure conclusion, no newer attempt exists, and the state is not already complete or opted out. | Needs attention. Link the failed run. Existing valid partial artifacts remain visible and are not discarded. |
| `retried` | A newer canonical run follows a terminal failed attempt and is queued, in progress, or successful, but canonical materialization is not complete yet. | Show both attempts and make clear that recovery is underway or awaiting artifact observation. Once the pair is valid, status becomes `complete` and retry history remains evidence. |
| `complete` | Exactly one valid Cast pull request, one valid research issue, and one valid research artifact exist. | Bootstrap materialization is complete. This says nothing about Cast approval or downstream proposal completion; those are represented by `journeyPhase`. |
| `ambiguous` | Candidate identity cannot be classified uniquely or safely. Reasons include duplicate Cast candidates, duplicate research issues, an object matching only one half of an exact identity contract, multiple structured research envelopes in one comment, or conflicting cross-links. | Fail closed, show all candidate links that are safe to expose, and do not select a canonical goal or claim progress. |
| `malformed` | A unique candidate exists but violates its canonical structure, such as the wrong base branch, repeated marker, wrong structured-data keys/schema/origin, or invalid field types. | Fail closed. Identify the violated contract and link the containing artifact. `malformed` is distinct from operational workflow failure. |
| `opted_out` | The one valid bootstrap Cast pull request is closed without merge. | Terminal human decision. Preserve any linked issue and evidence, remove bootstrap from attention counts, and never label the missing replacement as partial or delayed. |

`duplicate` is an ambiguity reason rather than a successively chosen artifact.
When duplicate research comments are individually valid, Squadcaster reports
`ambiguous` with reason `duplicate-research-artifact`; it does not copy Squad's
writer behavior of selecting the newest comment and deleting older ones.

### Precedence

Classification applies this precedence:

1. stale or unavailable source guard
2. duplicate and conflicting candidates → `ambiguous`
3. unique invalid candidate → `malformed`
4. valid closed-unmerged Cast pull request → `opted_out`
5. complete canonical artifact set → `complete`
6. newer attempt after a failure → `retried`
7. unique incomplete artifact set → `partial`
8. newest terminal run failed → `failed`
9. elapsed pending threshold → `delayed`
10. otherwise → `pending`

The stale-source guard does not invent a separate bootstrap status. It retains
the last fully classified bootstrap state, marks it stale, and identifies the
source that prevents reclassification. With no prior complete classification,
the facet is `unknown` and excluded from bootstrap totals. In particular,
missing issues during an unavailable issue refresh must not turn `complete`
into `partial`.

## Downstream journey mapping

`bootstrap.status` answers whether the automatic handoff was materialized
safely. A separate `bootstrap.journeyPhase` explains what humans and Squad have
done with it:

| Journey phase | Canonical evidence | Existing goal/evidence mapping |
|---|---|---|
| `cast-review` | Complete artifact pair; Cast pull request remains open. | Research issue goal is `researching`. Cast PR appears as observed `bootstrap-cast` evidence, not as an implementation work item. |
| `research` | Canonical `research` artifact is latest. The artifact may be the bootstrap seed or focused research. | Goal phase `researching`; next action is triage. |
| `triage` | Canonical `triage` artifact is latest. | Goal phase `researching`; next action is plan or triage revision according to artifact content. |
| `planning` | Latest artifact is `program`, `implementation`, `validation`, or `plan`. | Goal phase `researching`; next action is human plan review/acceptance. |
| `activation-ready` | Latest artifact is an accepted scope/plan/phases artifact. | Goal phase `queued`; next action is activation. |
| `activating` | A correlated activation workflow is queued or in progress. | Goal phase `implementing`, with observed workflow evidence. |
| `activated` | Latest artifact is `activated` or `phases-activated`, or validated activation output links generated implementation issues. | Root research goal is `queued` until GitHub state closes it; generated implementation issues appear as separate goals. The root evidence timeline links the generated goals. |
| `delivery` | Generated implementation goals have work in progress. | Existing implementation issues, pull requests, checks, dependencies, and phases remain authoritative. No bootstrap-specific phase is introduced. |
| `done` | The research issue is closed or the accepted program is otherwise terminal according to validated Squad artifacts. | Existing goal completion rules apply. Bootstrap status remains `complete`. |

Artifact-kind mapping must be schema-aware. Unknown kinds and unsupported
schema versions remain visible as unclassified evidence but cannot advance
`journeyPhase`.

## Evidence and correlation

The normalized goal gains a bootstrap facet rather than overloading current
pull-request correlation:

```json
{
  "bootstrap": {
    "status": "complete",
    "journeyPhase": "research",
    "stale": false,
    "reasons": [],
    "castPullRequest": {},
    "researchIssue": {},
    "workflowAttempts": []
  }
}
```

Recommended evidence kinds are:

- `bootstrap-workflow` — observed when matched by exact workflow identity and
  default-branch run metadata
- `bootstrap-cast` — observed exact Cast candidate and its draft/open/merged or
  closed-unmerged state
- `bootstrap-issue` — observed exact issue title and durable marker
- `bootstrap-research` — observed validated structured research envelope
- `bootstrap-diagnostic` — derived classification reason; links back to the
  observed GitHub object and is labeled `derived`

Exact workflow and artifact matches are observed evidence. A state label such
as `partial`, `delayed`, or `retried` is derived from those observations.
Bootstrap runs must not be correlated to arbitrary goals by issue-number text.

Every state exposes direct GitHub links and the timestamps used to classify it.
Historical failed attempts remain evidence after retry or completion. Only the
newest run for the canonical workflow and default branch controls current
failure/retry state.

## Discovery and degraded data

Bootstrap discovery must request all-state pull requests and issues, because a
merged Cast pull request and a closed-unmerged opt-out are both authoritative.
It must inspect issue comments only after identifying the unique canonical
research issue. Candidate discovery must be repository-scoped and exhaustive
within the same pagination guarantees used by Squad's validator; capped search
results are not sufficient for duplicate detection.

Issue, pull-request, workflow, and comment freshness remain independent:

- a failed source retains its last-known evidence
- a successful source may update while another remains stale
- partial refresh never advances the repository's last fully successful sync
- bootstrap is reclassified only when every source needed for the proposed
  transition is fresh
- stale evidence is visibly labeled and never converted into a stronger claim

If comment retrieval fails after the issue and Cast pull request are observed,
the last complete classification is retained. Without a prior classification,
the state is unknown rather than `partial`.

## Renderer direction

The dashboard should add:

- a compact repository-level bootstrap summary when bootstrap is pending,
  delayed, partial, failed, retried, ambiguous, malformed, or opted out
- a bootstrap badge and section in the canonical research goal drawer
- bootstrap diagnostics in **Needs attention** for `delayed`, `partial`,
  `failed`, `ambiguous`, and `malformed`
- workflow attempts and canonical artifact links in the existing evidence
  timeline
- an `Automatic bootstrap` filter facet, not another lifecycle phase filter

`complete` bootstrap should be quiet by default: a badge and drawer details are
enough. `opted_out` should be visible in repository context and the drawer but
must not increase active or attention totals. Ambiguous and malformed states
must never render a guessed canonical goal; their repository-level diagnostic
is the primary surface.

## Implementation boundaries

Implementation should be split so each change preserves the read-only
contract:

1. normalized bootstrap classifier and strict artifact validation
2. repository discovery for canonical workflow, candidates, and comments with
   independent stale-source behavior
3. goal/evidence integration and downstream journey mapping
4. renderer treatment, accessibility, filters, and degraded-state copy

Each implementation must include fixture coverage for every status, precedence
case, retry history, stale-source retention, exact links, and the absence of
GitHub mutation commands or routes.

## Upstream references

- [bradygaster/squad#2041](https://github.com/bradygaster/squad/pull/2041) —
  automatic bootstrap, deterministic artifact pair, partial recovery, opt-out,
  and fail-closed ambiguity
- [bradygaster/squad#2043](https://github.com/bradygaster/squad/pull/2043) —
  bounded integrity-checked bootstrap payload transport
- [bradygaster/squad#2044](https://github.com/bradygaster/squad/pull/2044) —
  canonical research artifact, focused-research preservation, and triage
  continuity
- [`workflows/shared/squad-bootstrap-validator.mjs`](https://github.com/bradygaster/squad/blob/main/workflows/shared/squad-bootstrap-validator.mjs)
  — canonical identifiers, validation, and recovery classification
