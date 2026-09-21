import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
    CanvasError,
    createCanvas,
    joinSession,
} from "@github/copilot-sdk/extension";
import {
    discoverCurrentRepositoryActivity,
    GitHubGlobalActivity,
    normalizeRegistry,
} from "./global-activity.mjs";
import {
    applyHandoffMechanismOverlay,
    HandoffMechanismProbe,
} from "./handoff-probe.mjs";
import { utcServerDayBoundary } from "./activity-model.mjs";
import { normalizePersistedState } from "./persisted-state.mjs";
import { renderHtml } from "./renderer.mjs";
import { normalizeMembers, parseTeamMarkdown } from "./squad-roster.mjs";

const execFileAsync = promisify(execFile);
const servers = new Map();
let session;
let sharedRegistry = null;
let registryQueue = Promise.resolve();

function cleanText(value, maxLength = 12000) {
    return String(value || "").trim().slice(0, maxLength);
}

function hashKey(value) {
    return createHash("sha256").update(String(value).toLowerCase()).digest("hex").slice(0, 20);
}

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function resolveRepoRoot(workingDirectory) {
    if (!workingDirectory) return null;
    try {
        const { stdout } = await execFileAsync(
            "git",
            ["-C", workingDirectory, "rev-parse", "--show-toplevel"],
            { windowsHide: true, maxBuffer: 1024 * 1024 },
        );
        return path.resolve(stdout.trim());
    } catch {
        return null;
    }
}

async function readCharter(repoRoot, relativePath) {
    if (!relativePath) return "";
    const normalized = relativePath.replaceAll("`", "").replaceAll("/", path.sep);
    const fullPath = path.resolve(repoRoot, normalized);
    const relative = path.relative(repoRoot, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !(await exists(fullPath))) return "";
    return cleanText(await fs.readFile(fullPath, "utf8"), 12000);
}

async function parseTeam(repoRoot) {
    const teamPath = path.join(repoRoot, ".squad", "team.md");
    if (!(await exists(teamPath))) return [];
    const content = await fs.readFile(teamPath, "utf8");
    try {
        return await parseTeamMarkdown(content, {
            loadCharter: (charterPath) => readCharter(repoRoot, charterPath),
        });
    } catch {
        return [];
    }
}

function storageRoot(name) {
    if (session?.workspacePath) {
        return path.join(session.workspacePath, "files", name);
    }
    const copilotHome = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
    return path.join(copilotHome, "extensions", name, "artifacts");
}

async function statePathFor(repoRoot, workingDirectory) {
    const key = `${hashKey(repoRoot || workingDirectory || "no-repository")}.json`;
    const root = storageRoot("squadcaster");
    const legacyPath = path.join(storageRoot("squad-canvas"), key);
    await fs.mkdir(root, { recursive: true });
    const statePath = path.join(root, key);
    if (!(await exists(statePath)) && await exists(legacyPath)) {
        await fs.copyFile(legacyPath, statePath);
    }

    return statePath;
}

async function registryPath() {
    const root = storageRoot("squadcaster");
    await fs.mkdir(root, { recursive: true });
    return path.join(root, "repository-registry.json");
}

async function readPersistedState(statePath) {
    if (!(await exists(statePath))) return normalizePersistedState(null);
    try {
        return normalizePersistedState(JSON.parse(await fs.readFile(statePath, "utf8")));
    } catch {
        return normalizePersistedState(null);
    }
}

async function readRegistry(filePath) {
    if (!(await exists(filePath))) return normalizeRegistry();
    try {
        return normalizeRegistry(JSON.parse(await fs.readFile(filePath, "utf8")));
    } catch {
        return normalizeRegistry();
    }
}

function withRegistryLock(operation) {
    const queued = registryQueue
        .catch(() => undefined)
        .then(() => operation());
    registryQueue = queued.catch(() => {});
    return queued;
}

