import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
