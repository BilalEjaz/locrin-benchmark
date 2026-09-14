/**
 * 标准 CRUD 路由的契约派生装配。
 *
 * 一个标准资源的 `list / detail / create / update / remove / removeBatch` 六个操作，路由层的差异只有
 * 权限码、审计文案与成功提示——其余（`c.req.valid(...)` 取参、`okBody` 包络、更新 / 删除前的审计快照、
 * `DELETE /batch` 必须先于 `DELETE /{id}` 注册）全部是可派生的固定写法。本模块把它们按契约上实际存在的
 * 操作一次生成；非标准操作（`options` / `groups` / 启停 / 导出…）继续用 `defineContractRoute` 显式书写，
 * 与派生路由一起交给 `mountCrud` / `orderRoutes`，静态路径自动排在同方法的参数路径之前。
 *
 * 审计快照统一取**契约实体**（`service.get(id)`），与响应里的 after 数据同形，且不会把加密列 / 内部列写进操作日志。
 *
 * @example
 * const router = new OpenAPIHono({ defaultHook: validationHook });
 * mountCrud(router, tagContract, tagService, { permission: 'system:tag', label: '标签', module: '标签管理' }, [
 *   defineContractRoute(tagContract.groups, { middleware: readGuard('system:tag:list'), handler: async (c) => c.json(okBody(await listTagGroups()), 200) }),
 * ]);
 * export default router;
 */
import type { OpenAPIHono, RouteConfig } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import type { LicenseFeatureKey } from '@zenith/shared/licensing';
import { permissionList, type AnyOperation, type Permission as SharedPermission, type PermissionPrefix } from '@zenith/shared/core';
import { defineContractRoute } from '../lib/contract-route';
import type {
  CrudContractLike, CrudCreateInputOf, CrudCreateResponseOf, CrudDetailOf, CrudIdOf, CrudListQueryOf, CrudListResponseOf, CrudUpdateInputOf, CrudUpdateResponseOf,
} from '../lib/crud-service';
import { okBody } from '../lib/openapi-schemas';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData, type AuditLogOptions } from '../middleware/guard';

export type CrudOpName = 'list' | 'detail' | 'create' | 'update' | 'remove' | 'removeBatch';

/**
 * 路由派生需要的服务能力：`defineCrudService` 的产物天然满足；尚未工厂化的显式 Service 以同名函数装配
 * `{ list: listTags, get: getTag, create: createTag, … }`。返回值逐操作对照契约响应检查（列表行与详情实体
 * 可以是不同 schema）——服务与契约漂移在这里报错。缺失 `snapshot` 时批量删除的审计快照回落为逐 id `get`。
 */
/**
 * 契约响应的宽松形态：可选键允许显式 `undefined`（服务映射常写 `x: row.x ?? undefined`；
 * JSON 序列化会丢弃 undefined，与契约 `x?: T` 等价），与 hono 对 `c.json()` 的检查口径一致。
 */
type Loose<T> = T extends (infer U)[] ? Loose<U>[] : T extends object ? { [K in keyof T]: Loose<T[K]> } : T;

export interface CrudServiceLike<C extends CrudContractLike> {
  readonly list?: (query: CrudListQueryOf<C>) => Promise<Loose<CrudListResponseOf<C>>>;
  /** 详情实体；契约无 `detail` 时仅用于 update / remove 的审计前快照 */
  readonly get?: (id: CrudIdOf<C>) => Promise<Loose<CrudDetailOf<C>>>;
  readonly create?: (input: CrudCreateInputOf<C>) => Promise<Loose<CrudCreateResponseOf<C>>>;
  readonly update?: (id: CrudIdOf<C>, input: CrudUpdateInputOf<C>) => Promise<Loose<CrudUpdateResponseOf<C>>>;
  readonly remove?: (id: CrudIdOf<C>) => Promise<unknown>;
  readonly removeMany?: (ids: CrudIdOf<C>[]) => Promise<unknown>;
  readonly snapshot?: (ids: CrudIdOf<C>[]) => Promise<unknown[]>;
}

/** 生成顺序即注册顺序：`removeBatch`（`DELETE /batch`）先于 `remove`（`DELETE /{id}`） */
const CRUD_OPS: readonly CrudOpName[] = ['list', 'detail', 'create', 'update', 'removeBatch', 'remove'];

