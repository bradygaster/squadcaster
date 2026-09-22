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
    assert.match(contract, /status: "fresh" \| "stale" \| "unavailable" \| "missing"/);
    assert.match(contract, /"malformed" \| "forbidden" \| "partial"/);
    assert.match(contract, /kind: "fetch_failed" \| "permission_denied" \| "malformed" \| "partial"/);
    assert.doesNotMatch(contract, /\bfetchedAt:/);
});

test("identity contract is producer-bound, active, and fail closed", () => {
    assert.match(contract, /squad-agent-provenance\/v1/);
    assert.match(contract, /squad-work-agent-binding\/v1/);
    assert.match(contract, /never create or\s+resolve a stable agent identity/);
    assert.match(contract, /partial registries.*fail closed/is);
    assert.match(contract, /Squadcaster remains read-only/);
});
