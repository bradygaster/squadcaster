import { createServer } from "node:http";
import { once } from "node:events";
import { expect, test } from "@playwright/test";
import { renderHtml } from "../../renderer.mjs";
import { createStressCanvasState } from "../fixtures/stress-activity.mjs";

function goal({
    number,
    phase,
    title,
    repository = "octodemo/frontend",
    owner = "Frontend",
}) {
    const timestamp = `2026-09-20T${String(10 + number).padStart(2, "0")}:00:00Z`;
    const pullRequests = phase === "reviewing" ? [{
        number: 26,
        title: "Ship the mission control canvas",
        url: "https://github.com/octodemo/frontend/pull/26",
        state: "open",
        draft: true,
        reviewDecision: "review_required",
        branch: "squad/implement-4-mission-control",
        checks: [{
            name: "browser tests",
            status: "success",
            url: "https://github.com/octodemo/frontend/actions/runs/26",
        }],
    }] : [];
    const workflowRuns = phase === "implementing" ? [{
        id: 300 + number,
        name: "Implement mission control",
        workflow: "Squad Implement Worker",
        status: "in_progress",
        conclusion: "",
        branch: `squad/implement-${number}-mission-control`,
        url: `https://github.com/${repository}/actions/runs/${300 + number}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        jobsState: {
            status: "fresh",
            fetchedAt: timestamp,
            error: "",
            truncated: false,
        },
        jobs: [{
            id: 900 + number,
            name: "Browser validation",
            status: "completed",
            conclusion: "success",
            url: `https://github.com/${repository}/actions/runs/${300 + number}/job/${900 + number}`,
            startedAt: timestamp,
            completedAt: timestamp,
            steps: [{
                number: 1,
                name: "Run browser tests",
                status: "completed",
                conclusion: "success",
                startedAt: timestamp,
                completedAt: timestamp,
            }],
        }],
    }] : [];
    const readinessState = number === 1 ? "ready"
        : phase === "blocked" ? "blocked"
            : phase === "completed" ? "completed"
                : pullRequests.length || workflowRuns.length ? "already-in-progress"
                    : "ineligible";
    const readinessReasons = readinessState === "ready" ? []
        : readinessState === "blocked" ? [{
            text: "Dependency octodemo/backend#9 is not complete.",
            url: "https://github.com/octodemo/backend/issues/9",
        }]
            : readinessState === "completed" ? ["The task issue is closed."]
                : readinessState === "already-in-progress" ? ["Existing implementation work is active."]
                    : ["The issue is not an activated leaf task."];
    const existingImplementation = pullRequests.length ? {
        state: "active",
        pullRequests: pullRequests.map(item => ({
            number: item.number,
            title: `PR #${item.number} · ${item.title}`,
            url: item.url,
            state: item.state,
        })),
        workflowRuns: [],
        copilotTasks: [],
        sessions: [],
    } : workflowRuns.length ? {
        state: "active",
        pullRequests: [],
        workflowRuns: workflowRuns.map(item => ({
            id: item.id,
            title: item.workflow,
            url: item.url,
            status: item.status,
        })),
        copilotTasks: [],
        sessions: [],
    } : {
        state: readinessState === "completed" ? "completed" : "none",
        pullRequests: [],
        workflowRuns: [],
        copilotTasks: number === 2 ? [{
            id: "copilot-task-2",
            title: "Copilot task for issue #2",
            url: "https://github.com/octodemo/frontend/issues/2",
            status: "queued",
        }] : [],
        sessions: number === 2 ? [{
            id: "local-session-2",
            title: "Local project session",
            appUrl: "https://example.test/sessions/local-session-2",
            status: "active",
        }] : [],
    };
    return {
        id: `${repository}#${number}`,
        phase,
        issue: {
            number,
            title,
            state: phase === "completed" ? "CLOSED" : "OPEN",
            url: `https://github.com/${repository}/issues/${number}`,
        },
        repository: {
            nameWithOwner: repository,
            url: `https://github.com/${repository}`,
        },
        owner: { id: owner.toLowerCase(), name: owner },
        updatedAt: timestamp,
        nextAction: `Continue ${phase} work`,
        blockers: [],
        dependencies: number === 3 ? [{
            repository: "octodemo/backend",
            issueNumber: 9,
            title: "Publish the API",
            phase: "implementing",
            url: "https://github.com/octodemo/backend/issues/9",
        }] : [],
        pullRequests,
        workflowRuns,
        evidence: [{
            kind: phase === "reviewing" ? "pull-request" : "issue",
            title: `${title} moved to ${phase}`,
            timestamp,
            confidence: "observed",
            url: `https://github.com/${repository}/issues/${number}`,
        }],
        artifacts: [],
        handoff: {
            schemaVersion: 1,
            goalId: `${repository}#${number}`,
            readiness: {
                state: readinessState,
                reasons: readinessReasons,
                evaluatedAt: timestamp,
                automatedHandoffAvailable: readinessState === "ready",
                sourceStates: {
                    issue: "complete",
                    issueAssignees: "complete",
                    subIssues: "complete",
                    dependencies: readinessState === "blocked" ? "incomplete" : "complete",
                    pullRequests: "complete",
                    workflowRuns: "complete",
                    copilotTasks: "complete",
                    localSessions: "complete",
                },
            },
            activation: {
                rootIssue: "octodemo/frontend#100",
                rootIssueUrl: "https://github.com/octodemo/frontend/issues/100",
                artifactKind: "activated",
                artifactUrl: "https://github.com/octodemo/frontend/issues/100#issuecomment-1",
                schemaVersion: "1",
                task: String(number),
                agent: owner,
            },
            acceptanceCriteria: [{
                text: `The task ${title.toLowerCase()} is complete.`,
                sourceUrl: `https://github.com/${repository}/issues/${number}`,
            }],
            acceptanceCriteriaComplete: number !== 2,
            issueRevision: timestamp,
            existingImplementation,
            mechanisms: [
                { kind: "local-session", availability: "available", reasons: [] },
                {
                    kind: "copilot-cloud-agent",
                    availability: number === 1 ? "policy-blocked" : "available",
                    reasons: number === 1 ? ["Copilot cloud agent is disabled by repository policy."] : [],
                },
                { kind: "squad-implement", availability: "available", reasons: [] },
                { kind: "manual", availability: "available", reasons: [] },
            ],
        },
    };
}

