import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const callTests = process.env.LIVEKIT_E2E === "1";

// Fake camera and mic so calls can run headless.
const media = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
// PW_CHROME=1 uses the installed Google Chrome instead of Playwright's download.
const browser = process.env.PW_CHROME === "1" ? { channel: "chrome" as const } : {};

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: callTests ? [] : ["**/call.spec.ts", "**/screenshots.spec.ts"],
  timeout: callTests ? 90_000 : 30_000,
  fullyParallel: !callTests,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    permissions: ["camera", "microphone"],
    launchOptions: { args: media },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...browser } },
    ...(callTests ? [] : [{ name: "mobile", use: { ...devices["Pixel 7"], ...browser } }]),
  ],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: {
      SITE_URL: `http://localhost:${PORT}`,
      ...(callTests ? {} : { LIVEKIT_URL: "", LIVEKIT_API_KEY: "", LIVEKIT_API_SECRET: "" }),
    },
  },
});