function shareRegistry(registry) {
    sharedRegistry = registry;
    for (const entry of servers.values()) entry.registry = registry;
}

async function loadState(workingDirectory) {
    const repoRoot = await resolveRepoRoot(workingDirectory);
    const statePath = await statePathFor(repoRoot, workingDirectory);
    const persisted = await readPersistedState(statePath);

    if (!repoRoot) {
        return {
            statePath,
            state: {
                version: 4,
                mode: "unavailable",
                workingDirectory: workingDirectory || "",
                repoRoot: "",
                repoName: "",
                message: "Open Factory Mission Control from a Copilot project session.",
                members: [],
                activity: persisted.activity,
            },
        };
    }

    const actualMembers = await parseTeam(repoRoot);
    const initialized = actualMembers.length > 0;
    const workflowsInstalled = await Promise.all([
        exists(path.join(repoRoot, ".github", "workflows", "squad.md")),
        exists(path.join(repoRoot, ".github", "workflows", "squad.lock.yml")),
    ]).then((values) => values.some(Boolean));
    const members = actualMembers;

    return {
        statePath,
        state: {
            version: 4,
            mode: initialized ? "active" : "setup",
            workingDirectory,
            repoRoot,
            repoName: path.basename(repoRoot),
            message: "",
            members,
            squad: {
                installed: initialized || workflowsInstalled,
                rosterAvailable: initialized,
                memberCount: members.length,
            },
            activity: persisted.activity,
        },
    };
}

async function persist(entry) {
    await fs.mkdir(path.dirname(entry.statePath), { recursive: true });
    const temporary = `${entry.statePath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(entry.state, null, 2)}\n`, "utf8");
    await fs.rename(temporary, entry.statePath);
}

