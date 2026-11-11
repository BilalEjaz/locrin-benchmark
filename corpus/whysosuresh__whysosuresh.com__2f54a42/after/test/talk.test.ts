// The talk flow's send, run as production runs it: the Worker's bundle in workerd (test/harness.ts), with a
// local D1 and R2 and a played Turnstile. What it holds: a good recording is stored with a row that agrees
// with its object; the 3-minute cap as the server enforces it (seconds and bytes); the content check; the
// bot check; both daily limits, under concurrency and for IPv6 networks; the refusals for no length, no
// secret, another origin and other routes; that no address is kept and old days are dropped; and that the
// Worker reaches nothing but Turnstile.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, TEST_SECRET, TURNSTILE_HOST, startHarness, type Harness } from "./harness.ts";

/** The server's limits, stated here as the contract rather than imported from the Worker. */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + 16 * 1024;

const WEBM = "audio/webm;codecs=opus";

/** Bytes that begin as a container does, padded to a length. */
function audioBytes(kind: "webm" | "mp4" | "ogg" | "wav", length = 2048): Uint8Array {
  const bytes = new Uint8Array(length);
  const head: Record<typeof kind, number[]> = {
    webm: [0x1a, 0x45, 0xdf, 0xa3],
    mp4: [0x00, 0x00, 0x00, 0x18, ...[..."ftypmp42"].map((c) => c.charCodeAt(0))],
    ogg: [..."OggS"].map((c) => c.charCodeAt(0)),
    wav: [..."RIFF"].map((c) => c.charCodeAt(0)),
  };
  bytes.set(head[kind]);
  return bytes;
}

interface Send {
  ip?: string;
  audio?: Uint8Array;
  type?: string;
  fields?: Record<string, string>;
  origin?: string | null;
  fetchSite?: string;
  /** Sends the body as a stream, so no Content-Length is declared. */
  noLength?: boolean;
  /** Sends these bytes as the body instead of a form. */
  rawBody?: Uint8Array;
}

async function body(options: Send): Promise<{ bytes: Uint8Array; type: string }> {
  const form = new FormData();
  const audio = options.audio ?? audioBytes("webm");
  form.append("audio", new Blob([audio], { type: options.type ?? WEBM }), "recording");
  const fields = { seconds: "12", name: "Asha", email: "asha@example.com", token: "pass", ...options.fields };
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const encoded = new Response(form);
  return { bytes: new Uint8Array(await encoded.arrayBuffer()), type: encoded.headers.get("content-type") ?? "" };
}

let harness: Harness;

async function send(options: Send = {}): Promise<Response> {
  const { bytes, type } = options.rawBody ? { bytes: options.rawBody, type: "multipart/form-data; boundary=x" } : await body(options);
  const headers: Record<string, string> = { "Content-Type": type, "CF-Connecting-IP": options.ip ?? "203.0.113.7" };
  if (options.origin !== null) headers.Origin = options.origin ?? SITE;
  if (options.fetchSite) headers["Sec-Fetch-Site"] = options.fetchSite;
  const init: RequestInit & { duplex?: string } = { method: "POST", headers };
  if (options.noLength) {
    init.body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    init.duplex = "half";
  } else {
    init.body = bytes;
  }
  return harness.fetch(`${SITE}/api/talk`, init);
}

async function rows(table: string): Promise<Record<string, unknown>[]> {
  return (await (await harness.db()).prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>()).results;
}

async function objectCount(): Promise<number> {
  return (await (await harness.bucket()).list()).objects.length;
}

beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness.dispose();
});
beforeEach(async () => {
  await harness.reset();
});

describe("a good recording", () => {
  it.each([
    ["WebM", "webm" as const, WEBM],
    ["MP4", "mp4" as const, "audio/mp4"],
  ])("is stored from %s, its row and its object agreeing", async (_label, kind, type) => {
    const audio = audioBytes(kind, 5000);
    const response = await send({ audio, type });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const { id } = (await response.json()) as { id: string };
    const [row, ...others] = await rows("inputs");
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      id,
      source: "talk",
      status: "received",
      name: "Asha",
      email: "asha@example.com",
      audio_key: `talk/${id}`,
      audio_type: type,
      audio_bytes: 5000,
      duration_s: 12,
    });
    const object = await (await harness.bucket()).get(`talk/${id}`);
    expect(object?.size).toBe(5000);
    expect(object?.httpMetadata?.contentType).toBe(type);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(audio);
  });

  it("keeps an empty name and email as nothing, and trims both", async () => {
    expect((await send({ fields: { name: "  ", email: "" } })).status).toBe(201);
    expect((await send({ fields: { name: " సురేష్ ", email: " a@b " }, ip: "203.0.113.8" })).status).toBe(201);
    const stored = (await rows("inputs")).map((row) => [row.name, row.email]);
    expect(stored).toEqual(expect.arrayContaining([[null, null], ["సురేష్", "a@b"]]));
  });
});

