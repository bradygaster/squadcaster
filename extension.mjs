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
import { GitHubSquadActivityAdapter } from "./github-activity.mjs";
import { GitHubGlobalActivity, normalizeRegistry } from "./global-activity.mjs";
import { renderHtml } from "./renderer.mjs";

const execFileAsync = promisify(execFile);
const servers = new Map();
let session;
let sharedRegistry = null;
let registryQueue = Promise.resolve();

const TOOL_PROPOSAL = "squadcaster_publish_proposal";
const TOOL_MISSION = "squadcaster_publish_mission_plan";

function slug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "member";
}

function cleanText(value, maxLength = 12000) {
    return String(value || "").trim().slice(0, maxLength);
}

function normalizeMembers(members) {
    const seen = new Set();
    return (Array.isArray(members) ? members : [])
        .slice(0, 24)
        .map((member, index) => {
            let id = slug(member?.id || member?.name || `member-${index + 1}`);
            while (seen.has(id)) id = `${id}-${index + 1}`;
            seen.add(id);
            return {
                id,
                name: cleanText(member?.name || `Member ${index + 1}`, 80),
                role: cleanText(member?.role || "Specialist", 120),
                rationale: cleanText(member?.rationale || "", 1200),
                charter: cleanText(member?.charter || "", 12000),
                lead: Boolean(member?.lead),
                reviewer: Boolean(member?.reviewer),
                charterPath: cleanText(member?.charterPath || "", 320),
                status: cleanText(member?.status || "Active", 40),
            };
        });
}

