// The Worker's code, which runs only for /api/* (`run_worker_first` in wrangler.jsonc); every other path is
// a file from site/. One route: POST /api/talk, the talk flow's send.

import { json } from "./json.ts";
import { handleTalk, type Bindings } from "./talk.ts";

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/talk") {
      if (request.method !== "POST") return json(405, { reason: "method" }, { Allow: "POST" });
      return handleTalk(request, env);
    }
    return json(404, { reason: "not-found" });
  },
} satisfies ExportedHandler<Bindings>;
