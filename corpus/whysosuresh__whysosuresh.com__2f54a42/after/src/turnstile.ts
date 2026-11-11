// The bot check's server half: asks Turnstile whether a token from the page is good, for this site's own
// host and the talk flow's action. A token is good once and for 5 minutes, so the page fetches it at Send.
// A check that can't be made is a refusal, never a pass.
//
// Local runs (`npm run dev`) hold Cloudflare's published always-pass test secret, whose verdicts name
// `example.com` and no action. Under that secret only, the host and action aren't matched: a Worker holding
// it passes every token anyway, and production holds the widget's real secret.

const VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

/** The action the page's widget names; a token minted for anything else is refused. */
export const ACTION = "talk";

/** Cloudflare's public always-pass test secret (developers.cloudflare.com/turnstile/troubleshooting/testing). */
export const TEST_SECRET = "1x0000000000000000000000000000000AA";

export async function verifyToken(secret: string, token: string, fields: { remoteIp: string; hostname: string }): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token, remoteip: fields.remoteIp });
  try {
    const response = await fetch(VERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return false;
    const verdict: { success?: unknown; hostname?: unknown; action?: unknown } = await response.json();
    if (secret === TEST_SECRET) return verdict.success === true;
    return verdict.success === true && verdict.hostname === fields.hostname && verdict.action === ACTION;
  } catch {
    return false;
  }
}