function normalizeTasks(tasks, memberIds) {
    const validMembers = new Set(memberIds);
    return (Array.isArray(tasks) ? tasks : [])
        .slice(0, 40)
        .map((task, index) => ({
            id: slug(task?.id || task?.title || `task-${index + 1}`),
            title: cleanText(task?.title || `Task ${index + 1}`, 180),
            description: cleanText(task?.description || "", 1200),
            ownerId: validMembers.has(task?.ownerId) ? task.ownerId : "",
            rationale: cleanText(task?.rationale || "", 1200),
        }));
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
    const lines = content.split(/\r?\n/);
    const members = [];
    let inMembers = false;

    for (const line of lines) {
        if (/^##\s+Members\b/i.test(line)) {
            inMembers = true;
            continue;
        }
        if (inMembers && /^##\s+/.test(line)) break;
        if (!inMembers || !line.trim().startsWith("|")) continue;

        const columns = line.split("|").slice(1, -1).map((column) => column.trim());
        if (columns.length < 3) continue;
        if (/^(name|[-:]+)$/i.test(columns[0])) continue;

        const name = columns[0].replaceAll("**", "").trim();
        const role = columns[1].replaceAll("**", "").trim();
        const charterMatch = columns[2].match(/`([^`]+)`/);
        const charterPath = charterMatch?.[1] || "";
        if (!name || name.startsWith("@")) continue;

        members.push({
            id: slug(name),
            name,
            role,
            rationale: `Configured in .squad/team.md as ${role}.`,
            charter: await readCharter(repoRoot, charterPath),
            charterPath,
            lead: /\blead\b/i.test(role),
            reviewer: /quality|review/i.test(role),
            status: columns[3]?.replace(/[✅📋🔄🤖]/gu, "").trim() || "Active",
        });
    }

    return normalizeMembers(members);
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
    if (!(await exists(statePath))) return null;
    try {
        const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
        return parsed && [1, 2].includes(parsed.version) ? parsed : null;
    } catch {
        return null;
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
                version: 1,
                mode: "unavailable",
                workingDirectory: workingDirectory || "",
                repoRoot: "",
                repoName: "",
                message: "Open Squadcaster from a Copilot project session.",
                signals: [],
                members: [],
                mission: null,
                operation: null,
                pullRequest: null,
                onboarding: { automation: null, cast: null, syncError: "" },
            },
        };
    }

    const actualMembers = await parseTeam(repoRoot);
    const initialized = actualMembers.length > 0;
    const workflowsInstalled = await Promise.all([
        exists(path.join(repoRoot, ".github", "workflows", "squad.md")),
        exists(path.join(repoRoot, ".github", "workflows", "squad.lock.yml")),
    ]).then((values) => values.some(Boolean));
    let members = initialized ? actualMembers : normalizeMembers(persisted?.members);

    if (initialized && persisted?.members?.length) {
        const drafts = new Map(persisted.members.map((member) => [member.id, member]));
        members = actualMembers.map((member) => {
            const draft = drafts.get(member.id);
            return draft
                ? {
                    ...member,
                    draftRole: draft.draftRole || draft.role || member.role,
                    draftCharter: draft.draftCharter || draft.charter || member.charter,
                    dirty: Boolean(draft.dirty),
                }
                : member;
        });
    }

    return {
        statePath,
        state: {
            version: 2,
            mode: initialized ? "active" : "setup",
            workingDirectory,
            repoRoot,
            repoName: path.basename(repoRoot),
            message: "",
            signals: Array.isArray(persisted?.signals) ? persisted.signals.slice(0, 12) : [],
            summary: cleanText(persisted?.summary || "", 1800),
            members,
            mission: persisted?.mission || null,
            operation: null,
            pullRequest: persisted?.pullRequest || null,
            onboarding: {
                automation: persisted?.onboarding?.automation || null,
                cast: persisted?.onboarding?.cast || null,
                syncError: "",
            },
            squad: {
                installed: initialized || workflowsInstalled,
                rosterAvailable: initialized,
                memberCount: members.length,
            },
            activity: persisted?.activity?.schemaVersion === 2 ? persisted.activity : {
                schemaVersion: 2,
                fetchedAt: null,
                repository: {},
                repositories: [],
                summary: { active: 0, blocked: 0, failed: 0, awaitingReview: 0, completed: 0 },
                goals: [],
                errors: [],
            },
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

function responseContent(response) {
    return cleanText(response?.data?.content || "", 20000);
}

function pullRequestFrom(text) {
    const content = String(text || "");
    const fullUrl = content.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i);
    if (fullUrl) return fullUrl[0];
    const shorthand = content.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/);
    return shorthand ? `https://github.com/${shorthand[1]}/pull/${shorthand[2]}` : "";
}

function castingText(value, fallback = "") {
    return cleanText(value || fallback, 12000).replace(/\/squad\b/gi, "Squad");
}

function castIssueBody(state) {
    const signals = state.signals.length
        ? `\n## Repository signals\n\n${state.signals.map((signal) => `- ${castingText(signal)}`).join("\n")}\n`
        : "";
    const members = state.members.map((member) => {
        const name = castingText(member.name, "Squad member").replace(/\r?\n/g, " ");
        const role = castingText(member.draftRole || member.role, "Specialist").replace(/\r?\n/g, " ");
        const charter = castingText(
            member.draftCharter || member.charter,
            `Own ${role} outcomes and collaborate with the rest of the Squad.`,
        );
        const designation = member.lead
            ? "Squad lead"
            : member.reviewer ? "Independent reviewer" : "Specialist";
        return `### ${name} — ${role}

**Designation:** ${designation}

**Why this role:** ${castingText(member.rationale, `Own the ${role} responsibility for this repository.`)}

#### Operating charter

${charter}`;
    }).join("\n\n");
    return `# Approved Squad

Create this repository-specific Squad exactly as reviewed. This issue is the source of truth for the roster, role boundaries, and operating charters.

## Repository context

${castingText(state.summary, `A tailored Squad for ${state.repoName}.`)}
${signals}
## Team specification

${members}

## Casting requirements

- Preserve these member names, roles, designations, and responsibility boundaries.
- Generate the standard Squad team, charter, routing, history, and agent files.
- Open a pull request for human review.
- Do not merge the pull request.
`;
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

async function createCastIssue(entry) {
    if (entry.state.operation?.status === "running") return;
    await updateState(entry, (state) => {
        state.operation = {
            kind: "cast-issue",
            status: "running",
            message: "Creating the cast issue and starting Squad…",
        };
    });

    try {
        const repository = await runGhJson(
            ["repo", "view", "--json", "nameWithOwner"],
            entry.state.repoRoot,
        );
        const nameWithOwner = cleanText(repository.nameWithOwner, 300);
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(nameWithOwner)) {
            throw new Error("GitHub CLI did not return a valid repository name.");
        }

        const issues = await runGhJson(
            [
                "issue", "list",
                "--state", "all",
                "--search", "\"Cast the Squad\" in:title",
                "--json", "number,title,url,state",
                "--limit", "100",
            ],
            entry.state.repoRoot,
        );
        let issue = Array.isArray(issues)
            ? issues.find((candidate) => candidate.title === "Cast the Squad")
            : null;
        if (!issue) {
            issue = await runGhJson(
                ["api", "--method", "POST", `repos/${nameWithOwner}/issues`, "--input", "-"],
                entry.state.repoRoot,
                {
                    title: "Cast the Squad",
                    body: castIssueBody(entry.state),
                },
            );
        } else {
            issue = await runGhJson(
                ["api", "--method", "PATCH", `repos/${nameWithOwner}/issues/${issue.number}`, "--input", "-"],
                entry.state.repoRoot,
                {
                    title: "Cast the Squad",
                    body: castIssueBody(entry.state),
                    state: "open",
                },
            );
        }

        const issueNumber = Number(issue.number);
        const issueUrl = cleanText(issue.html_url || issue.url, 500);
        if (!Number.isInteger(issueNumber) || issueNumber <= 0 || !issueUrl) {
            throw new Error("GitHub did not return the created cast issue.");
        }

        const comments = await runGhJson(
            ["api", `repos/${nameWithOwner}/issues/${issueNumber}/comments?per_page=100`],
            entry.state.repoRoot,
        );
        const castAlreadyStarted = Array.isArray(comments) &&
            comments.some((comment) =>
                String(comment?.body || "").trim() === "/squad cast" &&
                Date.now() - Date.parse(comment?.created_at || 0) < 15 * 60 * 1000);
        if (!castAlreadyStarted) {
            await runGhJson(
                [
                    "api", "--method", "POST",
                    `repos/${nameWithOwner}/issues/${issueNumber}/comments`,
                    "--input", "-",
                ],
                entry.state.repoRoot,
                { body: "/squad cast" },
            );
        }

        await updateState(entry, (state) => {
            state.onboarding ||= { automation: null, cast: null, syncError: "" };
            state.onboarding.cast = {
                issueUrl,
                issueNumber,
                status: "triggered",
                command: "/squad cast",
                triggeredAt: new Date().toISOString(),
            };
            state.operation = {
                kind: "cast-issue",
                status: "complete",
                message: "Cast issue created and /squad cast posted. Squad is preparing pull request 2 of 2.",
            };
        });
    } catch (error) {
        await updateState(entry, (state) => {
            state.operation = {
                kind: "cast-issue",
                status: "error",
                message: cleanText(error?.message || error, 1200),
            };
        });
    }
}

function isAutomationPullRequest(pullRequest) {
    const files = Array.isArray(pullRequest?.files) ? pullRequest.files : [];
    const workflowFiles = files.filter((file) =>
        /^\.github\/workflows\/squad(?:-implement-worker|-review)?(?:\.md|\.lock\.yml)$/i.test(file?.path || ""));
    return /(?:squad.*automation|automation.*squad)/i.test(pullRequest?.title || "") ||
        workflowFiles.length >= 2;
}

async function inspectAutomationPullRequest(repoRoot) {
    try {
        const { stdout } = await execFileAsync(
            "gh",
            ["pr", "view", "--json", "url,state,mergedAt,title,files"],
            {
                cwd: repoRoot,
                windowsHide: true,
                maxBuffer: 4 * 1024 * 1024,
            },
        );
        const pullRequest = JSON.parse(stdout);
        if (!isAutomationPullRequest(pullRequest)) return null;
        return {
            url: cleanText(pullRequest.url, 500),
            status: pullRequest.mergedAt || pullRequest.state === "MERGED"
                ? "merged"
                : cleanText(pullRequest.state || "open", 40).toLowerCase(),
            mergedAt: pullRequest.mergedAt || null,
            title: cleanText(pullRequest.title, 240),
        };
    } catch (error) {
        const detail = cleanText(`${error?.stderr || ""}\n${error?.message || error}`, 1600);
        if (/no pull requests found|could not resolve to a pullrequest/i.test(detail)) return null;
        throw new Error(`Unable to check the automation pull request: ${detail}`);
    }
}

async function refreshRemoteState(entry, { force = false } = {}) {
    if (!entry.state.repoRoot) return;
    if (!force && Date.now() - (entry.lastRemoteCheckAt || 0) < 10000) return;
    if (entry.remoteCheckPromise) return entry.remoteCheckPromise;

    entry.lastRemoteCheckAt = Date.now();
    entry.remoteCheckPromise = (async () => {
        try {
            const currentAdapter = new GitHubSquadActivityAdapter({
                runJson: runGhJson,
                cwd: entry.state.repoRoot,
            });
            const currentRepository = entry.state.activity?.currentRepository ||
                entry.state.activity?.repository?.nameWithOwner ||
                "";
            const currentPrevious = entry.registry.snapshots?.[currentRepository.toLowerCase()] ||
                (entry.state.activity?.scope === "user" ? null : entry.state.activity);
            const currentSnapshot = await currentAdapter.discover({
                members: entry.state.members,
                previous: currentPrevious,
            });
            const nameWithOwner = currentSnapshot.repository?.nameWithOwner || currentRepository;
            const activity = await withRegistryLock(async () => {
                const global = new GitHubGlobalActivity({
                    runJson: runGhJson,
                    cwd: entry.state.repoRoot,
                    registry: sharedRegistry || entry.registry,
                });
                const aggregated = await global.refresh({
                    currentRepository: nameWithOwner,
                    currentSnapshot,
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
            await updateState(entry, (state) => {
                state.activity ||= {
                    schemaVersion: 2,
                    repositories: [],
                    summary: { active: 0, blocked: 0, failed: 0, awaitingReview: 0, completed: 0 },
                    goals: [],
                    errors: [],
                };
                state.activity.errors = [{ source: "GitHub", message }];
                state.activity.stale = true;
            });
        } finally {
            entry.remoteCheckPromise = null;
        }
    })();
    return entry.remoteCheckPromise;
}

function proposalPrompt(entry) {
    return `Analyze the repository at ${entry.state.repoRoot} without modifying it.

Your goal is to propose the smallest useful Squad for this repository. Infer responsibilities from the actual architecture, tests, documentation, workflows, and recurring ownership boundaries. Do not ask the user to assign hypothetical tasks during onboarding.

When complete, call the ${TOOL_PROPOSAL} tool exactly once with:
- instanceId: ${entry.instanceId}
- repositoryName
- summary: a concise repository-specific explanation
- signals: 3-8 concrete repository signals
- members: 3-8 proposed members, each with id, name, role, rationale, charter, lead, and reviewer

Every charter must be repository-specific and actionable. Include one lead and one independent reviewer. Do not edit files, create branches, or open pull requests during this analysis.`;
}

function missionPrompt(entry, goal) {
    const team = entry.state.members.map(({ id, name, role }) => ({ id, name, role }));
    return `Plan a Squad mission for the repository at ${entry.state.repoRoot}.

Goal:
${goal}

Authorized roster:
${JSON.stringify(team, null, 2)}

Inspect the repository as needed, but do not modify it. Decompose the goal into the smallest coherent set of tasks and assign each task to the member most likely to handle it well. The user should only need to override exceptional assignments.

When complete, call ${TOOL_MISSION} exactly once with:
- instanceId: ${entry.instanceId}
- goal
- summary
- tasks: id, title, description, ownerId, rationale

Use only ownerId values from the authorized roster.`;
}

function automationPullRequestPrompt(entry) {
    return `Create the first of two Squad onboarding pull requests in ${entry.state.repoRoot}.

This pull request bootstraps repository automation only. The approved Squad proposal remains in the canvas and will be delivered later through a separate Cast pull request.

Work in the current Copilot project-session worktree.

Requirements:
1. Verify the GitHub Agentic Workflows extension is available. Install github/gh-aw only if it is missing.
2. Add the Squad dispatcher, implementation worker, and reviewer in this order:
   gh aw add bradygaster/squad/workflows/squad.md@dev bradygaster/squad/workflows/squad-implement-worker.md@dev bradygaster/squad/workflows/squad-review.md@dev
3. If gh-aw reports a restricted-secret safe-update approval requirement, stop and surface the exact warning instead of approving it automatically.
4. Do not generate or modify .squad/**, .github/agents/squad.agent.md, or meet-the-squad.md in this pull request.
5. Confirm the diff is limited to the gh-aw bootstrap surface: .gitattributes, .github/workflows/**, and .github/skills/**.
6. Commit, push the project-session branch, and open a reviewable pull request titled to make clear that it installs Squad automation.
7. Never merge the pull request, change repository Actions settings, or bypass branch protection.

If npm access becomes necessary, first run:
npm config set registry "https://packagefeedproxy.microsoft.io/npm/"

Finish with the pull request URL on its own line.`;
}

function charterPullRequestPrompt(entry) {
    const changes = entry.state.members
        .filter((member) => member.dirty)
        .map((member) => ({
            id: member.id,
            name: member.name,
            charterPath: member.charterPath,
            role: member.draftRole || member.role,
            charter: member.draftCharter || member.charter,
        }));
    return `Apply the confirmed Squad charter changes in ${entry.state.repoRoot}.

Approved changes:
${JSON.stringify(changes, null, 2)}

Only edit the listed Squad member records and charter files. Preserve all other team configuration. Validate the resulting Squad state, commit, push the project-session branch, and open a reviewable pull request. Never merge it.

If npm access becomes necessary, first run:
npm config set registry "https://packagefeedproxy.microsoft.io/npm/"

Finish with the pull request URL on its own line.`;
}

function executeMissionPrompt(entry) {
    const mission = entry.state.mission;
    return `Execute this confirmed Squad mission in ${entry.state.repoRoot}.

Goal:
${mission.goal}

Approved plan:
${JSON.stringify(mission.tasks, null, 2)}

Execution rules:
1. The current project session is the sole writer to the candidate branch.
2. Use separate agent contexts for specialist investigation and evidence when useful.
3. Follow the approved ownership plan unless a repository fact makes it impossible; surface that conflict instead of silently rerouting.
4. Synthesize one candidate diff, run targeted validation, then perform an independent review of the exact candidate.
5. Address blocking review findings, revalidate, commit, push, and open a pull request.
6. Never merge the pull request or bypass branch protection.

If npm access becomes necessary, first run:
npm config set registry "https://packagefeedproxy.microsoft.io/npm/"

Finish with the pull request URL on its own line.`;
}

async function runAgentOperation(entry, kind, prompt) {
    if (entry.state.operation?.status === "running") return;
    await updateState(entry, (state) => {
        state.operation = { kind, status: "running", message: "Copilot is working…" };
    });
    try {
        const response = await session.sendAndWait({ prompt }, 15 * 60 * 1000);
        const content = responseContent(response);
        if (kind === "analyze" && entry.state.members.length > 0) return;
        if (kind === "plan" && entry.state.mission?.tasks?.length > 0) return;

        const prUrl = pullRequestFrom(content);
        await updateState(entry, (state) => {
            state.operation = {
                kind,
                status: prUrl ? "complete" : "error",
                message: prUrl
                    ? "Pull request created."
                    : "Copilot finished without returning the expected structured result.",
            };
            if (prUrl) {
                state.pullRequest = { url: prUrl, createdAt: new Date().toISOString(), kind, status: "open" };
                if (kind === "automation-pr") {
                    state.onboarding ||= { automation: null, cast: null, syncError: "" };
                    state.onboarding.automation = {
                        url: prUrl,
                        status: "open",
                        mergedAt: null,
                        title: "",
                    };
                }
            }
        });
    } catch (error) {
        await updateState(entry, (state) => {
            state.operation = {
                kind,
                status: "error",
                message: cleanText(error?.message || error, 1200),
            };
        });
    }
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
    displayName: "Squadcaster",
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
                if (!entry) throw new CanvasError("squadcaster_not_open", "Squadcaster is not open.");
                await refreshRemoteState(entry, { force: true });
                return entry.state;
            },
        },
        {
            name: "refresh",
            description: "Rediscover and refresh user-wide Squad activity.",
            handler: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (!entry) throw new CanvasError("squadcaster_not_open", "Squadcaster is not open.");
                await refreshEntry(entry);
                return entry.state;
            },
        },
    ],
    open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        if (!entry) entry = await startServer(ctx);
        return {
            title: entry.state.repoName ? `All Squads · ${entry.state.repoName}` : "All Squads",
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
