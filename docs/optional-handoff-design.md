# Optional implementation handoff design

## Decision

Squadcaster should support an optional handoff from an activated Squad task to
an implementation mechanism, but it should not add mutation behavior until the
read-only model can prove that the task is ready and reconcile work that already
exists.

The minimum viable sequence is:

1. Extend the normalized read-only contract with activation provenance,
   acceptance criteria, implementation readiness, and known implementation
   bindings.
2. Show that contract in the existing goal drawer, including why an issue is or
   is not ready and links to existing work.
3. Add one explicitly confirmed, per-issue handoff mechanism at a time behind a
   host capability and repository-policy check.

Batch mutation is out of scope for the minimum viable handoff. Squadcaster may
offer batch filtering, readiness review, and context export without starting
work. It must never start implementation merely because Squad activated an
issue.

## Existing source contract

Squadcaster's normalized activity snapshot already provides the stable identity
and most of the reconciliation evidence needed for a handoff:

- `goal.id` is the repository-qualified issue identity.
- `goal.issue` carries the issue number, body, state, labels, timestamps, and
  source URL.
- `goal.dependencies` and `goal.blockers` preserve repository-qualified issue
  references.
- `goal.artifacts` preserves the Squad artifact kind, schema version, origin
  issue, phase list, timestamp, and comment URL.
- `goal.pullRequests` and `goal.workflowRuns` correlate existing implementation
  by GitHub closing references, Squad's durable implementation marker, and the
  `squad/implement-{issue}-*` branch convention.
- `goal.evidence` records whether a relationship was observed or inferred.

The current goal drawer exposes the issue, owner, lifecycle, dependencies,
pull requests, checks, workflow runs, and evidence. It is the correct place for
per-issue readiness and handoff controls; a separate mutation dashboard would
duplicate identity and reconciliation logic.

The existing contract is not sufficient to launch safely:

- Structured artifact parsing only retains the small `squad_artifact` envelope.
  It does not retain human-readable acceptance criteria or the mandatory
  `Activation bindings:` JSON block.
- An activated child task must be correlated to the accepted root plan through
  a resolved activation binding. A `squad` label alone is not activation
  provenance.
- Copilot project sessions are not GitHub objects and therefore need a local,
  user-scoped binding overlay rather than synthetic GitHub evidence.
- A partial or stale issues, pull requests, or workflow snapshot cannot prove
  that duplicate implementation does not exist.

## Minimum viable handoff contract

The read-only activity model should add a `handoff` object to each goal. This is
derived state, not a new source of truth.

```json
{
  "schemaVersion": 1,
  "goalId": "owner/repository#123",
  "readiness": {
    "state": "ready",
    "reasons": [],
    "evaluatedAt": "2026-09-21T20:00:00Z",
    "automatedHandoffAvailable": true,
    "sourceStates": {
      "issue": "complete",
      "issueAssignees": "complete",
      "subIssues": "complete",
      "dependencies": "complete",
      "pullRequests": "complete",
      "workflowRuns": "complete",
      "copilotTasks": "complete",
      "localSessions": "complete"
    }
  },
  "activation": {
    "rootIssue": "owner/repository#100",
    "artifactKind": "activated",
    "artifactUrl": "https://github.com/owner/repository/issues/100#issuecomment-1",
    "schemaVersion": "1",
    "task": "3",
    "issue": "owner/repository#123",
    "epic": "2.1",
    "epicIssue": "owner/repository#110",
    "agent": "Kint",
    "epicAgents": ["kint"],
    "label": "squad:kint",
    "epicLabel": "squad:kint"
  },
  "acceptanceCriteria": [
    {
      "text": "The dashboard reports a blocked dependency.",
      "sourceUrl": "https://github.com/owner/repository/issues/123"
    }
  ],
  "acceptanceCriteriaComplete": true,
  "issueRevision": "2026-09-21T19:58:00Z",
  "existingImplementation": {
    "state": "none",
    "pullRequests": [],
    "workflowRuns": [],
    "sessions": []
  },
  "mechanisms": [
    {
      "kind": "local-session",
      "availability": "available",
      "reasons": []
    },
    {
      "kind": "copilot-cloud-agent",
      "availability": "policy-blocked",
      "reasons": ["Copilot cloud agent is disabled for this repository."]
    },
    {
      "kind": "squad-implement",
      "availability": "available",
      "reasons": []
    },
    {
      "kind": "manual",
      "availability": "available",
      "reasons": []
    }
  ]
}
```

