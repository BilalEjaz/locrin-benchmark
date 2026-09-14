/**
 * 契约访问声明（`access`）的迁移基线：每个域「登录令牌操作中尚未声明 access 的数量」只准缩小。
 *
 * 迁移完成态：全部为 0，届时把 `access` 改为必填并删除本基线。
 * - 数量变大 = 新增了没有声明 access 的操作 → 在契约上补 `access`（权限码 / 'authenticated' / platformOnly）
 * - 数量变小 = 迁移推进 → 同步把这里的基线改小，保持基线始终等于实际值
 */
import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from './permissions';
import { accessPermissions, type OperationAccess } from './core/contract';
import { CONTRACTS_BY_DOMAIN, listAllOperations, type ContractDomain } from './contracts';

const UNDECLARED_ACCESS_BASELINE: Record<ContractDomain, number> = {
  identity: 142,
  platform: 125,
  ops: 209,
  messaging: 125,
  tasks: 27,
  licensing: 4,
  settings: 28,
  workflow: 185,
  chat: 65,
  rules: 60,
  analytics: 92,
  report: 203,
  payment: 128,
  member: 92,
  biz: 14,
  mp: 92,
  cms: 246,
  wiki: 65,
  drive: 108,
  'open-platform': 69,
  ai: 92,
  iot: 92,
  marketing: 15,
  'short-link': 10,
};

describe('契约访问声明', () => {
  const operations = listAllOperations();

  it('每个域的契约导出都已收录进 CONTRACTS_BY_DOMAIN', () => {
    for (const [domain, contracts] of Object.entries(CONTRACTS_BY_DOMAIN)) {
      expect(contracts.length, `${domain} 没有收集到任何契约组`).toBeGreaterThan(0);
    }
    const basePaths = operations.map((o) => `${o.op.method} ${o.op.fullPath}`);
    expect(new Set(basePaths).size, '同一方法 + 路径出现在多个契约操作上').toBe(basePaths.length);
  });

  it('尚未声明 access 的登录令牌操作数量只准缩小（基线 = 实际值）', () => {
    const actual: Record<string, number> = {};
    for (const { domain, op } of operations) {
      if (op.security !== 'bearer' || op.access !== undefined) continue;
      actual[domain] = (actual[domain] ?? 0) + 1;
    }
    const diff = Object.entries(UNDECLARED_ACCESS_BASELINE)
      .filter(([domain, baseline]) => (actual[domain] ?? 0) !== baseline)
      .map(([domain, baseline]) => `${domain}: 基线 ${baseline} → 实际 ${actual[domain] ?? 0}`);
    expect(diff, '未声明 access 的操作数与基线不一致：新增操作请在契约声明 access；迁移推进后请同步改小基线').toEqual([]);
  });

  it('access 引用的权限码都在注册表', () => {
    const unknown: string[] = [];
    for (const { op } of operations) {
      for (const code of accessPermissions(op.access as OperationAccess | undefined)) {
        if (!ALL_PERMISSIONS[code]) unknown.push(`${op.method} ${op.fullPath} → ${code}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('非登录令牌操作不声明 access（构造期已拒绝，此处兜底）', () => {
    const invalid = operations.filter(({ op }) => op.security !== 'bearer' && op.access !== undefined).map(({ op }) => op.fullPath);
    expect(invalid).toEqual([]);
  });
});
