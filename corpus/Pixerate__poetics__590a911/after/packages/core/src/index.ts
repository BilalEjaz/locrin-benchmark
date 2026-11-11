export type { CandidateEdge, FrameworkAdapter, UnitCandidate } from "./adapter.ts";
export { NotImplementedError, notImplemented } from "./errors.ts";
export type { CompositionGraph, ImpactEntry, ImpactOptions } from "./graph.ts";
export { computeClosureHashes, createGraph, impactOf, stronglyConnectedComponents } from "./graph.ts";
export type {
  CodeUnit,
  CreatedUnit,
  IdentityMatch,
  IdentityResult,
  LineageDeclaration,
  MatchOptions,
  MatchVia,
  QueuedMatch,
  RejectedDeclaration,
  RemovedUnit,
  TrackedUnit,
  UnitRef,
} from "./identity.ts";
export { matchIdentities, similarity, trackedUnits } from "./identity.ts";
export { closureHash, contentHash, gitBlobHash, interfaceHash, isHash, isProvisional } from "./hash.ts";
export { REMOVED_CONTENT_HASH, isRemoved } from "./removal.ts";
export type * from "./types.ts";
export { isUid, mintUid, uidTime } from "./uid.ts";