function fixtureState() {
    const goals = [
        goal({ number: 1, phase: "queued", title: "Plan a deliberately long mission control workflow title" }),
        goal({ number: 2, phase: "researching", title: "Research accessible activity summaries", owner: "Researcher" }),
        goal({ number: 3, phase: "implementing", title: "Implement responsive pipeline containment" }),
        goal({ number: 4, phase: "reviewing", title: "Review keyboard drawer behavior", owner: "Reviewer" }),
        goal({ number: 5, phase: "completed", title: "Land semantic theme defaults", repository: "otherdemo/backend" }),
        goal({ number: 6, phase: "blocked", title: "Resolve upstream contract blocker", repository: "otherdemo/backend" }),
        goal({ number: 7, phase: "completed", title: "Archive a completed-only repository", repository: "archivedemo/archive" }),
    ];
    return {
        mode: "active",
        repoName: "octodemo/frontend",
        members: [],
        squad: { installed: true },
        activity: {
            currentRepository: "octodemo/frontend",
            fetchedAt: "2026-09-20T18:00:00Z",
            dayBoundary: {
                version: 1,
                kind: "utc-server-day",
                timeZone: "UTC",
                snapshotDay: "2026-09-20",
                startsAt: "2026-09-20T00:00:00.000Z",
                nextBoundaryAt: "2026-09-21T00:00:00.000Z",
                cacheKey: "day-boundary-v1:utc:2026-09-20",
            },
            snapshotDays: ["2026-09-20"],
            lastAttemptedRefresh: "2026-09-20T18:00:00Z",
            lastSuccessfulRefresh: "2026-09-20T18:00:00Z",
            repositories: [
                {
                    nameWithOwner: "octodemo/frontend",
                    owner: "octodemo",
                    included: true,
                    permission: "WRITE",
                    lastSuccessfulRefresh: "2026-09-20T18:00:00Z",
                },
                {
                    nameWithOwner: "otherdemo/backend",
                    owner: "otherdemo",
                    included: true,
                    permission: "READ",
                    lastSuccessfulRefresh: "2026-09-20T18:00:00Z",
                },
                {
                    nameWithOwner: "archivedemo/archive",
                    owner: "archivedemo",
                    included: true,
                    permission: "READ",
                    lastSuccessfulRefresh: "2026-09-20T18:00:00Z",
                },
            ],
            summary: {
                active: 5,
                queued: 1,
                researching: 1,
                implementing: 1,
                reviewing: 1,
                blocked: 1,
                failed: 0,
                awaitingReview: 1,
                completed: 2,
            },
            goals,
            errors: [],
        },
    };
}

async function startFixtureServer() {
    let state = fixtureState();
    let handoffProbeCount = 0;
    const clients = new Set();
    const server = createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/") {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(renderHtml());
            return;
        }
        if (request.method === "GET" && url.pathname === "/api/state") {
            if (url.searchParams.has("handoff")) handoffProbeCount += 1;
            response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            response.end(JSON.stringify(state));
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
        if (request.method === "POST" && url.pathname === "/api/refresh") {
            response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            response.end("{}");
            return;
        }
        response.writeHead(404);
        response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    return {
        url: `http://127.0.0.1:${port}/`,
        emit(nextState = state) {
            state = nextState;
            for (const client of clients) {
                client.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
            }
        },
        state() {
            return structuredClone(state);
        },
        handoffProbeCount() {
            return handoffProbeCount;
        },
        async close() {
            for (const client of clients) client.end();
            await new Promise((resolve) => {
                server.close(resolve);
                server.closeAllConnections();
            });
        },
    };
}

let fixture;

test.beforeEach(async ({ page }) => {
    fixture = await startFixtureServer();
    await page.goto(fixture.url);
    await expect(page.getByRole("heading", { name: "Factory floor" })).toBeVisible();
});

test.afterEach(async () => {
    await fixture.close();
});

