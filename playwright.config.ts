import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  webServer: { command: "pnpm --filter playground preview --port 4173", port: 4173, reuseExistingServer: true },
  use: { baseURL: "http://localhost:4173" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});