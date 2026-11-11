// The indexer: one TypeScript program over the files in scope, reused between
// runs, and a per-file cache so unchanged files skip the checker entirely.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { computeClosureHashes, contentHash, createGraph, gitBlobHash, interfaceHash } from "@poetics/core";
import type { Edge, Hash, Span, UnitKind } from "@poetics/core";
import { contentTree, detectUnits, edgesOf, signatureOf } from "./units.ts";
import type { DetectedUnit, IndexedEdge, Signature, UnresolvedUse } from "./units.ts";

export interface TypeScriptIndexerOptions {
  /** Repository root: files, spans and keys are relative to it. */
  root: string;
  /** Repo-relative POSIX paths of the files in scope. */
  files: readonly string[];
  /** A tsconfig whose compiler options the program uses. */
  tsconfig?: string;
  /** Compiler options, when there is no tsconfig to read. */
  compilerOptions?: ts.CompilerOptions;
  /** Where the per-file cache lives, e.g. `.poetics/cache/typescript.json`. Without one, nothing is kept between indexers. */
  cacheFile?: string;
}

/** One unit with everything the store needs from the indexer. */
export interface IndexedUnit {
  /** `file#name`, the target edges point at. */
  key: string;
  name: string;
  exportedAs?: string;
  kind: UnitKind;
  framework: "none";
  span: Span;
  /** 1-based and inclusive, for people. */
  startLine: number;
  endLine: number;
  docs?: string;
  /** The normalised tree, own name excluded: formatting and comments never change it. */
  contentHash: Hash;
  /** The same tree with types erased. Equal runtime hashes with different content hashes mean a types-only change. */
  runtimeHash: Hash;
  interfaceHash: Hash;
  signature: Signature;
  edges: IndexedEdge[];
  unresolved: UnresolvedUse[];
}

export interface IndexResult {
  units: IndexedUnit[];
  /** Files answered from the cache, and files the checker indexed. */
  stats: { cached: number; indexed: number };
}

export interface TypeScriptIndexer {
  /** Indexes the files in scope, or `files` in their place, reusing everything unchanged. */
  index(files?: readonly string[]): IndexResult;
}

// Bump when the shape of cached units or the normalisation changes, so old caches are dropped.
const CACHE_VERSION = 1;
const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock"];

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2024,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  jsx: ts.JsxEmit.Preserve,
  strict: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
};

interface CachedFile {
  key: Hash;
  units: IndexedUnit[];
}

interface Cache {
  version: number;
  environment: string;
  files: Record<string, CachedFile>;
}

/** Creates an indexer whose program and cache carry over from one `index` call to the next. */
export function createTypeScriptIndexer(options: TypeScriptIndexerOptions): TypeScriptIndexer {
  const root = resolve(options.root);
  const compilerOptions: ts.CompilerOptions = { ...compilerOptionsFor(root, options), noEmit: true };
  const resolutionCache = ts.createModuleResolutionCache(root, (name) => name, compilerOptions);
  const host = reusingHost(compilerOptions);
  const environment = gitBlobHash(JSON.stringify([CACHE_VERSION, ts.version, compilerOptions, lockfileHash(root)]));
  let cache = readCache(options.cacheFile, environment);
  let program: ts.Program | undefined;

  const absolute = (file: string) => join(root, file);
  const relativeTo = (path: string) => relative(root, path).split(sep).join("/");

  return {
    index(files = options.files) {
      const scope = [...new Set(files)];
      const keys = fileKeys(scope, root, compilerOptions, resolutionCache, relativeTo);
      const misses = scope.filter((file) => cache.files[file]?.key !== keys.get(file));
      const next: Record<string, CachedFile> = {};

      if (misses.length > 0) {
        program = ts.createProgram({ rootNames: scope.map(absolute), options: compilerOptions, host, ...(program ? { oldProgram: program } : {}) });
        const checker = program.getTypeChecker();
        const detected = new Map<string, { source: ts.SourceFile; units: DetectedUnit[] }>();
        const byDeclaration = new Map<ts.Node, DetectedUnit>();
        for (const file of scope) {
          const source = program.getSourceFile(absolute(file));
          if (!source) continue;
          const units = detectUnits(source, file);
          detected.set(file, { source, units });
          for (const unit of units) for (const declaration of unit.declarations) byDeclaration.set(declaration, unit);
        }
        const unitAt = (declaration: ts.Declaration) => byDeclaration.get(declaration);
        for (const file of misses) {
          const found = detected.get(file);
          const units = found ? found.units.map((unit) => indexUnit(unit, found.source, checker, unitAt)) : [];
          next[file] = { key: keys.get(file)!, units };
        }
      }
      for (const file of scope) next[file] ??= cache.files[file]!;

      cache = { version: CACHE_VERSION, environment, files: next };
      if (options.cacheFile) writeCache(options.cacheFile, cache);
      return {
        units: scope.flatMap((file) => next[file]!.units),
        stats: { cached: scope.length - misses.length, indexed: misses.length },
      };
    },
  };
}

