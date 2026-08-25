# Squadcaster

Squadcaster is a GitHub Copilot canvas for building the repository-specific Squad a project needs.

It analyzes the active repository, proposes a cast with explicit responsibilities and charters, lets the user refine that cast conversationally, and guides onboarding through two reviewed pull requests:

1. Install GitHub Agentic Workflows and the Squad workflows.
2. Create a casting issue from the approved team and run `/squad cast`.

Squadcaster also preserves the resulting roster for charter refinement and mission planning after onboarding.

## Install

Install this repository as a user- or project-scoped Copilot extension, reload extensions, then open the `squadcaster` canvas from a Copilot project session.

The extension:

- binds its HTTP server to `127.0.0.1`;
- stores drafts in durable canvas artifacts keyed by repository path;
- never merges pull requests;
- uses the latest `@dev` Squad workflow distribution;
- requires GitHub CLI authentication to create and monitor GitHub artifacts.

## Files

- `extension.mjs` — canvas provider, persistence, GitHub operations, and agent tools.
- `renderer.mjs` — responsive onboarding and team-management interface.
- `copilot-extension.json` — install/share manifest.

## License

MIT
