# Squadcaster

Squadcaster is a read-only, user-wide operations canvas for repositories using
[Squad](https://github.com/bradygaster/squad). It correlates Squad goals with
their GitHub issues, pull requests, workflow runs, checks, owners, blockers, and
structured planning artifacts.

The installed Squad workflows remain responsible for creating and coordinating
the team. Squadcaster observes the GitHub-native evidence they produce; it does
not start work, edit Squad configuration, merge pull requests, or bypass branch
protection.

## Read-only boundary

Squadcaster never creates or edits GitHub issues, posts Squad commands, installs
or changes workflows, creates branches or pull requests, edits `.squad`
configuration or charters, plans or executes missions, changes task ownership,
or modifies repository settings.

The dashboard only writes local Squadcaster preferences and cache state. Users
can include or exclude discovered repositories, request a refresh, and change
in-browser filters. GitHub and repository content remain read-only.

## What the canvas shows

- A compact **Factory Mission Control** summary with tracked, in-progress, attention, and delivery counts
- A **Factory floor** lifecycle for queued, researching, implementing, reviewing, and completed work
- Active workflow runs with repository identity, goal, branch, owner, status, timestamp, and source link
- A semantic recent-activity timeline and accessible goal-details drawer
- One combined view of every discovered Squad repository the authenticated user can read
- Progressive owner, repository, current-repository, status, active-work, and text filters
- Every discoverable issue carrying `squad`/`squad:*` labels, a Squad command, or structured Squad artifact
- Derived lifecycle state: queued, researching, implementing, reviewing, blocked, completed, or failed
- Squad member ownership from repository labels, with GitHub assignment fallback
- Pull requests linked by closing references or Squad's durable implementation marker and branch convention
- Actions runs correlated by issue or implementation branch
- Current checks, dependencies, next actions, and an expandable evidence timeline
- Partial-sync warnings while retaining the last known goal state when issue discovery is unavailable

Every conclusion links to its source on GitHub. Relationships inferred from
branch or run metadata are explicitly marked `inferred`; missing ownership and
other ambiguous data remain `Unknown`. The canvas follows the operating
system's light or dark color preference by default and uses semantic theme
tokens for both schemes.

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
to `127.0.0.1` on an ephemeral port.

If Squad is not detected, the canvas links to the Squad installation guidance.
Once installed, the repository-owned roster is shown as secondary operational
context. Use **Manage** to exclude repositories from refresh and totals, and
**Refresh all** to force repository discovery and refresh included repositories.

## Discovery boundaries

Squadcaster discovers repositories through the authenticated user's owner,
collaborator, and organization-member affiliations. A repository is included
when it has a Squad workflow, roster, open `squad`/`squad:*` issue or pull
request, or searchable structured Squad artifact. Prefix-label and artifact
fallbacks are scoped to each affiliated repository. Prefix discovery caches its
last conclusive result, pages label definitions, and checks exact open-label
existence with a one-item request while respecting the REST core budget; it does
not use a capped global search or treat a failed probe as a negative result.
Squadcaster reads up to 1,000 issues and pull requests per included repository;
Actions runs are refreshed for the current repository and repositories with
active work.

Independent GitHub sources are fetched separately, so a permissions or
rate-limit failure in one source does not discard data from the others. Failed
sources retain their last-known evidence while successful sources continue to
update, and the canvas labels the combined result as partial or stale. Refresh
attempts are shown separately from the last fully successful synchronization;
stale or partial data never advances the successful timestamp.
Non-current repository rosters are fetched from `.squad/team.md` by discovered
blob OID and cached in the user registry. Unchanged OIDs reuse the cached roster;
changed OIDs reload it, while malformed or inaccessible replacements retain the
last valid roster and surface a visible stale-source error.
When either the GraphQL or REST core rate-limit budget is low, background
refresh pauses until the limiting budgets reset
while the current repository continues refreshing.

See [the operations architecture](docs/operations-architecture.md) for the
normalized model, correlation rules, adapter boundary, and compatibility notes.
See [the optional implementation handoff design](docs/optional-handoff-design.md)
for the recommended gated path from activated Squad tasks to local Copilot
sessions, Copilot cloud agent, or `/squad implement`. The current product
remains read-only; that document does not enable mutation.
The
[automatic-bootstrap observability decision](docs/automatic-bootstrap-observability.md)
defines the fail-closed state model for Squad's deterministic Cast pull request,
research-proposals issue, workflow attempts, and downstream research-to-
activation journey.
The future Squad implementation-session integration is explicitly gated by the
[provenance consumer contract](docs/session-provenance-consumer-contract.md);
Squadcaster does not derive session identity from existing GitHub evidence.

## Development

Configure the package proxy, restore dependencies, and run the complete syntax,
unit, and browser regression suite:

```bash
npm config set registry "https://packagefeedproxy.microsoft.io/npm/"
npm install
npm run test:all
```

## How it is organized

- `activity-model.mjs` — normalized goals, lifecycle derivation, and evidence correlation
- `github-activity.mjs` — read-only GitHub/Squad discovery adapter
- `global-activity.mjs` — user-wide registry, discovery, adaptive refresh, and aggregation
- `squad-roster.mjs` — shared local and remote Squad roster parsing and normalization
- `extension.mjs` — canvas provider, persistence, refresh, and legacy storage migration
- `persisted-state.mjs` — safe normalization of current and legacy persisted state
- `renderer.mjs` — responsive operations dashboard
- `test/` — model and degraded-source tests using Node's built-in test runner
- `copilot-extension.json` — extension install and share manifest

## License

[MIT](LICENSE)
