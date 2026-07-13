# Continent Plan — Overview and Verdict

Target: **a large, bounded, streamed continent whose macro terrain is a canonical, versioned
heightfield, with voxels used for nearby editable terrain, caves, overhangs and construction.**
Not genuinely infinite islands.

This is the umbrella document. Phase details live in:

| Phase | Document | Status (2026-07-12) |
| --- | --- | --- |
| 1. Canonical world contract | `continent-phase-1-canonical-contract-2026-07-12.md` | IN PROGRESS |
| 2. Streamed heightfield tiles | `continent-phase-2-heightfield-tiles-2026-07-12.md` | not started |
| 3. Continental hydrology | `continent-phase-3-continental-hydrology-2026-07-12.md` | not started |
| 4. Unified world summary | `continent-phase-4-unified-world-summary-2026-07-12.md` | not started |
| 5. Voxel overlay and complex regions | `continent-phase-5-voxel-overlay-2026-07-12.md` | not started |
| 6. RPG features and persistence | `continent-phase-6-rpg-persistence-2026-07-12.md` | not started |

Each phase document carries a `## Status` section (per-commit checklist + next action) that is
updated **immediately after every commit-sized chunk of implementation**, so an interrupted
session loses nothing. Resume by reading the phase doc's Status section first.

## Verdict on the proposal

The proposal is **accepted with corrections**. The architecture (generator → versioned tiles →
persistent deltas as the authority progression; startup raster as a spawn cache; global-first
hydrology; one summary authority for far terrain/water/canopy; voxels as an overlay) is right and
matches where the code is already heading. Several of its factual claims about the current code
are out of date, and two phases are much further along than it assumes.

### Where the proposal is confirmed by the code

- **Startup raster is a spawn cache, not a world format.** It is integer-lattice-only, f64,
  16 MiB / 2,097,152-sample budgeted, disabled at ≥32 startup pages, and keyed into
  `TERRAIN_SOURCE_VERSION = "world-modes-v6"` (`src/terrain/startup_heightfield_raster.ts`,
  `src/cache/terrainSource.ts:23`, `src/app/bootstrap/world_build_startup.ts:486-498`). Growing it
  to a continent is impossible by design. Correct call.
- **GPU streamed roots re-evaluate procedural WGSL and do not sample the raster** (documented
  contract in `docs/rendering/startup-heightfield-raster-2026-07-12.md`; parity locked by
  `startup_heightfield_gpu_parity.test.ts`). The proposal's "once carve/stamps exist, the GPU
  mesher must sample uploaded tiles" is the correct future consequence — see Phase 3.
- **Unified hydrology intentionally leaves terrain uncarved.** `buildUnifiedStartupGrid` sets
  `carvedBed === originalBed`; rivers are per-basin traced channels (768 m basin lattice, memoized
  polylines, `src/water/infinite_hydrology.ts`), not a drainage network. There is no global
  watershed/accumulation graph. The "global first, local second" critique is valid and is the
  core of Phase 3.
- **Canopy far shell is rebuild-on-revision.** `canopy_system.ts:227` (`rebuildShell`) disposes and
  rebuilds the impostor shell whenever the texture-set revision changes, and
  `updateFarCanopyShellTextures` (`src/gpu/far_canopy_shell.ts:294-299`) is a no-op that only
  records the revision. `buildCanopyTextureSet` allocates four fresh `DataTexture`s per build.
  The proposal's "persistent geometry + incremental texture updates" is the right fix — Phase 4.

### Where the proposal is out of date or needs correction

1. **Far-summary GPU builds already exist.** `src/far-summary/gpu-runtime.ts` +
   `gpu-builder/gpu-planner/gpu-records/gpu-parity` implement a GPU tile build path behind query
   params, including an `authoritative` mode that suppresses CPU builds
   (`src/far-summary/integration.ts:114-192`). "Tile builds remain CPU-side" is stale. Phase 4
   promotes and finishes this path instead of re-creating it.
2. **Phase 6 is not greenfield.** `src/save/save_schema.ts` already defines a v1 save contract:
   `SaveWorldManifest` (worldId, seed, proceduralProfile, 512 m regions, 16 m chunks), binary
   voxel deltas, `SavedPropInstance` with `active|hidden|destroyed` states and city/road/
   critical-path references, and `WorldMetadataRecord` with **cities, districts, roads, cave
   entrances, cave systems and critical paths**, plus an edit→far-summary invalidation bridge
   (`src/save/save_far_summary_bridge.ts`) and `critical_path_validation.ts`. Phase 6 is wiring,
   migration and authoring on top of this, not a new design.
