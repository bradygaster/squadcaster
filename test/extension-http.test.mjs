import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { handleAgentAvatarRoute } from "../agent-avatar-route.mjs";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function resolvedGoal(overrides = {}) {
    return {
        id: "octodemo/demo#12",
        repository: { nameWithOwner: "octodemo/demo" },
        agentIdentity: {
            status: "resolved",
            record: {
                id: "runtime-engineer",
                avatar: {
                    kind: "repository-path",
                    path: ".squad/agents/runtime-engineer/avatar.png",
                },
            },
            source: {
                status: "fresh",
                revision: "registry-blob-2",
            },
        },
        ...overrides,
    };
}

async function withServer(goal, runJson, verify) {
    const entry = {
        state: {
            repoRoot: "/repo",
            activity: { goals: goal ? [goal] : [] },
        },
        avatarCache: new Map(),
        runJson,
    };
    const server = createServer((request, response) => {
        handleAgentAvatarRoute(entry, request, response, runJson).then((handled) => {
            if (!handled) {
                response.writeHead(request.method === "GET" ? 404 : 405);
                response.end();
            }
        }).catch((error) => {
            response.writeHead(500);
            response.end(String(error));
        });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    try {
        await verify(`http://127.0.0.1:${address.port}`);
    } finally {
        server.close();
        await once(server, "close");
    }
}

test("serves authoritative avatar bytes through the extension HTTP route", async () => {
    for (const sourceStatus of ["fresh", "stale"]) {
        let requested = "";
        const goal = resolvedGoal();
        goal.agentIdentity.source.status = sourceStatus;
        await withServer(goal, async (args) => {
            requested = args[1];
            return {
                type: "file",
                encoding: "base64",
                content: png.toString("base64"),
            };
        }, async (origin) => {
            const response = await fetch(
                `${origin}/api/agent-avatar?goal=octodemo%2Fdemo%2312`,
            );
            assert.equal(response.status, 200);
            assert.equal(response.headers.get("content-type"), "image/png");
            assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
        });
        assert.equal(
            requested,
            "repos/octodemo/demo/contents/.squad/agents/runtime-engineer/avatar.png",
        );
    }
});

test("rejects invalid avatar requests through the extension HTTP route", async () => {
    const cases = [
        ["missing-goal", null],
        ["traversal", resolvedGoal({
            agentIdentity: {
                ...resolvedGoal().agentIdentity,
                record: {
                    id: "runtime-engineer",
                    avatar: {
                        kind: "repository-path",
                        path: ".squad/agents/runtime-engineer/../secret.png",
                    },
                },
            },
        })],
        ["untrusted", resolvedGoal({
            agentIdentity: {
                status: "unknown",
                record: null,
                source: { status: "malformed", revision: "" },
            },
        })],
        ["unresolved", resolvedGoal({
            agentIdentity: {
                status: "unknown",
                record: null,
                source: { status: "fresh", revision: "registry-blob-2" },
            },
        })],
    ];
    for (const [name, goal] of cases) {
        let calls = 0;
        await withServer(goal, async () => {
            calls += 1;
            return null;
        }, async (origin) => {
            const response = await fetch(
                `${origin}/api/agent-avatar?goal=octodemo%2Fdemo%2312`,
            );
            assert.equal(response.status, 404, name);
        });
        assert.equal(calls, 0, name);
    }
});

test("preserves missing-content and GET-only avatar behavior", async () => {
    let calls = 0;
    await withServer(resolvedGoal(), async () => {
        calls += 1;
        return null;
    }, async (origin) => {
        const missing = await fetch(
            `${origin}/api/agent-avatar?goal=octodemo%2Fdemo%2312`,
        );
        assert.equal(missing.status, 404);

        const post = await fetch(
            `${origin}/api/agent-avatar?goal=octodemo%2Fdemo%2312`,
            { method: "POST" },
        );
        assert.equal(post.status, 404);
    });
    assert.equal(calls, 1);
});
