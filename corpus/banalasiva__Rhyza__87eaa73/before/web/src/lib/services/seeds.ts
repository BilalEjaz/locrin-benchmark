import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { ensureGardenMember, requireSeedManager, requireSeedAccess, canModerateSeed } from "@/lib/authz";
import { STAGE_KEYS, type StageKey } from "@/lib/constants";
import { autoFollowOnView } from "@/lib/services/explore";
import { notifyFollowersNewSeed, notifyGardenNewSeed } from "@/lib/services/follows";
import { getJoinStatus } from "@/lib/services/joinreq";
import { getMediatorNudge } from "@/lib/services/mediator";
import { getDraft } from "@/lib/services/drafts";
import { getKeptIdsForSeed } from "@/lib/services/kept";
import { seedAiEnabled } from "@/lib/services/ai-settings";
import { displayName } from "@/lib/display-name";
import { assertNotGuest } from "@/lib/guest";

// What a contribution carries for the room view — author (with email so a
// nameless magic-link user still gets a readable display name), reactions (with
// the reactor's name, so we can show *who* reacted), and endorsements.
const CONTRIB_INCLUDE = {
  author: { select: { id: true, name: true, image: true, email: true } },
  reactions: { include: { user: { select: { name: true } } } },
  endorsements: true,
} as const;

// The live room shows the most-recent THREAD_WINDOW messages. Real threads never
// approach this, so it's a no-op for normal use; it just bounds the payload +
// query cost so a single pathological thread can't fetch thousands of rows (with
// all their reactions/endorsements) on every open/sync. The durable bloom
// synthesises from the full thread separately, so nothing is lost from the record.
const THREAD_WINDOW = 500;

type ContribRow = {
  id: string;
  dimension: string;
  parentId: string | null;
  content: unknown;
  createdAt: Date;
  author: { id: string; name: string | null; image: string | null; email: string | null };
  reactions: { reactionKey: string; userId: string; user: { name: string } | null }[];
  endorsements: { endorserId: string }[];
};

// Shared shape for the seed room — the initial load (getSeedDetail) and the
// live sync (getSeedSync) map contributions identically so polling never drifts
// from the first render.
function mapContribs(rows: ContribRow[], userId: string, keptIds?: Set<string>) {
  return rows.map((c) => {
    const reactionCounts: Record<string, number> = {};
    const reactionPeople: Record<string, string[]> = {};
    const myReactions: string[] = [];
    for (const r of c.reactions) {
      reactionCounts[r.reactionKey] = (reactionCounts[r.reactionKey] ?? 0) + 1;
      (reactionPeople[r.reactionKey] ??= []).push(
        r.userId === userId ? "You" : r.user?.name || "Someone",
      );
      if (r.userId === userId) myReactions.push(r.reactionKey);
    }
    const content = c.content as
      | { text?: string; attachments?: { url: string; type: "image" | "video" | "file"; name?: string }[] }
      | null;
    return {
      id: c.id,
      dimension: c.dimension,
      parentId: c.parentId,
      text: content?.text ?? "",
      attachments: content?.attachments ?? [],
      author: { id: c.author.id, name: displayName(c.author), image: c.author.image },
      createdAt: c.createdAt.toISOString(),
      reactionCounts,
      reactionPeople,
      myReactions,
      endorsementCount: c.endorsements.length,
      iEndorsed: c.endorsements.some((e) => e.endorserId === userId),
      iKept: keptIds?.has(c.id) ?? false,
    };
  });
}

