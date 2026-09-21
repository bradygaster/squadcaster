import assert from "node:assert/strict";
import test from "node:test";
import {
    boundedItems,
    describeActivityDelta,
    renderHtml,
} from "../renderer.mjs";

test("renders the read-only mission control prototype surfaces", () => {
    const html = renderHtml();

    assert.match(html, /Factory Mission Control/);
    assert.doesNotMatch(html, />Squadcaster</);
    assert.doesNotMatch(html, />SC</);
    assert.match(html, /Factory floor/);
    assert.match(html, /Needs attention/);
    assert.match(html, />Activity</);
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

test("bounds dense collections without changing the authoritative total", () => {
    const result = boundedItems(["a", "b", "c", "d"], 2);

    assert.deepEqual(result, {
        items: ["a", "b"],
        total: 4,
        hidden: 2,
    });
});

test("announces only meaningful activity changes", () => {
    const baseline = {
        goals: [{
            id: "octo/repo#1",
            phase: "queued",
            issue: { number: 1 },
            repository: { nameWithOwner: "octo/repo" },
        }],
        errors: [],
        repositories: [{
            nameWithOwner: "octo/repo",
            included: true,
        }],
    };

    assert.equal(describeActivityDelta(baseline, structuredClone(baseline)), "");
    assert.equal(describeActivityDelta(baseline, {
        ...baseline,
        goals: [{ ...baseline.goals[0], phase: "reviewing" }],
    }), "Goal #1 moved to reviewing.");
    assert.equal(describeActivityDelta(baseline, {
        goals: [...baseline.goals, {
            id: "octo/repo#2",
            phase: "queued",
            issue: { number: 2 },
        }],
        errors: [],
    }), "1 new goal discovered.");
    assert.equal(describeActivityDelta(baseline, {
        ...baseline,
        errors: [{ source: "GitHub", message: "rate limited" }],
    }), "GitHub activity refresh reported an error. Previously loaded data remains visible.");
    assert.equal(describeActivityDelta({
        ...baseline,
        goals: [],
        repositories: [{
            nameWithOwner: "octo/repo",
            included: false,
        }],
    }, baseline), "");
    assert.equal(describeActivityDelta({
        ...baseline,
        goals: [],
        repositories: [],
    }, baseline), "1 new goal discovered.");
});

test("renders stable restoration keys and production-scale containment", () => {
    const html = renderHtml();

    assert.match(html, /data-scroll-key="pipeline"/);
    assert.match(html, /data-scroll-key="goal-drawer"/);
    assert.match(html, /data-state-key="goal-filters"/);
    assert.match(html, /data-state-key="activity-more"/);
    assert.match(html, /min-width: 760px/);
    assert.match(html, /Showing the newest/);
    assert.match(html, /active workflow runs/);
    assert.doesNotMatch(html, /runs today/);
    assert.match(html, /Some GitHub data is from an earlier sync/);
    assert.match(html, /Latest reviews:/);
    assert.match(html, /Requested reviewers:/);
    assert.match(html, /Latest reviews unavailable/);
    assert.match(html, /No latest reviews reported/);
    assert.match(html, /Review requests unavailable/);
    assert.match(html, /No pending review requests/);
    assert.match(html, /Owners:/);
    assert.match(html, /No observed owners/);
    assert.doesNotMatch(html, /Agents:|No assigned agents/);
    assert.match(html, /Observed correlation/);
    assert.match(html, /Inferred correlation/);
    assert.match(html, /Observed lifecycle history/);
    assert.match(html, /not when GitHub or Squad performed it/);
    assert.match(html, /source observation/);
    assert.match(html, /last fully synced/);
    assert.match(html, /refresh attempted/);
    assert.doesNotMatch(html, /Last successful snapshot/);
    assert.match(html, /goal-drawer, \.runs-panel/);
    assert.match(html, /keyedDisclosure/);
});
