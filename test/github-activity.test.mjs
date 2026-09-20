import assert from "node:assert/strict";
import test from "node:test";
import { GitHubSquadActivityAdapter } from "../github-activity.mjs";

const repository = {
    name: "demo",
    nameWithOwner: "octodemo/demo",
    url: "https://github.com/octodemo/demo",
    defaultBranchRef: { name: "main" },
};

function issue(overrides = {}) {
    return {
        number: 12,
        title: "Ship the dashboard",
        body: "",
        state: "OPEN",
        url: "https://github.com/octodemo/demo/issues/12",
        labels: [{ name: "squad" }],
        comments: [],
        ...overrides,
    };
}

test("keeps the last known goals when issue discovery fails", async () => {
    const previous = {
        schemaVersion: 1,
        repository: { nameWithOwner: "octodemo/demo" },
        summary: { active: 1, blocked: 0, failed: 0, awaitingReview: 0, completed: 0 },
        goals: [{ id: "octodemo/demo#1" }],
        errors: [],
    };
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return { name: "demo", nameWithOwner: "octodemo/demo" };
            if (args[0] === "issue") throw new Error("rate limited");
            return [];
        },
    });
    const result = await adapter.discover({ previous });
    assert.equal(result.stale, true);
    assert.deepEqual(result.goals, previous.goals);
    assert.equal(result.errors[0].source, "issues");
});

test("preserves successful sources when another GitHub source fails", async () => {
    const adapter = new GitHubSquadActivityAdapter({
        cwd: "/repo",
        runJson: async (args) => {
            if (args[0] === "repo") return repository;
            if (args[0] === "issue") return [issue({ body: "" })];
            if (args[0] === "pr") throw new Error("pull request permission denied");
            return [];
        },
    });
    const result = await adapter.discover();
    assert.equal(result.goals.length, 1);
    assert.equal(result.errors[0].source, "pull requests");
});
