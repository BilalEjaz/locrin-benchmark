import { OpenAPIHono } from '@hono/zod-openapi';
import { impersonationContract } from '@zenith/shared/identity';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData } from '../../middleware/guard';
import { sensitiveRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { getClientInfo } from '../../lib/request-helpers';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  endImpersonation,
  forceEndImpersonation,
  listImpersonationSessions,
  startImpersonation,
} from '../../services/identity/impersonation.service';
import { mountCrud } from '../_crud';

const impersonationRouter = new OpenAPIHono({ defaultHook: validationHook });

const startRoute = defineContractRoute(impersonationContract.start, {
  // 请求体含操作者密码、响应含目标身份令牌：两者都不进审计，改由 setAuditAfterData 记录事实
  middleware: [
    sensitiveRateLimit,
    authMiddleware,
    guard({ permission: 'system:user:impersonate', audit: { module: '用户管理', description: '模拟登录', recordBody: false, recordResponseBody: false } }),
  ] as const,
  handler: async (c) => {
    const result = await startImpersonation(c.req.valid('json'), getClientInfo(c));
    setAuditAfterData(c, { target: result.target, ...result.impersonation });
    return c.json(okBody(result, '已进入模拟登录'), 200);
  },
});

const endRoute = defineContractRoute(impersonationContract.end, {
  middleware: [authMiddleware] as const,
  handler: async (c) => {
    await endImpersonation(getClientInfo(c));
    return c.json(okBody(null, '已结束模拟登录'), 200);
  },
});

const forceEndRoute = defineContractRoute(impersonationContract.forceEnd, {
  middleware: [authMiddleware, guard({ permission: 'system:impersonation:forceEnd', audit: { module: '用户管理', description: '强制结束模拟登录' } })] as const,
  handler: async (c) => {
    await forceEndImpersonation(c.req.valid('param').id, getClientInfo(c));
    return c.json(okBody(null, '已强制结束该模拟会话'), 200);
  },
});

// list 由契约派生（system:impersonation:list）；其余为自定义操作
mountCrud(impersonationRouter, impersonationContract,
  { list: listImpersonationSessions },
  { permission: 'system:impersonation' },
  [startRoute, endRoute, forceEndRoute],
);

export default impersonationRouter;
