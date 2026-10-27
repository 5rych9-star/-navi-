import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

/** Real SDK integration against intercepted HTTP fixtures, never a live project. */
export default defineConfig({
  testDir: "./e2e/auth",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5175",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
  },
  projects: [
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5175 --strictPort",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_SUPABASE_URL: "https://auth-fixture.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY:
        "sb_publishable_TEST_FIXTURE_NOT_A_REAL_KEY_1234567890",
    },
  },
});