function indexUnit(unit: DetectedUnit, source: ts.SourceFile, checker: ts.TypeChecker, unitAt: (d: ts.Declaration) => DetectedUnit | undefined): IndexedUnit {
  const signature = signatureOf(unit, checker);
  const { edges, unresolved } = edgesOf(unit, checker, unitAt);
  const indexed: IndexedUnit = {
    key: unit.key,
    name: unit.name,
    kind: unit.kind,
    framework: "none",
    span: unit.span,
    startLine: source.getLineAndCharacterOfPosition(unit.span.start).line + 1,
    endLine: source.getLineAndCharacterOfPosition(unit.span.end).line + 1,
    contentHash: contentHash(contentTree(unit)),
    runtimeHash: contentHash(contentTree(unit, true)),
    interfaceHash: interfaceHash(signature),
    signature,
    edges,
    unresolved,
  };
  if (unit.exportedAs !== undefined) indexed.exportedAs = unit.exportedAs;
  if (unit.docs !== undefined) indexed.docs = unit.docs;
  return indexed;
}

/**
 * A cache key per file in scope: a Merkle hash of its path, text and whether it
 * is in scope, over every project file it imports, directly or not. A file's
 * signatures and edges can only depend on what it imports, so an unchanged key
 * means its cached units still hold.
 */
function fileKeys(
  scope: readonly string[],
  root: string,
  options: ts.CompilerOptions,
  resolutionCache: ts.ModuleResolutionCache,
  relativeTo: (path: string) => string,
): Map<string, Hash> {
  const inScope = new Set(scope);
  const own = new Map<string, Hash>();
  const edges: Edge[] = [];
  const queue = [...scope];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (own.has(file)) continue;
    const path = join(root, file);
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    own.set(file, gitBlobHash(`${file}\0${inScope.has(file) ? "scope" : "dependency"}\0${text}`));
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
      const resolved = ts.resolveModuleName(fileName, path, options, ts.sys, resolutionCache).resolvedModule;
      // Packages are covered by the lockfile in the cache's environment.
      if (!resolved || resolved.isExternalLibraryImport) continue;
      const target = relativeTo(resolved.resolvedFileName);
      if (target.startsWith("../") || isAbsolute(target)) continue;
      edges.push({ from: file, to: target, kind: "references-type" });
      queue.push(target);
    }
  }
  return computeClosureHashes(createGraph(edges), own);
}

/** A compiler host that hands back the same SourceFile for unchanged text, so `oldProgram` reuse works. */
function reusingHost(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const sources = new Map<string, { text: string; file: ts.SourceFile }>();
  host.getSourceFile = (fileName, languageVersion) => {
    const text = host.readFile(fileName);
    if (text === undefined) return undefined;
    const known = sources.get(fileName);
    if (known?.text === text) return known.file;
    const file = ts.createSourceFile(fileName, text, languageVersion, true);
    sources.set(fileName, { text, file });
    return file;
  };
  return host;
}

function compilerOptionsFor(root: string, options: TypeScriptIndexerOptions): ts.CompilerOptions {
  if (!options.tsconfig) return options.compilerOptions ?? DEFAULT_OPTIONS;
  const path = resolve(root, options.tsconfig);
  const read = ts.readConfigFile(path, ts.sys.readFile);
  if (read.error) throw new Error(`Cannot read ${options.tsconfig}: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`);
  return { ...ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(path)).options, ...options.compilerOptions };
}

function lockfileHash(root: string): string | null {
  for (const name of LOCKFILES) {
    const path = join(root, name);
    if (existsSync(path)) return gitBlobHash(readFileSync(path, "utf8"));
  }
  return null;
}

function readCache(file: string | undefined, environment: string): Cache {
  const empty: Cache = { version: CACHE_VERSION, environment, files: {} };
  if (!file || !existsSync(file)) return empty;
  try {
    const cache = JSON.parse(readFileSync(file, "utf8")) as Cache;
    return cache.version === CACHE_VERSION && cache.environment === environment ? cache : empty;
  } catch {
    // The cache is disposable: a torn or hand-edited file just means a full index.
    return empty;
  }
}

function writeCache(file: string, cache: Cache): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(cache));
  renameSync(temp, file);
}
