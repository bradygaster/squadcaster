import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderHtml } from "../renderer.mjs";

const removedMutationTerms = [
    "create-cast-issue",
    "create-automation-pr",
    "create-charter-pr",
    "plan-mission",
    "start-mission",
    "clear-mission",
    "task-owner",
    "/api/member",
    "/squad cast",
    "Execute and create PR",
    'data-action="launch-handoff"',
    'data-action="create-local-session"',
    'data-action="assign-copilot"',
    'data-action="dispatch-squad-implement"',
    "/api/handoff/launch",
    "/api/handoff/create",
    "/api/handoff/assign",
    "/api/handoff/dispatch",
];

test("renderer exposes only read-only dashboard controls", () => {
    const html = renderHtml();
    assert.match(html, /Live, read-only visibility from GitHub evidence/);
    assert.match(html, /data-action="manage-repositories"/);
    assert.match(html, /data-action="refresh-all"/);
    assert.match(html, /data-action="repository-included"/);
    assert.match(html, /data-action="refresh-handoff"/);
    assert.match(html, /data-action="copy-handoff-context"/);
    assert.match(html, /data-action="export-handoff-context"/);
    assert.match(html, /\/api\/state\?handoff=/);
    assert.match(html, /Open existing/);
    assert.match(html, /data-action="bootstrap-filter"/);
    assert.match(html, /Repository-level, read-only status derived from canonical GitHub evidence/);
    for (const term of removedMutationTerms) assert.equal(html.includes(term), false, term);
    for (const term of ["/api/bootstrap", "retry-bootstrap", "create-bootstrap", "rerun-bootstrap"]) {
        assert.equal(html.includes(term), false, term);
    }
});

test("extension keeps only supported POST routes and canvas actions", async () => {
    const source = await readFile(new URL("../extension.mjs", import.meta.url), "utf8");
    assert.match(source, /url\.pathname === "\/api\/repositories"/);
    assert.match(source, /url\.pathname === "\/api\/refresh"/);
    assert.match(source, /url\.searchParams\.get\("handoff"\)/);
    assert.match(source, /entry\.handoffProbe\.probe/);
    assert.match(source, /applyHandoffMechanismOverlay/);
    assert.doesNotMatch(source, /refreshRemoteState\(entry, \{ force: Boolean\(handoffGoalId\) \}\)/);
    assert.match(source, /name: "get_state"/);
    assert.match(source, /name: "refresh"/);
    assert.match(source, /tools: \[\]/);
    assert.doesNotMatch(source, /name: "(?:launch|create|assign|dispatch|post)[^"]*"/);
    assert.doesNotMatch(source, /url\.pathname === "\/api\/handoff/);
    for (const term of removedMutationTerms) assert.equal(source.includes(term), false, term);
});

test("handoff normalization remains a read-only model with no launch adapter", async () => {
    const source = await readFile(new URL("../handoff-readiness.mjs", import.meta.url), "utf8");
    assert.match(source, /deriveHandoff/);
    assert.match(source, /automatedHandoffAvailable/);
    assert.doesNotMatch(source, /\b(?:spawn|execFile|fetch)\s*\(/);
    assert.doesNotMatch(source, /workflow_dispatch|create_session|\/api\//i);
});

test("handoff context export preserves the normalized contract without launch controls", () => {
    const html = renderHtml();

    assert.match(html, /handoffContext\(goal\)/);
    assert.match(html, /handoff: goal\.handoff \|\| null/);
    assert.match(html, /JSON\.stringify\(handoffContext\(goal\), null, 2\)/);
    assert.match(html, /Manual handling/);
    assert.match(html, /Makes no repository or agent change/);
    assert.doesNotMatch(html, />Create local session</);
    assert.doesNotMatch(html, />Assign Copilot</);
    assert.doesNotMatch(html, />Dispatch `?\/squad implement/);
});