/** 权限码后缀约定：读操作 `:list`，写操作按动作 */
const PERMISSION_SUFFIX: Record<CrudOpName, string> = {
  list: 'list',
  detail: 'list',
  create: 'create',
  update: 'update',
  remove: 'delete',
  removeBatch: 'delete',
};

const WRITE_OPS: readonly CrudOpName[] = ['create', 'update', 'remove', 'removeBatch'];

const AUDIT_VERB: Record<Exclude<CrudOpName, 'list' | 'detail'>, string> = {
  create: '创建',
  update: '更新',
  remove: '删除',
  removeBatch: '批量删除',
};

/** 权限码（单个或「任一即可」数组），只接受注册表里的码 */
type Permission = SharedPermission | readonly SharedPermission[];

export interface CrudPermissionMap {
  /** 读操作（list / detail）共用 */
  readonly read?: Permission;
  /** 写操作共用（`xxx:manage` 一类不按动作细分的权限） */
  readonly write?: Permission;
  readonly list?: Permission;
  readonly detail?: Permission;
  readonly create?: Permission;
  readonly update?: Permission;
  readonly remove?: Permission;
  readonly removeBatch?: Permission;
}

export interface CrudMountOptions {
  /**
   * 权限：传前缀字符串（`system:tag`，注册表里须存在 `system:tag:list`）按约定派生 `:list` / `:create` / `:update` / `:delete`；
   * 不按约定的资源传映射表（`{ read: 'x:view', write: 'x:manage' }` 或逐操作指定）；
   * `null` = 只要求登录（`[authMiddleware]`），不加权限码
   */
  readonly permission: PermissionPrefix | CrudPermissionMap | null;
  /** 审计里的资源名：「标签」→ 创建标签 / 更新标签 / 删除标签 / 批量删除标签；只派生读操作时可省略 */
  readonly label?: string;
  /** 审计 module；缺省 `${label}管理` */
  readonly module?: string;
  /** 逐操作覆盖审计（文案字符串、部分 `AuditLogOptions`，或 `null` 关闭该操作的审计）；整体传 `null` = 全部写操作不记审计 */
  readonly audit?: null | Partial<Record<Exclude<CrudOpName, 'list' | 'detail'>, string | null | Partial<AuditLogOptions>>>;
  /** 写操作的成功提示；`null` = 不带提示（`okBody(data)`）；`removeBatch` 可按实际删除数生成 */
  readonly messages?: {
    readonly create?: string | null;
    readonly update?: string | null;
    readonly remove?: string | null;
    readonly removeBatch?: string | ((count: number) => string);
  };
  /** 所属可授权功能，进入每个操作的 `guard({ feature })` */
  readonly feature?: LicenseFeatureKey;
  /** 追加在 `authMiddleware` 之后、`guard` 之前的中间件（平台管理员限定等） */
  readonly middleware?: readonly MiddlewareHandler[];
  /** 契约上存在但需要自定义 handler 的标准操作：在此排除后由路由文件显式书写 */
  readonly exclude?: readonly CrudOpName[];
  /** 逐操作追加契约之外的响应（如 `{ create: { 409: conflictResponse } }`） */
  readonly responses?: Partial<Record<CrudOpName, ExtraResponses>>;
}

type ExtraResponses = Record<number, { description: string; content?: Record<string, { schema: unknown }> }>;

/** `defineContractRoute` 产物的通用形态（`openapiRoutes` 的元素类型） */
export interface ContractRoute {
  readonly route: RouteConfig;
  readonly handler: unknown;
  readonly hook?: unknown;
}

type Handler = (c: Context) => Promise<Response>;

const toArray = (permission: Permission): readonly SharedPermission[] => permissionList(permission);

/** 已登录 + 权限码的读中间件元组（供同文件的非标准读操作复用） */
export function readGuard(permission: Permission, feature?: LicenseFeatureKey) {
  return [authMiddleware, guard({ permission: toArray(permission), ...(feature ? { feature } : {}) })] as const;
}

