import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = process.env;

const VALID_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  AI_API_KEY: "key",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

/** Start from a clean slate so a stray legacy name cannot mask a failure. */
function setEnv(overrides: Record<string, string> = {}): void {
  process.env = { ...ORIGINAL_ENV, ...VALID_ENV, ...overrides };
  for (const legacy of [
    "OPENROUTER_API_KEY",
    "OPENROUTER_BASE_URL",
    "OPENROUTER_FREE_MODEL",
    "OPENROUTER_REPORT_MODEL",
  ]) {
    if (!(legacy in overrides)) delete process.env[legacy];
  }
}

describe("env", () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("parses a valid environment and applies defaults", async () => {
    const { env } = await import("../env");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
    expect(env.AI_BASE_URL).toBe("https://openrouter.ai/api/v1");
    expect(env.AI_MODEL).toBe("openrouter/free");
    expect(env.AI_REPORT_MODEL).toBe("openrouter/free");
  });

  it("defaults to no fallback models, keeping failover opt-in", async () => {
    const { env } = await import("../env");
    expect(env.AI_MODEL_FALLBACKS).toBe("");
  });

  it("carries a configured fallback chain through verbatim", async () => {
    setEnv({ AI_MODEL_FALLBACKS: "a/one, b/two" });
    const { env } = await import("../env");
    expect(env.AI_MODEL_FALLBACKS).toBe("a/one, b/two");
  });

  it("respects an explicit AI_BASE_URL override", async () => {
    setEnv({ AI_BASE_URL: "https://proxy.example.com/v1" });
    const { env } = await import("../env");
    expect(env.AI_BASE_URL).toBe("https://proxy.example.com/v1");
  });

  it("points at any OpenAI-compatible provider", async () => {
    setEnv({
      AI_BASE_URL: "https://api.groq.com/openai/v1",
      AI_MODEL: "llama-3.3-70b-versatile",
      AI_REPORT_MODEL: "llama-3.3-70b-versatile",
    });
    const { env } = await import("../env");
    expect(env.AI_BASE_URL).toBe("https://api.groq.com/openai/v1");
    expect(env.AI_MODEL).toBe("llama-3.3-70b-versatile");
  });

  it("throws when a required variable is missing", async () => {
    setEnv();
    delete process.env.AI_API_KEY;
    await expect(import("../env")).rejects.toThrow();
  });

  it("throws when a URL variable is malformed", async () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" });
    await expect(import("../env")).rejects.toThrow();
  });
});

/** Nobody's existing deployment should break when they pull this version. */
describe("env legacy OPENROUTER_* names", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("accepts the old names as a fallback", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      ...VALID_ENV,
      OPENROUTER_API_KEY: "legacy-key",
      OPENROUTER_BASE_URL: "https://legacy.example.com/v1",
      OPENROUTER_FREE_MODEL: "legacy/parse",
      OPENROUTER_REPORT_MODEL: "legacy/report",
    };
    delete process.env.AI_API_KEY;

    const { env } = await import("../env");
    expect(env.AI_API_KEY).toBe("legacy-key");
    expect(env.AI_BASE_URL).toBe("https://legacy.example.com/v1");
    expect(env.AI_MODEL).toBe("legacy/parse");
    expect(env.AI_REPORT_MODEL).toBe("legacy/report");
  });

  it("prefers the new name when both are set", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      ...VALID_ENV,
      AI_MODEL: "new/model",
      OPENROUTER_FREE_MODEL: "old/model",
    };

    const { env } = await import("../env");
    expect(env.AI_MODEL).toBe("new/model");
  });
});
