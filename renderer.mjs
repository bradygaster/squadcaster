export function renderHtml() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Squadcaster</title>
  <style>
    :root {
      --bg: var(--background-color-default, #ffffff);
      --surface: var(--background-color-default, #ffffff);
      --soft: color-mix(in srgb, var(--text-color-default, #1f2328) 5%, var(--background-color-default, #ffffff));
      --soft-strong: color-mix(in srgb, var(--text-color-default, #1f2328) 10%, var(--background-color-default, #ffffff));
      --border: var(--border-color-default, #d0d7de);
      --border-strong: color-mix(in srgb, var(--text-color-default, #1f2328) 42%, var(--background-color-default, #ffffff));
      --text: var(--text-color-default, #1f2328);
      --muted: var(--text-color-muted, #656d76);
      --focus: var(--color-focus-outline, #0969da);
      --accent: var(--true-color-red, #b4234d);
      --accent-soft: var(--true-color-red-muted, color-mix(in srgb, var(--accent) 12%, var(--bg)));
      --success: var(--true-color-green, #1a7f37);
      --warning: var(--true-color-yellow, #9a6700);
      --danger: var(--true-color-red, #cf222e);
      --sans: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      --mono: var(--font-mono, "SFMono-Regular", Consolas, monospace);
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: var(--text-body-medium, 14px);
      line-height: var(--leading-body-medium, 20px);
    }
    button, input, textarea, select { font: inherit; }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, a:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
    .shell { min-height: 100vh; }
    .topbar {
      min-height: 58px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 18px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    .brand, .repo, .actions {
      display: flex;
      align-items: center;
    }
    .brand { gap: 9px; font-weight: var(--font-weight-semibold, 600); }
    .mark {
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      background: var(--accent);
      color: var(--color-white, #ffffff);
      font-weight: 800;
    }
    .repo { min-width: 0; gap: 8px; color: var(--muted); font-size: var(--text-body-small, 12px); }
    .repo strong {
      overflow: hidden;
      color: var(--text);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mode {
      padding: 3px 7px;
      border: 1px solid var(--border);
      border-radius: 999px;
      white-space: nowrap;
    }
    main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 38px 0 64px;
    }
    h1 {
      max-width: 760px;
      margin: 0;
      font-family: var(--font-sans-display, var(--sans));
      font-size: clamp(32px, 5vw, var(--text-display-medium, 48px));
      line-height: 1.05;
      letter-spacing: -.035em;
      text-wrap: balance;
    }
    h2, h3 { margin: 0; font-weight: var(--font-weight-semibold, 600); }
    h2 { font-size: var(--text-title-medium, 20px); }
    h3 { font-size: var(--text-body-large, 15px); }
    .lede {
      max-width: 700px;
      margin: 16px 0 0;
      color: var(--muted);
      font-size: var(--text-body-large, 16px);
      line-height: 1.55;
    }
    .hero-actions { margin-top: 24px; }
    .button {
      min-height: 38px;
      padding: 0 13px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      font-weight: var(--font-weight-semibold, 600);
    }
    .button:hover { border-color: var(--border-strong); }
    .button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: var(--color-white, #ffffff);
    }
    .button.primary:hover { filter: brightness(.94); }
    .button.danger { border-color: var(--danger); color: var(--danger); }
    .button:disabled { cursor: wait; opacity: .62; }
    .actions { flex-wrap: wrap; gap: 8px; }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg);
      color: var(--text);
    }
    input, select { height: 38px; padding: 0 10px; }
    textarea { min-height: 120px; padding: 9px 10px; resize: vertical; line-height: 1.45; }
    .help { margin: 5px 0 0; color: var(--muted); font-size: 11px; }
    .empty {
      padding: 56px 24px;
      border: 1px dashed var(--border-strong);
      border-radius: 12px;
      text-align: center;
    }
    .empty h1 { margin: 0 auto; }
    .empty p { max-width: 620px; margin: 14px auto 0; color: var(--muted); }
    .error-text { color: var(--danger); }
    .ops-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
    }
    .refresh-status { color: var(--muted); font-size: var(--text-body-small, 12px); white-space: nowrap; }
    .refresh-status.warning { color: var(--warning); }
    .refresh-status span { display: block; color: var(--muted); }
    .metrics {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 10px;
      margin-top: 24px;
    }
    .metric {
      padding: 15px;
      border: 1px solid var(--border);
      border-radius: 11px;
      background: var(--surface);
    }
    .metric strong { display: block; font-size: 26px; line-height: 1.1; }
    .metric span { display: block; margin-top: 5px; color: var(--muted); font-size: 11px; }
    .metric.danger { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }
    .metric.warning { border-color: color-mix(in srgb, var(--warning) 55%, var(--border)); }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 25px 0 14px;
    }
    .filter {
      min-height: 34px;
      padding: 0 11px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      cursor: pointer;
    }
    .filter.selected { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
    .scope-controls {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) minmax(220px, 2fr) auto;
      gap: 10px;
      align-items: end;
      margin-top: 24px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 11px;
      background: var(--soft);
    }
    .scope-controls label { color: var(--muted); font-size: 11px; }
    .scope-controls label span { display: block; margin-bottom: 5px; font-weight: 600; }
    .scope-actions { display: flex; gap: 8px; align-items: center; }
    .toggle { display: inline-flex; gap: 7px; align-items: center; margin-top: 10px; color: var(--muted); }
    .toggle input { width: auto; height: auto; }
    .manage-list {
      display: grid;
      gap: 7px;
      max-height: 320px;
      margin-top: 12px;
      overflow: auto;
    }
    .manage-repository {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 9px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }
    .manage-repository input { width: auto; height: auto; }
    .manage-repository small { color: var(--muted); }
    .current-repository { box-shadow: inset 3px 0 0 var(--accent); }
    .goal-list { display: grid; gap: 12px; }
    .goal-card {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 13px;
      background: var(--surface);
    }
    .goal-card.blocked, .goal-card.failed { border-color: var(--danger); }
    .goal-main { padding: 17px 18px; }
    .goal-topline {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
    }
    .goal-title { min-width: 0; }
    .goal-title a { color: var(--text); text-decoration: none; }
    .goal-title a:hover { color: var(--focus); text-decoration: underline; }
    .goal-title p { margin: 5px 0 0; color: var(--muted); font-size: var(--text-body-small, 12px); }
    .phase {
      flex: 0 0 auto;
      padding: 4px 8px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--soft);
      font-size: 11px;
      font-weight: 700;
      text-transform: capitalize;
    }
    .phase.blocked, .phase.failed { border-color: var(--danger); color: var(--danger); }
    .phase.completed { border-color: var(--success); color: var(--success); }
    .phase.reviewing { border-color: var(--warning); color: var(--warning); }
    .goal-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 7px 18px;
      margin-top: 13px;
      color: var(--muted);
      font-size: var(--text-body-small, 12px);
    }
    .next-step { margin: 13px 0 0; padding-top: 12px; border-top: 1px solid var(--border); }
    .next-step strong { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .next-step span { margin-left: 7px; color: var(--muted); }
    .blockers { margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, var(--danger) 8%, var(--bg)); }
    .blockers strong { color: var(--danger); }
    .blockers a { color: var(--focus); }
    .goal-details { border-top: 1px solid var(--border); }
    .goal-details > summary { padding: 11px 18px; color: var(--focus); cursor: pointer; font-weight: 600; }
    .goal-details-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, .65fr); gap: 22px; padding: 4px 18px 18px; }
    .timeline { margin: 0; padding: 0; list-style: none; }
    .timeline li { position: relative; padding: 0 0 14px 20px; border-left: 1px solid var(--border); }
    .timeline li:last-child { padding-bottom: 0; }
    .timeline li::before {
      content: "";
      position: absolute;
      top: 5px;
      left: -4px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent);
    }
    .timeline a { color: var(--focus); font-weight: 600; }
    .timeline small { display: block; margin-top: 2px; color: var(--muted); }
    .artifact-list { display: grid; gap: 7px; }
    .artifact {
      padding: 9px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: var(--text-body-small, 12px);
    }
    .artifact a { color: var(--focus); }
    .sync-warning {
      margin-top: 16px;
      padding: 12px 14px;
      border: 1px solid var(--warning);
      border-radius: 9px;
      background: color-mix(in srgb, var(--warning) 8%, var(--bg));
    }
    .sync-warning p { margin: 4px 0 0; color: var(--muted); }
    .repository-sync { color: var(--muted); }
    .repository-sync.warning { color: var(--warning); }
    .repository-error { color: var(--danger); }
    .secondary {
      margin-top: 30px;
      padding: 17px 18px;
      border: 1px solid var(--border);
      border-radius: 11px;
      background: var(--soft);
    }
    .secondary summary { cursor: pointer; font-weight: 600; }
    .secondary-content { margin-top: 14px; color: var(--muted); }
    .roster { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .roster span { padding: 5px 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); }
    @media (max-width: 800px) {
      .topbar { align-items: flex-start; flex-direction: column; }
      main { width: min(100% - 24px, 680px); padding-top: 26px; }
      .ops-heading { display: block; }
      .refresh-status { margin-top: 8px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .scope-controls { grid-template-columns: 1fr; }
      .goal-details-body { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span class="mark">SC</span><span>Squadcaster</span></div>
      <div class="repo" id="repo-header"></div>
    </header>
    <main id="app" aria-live="polite"></main>
  </div>
  <script>
    let state = null;
    let localError = "";
    let phaseFilter = "all";
    let repositoryFilter = "all";
    let ownerFilter = "all";
    let goalSearch = "";
    let activeRepositoriesOnly = false;
    let showRepositoryManager = false;
    let refreshingAll = false;

    const app = document.getElementById("app");
    const repoHeader = document.getElementById("repo-header");

    function esc(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    async function post(url, body = {}) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request failed.");
      return result;
    }

    function updateHeader() {
      if (!state?.repoName) {
        repoHeader.innerHTML = '<span class="mode">No project</span>';
        return;
      }
      const active = state.activity?.summary?.active || 0;
      const repositories = (state.activity?.repositories || []).filter(repository => repository.included).length;
      const mode = active ? \`\${active} active goal\${active === 1 ? "" : "s"}\` : "Operations";
      repoHeader.innerHTML = \`<strong>All Squads</strong><span class="mode">\${repositories} repos · \${mode}</span>\`;
    }

    function formatTime(value) {
      if (!value) return "time unknown";
      const date = new Date(value);
      if (Number.isNaN(date.valueOf())) return "time unknown";
      const seconds = Math.max(0, Math.round((Date.now() - date.valueOf()) / 1000));
      if (seconds < 60) return "just now";
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return \`\${minutes}m ago\`;
      const hours = Math.floor(minutes / 60);
      if (hours < 48) return \`\${hours}h ago\`;
      return \`\${Math.floor(hours / 24)}d ago\`;
    }

    function metricHtml(value, label, tone = "") {
      return \`<div class="metric \${tone}"><strong>\${esc(value)}</strong><span>\${esc(label)}</span></div>\`;
    }

    function goalMatchesFilter(goal) {
      if (phaseFilter === "all") return true;
      if (phaseFilter === "active") return goal.phase !== "completed";
      return goal.phase === phaseFilter;
    }

    function goalMatchesScope(goal) {
      const repository = String(goal.repository?.nameWithOwner || "");
      if (repositoryFilter === "current" && repository.toLowerCase() !== String(state.activity?.currentRepository || "").toLowerCase()) return false;
      if (!["all", "current"].includes(repositoryFilter) && repository !== repositoryFilter) return false;
      if (ownerFilter !== "all" && repository.split("/")[0] !== ownerFilter) return false;
      if (activeRepositoriesOnly) {
        const hasActiveWork = (state.activity?.goals || []).some(candidate =>
          candidate.phase !== "completed" &&
          candidate.repository?.nameWithOwner === repository);
        if (!hasActiveWork) return false;
      }
      const query = goalSearch.trim().toLowerCase();
      if (!query) return true;
      return [
        goal.issue?.title,
        goal.issue?.number,
        goal.owner?.name,
        repository,
      ].some(value => String(value || "").toLowerCase().includes(query));
    }

    function timelineHtml(goal) {
      if (!goal.evidence?.length) return '<p class="help">No correlated evidence is available yet.</p>';
      return \`
        <ol class="timeline">
          \${goal.evidence.map(item => \`
            <li>
              <a href="\${esc(item.url || goal.issue.url)}" target="_blank" rel="noreferrer">\${esc(item.title)}</a>
              <small>\${esc(item.kind)} · \${esc(formatTime(item.timestamp))} · \${esc(item.confidence || "observed")}</small>
            </li>\`).join("")}
        </ol>\`;
    }

    function relatedArtifactsHtml(goal) {
      const links = [
        ...goal.pullRequests.map(item => ({
          title: \`PR #\${item.number} · \${item.state}\`,
          url: item.url
        })),
        ...goal.workflowRuns.map(item => ({
          title: \`\${item.workflow} · \${item.conclusion || item.status}\`,
          url: item.url
        }))
      ];
      if (!links.length) return '<p class="help">No pull request or workflow run has been correlated yet.</p>';
      return \`<div class="artifact-list">\${links.map(item => \`
        <div class="artifact"><a href="\${esc(item.url)}" target="_blank" rel="noreferrer">\${esc(item.title)}</a></div>
      \`).join("")}</div>\`;
    }

    function goalCardHtml(goal) {
      return \`
        <article class="goal-card \${esc(goal.phase)} \${String(goal.repository.nameWithOwner).toLowerCase() === String(state.activity?.currentRepository || "").toLowerCase() ? "current-repository" : ""}">
          <div class="goal-main">
            <div class="goal-topline">
              <div class="goal-title">
                <h2><a href="\${esc(goal.issue.url)}" target="_blank" rel="noreferrer">#\${esc(goal.issue.number)} · \${esc(goal.issue.title)}</a></h2>
                <p>\${esc(goal.repository.nameWithOwner || state.repoName)}</p>
              </div>
              <span class="phase \${esc(goal.phase)}">\${esc(goal.phase)}</span>
            </div>
            <div class="goal-meta">
              <span><strong>Owner:</strong> \${esc(goal.owner?.name || "Unknown")}</span>
              <span><strong>Updated:</strong> \${esc(formatTime(goal.updatedAt))}</span>
              <span><strong>PRs:</strong> \${esc(goal.pullRequests.length)}</span>
              <span><strong>Runs:</strong> \${esc(goal.workflowRuns.length)}</span>
            </div>
            \${goal.blockers?.length ? \`
              <div class="blockers"><strong>Blocked by:</strong> \${goal.blockers.map(blocker =>
                '<a href="' + esc(blocker.url) + '" target="_blank" rel="noreferrer">#' + esc(blocker.issueNumber) + " " + esc(blocker.title) + "</a>"
              ).join(", ")}</div>\` : ""}
            <p class="next-step"><strong>Next</strong><span>\${esc(goal.nextAction || "Unknown — inspect the linked issue.")}</span></p>
          </div>
          <details class="goal-details">
            <summary>Evidence timeline and related activity</summary>
            <div class="goal-details-body">
              <section><h3>Timeline</h3><div style="margin-top:12px">\${timelineHtml(goal)}</div></section>
              <section><h3>Related activity</h3><div style="margin-top:12px">\${relatedArtifactsHtml(goal)}</div></section>
            </div>
          </details>
        </article>\`;
    }

    function squadContextHtml() {
      const installed = Boolean(state.squad?.installed);
      return \`
        <details class="secondary">
          <summary>Squad configuration · \${installed ? "Installed" : "Not detected"}</summary>
          <div class="secondary-content">
            \${installed
              ? \`<p>Squad workflows and repository-owned configuration are operational context. This canvas does not modify them.</p>
                  <div class="roster">\${state.members.length
                    ? state.members.map(member => '<span>' + esc(member.name) + " · " + esc(member.role) + "</span>").join("")
                    : "<span>Roster unavailable</span>"}</div>\`
              : \`<p>No local Squad workflow or roster was detected. Install the current Squad workflows, then refresh this canvas.</p>
                  <p><a href="https://github.com/bradygaster/squad" target="_blank" rel="noreferrer">Open Squad installation guidance ↗</a></p>\`}
          </div>
        </details>\`;
    }

    function repositoryControlsHtml() {
      const repositories = (state.activity?.repositories || []).filter(repository => repository.included);
      const owners = [...new Set(repositories.map(repository => repository.owner).filter(Boolean))].sort();
      return \`
        <section class="scope-controls" aria-label="Repository and goal filters">
          <label><span>Owner or organization</span>
            <select data-action="owner-filter">
              <option value="all">All owners</option>
              \${owners.map(owner => '<option value="' + esc(owner) + '"' + (ownerFilter === owner ? " selected" : "") + ">" + esc(owner) + "</option>").join("")}
            </select>
          </label>
          <label><span>Repository</span>
            <select data-action="repository-filter">
              <option value="all">All repositories</option>
              <option value="current" \${repositoryFilter === "current" ? "selected" : ""}>Current repository</option>
              \${repositories.map(repository => '<option value="' + esc(repository.nameWithOwner) + '"' + (repositoryFilter === repository.nameWithOwner ? " selected" : "") + ">" + esc(repository.nameWithOwner) + "</option>").join("")}
            </select>
          </label>
          <label><span>Search goals</span>
            <input data-action="goal-search" value="\${esc(goalSearch)}" placeholder="Issue, goal, owner, or repository">
          </label>
          <div class="scope-actions">
            <button class="button" data-action="manage-repositories" type="button">Manage</button>
            <button class="button" data-action="refresh-all" type="button" \${refreshingAll ? "disabled" : ""}>\${refreshingAll ? "Refreshing…" : "Refresh all"}</button>
          </div>
        </section>
        <label class="toggle"><input data-action="active-repositories" type="checkbox" \${activeRepositoriesOnly ? "checked" : ""}> Only repositories with active work</label>
        \${showRepositoryManager ? repositoryManagerHtml() : ""}\`;
    }

    function repositoryManagerHtml() {
      const repositories = state.activity?.repositories || [];
      return \`
        <details class="secondary" open>
          <summary>Manage discovered Squad repositories</summary>
          <div class="secondary-content">
            <p>Excluded repositories remain visible here but are not refreshed or included in totals.</p>
            <div class="manage-list">
              \${repositories.map(repository => \`
                <label class="manage-repository">
                  <input data-action="repository-included" data-repository="\${esc(repository.nameWithOwner)}" type="checkbox" \${repository.included ? "checked" : ""}>
                  <span><strong>\${esc(repository.nameWithOwner)}</strong><br>\${repositorySyncHtml(repository)}</span>
                  <small>\${repository.nameWithOwner.toLowerCase() === String(state.activity?.currentRepository || "").toLowerCase() ? "Current" : repository.permission || ""}</small>
                </label>\`).join("")}
            </div>
          </div>
        </details>\`;
    }

    function repositorySyncHtml(repository) {
      const attempted = formatTime(repository.lastAttemptedRefresh);
      const successful = formatTime(repository.lastSuccessfulRefresh);
      if (repository.partial || repository.stale || repository.error) {
        return \`<small class="repository-sync warning">Partial refresh attempted \${esc(attempted)} · last fully synced \${esc(successful)}</small>\${repository.error
          ? \`<br><small class="repository-error">\${esc(repository.error)}</small>\`
          : ""}\`;
      }
      return \`<small class="repository-sync">\${repository.lastSuccessfulRefresh
        ? "Synced " + esc(successful)
        : repository.lastAttemptedRefresh
          ? "Refresh attempted " + esc(attempted) + " · not fully synced yet"
          : "Not synced yet"}</small>\`;
    }

    function aggregateSyncHtml(activity) {
      const attempted = formatTime(activity.lastAttemptedRefresh || activity.fetchedAt);
      const successful = formatTime(activity.lastSuccessfulRefresh);
      if (activity.partial || activity.stale) {
        return \`<div class="refresh-status warning">Partial refresh · attempted \${esc(attempted)}<span>\${activity.lastSuccessfulRefresh
          ? "Last fully synced " + esc(successful)
          : "No complete sync yet"}</span></div>\`;
      }
      return \`<div class="refresh-status">Synced · \${esc(successful || attempted)}</div>\`;
    }

    function activeHtml() {
      const activity = state.activity || {};
      const summary = activity.summary || {};
      const goals = (activity.goals || []).filter(goalMatchesFilter).filter(goalMatchesScope);
      const filters = ["active", "blocked", "failed", "reviewing", "completed", "all"];
      return \`
        <section>
          <div class="ops-heading">
            <div>
              <h1>All Squads</h1>
              <p class="lede">\${esc((activity.repositories || []).filter(repository => repository.included).length)} repositories\${activity.viewer ? " for @" + esc(activity.viewer) : ""} · opened from \${esc(activity.currentRepository || state.repoName)}. Live, read-only visibility from GitHub evidence.</p>
            </div>
            \${aggregateSyncHtml(activity)}
          </div>
          <div class="metrics">
            \${metricHtml(summary.active || 0, "Active goals")}
            \${metricHtml(summary.blocked || 0, "Blocked", summary.blocked ? "danger" : "")}
            \${metricHtml(summary.failed || 0, "Failed", summary.failed ? "danger" : "")}
            \${metricHtml(summary.awaitingReview || 0, "Awaiting review", summary.awaitingReview ? "warning" : "")}
            \${metricHtml(summary.implementing || 0, "Implementing")}
            \${metricHtml(summary.researching || 0, "Researching")}
            \${metricHtml(summary.completed || 0, "Completed")}
          </div>
          \${activity.partial || activity.stale || activity.errors?.length ? \`
            <div class="sync-warning"><strong>Some GitHub data is from an earlier sync.</strong>
              <p>Showing the latest available data. Totals and activity may be incomplete until every source refreshes successfully.</p>
              \${(activity.errors || []).map(error => '<p>' + esc(error.source) + ": " + esc(error.message) + "</p>").join("")}
            </div>\` : ""}
          \${localError ? \`<div class="sync-warning"><strong>Squadcaster could not complete the local request.</strong><p>\${esc(localError)}</p></div>\` : ""}
          \${repositoryControlsHtml()}
          <div class="filters" aria-label="Filter goals by status">
            \${filters.map(filter => \`<button class="filter \${phaseFilter === filter ? "selected" : ""}" data-action="phase-filter" data-phase="\${filter}" type="button">\${esc(filter)}</button>\`).join("")}
          </div>
          <div class="goal-list">
            \${goals.length ? goals.map(goalCardHtml).join("") : \`
              <section class="empty">
                <h2>\${phaseFilter === "all" ? "No goals found." : "No " + esc(phaseFilter) + " goals found."}</h2>
                <p>Squadcaster recognizes issues carrying <code>squad</code> or <code>squad:*</code> labels, Squad commands, or structured Squad artifacts.</p>
              </section>\`}
          </div>
          \${squadContextHtml()}
        </section>\`;
    }

    function render() {
      updateHeader();
      if (!state) {
        app.innerHTML = '<p>Loading Squadcaster…</p>';
        return;
      }
      if (state.mode === "unavailable") {
        app.innerHTML = \`
          <section class="empty">
            <h1>Open Squadcaster from a project session.</h1>
            <p>The canvas needs the app’s active repository worktree. Open or create a Copilot project session, then launch Squadcaster again.</p>
          </section>\`;
        return;
      }
      app.innerHTML = activeHtml();
    }

    async function refresh() {
      const response = await fetch("/api/state", { cache: "no-store" });
      state = await response.json();
      render();
    }

    document.addEventListener("click", async event => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      try {
        localError = "";
        if (action === "phase-filter") {
          phaseFilter = target.dataset.phase || "active";
          render();
        } else if (action === "manage-repositories") {
          showRepositoryManager = !showRepositoryManager;
          render();
        } else if (action === "refresh-all") {
          refreshingAll = true;
          render();
          try {
            await post("/api/refresh");
          } finally {
            refreshingAll = false;
            render();
          }
        }
      } catch (error) {
        localError = error.message;
        render();
      }
    });

    document.addEventListener("change", async event => {
      const action = event.target.dataset.action;
      if (action === "owner-filter") {
        ownerFilter = event.target.value;
        repositoryFilter = "all";
        render();
        return;
      }
      if (action === "repository-filter") {
        repositoryFilter = event.target.value;
        render();
        return;
      }
      if (action === "active-repositories") {
        activeRepositoriesOnly = event.target.checked;
        render();
        return;
      }
      if (action === "repository-included") {
        try {
          await post("/api/repositories", {
            nameWithOwner: event.target.dataset.repository,
            included: event.target.checked
          });
        } catch (error) {
          localError = error.message;
          render();
        }
      }
    });

    document.addEventListener("input", event => {
      if (event.target.dataset.action !== "goal-search") return;
      goalSearch = event.target.value;
      const cursor = event.target.selectionStart;
      render();
      const input = document.querySelector('[data-action="goal-search"]');
      if (input) {
        input.focus();
        input.setSelectionRange(cursor, cursor);
      }
    });

    const events = new EventSource("/events");
    events.addEventListener("state", event => {
      state = JSON.parse(event.data);
      render();
    });
    events.onerror = () => {
      localError = "Canvas connection interrupted. Reopen Squadcaster to reconnect.";
      if (state) render();
    };

    refresh();
    setInterval(() => {
      refresh().catch(error => console.error("Unable to refresh Squadcaster state.", error));
    }, 15000);
  </script>
</body>
</html>`;
}