export async function plantSeed(
  userId: string,
  gardenId: string,
  input: { title: string; content?: string; visibility?: "public" | "private" },
) {
  await assertNotGuest(userId, "plant a seed");
  await ensureGardenMember(userId, gardenId);
  const visibility = input.visibility === "private" ? "private" : "public";
  const seed = await db.seed.create({
    data: {
      gardenId,
      createdById: userId,
      title: input.title,
      content: input.content ?? "",
      visibility,
      // The planter implicitly votes the seed at its first stage.
      stageVotes: { create: { userId, stage: "seed" } },
      // A private seed starts with its creator as the first (steward) member.
      ...(visibility === "private"
        ? { members: { create: { userId, role: "steward" } } }
        : {}),
    },
  });

  // If this seed is planted in a public (world) garden, let the planter's
  // followers know — "someone you follow started a discussion." Best-effort;
  // notifyFollowersNewSeed itself checks the garden is public. Private seeds and
  // private gardens never fan out.
  if (visibility === "public") {
    void notifyFollowersNewSeed(userId, { id: seed.id, title: seed.title, gardenId });
    // Tell the garden's members there's a new question to weigh in on. Only for
    // garden-visible seeds, so a private seed never pings people who can't open it.
    void notifyGardenNewSeed(userId, { id: seed.id, title: seed.title, gardenId });
  }

  // Seed-level topics (for Explore discovery) are tagged lazily when a seed is
  // listed to the world; a person's own profile topics are inferred separately
  // from everything they take part in. So there's nothing to tag at plant time.
  return seed;
}

// Soft-delete a seed — creator / seed steward (or garden steward for public
// seeds). Keeps the row (deletedAt) so contributions/blooms aren't orphaned.
export async function deleteSeed(userId: string, seedId: string) {
  const seed = await db.seed.findUnique({
    where: { id: seedId },
    select: { id: true, gardenId: true, createdById: true, deletedAt: true },
  });
  if (!seed || seed.deletedAt) throw new ApiError("NOT_FOUND", "Seed not found");
  // The seed's owner, its garden's owner/steward, or the app owner can delete —
  // so a garden owner can remove a member's private seed in their own garden.
  if (!(await canModerateSeed(userId, seed))) {
    throw new ApiError("FORBIDDEN", "You can't delete this seed");
  }
  await db.seed.update({
    where: { id: seedId },
    data: { deletedAt: new Date() },
  });
  return { deleted: true, gardenId: seed.gardenId };
}

// Change a seed's visibility — creator / seed steward only.
export async function setSeedVisibility(
  userId: string,
  seedId: string,
  visibility: "public" | "private",
) {
  const seed = await requireSeedManager(userId, seedId);
  if (seed.visibility === visibility) return { id: seedId, visibility };
  await db.$transaction(async (tx) => {
    await tx.seed.update({ where: { id: seedId }, data: { visibility } });
    // Going private: make sure the creator is a member so they keep access.
    if (visibility === "private") {
      await tx.seedMember.upsert({
        where: { seedId_userId: { seedId, userId: seed.createdById } },
        update: {},
        create: { seedId, userId: seed.createdById, role: "steward" },
      });
    }
  });
  return { id: seedId, visibility };
}

// Edit a seed's question and/or framing — creator / seed steward only.
export async function updateSeed(
  userId: string,
  seedId: string,
  data: { title?: string; content?: string },
) {
  await requireSeedManager(userId, seedId);
  const patch: { title?: string; content?: string } = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.content !== undefined) patch.content = data.content;
  if (Object.keys(patch).length === 0) return { id: seedId };
  await db.seed.update({ where: { id: seedId }, data: patch });
  return { id: seedId, ...patch };
}

// How many distinct people are participating in a seed: everyone who has
// authored a (non-deleted) contribution, plus the seed's planter. Used to size
// the bloom target. Matches the "participants" count shown in the UI.
export async function countParticipants(seedId: string): Promise<number> {
  const seed = await db.seed.findUnique({
    where: { id: seedId },
    select: { createdById: true },
  });
  // Humans only — the AI teammates (Claude / ChatGPT) contribute but are never
  // counted as members of the group.
  const authors = await db.contribution.findMany({
    where: { seedId, deletedAt: null, author: { name: { notIn: ["Claude", "ChatGPT"] } } },
    select: { authorId: true },
    distinct: ["authorId"],
  });
  const ids = new Set(authors.map((a) => a.authorId));
  if (seed) ids.add(seed.createdById);
  return Math.max(1, ids.size);
}