### Activation provenance

Squad activation artifacts are `activated`, `phases-activated`,
`plan-accepted`, or `phases-accepted`, with `schema_version: "1"` and the
triggering `origin_issue`. Their comment bodies contain a mandatory, non-empty
`Activation bindings:` JSON array. Each binding maps the accepted plan task and
agent assignment to the created or reused task issue and epic issue.

The complete provenance tuple is the artifact envelope's origin issue, the
binding's task, task issue, epic, epic issue, agent and labels, plus the task
issue's declared dependencies. Dependencies are issue state, not an invented
field in the binding JSON.

Squadcaster should parse a binding only when:

- the structured artifact envelope is recognized;
- the binding block is valid JSON and non-empty;
- `issue` and `epic_issue` are resolved `#<number>` references, not unresolved
  `#aw_*` temporary references;
- the task issue exists in the same repository and its identity matches exactly;
- the artifact URL and root issue remain available as source links.

Malformed, unresolved, ambiguous, or duplicate bindings make readiness
`unknown`, never `ready`. Squadcaster should preserve the raw source link and a
specific reason rather than repairing the artifact.

### Acceptance criteria

The task issue remains the implementation authority. Acceptance criteria should
be extracted conservatively from an `Acceptance criteria`, `Acceptance
Criteria`, or `Success Criteria` section in the task issue body. The original
body and URL remain authoritative.

No criteria, an empty section, or a truncated/unavailable issue body makes an
automated handoff ineligible. Manual open/copy actions remain available.
Squadcaster must not generate criteria or substitute parent-plan prose.

Extraction must happen from the adapter's untruncated issue response before the
existing display-oriented body limit is applied. The normalized handoff
contract carries `acceptanceCriteriaComplete` and the issue revision used for
extraction. A consumer must not infer completeness from the length of
`goal.issue.body`.

### Readiness states

| State | Meaning |
| --- | --- |
| `ready` | The task is an open activated leaf, is unblocked, has acceptance criteria, has complete fresh reconciliation data, and has no active implementation. |
| `blocked` | At least one declared dependency is open or unknown. |
| `already-in-progress` | A correlated pull request, workflow run, cloud-agent assignment/task, or active local session exists. |
| `completed` | The issue is closed or correlated implementation is merged. |
| `ineligible` | Required activation provenance or acceptance criteria is absent, or the issue is not an open leaf task. |
| `unknown` | A source is stale, partial, unavailable, malformed, ambiguous, or otherwise cannot prove readiness. |

`ready` requires all of the following:

1. Exact repository and issue identity is known.
2. The issue is open.
3. The issue is a leaf: it has no open sub-issues after native sub-issue
   relationships and the supported parent/body fallback are evaluated.
4. A trusted activation binding resolves to this issue.
5. At least one acceptance criterion is present and the criteria source is
   complete.
6. Every dependency is complete.
7. Every enabled reconciliation source is complete and fresh.
8. No correlated active or completed implementation requires reconciliation.

Unknown is fail-closed. A transient discovery failure must not turn
`already-in-progress`, `blocked`, or `unknown` into `ready`.

Issue readiness is independent of mechanism availability. Each mutating
mechanism has its own capability, permission, and policy state. The contract's
`automatedHandoffAvailable` is true only when task readiness is `ready` and at
least one mutating mechanism is available. Manual open/copy is always a
navigation fallback and does not make automated handoff available.

### Source completeness

Freshness is not completeness. Before a goal can become `ready`, each source
used by an enabled mechanism must report whether its query was exhaustive:

- issues include the full body, assignees, parent, and sub-issue state;
- issue comments are paginated far enough to find every structured planning and
  activation artifact;
- dependencies are read in batches and every referenced issue resolves to a
  fresh observed state;
- pull requests are paginated or queried by exact closing/branch identity with
  truncation detection;
- workflow runs include every candidate for the exact issue and recognized
  branch identities;
- Copilot assignments and agent tasks are queryable when the cloud mechanism is
  enabled;
- the app-local session registry is readable when the local mechanism is
  enabled.

The existing 1,000-item adapter caps are adequate for dashboard display but are
not proof that no older implementation exists. A capped, truncated, timed-out,
or otherwise non-exhaustive result sets that source to `incomplete` and task
readiness to `unknown`.

Artifact comments and correlated pull requests should be cached by immutable
identity and revision. Dependency reads should be batched per repository.
Mechanism-specific availability probes should be lazy: run them when the drawer
opens or the user selects Handoff, not during every user-wide dashboard refresh.