for (const viewport of [
    { width: 320, height: 800 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
]) {
    test(`contains responsive layout at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);

        const layout = await page.evaluate(() => {
            const pipeline = document.querySelector(".pipeline-scroll");
            return {
                documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
                pipelineClientWidth: pipeline.clientWidth,
                pipelineScrollWidth: pipeline.scrollWidth,
                pipelineOverflowX: getComputedStyle(pipeline).overflowX,
                overscrollX: getComputedStyle(pipeline).overscrollBehaviorX,
                missionColumns: getComputedStyle(document.querySelector(".mission-layout")).gridTemplateColumns,
            };
        });

        expect(layout.documentOverflow).toBeLessThanOrEqual(0);
        expect(layout.bodyOverflow).toBeLessThanOrEqual(0);
        expect(layout.pipelineOverflowX).toBe("auto");
        expect(layout.overscrollX).toBe("contain");
        if (viewport.width <= 768) {
            expect(layout.pipelineScrollWidth).toBeGreaterThan(layout.pipelineClientWidth);
        }
        if (viewport.width === 768) {
            expect(layout.missionColumns.split(" ")).toHaveLength(1);
        }

        const pipeline = page.getByRole("region", { name: "Factory floor stages" });
        await pipeline.focus();
        await expect(pipeline).toBeFocused();
        if (viewport.width <= 768) {
            const beforeScroll = await pipeline.evaluate(element => element.scrollLeft);
            for (let index = 0; index < 5; index += 1) await page.keyboard.press("Tab");
            const finalStage = page.locator('[data-action="expand-stage"][data-phase="completed"]');
            await expect(finalStage).toBeFocused();
            const [pipelineBox, finalStageBox] = await Promise.all([pipeline.boundingBox(), finalStage.boundingBox()]);
            const visibleWidth = Math.min(
                finalStageBox.x + finalStageBox.width,
                pipelineBox.x + pipelineBox.width,
            ) - Math.max(finalStageBox.x, pipelineBox.x);
            expect(visibleWidth / finalStageBox.width).toBeGreaterThanOrEqual(0.75);
            if (viewport.width <= 375) {
                await expect.poll(() => pipeline.evaluate(element => element.scrollLeft)).toBeGreaterThan(beforeScroll);
            }
        }
    });
}

for (const colorScheme of ["light", "dark"]) {
    test(`uses the operating-system ${colorScheme} theme by default`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.reload();
        await expect(page.getByRole("heading", { name: "Factory floor" })).toBeVisible();

        const theme = await page.evaluate(() => ({
            colorScheme: getComputedStyle(document.documentElement).colorScheme,
            background: getComputedStyle(document.body).backgroundColor,
            text: getComputedStyle(document.body).color,
            darkMatches: matchMedia("(prefers-color-scheme: dark)").matches,
        }));

        expect(theme.colorScheme).toContain("light");
        expect(theme.colorScheme).toContain("dark");
        expect(theme.darkMatches).toBe(colorScheme === "dark");
        expect(theme.background).toBe(colorScheme === "dark" ? "rgb(13, 17, 23)" : "rgb(255, 255, 255)");
        expect(theme.text).not.toBe(theme.background);
    });
}

test("disables animation for reduced-motion users", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();

    const motion = await page.evaluate(() => {
        const stage = document.querySelector(".stage-card");
        return {
            matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
            animation: getComputedStyle(stage).animationName,
            transition: getComputedStyle(stage).transitionDuration,
            scrollBehavior: getComputedStyle(stage).scrollBehavior,
        };
    });

    expect(motion.matches).toBe(true);
    expect(motion.animation).toBe("none");
    expect(motion.transition).toBe("0s");
    expect(motion.scrollBehavior).toBe("auto");
});

test("retains visible state and focus affordances in forced colors", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.reload();
    await page.getByText("Browse goals").click();
    const reviewingFilter = page.locator('[data-action="phase-filter"][data-phase="reviewing"]');
    await reviewingFilter.click();

    const forcedColors = await page.evaluate(() => {
        const selected = document.querySelector(".filter.selected");
        return {
            matches: matchMedia("(forced-colors: active)").matches,
            outlineStyle: getComputedStyle(selected).outlineStyle,
            outlineWidth: getComputedStyle(selected).outlineWidth,
        };
    });

    expect(forcedColors.matches).toBe(true);
    expect(forcedColors.outlineStyle).not.toBe("none");
    expect(forcedColors.outlineWidth).not.toBe("0px");
    await expect(reviewingFilter).toHaveAttribute("aria-pressed", "true");
});

test("supports stage expansion and a contained modal focus cycle", async ({ page }) => {
    const stage = page.locator('[data-action="expand-stage"][data-phase="implementing"]');
    await stage.focus();
    await page.keyboard.press("Enter");
    await expect(stage).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("heading", { name: "implementing goals" })).toBeFocused();
    await expect(page.getByRole("button", { name: /Implement responsive pipeline containment/ })).toBeVisible();
    await expect(page.locator("#live-status")).toHaveText("Implementing stage expanded; 1 goal visible.");

    const goalTrigger = page.getByRole("button", { name: /Implement responsive pipeline containment/ });
    await goalTrigger.click();
    const dialog = page.getByRole("dialog", { name: /Implement responsive pipeline containment/ });
    const close = page.getByRole("button", { name: "Close goal details" });
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await expect(page.locator(".topbar")).toHaveAttribute("inert", "");
    await expect(dialog.getByRole("heading", { name: "Workflow jobs and steps" })).toBeVisible();
    await expect(dialog.getByText("Browser validation")).toBeVisible();
    await expect(dialog.getByText("Run browser tests")).toBeVisible();

    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("link").last()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(goalTrigger).toBeFocused();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("does not count or render unknown owners as observed", async ({ page }) => {
    const nextState = fixture.state();
    const queuedGoal = nextState.activity.goals.find(goal => goal.phase === "queued");
    queuedGoal.owner = { id: "", name: "Unknown", source: "unknown" };
    fixture.emit(nextState);

    const queuedStage = page.locator(".stage-card.queued");
    await expect(queuedStage.locator(".stage-agents")).toHaveAttribute("aria-label", "No observed owners");
    await expect(queuedStage.locator(".stage-foot")).toHaveText("0 owners observed");
    await expect(queuedStage.locator(".agent-chip")).toHaveCount(0);
});

test("renders read-only handoff readiness and probes availability only after opening", async ({ page }) => {
    expect(fixture.handoffProbeCount()).toBe(0);
    await page.locator('[data-action="expand-stage"][data-phase="queued"]').click();
    await page.getByRole("button", { name: /Plan a deliberately long mission control workflow title/ }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Handoff" })).toBeVisible();
    await expect(drawer.getByLabel("Handoff readiness: ready")).toContainText("ready");
    await expect(drawer.getByText("All task-readiness checks passed.")).toBeVisible();
    await expect(drawer.getByRole("link", { name: "octodemo/frontend#100" })).toBeVisible();
    await expect(drawer.getByText(/The task plan a deliberately long mission control workflow title is complete/)).toBeVisible();
    await expect(drawer.getByText("Local project session")).toBeVisible();
    await expect(drawer.getByText("Copilot cloud agent", { exact: true })).toBeVisible();
    await expect(drawer.getByText("/squad implement", { exact: true })).toBeVisible();
    await expect(drawer.getByText("Manual handling")).toBeVisible();
    await expect(drawer.getByText("policy blocked")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Copy context" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Export context" })).toBeVisible();
    await expect.poll(() => fixture.handoffProbeCount()).toBe(1);

    await expect(drawer.getByRole("button", { name: /Create|Assign|Dispatch|Launch|Post/i })).toHaveCount(0);
});

test("keeps incomplete and existing-work states fail closed with open-existing actions", async ({ page }) => {
    await page.locator('[data-action="expand-stage"][data-phase="researching"]').click();
    await page.getByRole("button", { name: /Research accessible activity summaries/ }).click();
    const incompleteDrawer = page.getByRole("dialog");
    await expect(incompleteDrawer.getByLabel("Handoff readiness: ineligible")).toBeVisible();
    await expect(incompleteDrawer.getByText("Incomplete source.")).toBeVisible();
    await expect(incompleteDrawer.getByRole("link", { name: "Open existing" })).toHaveCount(2);
    await expect(incompleteDrawer.getByRole("link", { name: "Open issue" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.locator('[data-action="expand-stage"][data-phase="reviewing"]').click();
    await page.getByRole("button", { name: /Review keyboard drawer behavior/ }).click();
    const activeDrawer = page.getByRole("dialog");
    await expect(activeDrawer.getByLabel("Handoff readiness: already-in-progress")).toBeVisible();
    await expect(activeDrawer.getByRole("link", { name: "Open existing" })).toHaveCount(1);
});

test("keeps stale, partial, capped, and unavailable sources unknown with manual actions", async ({ page }) => {
    const nextState = fixture.state();
    const item = nextState.activity.goals[0];
    item.handoff.readiness.state = "unknown";
    item.handoff.readiness.reasons = ["Reconciliation sources cannot prove that no implementation exists."];
    item.handoff.readiness.sourceStates = {
        issue: "stale",
        pullRequests: "partial",
        workflowRuns: "capped",
        copilotTasks: "unavailable",
        localSessions: "complete",
    };
    item.handoff.readiness.automatedHandoffAvailable = false;
    fixture.emit(nextState);

    await page.locator('[data-action="expand-stage"][data-phase="queued"]').click();
    await page.getByRole("button", { name: /Plan a deliberately long mission control workflow title/ }).click();
    const drawer = page.getByRole("dialog");

    await expect(drawer.getByLabel("Handoff readiness: unknown")).toBeVisible();
    await expect(drawer.getByText("Readiness is fail closed.")).toBeVisible();
    await expect(drawer.getByText("issue: stale")).toBeVisible();
    await expect(drawer.getByText("pull requests: partial")).toBeVisible();
    await expect(drawer.getByText("workflow runs: capped")).toBeVisible();
    await expect(drawer.getByText("copilot tasks: unavailable")).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Open issue" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Copy context" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: /Create|Assign|Dispatch|Launch|Post/i })).toHaveCount(0);
});

test("does not let a delayed handoff probe overwrite newer SSE state", async ({ page }) => {
    const staleState = fixture.state();
    let releaseProbe;
    let markProbeStarted;
    const probeStarted = new Promise(resolve => {
        markProbeStarted = resolve;
    });
    const probeGate = new Promise(resolve => {
        releaseProbe = resolve;
    });
    await page.route("**/api/state?handoff=*", async route => {
        markProbeStarted();
        await probeGate;
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(staleState),
        });
    });

    await page.locator('[data-action="expand-stage"][data-phase="queued"]').click();
    await page.getByRole("button", { name: /Plan a deliberately long mission control workflow title/ }).click();
    await probeStarted;

    const nextState = fixture.state();
    const item = nextState.activity.goals.find(goal => goal.id === "octodemo/frontend#1");
    item.issue.title = "Updated by SSE while probing";
    item.handoff.readiness.state = "blocked";
    item.handoff.readiness.reasons = ["A newer dependency observation blocks handoff."];
    fixture.emit(nextState);

    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: /Updated by SSE while probing/ })).toBeVisible();
    await expect(drawer.getByLabel("Handoff readiness: blocked")).toBeVisible();
    releaseProbe();
    await expect(drawer.getByRole("heading", { name: /Updated by SSE while probing/ })).toBeVisible();
    await expect(drawer.getByLabel("Handoff readiness: blocked")).toBeVisible();
});

test("distinguishes every readiness state without color-only semantics", async ({ page }) => {
    const nextState = fixture.state();
    const states = ["ready", "blocked", "already-in-progress", "completed", "ineligible", "unknown"];
    nextState.activity.goals = states.map((readinessState, index) => {
        const item = structuredClone(nextState.activity.goals[index]);
        item.id = `octodemo/frontend#${101 + index}`;
        item.issue.number = 101 + index;
        item.issue.title = `${readinessState} handoff`;
        item.phase = "queued";
        item.handoff.goalId = item.id;
        item.handoff.readiness.state = readinessState;
        item.handoff.readiness.reasons = readinessState === "ready" ? [] : [`${readinessState} reason`];
        return item;
    });
    fixture.emit(nextState);

    await page.locator('[data-action="expand-stage"][data-phase="queued"]').click();
    for (const readinessState of states) {
        await page.getByRole("button", { name: new RegExp(`${readinessState} handoff`) }).click();
        const badge = page.getByLabel(`Handoff readiness: ${readinessState}`);
        await expect(badge).toBeVisible();
        await expect(badge).toHaveText(readinessState.replaceAll("-", " "));
        const pseudoContent = await badge.evaluate(element => getComputedStyle(element, "::before").content);
        expect(pseudoContent).not.toBe("none");
        await page.keyboard.press("Escape");
    }
});