// Vote distribution across stages, with percentages.
export async function stageDistribution(seedId: string) {
  const rows = await db.seedStageVote.groupBy({
    by: ["stage"],
    where: { seedId },
    _count: { stage: true },
  });
  const counts: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    counts[r.stage] = r._count.stage;
    total += r._count.stage;
  }
  return STAGE_KEYS.map((stage) => {
    const votes = counts[stage] ?? 0;
    return {
      stage,
      votes,
      pct: total === 0 ? 0 : Math.round((votes / total) * 100),
    };
  });
}

export type SeedDetail = Awaited<ReturnType<typeof getSeedDetail>>;

// Load the seed + its relations, tolerating a DB where the new `listed` column
// isn't migrated yet (so the seed page never 500s in the deploy→migrate window).
async function loadSeedForDetail(seedId: string) {
  const include = {
    createdBy: { select: { id: true, name: true, image: true } },
    garden: {
      select: { id: true, name: true, emoji: true, orgId: true, createdById: true, visibility: true },
    },
  } as const;
  try {
    return await db.seed.findUnique({ where: { id: seedId }, include });
  } catch {
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
        createdBy: { select: { id: true, name: true, image: true } },
        garden: {
          select: { id: true, name: true, emoji: true, orgId: true, createdById: true, visibility: true },
        },
      },
    });
    return s ? { ...s, listed: false } : null;
  }
}