## Implementation mechanisms

| Mechanism | What it creates | Durable authority | Minimum preflight | Reconciliation behavior |
| --- | --- | --- | --- | --- |
| Local Copilot project session | A local app session and checkout/worktree | Issue plus a local user-scoped session binding | Repository is configured locally; the host supports an issue-linked session; workspace creation is available | Open the bound session when it exists. Never create a second active session without a separate explicit override. |
| Copilot cloud agent | A GitHub-hosted agent task/branch and optionally one pull request | GitHub issue assignment/task, agent session, branch, and pull request | Paid feature and repository policy enabled; Copilot is a suggested assignable actor; user-to-server authorization has required metadata, Actions, contents, issues, and pull-request access; base branch is allowed | Prefer assigning the existing issue so identity remains durable. Open the existing task or PR when present. Do not use an unlinked direct prompt for the MVP. |
| `/squad implement` | A Squad workflow dispatch that can open one draft pull request | Issue, Actions run, `squad/implement-*` branch, closing reference, and `squad:implement` marker | Installed worker on the default branch; Actions and Copilot requests enabled; caller can dispatch; issue is open; dependencies are complete | Respect the worker's existing-run and existing-PR guards. Link the run or PR instead of dispatching again. |
| Manual | No agent or repository mutation | GitHub issue | Issue is readable | Open the issue or copy a lossless context package. |

These mechanisms are alternatives, not escalation stages. Selecting one never
silently reroutes to another.

### Local session

The host application already has primitives to create or open an issue-linked
project session with a repository checkout and a kickoff prompt. The handoff
should pass a compact context package containing:

- repository-qualified issue identity and URL;
- issue title and unmodified acceptance criteria;
- dependency identities and their observed states;
- root activation artifact and binding links;
- existing PR and workflow links;
- the explicit instruction not to change scope or begin unrelated tasks.

Creating the local session changes local app state, not GitHub state. Work
inside that session may later create commits or a pull request, but those are
separate agent actions governed by that session's normal confirmation and
permissions.

The local binding registry should contain only stable identifiers and links:
`goalId`, project/session ID, app URL, created time, last observed status, and
the handoff contract version. It must not copy GitHub issue or PR state.
Squad currently has no authoritative schema for local Copilot session IDs, so
this binding is explicitly Squadcaster/app-local and must never be written back
as a competing execution record in a Squad artifact.

### Copilot cloud agent

GitHub supports issue assignment with an optional agent assignment containing
the target repository, base branch, custom instructions, custom agent, and
model. It also exposes public-preview agent-task APIs and `gh agent-task`
commands.

The MVP should use issue assignment rather than an unlinked direct agent task:
the issue is already the durable Squad task, assignment is queryable, and the
resulting branch and pull request can be correlated back to the issue. The
handoff must add Copilot without replacing human assignees.

A `squad:copilot` label proves only that the accepted plan routed the task to
the special Copilot owner. It does not prove that the assignment workflow is
installed, that Copilot cloud agent is enabled, or that Copilot is actually
assigned. Applying or changing that label may itself trigger repository
automation that assigns Copilot, so any label mutation is a launch operation
and requires the same explicit confirmation. The MVP should not mutate labels;
it should query actual assignable actors and issue assignees.

Squadcaster must first verify that `copilot-swe-agent` is returned by the
repository's assignable actors and that organization/repository policy permits
the operation. Server-to-server tokens are not supported by the agent-task API,
so the operation must use the interactive user's authorization or a host-owned
user-to-server capability.

Cloud-agent limitations should appear in confirmation: one repository, one
branch at a time, at most one pull request per task, GitHub Actions and AI-credit
usage, repository rule compatibility, and the configured execution timeout.

### `/squad implement`

The installed Squad worker accepts an issue number through
`workflow_dispatch`. It re-reads the issue, stops on closed issues or open
dependencies, checks for an existing pull request, routes using Squad labels,
implements the smallest complete change satisfying every acceptance criterion,
and opens at most one draft pull request.

Squadcaster should dispatch the repository's locked `squad` entry workflow with
`command=implement` and the exact issue number, not invoke the worker by
inventing a separate protocol. The resulting Actions run, draft pull request,
closing reference, branch prefix, and provenance marker remain the durable
evidence.

The command is unavailable when the required workflow is absent, disabled, or
unreadable. Squadcaster must not install or update Squad as part of handoff.

