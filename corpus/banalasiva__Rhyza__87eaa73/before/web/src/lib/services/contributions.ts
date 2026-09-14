import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { getThreadMemory, refreshThreadMemory } from "@/lib/services/thread-memory";
import {
  ensureSeedParticipant,
  requireSeedAccess,
  requireSeedManager,
  requireGardenSteward,
} from "@/lib/authz";
import {
  claudeReply,
  chatgptReply,
  classifyDimension,
  mediate,
  mediatePeace,
  guideThinking,
  openaiMediate,
  aiStageVote,
  summarizeThread,
  mentionsClaude,
  wantsImage,
  asksImageCapabilityOnly,
  wantsImageEdit,
  generateImage,
  editImage,
  buildImagePrompt,
  seedOpener,
  type ContribForAI,
} from "@/lib/ai";
import { put } from "@vercel/blob";
import { extractMentionIds, deserializeMentions } from "@/lib/mentions";
import { requestAdmissionIfNeeded } from "@/lib/services/stake";
import { seedAiEnabled } from "@/lib/services/ai-settings";
import { settleStage } from "@/lib/services/voting";
import { STAGES } from "@/lib/constants";
import { deliver } from "@/lib/services/notify";
import { bumpFollowOnContribute } from "@/lib/services/explore";
import { notifyFollowersJoinedDiscussion } from "@/lib/services/follows";
import { markAsksAnswered } from "@/lib/services/asks";
import { maybeSenseRoom, resolveMediatorNudge } from "@/lib/services/mediator";
import { getReactionTypes } from "@/lib/registry";
import { isSignalReaction } from "@/lib/reactions";
import { isGuestUser } from "@/lib/guest";

