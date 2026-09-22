import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contract = await readFile(
    new URL("../docs/agent-identity-consumer-contract.md", import.meta.url),
    "utf8",
);

test("identity source state separates attempts, successes, and errors", () => {
    assert.match(contract, /lastAttemptedRefresh: string \| null/);
    assert.match(contract, /lastSuccessfulRefresh: string \| null/);
    assert.match(contract, /"fresh" \| "stale" \| "missing" \| "partial"/);
    assert.match(contract, /"forbidden" \| "malformed" \| "unavailable"/);
    assert.match(contract, /persisted-state version is\s+`6`/);
});

test("identity contract is producer-bound, read-only, and fail closed", () => {
    assert.match(contract, /squad-agent-provenance\/v1/);
    assert.match(contract, /squad-work-agent-binding\/v1/);
    assert.match(contract, /never derives identity from goal labels/);
    assert.match(contract, /whole binding document is atomic/);
    assert.match(contract, /remains read-only/);
    assert.match(contract, /does\s+not generate initials/);
});
