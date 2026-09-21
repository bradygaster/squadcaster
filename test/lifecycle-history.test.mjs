import assert from "node:assert/strict";
import test from "node:test";
import {
    lifecycleHistoryPolicy,
    normalizeLifecycleHistory,
    observeLifecycleSnapshot,
    setLifecycleRepositoryIncluded,
} from "../lifecycle-history.mjs";

function snapshot(phase, {
    fetchedAt = "2026-09-21T12:00:00Z",
    partial = false,
    stale = false,
    statuses = { issues: "fresh", pullRequests: "fresh", workflowRuns: "fresh" },
} = {}) {
    return {
        schemaVersion: 2,
        fetchedAt,
        repository: { nameWithOwner: "octodemo/demo" },
        goals: [{
            id: "octodemo/demo#43",
            repository: { nameWithOwner: "octodemo/demo" },
            issue: { number: 43 },
            phase,
        }],
        sourceState: Object.fromEntries(Object.entries(statuses).map(([name, status]) => [
            name,
            { status },
        ])),
        partial,
        stale,
        errors: [],
    };
}

test("establishes an incomplete baseline and appends only a later changed phase", () => {
    const first = observeLifecycleSnapshot({}, snapshot("queued"));
    assert.deepEqual(first.appended, []);
    assert.equal(first.snapshot.goals[0].lifecycleHistory.incompleteBeforeFirstObservation, true);
    assert.equal(first.snapshot.goals[0].lifecycleHistory.firstObservedAt, "2026-09-21T12:00:00.000Z");

    const unchanged = observeLifecycleSnapshot(
        first.lifecycleHistory,
        snapshot("queued", { fetchedAt: "2026-09-21T12:01:00Z" }),
    );
    assert.deepEqual(unchanged.appended, []);

    const changed = observeLifecycleSnapshot(
        unchanged.lifecycleHistory,
        snapshot("implementing", { fetchedAt: "2026-09-21T12:02:00Z" }),
    );
    assert.deepEqual(changed.appended[0], {
        repository: "octodemo/demo",
        goalId: "octodemo/demo#43",
        issueNumber: 43,
        from: "queued",
        to: "implementing",
        observedAt: "2026-09-21T12:02:00.000Z",
        freshness: {
            status: "complete",
            sources: {
                issues: "fresh",
                pullRequests: "fresh",
                workflowRuns: "fresh",
            },
        },
    });
});

test("records explicitly partial observations but rejects stale-only refreshes", () => {
    const first = observeLifecycleSnapshot({}, snapshot("queued"));
    const partial = observeLifecycleSnapshot(
        first.lifecycleHistory,
        snapshot("reviewing", {
            fetchedAt: "2026-09-21T12:03:00Z",
            partial: true,
            stale: true,
            statuses: { issues: "stale", pullRequests: "fresh", workflowRuns: "stale" },
        }),
    );
    assert.equal(partial.appended[0].freshness.status, "partial");
    assert.deepEqual(partial.appended[0].freshness.sources, {
        issues: "stale",
        pullRequests: "fresh",
        workflowRuns: "stale",
    });

    const staleOnly = observeLifecycleSnapshot(
        partial.lifecycleHistory,
        snapshot("failed", {
            fetchedAt: "2026-09-21T12:04:00Z",
            partial: true,
            stale: true,
            statuses: { issues: "stale", pullRequests: "stale", workflowRuns: "skipped" },
        }),
    );
    assert.deepEqual(staleOnly.appended, []);
    assert.equal(staleOnly.snapshot.goals[0].lifecycleHistory.transitions.length, 1);
});

test("labels an observation with an intentionally skipped source as partial", () => {
    const first = observeLifecycleSnapshot({}, snapshot("queued"));
    const changed = observeLifecycleSnapshot(
        first.lifecycleHistory,
        snapshot("implementing", {
            fetchedAt: "2026-09-21T12:05:00Z",
            statuses: { issues: "fresh", pullRequests: "fresh", workflowRuns: "skipped" },
        }),
    );
    assert.equal(changed.appended[0].freshness.status, "partial");
    assert.equal(changed.appended[0].freshness.sources.workflowRuns, "skipped");
});