The recognized Squad implementation identity is the combined evidence of an
exact task issue, a draft pull request whose head is
`squad/implement-{issue}-{slug}`, a `Closes #<issue>` reference, and the exact
standalone `<!-- squad:implement issue=<issue> run=<run> -->` provenance marker.
The branch or label alone is insufficient.

## Existing work reconciliation

Reconciliation runs before the confirmation is shown and again immediately
before mutation.

| Observed state | UX and behavior |
| --- | --- |
| Open or draft correlated PR | Primary action becomes **Open pull request**. No launch action. |
| Active correlated workflow run | Primary action becomes **Open workflow run**. No launch action. |
| Copilot is assigned or a cloud task is active | Primary action becomes **Open Copilot session**. No new assignment/task. |
| Active local session binding | Primary action becomes **Open local session**. No new session. |
| Merged PR or closed issue | Show completed; no launch action. |
| Closed, unmerged PR | Show the attempt and explain that GitHub evidence alone cannot distinguish rejection, abandonment, or supersession. A retry is not part of the MVP and requires a later explicit design. |
| Multiple candidate PRs, runs, or sessions | Show a conflict with all links; disable launch until the user resolves it. |
| Stale or partial source | Show unknown; disable launch and offer refresh. |

The GitHub snapshot remains authoritative for GitHub objects. The local session
registry is an overlay keyed by exact `goalId`; it must not manufacture pull
request, run, issue, or lifecycle facts. Reconciliation uses the existing
GitHub issue, run, branch, and pull-request identities rather than creating a
parallel Squadcaster execution record.

## Idempotency and concurrency

Every mutation adapter must implement the same operation protocol:

1. Compute a stable key from handoff contract version, mechanism, repository
   identity, and issue identity.
2. Acquire a per-key local operation lock.
3. Refresh and re-evaluate readiness.
4. Reconcile an existing result before creating anything.
5. Submit exactly one operation.
6. Persist only the returned resource identifier or an explicit
   `outcome-unknown` receipt.
7. Refresh read-only state and return the observed result.

If the request times out after submission, Squadcaster records
`outcome-unknown` and reconciles before allowing retry. It must not report
success without an observed session, assignment/task, workflow run, or pull
request.

Mechanism-specific guarantees remain in force:

- Local sessions reuse the exact active `goalId` binding.
- Cloud assignment is idempotent when Copilot is already assigned with a
  matching target repository/base branch; mismatched assignment parameters are
  a conflict, not an update.
- Squad's concurrency and duplicate-PR guards are defense in depth, not a
  substitute for Squadcaster's preflight.

## Goal drawer UX

Add a **Handoff** section after dependencies and before delivery activity.

The section contains:

1. A readiness badge and plain-language reasons.
2. Activation provenance with links to the root issue and artifact comment.
3. Acceptance criteria quoted from the task issue.
4. Existing implementation links.
5. Available mechanisms, each described by where it runs and what it can
   create.

Only one per-issue action may be selected. The default action is **Open issue**
until the user explicitly chooses an implementation mechanism.

Selecting a mutating mechanism opens a confirmation dialog. The dialog must
show:

- exact repository and issue;
- mechanism and execution location;
- base branch when applicable;
- acceptance criteria and dependency summary;
- existing-work reconciliation result;
- every mutation that will occur;
- required permissions and relevant policy/cost warnings;
- a clear statement that no merge is automatic.

The final button uses the concrete operation, such as **Create local session**,
**Assign Copilot**, or **Dispatch `/squad implement`**. There is no persistent
"do not ask again" option. Closing the dialog makes no change.

The adapter repeats preflight after confirmation. If state changed, it cancels
the operation and displays the new observed state.

## Per-issue and batch behavior

The minimum viable handoff is per issue. This matches the exact issue identity,
one-branch/one-pull-request cloud-agent constraints, Squad's issue-number
dispatch, and the need to inspect acceptance criteria before delegation.

The dashboard may support non-mutating batch actions:

- filter to ready tasks;
- select tasks for comparison;
- export or copy context packages;
- open source issues in sequence.

Batch launch is deferred. A future batch design must provide an itemized preview,
bounded selection, repository grouping, one result per issue, partial-failure
reporting, cancellation semantics, and no transactional claim across independent
GitHub operations.

## Failure states