describe("the 3-minute cap", () => {
  it.each(["0", "181", "12.5", "", "-1"])("refuses %j seconds", async (seconds) => {
    expect((await send({ fields: { seconds } })).status).toBe(400);
  });

  it("takes 1 and 180 seconds", async () => {
    expect((await send({ fields: { seconds: "1" } })).status).toBe(201);
    expect((await send({ fields: { seconds: "180" } })).status).toBe(201);
  });

  it("refuses a request whose declared length is over the cap before reading its body", async () => {
    // 1 KB of the declared length is sent and the rest never comes, so only a Worker that answers without
    // reading the body can answer at all.
    let hold: () => void = () => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024));
        hold = () => controller.close();
      },
    });
    const init: RequestInit & { duplex: string } = {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(MAX_REQUEST_BYTES + 1), Origin: SITE, "CF-Connecting-IP": "203.0.113.7" },
      body,
      duplex: "half",
    };
    const response = await harness.fetch(`${SITE}/api/talk`, init);
    hold();
    expect(response.status).toBe(413);
    expect(await objectCount()).toBe(0);
  });

  it("refuses an audio part one byte over 4 MB inside a request under the cap", async () => {
    const response = await send({ audio: audioBytes("webm", MAX_AUDIO_BYTES + 1) });
    expect(response.status).toBe(413);
    expect(await objectCount()).toBe(0);
  });

  it("takes an audio part of exactly 4 MB", async () => {
    expect((await send({ audio: audioBytes("webm", MAX_AUDIO_BYTES) })).status).toBe(201);
  });
});

describe("the form", () => {
  it.each([
    ["an extra field", { extra: "x" }],
    ["a name over 80 characters", { name: "a".repeat(81) }],
    ["an email that isn't one", { email: "not an email" }],
    ["an email over 200 characters", { email: `${"a".repeat(195)}@b.com` }],
    ["no token", { token: "" }],
  ])("refuses %s", async (_label, fields) => {
    expect((await send({ fields })).status).toBe(400);
  });

  it("refuses a body that isn't a form", async () => {
    expect((await send({ rawBody: new TextEncoder().encode("not a form") })).status).toBe(400);
  });
});

describe("the content check", () => {
  it.each([
    ["a type that isn't audio", "webm" as const, "text/plain"],
    ["a WAV file", "wav" as const, "audio/wav"],
    ["WebM bytes called MP4", "webm" as const, "audio/mp4"],
    ["MP4 bytes called WebM", "mp4" as const, WEBM],
    ["Ogg bytes called WebM", "ogg" as const, WEBM],
  ])("refuses %s", async (_label, kind, type) => {
    expect((await send({ audio: audioBytes(kind), type })).status).toBe(415);
    expect(await objectCount()).toBe(0);
  });

  it("takes Ogg", async () => {
    expect((await send({ audio: audioBytes("ogg"), type: "audio/ogg;codecs=opus" })).status).toBe(201);
  });
});

describe("the bot check", () => {
  it.each(["fail", "wrong-host", "wrong-action", "unreachable"])("refuses a %s token, storing nothing", async (token) => {
    const response = await send({ fields: { token } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: "bot-check" });
    expect(await rows("inputs")).toEqual([]);
    expect(await objectCount()).toBe(0);
  });

  it("is refused before it counts towards the limits", async () => {
    for (let i = 0; i < 25; i += 1) await send({ fields: { token: "fail" } });
    expect((await send()).status).toBe(201);
  });
});