test("exclusion and re-enablement establish a new baseline without filling the gap", () => {
    const first = observeLifecycleSnapshot({}, snapshot("queued"));
    const excluded = setLifecycleRepositoryIncluded(
        first.lifecycleHistory,
        "octodemo/demo",
        false,
    );
    const ignored = observeLifecycleSnapshot(
        excluded,
        snapshot("reviewing", { fetchedAt: "2026-09-21T12:05:00Z" }),
        { included: false },
    );
    assert.deepEqual(ignored.appended, []);

    const reenabled = setLifecycleRepositoryIncluded(
        ignored.lifecycleHistory,
        "octodemo/demo",
        true,
    );
    const baseline = observeLifecycleSnapshot(
        reenabled,
        snapshot("reviewing", { fetchedAt: "2026-09-21T12:06:00Z" }),
    );
    assert.deepEqual(baseline.appended, []);

    const later = observeLifecycleSnapshot(
        baseline.lifecycleHistory,
        snapshot("completed", { fetchedAt: "2026-09-21T12:07:00Z" }),
    );
    assert.equal(later.appended[0].from, "reviewing");
    assert.equal(later.appended[0].to, "completed");
});

test("goal disappearance requires a new baseline when it reappears", () => {
    const first = observeLifecycleSnapshot({}, snapshot("queued"));
    const absent = observeLifecycleSnapshot(first.lifecycleHistory, {
        ...snapshot("queued", { fetchedAt: "2026-09-21T12:01:00Z" }),
        goals: [],
    });
    assert.deepEqual(absent.appended, []);
    assert.equal(
        absent.lifecycleHistory.repositories["octodemo/demo"]
            .goals["octodemo/demo#43"].needsBaseline,
        true,
    );

    const reappeared = observeLifecycleSnapshot(
        absent.lifecycleHistory,
        snapshot("completed", { fetchedAt: "2026-09-21T12:02:00Z" }),
    );
    assert.deepEqual(reappeared.appended, []);
    assert.deepEqual(reappeared.snapshot.goals[0].lifecycleHistory.transitions, []);
    assert.equal(
        reappeared.snapshot.goals[0].lifecycleHistory.firstObservedAt,
        "2026-09-21T12:00:00.000Z",
    );

    const later = observeLifecycleSnapshot(
        reappeared.lifecycleHistory,
        snapshot("queued", { fetchedAt: "2026-09-21T12:03:00Z" }),
    );
    assert.equal(later.appended[0].from, "completed");
    assert.equal(later.appended[0].to, "queued");
});

test("keeps observation order monotonic when the local clock moves backward", () => {
    const first = observeLifecycleSnapshot({}, snapshot("queued"));
    const changed = observeLifecycleSnapshot(
        first.lifecycleHistory,
        snapshot("implementing", { fetchedAt: "2026-09-21T11:00:00Z" }),
    );
    assert.equal(changed.appended[0].observedAt, "2026-09-21T12:00:00.001Z");
});

test("normalizes migration input and preserves restart state", () => {
    const migrated = normalizeLifecycleHistory({ version: 0, repositories: "legacy" });
    assert.deepEqual(migrated, { version: 1, repositories: {} });

    const first = observeLifecycleSnapshot({}, snapshot("queued"));
    const changed = observeLifecycleSnapshot(
        first.lifecycleHistory,
        snapshot("implementing", { fetchedAt: "2026-09-21T12:10:00Z" }),
    );
    const restarted = normalizeLifecycleHistory(JSON.parse(JSON.stringify(changed.lifecycleHistory)));
    const completed = observeLifecycleSnapshot(
        restarted,
        snapshot("completed", { fetchedAt: "2026-09-21T12:11:00Z" }),
    );
    assert.deepEqual(
        completed.snapshot.goals[0].lifecycleHistory.transitions.map(({ from, to }) => ({ from, to })),
        [
            { from: "queued", to: "implementing" },
            { from: "implementing", to: "completed" },
        ],
    );
});

test("retains only the newest bounded transitions", () => {
    let state = observeLifecycleSnapshot({}, snapshot("queued")).lifecycleHistory;
    const phases = ["queued", "implementing"];
    for (let index = 1; index <= lifecycleHistoryPolicy.maxTransitionsPerGoal + 5; index += 1) {
        state = observeLifecycleSnapshot(
            state,
            snapshot(phases[index % 2], {
                fetchedAt: new Date(Date.parse("2026-09-21T12:00:00Z") + index * 1000).toISOString(),
            }),
        ).lifecycleHistory;
    }
    const history = state.repositories["octodemo/demo"].goals["octodemo/demo#43"];
    assert.equal(history.transitions.length, lifecycleHistoryPolicy.maxTransitionsPerGoal);
    assert.equal(history.transitions.at(-1).observedAt, "2026-09-21T12:01:45.000Z");
});