async function persistRegistry(filePath, registry) {
    const temporary = `${filePath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    await fs.rename(temporary, filePath);
}

function broadcast(entry) {
    const payload = `event: state\ndata: ${JSON.stringify(entry.state)}\n\n`;
    for (const client of entry.clients) client.write(payload);
}

async function updateState(entry, updater) {
    updater(entry.state);
    await persist(entry);
    broadcast(entry);
}

async function runGhJson(args, cwd, input) {
    return new Promise((resolve, reject) => {
        const child = spawn("gh", args, {
            cwd,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
        });
        const stdout = [];
        const stderr = [];
        let size = 0;
        const collect = (chunks, chunk) => {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) {
                child.kill();
                reject(new Error("GitHub CLI response exceeded 8 MB."));
                return;
            }
            chunks.push(chunk);
        };
        child.stdout.on("data", (chunk) => collect(stdout, chunk));
        child.stderr.on("data", (chunk) => collect(stderr, chunk));
        child.on("error", (error) => reject(new Error(`Unable to start GitHub CLI: ${error.message}`)));
        child.on("close", (code) => {
            const output = Buffer.concat(stdout).toString("utf8").trim();
            const detail = Buffer.concat(stderr).toString("utf8").trim();
            if (code !== 0) {
                reject(new Error(cleanText(detail || output || `GitHub CLI exited with code ${code}.`, 1600)));
                return;
            }
            if (!output) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(output));
            } catch {
                reject(new Error("GitHub CLI returned an invalid JSON response."));
            }
        });
        child.stdin.on("error", (error) => reject(new Error(`Unable to send data to GitHub CLI: ${error.message}`)));
        child.stdin.end(input === undefined ? "" : JSON.stringify(input));
    });
}

async function refreshRemoteState(entry, { force = false } = {}) {
    if (!entry.state.repoRoot) return;
    if (!force && Date.now() - (entry.lastRemoteCheckAt || 0) < 10000) return;
    if (entry.remoteCheckPromise) return entry.remoteCheckPromise;

    entry.lastRemoteCheckAt = Date.now();
    entry.remoteCheckPromise = (async () => {
        try {
            const currentRepository = entry.state.activity?.currentRepository ||
                entry.state.activity?.repository?.nameWithOwner ||
                "";
            const activity = await withRegistryLock(async () => {
                const registry = sharedRegistry || entry.registry;
                const currentPrevious = registry.snapshots?.[currentRepository.toLowerCase()] ||
                    (entry.state.activity?.scope === "user" ? null : entry.state.activity);
                const currentActivity = await discoverCurrentRepositoryActivity({
                    runJson: runGhJson,
                    cwd: entry.state.repoRoot,
                    members: entry.state.members,
                    previous: currentPrevious,
                    registry,
                    currentRepository,
                });
                if (currentActivity.restRateLimit) {
                    registry.restRateLimit = currentActivity.restRateLimit;
                }
                const currentSnapshot = currentActivity.snapshot;
                const nameWithOwner = currentSnapshot?.repository?.nameWithOwner || currentRepository;
                const global = new GitHubGlobalActivity({
                    runJson: runGhJson,
                    cwd: entry.state.repoRoot,
                    registry,
                });
                const aggregated = await global.refresh({
                    currentRepository: nameWithOwner,
                    currentSnapshot,
                    currentSnapshotRefreshed: currentActivity.refreshed,
                    currentMembers: entry.state.members,
                    currentSquadDetected: entry.state.squad?.installed,
                    forceDiscovery: force,
                    forceAll: entry.forceAllRefresh,
                });
                shareRegistry(global.registry);
                await persistRegistry(entry.registryPath, global.registry);
                return aggregated;
            });
            entry.forceAllRefresh = false;
            await updateState(entry, (state) => {
                state.activity = activity;
            });
        } catch (error) {
            const message = cleanText(error?.message || error, 1200);
            const attemptedAt = new Date().toISOString();
            await updateState(entry, (state) => {
                state.activity ||= {
                    schemaVersion: 3,
                    fetchedAt: attemptedAt,
                    dayBoundary: utcServerDayBoundary(attemptedAt),
                    repositories: [],
                    summary: {
                        active: 0,
                        queued: 0,
                        researching: 0,
                        implementing: 0,
                        blocked: 0,
                        failed: 0,
                        awaitingReview: 0,
                        completed: 0,
                    },
                    goals: [],
                    errors: [],
                };
                state.activity.errors = [{ source: "GitHub", message }];
                state.activity.stale = true;
                state.activity.partial = true;
                state.activity.lastAttemptedRefresh = attemptedAt;
            });
        } finally {
            entry.remoteCheckPromise = null;
        }
    })();
    return entry.remoteCheckPromise;
}

async function parseBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) throw new Error("Request body exceeds 1 MB.");
        chunks.push(chunk);
    }
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, body) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
}

async function handleRequest(entry, req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
    }
    if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        });
        res.end(renderHtml());
        return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
        const handoffGoalId = cleanText(url.searchParams.get("handoff"), 300);
        if (handoffGoalId) {
            const overlay = await entry.handoffProbe.probe({
                state: entry.state,
                goalId: handoffGoalId,
                force: url.searchParams.get("refresh") === "1",
            });
            sendJson(res, 200, applyHandoffMechanismOverlay(entry.state, overlay));
            return;
        }
        await refreshRemoteState(entry);
        sendJson(res, 200, entry.state);
        return;
    }
    if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        res.write(`event: state\ndata: ${JSON.stringify(entry.state)}\n\n`);
        entry.clients.add(res);
        req.on("close", () => entry.clients.delete(res));
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/repositories") {
        const body = await parseBody(req);
        if (entry.remoteCheckPromise) await entry.remoteCheckPromise;
        const changed = await withRegistryLock(async () => {
            const global = new GitHubGlobalActivity({
                runJson: runGhJson,
                cwd: entry.state.repoRoot,
                registry: sharedRegistry || entry.registry,
            });
            if (!global.setIncluded(cleanText(body.nameWithOwner, 300), body.included)) return false;
            shareRegistry(global.registry);
            await persistRegistry(entry.registryPath, global.registry);
            return true;
        });
        if (!changed) {
            sendJson(res, 404, { error: "Repository not found in the Squad registry." });
            return;
        }
        entry.lastRemoteCheckAt = 0;
        await refreshRemoteState(entry, { force: false });
        sendJson(res, 200, entry.state);
        return;
    }
    if (req.method === "POST" && url.pathname === "/api/refresh") {
        if (entry.remoteCheckPromise) await entry.remoteCheckPromise;
        entry.forceAllRefresh = true;
        entry.lastRemoteCheckAt = 0;
        await refreshRemoteState(entry, { force: true });
        sendJson(res, 200, entry.state);
        return;
    }
    if (req.method === "POST") {
        sendJson(res, 404, { error: "Not found." });
        return;
    }
    if (req.method !== "GET") {
        sendJson(res, 405, { error: "Squadcaster is read-only." });
        return;
    }
    sendJson(res, 404, { error: "Not found." });
}

async function startServer(ctx) {
    const workingDirectory =
        cleanText(ctx.input?.workingDirectory || ctx.session?.workingDirectory || "", 1000);
    const { state, statePath } = await loadState(workingDirectory);
    const userRegistryPath = await registryPath();
    if (!sharedRegistry) sharedRegistry = await readRegistry(userRegistryPath);
    const entry = {
        instanceId: ctx.instanceId,
        state,
        statePath,
        registryPath: userRegistryPath,
        registry: sharedRegistry,
        clients: new Set(),
        server: null,
        url: "",
        lastRemoteCheckAt: 0,
        remoteCheckPromise: null,
        forceAllRefresh: false,
        handoffProbe: new HandoffMechanismProbe({
            runJson: runGhJson,
            cwd: state.repoRoot,
        }),
    };
    const server = createServer((req, res) => {
        handleRequest(entry, req, res).catch((error) => {
            sendJson(res, 500, { error: cleanText(error?.message || error, 1200) });
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    entry.server = server;
    entry.url = `http://127.0.0.1:${port}/`;
    servers.set(ctx.instanceId, entry);
    return entry;
}

