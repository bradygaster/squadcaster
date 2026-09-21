import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contractUrl = new URL("../docs/session-provenance-consumer-contract.md", import.meta.url);

test("documents the authoritative producer contract and fail-closed source", async () => {
    const contract = await readFile(contractUrl, "utf8");

    assert.match(contract, /Squad commit `fa739bd6`/);
    assert.match(contract, /exactly one pull-request\s+conversation comment/is);
    assert.match(contract, /github-actions\[bot\]/);
    assert.match(contract, /three pages of 100\s+conversation comments/);
    assert.match(contract, /invalid replacement hides cached fields/i);
    assert.match(contract, /aggregate by producer plus opaque session ID/i);
});

test("forbids deriving an absent implementation session identifier", async () => {
    const contract = await readFile(contractUrl, "utf8");

    for (const forbiddenSource of [
        "branch",
        "GitHub actor",
        "workflow run",
        "pull request",
        "timestamp",
        "issue text",
        "textual similarity",
    ]) {
        assert.match(contract, new RegExp(forbiddenSource.replace(" ", "\\s+"), "i"));
    }
    assert.match(contract, /session provenance is\s+unknown/i);
    assert.match(contract, /branch-only correlation.*`inferred`/is);
});
