import assert from "node:assert/strict";
import test from "node:test";
import {
    applyHandoffMechanismOverlay,
    HandoffMechanismProbe,
} from "../handoff-probe.mjs";

function state() {
    return {
        repoRoot: "/repo",
        activity: {
            currentRepository: "octodemo/frontend",
            goals: [
                {
                    id: "octodemo/frontend#12",
                    issue: { number: 12, updatedAt: "2026-09-21T20:00:00Z" },
                    handoff: {
                        issueRevision: "2026-09-21T20:00:00Z",
                        readiness: {
                            state: "ready",
                            reasons: [],
                            automatedHandoffAvailable: false,
                        },
                        mechanisms: [
                            { kind: "manual", availability: "available", reasons: [] },
                        ],
                    },
                },
                {
                    id: "otherdemo/backend#7",
                    issue: { number: 7 },
                    handoff: {
                        readiness: {
                            state: "blocked",
                            reasons: ["Dependency is open."],
                            automatedHandoffAvailable: false,
                        },
                        mechanisms: [],
                    },
                },
            ],
        },
    };
}

test("probes only the selected repository and caches repeated drawer opens", async () => {
    const calls = [];
    let now = Date.parse("2026-09-21T20:00:00Z");
    const probe = new HandoffMechanismProbe({
        cwd: "/repo",
        now: () => now,
        runJson: async (args, cwd) => {
            calls.push({ args, cwd });
            return {
                data: {
                    repository: {
                        viewerPermission: "WRITE",
                        squadSource: { oid: "workflow-oid" },
                        squadLock: null,
                        suggestedActors: {
                            nodes: [{ login: "copilot-swe-agent" }],
                        },
                    },
                },
            };
        },
    });

    const first = await probe.probe({
        state: state(),
        goalId: "octodemo/frontend#12",
    });
    const second = await probe.probe({
        state: state(),
        goalId: "octodemo/frontend#12",
    });

    assert.deepEqual(second, first);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cwd, "/repo");
    assert.ok(calls[0].args.includes("owner=octodemo"));
    assert.ok(calls[0].args.includes("name=frontend"));
    assert.equal(calls[0].args.some((value) => value.includes("otherdemo")), false);
    assert.deepEqual(
        first.mechanisms.map((item) => [item.kind, item.availability]),
        [
            ["local-session", "available"],
            ["copilot-cloud-agent", "available"],
            ["squad-implement", "available"],
            ["manual", "available"],
        ],
    );

    now += 1000;
    await probe.probe({
        state: state(),
        goalId: "octodemo/frontend#12",
        force: true,
    });
    assert.equal(calls.length, 2);
});

test("applies availability only to the selected goal without changing readiness", async () => {
    const original = state();
    const originalReadiness = structuredClone(original.activity.goals[0].handoff.readiness);
    const overlay = {
        goalId: "octodemo/frontend#12",
        mechanisms: [
            { kind: "local-session", availability: "available", reasons: [] },
            { kind: "copilot-cloud-agent", availability: "policy-blocked", reasons: ["Policy blocks it."] },
            { kind: "squad-implement", availability: "unavailable", reasons: ["Workflow missing."] },
            { kind: "manual", availability: "available", reasons: [] },
        ],
    };

    const result = applyHandoffMechanismOverlay(original, overlay);

    assert.deepEqual(original.activity.goals[0].handoff.readiness, originalReadiness);
    assert.equal(result.activity.goals[0].handoff.readiness.state, originalReadiness.state);
    assert.deepEqual(result.activity.goals[0].handoff.readiness.reasons, originalReadiness.reasons);
    assert.equal(result.activity.goals[0].handoff.readiness.automatedHandoffAvailable, true);
    assert.deepEqual(
        result.activity.goals[1],
        original.activity.goals[1],
    );
});

test("fails mechanism availability closed when the bounded repository probe fails", async () => {
    const probe = new HandoffMechanismProbe({
        cwd: "/repo",
        runJson: async () => {
            throw new Error("policy endpoint unavailable");
        },
    });

    const result = await probe.probe({
        state: state(),
        goalId: "octodemo/frontend#12",
    });

    assert.equal(result.mechanisms.find((item) => item.kind === "local-session").availability, "available");
    assert.equal(result.mechanisms.find((item) => item.kind === "copilot-cloud-agent").availability, "unavailable");
    assert.equal(result.mechanisms.find((item) => item.kind === "squad-implement").availability, "unavailable");
    assert.match(
        result.mechanisms.find((item) => item.kind === "copilot-cloud-agent").reasons[0],
        /policy endpoint unavailable/,
    );
});
