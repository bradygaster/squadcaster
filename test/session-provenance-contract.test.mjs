import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contractUrl = new URL("../docs/session-provenance-consumer-contract.md", import.meta.url);

test("keeps implementation session support blocked on producer validation", async () => {
    const contract = await readFile(contractUrl, "utf8");

    assert.match(contract, /parsing, normalization, caching, and rendering are\s+\*\*blocked\*\*/i);
    assert.match(contract, /No parser, cache entry, normalized session field, or renderer surface/i);
    assert.match(contract, /producer-owned schema version and fixtures/i);
    assert.match(contract, /identifier lifetime across retries, workflow reruns/i);
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