3. **World identity already distinguishes the sizes the proposal worries about.**
   `WorldModeConfig` (`src/app/world_mode.ts`) separates configured domain vs startup bootstrap
   window vs `proceduralWorldRadiusM` (ocean-rim island bound), and `WorldSourceMetadata.bounds`
   supports `"infinite" | { radiusM }`. A finite continent is therefore a **policy cap on
   unbounded-capable streaming**, not a rewrite: keep every tile system keyed by unbounded integer
   coordinates and clamp the *required set* at the continent boundary (ocean beyond). Do not
   introduce a second "finite world" code path — that mistake already happened once with the
   border coast (see the comment block in `world_mode.ts:1-10`).
4. **The streamed CLOD root layer is done and hardened, not "40% done".** Worker-built L0/L1
   roots with build/apply budgets, a sliced `prepareNodeForApply` residency gate, root-switch
   hysteresis, crossfade transitions, safety coverage, eviction and movement probes are live
   (`src/terrain/streaming/clod_streaming_roots.ts`, wired in
   `src/app/bootstrap/ui/frame_loop_startup.ts`). Phases 2–3 must **reuse this scheduler**, not
   build a parallel one.
5. **Grid sizes should snap to what exists.** Proposal table vs current code: terrain chunk 16 m ✓
   (`chunk_size: 16`), CLOD page 64 m ✓ (`chunks_per_page: 4`), hydrology tile 256 m ✓
   (`water.yaml hydrology.infinite.tile_size_m: 256`), save region 512 m ✓
   (`SAVE_REGION_SIZE_M`). The canonical surface tile should be **256 m** so one surface tile =
   4×4 CLOD pages = 1 hydrology tile = ¼ save region. No new grid constants.
6. **"One-time global generation" needs a residency story, not just a size.** 32 768 m at 16 m
   spacing is 2049² ≈ 4.2 M cells. Height (f32) + flow dir (u8) + accumulation (f32) +
   basin/body id (u32) ≈ 55 MB peak in the generation worker — feasible in-browser, but it must
   run in a worker, be chunk-checkpointed, and persist its outputs; it must never run on the
   frame path or during ordinary startup. Phase 3 specifies this.

### Sizing decisions (locked for this plan)

| Layer | Value | Rationale |
| --- | --- | --- |
| Continent | 32 768 × 32 768 m, sea beyond | proposal accepted; `WorldManifest.size_m` |
| Canonical surface tile | 256 m, 257×257 samples at 1 m | aligns hydrology tile + 4×4 CLOD pages |
| Surface tile height storage | f64 in Phase 2 (parity cache), f32 once tiles become authority (Phase 3) | see Phase 2 open decision |
| Macro/drainage grid | 16 m (2049² for 32 km) | proposal accepted |
| Generation halo | 32 m (2 chunks) | matches existing `halo_chunks` semantics |
| Near voxel bubble | keep current 96 m (`radius_chunks: 6`), grow later if gameplay needs it | perf-gated, not architecture |
| CLOD middle field | bubble edge → far-clipmap inner (config-driven) | unchanged |
| Far summary rings | keep 1536–16 384 m, 32/64/128 m cells | already implemented |
| Save region | 512 m (unchanged) | existing save schema v1 |

## Authority model (the most important decision)

```text
During world creation:   procedural generator + global passes are authoritative
After world creation:    versioned generated tiles (manifest-pinned) are authoritative
During gameplay:         generated tiles + persistent deltas are authoritative
```

Concretely, in this codebase:

- The **manifest is a pinned identity, and tiles are re-derivable caches under that identity.**
  Everything already hashes through `computeTerrainSourceHash` (`src/cache/terrainSource.ts`);
  the `WorldManifest` (Phase 1) wraps that hash plus generator version and global-pass artifact
  references. A save pins its manifest; upgrading the generator changes the hash and therefore
  **cannot silently alter an existing world** — the old world keeps generating with its pinned
  inputs, or is explicitly migrated (Phase 6).
