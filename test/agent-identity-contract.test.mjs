import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contract = await readFile(
    new URL("../docs/agent-identity-consumer-contract.md", import.meta.url),
    "utf8",
);

test("future identity source state separates attempts, successes, and errors", () => {
    assert.match(contract, /lastAttemptedRefresh: string/);
    assert.match(contract, /lastSuccessfulRefresh: string \| null/);
    assert.match(contract, /status: "fresh" \| "stale" \| "unavailable" \| "missing"/);
    assert.match(contract, /"malformed" \| "forbidden" \| "partial"/);
    assert.match(contract, /kind: "fetch_failed" \| "permission_denied" \| "malformed" \| "partial"/);
    assert.doesNotMatch(contract, /\bfetchedAt:/);
});

test("future identity contract remains producer-bound and fail closed", () => {
    assert.match(contract, /explicit, versioned binding/);
    assert.match(contract, /must not bind an identity by display\s+name/);
    assert.match(contract, /No validated producer is configured \| Field absent in the current contract/);
    assert.match(contract, /does not close #45|Stable identity remains blocked/i);
});
