import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// WebKit regression coverage for native date controls. Real iOS Safari still
// needs a device check; emulation here covers the engine's form layout.
export default defineConfig({
  ...config,
  testMatch: "**/layout.spec.ts",
  outputDir: "test-results/webkit",
  use: { ...config.use, launchOptions: {} },
  projects: [
    {
      name: "webkit-phone",
      use: {
        browserName: "webkit",
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "webkit-desktop",
      use: {
        browserName: "webkit",
        viewport: { width: 820, height: 1180 },
        isMobile: false,
      },
    },
  ],
});
