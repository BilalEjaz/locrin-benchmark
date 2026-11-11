/**
 * Safe read access to the Paseo web app's Metro module registry.
 *
 * Use this instead of reaching for `window.__c`. In Paseo 0.15.3's production bundle `__c` is
 * Metro's `clear()` (`e.__c=o` with `function o(){return t=new Map}`): calling it replaces the
 * registry with an empty Map, after which every module not yet initialized (lazy routes,
 * settings screens, the Mermaid fence) fails with "Requiring unknown module". The registry is
 * found instead by watching which Map `__r(0)` reads from.
 */

export interface MetroModuleRecord {
  isInitialized?: boolean;
  factory?: unknown;
  publicModule?: { exports?: Record<string, unknown> };
}

export type MetroModuleMap = Map<number, MetroModuleRecord>;

export type MetroWindow = { __r?: unknown; __c?: unknown };

const mapCache = new WeakMap<object, MetroModuleMap>();

function resolveWindow(win?: MetroWindow | null): MetroWindow | null {
  return (win ?? (typeof window !== "undefined" ? window : null)) as MetroWindow | null;
}

/** The live registry, or null when this is not a Metro web bundle. Never calls `__c`. */
export function getMetroModuleMap(win?: MetroWindow | null): MetroModuleMap | null {
  const target = resolveWindow(win);
  if (!target) return null;
  if (target.__c instanceof Map) return target.__c as MetroModuleMap;
  const cached = mapCache.get(target);
  if (cached) return cached;
  if (typeof target.__r !== "function") return null;

  let found: MetroModuleMap | null = null;
  const originalGet = Map.prototype.get;
  try {
    Map.prototype.get = function (this: Map<unknown, unknown>, key: unknown) {
      if (key === 0 && !found && this.size > 50) found = this as unknown as MetroModuleMap;
      return originalGet.call(this, key);
    };
    try {
      (target.__r as (id: number) => unknown)(0);
    } catch {
      // Module 0 may throw on re-entry; the registry read already happened.
    }
  } finally {
    Map.prototype.get = originalGet;
  }
  if (found) mapCache.set(target, found);
  return found;
}

function factorySource(record: MetroModuleRecord): string {
  if (typeof record.factory !== "function") return "";
  try {
    return Function.prototype.toString.call(record.factory);
  } catch {
    return "";
  }
}

export interface MetroExportHit {
  id: number;
  exports: Record<string, unknown>;
}

/**
 * Finds the module that defines export `name`, initializing it if Metro has not yet.
 * Metro drops `factory` once a module runs, so initialized modules are matched by their exports
 * and uninitialized ones by their factory source.
 */
export function requireMetroExport(name: string, win?: MetroWindow | null): MetroExportHit | null {
  const target = resolveWindow(win);
  const map = getMetroModuleMap(target);
  if (!map || !target) return null;
  for (const [id, record] of map.entries()) {
    const exports = record?.publicModule?.exports;
    if (record?.isInitialized && exports && Object.prototype.hasOwnProperty.call(exports, name)) {
      return { id, exports };
    }
  }
  if (typeof target.__r !== "function") return null;
  const definesName = new RegExp(`\\.${name}\\s*=|["']${name}["']`);
  for (const [id, record] of map.entries()) {
    if (record?.isInitialized || !definesName.test(factorySource(record))) continue;
    try {
      (target.__r as (id: number) => unknown)(id);
    } catch {
      continue;
    }
    const exports = map.get(id)?.publicModule?.exports;
    if (exports && Object.prototype.hasOwnProperty.call(exports, name)) return { id, exports };
  }
  return null;
}
