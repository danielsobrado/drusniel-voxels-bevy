export type FarClipmapDebugMode = "final" | "biome" | "height" | "ownership";
export interface FarClipmapConfig { enabled: boolean; innerRadiusM: number; outerRadiusM: number; ringCount: number; baseCellSizeM: number; gridResolution: number; snapSizeM: number; heightScale: number; yOffset: number; maxRebuildsPerFrame: number; materialDebugMode: FarClipmapDebugMode }
export interface FarClipmapConfigConstraints { liveCollisionRadiusM?: number; clodCoverageRadiusM?: number; targetVisibleRadiusM?: number }
export const DEFAULT_FAR_CLIPMAP_CONFIG: FarClipmapConfig = Object.freeze({ enabled: true, innerRadiusM: 384, outerRadiusM: 4096, ringCount: 5, baseCellSizeM: 8, gridResolution: 129, snapSizeM: 128, heightScale: 1, yOffset: 0, maxRebuildsPerFrame: 2, materialDebugMode: "final" });
const DEBUG_MODES: ReadonlySet<string> = new Set<FarClipmapDebugMode>(["final", "biome", "height", "ownership"]);
function finiteNumber(v: unknown, f: number): number { return typeof v === "number" && Number.isFinite(v) ? v : f; }
function positiveNumber(v: unknown, f: number): number { const n = finiteNumber(v, f); return n > 0 ? n : f; }
function positiveInteger(v: unknown, f: number): number { return Math.max(1, Math.floor(positiveNumber(v, f))); }
function nonNegativeInteger(v: unknown, f: number): number { return Math.max(0, Math.floor(finiteNumber(v, f))); }
function boolFromQuery(v: string | null, f: boolean): boolean { if (v === null) return f; if (v === "1" || v === "true") return true; if (v === "0" || v === "false") return false; return f; }
function positiveQueryNumber(p: URLSearchParams, k: string, f: number): number { const n = Number(p.get(k)); return Number.isFinite(n) && n > 0 ? n : f; }
function integerQueryNumber(p: URLSearchParams, k: string, f: number): number { return Math.floor(positiveQueryNumber(p, k, f)); }
function debugMode(v: unknown, f: FarClipmapDebugMode): FarClipmapDebugMode { return typeof v === "string" && DEBUG_MODES.has(v) ? v as FarClipmapDebugMode : f; }
function rendererAllowed(p: URLSearchParams): boolean { const scene = p.get("scene") ?? ""; return p.get("farClipmapMode") === "replace" || !scene.startsWith("infinite-"); }
export function resolveFarClipmapConfig(partial: Partial<FarClipmapConfig> = {}, constraints: FarClipmapConfigConstraints = {}): FarClipmapConfig {
  const b = DEFAULT_FAR_CLIPMAP_CONFIG;
  const c: FarClipmapConfig = { enabled: typeof partial.enabled === "boolean" ? partial.enabled : b.enabled, innerRadiusM: positiveNumber(partial.innerRadiusM, b.innerRadiusM), outerRadiusM: positiveNumber(partial.outerRadiusM, b.outerRadiusM), ringCount: positiveInteger(partial.ringCount, b.ringCount), baseCellSizeM: positiveNumber(partial.baseCellSizeM, b.baseCellSizeM), gridResolution: positiveInteger(partial.gridResolution, b.gridResolution), snapSizeM: positiveNumber(partial.snapSizeM, b.snapSizeM), heightScale: finiteNumber(partial.heightScale, b.heightScale), yOffset: finiteNumber(partial.yOffset, b.yOffset), maxRebuildsPerFrame: nonNegativeInteger(partial.maxRebuildsPerFrame, b.maxRebuildsPerFrame), materialDebugMode: debugMode(partial.materialDebugMode, b.materialDebugMode) };
  const minInner = constraints.liveCollisionRadiusM === undefined ? c.baseCellSizeM : constraints.liveCollisionRadiusM + c.baseCellSizeM;
  if (c.innerRadiusM <= minInner) c.innerRadiusM = Math.ceil(minInner / c.baseCellSizeM) * c.baseCellSizeM;
  const minOuter = Math.max(c.innerRadiusM + c.baseCellSizeM, constraints.clodCoverageRadiusM ?? 0, constraints.targetVisibleRadiusM ?? 0);
  if (c.outerRadiusM < minOuter) c.outerRadiusM = Math.ceil(minOuter / c.snapSizeM) * c.snapSizeM;
  if (c.gridResolution < 2) c.gridResolution = 2;
  return c;
}
export function farClipmapConfigFromSearchParams(params: URLSearchParams, constraints: FarClipmapConfigConstraints = {}): FarClipmapConfig {
  const b = DEFAULT_FAR_CLIPMAP_CONFIG;
  return resolveFarClipmapConfig({ enabled: boolFromQuery(params.get("farClipmap"), b.enabled) && rendererAllowed(params), innerRadiusM: positiveQueryNumber(params, "farClipmapInnerRadius", b.innerRadiusM), outerRadiusM: positiveQueryNumber(params, "farClipmapOuterRadius", b.outerRadiusM), ringCount: integerQueryNumber(params, "farClipmapRingCount", b.ringCount), baseCellSizeM: positiveQueryNumber(params, "farClipmapBaseCellSize", b.baseCellSizeM), gridResolution: integerQueryNumber(params, "farClipmapGridResolution", b.gridResolution), snapSizeM: positiveQueryNumber(params, "farClipmapSnapSize", b.snapSizeM), heightScale: Number.isFinite(Number(params.get("farClipmapHeightScale"))) ? Number(params.get("farClipmapHeightScale")) : b.heightScale, yOffset: Number.isFinite(Number(params.get("farClipmapYOffset"))) ? Number(params.get("farClipmapYOffset")) : b.yOffset, maxRebuildsPerFrame: integerQueryNumber(params, "farClipmapMaxRebuildsPerFrame", b.maxRebuildsPerFrame), materialDebugMode: debugMode(params.get("farClipmapDebug"), b.materialDebugMode) }, constraints);
}
