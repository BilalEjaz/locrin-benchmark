import * as z from 'zod';
import { idParam, keywordQuery, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { tokenIdParam } from './auth';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 在线会话（管理员视角） */
export const onlineSessionSchema = z.object({
  tokenId: z.string(),
  userId: z.int(),
  username: z.string(),
  nickname: z.string(),
  ip: z.string(),
  location: z.string().nullable(),
  browser: z.string(),
  os: z.string(),
  loginAt: z.string(),
  impersonatorName: z.string().nullable().optional().meta({ description: '模拟会话的实际操作人；本人登录为 null' }),
}).meta({ id: 'OnlineSession' });

export type OnlineSession = z.infer<typeof onlineSessionSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const sessionListQuery = paginationQuery.extend({
  keyword: keywordQuery('用户名 / 昵称 / IP '),
});

export const sessionContract = defineContract('/api/sessions', {
  list: op.get('/', { query: sessionListQuery, response: paginated(onlineSessionSchema), summary: '获取在线会话列表' }),
  forceLogoutUser: op.delete('/user/{id}', { params: idParam, summary: '强制指定用户所有会话下线' }),
  forceLogout: op.delete('/{tokenId}', { params: tokenIdParam, summary: '强制指定会话下线' }),
}, { tags: ['Sessions'] });
