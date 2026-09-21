import { createServer } from "node:http";
import { renderHtml } from "../renderer.mjs";
import {
    createStressCanvasState,
    updateStressRepositoryInclusion,
} from "./fixtures/stress-activity.mjs";

const state = createStressCanvasState();
const allGoals = structuredClone(state.activity.goals);
const clients = new Set();

function sendJson(response, status, value) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(value));
}

function broadcast() {
    const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) client.write(payload);
}

async function readJson(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
    }
    if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        });
        response.end(renderHtml());
        return;
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
        sendJson(response, 200, state);
        return;
    }
    if (request.method === "GET" && url.pathname === "/events") {
        response.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
    }
    if (request.method === "POST" && url.pathname === "/api/repositories") {
        const body = await readJson(request);
        if (!updateStressRepositoryInclusion(state, allGoals, body.nameWithOwner, body.included)) {
            sendJson(response, 404, { error: "Repository not found." });
            return;
        }
        broadcast();
        sendJson(response, 200, state);
        return;
    }
    if (request.method === "POST" && url.pathname === "/api/refresh") {
        broadcast();
        sendJson(response, 200, state);
        return;
    }
    sendJson(response, 404, { error: "Not found." });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
process.stdout.write(`http://127.0.0.1:${address.port}/\n`);

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        for (const client of clients) client.end();
        server.close(() => process.exit(0));
    });
}
