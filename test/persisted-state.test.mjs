import assert from "node:assert/strict";
import test from "node:test";
import { emptyActivity, normalizePersistedState } from "../persisted-state.mjs";

test("normalizes legacy state without restoring mutation fields", () => {
    const activity = {
        ...emptyActivity(),
        fetchedAt: "2026-09-21T12:00:00Z",
        goals: [{ id: "octodemo/demo#20" }],
    };
    const normalized = normalizePersistedState({
        version: 1,
        signals: ["Uses Squad workflows"],
        summary: "Read-only context",
        members: [{
            id: "lead",
            name: "Lead",
            draftRole: "Mutated role",
            draftCharter: "Mutated charter",
            dirty: true,
        }],
        activity,
        mission: { goal: "Ship a mutation" },
        operation: { status: "running" },
        pullRequest: { url: "https://github.com/octodemo/demo/pull/1" },
        onboarding: { cast: { command: "/squad cast" } },
    });

    assert.equal(normalized.version, 3);
    assert.equal(normalized.activity, activity);
    assert.equal("signals" in normalized, false);
    assert.equal("summary" in normalized, false);
    assert.equal("members" in normalized, false);
    assert.equal("mission" in normalized, false);
    assert.equal("operation" in normalized, false);
    assert.equal("pullRequest" in normalized, false);
    assert.equal("onboarding" in normalized, false);
});

test("defaults malformed and unsupported persisted values safely", () => {
    for (const value of [null, undefined, "legacy", 42, [], { activity: { schemaVersion: 1 } }]) {
        const normalized = normalizePersistedState(value);
        assert.equal(normalized.version, 3);
        assert.deepEqual(normalized.activity, emptyActivity());
    }
});

test("ignores legacy proposal and unknown fields", () => {
    const normalized = normalizePersistedState({
        signals: Array.from({ length: 20 }, (_, index) => `Signal ${index + 1}`),
        members: [{ name: "Proposed member", dirty: true }],
        unknown: { status: "running" },
    });
    assert.equal("signals" in normalized, false);
    assert.equal("members" in normalized, false);
    assert.equal("unknown" in normalized, false);
});
