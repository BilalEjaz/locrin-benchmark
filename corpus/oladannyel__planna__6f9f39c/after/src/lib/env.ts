import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Any OpenAI-compatible chat-completions endpoint. plAnna makes no call that
  // is specific to one vendor: no JSON mode, no tool calling, no structured
  // outputs — the task parser asks for JSON in the prompt and tolerates a
  // model that wraps it in a code fence or omits null keys. OpenRouter is the
  // default because its free tier makes the project free to run, not because
  // anything depends on it.
  AI_API_KEY: z.string().min(1),
  AI_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  AI_MODEL: z.string().default("openrouter/free"),
  AI_REPORT_MODEL: z.string().default("openrouter/free"),

  // Comma-separated models to try when the configured one fails in a way
  // another model could fix — retired (404), capped (429), or unwell (5xx).
  // Empty by default: failover is opt-in, because a silent switch to a model
  // you did not choose should be something you asked for.
  AI_MODEL_FALLBACKS: z.string().default(""),

  NEXT_PUBLIC_APP_URL: z.string().url(),

  // Shared secret for the scheduled health check. Optional in the schema and
  // required by the route: a contributor running `pnpm dev` has no cron to
  // authenticate, so demanding it here would fail the whole app at startup
  // over a job that is not running. `/api/cron/ai-health` refuses to serve
  // without it instead, which puts the failure where the risk is.
  CRON_SECRET: z.string().min(16).optional(),
});

/**
 * The AI settings were once named `OPENROUTER_*`. Those names still work, so
 * nobody's existing deployment breaks on upgrade, but the neutral names are
 * the documented ones — the old prefix claimed a vendor lock-in that the code
 * does not actually have.
 */
function withLegacyAliases(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const aliases: Record<string, string> = {
    AI_API_KEY: "OPENROUTER_API_KEY",
    AI_BASE_URL: "OPENROUTER_BASE_URL",
    AI_MODEL: "OPENROUTER_FREE_MODEL",
    AI_REPORT_MODEL: "OPENROUTER_REPORT_MODEL",
  };

  const resolved: NodeJS.ProcessEnv = { ...source };
  for (const [preferred, legacy] of Object.entries(aliases)) {
    const legacyValue = source[legacy];
    if (!resolved[preferred] && legacyValue) resolved[preferred] = legacyValue;
  }
  return resolved;
}

/**
 * The literal values shipped in `.env.local.example`.
 *
 * `cp .env.local.example .env.local` and nothing else leaves these in place,
 * and every one of them is *shape*-valid — `https://your-project.supabase.co`
 * is a perfectly good URL — so Zod accepts them, the server boots, and the
 * login page renders looking entirely functional. The failure only surfaces
 * when the user clicks "Send magic link" and the browser reports
 * `Failed to fetch`, which says nothing about the cause.
 *
 * A clean-clone run of the README ended exactly there. Checking for the
 * placeholders turns a confusing dead end near the finish into a precise
 * message at startup, which is what the README has always claimed happens.
 */
const PLACEHOLDERS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://your-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "your-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "your-service-role-key",
  AI_API_KEY: "your-api-key",
  CRON_SECRET: "your-cron-secret",
};

function rejectPlaceholders(source: NodeJS.ProcessEnv): void {
  const unfilled = Object.entries(PLACEHOLDERS)
    .filter(([name, placeholder]) => source[name] === placeholder)
    .map(([name]) => name);

  if (unfilled.length === 0) return;

  throw new Error(
    [
      "Your .env.local still has the example values for:",
      ...unfilled.map((name) => `  - ${name}`),
      "",
      "Fill them in before starting the app. The fastest way to get real",
      "values is the local stack, which needs no Supabase account:",
      "",
      "  supabase start          # prints the URL and keys to use",
      "  supabase db reset       # applies migrations and seeds a demo workspace",
      "",
      "See the Quick start in README.md.",
    ].join("\n"),
  );
}

function readEnv(source: NodeJS.ProcessEnv) {
  const resolved = withLegacyAliases(source);
  rejectPlaceholders(resolved);
  return envSchema.parse(resolved);
}

export const env = readEnv(process.env);
export type Env = z.infer<typeof envSchema>;