test("opens blocked goals from the Needs attention section", async ({ page }) => {
    await page.getByText("Browse goals").click();
    await page.locator('[data-action="phase-filter"][data-phase="blocked"]').click();

    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    const blockedGoal = page.getByRole("button", { name: /Resolve upstream contract blocker/ });
    await expect(blockedGoal).toBeVisible();
    await blockedGoal.click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Resolve upstream contract blocker");
});

test("distinguishes observed and inferred correlation evidence", async ({ page }) => {
    const state = fixture.state();
    const reviewingGoal = state.activity.goals.find((item) => item.phase === "reviewing");
    reviewingGoal.evidence = [
        {
            kind: "pull-request",
            title: "PR #26 linked by closing reference",
            timestamp: reviewingGoal.updatedAt,
            confidence: "observed",
            url: reviewingGoal.pullRequests[0].url,
        },
        {
            kind: "pull-request",
            title: "PR #28 linked by Squad marker",
            timestamp: reviewingGoal.updatedAt,
            confidence: "observed",
            url: "https://github.com/octodemo/frontend/pull/28",
        },
        {
            kind: "pull-request",
            title: "PR #27 linked by implementation branch",
            timestamp: reviewingGoal.updatedAt,
            confidence: "inferred",
            url: "https://github.com/octodemo/frontend/pull/27",
        },
    ];
    fixture.emit(state);

    await expect(page.locator(".activity-item").filter({
        hasText: "PR #26 linked by closing reference",
    })).toContainText("Observed correlation");
    await expect(page.locator(".activity-item").filter({
        hasText: "PR #28 linked by Squad marker",
    })).toContainText("Observed correlation");
    await expect(page.locator(".activity-item").filter({
        hasText: "PR #27 linked by implementation branch",
    })).toContainText("Inferred correlation");

    await page.getByText("Browse goals").click();
    await page.locator('[data-action="expand-stage"][data-phase="reviewing"]').click();
    await page.getByRole("button", { name: /Review keyboard drawer behavior/ }).click();

    const dialog = page.getByRole("dialog", { name: /Review keyboard drawer behavior/ });
    await expect(dialog.getByText("Observed correlation")).toHaveCount(2);
    await expect(dialog.getByText("Inferred correlation")).toBeVisible();
    await expect(dialog).toContainText("PR #26 linked by closing reference");
    await expect(dialog).toContainText("PR #28 linked by Squad marker");
    await expect(dialog).toContainText("PR #27 linked by implementation branch");

    const rerendered = structuredClone(state);
    rerendered.activity.fetchedAt = "2026-09-20T18:01:00Z";
    fixture.emit(rerendered);

    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Observed correlation")).toHaveCount(2);
    await expect(dialog.getByText("Inferred correlation")).toBeVisible();
});