- The switch of runtime authority from "procedural field evaluated everywhere" to "canonical
  tiles" happens exactly once, at Phase 3 C3.4/C3.5, when carve/stamps make tiles diverge from
  the raw field. Until then tiles are bit-exact caches and every existing parity test keeps
  passing. This sequencing is what keeps CPU terrain, GPU terrain, props, water and colliders
  agreeing at every intermediate commit.

## Rendering ownership (unchanged invariants)

```text
0–96 m       live voxel Surface Nets bubble (colliders, digging, caves)
96 m–2 km    streamed CLOD pages (worker-built, derived caches, stale-until-replaced)
1.5–16 km    far summary clipmap → far terrain clipmap renderer, water far field, canopy shell
```

Invariants that no phase may break (they are enforced by existing tests/acceptance):

- Page/tile builds never run on the frame path; apply is separately budgeted
  (`clod_streaming_roots.ts` apply/prepare budgets; `frame_ms_p95 <= 8` acceptance gate,
  `tools/infinite_acceptance/thresholds.ts:262`).
- Exactly one renderer owns a terrain footprint; water ownership oracle stays green
  (`npm run water:ownership`).
- Stale data stays visible until the replacement is resident (streamed roots ready queue,
  far-summary stale states, water clipmap).
- Deterministic world-coordinate seeding only; identical inputs → bit-identical tiles
  (hydrology `evictionMaxDelta === 0` pattern extends to heightfield tiles).
- Never weaken an acceptance gate to make a phase land.

## Performance protocol (every phase, before merge)

```powershell
npm --prefix tools/clod-poc run typecheck        # rtk OK
npm --prefix tools/clod-poc test                 # NO rtk
npm --prefix tools/clod-poc run build            # NO rtk
# dev server for harnesses:
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Then, depending on what the phase touches:

- **Frame time (always):** `perf:main --world 8 --warmup 120 --frames 300 --case current-textured`
  baseline vs change; report `frameMs` p50/p95, `renderMs` p95, top phase bucket. WebGPU compute
  changes use `--warmup 600`.
- **Streaming/movement (Phases 2, 3, 5):** the perf:move mini-run profile plus
  `npm --prefix tools/clod-poc run accept:infinite-islands -- --reuse`; movement probe counters
  (`live_clod_stream_*`, apply ms, stale discards) must stay inside existing gates.
- **Startup (Phases 1–3):** `perf:heightfield-raster` harness numbers; `startup.build_world_ms`
  cold at world=8 must stay within 10% of the current ~5.3 s, and warm cache-hit path unchanged.
- **Visual (Phases 3–5):** shot harness batteries with stats JSON; hydrology validators
  (`water:hydrology`, `water:seam`, `water:streaming`, `water:ownership`).

Each phase document has an **Evidence** section to fill with the actual numbers before the final
phase commit merges. A phase without recorded numbers is not done.

## Feature-flag and cache-identity policy

- Every behavioral phase lands behind a query param + YAML default-off, soaks, then flips the
  default in its final commit (the `unified_startup` pattern from `config/water.yaml`).
- Any commit that changes geometry-affecting inputs bumps `TERRAIN_SOURCE_VERSION` and documents
  the bump in `src/cache/terrainSource.ts`'s version comment block (v2–v6 precedent).
- New counters are added to `REQUIRED_COUNTERS` with real gates, never `>= 0` theater
  (per `docs/plans/infinite-islands-clod-root-streaming-handoff.md` finding 3).

## What to borrow from the fable5-world-demo reference (and what not to)

Borrow: macro heightfield synthesis staging, erosion/drainage/carve pipeline order, biome
splatting, far-detail synthesis, camera-following water, GPU vegetation + impostors, strict
screenshot/perf QA. Do **not** copy: whole-world generation at boot, one monolithic world texture
as runtime authority, all vegetation resident, terrain-is-only-a-heightfield assumptions, or
coupling RPG state to procedural scatter. The clod-poc already diverges correctly on all of these.

## Bevy port note

`docs/architecture/bevy-world-source-port.md` defines the contract-first port ladder and the
non-negotiable GPU rule (no second CPU-only truth). Phases 1–2 deliberately shape their contracts
(`WorldManifest`, `WorldTileKey`, `HeightfieldSampler`, tile lifecycle) so they port as data
structures + pure functions. Porting itself stays out of scope for these phases.
