import { z } from "zod";
import { handle, ok } from "@/lib/api";
import { requireUserId } from "@/lib/authz";
import { forwardContribution } from "@/lib/services/contributions";

const forwardSchema = z.object({ contributionId: z.string().uuid() });

// POST /api/seeds/:id/forward — forward a message into this seed (:id is the
// destination). Body: { contributionId } (the message being forwarded). The
// service copies its text + attachments server-side, checks access on both
// ends, and never triggers AI.
export const POST = handle(async (req, ctx: { params: { id: string } }) => {
  const userId = await requireUserId();
  const { contributionId } = forwardSchema.parse(await req.json());
  const c = await forwardContribution(userId, ctx.params.id, contributionId);
  return ok({ id: c.id }, 201);
});