test("labels partial refresh attempts separately from successful syncs", async ({ page }) => {
    await expect(page.locator("#repo-header")).toContainText(/synced/);
    await expect(page.locator("#repo-header")).toContainText("UTC server day 2026-09-20");

    const partialState = fixture.state();
    partialState.activity.fetchedAt = "2026-09-21T20:00:00Z";
    partialState.activity.dayBoundary = {
        version: 1,
        kind: "utc-server-day",
        timeZone: "UTC",
        snapshotDay: "2026-09-21",
        startsAt: "2026-09-21T00:00:00.000Z",
        nextBoundaryAt: "2026-09-22T00:00:00.000Z",
        cacheKey: "day-boundary-v1:utc:2026-09-21",
    };
    partialState.activity.lastAttemptedRefresh = "2026-09-21T20:00:00Z";
    partialState.activity.lastSuccessfulRefresh = "2026-09-20T18:00:00Z";
    partialState.activity.partial = true;
    partialState.activity.stale = true;
    fixture.emit(partialState);

    await expect(page.locator("#repo-header")).toContainText("refresh attempted");
    await expect(page.locator("#repo-header")).toContainText("last fully synced");
    await expect(page.locator("#repo-header")).toContainText("UTC server-day data 2026-09-20");
    await expect(page.locator("#repo-header")).toContainText("aggregate observed 2026-09-21");
});

