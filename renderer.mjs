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
    .operation {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      margin: 24px 0;
      padding: 13px 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--soft);
      color: var(--muted);
    }
    .operation strong { color: var(--text); }
    .operation.error { border-color: var(--danger); }
    .spinner {
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
      margin-top: 2px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .evidence {
      overflow: hidden;
      max-width: 900px;
      margin-top: 26px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
    }
    .evidence-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 16px 18px;
      background: var(--soft);
    }
    .evidence-header h2 { font-size: var(--text-body-large, 15px); }
    .evidence-header p {
      max-width: 68ch;
      margin: 4px 0 0;
      color: var(--muted);
      font-size: var(--text-body-small, 12px);
    }
    .evidence-count {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: var(--text-body-small, 12px);
      font-weight: var(--font-weight-semibold, 600);
      white-space: nowrap;
    }
    .evidence-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .evidence-item {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr);
      gap: 11px;
      align-items: start;
      padding: 12px 18px;
      border-top: 1px solid var(--border);
    }
    .evidence-dot {
      width: 7px;
      height: 7px;
      margin-top: 6px;
      border-radius: 50%;
      background: var(--accent);
    }
    .evidence-item p { margin: 0; color: var(--text); }
    .evidence details { border-top: 1px solid var(--border); }
    .evidence details .evidence-item:first-child { border-top: 0; }
    .evidence summary {
      padding: 11px 18px;
      color: var(--focus);
      cursor: pointer;
      font-weight: var(--font-weight-semibold, 600);
      list-style-position: inside;
    }
    .evidence summary:hover { text-decoration: underline; }
    .evidence-prompt {
      display: flex;
      gap: 7px;
      padding: 13px 18px;
      border-top: 1px solid var(--border);
      background: var(--accent-soft);
      font-size: var(--text-body-small, 12px);
    }
    .evidence-prompt span { color: var(--text); }
    .onboarding {
      overflow: hidden;
      margin-bottom: 34px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface);
    }
    .onboarding-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      padding: 16px 18px;
      background: var(--soft);
    }
    .onboarding-header h2 { font-size: var(--text-body-large, 15px); }
    .onboarding-header p {
      max-width: 68ch;
      margin: 4px 0 0;
      color: var(--muted);
      font-size: var(--text-body-small, 12px);
    }
    .onboarding-count {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: var(--text-body-small, 12px);
      font-weight: var(--font-weight-semibold, 600);
      white-space: nowrap;
    }
    .progress-track {
      height: 3px;
      background: var(--soft-strong);
    }
    .progress-fill {
      width: 100%;
      height: 100%;
      background: var(--accent);
      transform-origin: left center;
      transition: transform 260ms cubic-bezier(.22, 1, .36, 1);
    }
    .onboarding-steps {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
    .onboarding-step {
      min-width: 0;
      padding: 15px 14px 16px;
      border-right: 1px solid var(--border);
    }
    .onboarding-step:last-child { border-right: 0; }
    .onboarding-step.current { background: var(--accent-soft); }
    .step-heading {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .step-marker {
      width: 22px;
      height: 22px;
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      border: 1px solid var(--border-strong);
      border-radius: 50%;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }
    .onboarding-step.done .step-marker {
      border-color: var(--success);
      background: var(--success);
      color: var(--color-white, #ffffff);
    }
    .onboarding-step.current .step-marker {
      border-color: var(--accent);
      background: var(--accent);
      color: var(--color-white, #ffffff);
    }
    .step-heading strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .step-copy {
      margin: 7px 0 0 30px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.4;
    }
    .onboarding-step.current .step-copy { color: var(--text); }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(280px, .75fr);
      gap: 32px;
      margin-top: 32px;
      align-items: start;
    }
    .section-heading {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
    }
    .section-heading p { margin: 4px 0 0; color: var(--muted); font-size: var(--text-body-small, 12px); }
    .member-list {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
    }
    .member {
      width: 100%;
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 14px;
      border: 0;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      text-align: left;
      cursor: pointer;
    }
    .member:last-child { border-bottom: 0; }
    .member:hover { background: var(--soft); }
    .member.selected { background: var(--accent-soft); }
    .avatar {
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border-radius: 9px;
      background: var(--soft-strong);
      color: var(--accent);
      font-weight: 750;
      font-size: var(--text-body-small, 12px);
    }
    .member-heading { gap: 7px; min-width: 0; }
    .member-heading strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      padding: 2px 6px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      font-size: 10px;
      white-space: nowrap;
    }
    .member-role {
      overflow: hidden;
      margin-top: 2px;
      color: var(--muted);
      font-size: var(--text-body-small, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .arrow { color: var(--muted); }
    .panel {
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
    }
    .panel.sticky { position: sticky; top: 18px; }
    .panel-copy { margin: 6px 0 16px; color: var(--muted); font-size: var(--text-body-small, 12px); }
    .field { margin-top: 14px; }
    .field label {
      display: block;
      margin-bottom: 5px;
      font-size: var(--text-body-small, 12px);
      font-weight: var(--font-weight-semibold, 600);
    }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg);
      color: var(--text);
    }
    input, select { height: 38px; padding: 0 10px; }
    textarea { min-height: 120px; padding: 9px 10px; resize: vertical; line-height: 1.45; }
    textarea.goal { min-height: 112px; }
    .help { margin: 5px 0 0; color: var(--muted); font-size: 11px; }
    .dirty {
      margin-top: 12px;
      padding: 9px 10px;
      border-radius: 8px;
      background: var(--accent-soft);
      font-size: var(--text-body-small, 12px);
    }
    .summary {
      margin: 24px 0 0;
      padding: 18px 0 0;
      border-top: 1px solid var(--border);
      color: var(--muted);
    }
    .summary strong { color: var(--text); }
    .confirmation {
      margin-top: 14px;
      padding: 13px;
      border: 1px solid var(--accent);
      border-radius: 10px;
      background: var(--accent-soft);
    }
    .confirmation p { margin: 0 0 11px; }
    .pr-result {
      gap: 10px;
      margin-top: 18px;
      padding: 13px;
      border: 1px solid var(--success);
      border-radius: 10px;
    }
    .pr-result a { color: var(--focus); font-weight: var(--font-weight-semibold, 600); }
    .next-action {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 22px;
      align-items: center;
      margin-top: 22px;
      padding: 22px;
      border: 1px solid var(--accent);
      border-radius: 12px;
      background: var(--accent-soft);
    }
    .next-action h2 { font-size: var(--text-title-large, 24px); }
    .next-action p {
      max-width: 68ch;
      margin: 6px 0 0;
      color: var(--text);
    }
    .next-action .button { min-height: 44px; padding-inline: 18px; }
    .cast-result {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      margin-top: 22px;
      padding: 16px;
      border: 1px solid var(--success);
      border-radius: 10px;
      background: color-mix(in srgb, var(--success) 7%, var(--bg));
    }
    .cast-result strong { color: var(--text); }
    .cast-result p { margin: 3px 0 7px; color: var(--muted); }
    .cast-result a { color: var(--focus); font-weight: var(--font-weight-semibold, 600); }
    .mission-intro {
      margin-top: 30px;
      padding: 22px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
    }
    .mission-intro h2 { margin-bottom: 7px; }
    .mission-intro > p { max-width: 720px; margin: 0 0 17px; color: var(--muted); }
    .task-list { display: grid; gap: 9px; margin-top: 16px; }
    .task {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 210px;
      gap: 16px;
      padding: 13px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
    }
    .task p { margin: 4px 0 0; color: var(--muted); font-size: var(--text-body-small, 12px); }
    .task select { align-self: center; }
    .override { margin-top: 5px; color: var(--warning); font-size: 11px; }
    .topology {
      margin-top: 18px;
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--soft);
    }
    .topology-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
    }
    .topology-node {
      width: 156px;
      padding: 10px;
      border: 1px solid var(--border-strong);
      border-radius: 9px;
      background: var(--surface);
      text-align: center;
    }
    .topology-node span { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; }
    .connector { margin: 8px 0; color: var(--muted); text-align: center; }
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
      grid-template-columns: repeat(5, minmax(0, 1fr));
      margin-top: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 7px;
    }
    .metric {
      min-width: 0;
      padding: 12px 14px;
      border-right: 1px solid var(--border);
      background: var(--surface);
    }
    .metric:last-child { border-right: 0; }
    .metric strong { display: block; font-size: 20px; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .metric span { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; }
    .metric.danger strong { color: var(--danger); }
    .metric.warning strong { color: var(--warning); }
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
    .pipeline-panel, .activity-panel, .exceptions {
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
      grid-template-columns: repeat(5, minmax(0, 1fr));
      width: 100%;
      min-width: 0;
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
      min-height: 108px;
      display: block;
      padding: 14px 14px 8px;
      border: 0;
      background: transparent;
      color: var(--text);
      text-align: left;
      cursor: pointer;
    }
    .stage-heading { display: flex; align-items: center; gap: 8px; }
    .stage-heading strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-transform: capitalize; white-space: nowrap; }
    .stage-icon {
      width: 22px;
      height: 22px;
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 15px;
      line-height: 1;
    }
    .stage-load { display: flex; align-items: baseline; gap: 7px; margin-top: 20px; }
    .stage-load b { color: var(--warning); font-size: 28px; line-height: 1; font-weight: 500; font-variant-numeric: tabular-nums; }
    .stage-load span { color: var(--muted); font-size: 12px; }
    .stage-preview {
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-height: 44px;
      padding: 0 14px 10px;
    }
    .stage-goal-chip, .stage-more {
      width: 38px;
      height: 38px;
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      padding: 0;
      border: 1px solid var(--border-strong);
      border-radius: 7px;
      background: var(--bg);
      color: var(--text);
      cursor: pointer;
      font-size: 10px;
      font-weight: var(--font-weight-semibold, 600);
      font-variant-numeric: tabular-nums;
    }
    .stage-goal-chip:hover, .stage-more:hover { border-color: var(--warning); }
    .stage-card.researching .stage-goal-chip,
    .stage-card.implementing .stage-goal-chip { border-color: var(--warning); }
    .stage-card.reviewing .stage-goal-chip { border-color: var(--accent); }
    .stage-card.completed .stage-goal-chip { border-color: var(--success); }
    .stage-more { color: var(--muted); font-size: 11px; font-weight: 400; }
    .stage-foot {
      min-height: 35px;
      padding: 8px 14px 10px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 11px;
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
    .stage-detail-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .stage-detail-heading h3 { text-transform: capitalize; }
    .stage-goals { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 9px; margin-top: 12px; }
    .exceptions { margin-top: 14px; }
    .exception-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 14px; }
    .exception-lane { min-width: 0; padding: 12px; border: 1px solid var(--border); border-radius: 7px; }
    .exception-lane.danger { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }
    .exception-lane.danger h3 { color: var(--danger); }
    .exception-lane h3 { display: flex; justify-content: space-between; gap: 8px; }
    .exception-lane .stage-goals { grid-template-columns: 1fr; }
    .activity-panel { position: sticky; top: 14px; }
    .activity-stream { margin: 0; padding: 0; list-style: none; }
    .activity-item { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 9px; padding: 11px 14px; border-top: 1px solid var(--border); }
    .activity-item:first-child { border-top: 0; }
    .activity-dot { width: 7px; height: 7px; margin-top: 6px; border-radius: 50%; background: var(--accent); }
    .activity-item a { color: var(--text); font-weight: var(--font-weight-semibold, 600); text-decoration: none; }
    .activity-item a:hover { color: var(--focus); text-decoration: underline; }
    .activity-item small { display: block; margin-top: 3px; color: var(--muted); }
    .activity-more {
      border-top: 1px solid var(--border);
    }
    .activity-more > summary {
      min-height: 44px;
      display: flex;
      align-items: center;
      padding: 0 14px;
      color: var(--focus);
      cursor: pointer;
      font-weight: var(--font-weight-semibold, 600);
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
    .sync-warning {
      margin-top: 16px;
      padding: 12px 14px;
      border: 1px solid var(--warning);
      border-radius: 9px;
      background: color-mix(in srgb, var(--warning) 8%, var(--bg));
    }
    .sync-warning p { margin: 4px 0 0; color: var(--muted); }
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
    .drawer-item a { color: var(--focus); font-weight: var(--font-weight-semibold, 600); }
    .drawer-item small { display: block; margin-top: 3px; color: var(--muted); }
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
      .onboarding-header { align-items: flex-start; }
      .onboarding-steps { grid-template-columns: 1fr; }
      .onboarding-step {
        display: grid;
        grid-template-columns: 1fr;
        padding: 12px 14px;
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }
      .onboarding-step:last-child { border-bottom: 0; }
      .step-copy { margin-top: 3px; }
      .layout { grid-template-columns: 1fr; gap: 20px; }
      .panel.sticky { position: static; }
      .task { grid-template-columns: 1fr; }
      .next-action { grid-template-columns: 1fr; }
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
      .exception-grid { grid-template-columns: 1fr; }
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
    let selectedMemberId = "";
    let confirmSetup = false;
    let confirmCast = false;
    let confirmMission = false;
    let confirmCharters = false;
    let phaseFilter = "all";
    let repositoryFilter = "all";
    let ownerFilter = "all";
    let goalSearch = "";
    let activeRepositoriesOnly = false;
    let showRepositoryManager = false;
    let refreshingAll = false;
    let expandedStage = "";
    let selectedGoalId = "";
    let drawerReturnSelector = "";
    let filtersOpen = false;

    const app = document.getElementById("app");
    const repoHeader = document.getElementById("repo-header");
    const liveStatus = document.getElementById("live-status");

    function esc(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function announce(message) {
      liveStatus.textContent = "";
      requestAnimationFrame(() => {
        liveStatus.textContent = message;
      });
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

    function operationHtml() {
      if (!state?.operation) return "";
      const operation = state.operation;
      const running = operation.status === "running";
      const error = operation.status === "error";
      return \`
        <div class="operation \${error ? "error" : ""}">
          \${running ? '<span class="spinner" aria-hidden="true"></span>' : ""}
          <div><strong>\${running ? "Working" : error ? "Needs attention" : "Complete"}</strong><br>\${esc(operation.message)}</div>
        </div>\`;
    }

    function prHtml() {
      if (!state?.pullRequest?.url) return "";
      const automation = state.pullRequest.kind === "automation-pr";
      const automationMerged = automation &&
        (state.pullRequest.status === "merged" || state.onboarding?.automation?.status === "merged");
      return \`
        <div class="pr-result">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>\${automation
              ? automationMerged ? "Automation PR merged · 1 of 2 complete" : "Automation PR created · 1 of 2"
              : "Pull request created"}</strong><br>
            \${automation
              ? automationMerged
                ? "Next: create the cast issue below to start pull request 2.<br>"
                : "Review and merge the repository bootstrap. This canvas checks GitHub automatically.<br>"
              : ""}
            <a href="\${esc(state.pullRequest.url)}" target="_blank" rel="noreferrer">Open on GitHub ↗</a>
          </div>
        </div>\`;
    }

    function castActionHtml() {
      const automationMerged = state?.onboarding?.automation?.status === "merged";
      if (!automationMerged) return "";
      const cast = state?.onboarding?.cast;
      if (cast?.issueUrl) {
        return \`
          <div class="cast-result">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>Cast issue created · Squad started</strong>
              <p>The approved roster and charters are in the issue. The <code>/squad cast</code> comment is posted; Squad will open pull request 2 of 2.</p>
              <a href="\${esc(cast.issueUrl)}" target="_blank" rel="noreferrer">Open Cast the Squad #\${esc(cast.issueNumber)} ↗</a>
            </div>
          </div>\`;
      }
      const running = state?.operation?.kind === "cast-issue" && state.operation.status === "running";
      return \`
        <section class="next-action" aria-labelledby="cast-action-title">
          <div>
            <h2 id="cast-action-title">Cast the team you approved.</h2>
            <p>Create one issue containing this \${state.members.length}-member roster and every operating charter, then post <code>/squad cast</code> to start pull request 2 of 2.</p>
          </div>
          <button class="button primary" data-action="confirm-cast" type="button" \${running ? "disabled" : ""}>\${running ? "Creating issue…" : "Create cast issue"}</button>
        </section>
        \${confirmCast ? \`
          <div class="confirmation">
            <p><strong>Create “Cast the Squad” and start casting?</strong><br>The issue will contain the approved team as Markdown. The canvas will then post <code>/squad cast</code>, and Squad will create pull request 2 of 2 without merging it.</p>
            <div class="actions">
              <button class="button" data-action="cancel-confirm" type="button">Cancel</button>
              <button class="button primary" data-action="create-cast-issue" type="button">Create issue and start Squad</button>
            </div>
          </div>\` : ""}\`;
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
      const synced = state.activity?.fetchedAt ? \` · synced \${formatTime(state.activity.fetchedAt)}\` : "";
      repoHeader.innerHTML = \`<span>\${esc(watching)}\${esc(synced)}</span><span class="mode">\${active} active</span>\`;
    }

    function memberBadge(member) {
      if (member.lead) return '<span class="badge">Lead</span>';
      if (member.reviewer) return '<span class="badge">Reviewer</span>';
      return "";
    }

    function memberListHtml() {
      return \`
        <div class="member-list">
          \${state.members.map(member => \`
            <button class="member \${selectedMemberId === member.id ? "selected" : ""}" data-action="select-member" data-id="\${esc(member.id)}" type="button">
              <span class="avatar">\${esc(initials(member.name))}</span>
              <span>
                <span class="member-heading"><strong>\${esc(member.name)}</strong>\${memberBadge(member)}</span>
                <span class="member-role">\${esc(member.draftRole || member.role)}</span>
              </span>
              <span class="arrow" aria-hidden="true">›</span>
            </button>
          \`).join("")}
        </div>\`;
    }

    function memberEditorHtml() {
      const member = state.members.find(item => item.id === selectedMemberId) || state.members[0];
      if (!member) return '<div class="panel"><p>No member selected.</p></div>';
      selectedMemberId = member.id;
      return \`
        <aside class="panel sticky">
          <h2>\${esc(member.name)}</h2>
          <p class="panel-copy">\${esc(member.rationale || "Review and refine this member’s operating charter.")}</p>
          <form data-form="member" data-id="\${esc(member.id)}">
            <div class="field">
              <label for="role-field">Role</label>
              <input id="role-field" name="role" value="\${esc(member.draftRole || member.role)}">
            </div>
            <div class="field">
              <label for="charter-field">Operating charter</label>
              <textarea id="charter-field" name="charter">\${esc(member.draftCharter || member.charter)}</textarea>
              <p class="help">Saved as a draft until you explicitly create a pull request.</p>
            </div>
            <div class="actions" style="margin-top:14px">
              <button class="button primary" type="submit">Save draft</button>
            </div>
          </form>
          \${member.dirty ? '<div class="dirty">This member has unapplied charter changes.</div>' : ""}
        </aside>\`;
    }

    function onboardingSnapshot() {
      const hasProposal = Boolean(state?.members?.length);
      const automationMerged = state?.onboarding?.automation?.status === "merged";
      const setupStarted =
        (state?.operation?.kind === "automation-pr" && state?.operation?.status === "running") ||
        state?.pullRequest?.kind === "automation-pr" ||
        (state?.operation?.kind === "setup-pr" && state?.operation?.status === "running") ||
        state?.pullRequest?.kind === "setup-pr";
      const active = state?.mode === "active";
      const current = active ? 6 : automationMerged ? 5 : setupStarted ? 4 : hasProposal ? 3 : 2;
      const steps = [
        {
          title: "Repository connected",
          description: "Use the active project-session worktree."
        },
        {
          title: "Repository analyzed",
          description: "Inspect code, tests, docs, and ownership signals."
        },
        {
          title: "Review team",
          description: "Shape roles and charters—no task assignment required."
        },
        {
          title: "Install automation",
          description: "Pull request 1 of 2 · add gh-aw and Squad workflows."
        },
        {
          title: "Cast your Squad",
          description: "Pull request 2 of 2 · review and merge the generated team."
        },
        {
          title: "Squad ready",
          description: "Start real missions through issues and reviewed pull requests."
        }
      ];
      return {
        active,
        current,
        steps,
        percent: active ? 100 : ((current - 1) / (steps.length - 1)) * 100
      };
    }

    function onboardingProgressHtml() {
      const progress = onboardingSnapshot();
      const currentStep = progress.steps[progress.current - 1];
      return \`
        <nav class="onboarding" aria-label="Squad onboarding progress">
          <div class="onboarding-header">
            <div>
              <h2>Repository onboarding</h2>
              <p>\${progress.active
                ? "Setup is complete. This repository now owns its Squad configuration."
                : \`Current step: \${esc(currentStep.title)}. \${esc(currentStep.description)}\`}</p>
            </div>
            <span class="onboarding-count">\${progress.active ? "Complete" : \`Step \${progress.current} of \${progress.steps.length}\`}</span>
          </div>
          <div class="progress-track" role="progressbar" aria-label="Onboarding completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="\${Math.round(progress.percent)}">
            <div class="progress-fill" style="transform:scaleX(\${progress.percent / 100})"></div>
          </div>
          <div class="onboarding-steps">
            \${progress.steps.map((step, index) => {
              const position = index + 1;
              const done = progress.active || position < progress.current;
              const isCurrent = !progress.active && position === progress.current;
              const className = done ? "done" : isCurrent ? "current" : "upcoming";
              const marker = done ? "✓" : String(position);
              return \`
                <div class="onboarding-step \${className}" \${isCurrent ? 'aria-current="step"' : ""}>
                  <div class="step-heading">
                    <span class="step-marker" aria-hidden="true">\${marker}</span>
                    <strong>\${esc(step.title)}</strong>
                  </div>
                  <p class="step-copy">\${esc(step.description)}</p>
                </div>\`;
            }).join("")}
          </div>
        </nav>\`;
    }

    function evidenceItemsHtml(signals) {
      return signals.map(signal => \`
        <li class="evidence-item">
          <span class="evidence-dot" aria-hidden="true"></span>
          <p>\${esc(signal)}</p>
        </li>\`).join("");
    }

    function evidenceHtml() {
      const signals = Array.isArray(state.signals) ? state.signals : [];
      if (!signals.length) return "";
      const visible = signals.slice(0, 3);
      const remaining = signals.slice(3);
      return \`
        <section class="evidence" aria-labelledby="evidence-title">
          <div class="evidence-header">
            <div>
              <h2 id="evidence-title">Why Squad proposed this team</h2>
              <p>These repository findings shaped the recommended roles and ownership boundaries. They are evidence—not setup tasks or warnings.</p>
            </div>
            <span class="evidence-count">\${signals.length} finding\${signals.length === 1 ? "" : "s"}</span>
          </div>
          <ul class="evidence-list">
            \${evidenceItemsHtml(visible)}
          </ul>
          \${remaining.length ? \`
            <details>
              <summary>Show \${remaining.length} more finding\${remaining.length === 1 ? "" : "s"}</summary>
              <ul class="evidence-list">
                \${evidenceItemsHtml(remaining)}
              </ul>
            </details>\` : ""}
          <div class="evidence-prompt">
            <strong>Want to reshape the cast?</strong>
            <span>Tell Copilot what to split, combine, add, or remove. The proposal updates before any pull request is created.</span>
          </div>
        </section>\`;
    }

    function setupHtml() {
      const hasProposal = state.members.length > 0;
      const automationStarted =
        (state.operation?.kind === "automation-pr" && state.operation?.status === "running") ||
        state.pullRequest?.kind === "automation-pr" ||
        Boolean(state.onboarding?.automation);
      return \`
        \${onboardingProgressHtml()}
        <section>
          <h1>\${hasProposal ? "Meet the Squad we’d start with." : "Build the team this repo needs."}</h1>
          <p class="lede">\${hasProposal
            ? esc(state.summary || "A repository-specific team proposal. Review the people and their charters; Squad owns the initial division of work.")
            : "Copilot will inspect the repository and propose a small team with clear charters. You won’t be asked to predict hypothetical assignments during onboarding."}</p>
          \${evidenceHtml()}
          \${operationHtml()}
          \${prHtml()}
          \${castActionHtml()}
          \${!hasProposal ? \`
            <div class="hero-actions">
              <button class="button primary" data-action="analyze" type="button" \${state.operation?.status === "running" ? "disabled" : ""}>Analyze repository</button>
            </div>\` : \`
            <div class="layout">
              <section>
                <div class="section-heading"><div><h2>Proposed team</h2><p>Squad recommends; you can refine.</p></div></div>
                \${memberListHtml()}
                <div class="summary">
                  <strong>\${state.members.length} members</strong> · charters stay editable · no assignments required yet
                </div>
                \${!automationStarted ? \`
                  <div class="actions" style="margin-top:18px">
                    <button class="button" data-action="reanalyze" type="button">Analyze again</button>
                    <button class="button primary" data-action="confirm-setup" type="button">Create automation PR · 1 of 2</button>
                  </div>\` : ""}
                \${confirmSetup ? \`
                  <div class="confirmation">
                    <p><strong>Create onboarding pull request 1 of 2?</strong><br>This first PR installs gh-aw and the Squad workflows. After you merge it, ask Copilot to create the cast issue; Squad will open a separate PR containing the approved team. Neither PR is merged automatically.</p>
                    <div class="actions">
                      <button class="button" data-action="cancel-confirm" type="button">Cancel</button>
                      <button class="button primary" data-action="create-automation-pr" type="button">Create automation PR</button>
                    </div>
                  </div>\` : ""}
              </section>
              \${memberEditorHtml()}
            </div>\`}
        </section>\`;
    }

    function topologyHtml() {
      const ownerIds = [...new Set(state.mission.tasks.map(task => task.ownerId))];
      const owners = ownerIds.map(id => state.members.find(member => member.id === id)).filter(Boolean);
      const lead = state.members.find(member => member.lead) || state.members[0];
      const reviewer = state.members.find(member => member.reviewer);
      return \`
        <div class="topology" aria-label="Proposed mission topology">
          <div class="topology-row"><div class="topology-node"><strong>\${esc(lead?.name || "Squad lead")}</strong><span>Plans and synthesizes</span></div></div>
          <div class="connector" aria-hidden="true">↓</div>
          <div class="topology-row">
            \${owners.map(owner => '<div class="topology-node"><strong>' + esc(owner.name) + '</strong><span>' + esc(owner.role) + '</span></div>').join("")}
          </div>
          <div class="connector" aria-hidden="true">↓ evidence returns to lead ↓</div>
          <div class="topology-row"><div class="topology-node"><strong>\${esc(reviewer?.name || "Independent review")}</strong><span>Reviews the exact candidate</span></div><div class="topology-node"><strong>Pull request</strong><span>Human review and merge</span></div></div>
        </div>\`;
    }

    function missionHtml() {
      if (!state.mission) {
        return \`
          <section class="mission-intro">
            <h2>Give the Squad a real mission</h2>
            <p>Describe the outcome. Squad will inspect the repo, break the work down, and propose ownership. You review exceptions instead of inventing assignments up front.</p>
            <form data-form="mission">
              <textarea class="goal" name="goal" placeholder="For example: Add OAuth device flow support and open a pull request."></textarea>
              <div class="actions" style="margin-top:12px"><button class="button primary" type="submit">Plan with Squad</button></div>
            </form>
          </section>\`;
      }
      if (!state.mission.tasks?.length) {
        return \`
          <section class="mission-intro">
            <h2>Planning the mission</h2>
            <p>Squad is inspecting the repository, decomposing the goal, and choosing likely owners.</p>
            <div class="operation"><span class="spinner" aria-hidden="true"></span><div><strong>Planning</strong><br>\${esc(state.mission.goal)}</div></div>
          </section>\`;
      }
      return \`
        <section class="mission-intro">
          <div class="section-heading">
            <div><h2>Review Squad’s plan</h2><p>\${esc(state.mission.summary || state.mission.goal)}</p></div>
            <button class="button" data-action="clear-mission" type="button">Start over</button>
          </div>
          \${topologyHtml()}
          <div class="task-list">
            \${state.mission.tasks.map(task => \`
              <article class="task">
                <div>
                  <h3>\${esc(task.title)}</h3>
                  <p>\${esc(task.description || task.rationale)}</p>
                  \${task.overridden ? '<div class="override">Ownership changed by you</div>' : ""}
                </div>
                <label>
                  <span class="help">Owner</span>
                  <select data-action="task-owner" data-task-id="\${esc(task.id)}">
                    \${state.members.map(member => '<option value="' + esc(member.id) + '"' + (member.id === task.ownerId ? " selected" : "") + ">" + esc(member.name) + " · " + esc(member.role) + "</option>").join("")}
                  </select>
                </label>
              </article>
            \`).join("")}
          </div>
          <div class="actions" style="margin-top:18px">
            <button class="button primary" data-action="confirm-mission" type="button">Start work</button>
          </div>
          \${confirmMission ? \`
            <div class="confirmation">
              <p><strong>Execute this plan?</strong><br>The project session will coordinate specialist evidence, produce one reviewed candidate, and open a pull request. It will not merge.</p>
              <div class="actions">
                <button class="button" data-action="cancel-confirm" type="button">Cancel</button>
                <button class="button primary" data-action="start-mission" type="button">Execute and create PR</button>
              </div>
            </div>\` : ""}
        </section>\`;
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

    function goalById(id) {
      return (state.activity?.goals || []).find(goal => goal.id === id);
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
      const preview = goals.slice(0, 2);
      const selected = expandedStage === phase;
      const icons = {
        queued: "▣",
        researching: "⌕",
        implementing: "<>",
        reviewing: "◇",
        completed: "✓"
      };
      const pullRequests = goals.reduce((total, goal) => total + (goal.pullRequests?.length || 0), 0);
      const workflowRuns = goals.reduce((total, goal) => total + (goal.workflowRuns?.length || 0), 0);
      return \`
        <section class="stage-card \${esc(phase)} \${selected ? "selected" : ""}">
          <button class="stage-button" data-action="expand-stage" data-phase="\${phase}" type="button"
            aria-expanded="\${selected}" aria-controls="stage-detail">
            <span class="stage-heading">
              <span class="stage-icon" aria-hidden="true">\${icons[phase] || "·"}</span>
              <strong>\${esc(phase)}</strong>
            </span>
            <span class="stage-load"><b>\${goals.length}</b><span>\${goals.length === 1 ? "goal" : "goals"}</span></span>
          </button>
          <div class="stage-preview">
            \${preview.map(goal => \`
              <button class="stage-goal-chip" data-action="open-goal" data-goal-id="\${esc(goal.id)}" type="button"
                aria-label="Open #\${esc(goal.issue.number)}: \${esc(goal.issue.title)}">#\${esc(goal.issue.number)}</button>
            \`).join("")}
            \${goals.length > preview.length ? \`
              <button class="stage-more" data-action="expand-stage" data-phase="\${phase}" type="button"
                aria-label="Inspect \${goals.length - preview.length} more \${esc(phase)} goals">+\${goals.length - preview.length}</button>
            \` : ""}
          </div>
          <div class="stage-foot"><strong>\${pullRequests}</strong> PR\${pullRequests === 1 ? "" : "s"} · <strong>\${workflowRuns}</strong> run\${workflowRuns === 1 ? "" : "s"}</div>
        </section>\`;
    }

    function stageDetailHtml(goals) {
      if (!expandedStage) return "";
      const stageGoals = goals.filter(goal => goal.phase === expandedStage);
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
            \${stageGoals.length ? stageGoals.map(goal => goalTriggerHtml(goal)).join("") : '<p class="help">No visible goals are in this stage.</p>'}
          </div>
        </section>\`;
    }

    function exceptionLaneHtml(phase, goals) {
      const laneGoals = goals.filter(goal => goal.phase === phase);
      return \`
        <section class="exception-lane danger" aria-labelledby="\${phase}-title">
          <h3 id="\${phase}-title"><span>\${esc(phase)}</span><span>\${laneGoals.length}</span></h3>
          <p class="help">\${phase === "blocked" ? "Dependencies or an explicit blocker need attention." : "A workflow or required check has failed."}</p>
          <div class="stage-goals">
            \${laneGoals.length ? laneGoals.map(goal => goalTriggerHtml(goal)).join("") : '<p class="help">No goals need attention.</p>'}
          </div>
        </section>\`;
    }

    function recentActivityHtml(goals) {
      const activity = goals.flatMap(goal =>
        (goal.evidence || []).map(item => ({ ...item, goal })))
        .sort((left, right) => String(right.timestamp || "").localeCompare(String(left.timestamp || "")))
        .slice(0, 18);
      const visibleActivity = activity.slice(0, 8);
      const olderActivity = activity.slice(8);
      const itemsHtml = items => items.map(item => \`
        <li class="activity-item">
          <span class="activity-dot" aria-hidden="true"></span>
          <div>
            <a href="\${esc(item.url || item.goal.issue.url)}" target="_blank" rel="noreferrer">\${esc(item.title)}</a>
            <small>#\${esc(item.goal.issue.number)} · \${esc(item.goal.repository.nameWithOwner)} · \${esc(formatTime(item.timestamp))}\${item.confidence === "inferred" ? " · inferred" : ""}</small>
          </div>
        </li>\`).join("");
      return \`
        <aside class="activity-panel" aria-labelledby="activity-title">
          <div class="panel-header">
            <div><h2 id="activity-title">Activity</h2><p>Newest evidence first.</p></div>
            <span class="evidence-count">\${activity.length}</span>
          </div>
          \${activity.length ? \`
            <ol class="activity-stream">
              \${itemsHtml(visibleActivity)}
            </ol>
            \${olderActivity.length ? \`
              <details class="activity-more">
                <summary>Show \${olderActivity.length} older events</summary>
                <ol class="activity-stream">\${itemsHtml(olderActivity)}</ol>
              </details>\` : ""}
            \` : '<p class="help" style="padding:14px">No correlated evidence is available for the current filters.</p>'}
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

    function goalDrawerHtml() {
      const goal = goalById(selectedGoalId);
      if (!goal) return "";
      return \`
        <div class="drawer-scrim" data-action="close-goal" aria-hidden="true"></div>
        <aside class="goal-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-describedby="drawer-description">
          <div class="drawer-header">
            <div>
              <span class="phase \${esc(goal.phase)}">\${esc(goal.phase)}</span>
              <h2 id="drawer-title" style="margin-top:8px">#\${esc(goal.issue.number)} · \${esc(goal.issue.title)}</h2>
              <p id="drawer-description">\${esc(goal.repository.nameWithOwner)}</p>
            </div>
            <button class="button drawer-close" data-action="close-goal" type="button" aria-label="Close goal details">×</button>
          </div>
          <div class="drawer-body">
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
            <section class="drawer-section"><h3>Dependencies</h3>\${dependencyItemsHtml(goal)}</section>
            <section class="drawer-section"><h3>Pull requests and checks</h3>\${pullRequestItemsHtml(goal)}</section>
            <section class="drawer-section"><h3>Workflow runs</h3>\${workflowItemsHtml(goal)}</section>
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
      const activeFilters = [
        phaseFilter !== "all" ? phaseFilter : "",
        ownerFilter !== "all" ? ownerFilter : "",
        repositoryFilter !== "all" ? repositoryFilter === "current" ? "current repo" : repositoryFilter : "",
        goalSearch ? \`“\${goalSearch}”\` : "",
        activeRepositoriesOnly ? "active repos" : "",
      ].filter(Boolean);
      const filters = ["active", "queued", "researching", "implementing", "reviewing", "blocked", "failed", "completed", "all"];
      return \`
        <details class="filter-disclosure" \${filtersOpen ? "open" : ""}>
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
            \${filters.map(filter => \`<button class="filter \${phaseFilter === filter ? "selected" : ""}" data-action="phase-filter" data-phase="\${filter}" type="button" aria-pressed="\${phaseFilter === filter}">\${esc(filter)}</button>\`).join("")}
          </div>
          <label class="toggle" style="margin:0;padding:0 14px 14px;background:var(--soft)"><input data-action="active-repositories" type="checkbox" \${activeRepositoriesOnly ? "checked" : ""}> Only repositories with active work</label>
        </details>
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
                  <span><strong>\${esc(repository.nameWithOwner)}</strong><br><small>\${esc(repository.error || "Last refreshed " + formatTime(repository.lastSuccessfulRefresh))}</small></span>
                  <small>\${repository.nameWithOwner.toLowerCase() === String(state.activity?.currentRepository || "").toLowerCase() ? "Current" : repository.permission || ""}</small>
                </label>\`).join("")}
            </div>
          </div>
        </details>\`;
    }

    function activeHtml() {
      const activity = state.activity || {};
      const summary = activity.summary || {};
      const goals = (activity.goals || []).filter(goalMatchesFilter).filter(goalMatchesScope);
      const lifecycle = ["queued", "researching", "implementing", "reviewing", "completed"];
      return \`
        <section>
          <div class="metrics">
            \${metricHtml(summary.active || 0, "Active goals")}
            \${metricHtml(summary.blocked || 0, "Blocked", summary.blocked ? "danger" : "")}
            \${metricHtml(summary.failed || 0, "Failed", summary.failed ? "danger" : "")}
            \${metricHtml(summary.awaitingReview || 0, "Awaiting review", summary.awaitingReview ? "warning" : "")}
            \${metricHtml(summary.completed || 0, "Completed")}
          </div>
          \${activity.errors?.length ? \`
            <div class="sync-warning" role="alert"><strong>Some GitHub data could not be refreshed.</strong>
              \${activity.errors.map(error => '<p>' + esc(error.source) + ": " + esc(error.message) + "</p>").join("")}
            </div>\` : ""}
          \${repositoryControlsHtml()}
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
                <div class="pipeline-scroll" role="region" aria-label="Factory floor stages" tabindex="0">
                  <div class="pipeline">
                    \${lifecycle.map(phase => stageHtml(phase, goals.filter(goal => goal.phase === phase))).join("")}
                  </div>
                </div>
                \${stageDetailHtml(goals)}
                <div class="pipeline-footer"><span>Select a stage to inspect its goals. Blocked and failed work stays separate.</span><span>\${goals.length} visible</span></div>
              </section>
              <section class="exceptions" aria-labelledby="exceptions-title">
                <div class="panel-header">
                  <div><h2 id="exceptions-title">Needs attention</h2><p>Exceptions are separated from forward lifecycle stages.</p></div>
                  <span class="evidence-count">\${goals.filter(goal => goal.phase === "blocked" || goal.phase === "failed").length}</span>
                </div>
                <div class="exception-grid">
                  \${exceptionLaneHtml("blocked", goals)}
                  \${exceptionLaneHtml("failed", goals)}
                </div>
              </section>
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
      const drawerWasFocused = Boolean(document.activeElement?.closest?.(".goal-drawer"));
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
      if (!selectedMemberId && state.members.length) selectedMemberId = state.members[0].id;
      app.innerHTML = activeHtml();
      document.body.style.overflow = selectedGoalId ? "hidden" : "";
      if (focusSelector) {
        document.querySelector(focusSelector)?.focus({ preventScroll: true });
      } else if (selectedGoalId && drawerWasFocused) {
        document.querySelector(".drawer-close")?.focus({ preventScroll: true });
      }
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
        if (action === "select-member") {
          selectedMemberId = target.dataset.id;
          render();
        } else if (action === "phase-filter") {
          phaseFilter = target.dataset.phase || "active";
          render();
        } else if (action === "expand-stage") {
          const phase = target.dataset.phase || "";
          expandedStage = expandedStage === phase ? "" : phase;
          render(expandedStage ? "#stage-detail-title" : \`[data-action="expand-stage"][data-phase="\${CSS.escape(phase)}"]\`);
        } else if (action === "close-stage") {
          const phase = expandedStage;
          expandedStage = "";
          render(\`[data-action="expand-stage"][data-phase="\${CSS.escape(phase)}"]\`);
        } else if (action === "open-goal") {
          selectedGoalId = target.dataset.goalId || "";
          drawerReturnSelector = \`[data-action="open-goal"][data-goal-id="\${CSS.escape(selectedGoalId)}"]\`;
          render(".drawer-close");
        } else if (action === "close-goal") {
          const returnSelector = drawerReturnSelector;
          selectedGoalId = "";
          drawerReturnSelector = "";
          render(returnSelector);
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
        } else if (action === "analyze" || action === "reanalyze") {
          confirmSetup = false;
          await post("/api/analyze");
        } else if (action === "confirm-setup") {
          confirmSetup = true;
          render();
        } else if (action === "confirm-cast") {
          confirmCast = true;
          render();
        } else if (action === "confirm-mission") {
          confirmMission = true;
          render();
        } else if (action === "confirm-charters") {
          confirmCharters = true;
          render();
        } else if (action === "cancel-confirm") {
          confirmSetup = confirmCast = confirmMission = confirmCharters = false;
          render();
        } else if (action === "create-automation-pr") {
          confirmSetup = false;
          await post("/api/create-automation-pr");
        } else if (action === "create-cast-issue") {
          confirmCast = false;
          await post("/api/create-cast-issue");
        } else if (action === "create-charter-pr") {
          confirmCharters = false;
          await post("/api/create-charter-pr");
        } else if (action === "start-mission") {
          confirmMission = false;
          await post("/api/start-mission");
        } else if (action === "clear-mission") {
          await post("/api/clear-mission");
        }
      } catch (error) {
        state.operation = { status: "error", message: error.message };
        render();
      }
    });

    document.addEventListener("toggle", event => {
      if (!event.target.matches?.(".filter-disclosure")) return;
      filtersOpen = event.target.open;
    }, true);

    document.addEventListener("keydown", event => {
      if (!selectedGoalId) return;
      if (event.key === "Escape") {
        event.preventDefault();
        const returnSelector = drawerReturnSelector;
        selectedGoalId = "";
        drawerReturnSelector = "";
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
          state.operation = { status: "error", message: error.message };
          render();
        }
        return;
      }
      if (action !== "task-owner") return;
      try {
        await post("/api/task-owner", {
          taskId: event.target.dataset.taskId,
          ownerId: event.target.value
        });
      } catch (error) {
        state.operation = { status: "error", message: error.message };
        render();
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

    document.addEventListener("submit", async event => {
      const form = event.target;
      event.preventDefault();
      try {
        if (form.dataset.form === "member") {
          const data = new FormData(form);
          await post("/api/member", {
            id: form.dataset.id,
            role: data.get("role"),
            charter: data.get("charter")
          });
        } else if (form.dataset.form === "mission") {
          const goal = String(new FormData(form).get("goal") || "").trim();
          if (!goal) return;
          await post("/api/plan-mission", { goal });
        }
      } catch (error) {
        state.operation = { status: "error", message: error.message };
        render();
      }
    });

    const events = new EventSource("/events");
    events.addEventListener("state", event => {
      state = JSON.parse(event.data);
      render();
    });
    events.onerror = () => {
      if (state) {
        state.operation = { status: "error", message: "Canvas connection interrupted. Reopen the canvas to reconnect." };
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
