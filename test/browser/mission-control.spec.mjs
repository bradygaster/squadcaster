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
        pullRequests: phase === "reviewing" ? [{
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
        }] : [],
        workflowRuns: phase === "implementing" ? [{
            id: 300 + number,
            name: "Implement mission control",
            workflow: "Squad Implement Worker",
            status: "in_progress",
            conclusion: "",
            branch: `squad/implement-${number}-mission-control`,
            url: `https://github.com/${repository}/actions/runs/${300 + number}`,
            createdAt: timestamp,
            updatedAt: timestamp,
        }] : [],
        evidence: [{
            kind: phase === "reviewing" ? "pull-request" : "issue",
            title: `${title} moved to ${phase}`,
            timestamp,
            confidence: "observed",
            url: `https://github.com/${repository}/issues/${number}`,
        }],
        artifacts: [],
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
    const clients = new Set();
    const server = createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/") {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(renderHtml());
            return;
        }
        if (request.method === "GET" && url.pathname === "/api/state") {
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

    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("link").last()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(goalTrigger).toBeFocused();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
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
    await expect(page.locator(".activity-item")).toHaveCount(100);
    await expect(page.getByText("Showing the newest 100 of 4200 evidence events.")).toBeVisible();
    const olderActivity = page.locator("details.activity-more");
    await expect(olderActivity.getByText("Show 88 older events")).toBeVisible();
    await olderActivity.locator("summary").click();

    const pipeline = page.getByRole("region", { name: "Factory floor stages" });
    await pipeline.focus();
    for (let index = 0; index < 5; index += 1) await page.keyboard.press("Tab");
    const pipelineScrollLeft = await pipeline.evaluate(element => element.scrollLeft);
    expect(pipelineScrollLeft).toBeGreaterThan(0);

    fixture.emit(stressState);
    await expect(olderActivity).toHaveAttribute("open", "");
    await expect(pipeline).toHaveJSProperty("scrollLeft", pipelineScrollLeft);

    await page.locator('[data-action="expand-stage"][data-phase="implementing"]').click();
    await expect(page.locator(".stage-goals .goal-trigger")).toHaveCount(80);
    await expect(page.getByText("Showing the first 80 of 140 matching goals.")).toBeVisible();
    await expect(page.locator(".run-row")).toHaveCount(80);
    await expect(page.getByText("Showing the newest 80 of 280 active workflow runs.")).toBeVisible();
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

test("announces refresh completion without replacing the persistent status region", async ({ page }) => {
    await page.getByText("Browse goals").click();
    await page.getByRole("button", { name: "Refresh all" }).click();

    const liveStatus = page.locator("#live-status");
    await expect(liveStatus).toHaveAttribute("role", "status");
    await expect(liveStatus).toHaveAttribute("aria-live", "polite");
    await expect(liveStatus).toHaveAttribute("aria-atomic", "true");
    await expect(liveStatus).toHaveText("Squad activity refresh complete.");
});
