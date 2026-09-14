import { OpenAPIHono } from '@hono/zod-openapi';
import { sessionContract } from '@zenith/shared/identity';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { listSessions, forceLogoutSession, forceLogoutVisibleUserSessions, getSessionBeforeAudit, getUserSessionsBeforeAudit } from '../../services/identity/sessions.service';
import { mountCrud } from '../_crud';

const sessionsRoute = new OpenAPIHono({ defaultHook: validationHook });
const forceLogoutRouteDef = defineContractRoute(sessionContract.forceLogout, {
  middleware: [authMiddleware, guard({ permission: 'system:session:forceLogout', audit: { module: '会话管理', description: '强制下线' } })] as const,
  handler: async (c) => {
    const { tokenId } = c.req.valid('param');
    const before = await getSessionBeforeAudit(tokenId);
    if (before) setAuditBeforeData(c, before);
    await forceLogoutSession(tokenId);
    return c.json(okBody(null, '已强制下线'), 200);
  },
});

const forceLogoutAllRouteDef = defineContractRoute(sessionContract.forceLogoutUser, {
  middleware: [authMiddleware, guard({ permission: 'system:session:forceLogout', audit: { module: '会话管理', description: '强制下线全部会话' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getUserSessionsBeforeAudit(id);
    if (before.length > 0) setAuditBeforeData(c, before);
    await forceLogoutVisibleUserSessions(id);
    return c.json(okBody(null, '已强制下线全部会话'), 200);
  },
});

mountCrud(sessionsRoute, sessionContract,
  { list: listSessions },
  { permission: 'system:session' },
  [forceLogoutAllRouteDef, forceLogoutRouteDef],
);

export default sessionsRoute;