async function refreshEntry(entry) {
    const refreshed = await loadState(entry.state.workingDirectory);
    entry.state = refreshed.state;
    entry.statePath = refreshed.statePath;
    await persist(entry);
    broadcast(entry);
    await refreshRemoteState(entry, { force: true });
}

const canvas = createCanvas({
    id: "squadcaster",
    displayName: "Factory Mission Control",
    description: "Observe Squad goals, issues, pull requests, workflow runs, checks, blockers, and evidence.",
    inputSchema: {
        type: "object",
        properties: {
            workingDirectory: {
                type: "string",
                description: "Optional repository working directory; defaults to the active project session.",
            },
        },
        additionalProperties: false,
    },
    actions: [
        {
            name: "get_state",
            description: "Return user-wide Squad activity and the current repository context.",
            handler: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (!entry) throw new CanvasError("squadcaster_not_open", "The activity canvas is not open.");
                await refreshRemoteState(entry, { force: true });
                return entry.state;
            },
        },
        {
            name: "refresh",
            description: "Rediscover and refresh user-wide Squad activity.",
            handler: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (!entry) throw new CanvasError("squadcaster_not_open", "The activity canvas is not open.");
                await refreshEntry(entry);
                return entry.state;
            },
        },
    ],
    open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        if (!entry) entry = await startServer(ctx);
        return {
            title: "Factory Mission Control",
            status: entry.state.activity?.summary?.active
                ? `${entry.state.activity.summary.active} active`
                : "Watching",
            url: entry.url,
        };
    },
    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) return;
        servers.delete(ctx.instanceId);
        for (const client of entry.clients) client.end();
        await new Promise((resolve) => entry.server.close(() => resolve()));
    },
});

session = await joinSession({
    canvases: [canvas],
    tools: [],
});
