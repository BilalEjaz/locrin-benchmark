// Every answer the Worker gives: JSON that no cache keeps and no browser sniffs, because site/_headers
// covers the site's files only.

export function json(status: number, body: Record<string, string>, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
