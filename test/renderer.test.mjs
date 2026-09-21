import assert from "node:assert/strict";
import test from "node:test";
import { renderHtml } from "../renderer.mjs";

test("renders the read-only mission control prototype surfaces", () => {
    const html = renderHtml();

    assert.match(html, /Factory Mission Control/);
    assert.doesNotMatch(html, />Squadcaster</);
    assert.doesNotMatch(html, />SC</);
    assert.match(html, /Factory floor/);
    assert.match(html, />Activity</);
    assert.match(html, /Needs attention/);
    assert.match(html, /role="dialog"/);
    assert.match(html, /Browse goals/);
    assert.doesNotMatch(html, /\b(?:Watch|Fork|Star|Credits)\b|percent complete/i);
});

test("includes accessible drawer, stage, and reduced-motion behavior", () => {
    const html = renderHtml();

    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-controls="stage-detail"/);
    assert.match(html, /prefers-reduced-motion: reduce/);
    assert.match(html, /animation: none !important/);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /color-scheme: light dark/);
    assert.match(html, /forced-colors: active/);
    assert.match(html, /toggleAttribute\("inert"/);
    assert.match(html, /stage expanded/);
    assert.match(html, /filtered by/);
    assert.match(html, /Canvas connection interrupted/);
});
