import { readFileSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, run against the local Supabase stack.
 *
 * These cover what the unit suite deliberately cannot. The coverage config
 * excludes the dnd-kit board views, the Supabase client glue and the realtime
 * wiring because each needs a real browser or a real backend — which was a
 * sound reason not to unit-test them and a poor reason to leave them
 * untested. Drag-and-drop, the auth round trip and persistence across a
 * reload are the three things most likely to break for someone cloning this
 * repo, and they were the three with no test at all.
 *
 * Prerequisites (see e2e/README.md):
 *   supabase start && supabase db reset
 *
 * Then: pnpm test:e2e
 */

/**
 * 3100 and the `localhost` spelling are deliberate, not arbitrary. Supabase
 * refuses a magic-link `redirect_to` that is not allow-listed and quietly
 * bounces to `site_url` instead, which lands the browser back on /login
 * looking exactly like a failed sign-in. `supabase/config.toml` already
 * allow-lists `http://localhost:3100/auth/callback`, so the suite uses it and
 * needs no change to the stack's configuration.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

/**
 * Point the app at the local stack without touching the developer's own
 * `.env.local`, which on a working machine holds real project credentials.
 *
 * Values passed here win: Next does not override variables already present in
 * the environment, so `.env.local` cannot drag the build back to a hosted
 * project. That matters for more than tidiness — `NEXT_PUBLIC_*` is inlined at
 * build time, so a build that picked up the wrong Supabase URL would run the
 * whole suite against someone's real data.
 */
function localStackEnv(): Record<string, string> {
  const path = ".env.local.local-stack";
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `${path} is missing. It holds the local Supabase credentials the e2e suite runs against — see e2e/README.md.`,
    );
  }

  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }

  // The app is served on the e2e port, and the magic link must come back to it.
  env.NEXT_PUBLIC_APP_URL = baseURL;
  return env;
}

export default defineConfig({
  testDir: "./e2e",
  // Serial by default: the specs share one seeded workspace, and a board test
  // that moves a task is not independent of one that reads the same board.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  /**
   * Tests run against a production build, not `next dev`. The dev server has
   * a different CSP (it needs 'unsafe-eval' for Turbopack) and different
   * rendering behaviour, so testing it would leave the artefact that actually
   * ships unverified.
   */
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: baseURL,
    /*
     * Never reuse a running server, even locally.
     *
     * The tempting setting is `!process.env.CI`, to skip the rebuild between
     * runs. It is a trap: with a server already on this port, Playwright
     * silently attaches to it, and every spec then exercises the build from
     * before the change you are trying to verify. Failures look like
     * application bugs and a correct fix looks like it did not work. A
     * rebuild per run is cheap next to a wrong conclusion about whether the
     * app works.
     */
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: localStackEnv(),
  },
});
