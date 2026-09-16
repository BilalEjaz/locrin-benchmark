import { OpenAPIHono } from '@hono/zod-openapi';
import { impersonationContract } from '@zenith/shared/identity';
import { setAuditAfterData } from '../../middleware/guard';
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

// 权限 / 审计已在契约 access / audit 上声明，门禁由 defineContractRoute 装配；路由只剩 handler
const impersonationRouter = new OpenAPIHono({ defaultHook: validationHook });

const startRoute = defineContractRoute(impersonationContract.start, {
  preAuth: [sensitiveRateLimit],
  handler: async (c) => {
    const result = await startImpersonation(c.req.valid('json'), getClientInfo(c));
    setAuditAfterData(c, { target: result.target, ...result.impersonation });
    return c.json(okBody(result, '已进入模拟登录'), 200);
  },
});

const endRoute = defineContractRoute(impersonationContract.end, {
  handler: async (c) => {
    await endImpersonation(getClientInfo(c));
    return c.json(okBody(null, '已结束模拟登录'), 200);
  },
});

const forceEndRoute = defineContractRoute(impersonationContract.forceEnd, {
  handler: async (c) => {
    await forceEndImpersonation(c.req.valid('param').id, getClientInfo(c));
    return c.json(okBody(null, '已强制结束该模拟会话'), 200);
  },
});

mountCrud(impersonationRouter, impersonationContract, { list: listImpersonationSessions }, {}, [startRoute, endRoute, forceEndRoute]);

export default impersonationRouter;