export function boundedItems(items, limit) {
    const values = Array.isArray(items) ? items : [];
    const size = Number.isInteger(limit) && limit > 0 ? limit : values.length;
    return {
        items: values.slice(0, size),
        total: values.length,
        hidden: Math.max(0, values.length - size),
    };
}

export function compareFeedItems(left, right) {
    const valueOf = (item) => {
        const parsed = Date.parse(
            item?.timestamp || item?.updatedAt || item?.createdAt || item?.mergedAt || "",
        );
        return Number.isFinite(parsed) ? parsed : null;
    };
    const leftTimestamp = valueOf(left);
    const rightTimestamp = valueOf(right);
    if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
        return rightTimestamp - leftTimestamp;
    }
    if (leftTimestamp !== rightTimestamp) return leftTimestamp !== null ? -1 : 1;
    const identity = (item) => [
        item?.goal?.repository?.nameWithOwner,
        item?.goal?.id,
        item?.kind,
        item?.id,
        item?.workflow,
        item?.branch,
        item?.title,
        item?.name,
        item?.url,
        item?.status,
        item?.conclusion,
    ].map((value) => String(value ?? "").toLowerCase()).join("|");
    return identity(left).localeCompare(identity(right));
}

export function semanticFeedItems(items, identity) {
    const values = Array.isArray(items) ? items : [];
    const keyFor = typeof identity === "function"
        ? identity
        : (item) => [
            item?.kind,
            item?.title || item?.name || item?.workflow,
            item?.url,
            item?.goal?.id,
        ].map((value) => String(value ?? "").toLowerCase()).join("|");
    const unique = new Map();
    for (const item of [...values].sort(compareFeedItems)) {
        const key = String(keyFor(item) ?? "").toLowerCase();
        if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()].sort(compareFeedItems);
}

export function anchoredPagedItems(items, state, pageSize, identity) {
    const values = Array.isArray(items) ? items : [];
    const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 1;
    const keyFor = typeof identity === "function"
        ? identity
        : (item) => [
            item?.goal?.repository?.nameWithOwner,
            item?.goal?.id,
            item?.kind,
            item?.id,
            item?.title || item?.name || item?.workflow,
            item?.url,
        ].map((value) => String(value ?? "").toLowerCase()).join("|");
    const keys = values.map((item) => String(keyFor(item) ?? "").toLowerCase());
    const requested = state && typeof state === "object" ? state : {};
    let start = -1;
    let fixedEnd = null;
    if (values.length && requested.anchor) {
        start = keys.indexOf(String(requested.anchor).toLowerCase());
    }
    if (start < 0 && values.length && requested.endBefore) {
        const end = keys.indexOf(String(requested.endBefore).toLowerCase());
        start = end >= 0 ? Math.max(0, end - size) : -1;
        fixedEnd = end >= 0 ? end : null;
    }
    if (start < 0 && values.length && requested.visibleKeys?.length) {
        start = requested.visibleKeys
            .map((key) => keys.indexOf(String(key).toLowerCase()))
            .find((index) => index >= 0) ?? -1;
    }
    if (start < 0 && values.length && requested.beforeKey) {
        const before = keys.indexOf(String(requested.beforeKey).toLowerCase());
        start = before >= 0 ? before + 1 : -1;
    }
    if (start < 0 && values.length && requested.nextAnchor) {
        start = keys.indexOf(String(requested.nextAnchor).toLowerCase());
    }
    if (start < 0) start = Number.isInteger(requested.startIndex) ? requested.startIndex : 0;
    if (start >= values.length) {
        start = values.length ? Math.floor((values.length - 1) / size) * size : 0;
    }
    const end = Math.min(fixedEnd ?? start + size, values.length);
    const visibleKeys = keys.slice(start, end);
    return {
        items: values.slice(start, end),
        total: values.length,
        start: values.length ? start + 1 : 0,
        end,
        startIndex: start,
        anchor: visibleKeys[0] || "",
        beforeKey: start > 0 ? keys[start - 1] : "",
        visibleKeys,
        nextAnchor: end < values.length ? keys[end] : "",
        hasNewer: start > 0,
        hasOlder: end < values.length,
    };
}

export function describeActivityDelta(previous, next) {
    if (!previous?.goals || !next?.goals) return "";
    if (!previous.errors?.length && next.errors?.length) {
        return "GitHub activity refresh reported an error. Previously loaded data remains visible.";
    }
    const before = new Map(previous.goals.map((goal) => [goal.id, goal]));
    const previousRepositories = new Map((previous.repositories || [])
        .map((repository) => [repository.nameWithOwner, repository]));
    const newlyIncluded = new Set((next.repositories || [])
        .filter((repository) =>
            repository.included && previousRepositories.get(repository.nameWithOwner)?.included === false)
        .map((repository) => repository.nameWithOwner));
    const added = next.goals.filter((goal) =>
        !before.has(goal.id) && !newlyIncluded.has(goal.repository?.nameWithOwner));
    if (added.length) {
        return `${added.length} new goal${added.length === 1 ? "" : "s"} discovered.`;
    }
    const moved = next.goals.filter((goal) => {
        const prior = before.get(goal.id);
        return prior && prior.phase !== goal.phase;
    });
    if (!moved.length) return "";
    if (moved.length === 1) {
        const goal = moved[0];
        return `Goal #${goal.issue?.number || ""} moved to ${goal.phase}.`;
    }
    return `${moved.length} goals changed lifecycle stage.`;
}

export function describeDayBoundary(activity = {}) {
    const boundary = activity.dayBoundary;
    if (boundary?.kind !== "utc-server-day" || !boundary.snapshotDay) return "";
    const inputDays = [...new Set(
        (Array.isArray(activity.snapshotDays) ? activity.snapshotDays : [])
            .map((value) => String(value || ""))
            .filter(Boolean),
    )].sort();
    if (!inputDays.length || (inputDays.length === 1 && inputDays[0] === boundary.snapshotDay)) {
        return `UTC server day ${boundary.snapshotDay} (00:00–24:00 UTC)`;
    }
    const dataDays = inputDays.length === 1
        ? inputDays[0]
        : `${inputDays[0]}–${inputDays.at(-1)}`;
    return `UTC server-day data ${dataDays} (00:00–24:00 UTC) · aggregate observed ${boundary.snapshotDay}; refresh pending`;
}

