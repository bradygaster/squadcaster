import assert from "node:assert/strict";
import test from "node:test";
import { boundedItems } from "../renderer.mjs";
import {
    createStressCanvasState,
    updateStressRepositoryInclusion,
} from "./fixtures/stress-activity.mjs";

test("stress fixture covers large repositories, goals, and delivery evidence", () => {
    const state = createStressCanvasState();
    const first = state.activity.goals[0];
    const recent = boundedItems(
        state.activity.goals.flatMap((goal) => goal.evidence),
        100,
    );

    assert.equal(state.activity.repositories.length, 10);
    assert.equal(state.activity.goals.length, 140);
    assert.equal(first.issue.title.length, 240);
    assert.equal(first.pullRequests.length, 4);
    assert.equal(first.pullRequests[0].checks.length, 16);
    assert.equal(first.workflowRuns.length, 10);
    assert.equal(first.dependencies.length, 8);
    assert.equal(first.evidence.length, 30);
    assert.equal(recent.items.length, 100);
    assert.equal(recent.total, 4200);
    assert.equal(recent.hidden, 4100);
    assert.equal(state.activity.stale, true);
    assert.equal(state.activity.errors.length, 1);
});

test("stress fixture repository inclusion updates authoritative totals", () => {
    const state = createStressCanvasState();
    const allGoals = structuredClone(state.activity.goals);
    const repository = state.activity.repositories[8];

    assert.equal(updateStressRepositoryInclusion(
        state,
        allGoals,
        repository.nameWithOwner,
        false,
    ), true);
    assert.equal(repository.included, false);
    assert.equal(state.activity.goals.length, 126);
    assert.equal(state.activity.goals.some((goal) =>
        goal.repository.nameWithOwner === repository.nameWithOwner), false);
    assert.equal(state.activity.stale, false);
    assert.equal(state.activity.errors.length, 0);

    assert.equal(updateStressRepositoryInclusion(
        state,
        allGoals,
        repository.nameWithOwner,
        true,
    ), true);
    assert.equal(state.activity.goals.length, 140);
    assert.equal(state.activity.stale, true);
    assert.equal(state.activity.errors.length, 1);
});
