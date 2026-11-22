import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: a real browser against a real production build.
 *
 * The AI routes are mocked inside each test (page.route), so E2E runs are
 * fast, free, deterministic, and need no API key in CI.
 *
 * Browser: CI (Ubuntu) uses Playwright's bundled Chromium. Locally we drive
 * the installed Google Chrome, because Playwright's Chromium build doesn't
 * support older macOS versions. Override with PW_CHANNEL if needed.
 */
const PORT = 3100;
const isCI = Boolean(process.env.CI);
const channel = process.env.PW_CHANNEL ?? (isCI ? undefined : "chrome");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI, // a stray test.only must never pass CI
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel } }],
  webServer: {
    // Test what users get: a production build, not the dev server.
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
