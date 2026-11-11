import { COMMENT_MARKER } from "./comment.js";

/** An error from the GitHub API, with the HTTP status so callers can tell "no permission" apart. */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface GitHubApi {
  fetch: typeof fetch;
  /** For example https://api.github.com */
  baseUrl: string;
  token: string;
}

async function request<T>(api: GitHubApi, method: string, path: string, body?: unknown): Promise<T> {
  const res = await api.fetch(`${api.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${api.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "figdiff-action",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      // the error body was not JSON
    }
    throw new GitHubError(`GitHub API ${method} ${path} failed with ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Find the comment figdiff wrote earlier on this pull request, if any. */
export async function findComment(api: GitHubApi, repo: string, pr: number): Promise<number | undefined> {
  for (let page = 1; page <= 10; page++) {
    const comments = await request<{ id: number; body?: string }[]>(
      api,
      "GET",
      `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`,
    );
    const found = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    if (found) return found.id;
    if (comments.length < 100) return undefined;
  }
  return undefined;
}

/** Create the comment, or update the one found earlier so a pull request only ever has one. */
export async function upsertComment(
  api: GitHubApi,
  repo: string,
  pr: number,
  body: string,
  existing?: number,
): Promise<"created" | "updated"> {
  if (existing !== undefined) {
    try {
      await request(api, "PATCH", `/repos/${repo}/issues/comments/${existing}`, { body });
      return "updated";
    } catch (err) {
      // The old comment may have been deleted or belong to someone else: fall through and post a new one.
      if (!(err instanceof GitHubError) || (err.status !== 404 && err.status !== 403)) throw err;
    }
  }
  await request(api, "POST", `/repos/${repo}/issues/${pr}/comments`, { body });
  return "created";
}