/** 已登录 + 权限码 + 审计的写中间件元组 */
export function writeGuard(permission: Permission, audit: AuditLogOptions, feature?: LicenseFeatureKey) {
  return [authMiddleware, guard({ permission: toArray(permission), audit, ...(feature ? { feature } : {}) })] as const;
}

function resolvePermission(permission: CrudMountOptions['permission'], op: CrudOpName): Permission | undefined {
  if (permission === null) return undefined;
  // 前缀 + 约定后缀：`PermissionPrefix` 已保证 `${prefix}:list` 在注册表；其余后缀由 permission-registry.test 守住
  if (typeof permission === 'string') return `${permission}:${PERMISSION_SUFFIX[op]}` as SharedPermission;
  return permission[op] ?? (WRITE_OPS.includes(op) ? permission.write : permission.read);
}

function resolveAudit(options: CrudMountOptions, op: Exclude<CrudOpName, 'list' | 'detail'>): AuditLogOptions | undefined {
  if (options.audit === null) return undefined;
  const override = options.audit?.[op];
  if (override === null) return undefined;
  const base: Partial<AuditLogOptions> = {
    ...(options.label ? { description: `${AUDIT_VERB[op]}${options.label}`, module: options.module ?? `${options.label}管理` } : {}),
    ...(options.module ? { module: options.module } : {}),
  };
  const merged = typeof override === 'string' ? { ...base, description: override } : { ...base, ...override };
  if (!merged.description) throw new Error(`派生 ${op} 路由的审计缺少 description：请提供 label，或在 audit.${op} 里给出文案 / null`);
  return merged as AuditLogOptions;
}

function middlewareFor(options: CrudMountOptions, op: CrudOpName): MiddlewareHandler[] {
  const permission = resolvePermission(options.permission, op);
  const audit = op === 'list' || op === 'detail' ? undefined : resolveAudit(options, op);
  const guardOptions = {
    ...(permission ? { permission: toArray(permission) } : {}),
    ...(audit ? { audit } : {}),
    ...(options.feature ? { feature: options.feature } : {}),
  };
  const needsGuard = Object.keys(guardOptions).length > 0;
  return [authMiddleware, ...(options.middleware ?? []), ...(needsGuard ? [guard(guardOptions)] : [])];
}

/** 契约路由的校验产物：`@hono/zod-openapi` 已按契约 schema 校验并挂到请求上 */
function valid<T>(c: Context, target: 'query' | 'param' | 'json'): T {
  return (c.req as unknown as { valid(t: string): T }).valid(target);
}

function route(op: AnyOperation, middleware: MiddlewareHandler[], handler: Handler, responses?: ExtraResponses): ContractRoute {
  return defineContractRoute(op, { middleware, handler, ...(responses ? { responses } : {}) } as never) as unknown as ContractRoute;
}

/** 派生某操作所需的服务函数缺失时立即报错（模块加载期，被 app.contract 测试捕获），而不是运行时 500 */
function required<C extends CrudContractLike, K extends keyof CrudServiceLike<C>>(
  service: CrudServiceLike<C>,
  key: K,
  contract: C,
  op: CrudOpName,
): NonNullable<CrudServiceLike<C>[K]> {
  const fn = service[key];
  if (!fn) throw new Error(`${contract.basePath} 派生 ${op} 路由需要服务提供 ${String(key)}；缺少时请 exclude 该操作后显式书写`);
  return fn;
}

/**
 * 按契约上存在的标准操作生成路由（`exclude` 的除外）。返回顺序已保证 `removeBatch` 先于 `remove`。
 * 标准操作的入参 / 响应形状由服务函数的契约类型约束；路由层只做取参与包络。
 */
