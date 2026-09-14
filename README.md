# Squadcaster

Squadcaster analyzes the active repository, proposes the smallest useful Squad, lets you reshape that team conversationally, and then guides two reviewed pull requests: one for automation and one for the approved cast. You decide when GitHub artifacts are created, review every change, and merge each pull request yourself.

<p align="center">
  <img src="docs/images/squadcaster-02-proposal.png" alt="Squadcaster proposal for Spring PetClinic with repository findings and a four-member team" width="920">
</p>

## Install

### Prerequisites

- GitHub Copilot with canvas extensions and an active project session for a Git repository
- [Git](https://git-scm.com/) and [GitHub CLI](https://cli.github.com/)
- An authenticated GitHub CLI session (`gh auth status`)

### Ask Copilot to install it

Paste this into Copilot:

```text
Install the Copilot extension from https://github.com/bradygaster/squadcaster/tree/main at user scope. Reload extensions from disk, then open the `squadcaster` canvas for my active project session.
```

### Install it manually

Clone the extension into your Copilot extensions directory:

```bash
mkdir -p "${COPILOT_HOME:-$HOME/.copilot}/extensions"
git clone https://github.com/bradygaster/squadcaster.git \
  "${COPILOT_HOME:-$HOME/.copilot}/extensions/squadcaster"
```

`COPILOT_HOME` defaults to `~/.copilot`. After cloning, ask Copilot:

```text
Reload extensions from disk, then open the `squadcaster` canvas for my active project session.
```

## Cast and enlist a repository

Open the repository in a Copilot project session, then paste:

```text
Open the `squadcaster` canvas for this active project session. Connect it to the current repository, analyze the repository, and propose the smallest useful Squad. Do not create any GitHub issue or pull request until I review and explicitly confirm the proposal.
```

1. **Analyze and shape the team.** Squadcaster reads code, tests, documentation, build structure, and ownership signals without changing the repository. Review the evidence and charters, then split, combine, add, remove, or edit specialist roles. Local drafts remain local.
2. **Confirm automation PR 1 of 2.** The confirmation authorizes the exact Actions permission change and the bootstrap PR described below. It does not authorize a merge or any other repository setting change.
3. **Review and merge the automation PR.** Squadcaster requests `@copilot` review and watches checks. The workflows on that branch are inactive: `/squad` becomes available only after the complete PR reaches the default branch.
4. **Confirm the cast issue.** Squadcaster creates one issue containing the approved roster and charters and posts `/squad cast`.
5. **Review and merge cast PR 2 of 2.** Squad generates the repository-owned team, routing, charters, casting history, Copilot agent, and `meet-the-squad.md`. Human review and merge remain mandatory.

## Automation PR contract

Squadcaster resolves the target `owner/repo` and default branch at runtime, verifies `gh` and `gh aw`, and keeps `default_workflow_permissions=read`. Only after the user confirms automation creation does it enable **Allow GitHub Actions to create and approve pull requests** for that repository.

### Clean enlistment versus upgrade

| Repository state | Supported operation |
| --- | --- |
| None of the six Squad `.md` or `.lock.yml` files exists | Add all six workflows in dispatcher-first order from the moving `@dev` channel, without `--force`. |
| Any Squad source or lock exists, including a partial install | Resolve the `dev` head once as a 40-character `SQUAD_SHA`, preserve repository-owned source customizations, and replace all six sources together with `gh aw add ...@${SQUAD_SHA} --force`. Do not use `gh aw update`. |

An upgrade also refreshes these four shared resources from the same immutable `SQUAD_SHA`:

- `.github/workflows/shared/squad.md`
- `.github/workflows/shared/squad-cast-validator.mjs`
- `.github/workflows/shared/squad-planning-ontology.md`
- `.github/workflows/shared/squad-planning-policy.md`

This single-revision rule prevents dispatcher, workers, validation, and planning policy from drifting. Repository-owned changes may be reapplied to workflow source files only when they can be preserved safely. Generated `.lock.yml` files are deterministic build output and must never be customized by hand.

### Compile and review gates

- A safe-update warning is approved only when its complete contents are exactly `SQUAD_GITHUB_APP_PRIVATE_KEY`, `SQUAD_GITHUB_TOKEN`, and `bradygaster/squad/.github/actions/squad-init`. The secrets are optional references, not enlistment prerequisites. Any additional entry stops the operation for human review.
- The conditional approval command is `gh aw compile --strict --approve`. It is used only to accept that exact report. The final compile is always a separate `gh aw compile --strict` without `--approve`.
- All six workflows must compile. The only accepted warning is the documented `squad.md` combination of slash-command and `github-actions[bot]` triggers; any other warning or error stops the operation.
- All six source/lock pairs must exist and every lock must name the expected ref: `@dev` for a clean install or the same `@${SQUAD_SHA}` for an upgrade.
- Lockfiles are scanned for JSON-escaped operators such as `\u0026`, `\u003c`, and `\u003e` inside `${{ ... }}` expressions. GitHub rejects those expressions before jobs start even when strict compilation succeeds.
- Staging is limited to `.gitattributes`, `.github/aw/`, `.github/workflows/`, and `.github/skills/`, with no deletions. Downloaded `.github/aw/logs/**` diagnostics and optional `.vscode/settings.json` are excluded; only the logs directory's ignore-all/keep-`.gitignore` rule may be committed.
- Squadcaster opens the PR against the resolved default branch, requests `@copilot`, watches required checks, and stops. It never marks the PR approved, bypasses protection, enables auto-merge, or merges it.

See the authoritative [Squad GitHub Agentic Workflows guide](https://bradygaster.github.io/squad/docs/guide/gh-aw/) for the executable enlistment commands and recovery procedures.

## The six workflows

| Workflow | Responsibility |
| --- | --- |
| `squad` | Dispatcher and user command surface. Casts and manages teams, runs research and planning, authorizes mutating lifecycle commands, and relays typed work to isolated workers. |
| `squad-implement-worker` | Implements one ready issue or the next ready epic wave in an isolated branch and opens a draft PR. It reuses existing linked PRs instead of duplicating rejected or completed work. |
| `squad-deps-worker` | Resolves bounded dependency-maintenance work separately from general implementation, under the same provenance and draft-only constraints. |
| `squad-review` | Independently reviews the current PR head and posts an advisory `COMMENT` or `REQUEST_CHANGES`. It does not edit, approve, merge, or replace human review. |
| `squad-retro` | Collects bounded workflow and review evidence, publishes reports, and creates action or governance-proposal issues. It does not edit the repository or merge changes. |
| `squad-improvement-worker` | Dormant until an exact governance proposal revision and path set is approved by a human with write, maintain, or admin permission. It applies only that approved patch and opens one draft PR. |

The cast contains repository-specific specialists only. **Scribe**, **Ralph**, **Rai**, and **Fact Checker** are built-in support identities supplied by Squad, while `@copilot` is the independent PR reviewer; none is counted as a cast specialist, mission owner, or routing destination.

## Working with the Squad

### Recommended lifecycle

```text
/squad research
/squad plan
/squad activate
```

`research` posts evidence without creating issues or PRs. `plan` combines program structure and PR-sized implementation planning. `activate` reviews and accepts the latest fast plan, then creates its GitHub issues; because it mutates GitHub, the actor must have write, maintain, or admin permission. Use `/squad activate phase N` to activate incrementally. `/squad plan accept` and `/squad plan accept phase N` are supported legacy aliases for the corresponding `activate` commands.

### Granular lifecycle

For larger or cross-team work, keep the review gates separate:

```text
/squad research
/squad triage
/squad plan program
/squad plan accept scope
/squad plan implementation
/squad plan validate
/squad plan accept implementation [phase N]
/squad plan activate [phase N]
```

Triage classifies findings as work, decisions, or exclusions. Scope acceptance locks initiatives, epics, and milestones before implementation decomposition. Implementation acceptance approves PR-sized tasks; activation is the terminal mutation that creates issues. `/squad plan` is the fast alias for program plus implementation planning, while `/squad activate` combines the acceptance and activation gates. Squad posts a lifecycle-state comment with the current state, last command, next action, and valid alternatives after each step.

Use `/squad implement` on a ready issue or epic and `/squad review` on its PR. Use `/squad retro` for an authorized retrospective. Governance improvements require a new, unedited `/squad approve-improvement` comment containing the exact `Approved-Revision:` hash and each `Approved-Path:`; `/squad revoke-improvement` withdraws that authority.

Run the lightweight workflow contract suite with:

```bash
node --test test/squad-contract.test.mjs
```

## Persistence and trust boundaries

- **Local before confirmation:** proposals and drafts are stored in local extension or session artifact storage, keyed by a hash of the repository path. The renderer listens only on `127.0.0.1` at an ephemeral port.
- **Explicit mutation scope:** each canvas confirmation names the GitHub mutation it authorizes. Automation confirmation covers the read-only-token Actions permission change and bootstrap PR; later confirmations separately cover cast, charter, or mission artifacts.
- **Structured handoffs:** the dispatcher sends typed, structured-data envelopes with nested issue, PR, approval-comment, and provenance fields. Workers validate the expected event, repository, default branch, source ref or PR merge ref, actor, permissions, and live GitHub objects rather than trusting prompt text or marker-shaped prose.
- **Fail closed:** missing, malformed, duplicated, stale, edited, unauthorized, off-ref, or incompletely scanned inputs produce a visible refusal or no-op. They never fall back to broader authority or a success-shaped result.
- **Draft-only work:** implementation, dependency, and approved-improvement workers create draft PRs. They do not mark them ready, approve them, review their own output, or merge them.
- **Human control:** reviews are advisory, safe-output acceptance is not proof that GitHub applied a mutation, and every PR remains subject to normal Copilot review, repository checks, branch protection, and a human merge decision.

## How it is organized

- `extension.mjs` — canvas provider, persistence, GitHub operations, and agent tools
- `renderer.mjs` — responsive onboarding and team-management interface
- `copilot-extension.json` — extension install and share manifest

## License

[MIT](LICENSE)