test("preserves filters, expansion, and drawer state across live rerenders", async ({ page }) => {
    await page.getByText("Browse goals").click();
    const reviewingFilter = page.locator('[data-action="phase-filter"][data-phase="reviewing"]');
    await reviewingFilter.click();
    await expect(page.locator("#live-status")).toHaveText("Showing 1 goal filtered by reviewing.");

    const search = page.getByPlaceholder("Issue, goal, owner, or repository");
    await search.fill("drawer");
    await expect(search).toHaveValue("drawer");

    const reviewingStage = page.locator('[data-action="expand-stage"][data-phase="reviewing"]');
    await reviewingStage.click();
    await page.getByRole("button", { name: /Review keyboard drawer behavior/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    fixture.emit(fixture.state());

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close goal details" })).toBeFocused();
    await expect(page.locator(".filter-disclosure")).toHaveAttribute("open", "");
    await expect(reviewingFilter).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByPlaceholder("Issue, goal, owner, or repository")).toHaveValue("drawer");
    await expect(reviewingStage).toHaveAttribute("aria-expanded", "true");
});

test("applies every filter and announces the resulting goal set", async ({ page }) => {
    await page.getByText("Browse goals").click();
    const liveStatus = page.locator("#live-status");
    const owner = page.locator('[data-action="owner-filter"]');
    const repository = page.locator('[data-action="repository-filter"]');
    const activeOnly = page.locator('[data-action="active-repositories"]');
    const search = page.getByPlaceholder("Issue, goal, owner, or repository");

    await owner.selectOption("otherdemo");
    await expect(liveStatus).toHaveText("Showing 2 goals filtered by otherdemo.");
    await expect(page.locator(".pipeline-footer")).toContainText("2 visible");

    await owner.selectOption("all");
    await expect(liveStatus).toHaveText("Showing 7 goals.");
    await expect(page.locator(".pipeline-footer")).toContainText("7 visible");

    await activeOnly.check();
    await expect(liveStatus).toHaveText("Showing 6 goals filtered by active repositories.");
    await expect(page.locator(".pipeline-footer")).toContainText("6 visible");
    await expect(page.locator('[data-action="expand-stage"][data-phase="completed"]')).toContainText("1");
    await activeOnly.uncheck();
    await expect(liveStatus).toHaveText("Showing 7 goals.");

    await repository.selectOption("otherdemo/backend");
    await expect(liveStatus).toHaveText("Showing 2 goals filtered by otherdemo/backend.");

    await activeOnly.check();
    await expect(liveStatus).toHaveText("Showing 2 goals filtered by otherdemo/backend, active repositories.");

    await search.fill("blocker");
    await expect(liveStatus).toHaveText("Showing 1 goal filtered by otherdemo/backend, search “blocker”, active repositories.");
    await expect(page.locator(".pipeline-footer")).toContainText("1 visible");

    fixture.emit(fixture.state());
    await expect(owner).toHaveValue("all");
    await expect(repository).toHaveValue("otherdemo/backend");
    await expect(activeOnly).toBeChecked();
    await expect(search).toHaveValue("blocker");
});

test("excludes a repository whose goals are all completed from active-only results", async ({ page }) => {
    await page.getByText("Browse goals").click();
    const repository = page.locator('[data-action="repository-filter"]');
    const activeOnly = page.locator('[data-action="active-repositories"]');
    const liveStatus = page.locator("#live-status");

    await repository.selectOption("archivedemo/archive");
    await expect(page.locator(".pipeline-footer")).toContainText("1 visible");
    await expect(page.locator('[data-action="expand-stage"][data-phase="completed"]')).toContainText("1");

    await activeOnly.check();
    await expect(liveStatus).toHaveText("Showing 0 goals filtered by archivedemo/archive, active repositories.");
    await expect(page.locator(".pipeline-footer")).toContainText("0 visible");
    await expect(page.getByRole("heading", { name: "No goals found." })).toBeVisible();
});

test("recovers safely when a live update removes the open goal", async ({ page }) => {
    const stage = page.locator('[data-action="expand-stage"][data-phase="implementing"]');
    await stage.click();
    await page.getByRole("button", { name: /Implement responsive pipeline containment/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const nextState = fixture.state();
    nextState.activity.goals = nextState.activity.goals.filter(item => item.id !== "octodemo/frontend#3");
    fixture.emit(nextState);

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".topbar")).not.toHaveAttribute("inert", "");
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    await expect(page.getByRole("region", { name: "Factory floor stages" })).toBeFocused();
    await expect(page.locator("#live-status")).toHaveText("The selected goal is no longer visible. Goal details closed.");
});

test("preserves keyed scroll state while bounding production-scale collections", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const stressState = createStressCanvasState();
    for (const item of stressState.activity.goals) item.phase = "implementing";
    stressState.activity.summary = {
        active: stressState.activity.goals.length,
        queued: 0,
        blocked: 0,
        failed: 0,
        awaitingReview: 0,
        implementing: stressState.activity.goals.length,
        researching: 0,
        completed: 0,
    };
    fixture.emit(stressState);

    await expect(page.locator(".evidence-count")).toHaveText("4200");
    await expect(page.locator(".activity-item")).toHaveCount(20);
    await expect(page.getByText("Showing 1–20 of 4200 evidence events.")).toBeVisible();
    const olderActivity = page.getByRole("button", { name: "Older evidence" });
    await olderActivity.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Showing 21–40 of 4200 evidence events.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Newer evidence" })).toBeEnabled();

    const pipeline = page.getByRole("region", { name: "Factory floor stages" });
    await pipeline.focus();
    for (let index = 0; index < 5; index += 1) await page.keyboard.press("Tab");
    const pipelineScrollLeft = await pipeline.evaluate(element => element.scrollLeft);
    expect(pipelineScrollLeft).toBeGreaterThan(0);

    fixture.emit(stressState);
    await expect(page.getByText("Showing 21–40 of 4200 evidence events.")).toBeVisible();
    await expect(pipeline).toHaveJSProperty("scrollLeft", pipelineScrollLeft);

    await page.locator('[data-action="expand-stage"][data-phase="implementing"]').click();
    await expect(page.locator(".stage-goals .goal-trigger")).toHaveCount(80);
    await expect(page.getByText("Showing the first 80 of 140 matching goals.")).toBeVisible();
    await expect(page.locator(".run-row")).toHaveCount(12);
    await expect(page.getByText("Showing 1–12 of 280 active workflow runs.")).toBeVisible();
    await page.getByRole("button", { name: "Older workflows" }).click();
    await expect(page.getByText("Showing 13–24 of 280 active workflow runs.")).toBeVisible();
    const stageScrollLeft = await pipeline.evaluate(element => element.scrollLeft);

    await page.locator(".stage-goals .goal-trigger").first().click();
    const drawer = page.getByRole("dialog");
    const drawerBody = page.locator(".drawer-body");
    await expect(drawer).toBeVisible();
    await expect(page.locator(".topbar")).toHaveAttribute("inert", "");
    await drawerBody.evaluate(element => {
        element.scrollTop = 240;
    });
    const drawerScrollTop = await drawerBody.evaluate(element => element.scrollTop);
    expect(drawerScrollTop).toBeGreaterThan(0);

    fixture.emit(stressState);

    await expect(drawer).toBeVisible();
    await expect(page.getByRole("button", { name: "Close goal details" })).toBeFocused();
    await expect(page.locator(".topbar")).toHaveAttribute("inert", "");
    await expect(drawerBody).toHaveJSProperty("scrollTop", drawerScrollTop);
    await expect(pipeline).toHaveJSProperty("scrollLeft", stageScrollLeft);
});

