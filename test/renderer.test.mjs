import assert from "node:assert/strict";
import test from "node:test";
import { renderHtml } from "../renderer.mjs";

test("renders the read-only mission control prototype surfaces", () => {
    const html = renderHtml();

    assert.match(html, /Squad mission control/);
    assert.doesNotMatch(html, />Squadcaster</);
    assert.doesNotMatch(html, />SC</);
    assert.match(html, /Goal lifecycle/);
    assert.match(html, /Recent activity/);
    assert.match(html, /Needs attention/);
    assert.match(html, /role="dialog"/);
    assert.match(html, /Filter and repository controls/);
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
    assert.match(html, /Canvas connection interrupted/);
});
