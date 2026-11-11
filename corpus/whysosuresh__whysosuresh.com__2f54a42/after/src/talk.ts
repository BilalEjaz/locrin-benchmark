// The talk flow's send, the site's one public write: a recording of up to 3 minutes, with an optional name
// and email, from the site's own page. Each refusal is the cheapest that applies, in order: no bot-check
// secret (503), another origin (403), no or too large a declared length (411, 413), a malformed form
// (400), audio that isn't what it claims (415, 413), a failed bot check (403), and the daily limits (429,
// whose `limit` reason the page shows as its own screen). Bots are refused before the limits, so they
// can't spend real visitors' allowance. Nothing personal is ever logged: a refusal's line holds its
// status and reason only.

import { FORM_OVERHEAD_BYTES, MAX_AUDIO_BYTES, MAX_SECONDS, baseOf, bytesMatch } from "./audio.ts";
import { networkOf, takeSend } from "./quota.ts";
import { keep, type Received } from "./store.ts";
import { verifyToken } from "./turnstile.ts";
import { json } from "./json.ts";

/** The Worker's bindings (wrangler.jsonc), and the bot check's secret, which the deploy sets. */
export type Bindings = Env & { readonly TURNSTILE_SECRET?: string };

const MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + FORM_OVERHEAD_BYTES;
const FIELDS = ["audio", "seconds", "name", "email", "token"];
const MAX_NAME = 80;
const MAX_EMAIL = 200;
const MAX_TOKEN = 2048;
/** The browser's own check for `type="email"` (the HTML standard's valid e-mail address), so both agree. */
const EMAIL_SHAPE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function refuse(status: number, reason: string): Response {
  console.log(JSON.stringify({ refused: status, reason }));
  return json(status, { reason });
}

/** Whether the request comes from the site's own page: its Origin is this request's own origin. */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null && site !== "same-origin") return false;
  return request.headers.get("Origin") === new URL(request.url).origin;
}

interface Form {
  audio: File;
  seconds: number;
  name: string;
  email: string;
  token: string;
}

/** The form's five fields, trimmed and in bounds, or null for anything else. */
function readForm(form: FormData): Form | null {
  const names = [...form.keys()];
  if (names.length !== FIELDS.length || !FIELDS.every((field) => names.includes(field))) return null;
  const audio = form.get("audio");
  const [seconds, name, email, token] = ["seconds", "name", "email", "token"].map((field) => {
    const value = form.get(field);
    return typeof value === "string" ? value.trim() : null;
  });
  if (!(audio instanceof File) || seconds == null || name == null || email == null || token == null) return null;
  if (!/^\d{1,3}$/.test(seconds) || Number(seconds) < 1 || Number(seconds) > MAX_SECONDS) return null;
  if (name.length > MAX_NAME || CONTROL.test(name)) return null;
  if (email.length > MAX_EMAIL || (email !== "" && !EMAIL_SHAPE.test(email))) return null;
  if (token === "" || token.length > MAX_TOKEN) return null;
  return { audio, seconds: Number(seconds), name, email, token };
}

export async function handleTalk(request: Request, env: Bindings): Promise<Response> {
  const secret = env.TURNSTILE_SECRET ?? "";
  if (secret === "") return refuse(503, "not-configured");
  if (!sameOrigin(request)) return refuse(403, "origin");

  const declared = request.headers.get("Content-Length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) return refuse(411, "length");
  if (Number(declared) > MAX_REQUEST_BYTES) return refuse(413, "too-large");

  let form: Form | null;
  try {
    form = readForm(await request.formData());
  } catch {
    form = null;
  }
  if (form === null) return refuse(400, "form");

  const { audio } = form;
  if (audio.size > MAX_AUDIO_BYTES) return refuse(413, "too-large");
  const base = baseOf(audio.type);
  if (base === null || !bytesMatch(base, new Uint8Array(await audio.slice(0, 12).arrayBuffer()))) {
    return refuse(415, "type");
  }

  const address = request.headers.get("CF-Connecting-IP") ?? "";
  const network = networkOf(address);
  if (network === null) return refuse(400, "address");
  const { hostname } = new URL(request.url);
  if (!(await verifyToken(secret, form.token, { remoteIp: address, hostname }))) return refuse(403, "bot-check");

  if (!(await takeSend(env.DB, network))) return refuse(429, "limit");

  const received: Received = { audio, type: audio.type, seconds: form.seconds, name: form.name, email: form.email };
  let id: string;
  try {
    id = await keep(env.DB, env.AUDIO, received);
  } catch {
    return refuse(500, "store");
  }
  return json(201, { id });
}
