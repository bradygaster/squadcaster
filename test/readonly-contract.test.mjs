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
];

test("renderer exposes only read-only dashboard controls", () => {
    const html = renderHtml();
    assert.match(html, /Live, read-only visibility from GitHub evidence/);
    assert.match(html, /data-action="manage-repositories"/);
    assert.match(html, /data-action="refresh-all"/);
    assert.match(html, /data-action="repository-included"/);
    for (const term of removedMutationTerms) assert.equal(html.includes(term), false, term);
});

test("extension keeps only supported POST routes and canvas actions", async () => {
    const source = await readFile(new URL("../extension.mjs", import.meta.url), "utf8");
    assert.match(source, /url\.pathname === "\/api\/repositories"/);
    assert.match(source, /url\.pathname === "\/api\/refresh"/);
    assert.match(source, /name: "get_state"/);
    assert.match(source, /name: "refresh"/);
    assert.match(source, /tools: \[\]/);
    for (const term of removedMutationTerms) assert.equal(source.includes(term), false, term);
});