describe("the daily limits", () => {
  it("refuses the 21st send from one address, while another address still sends", async () => {
    for (let i = 0; i < 20; i += 1) expect((await send({ ip: "198.51.100.1" })).status).toBe(201);
    const refused = await send({ ip: "198.51.100.1" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ reason: "limit" });
    expect((await send({ ip: "198.51.100.2" })).status).toBe(201);
  });

  it("refuses the 61st send of the day from any address", async () => {
    for (const ip of ["192.0.2.1", "192.0.2.2", "192.0.2.3"]) {
      for (let i = 0; i < 20; i += 1) expect((await send({ ip })).status).toBe(201);
    }
    expect((await send({ ip: "192.0.2.4" })).status).toBe(429);
    expect(await rows("inputs")).toHaveLength(60);
  });

  it("lets exactly 20 of 25 concurrent sends from one address through", async () => {
    const statuses = (await Promise.all(Array.from({ length: 25 }, () => send({ ip: "198.51.100.9" })))).map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it("counts two IPv6 addresses in one /64 as one network, and two /64s apart", async () => {
    for (let i = 0; i < 10; i += 1) expect((await send({ ip: "2001:db8:1:2::a" })).status).toBe(201);
    for (let i = 0; i < 10; i += 1) expect((await send({ ip: "2001:0db8:0001:0002:ffff:1:2:3" })).status).toBe(201);
    expect((await send({ ip: "2001:db8:1:2:abcd::1" })).status).toBe(429);
    expect((await send({ ip: "2001:db8:1:3::a" })).status).toBe(201);
  });

  // Cloudflare always sets the address, and Miniflare fills in an empty one, so a malformed one stands in.
  it.each(["not-an-address", "300.1.1.1", "2001:db8::1::2"])("refuses a request from %j, which isn't an address", async (ip) => {
    expect((await send({ ip })).status).toBe(400);
  });
});

describe("privacy", () => {
  it("keeps no sending address in any table", async () => {
    await send({ ip: "203.0.113.77" });
    await send({ ip: "2001:db8:aa:bb::1" });
    const database = await harness.db();
    const tables = (
      await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all<{ name: string }>()
    ).results.map((t) => t.name);
    expect(tables.sort()).toEqual(["inputs", "talk_days", "talk_senders"]);
    const everything = JSON.stringify(await Promise.all(tables.map(rows)));
    for (const needle of ["203.0.113.77", "2001:db8:aa:bb", "2001:0db8:00aa:00bb"]) expect(everything).not.toContain(needle);
  });

  it("drops an earlier day's salt and counts at today's first send", async () => {
    const database = await harness.db();
    await database.batch([
      database.prepare("INSERT INTO talk_days (day, salt) VALUES ('2026-01-01', randomblob(32))"),
      database.prepare("INSERT INTO talk_senders (day, sender, sends) VALUES ('2026-01-01', 'old', 20)"),
    ]);
    expect((await send()).status).toBe(201);
    expect((await rows("talk_days")).map((r) => r.day)).toEqual([new Date().toISOString().slice(0, 10)]);
    expect((await rows("talk_senders")).map((r) => r.sender)).not.toContain("old");
  });
});

describe("refusals before reading", () => {
  it("refuses a request without a declared length", async () => {
    expect((await send({ noLength: true })).status).toBe(411);
  });

  it.each([
    ["no Origin", { origin: null }],
    ["another site's Origin", { origin: "https://elsewhere.example" }],
    ["the site's Origin over http", { origin: "http://whysosuresh.com" }],
    ["a cross-site fetch", { fetchSite: "cross-site" }],
    ["a same-site fetch from another subdomain", { fetchSite: "same-site" }],
  ])("refuses %s", async (_label, options) => {
    const response = await send(options);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: "origin" });
  });

  it("takes a same-origin fetch that says so", async () => {
    expect((await send({ fetchSite: "same-origin" })).status).toBe(201);
  });
});

describe("with no bot-check secret", () => {
  let bare: Harness;
  beforeAll(async () => {
    bare = await startHarness({ secret: "" });
  });
  afterAll(async () => {
    await bare.dispose();
  });

  it("refuses every send with 503 and stores nothing", async () => {
    const { bytes, type } = await body({});
    const response = await bare.fetch(`${SITE}/api/talk`, {
      method: "POST",
      headers: { "Content-Type": type, Origin: SITE, "CF-Connecting-IP": "203.0.113.7" },
      body: bytes,
    });
    expect(response.status).toBe(503);
    expect((await (await bare.db()).prepare("SELECT COUNT(*) AS n FROM inputs").first<{ n: number }>())?.n).toBe(0);
    expect((await (await bare.bucket()).list()).objects).toEqual([]);
    expect(bare.outboundHosts.size).toBe(0);
  });
});

describe("with Cloudflare's test secret, as `npm run dev` runs", () => {
  let local: Harness;
  beforeAll(async () => {
    local = await startHarness({ secret: TEST_SECRET });
  });
  afterAll(async () => {
    await local.dispose();
  });

  it("stores a send from localhost, though the test verdict names example.com and no action", async () => {
    const { bytes, type } = await body({ fields: { token: "XXXX.DUMMY.TOKEN.XXXX" } });
    const response = await local.fetch("http://localhost:8787/api/talk", {
      method: "POST",
      headers: { "Content-Type": type, Origin: "http://localhost:8787", "CF-Connecting-IP": "127.0.0.1" },
      body: bytes,
    });
    expect(response.status).toBe(201);
  });
});

describe("routes", () => {
  it("answers GET /api/talk with 405 and the allowed method", async () => {
    const response = await harness.fetch(`${SITE}/api/talk`);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("answers an unknown /api/ path with a JSON 404", async () => {
    const response = await harness.fetch(`${SITE}/api/elsewhere`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("deletes the recording when its row can't be written", async () => {
    const database = await harness.db();
    await database.prepare("ALTER TABLE inputs RENAME TO inputs_away").run();
    try {
      expect((await send()).status).toBe(500);
      expect(await objectCount()).toBe(0);
    } finally {
      await database.prepare("ALTER TABLE inputs_away RENAME TO inputs").run();
    }
  });
});

describe("the outside world", () => {
  it("is reached only at Turnstile", async () => {
    await send();
    await send({ fields: { token: "fail" } });
    expect([...harness.outboundHosts]).toEqual([TURNSTILE_HOST]);
  });
});
