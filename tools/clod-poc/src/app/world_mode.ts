// Explicit world identity for the CLOD poc.
//
// Historically "infinite-islands" was a magic scene string checked in ~5 files, and a single
// `worldCells` value derived from the (small) bootstrap world leaked into border coast, water,
// the far shell, the streamed-root world param, colliders, and the cache key. That conflation is
// exactly what let the finite border coast collapse terrain far from the startup world.
//
// WorldModeConfig is the single source of truth. Every subsystem asks which *kind* of size it
// means (configured domain vs bootstrap window vs procedural radius) instead of guessing from a
// scene string or reusing bootstrap `worldCells`.

export const INFINITE_ISLANDS_SCENE = "infinite-islands";

export type WorldMode = "finite" | "infinite_islands";

/** Who renders the far band. Exactly one owner should be active per world-mode slice. */
export type FarOwner = "legacy_far_shell" | "far_clipmap" | "infinite_far_shell" | "none";

export interface WorldModeConfig {
  mode: WorldMode;
  /** Intended full-domain size in pages (finite authoring domain). */
  configuredWorldPages: number;
  /** Fast bootstrap window built up-front. NOT the world domain. */
  startupWorldPages: number;
  /** configuredWorldPages · pageCells. */
  configuredWorldCells: number;
  /** startupWorldPages · pageCells (bootstrap box). */
  startupWorldCells: number;
  /** Procedural extent in metres; null means unbounded (no ocean rim). */
  proceduralWorldRadiusM: number | null;
  /** Whether the finite world-edge coast shaping is active. Always false for infinite islands. */
  borderCoastEnabled: boolean;
  /** Which system owns the far band by default for this mode. */
  farOwner: FarOwner;
}

export interface ResolveWorldModeInput {
  scene: string | null;
  searchParams: URLSearchParams;
  configuredWorldPages: number;
  startupWorldPages: number;
  /** chunks_per_page · chunk_size. */
  pageCells: number;
  /** terrainFieldConfig.islandShape.enabled */
  islandShapeEnabled: boolean;
  /** border_coast_ocean.yaml `enabled` */
  borderCoastConfigEnabled: boolean;
  /** terrainFieldConfig.islandShape.oceanRim */
  oceanRim: boolean;
  /** terrainFieldConfig.islandShape.worldRadiusM */
  worldRadiusM: number;
}

function resolveFarOwner(mode: WorldMode, searchParams: URLSearchParams): FarOwner {
  if (mode === "finite") return "legacy_far_shell";
  if (searchParams.get("farClipmap") === "1") return "far_clipmap";
  // Long-view / NAADF paths install the player-centred infinite far shell; otherwise the near
  // streamed roots + sky cover the horizon and no legacy finite shell should be built.
  return "infinite_far_shell";
}

export function resolveWorldMode(input: ResolveWorldModeInput): WorldModeConfig {
  const isInfiniteIslands = input.scene === INFINITE_ISLANDS_SCENE || input.islandShapeEnabled;
  const mode: WorldMode = isInfiniteIslands ? "infinite_islands" : "finite";
  const borderCoastEnabled = mode === "finite" && input.borderCoastConfigEnabled;
  return {
    mode,
    configuredWorldPages: input.configuredWorldPages,
    startupWorldPages: input.startupWorldPages,
    configuredWorldCells: input.configuredWorldPages * input.pageCells,
    startupWorldCells: input.startupWorldPages * input.pageCells,
    proceduralWorldRadiusM: mode === "infinite_islands" && input.oceanRim ? input.worldRadiusM : null,
    borderCoastEnabled,
    farOwner: resolveFarOwner(mode, input.searchParams),
  };
}

/** Flat, string/number-only view for cache keys, counters, and the debug overlay. */
export function describeWorldMode(world: WorldModeConfig): Record<string, string | number> {
  return {
    world_mode: world.mode,
    configured_world_pages: world.configuredWorldPages,
    startup_world_pages: world.startupWorldPages,
    configured_world_cells: world.configuredWorldCells,
    startup_world_cells: world.startupWorldCells,
    procedural_world_radius_m: world.proceduralWorldRadiusM ?? 0,
    border_coast_active: world.borderCoastEnabled ? 1 : 0,
    far_owner: world.farOwner,
  };
}
