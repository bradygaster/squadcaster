import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./test/browser",
    outputDir: "./artifacts/playwright",
    reporter: "line",
    workers: 1,
    use: {
        ...devices["Desktop Chrome"],
        headless: true,
        trace: "retain-on-failure",
    },
});
