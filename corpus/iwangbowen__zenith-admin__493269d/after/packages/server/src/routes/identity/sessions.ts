import { OpenAPIHono } from '@hono/zod-openapi';
import { sessionContract } from '@zenith/shared/identity';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { listSessions, forceLogoutSession, forceLogoutVisibleUserSessions, getSessionBeforeAudit, getUserSessionsBeforeAudit } from '../../services/identity/sessions.service';
import { mountCrud } from '../_crud';

// 权限 / 审计已在契约 access / audit 上声明
const sessionsRoute = new OpenAPIHono({ defaultHook: validationHook });
const forceLogoutRouteDef = defineContractRoute(sessionContract.forceLogout, {
  handler: async (c) => {
    const { tokenId } = c.req.valid('param');
    const before = await getSessionBeforeAudit(tokenId);
    if (before) setAuditBeforeData(c, before);
    await forceLogoutSession(tokenId);
    return c.json(okBody(null, '已强制下线'), 200);
  },
});

const forceLogoutAllRouteDef = defineContractRoute(sessionContract.forceLogoutUser, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getUserSessionsBeforeAudit(id);
    if (before.length > 0) setAuditBeforeData(c, before);
    await forceLogoutVisibleUserSessions(id);
    return c.json(okBody(null, '已强制下线全部会话'), 200);
  },
});

mountCrud(sessionsRoute, sessionContract, { list: listSessions }, {}, [forceLogoutAllRouteDef, forceLogoutRouteDef]);

export default sessionsRoute;