export async function getSeedDetail(userId: string, seedId: string) {
  const seed = await loadSeedForDetail(seedId);
  if (!seed || seed.deletedAt) throw new ApiError("NOT_FOUND", "Seed not found");

  // The pool of people who can be @-tagged: members who can actually see this
  // seed (garden members for a public seed; seed members for a private one).
  // For a private OR world-public seed the taggable pool is the explicit seed
  // members (+ contributors, added below) — never the whole garden roster, so a
  // stranger viewing a listed seed can't enumerate the garden's members.
  const peoplePromise =
    seed.visibility === "private" || seed.listed
      ? db.seedMember.findMany({
          where: { seedId },
          include: { user: { select: { id: true, name: true, image: true, email: true } } },
        })
      : db.gardenMember.findMany({
          where: { gardenId: seed.gardenId },
          include: { user: { select: { id: true, name: true, image: true, email: true } } },
        });

  // One parallel batch: authorization + all the data, instead of 5 sequential
  // round-trips (this dominates latency when the DB is far away).
  const [orgMember, member, seedMember, distribution, myVote, contributions, peopleRows, follow, addNotice, draft] =
    await Promise.all([
      db.orgMember.findUnique({
        where: { orgId_userId: { orgId: seed.garden.orgId, userId } },
      }),
      db.gardenMember.findUnique({
        where: { gardenId_userId: { gardenId: seed.gardenId, userId } },
      }),
      db.seedMember.findUnique({
        where: { seedId_userId: { seedId, userId } },
      }),
      stageDistribution(seedId),
      db.seedStageVote.findUnique({
        where: { seedId_userId: { seedId, userId } },
      }),
      // Most-recent window (desc + take), reversed to ascending below for display.
      db.contribution.findMany({
        where: { seedId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: THREAD_WINDOW,
        include: CONTRIB_INCLUDE,
      }),
      peoplePromise,
      // Resilient: the seed_follows table may not be migrated yet.
      db.seedFollow.findUnique({ where: { seedId_userId: { seedId, userId } } }).catch(() => null),
      // Best-effort: "added by someone outside your circle" heads-up. Its own
      // table + .catch() so a missing table can NEVER block opening the seed.
      db.seedAddNotice.findUnique({ where: { seedId_userId: { seedId, userId } } }).catch(() => null),
      // Best-effort: the viewer's unsent draft, for editor autofill (server copy;
      // the client's localStorage is the offline-first source that wins if newer).
      getDraft(userId, seedId),
    ]);
  // Fetched newest-first (windowed); flip to ascending for display + all the
  // order-independent reads below.
  contributions.reverse();
  // World-public seeds are viewable across orgs; everyone else must be an org member.
  if (!orgMember && !(seed.listed && seed.visibility === "public")) {
    throw new ApiError("FORBIDDEN", "Not a member of this organization");
  }

  const isCreator = seed.createdById === userId;
  // Private garden: must be a garden member (or creator).
  if (seed.garden.visibility === "private" && !isCreator && !member) {
    throw new ApiError("NOT_FOUND", "Seed not found");
  }
  // Private seed: must be its creator or an explicit seed member.
  if (seed.visibility === "private" && !isCreator && !seedMember) {
    throw new ApiError("NOT_FOUND", "Seed not found");
  }

  const canBloom =
    isCreator ||
    seed.garden.createdById === userId ||
    member?.role === "steward" ||
    seedMember?.role === "steward";
  // Who can manage the seed (edit, delete, moderate): its creator or seed
  // steward, OR the owner/steward of the garden it lives in — so a garden owner
  // can manage every seed in their own garden, not just ones they planted.
  const canManage =
    isCreator ||
    seedMember?.role === "steward" ||
    seed.garden.createdById === userId ||
    member?.role === "steward";
  // Who can remove ANY message here for moderation: everyone canManage covers,
  // plus the app owner (superadmin) — even in gardens they're not part of. This
  // is what gates the Delete/Remove button on others' and AI-authored messages.
  const canModerate = canManage || (await canModerateSeed(userId, { createdById: seed.createdById, gardenId: seed.garden.id }));

  // Taggable people = seed-visible members + anyone who's contributed, minus
  // the viewer and the Claude system user (tagged via @claude, not the picker).
  const peopleMap = new Map<string, { id: string; name: string; image: string | null }>();
  for (const r of peopleRows) {
    const u = r.user;
    if (u.id === userId || u.name === "Claude") continue;
    peopleMap.set(u.id, { id: u.id, name: displayName(u), image: u.image });
  }
  for (const c of contributions) {
    const a = c.author;
    if (!a || a.id === userId || a.name === "Claude" || peopleMap.has(a.id)) continue;
    peopleMap.set(a.id, { id: a.id, name: displayName(a), image: a.image });
  }
  const people = [...peopleMap.values()];

  const keptIds = await getKeptIdsForSeed(userId, seedId);
  const contribs = mapContribs(contributions as ContribRow[], userId, keptIds);
  const aiEnabled = await seedAiEnabled(seedId);

  // If a stranger added you to this seat, surface a gentle "added by someone you
  // don't know — leave?" notice. Only the rare stranger-add has a row here, so
  // the extra name lookup runs almost never. Best-effort throughout.
  let addedNotice: { byName: string } | null = null;
  if (addNotice?.addedById) {
    const adder = await db.user
      .findUnique({ where: { id: addNotice.addedById }, select: { name: true, email: true } })
      .catch(() => null);
    addedNotice = { byName: displayName(adder ?? {}) };
  }

  // Auto-follow (quietly) the first time a pure outsider opens this seed — puts
  // it on their radar without any per-reply spam. Skips anyone already involved
  // (creator, member, contributor, or already following) so it never downgrades
  // a real participant's notifications. Best-effort; reflected in the response.
  const viewerContributed = (contributions as { authorId?: string }[]).some(
    (c) => c.authorId === userId,
  );
  let followLevel: string | null = (follow as { level?: string } | null)?.level ?? null;
  let following = !!follow;
  if (!follow && !isCreator && !seedMember && !viewerContributed) {
    void autoFollowOnView(userId, seedId);
    following = true;
    followLevel = "highlights";
  }

  return {
    id: seed.id,
    title: seed.title,
    content: seed.content,
    // Defensive: a "bloomed" stage with no actual bloom is a phantom state —
    // present it as active so the UI doesn't show a bloom that doesn't exist.
    stage: (seed.stage === "bloomed" && !seed.bloomId ? "growing" : seed.stage) as StageKey,
    visibility: seed.visibility as "public" | "private",
    listed: seed.listed,
    following,
    followLevel,
    bloomId: seed.bloomId,
    author: seed.createdBy,
    garden: { id: seed.garden.id, name: seed.garden.name, emoji: seed.garden.emoji },
    canBloom,
    canManage,
    canModerate,
    aiEnabled,
    people,
    distribution,
    myVote: myVote?.stage ?? null,
    addedNotice,
    draft,
    contributions: contribs,
  };
}

export type SeedSync = Awaited<ReturnType<typeof getSeedSync>>;

// Lean live snapshot for polling the open room. INCREMENTAL: the client sends
// its last `since` version; we compute a cheap fingerprint of the thread (a few
// scalar aggregates — count + max-timestamp of contributions, reactions and
// endorsements) that changes on any new message, edit, delete, reaction or
// endorsement. If it matches `since`, we skip the expensive full contributions
// fetch and return `contributions: null` (a tiny payload). The always-cheap live
// bits — readiness distribution, stage, the viewer's own vote, the mediator's
// offer — are returned EVERY poll regardless, so they stay fresh; only the thread
// body is gated. The client periodically forces a full refresh as a safety net.
export async function getSeedSync(userId: string, seedId: string, since?: string) {
  await requireSeedAccess(userId, seedId);
  const [cAgg, rAgg, eAgg, distribution, myVote, seed, mediatorNudge] = await Promise.all([
    db.contribution.aggregate({
      where: { seedId, deletedAt: null },
      _count: true,
      _max: { updatedAt: true },
    }),
    db.contributionReaction.aggregate({
      where: { contribution: { seedId } },
      _count: true,
      _max: { reactedAt: true },
    }),
    db.contributionEndorsement.aggregate({
      where: { contribution: { seedId } },
      _count: true,
      _max: { endorsedAt: true },
    }),
    stageDistribution(seedId),
    db.seedStageVote.findUnique({ where: { seedId_userId: { seedId, userId } } }),
    db.seed.findUnique({ where: { id: seedId }, select: { stage: true, bloomId: true } }),
    getMediatorNudge(seedId),
  ]);

  const ms = (d: Date | null | undefined) => (d ? d.getTime() : 0);
  const version = [
    cAgg._count,
    ms(cAgg._max.updatedAt),
    rAgg._count,
    ms(rAgg._max.reactedAt),
    eAgg._count,
    ms(eAgg._max.endorsedAt),
  ].join(".");

  const stage = (seed?.stage === "bloomed" && !seed.bloomId ? "growing" : seed?.stage ?? "seed") as StageKey;
  const base = {
    version,
    distribution,
    stage,
    myVote: myVote?.stage ?? null,
    mediatorNudge, // { mode, reason } | null — the presence's live offer, for everyone
  };

  // Thread unchanged since the client last saw it → skip the heavy fetch.
  if (since && since === version) {
    return { ...base, contributions: null as ReturnType<typeof mapContribs> | null };
  }

  // Same most-recent window as getSeedDetail, so the poll and the initial load
  // stay consistent (desc + take, reversed to ascending for display).
  const rows = await db.contribution.findMany({
    where: { seedId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: THREAD_WINDOW,
    include: CONTRIB_INCLUDE,
  });
  rows.reverse();
  const keptIds = await getKeptIdsForSeed(userId, seedId);
  return { ...base, contributions: mapContribs(rows as ContribRow[], userId, keptIds) as ReturnType<typeof mapContribs> | null };
}

// A "locked" preview of a private seed for someone who doesn't have access yet —
// just enough to know what they're knocking on (garden, question, size), never
// the discussion. Returns null if the seed is truly gone. Powers the "request to
// join / waiting for the host" screen.
export async function getSeedPreview(userId: string, seedId: string) {
  const seed = await db.seed
    .findUnique({
      where: { id: seedId },
      select: { id: true, title: true, deletedAt: true, visibility: true, gardenId: true },
    })
    .catch(() => null);
  if (!seed || seed.deletedAt) return null;
  const [garden, memberCount, status] = await Promise.all([
    db.garden
      .findUnique({ where: { id: seed.gardenId }, select: { id: true, name: true, emoji: true } })
      .catch(() => null),
    db.seedMember.count({ where: { seedId } }).catch(() => 0),
    getJoinStatus(userId, seedId),
  ]);
  return {
    id: seed.id,
    title: seed.title,
    garden: garden as { id: string; name: string; emoji: string } | null,
    memberCount,
    status,
  };
}

// Read-only view of a PUBLIC seed for a signed-out guest. Returns null for
// anything that isn't a link-open public seed (private seeds stay gated, and the
// page redirects the guest to sign in). No user context is threaded through, so
// nothing here can mutate state or reach a paid AI call — a guest can only read.
// Shared read-only projection of a seed's conversation. NO access check lives
// here — every caller must gate first (public+listed for a guest; a validated
// invite token for an invitee). Mapped with an empty viewer id so nothing is
// ever "mine" and no "You" reaction attribution leaks.
type SeedForGuestRow = NonNullable<Awaited<ReturnType<typeof loadSeedForDetail>>>;
async function buildGuestSeed(seed: SeedForGuestRow) {
  const [memberCount, contributions] = await Promise.all([
    db.seedMember.count({ where: { seedId: seed.id } }).catch(() => 0),
    db.contribution.findMany({
      where: { seedId: seed.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: THREAD_WINDOW,
      include: CONTRIB_INCLUDE,
    }),
  ]);
  contributions.reverse();
  const contribs = mapContribs(contributions as ContribRow[], "");
  return {
    id: seed.id,
    title: seed.title,
    content: seed.content,
    stage: (seed.stage === "bloomed" && !seed.bloomId ? "growing" : seed.stage) as StageKey,
    bloomId: seed.bloomId,
    author: { id: seed.createdBy.id, name: displayName(seed.createdBy), image: seed.createdBy.image },
    garden: { id: seed.garden.id, name: seed.garden.name, emoji: seed.garden.emoji },
    memberCount,
    contributions: contribs,
  };
}

// Read-only view of a PUBLIC seed for a signed-out guest. Returns null for
// anything that isn't a link-open public seed (private seeds stay gated, and the
// page redirects the guest to sign in). No user context is threaded through, so
// nothing here can mutate state or reach a paid AI call — a guest can only read.
export async function getPublicSeedForGuest(seedId: string) {
  const seed = await loadSeedForDetail(seedId);
  if (!seed || seed.deletedAt) return null;
  // Only seeds explicitly "Shared with the world" (public AND listed) are
  // readable without an account. A merely link-public seed, and anything
  // private, must sign in — link-public content stays inside the app until the
  // owner deliberately opens it to the world.
  if (seed.visibility !== "public" || !seed.listed) return null;
  return buildGuestSeed(seed);
}

// Read-only view of the seed an INVITE points to — for a signed-out invitee,
// regardless of the seed's visibility. The authorization is possession of a
// validated invite token ("anyone with the link can view"): callers MUST only
// call this after getInviteByToken confirmed a live, non-revoked invite for
// this exact seed. Never call it from a plain guest path.
export async function getInvitedSeedConversation(seedId: string) {
  const seed = await loadSeedForDetail(seedId);
  if (!seed || seed.deletedAt) return null;
  return buildGuestSeed(seed);
}
