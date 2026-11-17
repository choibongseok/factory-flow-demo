import { defineConfig } from "@playwright/test";

// Serves the static export (npm run build with NEXT_PUBLIC_DEMO_MODE=static) and drives it in a real browser.
// Uses the locally installed Chrome; set PW_CHANNEL= (empty) to use Playwright's own Chromium instead.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    channel: process.env.PW_CHANNEL === undefined ? "chrome" : process.env.PW_CHANNEL || undefined,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "node e2e/serve.mjs",
    url: "http://localhost:4173",
    reuseExistingServer: true,
  },
});
