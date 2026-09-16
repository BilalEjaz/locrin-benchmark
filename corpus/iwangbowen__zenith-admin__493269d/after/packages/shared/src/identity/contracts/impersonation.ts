import * as z from 'zod';
import { dateRangeQuery, idParam, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { IMPERSONATION_END_REASONS, IMPERSONATION_STATUSES, IMPERSONATION_STATUS_OPTIONS } from '../constants';
import { startImpersonationSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 当前会话的模拟状态（`/api/auth/me` 返回；非模拟会话为 null） */
export const impersonationStateSchema = z.object({
  id: z.int().meta({ description: '模拟会话记录 ID' }),
  impersonatorId: z.int().meta({ description: '实际操作人（发起模拟的管理员）' }),
  impersonatorName: z.string().meta({ description: '实际操作人用户名' }),
  readOnly: z.boolean().meta({ description: 'true = 只读模拟，服务端拒绝全部写操作' }),
  reason: z.string(),
  startedAt: z.string(),
  expiresAt: z.string(),
}).meta({ id: 'ImpersonationState' });

export type ImpersonationState = z.infer<typeof impersonationStateSchema>;

/** 模拟登录记录（审计列表） */
export const impersonationSessionSchema = z.object({
  id: z.int(),
  impersonatorId: z.int(),
  impersonatorName: z.string(),
  impersonatorNickname: z.string().nullable(),
  targetUserId: z.int(),
  targetUsername: z.string(),
  targetNickname: z.string().nullable(),
  tenantId: z.int().nullable(),
  readOnly: z.boolean(),
  reason: z.string(),
  ip: z.string().nullable(),
  location: z.string().nullable(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  status: z.enum(IMPERSONATION_STATUSES),
  startedAt: z.string(),
  expiresAt: z.string(),
  endedAt: z.string().nullable(),
  endReason: z.enum(IMPERSONATION_END_REASONS).nullable(),
  endedBy: z.int().nullable().meta({ description: '强制结束的管理员；主动 / 到期结束为 null' }),
}).meta({ id: 'ImpersonationSession' });

export type ImpersonationSession = z.infer<typeof impersonationSessionSchema>;

/** 开始模拟的结果：目标身份的短时 access token（不签发 refresh token） */
export const impersonationStartResultSchema = z.object({
  accessToken: z.string().meta({ example: '******' }),
  impersonation: impersonationStateSchema,
  target: z.object({
    id: z.int(),
    username: z.string(),
    nickname: z.string(),
  }),
}).meta({ id: 'ImpersonationStartResult' });

export type ImpersonationStartResult = z.infer<typeof impersonationStartResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const impersonationListQuery = paginationQuery.extend({
  keyword: keywordQuery('操作人 / 目标用户 / 原因'),
  status: queryEnum(IMPERSONATION_STATUSES, { description: '状态；空 = 全部', options: IMPERSONATION_STATUS_OPTIONS }),
  ...dateRangeQuery('开始时间'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const impersonationContract = defineContract('/api/impersonation', {
  start: op.post('/start', {
    access: { permission: 'system:user:impersonate' },
    // 请求体含操作者密码、响应含目标身份令牌：两者都不进审计，事实由路由 setAuditAfterData 记录
    audit: { description: '模拟登录', recordBody: false, recordResponseBody: false },
    body: startImpersonationSchema,
    response: impersonationStartResultSchema,
    summary: '开始模拟登录（以目标用户身份签发短时会话）',
  }),
  end: op.post('/end', { access: 'authenticated', summary: '结束当前模拟会话（由模拟会话自身调用）' }),
  list: op.get('/records', { access: { permission: 'system:impersonation:list' }, query: impersonationListQuery, response: paginated(impersonationSessionSchema), summary: '模拟登录记录' }),
  forceEnd: op.post('/records/{id}/end', { access: { permission: 'system:impersonation:forceEnd' }, audit: '强制结束模拟登录', params: idParam, summary: '强制结束进行中的模拟会话' }),
}, { tags: ['Impersonation'], auditModule: '用户管理' });
