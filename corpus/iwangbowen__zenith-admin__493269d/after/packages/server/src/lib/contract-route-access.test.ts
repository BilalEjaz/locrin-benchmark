import { describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';

const seen = vi.hoisted(() => ({ guardCalls: [] as unknown[], platformCalls: [] as unknown[] }));
vi.mock('../middleware/auth', () => ({ authMiddleware: Object.assign(async () => {}, { __name: 'auth' }) }));
vi.mock('../middleware/guard', () => ({
  guard: (options: unknown) => { seen.guardCalls.push(options); return Object.assign(async () => {}, { __name: 'guard' }); },
}));
vi.mock('../middleware/platform-admin', () => ({
  platformAdminOnly: (options: unknown) => { seen.platformCalls.push(options); return Object.assign(async () => {}, { __name: 'platform' }); },
}));
vi.mock('./data-mask/boundary', () => ({ withDataMasking: (_op: unknown, handler: unknown) => handler }));

import { defineContract, op } from '@zenith/shared/core';
import { resolveRouteMiddleware } from './contract-route';

const named = (mw: MiddlewareHandler) => (mw as unknown as { __name?: string }).__name ?? 'custom';
const custom = Object.assign(async () => {}, { __name: 'custom' }) as unknown as MiddlewareHandler;
const rate = Object.assign(async () => {}, { __name: 'rate' }) as unknown as MiddlewareHandler;

const contract = defineContract('/api/demo', {
  legacy: op.get('/legacy', { summary: '未迁移' }),
  me: op.get('/me', { access: 'authenticated', summary: '登录即可' }),
  list: op.get('/', { access: { permission: 'system:user:list' }, summary: '权限码' }),
  create: op.post('/', { access: { permission: ['system:user:create', 'system:user:update'] }, audit: '创建', summary: '任一即可 + 审计' }),
  tenants: op.get('/tenants', { access: { permission: 'system:tenant:list', platformOnly: true }, summary: '平台超管 + 权限码' }),
  menus: op.put('/menus', { access: { platformOnly: 'multi-tenant' }, audit: { description: '改菜单', recordBody: false }, summary: '仅多租户下限定平台' }),
  gated: op.get('/gated', { access: 'authenticated', feature: 'drive', summary: '功能门控' }),
  pub: op.get('/pub', { public: true, summary: '公开' }),
}, { auditModule: '演示' });

describe('resolveRouteMiddleware（契约 access → 门禁链装配）', () => {
  it('契约未声明 access：原样使用路由提供的中间件，不注入任何门禁；preAuth 无意义即报错', () => {
    expect(resolveRouteMiddleware(contract.legacy, { middleware: [custom] }).map(named)).toEqual(['custom']);
    expect(() => resolveRouteMiddleware(contract.legacy, { preAuth: [rate] })).toThrow(/preAuth/);
  });

  it('公开操作不注入认证', () => {
    expect(resolveRouteMiddleware(contract.pub, {}).map(named)).toEqual([]);
  });

  it("'authenticated'：preAuth → auth → 追加中间件，无 guard", () => {
    seen.guardCalls.length = 0;
    expect(resolveRouteMiddleware(contract.me, { preAuth: [rate], middleware: [custom] }).map(named)).toEqual(['rate', 'auth', 'custom']);
    expect(seen.guardCalls).toEqual([]);
  });

  it('权限码：auth → guard({ permission })', () => {
    seen.guardCalls.length = 0;
    expect(resolveRouteMiddleware(contract.list, {}).map(named)).toEqual(['auth', 'guard']);
    expect(seen.guardCalls).toEqual([{ permission: ['system:user:list'] }]);
  });

  it('任一即可数组 + 契约审计（module 取契约组 auditModule）', () => {
    seen.guardCalls.length = 0;
    resolveRouteMiddleware(contract.create, {});
    expect(seen.guardCalls).toEqual([{ permission: ['system:user:create', 'system:user:update'], audit: { description: '创建', module: '演示' } }]);
  });

  it('路由级 audit 覆盖契约审计', () => {
    seen.guardCalls.length = 0;
    resolveRouteMiddleware(contract.create, { audit: { description: '动态文案', module: 'X' } });
    expect(seen.guardCalls).toEqual([{ permission: ['system:user:create', 'system:user:update'], audit: { description: '动态文案', module: 'X' } }]);
  });

  it('platformOnly：auth → platformAdminOnly → guard；multi-tenant 形态透传 onlyInMultiTenant', () => {
    seen.guardCalls.length = 0;
    seen.platformCalls.length = 0;
    expect(resolveRouteMiddleware(contract.tenants, {}).map(named)).toEqual(['auth', 'platform', 'guard']);
    expect(seen.platformCalls).toEqual([undefined]);
    expect(resolveRouteMiddleware(contract.menus, {}).map(named)).toEqual(['auth', 'platform', 'guard']);
    expect(seen.platformCalls[1]).toEqual({ onlyInMultiTenant: true });
    // 仅平台限定 + 审计：guard 只带 audit（recordBody: false 透传）
    expect(seen.guardCalls[1]).toEqual({ audit: { description: '改菜单', module: '演示', recordBody: false } });
  });

  it('feature 进入 guard；未登记的功能键在装配期报错', () => {
    seen.guardCalls.length = 0;
    resolveRouteMiddleware(contract.gated, {});
    expect(seen.guardCalls).toEqual([{ feature: 'drive' }]);
    const bad = defineContract('/api/bad', { x: op.get('/', { access: 'authenticated', feature: 'no-such-feature', summary: 'x' }) });
    expect(() => resolveRouteMiddleware(bad.x, {})).toThrow(/License 功能/);
  });

  it('非 bearer 操作声明 access 在契约构造期即被拒绝', () => {
    expect(() => defineContract('/api/bad2', { x: op.get('/', { public: true, access: 'authenticated', summary: 'x' }) })).toThrow(/access 只能声明/);
  });
});
