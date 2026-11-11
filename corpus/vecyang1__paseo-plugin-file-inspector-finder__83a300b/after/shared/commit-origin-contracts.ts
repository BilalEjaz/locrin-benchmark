// Commit -> origin session: which Paseo session made a git commit that a message mentions.
// One owner: server/commit-origin.ts. Front doors: the inline commit pill in the timeline
// (client/commit-origin-web.ts) and the `resolve_commit_origin` agent tool.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const COMMIT_SHA_TOKEN_RE = /^[0-9a-f]{7,40}$/;

export const CommitOriginSessionSchema = z.object({
  agentId: z.string(),
  shortId: z.string(),
  agentTitle: z.string(),
  workspaceId: z.string(),
  workspaceTitle: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  status: z.string(),
  provider: z.string(),
});

export type CommitOriginSession = z.infer<typeof CommitOriginSessionSchema>;

export const CommitOriginStatusSchema = z.enum([
  // A session mentioned the commit right after it was made; that session is the origin.
  "attributed",
  // The commit exists, but no Paseo session transcript mentions it near its commit time
  // (made by hand, outside Paseo, or by a provider whose transcript is not readable).
  "unattributed",
  // No scanned repository has this commit.
  "not_found",
  // The token is not a commit hash shape (7-40 lowercase hex).
  "invalid",
]);

export type CommitOriginStatus = z.infer<typeof CommitOriginStatusSchema>;

export const CommitOriginResultSchema = z.object({
  sha: z.string(),
  status: CommitOriginStatusSchema,
  fullSha: z.string().nullable(),
  repoPath: z.string().nullable(),
  repoName: z.string().nullable(),
  subject: z.string().nullable(),
  committedAt: z.string().nullable(),
  origin: CommitOriginSessionSchema.nullable(),
  firstMentionAt: z.string().nullable(),
  /** Seconds between the commit time and the origin's first mention (negative = the step started first). */
  lagSeconds: z.number().nullable(),
  /** Sessions active at commit time whose transcript was searched. */
  candidatesChecked: z.number(),
  /** Sessions active at commit time whose transcript cannot be read (other providers, missing files). */
  unreadableSessions: z.number(),
  /** Of the searched sessions, how many mention the commit inside the attribution window. */
  mentioningSessions: z.number(),
  /** Shape of the origin's mention: git commit output, HEAD/full-hash output, or plain mention. */
  evidenceStrength: z.enum(["proof", "strong", "weak"]).nullable(),
  evidence: z.string(),
});

export type CommitOriginResult = z.infer<typeof CommitOriginResultSchema>;

export const resolveCommitOriginRpc = defineRpc({
  name: "finder.resolve_commit_origin",
  input: z.object({
    shas: z.array(z.string().max(80)).min(1).max(40),
    refresh: z.boolean().optional(),
    source: z.enum(["timeline-pill", "agent-tool", "settings-ui"]).optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    results: z.array(CommitOriginResultSchema),
    reposScanned: z.number(),
    message: z.string(),
    durationMs: z.number(),
  }),
});