export function renderHtml() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Factory Mission Control</title>
  <style>
    :root {
      color-scheme: light dark;
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
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: var(--background-color-default, #0d1117);
        --surface: var(--background-color-default, #161b22);
        --soft: color-mix(in srgb, var(--text-color-default, #e6edf3) 7%, var(--background-color-default, #0d1117));
        --soft-strong: color-mix(in srgb, var(--text-color-default, #e6edf3) 13%, var(--background-color-default, #0d1117));
        --border: var(--border-color-default, #30363d);
        --border-strong: color-mix(in srgb, var(--text-color-default, #e6edf3) 48%, var(--background-color-default, #0d1117));
        --text: var(--text-color-default, #e6edf3);
        --muted: var(--text-color-muted, #8b949e);
        --focus: var(--color-focus-outline, #58a6ff);
        --accent: var(--true-color-red, #ff7b9c);
        --accent-soft: var(--true-color-red-muted, color-mix(in srgb, var(--accent) 16%, var(--bg)));
        --success: var(--true-color-green, #56d364);
        --warning: var(--true-color-yellow, #e3b341);
        --danger: var(--true-color-red, #ff7b72);
      }
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
      min-height: 54px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
    }
    .brand, .repo, .actions, .member-heading, .status-line, .pr-result {
      display: flex;
      align-items: center;
    }
    .brand { gap: 9px; font-size: 18px; font-weight: 400; }
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
      width: min(1560px, calc(100% - 32px));
      margin: 0 auto;
      padding: 20px 0 44px;
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
      margin: 9px 0 0;
      color: var(--muted);
      font-size: var(--text-body-medium, 14px);
      line-height: 1.45;
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
    .ops-heading h1 { font-size: clamp(27px, 3.4vw, 36px); }
    .refresh-status { color: var(--muted); font-size: var(--text-body-small, 12px); white-space: nowrap; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 7px;
    }
    .metric {
      min-width: 0;
      min-height: 116px;
      padding: 14px 16px;
      border-right: 1px solid var(--border);
      background: var(--surface);
    }
    .metric:last-child { border-right: 0; }
    .metric-label { display: block; color: var(--muted); font-size: 12px; }
    .metric-value { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px; margin-top: 7px; }
    .metric-value strong { font-size: 24px; line-height: 1; font-weight: 500; font-variant-numeric: tabular-nums; }
    .metric-value small { color: var(--muted); font-size: 12px; }
    .metric-detail { display: block; margin-top: 17px; color: var(--muted); font-size: 12px; }
    .metric.danger .metric-value strong { color: var(--danger); }
    .metric.warning .metric-value strong { color: var(--warning); }
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
    .bootstrap-filter {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }
    .bootstrap-filter::before {
      content: "";
      width: 7px;
      height: 7px;
      border: 1px solid currentColor;
      border-radius: 50%;
      background: var(--surface);
    }
    .bootstrap-filter.selected::before { background: var(--accent); }
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
    .filter-disclosure {
      margin-top: 12px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--bg);
    }
    .filter-disclosure > summary {
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 14px;
      cursor: pointer;
      font-weight: var(--font-weight-semibold, 600);
    }
    .filter-summary { margin-left: auto; color: var(--muted); font-size: 11px; font-weight: 400; }
    .filter-summary { min-width: 0; overflow-wrap: anywhere; text-align: right; }
    .filter-disclosure .scope-controls { margin: 0; border: 0; border-top: 1px solid var(--border); border-radius: 0; }
    .filter-disclosure .filters { margin: 0; padding: 0 14px 14px; background: var(--soft); }
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
    .mission-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      gap: 24px;
      margin-top: 16px;
      align-items: start;
    }
    .mission-layout > * { min-width: 0; }
    .pipeline-panel, .activity-panel {
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--bg);
    }
    .panel-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 11px 14px;
      border-bottom: 1px solid var(--border);
      background: var(--soft);
    }
    .panel-header p { margin: 3px 0 0; color: var(--muted); font-size: 11px; }
    .floor-legend { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px 14px; color: var(--muted); font-size: 11px; }
    .floor-legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .legend-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); }
    .legend-dot.reviewing { background: var(--accent); }
    .legend-dot.completed { background: var(--success); }
    .pipeline-scroll {
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-color: var(--border) transparent;
    }
    .pipeline {
      display: grid;
      grid-template-columns: repeat(5, minmax(132px, 1fr));
      width: 100%;
      min-width: 760px;
      gap: 18px;
      padding: 18px 16px 22px;
    }
    .stage-card {
      position: relative;
      z-index: 1;
      min-width: 0;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--soft);
    }
    .stage-card:not(:last-child)::after {
      content: "";
      position: absolute;
      z-index: -1;
      top: 50%;
      left: 100%;
      width: 19px;
      border-top: 1px solid var(--border);
    }
    .stage-card.selected { border-color: var(--accent); background: var(--accent-soft); }
    .stage-button {
      width: 100%;
      min-height: 210px;
      display: block;
      padding: 15px 14px 13px;
      border: 0;
      background: transparent;
      color: var(--text);
      text-align: left;
      cursor: pointer;
    }
    .stage-heading { display: flex; align-items: center; gap: 8px; }
    .stage-heading strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-transform: capitalize; white-space: nowrap; }
    .stage-load { display: flex; align-items: baseline; gap: 7px; margin-top: 20px; }
    .stage-load b { color: var(--warning); font-size: 28px; line-height: 1; font-weight: 500; font-variant-numeric: tabular-nums; }
    .stage-load span { color: var(--muted); font-size: 12px; }
    .stage-agents {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-height: 38px;
      margin-top: 18px;
    }
    .agent-chip, .agent-more {
      width: 38px;
      height: 38px;
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      border: 1px solid var(--border-strong);
      border-radius: 7px;
      background: var(--bg);
      color: var(--text);
      font-size: 10px;
      font-weight: var(--font-weight-semibold, 600);
    }
    .agent-chip.tone-0 { border-color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, var(--bg)); }
    .agent-chip.tone-1 { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--bg)); }
    .agent-chip.tone-2 { border-color: var(--success); background: color-mix(in srgb, var(--success) 10%, var(--bg)); }
    .agent-chip.tone-3 { border-color: var(--focus); background: color-mix(in srgb, var(--focus) 10%, var(--bg)); }
    .agent-more { color: var(--muted); font-size: 11px; font-weight: 400; }
    .stage-foot {
      margin-top: 16px;
      color: var(--muted);
      font-size: 12px;
    }
    .stage-foot strong { color: var(--text); font-weight: var(--font-weight-semibold, 600); }
    .goal-trigger {
      width: 100%;
      min-width: 0;
      max-width: 100%;
      min-height: 76px;
      display: block;
      overflow: hidden;
      padding: 7px 8px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      text-align: left;
      cursor: pointer;
    }
    .goal-trigger:hover { border-color: var(--border-strong); }
    .goal-trigger strong {
      display: -webkit-box;
      overflow: hidden;
      overflow-wrap: anywhere;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      line-height: 1.35;
    }
    .goal-trigger small {
      display: block;
      overflow: hidden;
      margin-top: 5px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .stage-detail {
      padding: 14px;
      border-top: 1px solid var(--border);
    }
    .pipeline-footer {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 9px 14px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 11px;
    }
    .attention-panel {
      overflow: hidden;
      margin-top: 14px;
      border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
      border-radius: 7px;
      background: var(--bg);
    }
    .attention-lanes {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 14px;
    }
    .attention-count { flex: 0 0 auto; color: var(--muted); font-size: 12px; font-weight: 600; }
    .attention-lane {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--surface);
    }
    .attention-lane h3 {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: var(--danger);
      text-transform: capitalize;
    }
    .attention-goals { display: grid; gap: 8px; margin-top: 10px; }
    .bootstrap-summaries {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
      gap: 10px;
      margin: 14px 0;
    }
    .bootstrap-summary {
      min-width: 0;
      padding: 12px 13px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--surface);
    }
    .bootstrap-summary.attention { border-color: var(--danger); }
    .bootstrap-summary.warning { border-color: var(--warning); }
    .bootstrap-summary-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .bootstrap-summary-header strong, .bootstrap-summary p { overflow-wrap: anywhere; }
    .bootstrap-summary p { margin: 7px 0 0; color: var(--muted); font-size: 12px; }
    .bootstrap-summary-links { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 8px; }
    .bootstrap-summary a { color: var(--focus); font-size: 12px; font-weight: 600; }
    .bootstrap-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex: 0 0 auto;
      padding: 3px 7px;
      border: 1px solid var(--border);
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: capitalize;
    }
    .bootstrap-badge.delayed, .bootstrap-badge.partial, .bootstrap-badge.retried { border-color: var(--warning); color: var(--warning); }
    .bootstrap-badge.failed, .bootstrap-badge.ambiguous, .bootstrap-badge.malformed { border-color: var(--danger); color: var(--danger); }
    .bootstrap-badge.complete { border-color: var(--success); color: var(--success); }
    .bootstrap-badge.unknown, .bootstrap-badge.opted_out { color: var(--muted); }
    .evidence-label {
      display: inline-block;
      margin-left: 4px;
      padding: 0 4px;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .stage-detail-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .stage-detail-heading h3 { text-transform: capitalize; }
    .stage-goals { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 9px; margin-top: 12px; }
    .collection-note { margin: 12px 0 0; color: var(--muted); font-size: 11px; }
    .runs-panel {
      overflow: hidden;
      margin-top: 14px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--bg);
    }
    .run-list { margin: 0; padding: 0; list-style: none; }
    .run-row {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      min-height: 68px;
      padding: 11px 14px;
      border-top: 1px solid var(--border);
      color: var(--text);
      text-decoration: none;
    }
    .run-row:first-child { border-top: 0; }
    .run-row:hover { background: var(--soft); text-decoration: none; }
    .run-indicator {
      width: 15px;
      height: 15px;
      border: 2px dashed var(--warning);
      border-radius: 50%;
    }
    .run-main { min-width: 0; }
    .run-name {
      display: -webkit-box;
      overflow: hidden;
      overflow-wrap: anywhere;
      font-weight: var(--font-weight-semibold, 600);
      line-height: 18px;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .run-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 3px 7px;
      margin-top: 3px;
      color: var(--muted);
      font-size: 11px;
    }
    .run-repository {
      min-width: 0;
      color: var(--text);
      font-weight: var(--font-weight-semibold, 600);
      overflow-wrap: anywhere;
    }
    .run-branch {
      min-width: 0;
      padding: 0 5px;
      border-radius: 5px;
      background: color-mix(in srgb, var(--focus) 13%, var(--bg));
      color: var(--focus);
      font-family: var(--mono);
      overflow-wrap: anywhere;
    }
    .run-side { min-width: 112px; color: var(--muted); font-size: 11px; text-align: right; }
    .run-side strong { display: block; color: var(--warning); font-weight: var(--font-weight-semibold, 600); text-transform: capitalize; }
    .activity-panel { position: sticky; top: 14px; }
    .activity-stream { margin: 0; padding: 0; list-style: none; }
    .activity-item {
      position: relative;
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 11px;
      align-items: start;
      min-height: 66px;
      padding: 12px 14px;
      border-top: 1px solid var(--border);
    }
    .activity-item:first-child { border-top: 0; }
    .activity-item::before {
      content: "";
      position: absolute;
      z-index: 0;
      top: 0;
      bottom: 0;
      left: 30px;
      width: 2px;
      background: var(--border);
    }
    .activity-item:first-child::before { top: 28px; }
    .activity-item:last-child::before { bottom: calc(100% - 28px); }
    .activity-marker {
      position: relative;
      z-index: 1;
      display: grid;
      width: 32px;
      height: 32px;
      place-items: center;
      border-radius: 50%;
      color: var(--color-white, #fff);
    }
    .activity-marker svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
    .activity-marker.running {
      border: 2px solid var(--warning);
      background: color-mix(in srgb, var(--warning) 13%, var(--bg));
      box-shadow: 0 0 0 7px color-mix(in srgb, var(--warning) 13%, transparent);
      color: var(--warning);
    }
    .activity-marker.running svg { width: 16px; height: 16px; fill: currentColor; stroke: none; }
    .activity-marker.success { background: var(--success); }
    .activity-marker.failure { background: var(--danger); }
    .activity-marker.pull-request, .activity-marker.artifact { background: #8957e5; }
    .activity-marker.issue { background: var(--focus); }
    .activity-marker.owner { background: var(--accent); }
    .activity-item a {
      color: var(--text);
      font-weight: var(--font-weight-semibold, 600);
      overflow-wrap: anywhere;
      text-decoration: none;
    }
    .activity-item a:hover { color: var(--focus); text-decoration: underline; }
    .activity-item small { display: block; margin-top: 3px; color: var(--muted); }
    .feed-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid var(--border);
    }
    .feed-pagination {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .feed-page-status { color: var(--muted); font-size: 11px; }
    .activity-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
    }
    .activity-kind {
      min-height: 30px;
      padding: 0 9px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      cursor: pointer;
      font-size: 11px;
    }
    .activity-kind[aria-pressed="true"] {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--text);
    }
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
    .workflow-drilldown { display: grid; gap: 10px; }
    .workflow-job-run, .workflow-job {
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: var(--bg);
    }
    .workflow-job-run > header, .workflow-job > header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }
    .workflow-job-run header small, .workflow-job header small { color: var(--muted); }
    .workflow-jobs { display: grid; gap: 8px; margin-top: 9px; }
    .workflow-steps { margin: 8px 0 0; padding-left: 22px; color: var(--muted); }
    .workflow-steps li { padding: 2px 0; }
    .workflow-source-note { margin: 8px 0 0; color: var(--warning); }
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
      margin-top: 20px;
      padding: 17px 18px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--soft);
    }
    .secondary summary { cursor: pointer; font-weight: 600; }
    .secondary-content { margin-top: 14px; color: var(--muted); }
    .roster { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .roster span { padding: 5px 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); }
    .drawer-scrim {
      position: fixed;
      inset: 0;
      z-index: 20;
      background: color-mix(in srgb, #000 38%, transparent);
    }
    .goal-drawer {
      position: fixed;
      z-index: 21;
      top: 0;
      right: 0;
      width: min(520px, 92vw);
      height: 100dvh;
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--border);
      background: var(--surface);
      box-shadow: -10px 0 32px color-mix(in srgb, #000 18%, transparent);
    }
    .drawer-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--border);
      background: var(--soft);
    }
    .drawer-header > div { min-width: 0; }
    .drawer-header h2, .drawer-header p { overflow-wrap: anywhere; }
    .drawer-header p { margin: 5px 0 0; color: var(--muted); }
    .drawer-close { width: 44px; height: 44px; flex: 0 0 auto; padding: 0; }
    .drawer-body { overflow: auto; padding: 18px; }
    .drawer-section { padding: 16px 0; border-top: 1px solid var(--border); }
    .drawer-section:first-child { padding-top: 0; border-top: 0; }
    .drawer-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
    .drawer-fact { padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--soft); }
    .drawer-fact small, .drawer-fact strong { display: block; }
    .drawer-fact small { color: var(--muted); }
    .drawer-list { display: grid; gap: 8px; margin-top: 10px; }
    .drawer-item { padding: 10px; border: 1px solid var(--border); border-radius: 8px; }
    .drawer-item, .drawer-item a, .drawer-fact strong { min-width: 0; overflow-wrap: anywhere; }
    .drawer-item a { color: var(--focus); font-weight: var(--font-weight-semibold, 600); }
    .drawer-item small { display: block; margin-top: 3px; color: var(--muted); }
    .handoff-heading {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .readiness {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border: 2px solid var(--border-strong);
      border-radius: 999px;
      background: var(--soft);
      font-size: 11px;
      font-weight: 700;
      text-transform: capitalize;
    }
    .readiness::before { content: "○"; font-size: 14px; line-height: 1; }
    .readiness.ready { border-style: solid; }
    .readiness.ready::before { content: "✓"; }
    .readiness.blocked { border-style: dashed; }
    .readiness.blocked::before { content: "!"; }
    .readiness.already-in-progress { border-style: double; }
    .readiness.already-in-progress::before { content: "↻"; }
    .readiness.completed::before { content: "✓"; }
    .readiness.ineligible { border-style: dotted; }
    .readiness.ineligible::before { content: "—"; }
    .readiness.unknown { border-style: dashed; }
    .readiness.unknown::before { content: "?"; }
    .handoff-reasons { margin: 10px 0 0; padding-left: 22px; }
    .handoff-reasons li + li { margin-top: 5px; }
    .handoff-reasons a { color: var(--focus); }
    .criteria-list { display: grid; gap: 8px; margin: 10px 0 0; }
    .criterion {
      margin: 0;
      padding: 10px 12px;
      border-left: 4px solid var(--border-strong);
      background: var(--soft);
    }
    .criterion footer { margin-top: 5px; color: var(--muted); font-size: 11px; }
    .handoff-warning {
      margin: 10px 0 0;
      padding: 9px 10px;
      border: 1px dashed var(--warning);
      border-radius: 8px;
      background: color-mix(in srgb, var(--warning) 8%, var(--bg));
    }
    .mechanism-list { display: grid; gap: 8px; margin-top: 10px; }
    .mechanism {
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }
    .mechanism-heading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
    .mechanism-status { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: capitalize; }
    .mechanism p { margin: 5px 0 0; color: var(--muted); }
    .mechanism ul { margin: 6px 0 0; padding-left: 20px; color: var(--muted); }
    .handoff-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .handoff-actions .button { text-decoration: none; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @media (max-width: 800px) {
      .topbar { align-items: flex-start; flex-direction: column; }
      main { width: min(100% - 24px, 680px); padding-top: 26px; }
      .ops-heading { display: block; }
      .refresh-status { margin-top: 8px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metric { border-right: 0; border-bottom: 1px solid var(--border); }
      .metric:nth-child(odd) { border-right: 1px solid var(--border); }
      .metric:last-child { border-bottom: 0; }
      .scope-controls { grid-template-columns: 1fr; }
      .goal-details-body { grid-template-columns: 1fr; }
      .mission-layout { grid-template-columns: 1fr; }
      .activity-panel { position: static; }
      .pipeline {
        grid-template-columns: repeat(5, minmax(122px, 1fr));
        min-width: 650px;
      }
      .run-row { grid-template-columns: 18px minmax(0, 1fr); }
      .run-side { grid-column: 2; min-width: 0; text-align: left; }
      .attention-lanes { grid-template-columns: 1fr; }
    }
    @media (max-width: 1040px) and (min-width: 901px) {
      .pipeline {
        grid-template-columns: repeat(5, minmax(122px, 1fr));
        min-width: 650px;
      }
    }
    @media (max-width: 900px) and (min-width: 801px) {
      .mission-layout { grid-template-columns: 1fr; }
      .activity-panel { position: static; }
      .activity-stream {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .activity-item:nth-child(2) { border-top: 0; }
      .activity-item:nth-child(odd) { border-right: 1px solid var(--border); }
    }
    @media (max-width: 420px) {
      main { width: 100%; padding: 18px 12px 42px; }
      .topbar { padding-inline: 12px; }
      .metrics { grid-template-columns: 1fr; }
      .metric, .metric:nth-child(odd) { border-right: 0; }
      .drawer-facts { grid-template-columns: 1fr; }
      .goal-drawer { width: 100vw; }
    }
    @media (pointer: coarse) {
      .button, .filter, .stage-button, .goal-trigger, .filter-disclosure > summary, select, input { min-height: 44px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
    }
    @media (forced-colors: active) {
      :root {
        --bg: Canvas;
        --surface: Canvas;
        --soft: Canvas;
        --soft-strong: Canvas;
        --border: CanvasText;
        --border-strong: CanvasText;
        --text: CanvasText;
        --muted: CanvasText;
        --focus: Highlight;
        --accent: Highlight;
        --accent-soft: Canvas;
        --success: CanvasText;
        --warning: CanvasText;
        --danger: CanvasText;
      }
      .filter.selected, .stage-card.selected {
        outline: 2px solid Highlight;
        outline-offset: -2px;
      }
      .readiness, .handoff-warning, .criterion, .mechanism { border-color: CanvasText; }
      .bootstrap-summary.attention, .bootstrap-summary.warning, .bootstrap-badge {
        border-color: CanvasText;
      }
      .drawer-scrim { background: Canvas; opacity: .55; }
      .legend-dot, .activity-marker, .run-indicator {
        forced-color-adjust: none;
        background: Highlight;
        border-color: Highlight;
        color: HighlightText;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span>Factory Mission Control</span></div>
      <div class="repo" id="repo-header"></div>
    </header>
    <main id="app"></main>
    <div id="live-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  </div>
  <script>
    let state = null;
    let localError = "";
    let phaseFilter = "all";
    let bootstrapFilter = false;
    let repositoryFilter = "all";
    let ownerFilter = "all";
    let goalSearch = "";
    let activeRepositoriesOnly = false;
    let showRepositoryManager = false;
    let refreshingAll = false;
    let expandedStage = "";
    let selectedGoalId = "";
    let drawerReturnSelector = "";
    let handoffProbeGoalId = "";
    let handoffProbePending = false;
    let handoffProbeComplete = false;
    let handoffProbeToken = 0;
    let handoffOverlay = null;
    let handoffOverlayTimer = null;
    let filtersOpen = false;
    let activityKindFilter = "all";
    let activityPageState = {};
    let workflowPageState = {};
    let activityPageView = null;
    let workflowPageView = null;
    let searchAnnouncementTimer = null;
    const canonicalBootstrapStatuses = new Set([
      "pending",
      "delayed",
      "partial",
      "failed",
      "retried",
      "complete",
      "opted_out",
    ]);

    const app = document.getElementById("app");
    const repoHeader = document.getElementById("repo-header");
    const liveStatus = document.getElementById("live-status");
    const boundedItems = ${boundedItems.toString()};
    const compareFeedItems = ${compareFeedItems.toString()};
    const semanticFeedItems = ${semanticFeedItems.toString()};
    const anchoredPagedItems = ${anchoredPagedItems.toString()};
    const describeActivityDelta = ${describeActivityDelta.toString()};

    function esc(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function announce(message) {
      if (!message) return;
      liveStatus.textContent = "";
      requestAnimationFrame(() => {
        liveStatus.textContent = message;
      });
    }

    function visibleGoals() {
      return (state?.activity?.goals || []).filter(goalMatchesFilter).filter(goalMatchesScope);
    }

    function resetFeedPages() {
      activityPageState = {};
      workflowPageState = {};
    }

    function filterAnnouncement() {
      const goals = visibleGoals();
      const filters = [
        phaseFilter !== "all" ? phaseFilter : "",
        bootstrapFilter ? "automatic bootstrap" : "",
        ownerFilter !== "all" ? ownerFilter : "",
        repositoryFilter !== "all" ? repositoryFilter === "current" ? "current repository" : repositoryFilter : "",
        goalSearch ? \`search “\${goalSearch}”\` : "",
        activeRepositoriesOnly ? "active repositories" : "",
      ].filter(Boolean);
      return \`Showing \${goals.length} goal\${goals.length === 1 ? "" : "s"}\${filters.length ? " filtered by " + filters.join(", ") : ""}.\`;
    }

    function elementStateKey(element) {
      if (!element) return "";
      if (element.dataset?.stateKey) return \`state:\${element.dataset.stateKey}\`;
      const keyedDisclosure = element.matches?.("summary")
        ? element.closest("details[data-state-key]")
        : null;
      if (keyedDisclosure) return \`state:\${keyedDisclosure.dataset.stateKey}:summary\`;
      if (element.id) return \`id:\${element.id}\`;
      if (element.dataset?.action) {
        return [
          "action",
          element.dataset.action,
          element.dataset.id,
          element.dataset.goalId,
          element.dataset.phase,
          element.dataset.kind,
          element.dataset.repository,
          element.dataset.taskId,
        ].filter(Boolean).join(":");
      }
      if (element.matches?.("a[href]")) {
        const surface = element.closest(".goal-drawer, .runs-panel, .activity-panel, .stage-detail, .secondary, .filter-disclosure");
        const surfaceKey = surface?.classList.contains("goal-drawer") ? "drawer"
          : surface?.getAttribute("aria-labelledby")
            || surface?.dataset?.stateKey
            || surface?.className
            || "page";
        return \`href:\${surfaceKey}:\${element.getAttribute("href")}\`;
      }
      const focusable = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')];
      const index = focusable.indexOf(element);
      return index >= 0 ? \`focusable:\${index}\` : "";
    }

    function findStateElement(key) {
      if (!key) return null;
      return [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
        .find(element => elementStateKey(element) === key) || null;
    }

    function captureUiState() {
      const active = document.activeElement;
      const selection = active && typeof active.selectionStart === "number"
        ? { start: active.selectionStart, end: active.selectionEnd }
        : null;
      return {
        focusKey: elementStateKey(active),
        selection,
        windowX: window.scrollX,
        windowY: window.scrollY,
        scroll: Object.fromEntries([...document.querySelectorAll("[data-scroll-key]")].map(element => [
          element.dataset.scrollKey,
          { left: element.scrollLeft, top: element.scrollTop }
        ])),
        disclosures: Object.fromEntries([...document.querySelectorAll("details[data-state-key]")].map(element => [
          element.dataset.stateKey,
          element.open
        ])),
      };
    }

    function restoreUiState(snapshot, focusSelector = "") {
      if (!snapshot) return;
      for (const detail of document.querySelectorAll("details[data-state-key]")) {
        if (Object.hasOwn(snapshot.disclosures, detail.dataset.stateKey)) {
          detail.open = snapshot.disclosures[detail.dataset.stateKey];
        }
      }
      for (const element of document.querySelectorAll("[data-scroll-key]")) {
        const position = snapshot.scroll[element.dataset.scrollKey];
        if (!position) continue;
        element.scrollLeft = position.left;
        element.scrollTop = position.top;
      }
      window.scrollTo(snapshot.windowX, snapshot.windowY);
      const target = focusSelector
        ? document.querySelector(focusSelector)
        : findStateElement(snapshot.focusKey);
      target?.focus({ preventScroll: true });
      if (target && snapshot.selection && typeof target.setSelectionRange === "function") {
        target.setSelectionRange(snapshot.selection.start, snapshot.selection.end);
      }
    }

    function initials(name) {
      return String(name || "S").split(/\\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
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
      const goals = state.activity?.goals?.length || 0;
      const watching = goals
        ? \`Watching \${goals} goal\${goals === 1 ? "" : "s"} across \${repositories} repo\${repositories === 1 ? "" : "s"}\`
        : \`Watching \${repositories} repo\${repositories === 1 ? "" : "s"}\`;
      const activity = state.activity || {};
      const attemptedAt = activity.lastAttemptedRefresh || activity.fetchedAt;
      const successfulAt = activity.lastSuccessfulRefresh;
      const dayBoundary = activity.dayBoundary;
      const snapshotDays = [...new Set((activity.snapshotDays || []).filter(Boolean))].sort();
      const dataDays = snapshotDays.length === 1
        ? snapshotDays[0]
        : snapshotDays.length > 1
          ? \`\${snapshotDays[0]}–\${snapshotDays.at(-1)}\`
          : "";
      const dayLabel = dayBoundary?.kind !== "utc-server-day"
        ? ""
        : dataDays && (snapshotDays.length > 1 || dataDays !== dayBoundary.snapshotDay)
          ? \` · UTC server-day data \${dataDays} (00:00–24:00 UTC) · aggregate observed \${dayBoundary.snapshotDay}; refresh pending\`
          : \` · UTC server day \${dayBoundary.snapshotDay} (00:00–24:00 UTC)\`;
      let refreshStatus = "";
      if (activity.partial || activity.stale) {
        if (attemptedAt) refreshStatus += \` · refresh attempted \${formatTime(attemptedAt)}\`;
        refreshStatus += successfulAt
          ? \` · last fully synced \${formatTime(successfulAt)}\`
          : " · no complete sync yet";
      } else if (successfulAt) {
        refreshStatus = \` · synced \${formatTime(successfulAt)}\`;
      } else if (attemptedAt) {
        refreshStatus = \` · refresh attempted \${formatTime(attemptedAt)}\`;
      }
      repoHeader.innerHTML = \`<span>\${esc(watching)}\${esc(refreshStatus)}\${esc(dayLabel)}</span><span class="mode">\${active} active</span>\`;
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

    function metricHtml(value, label, { tone = "", aside = "", detail = "" } = {}) {
      return \`
        <div class="metric \${tone}">
          <span class="metric-label">\${esc(label)}</span>
          <span class="metric-value"><strong>\${esc(value)}</strong>\${aside ? \`<small>\${esc(aside)}</small>\` : ""}</span>
          \${detail ? \`<span class="metric-detail">\${esc(detail)}</span>\` : ""}
        </div>\`;
    }

    function goalMatchesFilter(goal) {
      if (bootstrapFilter && !goalHasCanonicalBootstrap(goal)) return false;
      if (phaseFilter === "all") return true;
      if (phaseFilter === "active") return goal.phase !== "completed";
      return goal.phase === phaseFilter;
    }

    function goalMatchesScope(goal) {
      const repository = String(goal.repository?.nameWithOwner || "");
      if (repositoryFilter === "current" && repository.toLowerCase() !== String(state.activity?.currentRepository || "").toLowerCase()) return false;
      if (!["all", "current"].includes(repositoryFilter) && repository !== repositoryFilter) return false;
      if (ownerFilter !== "all" && repository.split("/")[0] !== ownerFilter) return false;
      if (activeRepositoriesOnly && !repositoryHasActiveWork(repository)) return false;
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
              <small>\${esc(item.kind)} · \${esc(formatTime(item.timestamp))}
                · \${item.confidence === "inferred" ? "Inferred correlation" : "Observed correlation"}
                <span class="evidence-label">\${esc(item.confidence === "inferred" ? "derived" : item.confidence || "observed")}</span>
              </small>
            </li>\`).join("")}
        </ol>\`;
    }

    function lifecycleHistoryHtml(goal) {
      const history = goal.lifecycleHistory || {};
      const transitions = Array.isArray(history.transitions) ? [...history.transitions].reverse() : [];
      const incomplete = history.incompleteBeforeFirstObservation !== false;
      return \`
        <div class="history-note">
          <strong>Observed lifecycle history</strong>
          <p>\${incomplete
            ? "History is incomplete before Squadcaster's first observation. "
            : ""}Times below are when Squadcaster observed a phase change, not when GitHub or Squad performed it.</p>
        </div>
        \${transitions.length ? \`
          <ol class="timeline">
            \${transitions.map(item => \`
              <li>
                <strong>\${esc(item.from)} → \${esc(item.to)}</strong>
                <small>observed \${esc(formatTime(item.observedAt))} · \${esc(item.freshness?.status || "partial")} source observation</small>
              </li>\`).join("")}
          </ol>\`
          : \`<p class="help">No later phase change has been observed\${history.firstObservedAt ? " since " + esc(formatTime(history.firstObservedAt)) : " yet"}.</p>\`}
      \`;
    }

    function bootstrapStatusLabel(status) {
      return String(status || "unknown").replaceAll("_", " ");
    }

    function bootstrapStatusCopy(bootstrap) {
      const status = bootstrap?.status || "unknown";
      if (bootstrap?.stale) {
        const sources = (bootstrap.staleSources || bootstrap.sources || []).map(source =>
          typeof source === "string" ? source : source?.source || source?.name).filter(Boolean);
        return \`Status is stale; reclassification is paused\${sources.length ? " because " + sources.join(", ") + " evidence is unavailable" : " until GitHub evidence is fully refreshed"}.\`;
      }
      const copy = {
        pending: "Automatic bootstrap is waiting for canonical GitHub artifacts.",
        delayed: "Derived warning: observed GitHub evidence has not advanced within the expected window.",
        partial: "Derived diagnostic: only part of the canonical artifact set is observed.",
        failed: "Derived diagnostic: the newest observed bootstrap workflow attempt failed.",
        retried: "Derived status: a newer observed workflow attempt follows an earlier failure.",
        complete: "Canonical bootstrap artifacts are observed. Downstream work remains represented by the normal goal lifecycle.",
        ambiguous: "Derived diagnostic: multiple or conflicting candidates prevent safe canonical selection.",
        malformed: "Derived diagnostic: a unique candidate violates the canonical bootstrap contract.",
        opted_out: "Observed human decision: the canonical Cast pull request was closed without merge.",
        unknown: "Bootstrap status is unknown because the evidence needed for classification has not been fully observed.",
      };
      return copy[status] || copy.unknown;
    }

    function bootstrapLinks(bootstrap) {
      const attempts = bootstrap?.workflowAttempts || bootstrap?.workflowRuns || [];
      const candidates = bootstrap?.candidates || bootstrap?.candidateLinks || [];
      const reasons = bootstrap?.reasons || [];
      const links = [
        bootstrap?.castPullRequest && {
          title: \`Cast PR #\${bootstrap.castPullRequest.number || ""}\`.trim(),
          url: bootstrap.castPullRequest.url,
          confidence: "observed",
        },
        bootstrap?.researchIssue && {
          title: \`Research issue #\${bootstrap.researchIssue.number || ""}\`.trim(),
          url: bootstrap.researchIssue.url,
          confidence: "observed",
        },
        bootstrap?.researchArtifact && {
          title: "Canonical research artifact",
          url: bootstrap.researchArtifact.url,
          timestamp: bootstrap.researchArtifact.createdAt,
          confidence: "observed",
        },
        ...attempts.map((attempt, index) => ({
          title: \`\${attempt.workflow || attempt.name || "Bootstrap workflow"} · \${attempt.conclusion || attempt.status || "unknown"}\`,
          url: attempt.url,
          timestamp: attempt.updatedAt || attempt.createdAt,
          index,
          confidence: "observed",
        })),
        ...candidates.map(candidate => ({
          title: candidate.title || candidate.kind || "Bootstrap candidate",
          url: candidate.url,
          confidence: "observed",
        })),
        ...reasons.map(reason => ({
          title: typeof reason === "string"
            ? reason
            : reason.message || reason.code || "Bootstrap diagnostic",
          url: typeof reason === "string" ? "" : reason.url,
          confidence: "derived",
        })),
      ];
      return links.filter(link => link?.url);
    }

    function repositoryHasActiveWork(repository) {
      const repositoryKey = String(repository || "").toLowerCase();
      return (state.activity?.goals || []).some(candidate =>
        candidate.phase !== "completed" &&
        String(candidate.repository?.nameWithOwner || "").toLowerCase() === repositoryKey);
    }

    function hasCanonicalBootstrapStatus(bootstrap) {
      return canonicalBootstrapStatuses.has(bootstrap?.status);
    }

    function bootstrapReasonText(reason) {
      if (typeof reason === "string") return reason;
      return reason?.message || reason?.code || "";
    }

    function repositoryBootstrapEntries() {
      const entries = new Map();
      for (const repository of state.activity?.repositories || []) {
        if (!repository?.bootstrap || repository.included === false) continue;
        entries.set(String(repository.nameWithOwner || "").toLowerCase(), {
          repository,
          bootstrap: repository.bootstrap,
          goal: null,
        });
      }
      for (const goal of state.activity?.goals || []) {
        if (!goal?.bootstrap) continue;
        const key = String(goal.repository?.nameWithOwner || "").toLowerCase();
        const existing = entries.get(key);
        const bootstrap = existing?.bootstrap || goal.bootstrap;
        const canonicalGoal = hasCanonicalBootstrapStatus(bootstrap) &&
          Number(bootstrap?.researchIssue?.number) === Number(goal.issue?.number);
        entries.set(key, {
          repository: existing?.repository || goal.repository,
          bootstrap,
          goal: canonicalGoal ? goal : null,
        });
      }
      const activityBootstrap = state.activity?.bootstrap;
      const aggregateEntries = Array.isArray(state.activity?.bootstraps)
        ? state.activity.bootstraps
        : Array.isArray(activityBootstrap)
          ? activityBootstrap
          : Array.isArray(activityBootstrap?.repositories)
            ? activityBootstrap.repositories
            : [];
      for (const entry of aggregateEntries) {
        const repository = typeof entry.repository === "string"
          ? { nameWithOwner: entry.repository }
          : entry.repository || entry;
        const bootstrap = entry.bootstrap || entry;
        const key = String(repository?.nameWithOwner || entry.nameWithOwner || "").toLowerCase();
        const repositoryState = (state.activity?.repositories || []).find(candidate =>
          String(candidate.nameWithOwner || "").toLowerCase() === key);
        if (repositoryState?.included === false) continue;
        if (!key) continue;
        const existing = entries.get(key);
        const canonicalGoal = existing?.goal &&
          hasCanonicalBootstrapStatus(bootstrap) &&
          Number(bootstrap?.researchIssue?.number) === Number(existing.goal.issue?.number);
        entries.set(key, {
          repository: repositoryState || existing?.repository || repository,
          bootstrap,
          goal: canonicalGoal ? existing.goal : null,
        });
      }
      return [...entries.values()];
    }

    function bootstrapForGoal(goal) {
      if (!goal) return null;
      const repositoryName = String(goal.repository?.nameWithOwner || "").toLowerCase();
      const aggregate = (state.activity?.bootstraps || []).find(candidate =>
        String(
          typeof candidate.repository === "string"
            ? candidate.repository
            : candidate.repository?.nameWithOwner || candidate.nameWithOwner || "",
        ).toLowerCase() === repositoryName);
      const repository = (state.activity?.repositories || []).find(candidate =>
        candidate.included !== false &&
        String(candidate.nameWithOwner || "").toLowerCase() ===
          repositoryName);
      return (aggregate?.bootstrap || aggregate) || repository?.bootstrap || goal.bootstrap || null;
    }

    function goalHasCanonicalBootstrap(goal) {
      const bootstrap = bootstrapForGoal(goal);
      return Boolean(
        bootstrap &&
        hasCanonicalBootstrapStatus(bootstrap) &&
        Number(bootstrap.researchIssue?.number) === Number(goal.issue?.number),
      );
    }

    function bootstrapEntryMatchesScope(entry) {
      const repository = String(entry.repository?.nameWithOwner || "");
      if (repositoryFilter === "current" && repository.toLowerCase() !== String(state.activity?.currentRepository || "").toLowerCase()) return false;
      if (!["all", "current"].includes(repositoryFilter) && repository !== repositoryFilter) return false;
      if (ownerFilter !== "all" && repository.split("/")[0] !== ownerFilter) return false;
      if (activeRepositoriesOnly && !repositoryHasActiveWork(repository)) return false;
      return true;
    }

    function bootstrapBadgeHtml(bootstrap) {
      const status = bootstrap?.status || "unknown";
      const label = bootstrapStatusLabel(status);
      return \`<span class="bootstrap-badge \${esc(status)}" aria-label="Automatic bootstrap: \${esc(label)}">\${esc(label)}</span>\`;
    }

    function bootstrapSummaryHtml(entry, { attention = false } = {}) {
      const bootstrap = entry.bootstrap || {};
      const status = bootstrap.status || "unknown";
      const goal = entry.goal;
      const links = bootstrapLinks(bootstrap);
      const repository = entry.repository?.nameWithOwner || goal?.repository?.nameWithOwner || "Repository unknown";
      const tone = attention ? "attention" : ["delayed", "partial", "retried"].includes(status) ? "warning" : "";
      return \`
        <article class="bootstrap-summary \${tone}" data-bootstrap-status="\${esc(status)}">
          <div class="bootstrap-summary-header">
            <strong>\${esc(repository)}</strong>
            \${bootstrapBadgeHtml(bootstrap)}
          </div>
          <p>\${esc(bootstrapStatusCopy(bootstrap))}</p>
          \${bootstrap.reasons?.length ? \`<p><strong>Derived reasons:</strong> \${esc(bootstrap.reasons.map(bootstrapReasonText).filter(Boolean).join("; "))}</p>\` : ""}
          \${links.length ? \`<div class="bootstrap-summary-links">\${links.map(link =>
            \`<a href="\${esc(link.url)}" target="_blank" rel="noreferrer">\${esc(link.title)} ↗ <span class="evidence-label">\${esc(link.confidence || "observed")}</span></a>\`
          ).join("")}</div>\` : ""}
          \${goal ? \`<div class="bootstrap-summary-links"><button class="button" data-action="open-goal" data-goal-id="\${esc(goal.id)}" data-open-surface="bootstrap-\${attention ? "attention" : "summary"}" type="button">Open canonical research goal</button></div>\` : ""}
        </article>\`;
    }

    function bootstrapSummariesHtml() {
      const visibleStatuses = new Set(["pending", "delayed", "partial", "failed", "retried", "ambiguous", "malformed", "opted_out", "unknown"]);
      const entries = repositoryBootstrapEntries().filter(bootstrapEntryMatchesScope).filter(entry =>
        entry.bootstrap?.stale || visibleStatuses.has(entry.bootstrap?.status || "unknown"));
      if (!entries.length) return "";
      return \`
        <section aria-labelledby="bootstrap-summary-title">
          <div class="panel-header">
            <div><h2 id="bootstrap-summary-title">Automatic bootstrap</h2><p>Repository-level, read-only status derived from canonical GitHub evidence.</p></div>
            <span class="attention-count">\${entries.length}</span>
          </div>
          <div class="bootstrap-summaries">\${entries.map(entry => bootstrapSummaryHtml(entry)).join("")}</div>
        </section>\`;
    }

    function bootstrapDrawerHtml(goal) {
      const bootstrap = bootstrapForGoal(goal);
      if (!goalHasCanonicalBootstrap(goal)) return "";
      const links = bootstrapLinks(bootstrap);
      return \`
        <section class="drawer-section" aria-labelledby="drawer-bootstrap-title">
          <div class="bootstrap-summary-header">
            <h3 id="drawer-bootstrap-title">Automatic bootstrap</h3>
            \${bootstrapBadgeHtml(bootstrap)}
          </div>
          <p>\${esc(bootstrapStatusCopy(bootstrap))}</p>
          <div class="drawer-facts">
            <div class="drawer-fact"><small>Classification</small><strong>Derived from GitHub evidence</strong></div>
            <div class="drawer-fact"><small>Journey</small><strong>\${esc(bootstrapStatusLabel(bootstrap.journeyPhase || "unknown"))}</strong></div>
          </div>
          \${bootstrap.reasons?.length ? \`<p><strong>Derived reasons:</strong> \${esc(bootstrap.reasons.map(bootstrapReasonText).filter(Boolean).join("; "))}</p>\` : ""}
          \${links.length ? \`<div class="drawer-list">\${links.map(link => \`
            <div class="drawer-item">
              <a href="\${esc(link.url)}" target="_blank" rel="noreferrer">\${esc(link.title)}</a>
              <small>\${link.confidence === "derived" ? "Derived diagnostic" : "Observed GitHub evidence"}\${link.timestamp ? " · " + esc(formatTime(link.timestamp)) : ""}</small>
            </div>\`).join("")}</div>\` : '<p class="help">No direct GitHub evidence link is currently available.</p>'}
        </section>\`;
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

    function goalById(id) {
      return (state.activity?.goals || []).find(goal => goal.id === id);
    }

    function goalIsVisible(goal) {
      return Boolean(goal && goalMatchesFilter(goal) && goalMatchesScope(goal));
    }

    function goalTriggerHtml(goal, compact = false) {
      const current = String(goal.repository?.nameWithOwner || "").toLowerCase() ===
        String(state.activity?.currentRepository || "").toLowerCase();
      return \`
        <button class="goal-trigger \${current ? "current-repository" : ""}" data-action="open-goal" data-goal-id="\${esc(goal.id)}" type="button">
          <strong>#\${esc(goal.issue.number)} · \${esc(goal.issue.title)}</strong>
          <small>\${esc(goal.repository.nameWithOwner || state.repoName)} · \${esc(goal.owner?.name || "Unknown")}\${compact ? "" : " · " + esc(formatTime(goal.updatedAt))}</small>
        </button>\`;
    }

    function stageHtml(phase, goals) {
      const selected = expandedStage === phase;
      const owners = [...new Map(goals.flatMap(goal => {
        const owner = goal.owner;
        const name = String(owner?.name || "").trim();
        if (!name || name.toLowerCase() === "unknown" || owner?.source === "unknown") return [];
        return [[owner?.id || name, name]];
      })).values()];
      const visibleOwners = owners.slice(0, 2);
      return \`
        <section class="stage-card \${esc(phase)} \${selected ? "selected" : ""}">
          <button class="stage-button" data-action="expand-stage" data-phase="\${phase}" type="button"
            aria-expanded="\${selected}" aria-controls="stage-detail">
            <span class="stage-heading">
              <strong>\${esc(phase)}</strong>
            </span>
            <span class="stage-load"><b>\${goals.length}</b><span>\${goals.length === 1 ? "goal" : "goals"}</span></span>
            <span class="stage-agents" aria-label="\${owners.length ? "Owners: " + esc(owners.join(", ")) : "No observed owners"}">
              \${visibleOwners.map((owner, index) => \`
                <span class="agent-chip tone-\${index % 4}" title="\${esc(owner)}" aria-hidden="true">\${esc(initials(owner))}</span>
              \`).join("")}
              \${owners.length > visibleOwners.length ? \`
                <span class="agent-more" aria-hidden="true">+\${owners.length - visibleOwners.length}</span>
              \` : ""}
            </span>
            <span class="stage-foot"><strong>\${owners.length}</strong> \${owners.length === 1 ? "owner" : "owners"} observed</span>
          </button>
        </section>\`;
    }

    function stageDetailHtml(goals) {
      if (!expandedStage) return "";
      const stageGoals = goals.filter(goal => goal.phase === expandedStage);
      const visible = boundedItems(stageGoals, 80);
      return \`
        <section class="stage-detail" id="stage-detail" aria-labelledby="stage-detail-title">
          <div class="stage-detail-heading">
            <div>
              <h3 id="stage-detail-title" tabindex="-1">\${esc(expandedStage)} goals</h3>
              <p class="help">Open a goal to inspect its evidence, dependencies, and linked delivery activity.</p>
            </div>
            <button class="button" data-action="close-stage" type="button">Close</button>
          </div>
          <div class="stage-goals">
            \${visible.items.length ? visible.items.map(goal => goalTriggerHtml(goal)).join("") : '<p class="help">No visible goals are in this stage.</p>'}
          </div>
          \${visible.hidden ? \`<p class="collection-note">Showing the first \${visible.items.length} of \${visible.total} matching goals. Narrow the goal filters to inspect the remainder.</p>\` : ""}
        </section>\`;
    }

    function needsAttentionHtml(goals) {
      const attentionGoals = goals.filter(goal => goal.phase === "blocked" || goal.phase === "failed");
      const degradedBootstrap = repositoryBootstrapEntries()
        .filter(bootstrapEntryMatchesScope)
        .filter(entry => ["delayed", "partial", "failed", "ambiguous", "malformed"].includes(entry.bootstrap?.status));
      if (!attentionGoals.length && !degradedBootstrap.length) return "";
      return \`
        <section class="attention-panel" aria-labelledby="attention-title">
          <div class="panel-header">
            <div><h2 id="attention-title">Needs attention</h2><p>Blocked and failed goals plus degraded automatic-bootstrap diagnostics remain directly inspectable.</p></div>
            <span class="attention-count">\${attentionGoals.length + degradedBootstrap.length}</span>
          </div>
          \${attentionGoals.length ? \`<div class="attention-lanes">
            \${["blocked", "failed"].map(phase => {
              const phaseGoals = attentionGoals.filter(goal => goal.phase === phase);
              return \`
                <section class="attention-lane" aria-labelledby="attention-\${phase}">
                  <h3 id="attention-\${phase}"><span>\${phase}</span><span>\${phaseGoals.length}</span></h3>
                  <div class="attention-goals">
                    \${phaseGoals.length
                      ? phaseGoals.map(goal => goalTriggerHtml(goal, true)).join("")
                      : \`<p class="help">No visible \${phase} goals.</p>\`}
                  </div>
                </section>\`;
            }).join("")}
          </div>\` : ""}
          \${degradedBootstrap.length ? \`
            <section class="attention-lane" aria-labelledby="attention-bootstrap" style="margin:0 14px 14px">
              <h3 id="attention-bootstrap"><span>Automatic bootstrap</span><span>\${degradedBootstrap.length}</span></h3>
              <div class="bootstrap-summaries">\${degradedBootstrap.map(entry =>
                bootstrapSummaryHtml(entry, { attention: true })).join("")}</div>
            </section>\` : ""}
        </section>\`;
    }

    function activeWorkflowRunsHtml(goals) {
      const runs = semanticFeedItems(goals.flatMap(goal =>
        (goal.workflowRuns || [])
          .filter(run => run.status !== "completed")
          .map(run => ({
            ...run,
            run,
            goal,
            timestamp: run.updatedAt || run.createdAt,
          }))
      ), item => \`\${item.goal.repository?.nameWithOwner}|\${item.id || item.url ||
        \`\${item.workflow}|\${item.branch}|\${item.createdAt}|\${item.status}\`}\`);
      const runIdentity = item => \`\${item.goal.repository?.nameWithOwner}|\${item.id || item.url ||
        \`\${item.workflow}|\${item.branch}|\${item.createdAt}|\${item.status}\`}\`;
      const visible = anchoredPagedItems(runs, workflowPageState, 12, runIdentity);
      workflowPageState = {
        anchor: visible.anchor,
        beforeKey: visible.beforeKey,
        visibleKeys: visible.visibleKeys,
        nextAnchor: visible.nextAnchor,
        startIndex: visible.startIndex,
      };
      workflowPageView = visible;
      return \`
        <section class="runs-panel" aria-labelledby="runs-title">
          <div class="panel-header">
            <div><h2 id="runs-title">\${runs.length} workflow run\${runs.length === 1 ? "" : "s"} in progress</h2></div>
          </div>
          \${visible.items.length ? \`
            <ol class="run-list">
              \${visible.items.map(({ run, goal }) => \`
                <li>
                  <a class="run-row" href="\${esc(run.url || goal.issue.url)}" target="_blank" rel="noreferrer">
                    <span class="run-indicator" aria-hidden="true"></span>
                    <span class="run-main">
                      <span class="run-name" title="\${esc(run.name || run.workflow || "Workflow run")}">\${esc(run.name || run.workflow || "Workflow run")}</span>
                      <span class="run-meta">
                        <span class="run-repository" title="\${esc(goal.repository.nameWithOwner)}">\${esc(goal.repository.nameWithOwner)}</span>
                        <span>#\${esc(goal.issue.number)}</span>
                        \${run.branch ? \`<span class="run-branch" title="\${esc(run.branch)}">\${esc(run.branch)}</span>\` : ""}
                        <span>\${esc(goal.owner?.name || "Unknown owner")}</span>
                      </span>
                    </span>
                    <span class="run-side">
                      <strong>\${esc(String(run.status || "in progress").replaceAll("_", " "))}</strong>
                      <span>updated \${esc(formatTime(run.updatedAt || run.createdAt))}</span>
                    </span>
                  </a>
                </li>\`).join("")}
            </ol>\`
            : '<p class="help" style="padding:16px">No workflow runs are currently in progress for the visible goals.</p>'}
          \${visible.total > 12 ? \`
            <nav class="feed-controls" aria-label="Active workflow pages">
              <span class="feed-page-status">Showing \${visible.start}–\${visible.end} of \${visible.total} active workflow runs.</span>
              <span class="feed-pagination">
                <button class="button" data-action="newer-workflows" type="button" \${visible.hasNewer ? "" : "disabled"}>Newer workflows</button>
                <button class="button" data-action="older-workflows" type="button" \${visible.hasOlder ? "" : "disabled"}>Older workflows</button>
              </span>
            </nav>\` : ""}
        </section>\`;
    }

    function activityMarkerHtml(item) {
      const title = String(item.title || "").toLowerCase();
      if (item.kind === "pull-request") {
        return '<span class="activity-marker pull-request" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="5" cy="3" r="1.5"></circle><circle cx="11" cy="13" r="1.5"></circle><circle cx="5" cy="13" r="1.5"></circle><path d="M5 4.5v7M6.5 5.5h2A2.5 2.5 0 0 1 11 8v3.5"></path></svg></span>';
      }
      if (item.kind === "workflow" && !/(success|failure|cancel|complete)/.test(title)) {
        return '<span class="activity-marker running" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M5.5 3.5 12 8l-6.5 4.5z"></path></svg></span>';
      }
      if (/(failure|failed|error|cancel)/.test(title)) {
        return '<span class="activity-marker failure" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"></path></svg></span>';
      }
      if (item.kind === "workflow" || item.kind === "check" || title.includes("closed")) {
        return '<span class="activity-marker success" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3 8.5 3.2 3.2L13 4.8"></path></svg></span>';
      }
      if (item.kind === "artifact") {
        return '<span class="activity-marker artifact" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3M6 8h4M6 10.5h4"></path></svg></span>';
      }
      if (item.kind === "owner") {
        return '<span class="activity-marker owner" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="2.5"></circle><path d="M3.5 13c.5-2.5 2-3.7 4.5-3.7s4 1.2 4.5 3.7"></path></svg></span>';
      }
      return '<span class="activity-marker issue" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"></circle><path d="M8 5v3.5M8 11h.01"></path></svg></span>';
    }

    function recentActivityHtml(goals) {
      const allActivity = semanticFeedItems(goals.flatMap(goal =>
        (goal.evidence || []).map(item => ({ ...item, goal }))),
      item => \`\${item.goal.id}|\${item.kind}|\${item.title}|\${item.url}\`);
      const activity = activityKindFilter === "all"
        ? allActivity
        : allActivity.filter(item => item.kind === activityKindFilter);
      const activityIdentity = item => \`\${item.goal.id}|\${item.kind}|\${item.title}|\${item.url}\`;
      const visible = anchoredPagedItems(activity, activityPageState, 20, activityIdentity);
      activityPageState = {
        anchor: visible.anchor,
        beforeKey: visible.beforeKey,
        visibleKeys: visible.visibleKeys,
        nextAnchor: visible.nextAnchor,
        startIndex: visible.startIndex,
      };
      activityPageView = visible;
      const kinds = [
        ["all", "All"],
        ["issue", "Issues"],
        ["owner", "Ownership"],
        ["artifact", "Artifacts"],
        ["workflow", "Workflows"],
        ["pull-request", "Pull requests"],
        ["check", "Checks"],
      ];
      const itemsHtml = items => items.map(item => \`
        <li class="activity-item">
          \${activityMarkerHtml(item)}
          <div>
            <a href="\${esc(item.url || item.goal.issue.url)}" target="_blank" rel="noreferrer">\${esc(item.title)}</a>
            <small>#\${esc(item.goal.issue.number)} · \${esc(item.goal.repository.nameWithOwner)} · \${esc(formatTime(item.timestamp))}
              · \${item.confidence === "inferred" ? "Inferred correlation" : "Observed correlation"}
              <span class="evidence-label">\${esc(item.confidence === "inferred" ? "derived" : item.confidence || "observed")}</span>
            </small>
          </div>
        </li>\`).join("");
      return \`
        <aside class="activity-panel" aria-labelledby="activity-title">
          <div class="panel-header">
            <div><h2 id="activity-title">Activity</h2><p>Newest evidence first.</p></div>
            <span class="evidence-count" aria-label="\${allActivity.length} evidence events">\${allActivity.length}</span>
          </div>
          <div class="activity-filters" role="group" aria-label="Filter activity by evidence kind">
            \${kinds.map(([kind, label]) => \`
              <button class="activity-kind" data-action="activity-kind" data-kind="\${kind}" type="button"
                aria-pressed="\${activityKindFilter === kind}">\${label}</button>
            \`).join("")}
          </div>
          \${activity.length ? \`
            <ol class="activity-stream">\${itemsHtml(visible.items)}</ol>
            <nav class="feed-controls" aria-label="Activity pages">
              <span class="feed-page-status">Showing \${visible.start}–\${visible.end} of \${visible.total} \${activityKindFilter === "all" ? "evidence events" : activityKindFilter + " events"}.</span>
              <span class="feed-pagination">
                <button class="button" data-action="newer-activity" type="button" \${visible.hasNewer ? "" : "disabled"}>Newer evidence</button>
                <button class="button" data-action="older-activity" type="button" \${visible.hasOlder ? "" : "disabled"}>Older evidence</button>
              </span>
            </nav>
            \` : '<p class="help" style="padding:14px">No correlated evidence is available for this evidence-kind filter.</p>'}
        </aside>\`;
    }

    function dependencyItemsHtml(goal) {
      if (!goal.dependencies?.length) return '<p class="help">No dependencies are declared.</p>';
      return \`<div class="drawer-list">\${goal.dependencies.map(item => \`
        <div class="drawer-item">
          <a href="\${esc(item.url)}" target="_blank" rel="noreferrer">\${esc(item.repository)}#\${esc(item.issueNumber)} · \${esc(item.title)}</a>
          <small>\${esc(item.phase || item.status || "unknown")}</small>
        </div>\`).join("")}</div>\`;
    }

    function pullRequestItemsHtml(goal) {
      if (!goal.pullRequests?.length) return '<p class="help">No pull request has been correlated yet.</p>';
      return \`<div class="drawer-list">\${goal.pullRequests.map(item => \`
        <div class="drawer-item">
          <a href="\${esc(item.url)}" target="_blank" rel="noreferrer">PR #\${esc(item.number)} · \${esc(item.title)}</a>
          <small>\${esc(item.state)}\${item.draft ? " · draft" : ""} · review \${esc(item.reviewDecision || "unknown")}\${item.branch ? " · " + esc(item.branch) : ""}</small>
          \${item.reviews === null || item.reviews === undefined
            ? '<small>Latest reviews unavailable.</small>'
            : item.reviews.length
              ? \`<small>Latest reviews: \${item.reviews.map(review => \`\${esc(review.actor?.login || "Unknown reviewer")} (\${esc(review.state)})\`).join(", ")}</small>\`
              : '<small>No latest reviews reported.</small>'}
          \${item.reviewRequests === null || item.reviewRequests === undefined
            ? '<small>Review requests unavailable.</small>'
            : item.reviewRequests.length
              ? \`<small>Requested reviewers: \${item.reviewRequests.map(request => esc(request.actor?.login || "Unknown reviewer")).join(", ")}</small>\`
              : '<small>No pending review requests.</small>'}
          \${item.checks?.length ? \`<div class="drawer-list">\${item.checks.map(check => \`
            <div class="drawer-item">
              \${check.url ? \`<a href="\${esc(check.url)}" target="_blank" rel="noreferrer">\${esc(check.name)}</a>\` : \`<strong>\${esc(check.name)}</strong>\`}
              <small>\${esc(check.status)}</small>
            </div>\`).join("")}</div>\` : '<p class="help">No checks reported.</p>'}
        </div>\`).join("")}</div>\`;
    }

    function workflowItemsHtml(goal) {
      if (!goal.workflowRuns?.length) return '<p class="help">No workflow run has been correlated yet.</p>';
      return \`<div class="drawer-list">\${goal.workflowRuns.map(item => \`
        <div class="drawer-item">
          <a href="\${esc(item.url)}" target="_blank" rel="noreferrer">\${esc(item.workflow)}</a>
          <small>\${esc(item.conclusion || item.status)}\${item.branch ? " · " + esc(item.branch) : ""} · \${esc(formatTime(item.updatedAt || item.createdAt))}</small>
        </div>\`).join("")}</div>\`;
    }

    function workflowJobItemsHtml(goal) {
      const selectedRuns = (goal.workflowRuns || [])
        .filter(run => run.jobsState?.status && run.jobsState.status !== "not_selected");
      if (!selectedRuns.length) {
        return '<p class="help">No workflow run was selected for bounded job drill-down.</p>';
      }
      return \`<div class="workflow-drilldown">\${selectedRuns.map(run => {
        const state = run.jobsState || {};
        const stateLabel = String(state.status || "unavailable").replaceAll("_", " ");
        let jobsHtml = "";
        if (Array.isArray(run.jobs) && run.jobs.length === 0) {
          jobsHtml = '<p class="help">GitHub reported no jobs for this run.</p>';
        } else if (!Array.isArray(run.jobs)) {
          jobsHtml = '<p class="help">Workflow jobs are unavailable for this run.</p>';
        } else {
          jobsHtml = \`<div class="workflow-jobs">\${run.jobs.map(job => \`
            <article class="workflow-job">
              <header>
                \${job.url ? \`<a href="\${esc(job.url)}" target="_blank" rel="noreferrer">\${esc(job.name || "Unnamed job")}</a>\` : \`<strong>\${esc(job.name || "Unnamed job")}</strong>\`}
                <small>\${esc(job.conclusion || job.status || "No status reported")}</small>
              </header>
              \${job.startedAt || job.completedAt ? \`<small>\${job.startedAt ? "started " + esc(formatTime(job.startedAt)) : ""}\${job.startedAt && job.completedAt ? " · " : ""}\${job.completedAt ? "completed " + esc(formatTime(job.completedAt)) : ""}</small>\` : ""}
              \${job.steps?.length ? \`<ol class="workflow-steps">\${job.steps.map(step => \`
                <li>
                  <span>\${esc(step.name || "Unnamed step")}</span>
                  <small> · \${esc(step.conclusion || step.status || "No status reported")}\${step.startedAt ? " · started " + esc(formatTime(step.startedAt)) : ""}\${step.completedAt ? " · completed " + esc(formatTime(step.completedAt)) : ""}</small>
                </li>\`).join("")}</ol>\` : '<p class="help">GitHub reported no steps for this job.</p>'}
            </article>\`).join("")}</div>\`;
        }
        return \`
          <section class="workflow-job-run">
            <header>
              <strong>\${esc(run.workflow || run.name || "Workflow run")}</strong>
              <small>run \${esc(run.id)} · \${esc(stateLabel)}</small>
            </header>
            \${jobsHtml}
            \${state.error ? \`<p class="workflow-source-note">\${esc(state.error)}</p>\` : ""}
          </section>\`;
      }).join("")}</div>\`;
    }

    const mechanismDefinitions = {
      "local-session": {
        name: "Local project session",
        description: "Runs in the local Copilot app using a project checkout or worktree. A future approved adapter could create one issue-linked session.",
      },
      "copilot-cloud-agent": {
        name: "Copilot cloud agent",
        description: "Runs on GitHub infrastructure from the existing issue. A future approved adapter could assign Copilot and produce one branch and pull request.",
      },
      "squad-implement": {
        name: "/squad implement",
        description: "Runs through the repository's installed Squad workflow. A future approved adapter could dispatch one implementation run for this issue.",
      },
      manual: {
        name: "Manual handling",
        description: "Makes no repository or agent change. Open the issue or copy/export the exact normalized context for use elsewhere.",
      },
    };

    function handoffReasonHtml(reason) {
      if (typeof reason === "string") return esc(reason);
      const text = reason?.message || reason?.text || reason?.code || "Readiness could not be proven.";
      const url = reason?.url || reason?.sourceUrl;
      return url
        ? \`<a href="\${esc(url)}" target="_blank" rel="noreferrer">\${esc(text)}</a>\`
        : esc(text);
    }

    function handoffLink(item, fallbackLabel) {
      if (!item) return "";
      const url = typeof item === "string" ? "" : item.url || item.appUrl || item.sourceUrl;
      const label = typeof item === "string"
        ? item
        : item.title || item.name || item.label || item.id || fallbackLabel;
      if (!url) return \`<strong>\${esc(label)}</strong>\`;
      return \`<a href="\${esc(url)}" target="_blank" rel="noreferrer">\${esc(label)}</a>\`;
    }

    function existingImplementationHtml(handoff) {
      const existing = handoff?.existingImplementation || {};
      const labels = {
        "pull-request": "Pull request",
        "workflow-run": "Workflow run",
        "copilot-task": "Copilot cloud agent",
        "copilot-assignment": "Copilot cloud agent",
        "local-session": "Local project session",
      };
      const items = Array.isArray(existing.links) ? existing.links : [];
      if (!items.length) {
        return '<p class="help">No existing implementation is recorded by the normalized handoff contract.</p>';
      }
      return \`<div class="drawer-list">\${items.map(item => \`
        <div class="drawer-item">
          \${handoffLink(item, labels[item.kind] || "Existing implementation")}
          <small>\${esc(labels[item.kind] || item.kind || "Existing implementation")} · \${esc(item?.status || item?.state || existing.state || "observed")}</small>
          \${item?.url || item?.appUrl || item?.sourceUrl ? \`<div class="handoff-actions"><a class="button" href="\${esc(item.url || item.appUrl || item.sourceUrl)}" target="_blank" rel="noreferrer">Open existing</a></div>\` : ""}
        </div>\`).join("")}</div>\`;
    }

    function activationHtml(handoff) {
      const activation = handoff?.activation;
      if (!activation) return '<p class="help">No resolved activation provenance is available.</p>';
      const root = activation.rootIssue;
      const rootLabel = typeof root === "object" ? root.id || root.goalId || "Activation root" : root;
      const rootUrl = activation.rootIssueUrl || activation.rootUrl || (typeof root === "object" ? root.url : "");
      return \`
        <div class="drawer-list">
          <div class="drawer-item">
            \${rootUrl
              ? \`<a href="\${esc(rootUrl)}" target="_blank" rel="noreferrer">\${esc(rootLabel || "Activation root")}</a>\`
              : \`<strong>\${esc(rootLabel || "Activation root unavailable")}</strong>\`}
            <small>Accepted-plan activation root</small>
          </div>
          <div class="drawer-item">
            \${activation.artifactUrl
              ? \`<a href="\${esc(activation.artifactUrl)}" target="_blank" rel="noreferrer">\${esc(activation.artifactKind || "Activation artifact")}</a>\`
              : \`<strong>\${esc(activation.artifactKind || "Activation artifact unavailable")}</strong>\`}
            <small>Schema \${esc(activation.schemaVersion || "unknown")} · task \${esc(activation.task || "unknown")} · agent \${esc(activation.agent || "unknown")}</small>
          </div>
        </div>\`;
    }

    function acceptanceCriteriaHtml(handoff) {
      const criteria = Array.isArray(handoff?.acceptanceCriteria) ? handoff.acceptanceCriteria : [];
      const complete = handoff?.acceptanceCriteriaComplete === true;
      return \`
        \${criteria.length ? \`<div class="criteria-list">\${criteria.map(item => \`
          <blockquote class="criterion">
            “\${esc(typeof item === "string" ? item : item.text)}”
            \${typeof item === "object" && item.sourceUrl ? \`<footer><a href="\${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">Task issue source</a></footer>\` : ""}
          </blockquote>\`).join("")}</div>\` : '<p class="help">No acceptance criteria are available from the task issue.</p>'}
        \${complete ? "" : '<p class="handoff-warning"><strong>Incomplete source.</strong> Automated readiness must remain fail closed because the criteria source is missing, truncated, partial, or unavailable.</p>'}
      \`;
    }

    function mechanismsHtml(handoff) {
      if (handoffProbePending) return '<p class="help" role="status">Checking non-mutating mechanism availability…</p>';
      if (!handoffProbeComplete) return '<p class="help">Availability will be checked when these goal details open.</p>';
      const mechanisms = new Map((handoff?.mechanisms || []).map(item => [item.kind, item]));
      return \`<div class="mechanism-list">\${Object.entries(mechanismDefinitions).map(([kind, definition]) => {
        const mechanism = mechanisms.get(kind);
        const availability = mechanism?.availability || (kind === "manual" ? "available" : "unavailable");
        const reasons = Array.isArray(mechanism?.reasons) ? mechanism.reasons : [];
        return \`
          <article class="mechanism" data-mechanism="\${esc(kind)}">
            <div class="mechanism-heading">
              <strong>\${esc(definition.name)}</strong>
              <span class="mechanism-status">\${esc(String(availability).replaceAll("-", " "))}</span>
            </div>
            <p>\${esc(definition.description)}</p>
            \${reasons.length ? \`<ul>\${reasons.map(reason => \`<li>\${handoffReasonHtml(reason)}</li>\`).join("")}</ul>\` : ""}
          </article>\`;
      }).join("")}</div>\`;
    }

    function handoffContext(goal) {
      return {
        schemaVersion: 1,
        goal: {
          id: goal.id,
          repository: goal.repository,
          issue: goal.issue,
          dependencies: goal.dependencies || [],
          blockers: goal.blockers || [],
          handoff: goal.handoff || null,
        },
      };
    }

    function repositoryIsIncluded(snapshot, goal) {
      const nameWithOwner = String(goal?.repository?.nameWithOwner || "").toLowerCase();
      const repository = (snapshot?.activity?.repositories || []).find(item =>
        String(item.nameWithOwner || "").toLowerCase() === nameWithOwner);
      return repository?.included !== false;
    }

    function handoffRevision(goal, snapshot) {
      if (!goal?.handoff || !repositoryIsIncluded(snapshot, goal)) return "";
      const readiness = goal.handoff.readiness || {};
      return JSON.stringify({
        goalId: goal.id,
        issueState: goal.issue?.state || "",
        issueRevision: goal.handoff.issueRevision || "",
        readiness: {
          state: readiness.state || "",
          reasons: readiness.reasons || [],
          sourceStates: readiness.sourceStates || {},
        },
        activation: goal.handoff.activation || null,
        acceptanceCriteria: goal.handoff.acceptanceCriteria || [],
        acceptanceCriteriaComplete: goal.handoff.acceptanceCriteriaComplete === true,
        existingImplementation: goal.handoff.existingImplementation || null,
      });
    }

    function clearHandoffOverlay({ cancelPending = false } = {}) {
      if (handoffOverlayTimer) clearTimeout(handoffOverlayTimer);
      handoffOverlayTimer = null;
      handoffOverlay = null;
      handoffProbeComplete = false;
      if (cancelPending) {
        handoffProbePending = false;
        handoffProbeToken += 1;
      }
    }

    function applyOverlayToGoal(goal, overlay) {
      if (!goal?.handoff || !overlay) return false;
      goal.handoff.mechanisms = structuredClone(overlay.mechanisms);
      goal.handoff.readiness = {
        ...goal.handoff.readiness,
        automatedHandoffAvailable: overlay.automatedHandoffAvailable,
      };
      return true;
    }

    function retainHandoffOverlay(nextState) {
      if (!handoffOverlay) {
        if (selectedGoalId && !handoffProbePending) handoffProbeComplete = false;
        return nextState;
      }
      const nextGoal = (nextState?.activity?.goals || []).find(goal => goal.id === handoffOverlay.goalId);
      const valid = Date.now() < handoffOverlay.expiresAt
        && handoffRevision(nextGoal, nextState) === handoffOverlay.revision;
      if (!valid) {
        clearHandoffOverlay({
          cancelPending: handoffProbePending && handoffProbeGoalId === handoffOverlay.goalId,
        });
        return nextState;
      }
      applyOverlayToGoal(nextGoal, handoffOverlay);
      handoffProbeComplete = selectedGoalId === handoffOverlay.goalId;
      return nextState;
    }

    function replaceState(nextState) {
      state = retainHandoffOverlay(nextState);
    }

    function applyHandoffProbe(nextState, goalId, probeToken) {
      const probedGoal = (nextState?.activity?.goals || []).find(goal => goal.id === goalId);
      const currentGoal = goalById(goalId);
      const probedRevision = handoffRevision(probedGoal, nextState);
      const currentRevision = handoffRevision(currentGoal, state);
      if (probeToken !== handoffProbeToken || !probedGoal || !currentGoal
          || !probedRevision || probedRevision !== currentRevision) return false;
      if (handoffOverlayTimer) clearTimeout(handoffOverlayTimer);
      handoffOverlay = {
        goalId,
        revision: currentRevision,
        mechanisms: structuredClone(probedGoal.handoff?.mechanisms || []),
        automatedHandoffAvailable: probedGoal.handoff?.readiness?.automatedHandoffAvailable === true,
        expiresAt: Date.now() + 60000,
        token: probeToken,
      };
      applyOverlayToGoal(currentGoal, handoffOverlay);
      handoffOverlayTimer = setTimeout(() => {
        if (handoffOverlay?.token !== probeToken || handoffOverlay.goalId !== goalId) return;
        clearHandoffOverlay();
        if (selectedGoalId === goalId) render();
      }, 60000);
      return true;
    }

    function handoffHtml(goal) {
      const handoff = goal.handoff;
      const readiness = handoff?.readiness || {
        state: "unknown",
        reasons: ["The normalized handoff contract is unavailable."],
      };
      const readinessState = readiness.state || "unknown";
      const reasons = Array.isArray(readiness.reasons) ? readiness.reasons : [];
      const incompleteSources = readinessState === "unknown"
        ? Object.entries(readiness.sourceStates || {}).filter(([, sourceState]) => sourceState !== "complete")
        : [];
      return \`
        <section class="drawer-section handoff-section" aria-labelledby="handoff-title">
          <div class="handoff-heading">
            <h3 id="handoff-title">Handoff</h3>
            <span class="readiness \${esc(readinessState)}" aria-label="Handoff readiness: \${esc(readinessState)}">\${esc(readinessState.replaceAll("-", " "))}</span>
          </div>
          \${reasons.length
            ? \`<ul class="handoff-reasons">\${reasons.map(reason => \`<li>\${handoffReasonHtml(reason)}</li>\`).join("")}</ul>\`
            : '<p class="help">All task-readiness checks passed.</p>'}
          \${incompleteSources.length ? \`
            <div class="handoff-warning">
              <strong>Readiness is fail closed.</strong>
              <ul class="handoff-reasons">\${incompleteSources.map(([source, sourceState]) =>
                \`<li>\${esc(source.replaceAll(/([A-Z])/g, " $1").toLowerCase())}: \${esc(String(sourceState).replaceAll("-", " "))}</li>\`
              ).join("")}</ul>
            </div>\` : ""}
          <h3 style="margin-top:16px">Activation provenance</h3>
          \${activationHtml(handoff)}
          <h3 style="margin-top:16px">Acceptance criteria</h3>
          \${acceptanceCriteriaHtml(handoff)}
          <h3 style="margin-top:16px">Existing implementation</h3>
          \${existingImplementationHtml(handoff)}
          <h3 style="margin-top:16px">Mechanism availability</h3>
          <p class="help">Availability and repository policy affect only each mechanism; they do not rewrite task readiness.</p>
          \${mechanismsHtml(handoff)}
          <div class="handoff-actions">
            <a class="button" href="\${esc(goal.issue.url)}" target="_blank" rel="noreferrer">Open issue</a>
            <button class="button" data-action="refresh-handoff" type="button">Refresh</button>
            <button class="button" data-action="copy-handoff-context" type="button">Copy context</button>
            <button class="button" data-action="export-handoff-context" type="button">Export context</button>
          </div>
        </section>\`;
    }

    function goalDrawerHtml() {
      const goal = goalById(selectedGoalId);
      if (!goal) return "";
      const goalBootstrap = goalHasCanonicalBootstrap(goal) ? bootstrapForGoal(goal) : null;
      return \`
        <div class="drawer-scrim" data-action="close-goal" aria-hidden="true"></div>
        <aside class="goal-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-describedby="drawer-description">
          <div class="drawer-header">
            <div>
              <span class="phase \${esc(goal.phase)}">\${esc(goal.phase)}</span>
              \${goalBootstrap ? bootstrapBadgeHtml(goalBootstrap) : ""}
              <h2 id="drawer-title" style="margin-top:8px">#\${esc(goal.issue.number)} · \${esc(goal.issue.title)}</h2>
              <p id="drawer-description">\${esc(goal.repository.nameWithOwner)}</p>
            </div>
            <button class="button drawer-close" data-action="close-goal" type="button" aria-label="Close goal details">×</button>
          </div>
          <div class="drawer-body" data-scroll-key="goal-drawer">
            <section class="drawer-section">
              <h3>Goal</h3>
              <div class="drawer-facts">
                <div class="drawer-fact"><small>Owner</small><strong>\${esc(goal.owner?.name || "Unknown")}</strong></div>
                <div class="drawer-fact"><small>Repository</small><strong>\${esc(goal.repository.nameWithOwner)}</strong></div>
                <div class="drawer-fact"><small>Issue state</small><strong>\${esc(goal.issue.state)}</strong></div>
                <div class="drawer-fact"><small>Updated</small><strong>\${esc(formatTime(goal.updatedAt))}</strong></div>
              </div>
              <p class="next-step"><strong>Next action</strong><span>\${esc(goal.nextAction || "Unknown — inspect the linked issue.")}</span></p>
              <p style="margin-bottom:0"><a href="\${esc(goal.issue.url)}" target="_blank" rel="noreferrer">Open source issue ↗</a></p>
            </section>
            \${bootstrapDrawerHtml(goal)}
            <section class="drawer-section"><h3>Dependencies</h3>\${dependencyItemsHtml(goal)}</section>
            \${handoffHtml(goal)}
            <section class="drawer-section"><h3>Pull requests and checks</h3>\${pullRequestItemsHtml(goal)}</section>
            <section class="drawer-section"><h3>Workflow runs</h3>\${workflowItemsHtml(goal)}</section>
            <section class="drawer-section"><h3>Workflow jobs and steps</h3>\${workflowJobItemsHtml(goal)}</section>
            <section class="drawer-section"><h3>Lifecycle history</h3><div style="margin-top:10px">\${lifecycleHistoryHtml(goal)}</div></section>
            <section class="drawer-section"><h3>Evidence</h3><div style="margin-top:10px">\${timelineHtml(goal)}</div></section>
          </div>
        </aside>\`;
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
        <details class="secondary" data-state-key="squad-context">
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
      const activeFilters = [
        phaseFilter !== "all" ? phaseFilter : "",
        bootstrapFilter ? "automatic bootstrap" : "",
        ownerFilter !== "all" ? ownerFilter : "",
        repositoryFilter !== "all" ? repositoryFilter === "current" ? "current repo" : repositoryFilter : "",
        goalSearch ? \`“\${goalSearch}”\` : "",
        activeRepositoriesOnly ? "active repos" : "",
      ].filter(Boolean);
      const filters = ["active", "queued", "researching", "implementing", "reviewing", "blocked", "failed", "completed", "all"];
      return \`
        <details class="filter-disclosure" data-state-key="goal-filters" \${filtersOpen ? "open" : ""}>
          <summary>Browse goals <span class="filter-summary">\${esc(activeFilters.length ? activeFilters.join(" · ") : "All visible goals")}</span></summary>
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
          <div class="filters" aria-label="Filter goals by status">
            <button class="filter bootstrap-filter \${bootstrapFilter ? "selected" : ""}" data-action="bootstrap-filter" type="button" aria-pressed="\${bootstrapFilter}">Automatic bootstrap</button>
            \${filters.map(filter => \`<button class="filter \${phaseFilter === filter ? "selected" : ""}" data-action="phase-filter" data-phase="\${filter}" type="button" aria-pressed="\${phaseFilter === filter}">\${esc(filter)}</button>\`).join("")}
          </div>
          <label class="toggle" style="margin:0;padding:0 14px 14px;background:var(--soft)"><input data-action="active-repositories" type="checkbox" \${activeRepositoriesOnly ? "checked" : ""}> Only repositories with active work</label>
        </details>
        \${showRepositoryManager ? repositoryManagerHtml() : ""}\`;
    }

    function repositoryManagerHtml() {
      const repositories = state.activity?.repositories || [];
      return \`
        <details class="secondary" data-state-key="repository-manager" open>
          <summary>Manage discovered Squad repositories</summary>
          <div class="secondary-content">
            <p>Excluded repositories remain visible here but are not refreshed or included in totals.</p>
            <div class="manage-list" data-scroll-key="repository-manager">
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

    function aggregateSyncDetail(activity, repositoryCount) {
      const attempted = formatTime(activity.lastAttemptedRefresh || activity.fetchedAt);
      const successful = formatTime(activity.lastSuccessfulRefresh);
      if (activity.partial || activity.stale) {
        return \`\${repositoryCount} repos · partial refresh \${attempted}\`;
      }
      return \`\${repositoryCount} repos · synced \${successful || attempted}\`;
    }

    function activeHtml() {
      const activity = state.activity || {};
      const summary = activity.summary || {};
      const goals = (activity.goals || []).filter(goalMatchesFilter).filter(goalMatchesScope);
      const lifecycle = ["queued", "researching", "implementing", "reviewing", "completed"];
      const repositories = (activity.repositories || []).filter(repository => repository.included).length;
      const inProgress = (summary.queued || 0) + (summary.researching || 0) + (summary.implementing || 0);
      const bootstrapAttention = repositoryBootstrapEntries().filter(entry =>
        ["delayed", "partial", "failed", "ambiguous", "malformed"].includes(entry.bootstrap?.status)).length;
      const needsAttention = (summary.blocked || 0) + (summary.failed || 0) + bootstrapAttention;
      return \`
        <section>
          <p class="sr-only">Live, read-only visibility from GitHub evidence.</p>
          <div class="metrics">
            \${metricHtml(activity.goals?.length || 0, "Goals tracked", {
              detail: \`\${summary.active || 0} active · \${summary.completed || 0} completed\`
            })}
            \${metricHtml(inProgress, "In progress", {
              aside: \`\${summary.queued || 0} queued\`,
              detail: \`\${summary.researching || 0} researching · \${summary.implementing || 0} implementing\`
            })}
            \${metricHtml(needsAttention, "Needs attention", {
              tone: needsAttention ? "danger" : "",
              aside: \`\${summary.failed || 0} failed\`,
              detail: \`\${summary.blocked || 0} blocked · \${bootstrapAttention} bootstrap\`
            })}
            \${metricHtml(summary.completed || 0, "Delivery", {
              tone: summary.awaitingReview ? "warning" : "",
              aside: \`\${summary.awaitingReview || 0} awaiting review\`,
              detail: aggregateSyncDetail(activity, repositories)
            })}
          </div>
          \${activity.partial || activity.stale || activity.errors?.length ? \`
            <div class="sync-warning" role="alert"><strong>Some GitHub data is from an earlier sync.</strong>
              <p>Showing the latest available data. Last attempted \${esc(formatTime(activity.lastAttemptedRefresh || activity.fetchedAt))}; \${activity.lastSuccessfulRefresh
                ? "last fully synced " + esc(formatTime(activity.lastSuccessfulRefresh))
                : "no complete sync yet"}. Totals and activity may be incomplete.</p>
              \${(activity.errors || []).map(error => '<p>' + esc(error.source) + ": " + esc(error.message) + "</p>").join("")}
            </div>\` : ""}
          \${localError ? \`<div class="sync-warning" role="alert"><strong>The canvas could not complete the local request.</strong><p>\${esc(localError)}</p></div>\` : ""}
          \${repositoryControlsHtml()}
          \${bootstrapSummariesHtml()}
          <div class="mission-layout">
            <div>
              <section class="pipeline-panel" aria-labelledby="pipeline-title">
                <div class="panel-header">
                  <div><h2 id="pipeline-title">Factory floor</h2></div>
                  <div class="floor-legend" aria-label="Factory floor status legend">
                    <span><i class="legend-dot" aria-hidden="true"></i> active</span>
                    <span><i class="legend-dot reviewing" aria-hidden="true"></i> reviewing</span>
                    <span><i class="legend-dot completed" aria-hidden="true"></i> completed</span>
                  </div>
                </div>
                <div class="pipeline-scroll" data-scroll-key="pipeline" role="region" aria-label="Factory floor stages" tabindex="0">
                  <div class="pipeline">
                    \${lifecycle.map(phase => stageHtml(phase, goals.filter(goal => goal.phase === phase))).join("")}
                  </div>
                </div>
                \${stageDetailHtml(goals)}
                <div class="pipeline-footer"><span>Select a stage to inspect its goals. Blocked and failed work stays separate.</span><span>\${goals.length} visible</span></div>
              </section>
              \${needsAttentionHtml(goals)}
              \${activeWorkflowRunsHtml(goals)}
              \${goals.length ? "" : \`
                <section class="empty" style="margin-top:14px">
                  <h2>\${phaseFilter === "all" ? "No goals found." : "No " + esc(phaseFilter) + " goals found."}</h2>
                  <p>Goals are recognized from issues carrying <code>squad</code> or <code>squad:*</code> labels, Squad commands, or structured Squad artifacts.</p>
                </section>\`}
            </div>
            \${recentActivityHtml(goals)}
          </div>
          \${squadContextHtml()}
          \${goalDrawerHtml()}
        </section>\`;
    }

    function render(focusSelector = "") {
      const uiSnapshot = captureUiState();
      let fallbackFocusSelector = "";
      const drawerGoalUnavailable = Boolean(state && selectedGoalId && !goalIsVisible(goalById(selectedGoalId)));
      updateHeader();
      if (!state) {
        app.innerHTML = '<div class="operation"><span class="spinner"></span><div>Loading Squad activity…</div></div>';
        return;
      }
      if (state.mode === "unavailable") {
        app.innerHTML = \`
          <section class="empty">
            <h1>Open this canvas from a project session.</h1>
            <p>The canvas needs the app’s active repository worktree. Open or create a Copilot project session, then reopen this canvas.</p>
          </section>\`;
        return;
      }
      if (drawerGoalUnavailable) {
        focusSelector = focusSelector || drawerReturnSelector;
        fallbackFocusSelector = ".pipeline-scroll";
        selectedGoalId = "";
        drawerReturnSelector = "";
      }
      app.innerHTML = activeHtml();
      document.body.style.overflow = selectedGoalId ? "hidden" : "";
      document.querySelector(".topbar")?.toggleAttribute("inert", Boolean(selectedGoalId));
      for (const element of document.querySelectorAll("#app > section > :not(.drawer-scrim):not(.goal-drawer)")) {
        element.toggleAttribute("inert", Boolean(selectedGoalId));
      }
      if (focusSelector && !document.querySelector(focusSelector)) {
        focusSelector = fallbackFocusSelector;
      }
      restoreUiState(uiSnapshot, focusSelector);
      if (drawerGoalUnavailable) announce("The selected goal is no longer visible. Goal details closed.");
    }

    async function refresh() {
      const response = await fetch("/api/state", { cache: "no-store" });
      const nextState = await response.json();
      const message = describeActivityDelta(state?.activity, nextState?.activity);
      replaceState(nextState);
      render();
      announce(message);
    }

    document.addEventListener("click", async event => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      if (target.closest(".filter-disclosure")) filtersOpen = true;
      try {
        if (action === "phase-filter") {
          phaseFilter = target.dataset.phase || "active";
          resetFeedPages();
          render();
          announce(filterAnnouncement());
        } else if (action === "bootstrap-filter") {
          bootstrapFilter = !bootstrapFilter;
          resetFeedPages();
          render();
          announce(filterAnnouncement());
        } else if (action === "activity-kind") {
          activityKindFilter = target.dataset.kind || "all";
          activityPageState = {};
          render(\`[data-action="activity-kind"][data-kind="\${CSS.escape(activityKindFilter)}"]\`);
          announce(\`Activity filtered by \${target.textContent.trim().toLowerCase()}.\`);
        } else if (action === "older-activity") {
          activityPageState = { anchor: activityPageView?.nextAnchor || "" };
          render('[data-action="older-activity"]');
          announce("Showing older evidence.");
        } else if (action === "newer-activity") {
          activityPageState = { endBefore: activityPageView?.anchor || "" };
          render('[data-action="newer-activity"]');
          announce("Showing newer evidence.");
        } else if (action === "older-workflows") {
          workflowPageState = { anchor: workflowPageView?.nextAnchor || "" };
          render('[data-action="older-workflows"]');
          announce("Showing older active workflow runs.");
        } else if (action === "newer-workflows") {
          workflowPageState = { endBefore: workflowPageView?.anchor || "" };
          render('[data-action="newer-workflows"]');
          announce("Showing newer active workflow runs.");
        } else if (action === "expand-stage") {
          const phase = target.dataset.phase || "";
          expandedStage = expandedStage === phase ? "" : phase;
          render(expandedStage ? "#stage-detail-title" : \`[data-action="expand-stage"][data-phase="\${CSS.escape(phase)}"]\`);
          const count = visibleGoals().filter(goal => goal.phase === phase).length;
          announce(expandedStage
            ? \`\${phase[0].toUpperCase() + phase.slice(1)} stage expanded; \${count} goal\${count === 1 ? "" : "s"} visible.\`
            : \`\${phase[0].toUpperCase() + phase.slice(1)} stage collapsed.\`);
        } else if (action === "close-stage") {
          const phase = expandedStage;
          expandedStage = "";
          render(\`[data-action="expand-stage"][data-phase="\${CSS.escape(phase)}"]\`);
          announce(\`\${phase[0].toUpperCase() + phase.slice(1)} stage collapsed.\`);
        } else if (action === "open-goal") {
          selectedGoalId = target.dataset.goalId || "";
          handoffProbeGoalId = selectedGoalId;
          handoffProbePending = true;
          handoffProbeComplete = false;
          const probeGoalId = selectedGoalId;
          const probeToken = ++handoffProbeToken;
          clearHandoffOverlay();
          handoffProbeGoalId = probeGoalId;
          handoffProbePending = true;
          const openSurface = target.dataset.openSurface;
          drawerReturnSelector = \`[data-action="open-goal"][data-goal-id="\${CSS.escape(selectedGoalId)}"]\${openSurface ? \`[data-open-surface="\${CSS.escape(openSurface)}"]\` : ""}\`;
          render(".drawer-close");
          try {
            const response = await fetch(\`/api/state?handoff=\${encodeURIComponent(probeGoalId)}\`, { cache: "no-store" });
            const nextState = await response.json();
            if (!response.ok) throw new Error(nextState.error || "Availability probe failed.");
            if (probeToken === handoffProbeToken && selectedGoalId === probeGoalId) {
              handoffProbeComplete = applyHandoffProbe(nextState, probeGoalId, probeToken);
            }
          } finally {
            if (probeToken === handoffProbeToken) {
              handoffProbePending = false;
              if (selectedGoalId === probeGoalId) render();
            }
          }
        } else if (action === "close-goal") {
          const returnSelector = drawerReturnSelector;
          selectedGoalId = "";
          drawerReturnSelector = "";
          handoffProbeGoalId = "";
          handoffProbePending = false;
          handoffProbeComplete = false;
          handoffProbeToken += 1;
          clearHandoffOverlay();
          render(returnSelector);
        } else if (action === "refresh-handoff") {
          const probeGoalId = selectedGoalId;
          const probeToken = ++handoffProbeToken;
          handoffProbeGoalId = probeGoalId;
          handoffProbePending = true;
          render();
          try {
            await post("/api/refresh");
            const response = await fetch(\`/api/state?handoff=\${encodeURIComponent(probeGoalId)}&refresh=1\`, { cache: "no-store" });
            const nextState = await response.json();
            if (!response.ok) throw new Error(nextState.error || "Handoff refresh failed.");
            if (probeToken === handoffProbeToken && selectedGoalId === probeGoalId) {
              handoffProbeComplete = applyHandoffProbe(nextState, probeGoalId, probeToken);
              if (handoffProbeComplete) announce("Handoff readiness refreshed.");
            }
          } finally {
            if (probeToken === handoffProbeToken) {
              handoffProbePending = false;
              render();
            }
          }
        } else if (action === "copy-handoff-context") {
          const goal = goalById(selectedGoalId);
          if (!goal) return;
          await navigator.clipboard.writeText(JSON.stringify(handoffContext(goal), null, 2));
          announce("Lossless handoff context copied.");
        } else if (action === "export-handoff-context") {
          const goal = goalById(selectedGoalId);
          if (!goal) return;
          const blob = new Blob([JSON.stringify(handoffContext(goal), null, 2) + "\\n"], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = \`handoff-\${String(goal.id).replaceAll(/[^a-z0-9._-]+/gi, "-")}.json\`;
          link.click();
          URL.revokeObjectURL(url);
          announce("Lossless handoff context exported.");
        } else if (action === "manage-repositories") {
          showRepositoryManager = !showRepositoryManager;
          render();
        } else if (action === "refresh-all") {
          refreshingAll = true;
          render();
          try {
            await post("/api/refresh");
            announce("Squad activity refresh complete.");
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

    document.addEventListener("toggle", event => {
      if (event.target !== document.querySelector(".filter-disclosure")) return;
      filtersOpen = event.target.open;
    }, true);

    document.addEventListener("keydown", event => {
      if (!selectedGoalId) return;
      if (event.key === "Escape") {
        event.preventDefault();
        const returnSelector = drawerReturnSelector;
        selectedGoalId = "";
        drawerReturnSelector = "";
        handoffProbeGoalId = "";
        handoffProbePending = false;
        handoffProbeComplete = false;
        handoffProbeToken += 1;
        clearHandoffOverlay();
        render(returnSelector);
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = document.querySelector(".goal-drawer");
      if (!drawer) return;
      const focusable = [...drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    document.addEventListener("change", async event => {
      const action = event.target.dataset.action;
      if (event.target.closest(".filter-disclosure")) filtersOpen = true;
      if (action === "owner-filter") {
        ownerFilter = event.target.value;
        repositoryFilter = "all";
        resetFeedPages();
        render();
        announce(filterAnnouncement());
        return;
      }
      if (action === "repository-filter") {
        repositoryFilter = event.target.value;
        resetFeedPages();
        render();
        announce(filterAnnouncement());
        return;
      }
      if (action === "active-repositories") {
        activeRepositoriesOnly = event.target.checked;
        resetFeedPages();
        render();
        announce(filterAnnouncement());
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
      filtersOpen = true;
      goalSearch = event.target.value;
      resetFeedPages();
      const cursor = event.target.selectionStart;
      render();
      const input = document.querySelector('[data-action="goal-search"]');
      if (input) {
        input.focus();
        input.setSelectionRange(cursor, cursor);
      }
      clearTimeout(searchAnnouncementTimer);
      searchAnnouncementTimer = setTimeout(() => announce(filterAnnouncement()), 250);
    });

    const events = new EventSource("/events");
    events.addEventListener("state", event => {
      const nextState = JSON.parse(event.data);
      const message = describeActivityDelta(state?.activity, nextState?.activity);
      replaceState(nextState);
      render();
      announce(message);
    });
    events.onerror = () => {
      if (state) {
        localError = "Canvas connection interrupted. Reopen the canvas to reconnect.";
        render();
        announce("Canvas connection interrupted. Reopen the canvas to reconnect.");
      }
    };

    refresh();
    setInterval(() => {
      refresh().catch(error => console.error("Unable to refresh Squad activity state.", error));
    }, 15000);
  </script>
</body>
</html>`;
}
