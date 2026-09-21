# Squad operations architecture

## Activity contract

`activity-model.mjs` produces a versioned repository snapshot:

- `repository`: GitHub identity, URL, and default branch
- `summary`: active, blocked, failed, awaiting-review, and completed counts
- `goals`: issue-backed intents with lifecycle, owner, work items, blockers,
  artifacts, pull requests, workflow runs, next action, and evidence
- `errors`: source-specific discovery failures

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

The repository used to open the canvas is refreshed every 10 seconds. Other
repositories with active work refresh every minute, and inactive repositories
refresh every ten minutes. Repository discovery runs every fifteen minutes.
Actions are queried for the current repository and repositories already known
to have active work. A low GraphQL rate-limit budget pauses background refresh
until reset while preserving current-repository refresh and cached state.

Users may include or exclude discovered repositories locally. Aggregation does
not weaken GitHub permissions: only repositories readable through the active
`gh` identity can appear. Each evidence item retains its repository URL and
states whether the relationship is observed or inferred.

Dependencies support local issue numbers, `owner/repository#number`, and full
GitHub issue URLs. The aggregate resolves these references against goals in
other included repositories. Missing or excluded targets remain visible with an
unknown state instead of being treated as complete.

## CAO compatibility findings

Research on September 20, 2026 found that GitHub Agentic Workflows remain
repository-local, stored as a source `.md` file plus compiled `.lock.yml`.
Organization and enterprise custom agents can be centralized, with repository
definitions taking precedence, but workflow definitions still need to exist in
each downstream repository. This supports a hybrid model:

1. centralize reusable agent identities and capabilities;
2. inject or update reviewable workflow files in each participating repository;
3. aggregate their GitHub-native evidence in Squadcaster.

Squadcaster deliberately does not depend on a CAO-specific protocol yet. The
`gh.io/cao` short URL could not be resolved in the research environment, so no
undocumented contract is assumed. The adapter boundary allows a verified CAO
event source to be added later without changing the dashboard model.

### Squad in the wizard

Squad should be offered as a reusable team option wherever CAO or `gh aw`
presents repository setup:

1. **Catalog entry:** list Squad as a maintained workflow bundle with its
   dispatcher, implementation worker, and independent reviewer shown before
   installation.
2. **Repository-aware recommendation:** when a repository has no Squad
   workflows, offer Squad alongside the standard workflow choices; when it is
   already installed, offer update or connect rather than duplicate setup.
3. **Deployment choice:** let the user choose repository-owned agents or
   organization-provided agent profiles while making clear that workflow source
   and lock files remain repository-local.
4. **Reviewable output:** have the wizard create one pull request containing
   pinned workflow sources and compiled lock files. Never write directly to the
   default branch or merge the pull request.
5. **Handoff:** after installation, link directly to this operations canvas so
   the user moves from configuration to observable goals and evidence.

Until the CAO wizard exposes a verified extension or catalog contract, these
remain integration requirements rather than a custom protocol implemented by
Squadcaster. A future wizard adapter should emit the selected repository,
workflow version/SHA, deployment mode, and resulting pull request URL using the
same repository identity consumed by the activity adapter.

Authoritative references consulted:

- [About GitHub Agentic Workflows](https://docs.github.com/en/copilot/concepts/agents/about-github-agentic-workflows)
- [Creating GitHub Agentic Workflows](https://docs.github.com/en/copilot/how-tos/github-agentic-workflows/creating-github-agentic-workflows)
- [About custom agents](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-custom-agents)
- [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [About the Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)

## Security and failure behavior

- Discovery is read-only.
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