test("filters evidence kinds and preserves bounded pages across repeated refreshes", async ({ page }) => {
    const pagedState = fixture.state();
    const target = pagedState.activity.goals[0];
    for (const item of pagedState.activity.goals) {
        item.evidence = [];
        item.workflowRuns = [];
    }
    target.evidence = Array.from({ length: 45 }, (_, index) => ({
        kind: "check",
        title: `Check evidence ${index + 1}`,
        timestamp: new Date(Date.UTC(2026, 8, 21, 18, 0) - index * 60_000).toISOString(),
        url: `https://example.test/check-page/${index + 1}`,
    }));
    target.workflowRuns = Array.from({ length: 45 }, (_, index) => ({
        id: index + 1,
        name: `Active workflow ${index + 1}`,
        workflow: "Dense workflow",
        status: "in_progress",
        conclusion: "",
        url: `https://example.test/workflow-page/${index + 1}`,
        branch: `dense/page-${index + 1}`,
        createdAt: new Date(Date.UTC(2026, 8, 21, 18, 0) - index * 60_000).toISOString(),
        updatedAt: new Date(Date.UTC(2026, 8, 21, 18, 0) - index * 60_000).toISOString(),
    }));
    fixture.emit(pagedState);

    const activity = page.locator(".activity-panel");
    await activity.getByRole("button", { name: "Checks" }).click();
    const checksFilter = activity.getByRole("button", { name: "Checks" });
    await expect(checksFilter).toHaveAttribute("aria-pressed", "true");
    await expect(activity.locator(".activity-item")).toHaveCount(20);
    await expect(activity.getByText("Showing 1–20 of 45 check events.")).toBeVisible();

    await activity.getByRole("button", { name: "Older evidence" }).click();
    await page.getByRole("button", { name: "Older workflows" }).click();
    const activityWindow = await activity.locator(".activity-item a").evaluateAll(
        (links) => links.map((link) => link.href),
    );
    const workflowWindow = await page.locator(".run-row").evaluateAll(
        (links) => links.map((link) => link.href),
    );

    const refreshed = structuredClone(pagedState);
    const refreshedTarget = refreshed.activity.goals[0];
    refreshedTarget.evidence.unshift(
        {
            kind: "check",
            title: "New check evidence A",
            timestamp: "2026-09-21T20:00:00Z",
            url: "https://example.test/check-page/new-a",
        },
        {
            kind: "check",
            title: "New check evidence B",
            timestamp: "2026-09-21T19:00:00Z",
            url: "https://example.test/check-page/new-b",
        },
    );
    refreshedTarget.workflowRuns.unshift(
        {
            id: 1001,
            name: "New active workflow A",
            workflow: "Dense workflow",
            status: "in_progress",
            conclusion: "",
            url: "https://example.test/workflow-page/new-a",
            branch: "dense/new-a",
            createdAt: "2026-09-21T20:00:00Z",
            updatedAt: "2026-09-21T20:00:00Z",
        },
        {
            id: 1002,
            name: "New active workflow B",
            workflow: "Dense workflow",
            status: "in_progress",
            conclusion: "",
            url: "https://example.test/workflow-page/new-b",
            branch: "dense/new-b",
            createdAt: "2026-09-21T19:00:00Z",
            updatedAt: "2026-09-21T19:00:00Z",
        },
    );
    const newerEvidence = activity.getByRole("button", { name: "Newer evidence" });
    await newerEvidence.focus();
    fixture.emit(refreshed);

    await expect(newerEvidence).toBeFocused();
    expect(await activity.locator(".activity-item a").evaluateAll(
        (links) => links.map((link) => link.href),
    )).toEqual(activityWindow);
    expect(await page.locator(".run-row").evaluateAll(
        (links) => links.map((link) => link.href),
    )).toEqual(workflowWindow);

    const removed = structuredClone(refreshed);
    removed.activity.goals[0].evidence = removed.activity.goals[0].evidence
        .filter((item) =>
            ![activityWindow[0], "https://example.test/check-page/20"].includes(item.url));
    removed.activity.goals[0].workflowRuns = removed.activity.goals[0].workflowRuns
        .filter((item) =>
            ![workflowWindow[0], "https://example.test/workflow-page/12"].includes(item.url));
    fixture.emit(removed);

    await expect(activity.locator(".activity-item a").first()).toHaveAttribute("href", activityWindow[1]);
    await expect(page.locator(".run-row").first()).toHaveAttribute("href", workflowWindow[1]);
    await expect(activity.locator(".activity-item")).toHaveCount(20);
    await expect(page.locator(".run-row")).toHaveCount(12);

    await page.locator(".filter-disclosure > summary").click();
    await page.locator('[data-action="phase-filter"][data-phase="all"]').click();
    await activity.getByRole("button", { name: "Checks" }).click();
    const visitedEvidence = [];
    while (true) {
        visitedEvidence.push(...await activity.locator(".activity-item a").evaluateAll(
            (links) => links.map((link) => link.href),
        ));
        const older = activity.getByRole("button", { name: "Older evidence" });
        if (await older.isDisabled()) break;
        await older.click();
    }
    const expectedEvidence = removed.activity.goals[0].evidence.map((item) => item.url).sort();
    expect([...new Set(visitedEvidence)].sort()).toEqual(expectedEvidence);
    expect(visitedEvidence).toHaveLength(expectedEvidence.length);

    await page.locator('[data-action="phase-filter"][data-phase="all"]').click();
    const visitedWorkflows = [];
    while (true) {
        visitedWorkflows.push(...await page.locator(".run-row").evaluateAll(
            (links) => links.map((link) => link.href),
        ));
        const older = page.getByRole("button", { name: "Older workflows" });
        if (await older.isDisabled()) break;
        await older.click();
    }
    const expectedWorkflows = removed.activity.goals[0].workflowRuns.map((item) => item.url).sort();
    expect([...new Set(visitedWorkflows)].sort()).toEqual(expectedWorkflows);
    expect(visitedWorkflows).toHaveLength(expectedWorkflows.length);
});

