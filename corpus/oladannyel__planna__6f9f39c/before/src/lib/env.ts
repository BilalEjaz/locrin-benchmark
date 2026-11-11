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

export const env = envSchema.parse(withLegacyAliases(process.env));
export type Env = z.infer<typeof envSchema>;
