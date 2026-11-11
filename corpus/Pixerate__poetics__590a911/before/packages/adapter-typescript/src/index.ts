import type { CandidateEdge, FrameworkAdapter, UnitCandidate, UnresolvedEdge } from "@poetics/core";
import { createTypeScriptIndexer } from "./indexer.ts";
import type { IndexedUnit, TypeScriptIndexerOptions } from "./indexer.ts";

export type { IndexResult, IndexedUnit, TypeScriptIndexer, TypeScriptIndexerOptions } from "./indexer.ts";
export { createTypeScriptIndexer } from "./indexer.ts";
export type { NormalTree, NormaliseOptions } from "./normalise.ts";
export { normaliseNode } from "./normalise.ts";
export type { CallSignature, DetectedUnit, IndexedEdge, ParameterSignature, Signature, TypeText, UnresolvedUse } from "./units.ts";
export { contentTree, detectUnits, edgesOf, signatureOf } from "./units.ts";

/**
 * The indexer behind the `FrameworkAdapter` interface, for framework-neutral
 * functions, hooks and types. It answers for the code as it was on the first
 * call; create another adapter after the files change.
 */
export function createTypeScriptAdapter(options: TypeScriptIndexerOptions): FrameworkAdapter {
  let units: IndexedUnit[] | undefined;
  const all = () => (units ??= createTypeScriptIndexer(options).index().units);
  const find = (candidate: UnitCandidate): IndexedUnit => {
    const unit = all().find(
      (u) => u.span.file === candidate.span.file && u.name === candidate.name && (u.kind === "type") === (candidate.kind === "type"),
    );
    if (!unit) throw new Error(`No indexed unit ${candidate.span.file}#${candidate.name}`);
    return unit;
  };

  return {
    framework: "none",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    detectUnits(file: string): UnitCandidate[] {
      return all()
        .filter((unit) => unit.span.file === file)
        .map((unit) => ({ name: unit.name, kind: unit.kind, framework: unit.framework, span: unit.span }));
    },
    interfaceOf(candidate: UnitCandidate): unknown {
      return find(candidate).signature;
    },
    edgesOf(candidate: UnitCandidate): { edges: CandidateEdge[]; unresolved: Omit<UnresolvedEdge, "from">[] } {
      const unit = find(candidate);
      const byKey = new Map(all().map((u) => [u.key, u]));
      return {
        edges: unit.edges.flatMap((edge) => {
          const target = byKey.get(edge.to);
          return target ? [{ from: unit.span, to: target.span, kind: edge.kind }] : [];
        }),
        unresolved: unit.unresolved.map(({ kind, span, reason }) => ({ kind, span, reason })),
      };
    },
  };
}
