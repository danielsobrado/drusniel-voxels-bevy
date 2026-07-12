# Continent Phase 1 — Canonical World Contract

Parent: `continent-plan-overview-2026-07-12.md`

## Goal

Introduce the identity and interface layer — `WorldManifest`, `WorldTileKey`,
`HeightfieldSampler` — **without changing any runtime behavior, geometry byte, or cache hash**.
After this phase every consumer that samples terrain height does it through one named interface,
and every world-shaped system (heightfield, hydrology, far summary, save regions) shares one
tile-coordinate vocabulary.

## Non-goals

No new tile generation, no persistence, no authority change, no GPU changes. The procedural
field stays the sole authority; the startup raster stays the only cache.

## Current code this builds on (verified 2026-07-12)

| Concern | Today | Anchor |
| --- | --- | --- |
| Height sampling entry | `surfaceHeight()` = module-global override else `baseSurfaceHeight()` | `src/terrain/terrain_surface.ts:212,267` |
| Override installers | startup raster sampler, unified-hydrology cascade (`setTerrainSurfaceOverride`) | `src/app/bootstrap/world_build_startup.ts:465-498` |
| World identity | `WorldModeConfig` (mode, configured/startup pages+cells, procedural radius) | `src/app/world_mode.ts:20-36` |
| Cache identity | `TerrainSourceInputs` → `computeTerrainSourceHash`, `TERRAIN_SOURCE_VERSION="world-modes-v6"` | `src/cache/terrainSource.ts:23,85-203` |
| Tile keying, 3 dialects | hydrology `(tileX, tileZ)` 256 m; far summary `FarSummaryTileKey{ring,x,z,cellSizeM}`; save `regionKeyForWorld` 512 m | `src/water/hydrologyTileSource.ts`, `src/far-summary/tile-key.ts`, `src/save/region_key.ts` |
| WorldSource | `ProceduralWorldSource` (field + `BiomeRegionField`); `StreamedVoxelWorldSource` stub throws | `src/world_source/world_source.ts:59,113` |
| Startup raster sampler | `makeStartupHeightfieldSampler` + `StartupHeightfieldDescriptor` in cache key | `src/terrain/startup_heightfield_raster.ts` |

## Design

### `HeightfieldSampler` (new, `src/world/heightfield_sampler.ts`)

```ts
export interface HeightfieldSampler {
  /** Exact value contract: integer (x,z) inside domain -> stored/derived lattice sample. */
  sampleHeight(x: number, z: number): number;
  /** Half-open world-space domain this sampler answers authoritatively; null = unbounded. */
  readonly domain: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
  /** Monotonic content identity for cache keys / GPU re-upload decisions. */
  readonly sourceRevision: number;
  readonly kind: "procedural" | "startup_raster" | "heightfield_tiles";
}
```

Semantics documented in the file, copied from the raster contract that already works:
integer-lattice reads may be cached; fractional reads must be delegated to the canonical field
(no bilinear reconstruction — that is the world-modes-v6 lesson, `terrainSource.ts:18-22`).

The existing chain becomes a named composition instead of anonymous closures:

```text
sample order (unchanged behavior):
  1. startup raster sampler          (inside padded startup domain, integer lattice)
  2. procedural field                (everything else)
```

### `WorldTileKey` (new, `src/world/tile_key.ts`)

One integer-tile keying module for 256 m tiles: `worldToTile`, `tileOriginM`, `tileKeyString`
(`"T:x,z"`), plus explicit adapters `toHydrologyTileCoord`, `toSaveRegionKey` (2×2 tiles),
`clodPagesForTile` (4×4 L0 pages). Floor-division semantics must match
`src/water/hydrologyTileSource.ts` exactly for negative coordinates — locked by test.

Existing modules are **not** rewritten to use it in this phase (surgical-change rule); they gain
adapter tests proving the mappings agree, and Phases 2–4 consume the new module for new code.

### `WorldManifest` (new, `src/world/world_manifest.ts`)

```ts
export interface WorldManifest {
  worldId: string;                  // save identity or "ephemeral:<seed>"
  seed: number;
  generatorVersion: string;         // TERRAIN_SOURCE_VERSION
  terrainSourceHash: string;        // computeTerrainSourceHash(...) of the boot inputs
  mode: WorldMode;                  // from WorldModeConfig
  sizeM: { x: number; z: number } | null;   // continent bound; null = unbounded (today)
  seaLevelM: number;
  startupWorld: { pages: number; cells: number };
  artifacts: {                      // Phase 3+ fills these; empty today
    hydrologyGraph?: { id: string; hash: string };
    macroFields?: { id: string; hash: string };
  };
}
```