| Failure | Required behavior |
| --- | --- |
| Activation binding is missing, empty, malformed, unresolved, or ambiguous | Disable launch, link the artifact, and identify the contract error. |
| Acceptance criteria are missing | Disable automated mechanisms; keep manual open/copy. |
| Dependency is open or unknown | Disable launch and link every blocker. |
| GitHub source is partial, stale, rate limited, or unauthorized | Disable launch, preserve last-known evidence as stale, and offer refresh. |
| Repository policy or feature availability blocks a mechanism | Keep task readiness unchanged, disable only that mechanism, and show the policy reason. |
| Permission preflight fails | Make no mutation and name the missing permission/capability. |
| State changes after confirmation | Cancel and show the newly observed issue, PR, run, or session. |
| Submission fails before an identifier is returned | Report failure; retain no success-shaped binding. |
| Submission outcome is unknown | Record an unknown receipt, disable retry, and reconcile. |
| Result cannot be correlated to the issue | Report a handoff error and provide the returned resource link; do not synthesize implementation state. |
| Multiple existing implementations are found | Disable launch and require manual resolution. |

## Security and policy boundary

- The current provider, HTTP routes, and canvas actions remain read-only until a
  separately approved implementation adds a host-mediated adapter.
- The renderer must never receive GitHub tokens or invoke `gh` directly.
- Mutation adapters must use structured arguments, not shell interpolation.
- The user-wide repository inclusion setting does not grant write permission.
- Repository, organization, and enterprise policy may force manual-only mode.
- Handoff must not install workflows, change settings, bypass branch
  protection, replace assignees, merge pull requests, or write acceptance
  artifacts.
- Context passed to an implementation mechanism is bounded to source-linked
  issue and activation data; untrusted issue content remains data, not control
  instructions.
- Audit output records the actor, time, mechanism, exact goal identity,
  confirmation, and returned resource identifier without storing credentials.

## Acceptance criteria for implementation

The optional handoff is complete only when:

- every launchable goal has a resolved activation binding and extracted
  acceptance criteria;
- readiness fails closed for partial, stale, ambiguous, blocked, completed, or
  already-started work;
- the drawer explains readiness and displays all source links;
- each mechanism performs capability, permission, policy, and duplicate-work
  preflight;
- each mutating operation requires an explicit per-issue confirmation and
  repeats preflight immediately afterward;
- repeated requests open or return the existing result rather than creating
  duplicate sessions, runs, branches, or pull requests;
- local session state is an overlay and GitHub remains the authority for
  issues, pull requests, runs, and Squad artifacts;
- errors never appear as success and unknown outcomes cannot be retried before
  reconciliation;
- no mechanism merges automatically or silently falls back to another
  mechanism;
- the existing read-only contract tests remain in place until the corresponding
  mutation slice is explicitly approved.

## Recommended implementation slices

1. **Read-only handoff normalization** — parse activation bindings and acceptance
   criteria, derive readiness, and add model tests for malformed, stale,
   blocked, existing-work, and ready states.
2. **Read-only drawer UX** — display readiness, provenance, criteria, mechanism
   availability, and manual context export with no launch route.
3. **Local session adapter** — add host-mediated create/open behavior, local
   bindings, explicit confirmation, idempotency, and failure recovery.
4. **Copilot cloud-agent adapter** — add issue-assignment preflight and
   confirmation only after supported user-to-server authorization and task
   reconciliation are available.
5. **Squad implement adapter** — add installed-workflow detection, confirmed
   dispatch, run reconciliation, and duplicate-defense tests.

Each mutating slice requires its own approval and must update the read-only
boundary documentation and tests to name the newly permitted operation. Batch
launch requires a separate design issue after per-issue telemetry demonstrates
that reconciliation and recovery are reliable.

## References

- [Squadcaster operations architecture](operations-architecture.md)
- [Squad planning ontology: artifact schemas, acceptance records, activation bindings, and registry](https://github.com/bradygaster/squad/blob/main/workflows/shared/squad-planning-ontology.md#37-acceptance-records)
- [Squad implementation worker: Gather Context readiness checks](https://github.com/bradygaster/squad/blob/main/workflows/squad-implement-worker.md#gather-context)
- [Squad implementation worker: pull-request identity and provenance](https://github.com/bradygaster/squad/blob/main/workflows/squad-implement-worker.md#open-pull-request)
- [Squad activation-binding deterministic checks](https://github.com/bradygaster/squad/blob/main/test/gh-aw-activation-artifact-integrity.test.ts)
- [About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- [Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)
- [Using Copilot cloud agent from GitHub CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-from-cli)