test("deduplicates refresh evidence and deterministically orders equal or missing timestamps", async ({ page }) => {
    const nextState = fixture.state();
    const target = nextState.activity.goals[0];
    target.evidence = [
        {
            kind: "issue",
            title: "Beta equal timestamp",
            timestamp: "2026-09-20T12:00:00Z",
            url: "https://example.test/beta",
        },
        {
            kind: "issue",
            title: "Alpha equal timestamp",
            timestamp: "2026-09-20T12:00:00Z",
            url: "https://example.test/alpha",
        },
        {
            kind: "issue",
            title: "Alpha equal timestamp",
            timestamp: "2026-09-20T12:00:00Z",
            url: "https://example.test/alpha",
        },
        {
            kind: "workflow",
            title: "Missing timestamp",
            timestamp: null,
            url: "https://example.test/missing",
        },
    ];
    for (const goalItem of nextState.activity.goals.slice(1)) goalItem.evidence = [];

    fixture.emit(nextState);
    fixture.emit(structuredClone(nextState));

    const titles = await page.locator(".activity-item a").allTextContents();
    expect(titles).toEqual([
        "Alpha equal timestamp",
        "Beta equal timestamp",
        "Missing timestamp",
    ]);
});

test("wraps dense workflow identifiers without viewport overflow", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const stressState = createStressCanvasState();
    for (const item of stressState.activity.goals) item.phase = "implementing";
    fixture.emit(stressState);

    const workflowName = page.locator(".run-name").first();
    await expect(workflowName).toBeVisible();
    await expect(workflowName).toHaveAttribute("title", /Workflow run/);
    const dimensions = await workflowName.evaluate((name) => {
        const row = name.closest(".run-row");
        const repository = row.querySelector(".run-repository");
        const branch = row.querySelector(".run-branch");
        return {
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            nameHeight: name.getBoundingClientRect().height,
            nameFontSize: parseFloat(getComputedStyle(name).fontSize),
            nameOverflow: getComputedStyle(name).overflow,
            nameLineClamp: getComputedStyle(name).webkitLineClamp,
            repositoryWrap: getComputedStyle(repository).overflowWrap,
            branchWrap: getComputedStyle(branch).overflowWrap,
            fullName: name.textContent,
            title: name.getAttribute("title"),
        };
    });

    expect(dimensions.documentOverflow).toBeLessThanOrEqual(0);
    expect(dimensions.nameHeight).toBeGreaterThan(0);
    expect(dimensions.nameHeight).toBeLessThanOrEqual(dimensions.nameFontSize * 3);
    expect(dimensions.nameOverflow).toBe("hidden");
    expect(dimensions.nameLineClamp).toBe("2");
    expect(dimensions.repositoryWrap).toBe("anywhere");
    expect(dimensions.branchWrap).toBe("anywhere");
    expect(dimensions.title).toBe(dimensions.fullName);
});

test("announces refresh completion without replacing the persistent status region", async ({ page }) => {
    await page.getByText("Browse goals").click();
    await page.getByRole("button", { name: "Refresh all" }).click();

    const liveStatus = page.locator("#live-status");
    await expect(liveStatus).toHaveAttribute("role", "status");
    await expect(liveStatus).toHaveAttribute("aria-live", "polite");
    await expect(liveStatus).toHaveAttribute("aria-atomic", "true");
    await expect(liveStatus).toHaveText("Squad activity refresh complete.");
});
