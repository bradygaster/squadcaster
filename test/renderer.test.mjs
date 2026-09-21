import assert from "node:assert/strict";
import test from "node:test";
import {
    anchoredPagedItems,
    boundedItems,
    compareFeedItems,
    describeDayBoundary,
    describeActivityDelta,
    renderHtml,
    semanticFeedItems,
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
    assert.match(html, /Handoff readiness:/);
    assert.match(html, /readiness\.already-in-progress/);
    assert.match(html, /readiness\.unknown::before/);
    assert.match(html, /Mechanism availability/);
    assert.match(html, /Copy context/);
    assert.match(html, /Export context/);
    assert.match(html, /Open existing/);
    assert.doesNotMatch(html, /data-action="(?:launch|create|assign|dispatch|post)-/);
    assert.match(html, /Automatic bootstrap/);
    assert.match(html, /aria-label="Automatic bootstrap:/);
    assert.match(html, /Derived from GitHub evidence/);
    assert.match(html, /Observed GitHub evidence/);
    assert.match(html, /Bootstrap status is unknown/);
    assert.match(html, /Status is stale; reclassification is paused/);
    assert.match(html, /data-action="bootstrap-filter"/);
    assert.doesNotMatch(html, /data-phase="bootstrap"/);
});

test("keeps bootstrap observability read-only and fail closed", () => {
    const html = renderHtml();

    assert.match(html, /multiple or conflicting candidates prevent safe canonical selection/);
    assert.match(html, /a unique candidate violates the canonical bootstrap contract/);
    assert.match(html, /closed without merge/);
    assert.match(html, /repositoryBootstrapEntries/);
    assert.doesNotMatch(html, /(?:rerun|retry|create)[-_ ]bootstrap/i);
    assert.doesNotMatch(html, /\/api\/bootstrap/);
});

test("bounds dense collections without changing the authoritative total", () => {
    const result = boundedItems(["a", "b", "c", "d"], 2);

    assert.deepEqual(result, {
        items: ["a", "b"],
        total: 4,
        hidden: 2,
    });
});

test("paginates and semantically deduplicates dense feeds", () => {
    const items = [
        { kind: "issue", title: "Beta", url: "/b", timestamp: "2026-09-20T12:00:00Z" },
        { kind: "issue", title: "Alpha", url: "/a", timestamp: "2026-09-20T12:00:00Z" },
        { kind: "issue", title: "Alpha", url: "/a", timestamp: "2026-09-20T12:00:00Z" },
        { kind: "workflow", title: "Missing", url: "/missing", timestamp: null },
    ];
    const deduped = semanticFeedItems(items);

    assert.deepEqual(deduped.map((item) => item.title), ["Alpha", "Beta", "Missing"]);
    assert.equal(compareFeedItems(deduped[0], deduped[1]), -1);
    const dense = Array.from({ length: 45 }, (_, index) => ({ id: index + 1 }));
    const first = anchoredPagedItems(dense, {}, 20, (item) => item.id);
    const second = anchoredPagedItems(dense, { anchor: first.nextAnchor }, 20, (item) => item.id);
    assert.deepEqual(second.items.map((item) => item.id), Array.from({ length: 20 }, (_, index) => index + 21));

    const refreshed = [{ id: -1 }, { id: 0 }, ...dense];
    const stable = anchoredPagedItems(refreshed, second, 20, (item) => item.id);
    assert.deepEqual(stable.items.map((item) => item.id), second.items.map((item) => item.id));

    const anchorOnlyRemoved = refreshed.filter((item) => item.id !== 21);
    const anchorRecovered = anchoredPagedItems(anchorOnlyRemoved, second, 20, (item) => item.id);
    assert.equal(anchorRecovered.items[0].id, 22);
    assert.equal(anchorRecovered.items.length, 20);

    const removed = refreshed.filter((item) => ![20, 21, 30].includes(item.id));
    const recovered = anchoredPagedItems(removed, second, 20, (item) => item.id);
    assert.equal(recovered.items[0].id, 22);
    assert.equal(recovered.items.includes(30), false);
    assert.equal(recovered.items.length, 20);

    const pageAndPredecessorRemoved = refreshed.filter((item) =>
        item.id < 20 || item.id > 40);
    const nextWindow = anchoredPagedItems(
        pageAndPredecessorRemoved,
        second,
        20,
        (item) => item.id,
    );
    assert.deepEqual(nextWindow.items.map((item) => item.id), [41, 42, 43, 44, 45]);

    const visited = [];
    let page = anchoredPagedItems(refreshed, {}, 20, (item) => item.id);
    while (true) {
        visited.push(...page.items.map((item) => item.id));
        if (!page.hasOlder) break;
        page = anchoredPagedItems(refreshed, { anchor: page.nextAnchor }, 20, (item) => item.id);
    }
    assert.deepEqual(visited, refreshed.map((item) => item.id));
});

test("labels retained prior-day inputs separately from the aggregate observation day", () => {
    assert.equal(describeDayBoundary({
        dayBoundary: {
            kind: "utc-server-day",
            snapshotDay: "2026-09-22",
        },
        snapshotDays: ["2026-09-21"],
    }), "UTC server-day data 2026-09-21 (00:00–24:00 UTC) · aggregate observed 2026-09-22; refresh pending");
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
    assert.match(html, /min-width: 760px/);
    assert.match(html, /Filter activity by evidence kind/);
    assert.match(html, /Older evidence/);
    assert.match(html, /Older workflows/);
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
    assert.match(html, /Workflow jobs and steps/);
    assert.match(html, /GitHub reported no jobs for this run/);
    assert.match(html, /Workflow jobs are unavailable for this run/);
    assert.doesNotMatch(html, /job duration|failure reason|percent complete/i);
    assert.match(html, /last fully synced/);
    assert.match(html, /refresh attempted/);
    assert.match(html, /UTC server day/);
    assert.match(html, /00:00–24:00 UTC/);
    assert.doesNotMatch(html, /toLocaleDateString|resolvedOptions\(\)\.timeZone/);
    assert.doesNotMatch(html, /Last successful snapshot/);
    assert.match(html, /goal-drawer, \.runs-panel/);
    assert.match(html, /keyedDisclosure/);
    assert.match(html, /-webkit-line-clamp: 2/);
    assert.match(html, /overflow-wrap: anywhere/);
});