Built once in startup from values that already exist (`WorldModeConfig`, resolved terrain field
config, water config, terrain-source hash). It is **descriptive** in this phase: nothing consumes
it for behavior yet; it is exposed for diagnostics and becomes load-bearing in Phase 2
(persistence key) and Phase 6 (save pinning).

## Commit sequence

### C1.1 — `HeightfieldSampler` interface + adapters (no behavior change)

- New `src/world/heightfield_sampler.ts` with the interface, a `proceduralHeightfieldSampler()`
  adapter over `baseSurfaceHeight`, and `startupRasterHeightfieldSampler(raster)` wrapping
  `makeStartupHeightfieldSampler`.
- `world_build_startup.ts:494-498` installs the raster through the new wrapper; the installed
  function is behaviorally identical (same closure logic), so cached page geometry and the
  terrain-source hash are untouched.
- Tests: new `heightfield_sampler.test.ts` — integer-lattice bit-parity with
  `baseSurfaceHeight` inside/outside the raster domain for multiple seeds (mirror the cases in
  `startup_heightfield_raster.test.ts` and `startup_heightfield_gpu_parity.test.ts`).
- Verify: typecheck, targeted vitest, then a warm-cache boot (`perf:heightfield-raster` harness,
  worlds 4,8) showing `startup.build_world_ms` and cache-hit behavior unchanged.

### C1.2 — `WorldTileKey` module + cross-system adapter tests

- New `src/world/tile_key.ts` as designed above.
- Tests: negative-coordinate floor parity vs hydrology tile coords; 2×2→save-region adapter vs
  `region_key.ts` for a boundary sweep; 4×4→CLOD page adapter vs
  `streamingClodPageKey`/`parseStreamingClodPageKey` (`clod_streaming_roots.ts:483,492`).
- No production call sites change.

### C1.3 — `WorldManifest` builder + diagnostics exposure

- New `src/world/world_manifest.ts` with `buildWorldManifest(...)` taking `WorldModeConfig`,
  terrain field config, sea level, and the already-computed terrain-source hash (async hash flows
  through the same path that computes it today — do not hash twice; pass the value).
- `world_build_startup.ts` builds it after the terrain-source hash is known and:
  - stores it on the startup result (typed field, no globals),
  - mirrors scalars into startup timings/counters: `world_manifest_present=1`,
    `world_manifest_seed`, plus the existing `describeWorldMode` fields it overlaps with,
  - exposes it read-only at `window.__drusnielClod.diag.worldManifest` for the shot/acceptance
    harnesses.
- Tests: manifest is a pure function of inputs (same inputs → deep-equal manifest); hash field
  matches `computeTerrainSourceHash` fixture from `terrainSource` tests.

### C1.4 — Thread the manifest, delete ad-hoc identity plumbing where safe

- Pass the manifest (not loose seed/world params) into the places that currently re-derive
  identity for **new-code seams only**: the streamed-roots controller deps and the worker `build`
  request already carry what they need — do not churn them; instead add the manifest to
  `ClodWorkerClient` boot payload as an opaque field so Phase 2 worker requests can key tile
  builds without new plumbing.
- Grep-audit (`describeWorldMode`, `worldSeed`, `generatorVersion`) to confirm no duplicate
  identity is being constructed differently anywhere; fix only true drift, list findings in the
  commit message.
- Verify: full vitest + build; acceptance `--reuse` run — every existing gate green, new counter
  present.

### C1.5 — Documentation + acceptance counter gate

- Update `docs/rendering/startup-heightfield-raster-2026-07-12.md` (runtime wiring section) to
  name the sampler interface; add `world_manifest_present` to `REQUIRED_COUNTERS` with rule
  `=== 1` in `tools/infinite_acceptance/thresholds.ts` (+ its two tests, per the established
  update pattern).
- This is the phase's only acceptance change; nothing is weakened.

## Performance budget

Phase 1 must be **zero-cost**: no new per-frame work, one manifest build at startup (< 1 ms).
Gate: `perf:main --world 8 --case current-textured` baseline vs after — `frameMs` p50/p95 within
noise; `startup.build_world_ms` within noise of the pre-phase baseline recorded in Evidence.

## Risks

- *Accidental hash change* (worst case: silently invalidates every cached world). Mitigation:
  C1.1/C1.3 add a fixture test asserting the exact terrain-source hash for a pinned input set
  before and after the refactor.
- *Interface too narrow for Phase 2* (needs normals/materials later). Accepted: extend then;
  do not speculatively add channels now (simplicity-first rule).

## Evidence (fill before merging final commit)

- [ ] typecheck / vitest / build results
- [ ] perf:main baseline vs after (frameMs p50/p95, renderMs p95)
- [ ] perf:heightfield-raster worlds 4,8 (build ms, raster ms, cache hit)
- [ ] acceptance --reuse report path + gate summary
