# Squadcaster

Squadcaster is a read-only, user-wide operations canvas for repositories using
[Squad](https://github.com/bradygaster/squad). It correlates Squad goals with
their GitHub issues, pull requests, workflow runs, checks, owners, blockers, and
structured planning artifacts.

The installed Squad workflows remain responsible for creating and coordinating
the team. Squadcaster observes the GitHub-native evidence they produce; it does
not start work, edit Squad configuration, merge pull requests, or bypass branch
protection.

## What the canvas shows

- Summary counts for active, blocked, failed, awaiting-review, and completed goals
- A lifecycle pipeline for queued, researching, implementing, reviewing, and completed goals, with blocked and failed work separated as exception states
- A recent-activity stream built from correlated issue, artifact, pull-request, workflow-run, and check evidence
- Expandable lifecycle stages and a keyboard-accessible goal details drawer
- One combined view of every discovered Squad repository the authenticated user can read
- Owner, repository, current-repository, status, active-work, and text filters
- Every discoverable issue carrying `squad`/`squad:*` labels, a Squad command, or structured Squad artifact
- Derived lifecycle state: queued, researching, implementing, reviewing, blocked, completed, or failed
- Squad member ownership from repository labels, with GitHub assignment fallback
- Pull requests linked by closing references or Squad's durable implementation marker and branch convention
- Actions runs correlated by issue or implementation branch
- Current checks, dependencies, next actions, and an expandable evidence timeline
- Partial-sync warnings while retaining the last known goal state when issue discovery is unavailable

Every conclusion links to its source on GitHub. Relationships inferred from
branch or run metadata are explicitly marked `inferred`; missing ownership and
other ambiguous data remain `Unknown`.

## Install

### Prerequisites

- GitHub Copilot with canvas extensions and an active project session for a Git repository
- [Git](https://git-scm.com/) and [GitHub CLI](https://cli.github.com/)
- An authenticated GitHub CLI session (`gh auth status`)

### Ask Copilot to install it

```text
Install the Copilot extension from https://github.com/bradygaster/squadcaster/tree/main at user scope. Reload extensions from disk, then open the `squadcaster` canvas for my active project session.
```

### Install it manually

```bash
mkdir -p "${COPILOT_HOME:-$HOME/.copilot}/extensions"
git clone https://github.com/bradygaster/squadcaster.git \
  "${COPILOT_HOME:-$HOME/.copilot}/extensions/squadcaster"
```

`COPILOT_HOME` defaults to `~/.copilot`. After cloning, ask Copilot:

```text
Reload extensions from disk, then open the `squadcaster` canvas for my active project session.
```

## Use it

Open a repository in a Copilot project session, then open the `squadcaster`
canvas. The repository is highlighted as the current context, but the default
view is **All Squads** across every discovered repository. The canvas uses the
authenticated GitHub CLI to refresh the current repository every 15 seconds,
active repositories every minute, and inactive repositories every ten minutes.
Repository discovery refreshes every fifteen minutes. The browser remains bound
to `127.0.0.1` on an ephemeral port. The canvas follows the operating system's
light or dark color preference by default and uses the host canvas semantic
theme tokens when available.

If Squad is not detected, the canvas links to the Squad installation guidance.
Once installed, the repository-owned roster is shown as secondary operational
context. Use **Manage** to exclude repositories from refresh and totals, and
**Refresh all** to force repository discovery and refresh included repositories.

## Discovery boundaries

Squadcaster discovers repositories through the authenticated user's owner,
collaborator, and organization-member affiliations. A repository is included
when it has a Squad workflow, roster, open `squad` issue/PR, or searchable
structured Squad artifact. It reads up to 1,000 issues and pull requests per
included repository; Actions runs are refreshed for the current repository and
repositories with active work.

Independent GitHub sources are fetched separately, so a permissions or
rate-limit failure in one source does not discard data from the others. If issue
discovery fails, the canvas keeps and labels the last known snapshot as stale.
When the GraphQL rate-limit budget is low, background refresh pauses until reset
while the current repository continues refreshing.

See [the operations architecture](docs/operations-architecture.md) for the
normalized model, correlation rules, adapter boundary, and CAO findings.

## Development

The project has no package-manager dependency or build step. Validate it with:

```bash
node --check activity-model.mjs
node --check github-activity.mjs
node --check global-activity.mjs
node --check extension.mjs
node --check renderer.mjs
node --test test/*.test.mjs
```

## How it is organized

- `activity-model.mjs` — normalized goals, lifecycle derivation, and evidence correlation
- `github-activity.mjs` — read-only GitHub/Squad discovery adapter
- `global-activity.mjs` — user-wide registry, discovery, adaptive refresh, and aggregation
- `extension.mjs` — canvas provider, persistence, refresh, and legacy tool compatibility
- `renderer.mjs` — responsive operations dashboard
- `test/` — model and degraded-source tests using Node's built-in test runner
- `copilot-extension.json` — extension install and share manifest

## License

[MIT](LICENSE)