async function seedOrThrow(seedId: string) {
  let seed;
  try {
    seed = await db.seed.findUnique({ where: { id: seedId } });
  } catch {
    // Tolerate a DB where the new `listed` column isn't migrated yet.
    const s = await db.seed.findUnique({
      where: { id: seedId },
      select: {
        id: true,
        gardenId: true,
        createdById: true,
        title: true,
        content: true,
        stage: true,
        visibility: true,
        bloomId: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
    seed = s ? { ...s, listed: false } : null;
  }
  if (!seed || seed.deletedAt) throw new ApiError("NOT_FOUND", "Seed not found");
  return seed;
}

const CLAUDE_EMAIL = "claude@thinkthru.app";
const CHATGPT_EMAIL = "chatgpt@thinkthru.app";

// Claude is a permanent participant: one shared system user that authors its
// replies. Created lazily the first time someone tags @claude.
export async function getOrCreateClaudeUser() {
  return db.user.upsert({
    where: { email: CLAUDE_EMAIL },
    update: {},
    create: { email: CLAUDE_EMAIL, name: "Claude" },
    select: { id: true, name: true, image: true },
  });
}

// ChatGPT is a second permanent AI participant, created lazily on first @chatgpt.
async function getOrCreateChatGptUser() {
  return db.user.upsert({
    where: { email: CHATGPT_EMAIL },
    update: {},
    create: { email: CHATGPT_EMAIL, name: "ChatGPT" },
    select: { id: true, name: true, image: true },
  });
}

// Build the thread (with images) an AI participant sees for this seed.
// How much of a thread we feed the AI. Generous — this is intensive learning,
// so the AI should have the full arc of the discussion to reason over. We only
// cap it to keep a runaway thread from ballooning a single call.
const AI_CONTEXT_LIMIT = 120;

async function threadForSeed(seedId: string) {
  const seed = await db.seed.findUnique({
    where: { id: seedId },
    include: {
      contributions: {
        where: { deletedAt: null },
        // Newest first so `take` keeps the most recent; we re-sort to ascending
        // below so the AI reads the thread in natural order.
        orderBy: { createdAt: "desc" },
        take: AI_CONTEXT_LIMIT,
        include: { author: { select: { name: true } } },
      },
    },
  });
  if (!seed) return null;
  const ordered = [...seed.contributions].reverse();
  const thread: ContribForAI[] = ordered.map((c) => {
    const content = c.content as
      | { text?: string; attachments?: { url: string; type: string }[] }
      | null;
    const images = (content?.attachments ?? [])
      .filter((a) => a.type === "image")
      .map((a) => a.url);
    return {
      dimension: c.dimension,
      author: c.author.name || "A member",
      text: content?.text ?? "",
      images: images.length ? images : undefined,
    };
  });
  return { seed, thread };
}

// When someone asks ChatGPT to draw/generate a picture, produce an image and
// post it as a ChatGPT contribution with an image attachment. Returns the new
// contribution, or null if generation/upload failed (caller falls back to a
// generic "couldn't reply" so the mention is never silently dropped).
async function respondWithImage(
  seedId: string,
  dimension: string,
  mentionText: string,
  parentId: string,
  seed: { id: string; title: string; createdById: string; content?: string },
  invokerId?: string,
  ctx?: { thread: { author: string; text: string }[]; hasImage?: boolean },
) {
  // Strip the @mention token(s) to get the user's raw request.
  const request = deserializeMentions(mentionText)
    .replace(/@(chatgpt|openai|gpt|claude)\b/gi, "")
    .trim();
  // Turn it into a rich, context-aware image prompt using the CONVERSATION —
  // instead of sending the casual words straight to a literal image model.
  const prompt = await buildImagePrompt({
    title: seed.title,
    content: seed.content ?? "",
    thread: ctx?.thread ?? [],
    request,
    hasAttachedImage: ctx?.hasImage,
  });

  // Generate + upload are the two failure-prone steps (OpenAI image access,
  // Blob token). Wrap them so ANY failure returns null and the caller falls
  // through to a normal text reply — never a hard "couldn't reply" with nothing.
  let imageUrl: string;
  try {
    const png = await generateImage(prompt);
    if (!png) return null;
    // Upload to Blob (BLOB_READ_WRITE_TOKEN is read from the environment).
    const key = `ai/chatgpt/${seedId}-${Date.now()}.png`;
    const blob = await put(key, png, { access: "public", contentType: "image/png" });
    imageUrl = blob.url;
  } catch (err) {
    console.error("[ai] image generate/upload failed", err);
    return null;
  }

  const bot = await getOrCreateChatGptUser();
  const caption = request ? `Here's what I imagined for "${request.slice(0, 120)}":` : "Here's what I imagined:";
  const contribution = await db.contribution.create({
    data: {
      seedId,
      authorId: bot.id,
      dimension,
      parentId,
      content: { text: caption, attachments: [{ url: imageUrl, type: "image" }] },
    },
    include: { author: { select: { id: true, name: true, image: true } } },
  });
  await notifySeedActivity(
    bot.id,
    { id: seed.id, title: seed.title, createdById: seed.createdById },
    contribution.id,
    "ChatGPT shared an image",
    [],
  );
  return contribution;
}

// When someone asks ChatGPT to modify a photo already in the thread ("add a hat
// to this image"), edit that source image and post the result. `sourceUrl` is
// the most recent image in the thread. Returns the new contribution, or null if
// the edit/upload failed (caller falls back to a text reply).
async function respondWithImageEdit(
  seedId: string,
  dimension: string,
  mentionText: string,
  parentId: string,
  seed: { id: string; title: string; createdById: string },
  sourceUrl: string,
) {
  const prompt = deserializeMentions(mentionText)
    .replace(/@(chatgpt|openai|gpt|claude)\b/gi, "")
    .trim();

  let imageUrl: string;
  try {
    const png = await editImage(sourceUrl, prompt);
    if (!png) return null;
    const key = `ai/chatgpt/${seedId}-${Date.now()}-edit.png`;
    const blob = await put(key, png, { access: "public", contentType: "image/png" });
    imageUrl = blob.url;
  } catch (err) {
    console.error("[ai] image edit/upload failed", err);
    return null;
  }

  const bot = await getOrCreateChatGptUser();
  const caption = prompt ? `Here's your edit — ${prompt.slice(0, 120)}:` : "Here's the edited image:";
  const contribution = await db.contribution.create({
    data: {
      seedId,
      authorId: bot.id,
      dimension,
      parentId,
      content: { text: caption, attachments: [{ url: imageUrl, type: "image" }] },
    },
    include: { author: { select: { id: true, name: true, image: true } } },
  });
  await notifySeedActivity(
    bot.id,
    { id: seed.id, title: seed.title, createdById: seed.createdById },
    contribution.id,
    "ChatGPT edited an image",
    [],
  );
  return contribution;
}

// ChatGPT's reply to an @chatgpt mention, posted as the ChatGPT system user.
export async function respondAsChatGpt(
  seedId: string,
  dimension: string,
  mentionText: string,
  parentId: string,
  invokerId?: string,
) {
  const data = await threadForSeed(seedId);
  if (!data) return null;

  // "@chatgpt add a hat to this photo" → EDIT the most recent image in the thread
  // (checked before generation: a request that references "this photo" while an
  // image is present means modify it, not draw a fresh one).
  const threadImages = data.thread.flatMap((c) => c.images ?? []);
  const sourceImage = threadImages[threadImages.length - 1];
  if (sourceImage && wantsImageEdit(mentionText)) {
    const edited = await respondWithImageEdit(
      seedId,
      dimension,
      mentionText,
      parentId,
      data.seed,
      sourceImage,
    );
    if (edited) return edited;
    // Edit was intended but failed — fall through to a TEXT reply, NOT a
    // from-scratch generation. Inventing a random new image when the person
    // asked to edit their own photo is worse than a plain explanation.
  } else if (wantsImage(mentionText) && !asksImageCapabilityOnly(mentionText)) {
    // "@chatgpt draw me a …" → generate a fresh picture. A bare capability
    // question ("can you make images if I give a prompt?") has no real subject
    // yet — skip generation and let the text reply warmly say "yes, tell me
    // what to draw" (its system prompt now states it truthfully can).
    const img = await respondWithImage(seedId, dimension, mentionText, parentId, data.seed, invokerId, {
      thread: data.thread.map((c) => ({ author: c.author, text: c.text })),
      hasImage: threadImages.length > 0,
    });
    if (img) return img;
    // fall through to a normal text reply if image generation failed
  }

  const memory = await getThreadMemory(seedId).catch(() => "");
  const reply = await chatgptReply({
    title: data.seed.title,
    content: data.seed.content,
    dimension,
    mention: mentionText,
    contributions: data.thread,
    memory,
  });
  if (!reply) return null;
  // Keep the rolling memory current (background, best-effort).
  void refreshThreadMemory(seedId, data.seed.title);

  const bot = await getOrCreateChatGptUser();
  const contribution = await db.contribution.create({
    data: { seedId, authorId: bot.id, dimension, parentId, content: { text: reply } },
    include: { author: { select: { id: true, name: true, image: true } } },
  });
  // Tell the thread ChatGPT replied — so the person who started the seed hears
  // back even if they've since left the app. The invoker (who's watching live)
  // is excluded.
  await notifySeedActivity(
    bot.id,
    { id: data.seed.id, title: data.seed.title, createdById: data.seed.createdById },
    contribution.id,
    `ChatGPT replied: ${reply.slice(0, 120)}`,
    [],
  );
  return contribution;
}

// When a contribution tags @claude, generate Claude's reply and post it as a
// contribution authored by the Claude system user (threaded under the mention).
// Returns the new contribution DTO, or null if AI is off / the call failed.
export async function respondAsClaude(
  seedId: string,
  dimension: string,
  mentionText: string,
  parentId: string,
  invokerId?: string,
) {
  // Same capped, recent-first-then-ordered context the other AI paths use.
  const data = await threadForSeed(seedId);
  if (!data) return null;
  const { seed, thread } = data;

  // Claude has no image model — so when asked to draw, politely hand off to
  // ChatGPT rather than burning a completion trying (or pretending it can).
  if (wantsImage(mentionText)) {
    const claudeBot = await getOrCreateClaudeUser();
    const msg =
      "I can't make images myself — but @chatgpt can! Tag @chatgpt with what you'd like drawn and it'll create it for you.";
    const contribution = await db.contribution.create({
      data: { seedId, authorId: claudeBot.id, dimension, parentId, content: { text: msg } },
      include: { author: { select: { id: true, name: true, image: true } } },
    });
    await notifySeedActivity(
      claudeBot.id,
      { id: seed.id, title: seed.title, createdById: seed.createdById },
      contribution.id,
      "Claude replied",
      [],
    );
    return contribution;
  }

  const memory = await getThreadMemory(seedId).catch(() => "");
  const reply = await claudeReply({
    title: seed.title,
    content: seed.content,
    dimension,
    mention: mentionText,
    contributions: thread,
    memory,
  });
  if (!reply) return null;
  // Keep the rolling memory current (background, best-effort).
  void refreshThreadMemory(seedId, seed.title);

  const claude = await getOrCreateClaudeUser();
  const contribution = await db.contribution.create({
    data: {
      seedId,
      authorId: claude.id,
      dimension,
      parentId,
      content: { text: reply },
    },
    include: { author: { select: { id: true, name: true, image: true } } },
  });
  // Tell the thread Claude replied — so the seed's people (the person who asked
  // especially) hear back even after they've left the app. The invoker, who's
  // watching live, is excluded.
  await notifySeedActivity(
    claude.id,
    { id: seed.id, title: seed.title, createdById: seed.createdById },
    contribution.id,
    `Claude replied: ${reply.slice(0, 120)}`,
    [],
  );
  return contribution;
}

// Ask an AI to join the quorum: it reads the thread, posts its read as a short
// contribution, and casts a real stage vote — which counts in "Community feels"
// and toward the bloom quorum (headcount path), exactly like a person's. A human
// must invoke it (they're the one with seed access). Returns null if the
// provider isn't configured.
export async function aiVoteOnSeed(
  invokerId: string,
  seedId: string,
  provider: "claude" | "chatgpt",
) {
  const seed = await db.seed.findUnique({
    where: { id: seedId },
    select: { stage: true, bloomId: true, deletedAt: true },
  });
  if (!seed || seed.deletedAt) throw new ApiError("NOT_FOUND", "Seed not found");
  if (seed.stage === "bloomed" && seed.bloomId) {
    throw new ApiError("CONFLICT", "This seed has already bloomed");
  }
  await requireSeedAccess(invokerId, seedId);

  const data = await threadForSeed(seedId);
  if (!data) throw new ApiError("NOT_FOUND", "Seed not found");

  const decision = await aiStageVote(provider, {
    title: data.seed.title,
    content: data.seed.content,
    contributions: data.thread,
  });
  if (!decision) return null;

  const bot = provider === "chatgpt" ? await getOrCreateChatGptUser() : await getOrCreateClaudeUser();
  const stageMeta = STAGES.find((s) => s.key === decision.stage) ?? STAGES[0];

  // Post the rationale (becomes a participant) and cast the vote (counts).
  const contribution = await db.contribution.create({
    data: {
      seedId,
      authorId: bot.id,
      dimension: decision.stage === "bloomed" ? "bloom" : "debate",
      content: { text: `🗳️ I'd call this **${stageMeta.emoji} ${stageMeta.label}** — ${decision.note}` },
    },
    include: { author: { select: { id: true, name: true, image: true } } },
  });
  await db.seedStageVote.upsert({
    where: { seedId_userId: { seedId, userId: bot.id } },
    update: { stage: decision.stage, votedAt: new Date() },
    create: { seedId, userId: bot.id, stage: decision.stage },
  });

  // Settle the consequences (display stage + maybe bloom), attributed to the
  // human who asked, since they hold seed access for createBloom.
  const result = await settleStage(seedId, invokerId);

  // Tell the thread the AI weighed in — the invoker (watching live) excluded.
  const botLabel = provider === "chatgpt" ? "ChatGPT" : "Claude";
  await notifySeedActivity(
    bot.id,
    { id: data.seed.id, title: data.seed.title, createdById: data.seed.createdById },
    contribution.id,
    `${botLabel} weighed in: ${stageMeta.emoji} ${stageMeta.label}`,
    [invokerId],
  );

  return { contribution, result };
}

// Ask Claude or ChatGPT to summarize the whole discussion, organised by
// dimension. Read-only — nothing is posted to the thread. Returns the summary
// text, or null if that provider isn't configured.
export async function summarizeSeed(
  userId: string,
  seedId: string,
  provider: "claude" | "chatgpt" = "claude",
): Promise<string | null> {
  await requireSeedAccess(userId, seedId);
  const data = await threadForSeed(seedId);
  if (!data) throw new ApiError("NOT_FOUND", "Seed not found");
  return summarizeThread(provider, {
    title: data.seed.title,
    content: data.seed.content,
    contributions: data.thread,
  });
}

// Ask Claude or ChatGPT to mediate the seed's discussion. Posts the mediation as
// a contribution by that AI's system user in the Debate dimension. Requires seed
// access; returns the new contribution, or null if AI is off / failed.
export async function mediateSeed(
  userId: string,
  seedId: string,
  provider: "claude" | "chatgpt" = "claude",
  mode: "balanced" | "peace" | "guide" = "balanced",
) {
  await requireSeedAccess(userId, seedId);
  const [seed, reactionTypes] = await Promise.all([
    db.seed.findUnique({
      where: { id: seedId },
      include: {
        contributions: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          include: {
            author: { select: { name: true } },
            reactions: { select: { reactionKey: true } },
          },
        },
      },
    }),
    getReactionTypes(),
  ]);
  if (!seed) throw new ApiError("NOT_FOUND", "Seed not found");

  const rmap = new Map(reactionTypes.map((r) => [r.key, r]));
  const thread: ContribForAI[] = seed.contributions.map((c) => {
    const counts: Record<string, number> = {};
    for (const r of c.reactions) counts[r.reactionKey] = (counts[r.reactionKey] ?? 0) + 1;
    // Only SIGNAL reactions feed the AI's read of the room — expressive ones
    // (love/applause/…) are warmth, not signal, so they never dilute the quorum.
    const reactions = Object.entries(counts)
      .filter(([k]) => isSignalReaction(k))
      .map(([k, n]) => {
        const t = rmap.get(k);
        return `${t?.emoji ?? ""} ${t?.label ?? k} ×${n}`;
      })
      .join(", ");
    const content = c.content as
      | { text?: string; attachments?: { url: string; type: string }[] }
      | null;
    const images = (content?.attachments ?? [])
      .filter((a) => a.type === "image")
      .map((a) => a.url);
    return {
      dimension: c.dimension,
      author: c.author.name || "A member",
      text: content?.text ?? "",
      reactions: reactions || undefined,
      images: images.length ? images : undefined,
    };
  });

  const input = { title: seed.title, content: seed.content, contributions: thread };
  // Two elevated voices for Claude — the dove (peace) and the star (guide);
  // ChatGPT keeps the balanced mediation. `mode` picks which presence steps in.
  const text = await (provider === "chatgpt"
    ? openaiMediate(input)
    : mode === "peace"
      ? mediatePeace(input)
      : mode === "guide"
        ? guideThinking(input)
        : mediate(input));
  if (!text) return null;

  const prefix =
    mode === "peace"
      ? "🕊️ **A word of peace**"
      : mode === "guide"
        ? "🌟 **A clearer view**"
        : "🕊️ **Mediation**";
  const bot =
    provider === "chatgpt" ? await getOrCreateChatGptUser() : await getOrCreateClaudeUser();
  const contribution = await db.contribution.create({
    data: {
      seedId,
      authorId: bot.id,
      dimension: "debate",
      content: { text: `${prefix}\n\n${text}` },
    },
    include: { author: { select: { id: true, name: true, image: true } } },
  });
  // The presence answered — clear any live offer so it doesn't keep asking.
  if (mode === "peace" || mode === "guide") void resolveMediatorNudge(seedId);
  return contribution;
}

type Attachment = { url: string; type: "image" | "video" | "file"; name?: string };

export async function addContribution(
  userId: string,
  seedId: string,
  input: { dimension: string; text: string; parentId?: string; attachments?: Attachment[] },
) {
  const seed = await seedOrThrow(seedId);
  // Guests may post only where they were already given a seat (someone invited
  // them). This is checked BEFORE ensureSeedParticipant, which would otherwise
  // auto-seat anyone in a world-listed public seed — so a guest can read the
  // public square but not drop un-vouched posts into it.
  if (await isGuestUser(userId)) {
    const seat = await db.seedMember.findUnique({
      where: { seedId_userId: { seedId, userId } },
    });
    if (!seat) {
      throw new ApiError(
        "FORBIDDEN",
        "Create a free account to post in public seeds — for now you can post in threads you were invited to.",
      );
    }
  }
  await ensureSeedParticipant(userId, seedId);

  const attachments = input.attachments ?? [];
  const contribution = await db.contribution.create({
    data: {
      seedId,
      authorId: userId,
      dimension: input.dimension,
      parentId: input.parentId ?? null,
      contentType: attachments.length > 0 ? attachments[0].type : "text",
      content: { text: input.text, attachments },
    },
    include: { author: { select: { id: true, name: true, image: true } } },
  });

  const snippet = previewSnippet(input.text);
  const mentionedIds = extractMentionIds(input.text).filter((id) => id !== userId);

  // @-mentions get their own richer notification (+ email). Done first so the
  // activity ping below can skip them — nobody gets pinged twice for one message.
  await notifyMentions(userId, seed, input.text, contribution.id, snippet);

  // You spoke, so you're in it — make sure you hear the replies (upgrade a
  // quiet/auto follow to "all", unless you deliberately muted). Best-effort.
  await bumpFollowOnContribute(userId, seedId);

  // If someone asked you here directly, that ask is now answered — close it and
  // tell them (the other half of the rally). Best-effort; never blocks posting.
  void markAsksAnswered(seedId, userId);

  // The wise presence takes a quiet, throttled read of the room after a human
  // message — and offers to step in if it's getting rough or drifting.
  void maybeSenseRoom(seedId);

  // The "someone you follow joined this discussion" hook — only the FIRST time
  // this person contributes to a world-visible seed, so it never becomes
  // per-comment spam. Best-effort; the helper also verifies the seed is public.
  {
    const priorMine = await db.contribution
      .count({ where: { seedId, authorId: userId, deletedAt: null, id: { not: contribution.id } } })
      .catch(() => 1);
    void notifyFollowersJoinedDiscussion(
      userId,
      contribution.author?.name ?? null,
      { id: seedId, title: seed.title, gardenId: seed.gardenId, listed: (seed as { listed?: boolean }).listed ?? false },
      priorMine === 0,
    );
  }

  // The core re-engagement loop: ping EVERYONE involved in this seed — its
  // creator, anyone who's contributed, followers, and (private) members — that
  // the conversation moved. Push now, rolls into the digest. Best-effort.
  await notifySeedActivity(userId, seed, contribution.id, snippet, mentionedIds);
  if (seed.listed) {
    await db.seed
      .update({ where: { id: seedId }, data: { lastActivityAt: new Date() } })
      .catch(() => {});
  }

  // If the decision quorum is locked and this is a newcomer, open an admission
  // request so the carriers can vote them in. Never blocks the contribution.
  await requestAdmissionIfNeeded(seedId, userId);

  return contribution;
}

// Live thread: fetch a seed's contributions, optionally only those newer than
// `since` (for cheap polling — everyone on a shared screen sees a new message
// appear within a couple seconds without a websocket). Read access required.
export async function listContributions(userId: string, seedId: string, since?: Date) {
  await requireSeedAccess(userId, seedId);
  return db.contribution.findMany({
    where: {
      seedId,
      deletedAt: null,
      ...(since ? { createdAt: { gt: since } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { author: { select: { id: true, name: true, image: true } } },
  });
}

// Notify everyone INVOLVED in a seed when it gets new activity — its creator,
// anyone who's contributed, followers, and (private) seed members. Push now,
// email rolls into the digest (type "contribution" isn't a BIG_MOMENT). Excludes
// the actor and anyone already @-mentioned (they got the mention ping instead).
// Best-effort; never blocks posting. Uses createMany + one read-back so a busy
// Kickstart a freshly-planted seed: Claude posts the first response to the
// group's question, so asking a good question is rewarded instantly and the
// thread starts with momentum. Best-effort and idempotent (only acts while the
// thread is still empty), so it never blocks or double-posts.
export async function kickstartSeed(seedId: string) {
  try {
    const seed = await db.seed.findUnique({
      where: { id: seedId },
      select: { id: true, title: true, content: true, createdById: true, deletedAt: true },
    });
    if (!seed || seed.deletedAt) return;
    if (!(await seedAiEnabled(seedId))) return; // AI switched off for this seed
    const existing = await db.contribution.count({ where: { seedId, deletedAt: null } });
    if (existing > 0) return; // someone already spoke — don't butt in
    const text = await seedOpener({ title: seed.title, content: seed.content ?? "" });
    if (!text) return;
    const claude = await getOrCreateClaudeUser();
    const contribution = await db.contribution.create({
      data: { seedId, authorId: claude.id, dimension: "understanding", content: { text } },
    });
    await db.seed.update({ where: { id: seedId }, data: { lastActivityAt: new Date() } }).catch(() => {});
    await notifySeedActivity(
      claude.id,
      { id: seed.id, title: seed.title, createdById: seed.createdById },
      contribution.id,
      `Claude opened: ${text.slice(0, 120)}`,
      [],
    );
  } catch (err) {
    console.error("kickstartSeed failed", err);
  }
}

// seed doesn't fan out into one INSERT per person.
async function notifySeedActivity(
  actorId: string,
  seed: { id: string; title: string; createdById: string },
  contributionId: string,
  snippet: string,
  mentionedIds: string[],
) {
  try {
    const [participants, follows, members] = await Promise.all([
      db.contribution.findMany({
        where: { seedId: seed.id, deletedAt: null },
        distinct: ["authorId"],
        select: { authorId: true },
      }),
      db.seedFollow
        .findMany({ where: { seedId: seed.id }, select: { userId: true, level: true } })
        .catch(() => [] as { userId: string; level: string }[]),
      db.seedMember.findMany({ where: { seedId: seed.id }, select: { userId: true } }),
    ]);

    // Each person's follow level, if they've set one. Involved people without a
    // row (creator/participants/members) default to "all" — they're in it, so a
    // normal reply reaches them, exactly as before follow-levels existed.
    const levelByUser = new Map<string, string>();
    for (const f of follows as { userId: string; level: string }[]) {
      levelByUser.set(f.userId, f.level || "all");
    }

    const exclude = new Set<string>([actorId, ...mentionedIds]);
    const candidates = new Set<string>();
    const add = (id?: string | null) => {
      if (id && !exclude.has(id)) candidates.add(id);
    };
    add(seed.createdById);
    for (const p of participants as { authorId: string }[]) add(p.authorId);
    for (const f of follows as { userId: string }[]) add(f.userId);
    for (const m of members as { userId: string }[]) add(m.userId);

    // A NORMAL reply only pings people at level "all" (their explicit choice, or
    // the involved-default). "highlights" and "muted" followers are spared the
    // per-reply firehose — they still get blooms and @mentions elsewhere.
    const recipients = new Set<string>(
      [...candidates].filter((id) => (levelByUser.get(id) ?? "all") === "all"),
    );
    if (recipients.size === 0) return;

    const actor = await db.user.findUnique({ where: { id: actorId }, select: { name: true } });
    const actorName = actor?.name || "Someone";
    const ids = [...recipients];

    await db.notification.createMany({
      data: ids.map((rid) => ({
        recipientId: rid,
        actorId,
        type: "contribution",
        title: `New thought in “${seed.title}”`,
        body: snippet ? `“${snippet}”` : `${actorName} added to the conversation`,
        entityType: "seed",
        entityId: seed.id,
        anchorId: contributionId,
      })),
    });

    // Read back the rows we just made (same anchor + type) for push delivery.
    const rows = await db.notification.findMany({
      where: {
        type: "contribution",
        entityId: seed.id,
        anchorId: contributionId,
        recipientId: { in: ids },
      },
      select: { id: true, recipientId: true },
    });
    await deliver(
      (rows as { id: string; recipientId: string }[]).map((r) => ({
        notificationId: r.id,
        recipientId: r.recipientId,
        type: "contribution",
        push: { title: `New in “${seed.title}”`, body: snippet || `${actorName} added a thought` },
        link: `/seeds/${seed.id}#c-${contributionId}`,
      })),
    );
  } catch (err) {
    console.error("notifySeedActivity failed", err);
  }
}

// A readable, truncated preview of a message: turns @[Name](uuid) tokens into
// "@Name", collapses whitespace, and caps the length. Used so notifications
// carry a taste of what was said instead of a bare title.
function previewSnippet(text: string, max = 120): string {
  const clean = text
    .replace(/@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)/g, "@$1")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

// Create "mention" notifications (and emails) for everyone tagged in the text,
// filtered to users who can actually access the seed. Never notifies the author
// of their own mention. Failures here never block the contribution.
async function notifyMentions(
  actorId: string,
  seed: { id: string; gardenId: string; title: string; visibility: string },
  text: string,
  contributionId: string,
  snippet: string,
) {
  try {
    const ids = extractMentionIds(text).filter((id) => id !== actorId);
    if (ids.length === 0) return;

    // Keep only ids that can see this seed (seed members for a private seed,
    // garden members otherwise).
    const allowed =
      seed.visibility === "private"
        ? await db.seedMember.findMany({
            where: { seedId: seed.id, userId: { in: ids } },
            select: { userId: true },
          })
        : await db.gardenMember.findMany({
            where: { gardenId: seed.gardenId, userId: { in: ids } },
            select: { userId: true },
          });
    const recipientIds = allowed.map((r) => r.userId);
    if (recipientIds.length === 0) return;

    const actor = await db.user.findUnique({ where: { id: actorId }, select: { name: true } });
    const actorName = actor?.name || "Someone";

    // Create one row per recipient (not createMany) so we get their ids back
    // and can stamp delivery on each.
    const rows = await Promise.all(
      recipientIds.map((rid) =>
        db.notification.create({
          data: {
            recipientId: rid,
            actorId,
            type: "mention",
            title: `${actorName} mentioned you`,
            body: snippet ? `“${snippet}” · in ${seed.title}` : `in ${seed.title}`,
            entityType: "seed",
            entityId: seed.id,
            anchorId: contributionId,
          },
          select: { id: true, recipientId: true },
        }),
      ),
    );

    // Fan out to email + push (deliver respects each person's preferences). The
    // link jumps to the exact message; push/email carry the preview snippet.
    await deliver(
      rows.map((r) => ({
        notificationId: r.id,
        recipientId: r.recipientId,
        type: "mention",
        push: { title: `${actorName} mentioned you`, body: snippet || seed.title },
        link: `/seeds/${seed.id}#c-${contributionId}`,
        email: { kind: "mention", seedTitle: seed.title, actorName, snippet },
      })),
    );
  } catch (err) {
    console.error("notifyMentions failed", err);
  }
}

// Auto-classify a contribution's dimension with Claude (called right after the
// message is posted, so the badge fills in). Returns the resolved dimension.
export async function classifyContribution(userId: string, contributionId: string) {
  const c = await db.contribution.findUnique({
    where: { id: contributionId },
    include: { seed: { select: { title: true, content: true } } },
  });
  if (!c || c.deletedAt) throw new ApiError("NOT_FOUND", "Contribution not found");
  // Only the author (or a steward) may re-tag a message's dimension — not any
  // reader who happens to have seed access.
  if (c.authorId === userId) await requireSeedAccess(userId, c.seedId);
  else await requireSeedManager(userId, c.seedId);

  // AI labelling can be switched off for the seed — then leave the dimension as
  // posted (a human can still re-tag by hand).
  if (!(await seedAiEnabled(c.seedId))) return { dimension: c.dimension };

  const text = (c.content as { text?: string } | null)?.text ?? "";
  const dim = await classifyDimension({
    title: c.seed.title,
    content: c.seed.content,
    text,
  });
  if (!dim || dim === c.dimension) return { dimension: c.dimension };

  await db.contribution.update({ where: { id: contributionId }, data: { dimension: dim } });
  return { dimension: dim };
}

// Manually re-tag a contribution's dimension (when Claude got it wrong).
export async function retagContribution(
  userId: string,
  contributionId: string,
  dimension: string,
) {
  const c = await db.contribution.findUnique({ where: { id: contributionId } });
  if (!c || c.deletedAt) throw new ApiError("NOT_FOUND", "Contribution not found");
  // Author or steward only — same rule as classify.
  if (c.authorId === userId) await requireSeedAccess(userId, c.seedId);
  else await requireSeedManager(userId, c.seedId);
  await db.contribution.update({ where: { id: contributionId }, data: { dimension } });
  return { dimension };
}

// Toggle a reaction on/off for the current user; returns updated counts.
export async function toggleReaction(
  userId: string,
  contributionId: string,
  reactionKey: string,
) {
  const contribution = await db.contribution.findUnique({
    where: { id: contributionId },
    include: { seed: true },
  });
  if (!contribution || contribution.deletedAt) {
    throw new ApiError("NOT_FOUND", "Contribution not found");
  }
  await requireSeedAccess(userId, contribution.seedId);

  const reactionType = await db.reactionType.findUnique({
    where: { key: reactionKey },
  });
  if (!reactionType || !reactionType.isActive) {
    throw new ApiError("BAD_REQUEST", "Unknown reaction");
  }

  const existing = await db.contributionReaction.findUnique({
    where: {
      contributionId_userId_reactionKey: { contributionId, userId, reactionKey },
    },
  });
  if (existing) {
    await db.contributionReaction.delete({
      where: {
        contributionId_userId_reactionKey: { contributionId, userId, reactionKey },
      },
    });
  } else {
    await db.contributionReaction.create({
      data: { contributionId, userId, reactionKey },
    });
  }

  // Someone reacting to your thought is a little hit of "I was heard" — so the
  // author hears about it. Only on ADD (not un-react), never for your own
  // message, and never bother the AI bots. Best-effort; never blocks the react.
  if (!existing && contribution.authorId !== userId) {
    void notifyReaction(userId, contribution as { id: string; authorId: string; seedId: string; seed: { title: string } }, reactionType);
  }

  const rows = await db.contributionReaction.groupBy({
    by: ["reactionKey"],
    where: { contributionId },
    _count: { reactionKey: true },
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.reactionKey] = r._count.reactionKey;
  return { reacted: !existing, counts };
}

// Ping the author that someone reacted to their thought.
async function notifyReaction(
  reactorId: string,
  contribution: { id: string; authorId: string; seedId: string; seed: { title: string } },
  reaction: { emoji: string; label: string },
) {
  try {
    const [author, reactor] = await Promise.all([
      db.user.findUnique({ where: { id: contribution.authorId }, select: { name: true } }),
      db.user.findUnique({ where: { id: reactorId }, select: { name: true } }),
    ]);
    // Don't notify the AI bots — they don't have devices to buzz.
    if (!author || author.name === "Claude" || author.name === "ChatGPT") return;
    const who = reactor?.name || "Someone";
    const title = `${reaction.emoji} ${who} reacted to your thought`;
    const body = `“${reaction.label}” in “${contribution.seed.title}”`;
    const note = await db.notification.create({
      data: {
        recipientId: contribution.authorId,
        actorId: reactorId,
        type: "reaction",
        title,
        body,
        entityType: "seed",
        entityId: contribution.seedId,
        anchorId: contribution.id,
      },
      select: { id: true },
    });
    await deliver([
      {
        notificationId: note.id,
        recipientId: contribution.authorId,
        type: "reaction",
        push: { title, body },
        link: `/seeds/${contribution.seedId}#c-${contribution.id}`,
      },
    ]);
  } catch (err) {
    console.error("notifyReaction failed", err);
  }
}

// Edit a contribution's text — author only.
export async function editContribution(userId: string, contributionId: string, text: string) {
  const c = await db.contribution.findUnique({ where: { id: contributionId } });
  if (!c || c.deletedAt) throw new ApiError("NOT_FOUND", "Contribution not found");
  if (c.authorId !== userId) throw new ApiError("FORBIDDEN", "You can only edit your own contributions");
  await db.contribution.update({
    where: { id: contributionId },
    data: { content: { text } },
  });
  return { id: contributionId, text };
}

// Soft-delete a contribution — author or a garden steward.
// Who may remove *anyone's* message (for moderation): the seed's owner, the
// owner/steward of its garden, or the app owner — in a public OR private seed.
async function canModerateSeed(
  userId: string,
  seed: { createdById: string | null; gardenId: string },
): Promise<boolean> {
  if (seed.createdById && seed.createdById === userId) return true; // seed owner
  // App owner (superadmin) — can moderate anywhere, even gardens they're not in.
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length) {
    const me = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (me?.email && admins.includes(me.email.toLowerCase())) return true;
  }
  // Garden owner / steward (requireGardenSteward throws when not one).
  try {
    await requireGardenSteward(userId, seed.gardenId);
    return true;
  } catch {
    return false;
  }
}

export async function deleteContribution(userId: string, contributionId: string) {
  const c = await db.contribution.findUnique({
    where: { id: contributionId },
    include: { seed: true },
  });
  if (!c || c.deletedAt) throw new ApiError("NOT_FOUND", "Contribution not found");

  if (c.authorId === userId) {
    // Authors can always remove their own message.
    await requireSeedAccess(userId, c.seedId);
  } else {
    // Otherwise only a moderator (seed owner / garden owner or steward / app
    // owner) can — in public and private seeds alike.
    const canModerate = await canModerateSeed(userId, c.seed);
    if (!canModerate) throw new ApiError("FORBIDDEN", "Only the author or an owner can delete this");
  }

  await db.contribution.update({
    where: { id: contributionId },
    data: { deletedAt: new Date() },
  });
  return { id: contributionId, deleted: true };
}

// Toggle an endorsement on a contribution (recognizing the contributor's role,
// distinct from a reaction). Notifies the author the first time.
export async function toggleEndorsement(userId: string, contributionId: string) {
  const contribution = await db.contribution.findUnique({
    where: { id: contributionId },
    include: { seed: true },
  });
  if (!contribution || contribution.deletedAt) {
    throw new ApiError("NOT_FOUND", "Contribution not found");
  }
  await requireSeedAccess(userId, contribution.seedId);

  const existing = await db.contributionEndorsement.findUnique({
    where: { contributionId_endorserId: { contributionId, endorserId: userId } },
  });
  if (existing) {
    await db.contributionEndorsement.delete({
      where: { contributionId_endorserId: { contributionId, endorserId: userId } },
    });
  } else {
    await db.contributionEndorsement.create({
      data: { contributionId, endorserId: userId },
    });
    if (contribution.authorId !== userId) {
      // An impact moment: name the person and echo the point, so it reads as
      // "you were understood," not a bare like.
      const endorser = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
      const endorserName = endorser?.name || "Someone";
      const text = ((contribution.content as { text?: string } | null)?.text ?? "").trim();
      const snippet = text.slice(0, 90);
      // Best-effort: a notification hiccup (or not-yet-applied migration) must
      // never break endorsing. The link jumps to the endorsed comment.
      try {
        const note = await db.notification.create({
          data: {
            recipientId: contribution.authorId,
            actorId: userId,
            type: "endorsement",
            title: `${endorserName} found your point valuable ✦`,
            body: snippet
              ? `“${snippet}${text.length > 90 ? "…" : ""}” · in ${contribution.seed.title}`
              : `in ${contribution.seed.title}`,
            entityType: "seed",
            entityId: contribution.seedId,
            anchorId: contributionId,
          },
          select: { id: true },
        });
        await deliver([
          {
            notificationId: note.id,
            recipientId: contribution.authorId,
            type: "endorsement",
            push: {
              title: `${endorserName} found your point valuable ✦`,
              body: snippet || contribution.seed.title,
            },
            link: `/seeds/${contribution.seedId}#c-${contributionId}`,
            email: {
              kind: "endorsement",
              seedTitle: contribution.seed.title,
              actorName: endorserName,
              snippet,
            },
          },
        ]);
      } catch (err) {
        console.error("endorsement notification failed", err);
      }
    }
  }
  const count = await db.contributionEndorsement.count({ where: { contributionId } });
  return { endorsed: !existing, count };
}