export function crudRoutes<C extends CrudContractLike>(
  contract: C,
  service: CrudServiceLike<C>,
  options: CrudMountOptions,
): ContractRoute[] {
  const routes: ContractRoute[] = [];
  const messages = options.messages ?? {};
  /** `null` = 不带成功提示 */
  const message = (op: 'create' | 'update' | 'remove', fallback: string) => (messages[op] === null ? undefined : (messages[op] ?? fallback));
  const snapshot = service.snapshot ?? (async (ids: CrudIdOf<C>[]) => {
    const get = required(service, 'get', contract, 'removeBatch');
    const rows = await Promise.all(ids.map((id) => get(id).catch(() => null)));
    return rows.filter((row) => row !== null);
  });
  for (const name of CRUD_OPS) {
    const op = contract[name] as AnyOperation | undefined;
    if (!op || options.exclude?.includes(name)) continue;
    const middleware = middlewareFor(options, name);
    switch (name) {
      case 'list': {
        const list = required(service, 'list', contract, name);
        // 无 query 的列表（「我的 xxx」一类）：服务函数不取参
        routes.push(route(op, middleware, async (c) => c.json(okBody(await list(op.query ? valid(c, 'query') : (undefined as never))), 200), options.responses?.list));
        break;
      }
      case 'detail': {
        const get = required(service, 'get', contract, name);
        routes.push(route(op, middleware, async (c) => c.json(okBody(await get(valid<{ id: CrudIdOf<C> }>(c, 'param').id)), 200), options.responses?.detail));
        break;
      }
      case 'create': {
        const create = required(service, 'create', contract, name);
        routes.push(route(op, middleware, async (c) => c.json(okBody(await create(valid(c, 'json')), message('create', '创建成功')), 200), options.responses?.create));
        break;
      }
      case 'update': {
        const get = required(service, 'get', contract, name);
        const update = required(service, 'update', contract, name);
        routes.push(route(op, middleware, async (c) => {
          const { id } = valid<{ id: CrudIdOf<C> }>(c, 'param');
          setAuditBeforeData(c, await get(id));
          return c.json(okBody(await update(id, valid(c, 'json')), message('update', '更新成功')), 200);
        }, options.responses?.update));
        break;
      }
      case 'removeBatch': {
        const removeMany = required(service, 'removeMany', contract, name);
        routes.push(route(op, middleware, async (c) => {
          const { ids } = valid<{ ids: CrudIdOf<C>[] }>(c, 'json');
          const before = await snapshot(ids);
          if (before.length > 0) setAuditBeforeData(c, before);
          const result = await removeMany(ids);
          const count = typeof result === 'number' ? result : before.length;
          const message = typeof messages.removeBatch === 'function' ? messages.removeBatch(count) : (messages.removeBatch ?? '批量删除成功');
          return c.json(okBody(null, message), 200);
        }, options.responses?.removeBatch));
        break;
      }
      case 'remove': {
        const get = required(service, 'get', contract, name);
        const remove = required(service, 'remove', contract, name);
        routes.push(route(op, middleware, async (c) => {
          const { id } = valid<{ id: CrudIdOf<C> }>(c, 'param');
          setAuditBeforeData(c, await get(id));
          await remove(id);
          return c.json(okBody(null, message('remove', '删除成功')), 200);
        }, options.responses?.remove));
        break;
      }
    }
  }
  return routes;
}

const paramSegments = (path: string) => path.split('/').filter((seg) => seg.startsWith('{') || seg.startsWith(':')).length;

/**
 * 路由注册顺序：静态路径先于参数路径（`GET /groups` 先于 `GET /{id}`，`DELETE /batch` 先于 `DELETE /{id}`），
 * 其余保持给定顺序。Hono 按注册顺序匹配，参数路径先注册会让 `/groups` 落进 `{id}` 的 coerce 校验返回 400。
 */
export function orderRoutes<R extends ContractRoute>(routes: readonly R[]): R[] {
  return [...routes]
    .map((r, index) => ({ r, index, params: paramSegments(r.route.path) }))
    .sort((a, b) => a.params - b.params || a.index - b.index)
    .map(({ r }) => r);
}

/**
 * 派生标准操作 + 显式附加路由，按 `orderRoutes` 排序后注册到路由器；返回路由器本身。
 */
export function mountCrud<C extends CrudContractLike>(
  // 各路由文件的 OpenAPIHono 泛型槽互不相同，与 `_kit.ts` 的 MountableRouter 同理放宽
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router: OpenAPIHono<any, any, any>,
  contract: C,
  service: CrudServiceLike<C>,
  options: CrudMountOptions,
  extra: readonly ContractRoute[] = [],
) {
  router.openapiRoutes(orderRoutes([...crudRoutes(contract, service, options), ...extra]));
  return router;
}
