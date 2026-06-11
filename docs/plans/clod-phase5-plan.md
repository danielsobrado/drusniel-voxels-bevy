# CLOD Pages — Phase 5 Implementation Plan (Bevy integration)

Status: **proposal — awaiting approval before any engine edits.**
Prereq gate: Phase 3 A3 (visual density-scar judgement) must be confirmed by a human.
Inputs validated: Phases 0–4 complete (PoC `tools/clod-poc`, Rust builder `tools/clod-rs`,
all measured gate criteria PASS, builder matches PoC within epsilon).

This plan maps execution-plan §7 (Phase 5) + appendix §11 onto the **actual** engine
symbols (the appendix flagged its own names as `TODO(verify)`; verified below).

---

## 0. The central architectural decision (read first)

The engine already has a complete per-chunk **distance LOD** system, distinct from CLOD pages:

- `LodLevel` (`Lod0..Lod3`, `Culled`) per chunk, `is_lower_detail_than`, `step_size`.
- Cross-LOD **seam stitching** ([`src/voxel/meshing/lod.rs`](../../src/voxel/meshing/lod.rs)),
  **skirts** ([`src/voxel/lod/skirt.rs`](../../src/voxel/lod/skirt.rs)), **boundary strips**
  (`ChunkMeshResult.boundary_strips`), and **GPU geomorph** (`ATTRIBUTE_MORPH_TARGET`,
  `meshing_lod::append_morph_targets`, triplanar `specialize`).
- An MC+Transvoxel seam spike (`mc_transvoxel`, Alt+F5).

CLOD pages **replace per-chunk LOD1–3 extraction at distance** with decimated merged pages,
while the **near field stays on the existing live LOD0 chunk path** (invariant I5). So Phase 5
is not "add pages next to the LOD system" — it is "**pages own the far field; the existing
distance-LOD machinery (skirts/morph/seam/boundary-strips) only runs inside the near-field
bubble**." That is the big behavioural change and the main risk surface.

**Decision required from you (D1):** target end-state for the far field —
- (a) Pages fully own LOD≥1 distance; disable per-chunk LOD1–3 extraction beyond the bubble. (Plan's intent, biggest win, biggest change.)
- (b) Pages render *alongside* existing far chunks behind a feature flag, for A/B + bench, before removing anything. (Recommended first: lower risk, reversible.)

I recommend **(b)** as the Phase 5 landing, with (a) as a follow-up once benches prove pages win.

---

## 1. Prerequisite — build tooling

`.cargo/config.toml` sets `rustc-wrapper = sccache`, but sccache is not installed in this
environment, so the main crate currently can't compile here. Before any Phase 5 code:
install sccache, OR build with `RUSTC_WRAPPER=""` for local iteration (do **not** commit a
config change). Tracking only — you deferred the full fix.

---

## 2. Module placement

Execution plan §6 says `src/terrain/pages/`. But terrain **meshing/LOD** lives under
[`src/voxel/`](../../src/voxel/) (`meshing/`, `lod/`, `runtime/`), and pages are derived from
chunk meshes + selected per frame — a voxel-LOD concern. **Proposal:** put the builder +
runtime at `src/voxel/pages/` (sibling to `lod/`), re-exporting from `src/voxel/mod.rs`.
The pure builder modules are a near-verbatim move of `tools/clod-rs/src/*` (config, weld,
lock, simplify, source_mesh, quadtree, validate, types) minus the synthetic `terrain.rs`,
which is replaced by the real mesher export (step 3).

**Decision (D2):** `src/voxel/pages/` (recommended) vs the literal `src/terrain/pages/`.

---

## 3. Step 1 — main-surface export from the real mesher (§11.1)

Verified data model:
- `ChunkMeshResult.solid: MeshData` ([`data.rs`](../../src/voxel/meshing/data.rs)) holds
  `positions` (base, un-morphed — morph is GPU-only via `morph_targets`/`ATTRIBUTE_MORPH_TARGET`),
  `normals`, `colors: Vec<[f32;4]>` (**= material weights** for Surface Nets), `barycentric_uvs`
  (encode the **section** via `TERRAIN_BARYCENTRIC_SECTION_SCALE`; `section_from_uv` recovers it),
  and `indices`.
- Section tags already exist structurally: `TERRAIN_MESH_SECTION_MAIN=0`, `_HORIZONTAL_SKIRT=1`,
  `_VERTICAL_SKIRT=2`, `_TRANSITION_APRON=3`, plus `TerrainMeshSectionStats`. **Exclusion is
  structural, not heuristic** — satisfies the §11.1 hard rule.

Work:
- Add `extract_main_surface_for_clod(result: &ChunkMeshResult, lod, origin, revision) ->
  Result<TerrainMainSurfaceExport, ClodBuildError>` that keeps only triangles whose section
  (from `barycentric_uvs`) is `MAIN`, copying `positions/normals/colors/indices` and compacting.
- Hard-fail: main range empty while non-main exists; called on non-LOD0; water/blocky path.
- Capture at **commit** time (where `into_mesh` runs, [`commit.rs`](../../src/voxel/meshing/commit.rs))
  from the in-memory `MeshData`, **before** `into_mesh`/morph upload — never from the final `Mesh`.
- **Bench gate (CLAUDE.md):** this is read-only extraction off the frame path, but it touches
  the commit path. Run `--bench` on `visual-regression` + `visual-regression-live-lod`; confirm
  `summary.json` mesher/commit rows unchanged within noise. Gate with `bench_guard`.

## 4. Step 2 — port the builder into the crate

- Move `tools/clod-rs/src/{config,types,weld,lock,simplify,source_mesh,quadtree,validate}.rs`
  to `src/voxel/pages/`. `source_mesh.rs` now consumes `&[TerrainMainSurfaceExport]` (4×4 LOD0
  chunk exports) instead of the synthetic terrain. `simplify.rs` keeps the **byte-stride** fix.
  `lock.rs`/`validate.rs` keep **topological** border detection (both PoC findings).
- Add `meshopt = "0.6"` to the crate `Cargo.toml`. **Bench/compile note:** meshopt builds the C
  lib via `cc` (first build only); confirm no impact on dynamic-linking dev iteration.
- Golden test: `tools/clod-rs` outputs are the reference; an in-crate test feeds the same
  exports and asserts watertight + monotone + reduction within epsilon (matches §6 already done).

## 5. Step 3 — async page builds, off the frame path (I4)

- Reuse `AsyncComputeTaskPool` (pattern in [`runtime/generation.rs`](../../src/voxel/runtime/generation.rs):
  `Task<ChunkGenerationResult>`, `should_poll_*`). A `PageBuildQueue` resource spawns
  `Task<Result<ClodPageNode, ClodBuildError>>`; a poll system commits finished page meshes.
- Page mesh → `Mesh` with `ATTRIBUTE_POSITION/NORMAL`, `ATTRIBUTE_COLOR` (material weights),
  minimal UVs; **no `ATTRIBUTE_MORPH_TARGET`** (triplanar `specialize` already branches on its
  absence — verified). Reuse `MeshMaterial3d(triplanar_material.handle_for_quality(..))`.
- Stale page stays visible until replacement ready (I4). Missing page → fall back to chunks.

## 6. Step 4 — runtime selection system (port `selection.ts`)

- A Bevy system ports `errorPx` (plan §2 formula, viewport height + camera fov/pos) + hysteresis
  + the 2:1 pass. Cut changes flip page entity `Visibility`; crossfade via a triplanar
  alpha-hash/dither param (add a uniform, mirror PoC `material.ts`).
- **Bench gate:** selection runs per frame — must be cheap. Bench `visual-regression-live-lod`
  before/after; watch frame-time + `Render Prepare`/`QueueMeshes` as separate symptoms (do not sum).

## 7. Step 5 — near-field ownership (§11.8) + fallbacks (I5)

- New: `near_field.radius_chunks` (config already has it). Binary per-chunk-footprint owner:
  live chunk **or** page, never both (no overlap band — coplanar z-fight, §11.8/§11.9). Inside
  the bubble the existing LOD0 chunk path owns; outside, pages own. The PoC bubble mask
  (`tools/clod-poc` "near-field bubble", tint-off invisible) is the visual proof this is seamless.
- Fallback: page missing/stale → render covered chunks via existing path (I4/I5).
- No general terrain near-field bubble exists today (only `mc_transvoxel.sandbox_radius_chunks`);
  this is net-new. **Decision (D3):** does the bubble follow the player only, or player+camera?

## 8. Step 6 — colliders

Pages get no colliders; collider stays inside the near-field bubble (existing player capsule
collider radius, [`gameplay/player/controller.rs`](../../src/gameplay/player/controller.rs)).
Verify collider radius ≤ `radius_chunks`.

## 9. Phase 6 preview (not in this plan)

Edit invalidation hooks into [`meshing/invalidation.rs`](../../src/voxel/meshing/invalidation.rs)
(surgical 1-voxel-halo dirty propagation already exists): a voxel edit dirties the owning LOD0
page + ancestors (≤ `quadtree_levels`); rebuild LOD0 first, ancestors lazily; debounce per page.

---

## 10. Risks

1. **Behavioural:** pages supersede the mature skirt/morph/seam/boundary-strip far-field LOD —
   regressions hide in seams at the bubble edge and at page borders. Mitigate with feature flag
   (D1-b) + the existing terrain debug overlays (Alt+F7 wire, Alt+F8 normals, Alt+F10 hole probe).
2. **Perf (CLAUDE.md):** every step that touches mesher/commit/selection/render must ship
   before/after `summary.json` from the named bench scenes + `bench_guard`. No unbenched claims.
3. **Build:** sccache missing here; meshopt C build via `cc`.
4. **Geomorph interaction:** near-field chunks still morph; pages don't. The bubble transition
   must be a hard ownership switch, not a fade of co-planar geometry (§11.8).
5. **Memory:** page meshes are extra GPU buffers alongside chunk meshes during crossfade.

## 11. Proposed order (each step lands + benches before the next)

```
Step1 export (+bench) -> Step2 builder port (+golden test) -> Step3 async build+commit
  -> Step4 selection (+bench) -> Step5 near-field ownership (+bench) -> Step6 colliders
  -> [gate: bench wins vs far chunks] -> D1-a removal of far per-chunk LOD (optional follow-up)
```

## 12. Decisions needed before I start coding

- **D1** far-field end-state: (a) pages replace LOD1–3 / (b) flagged side-by-side first [rec].
- **D2** module path: `src/voxel/pages/` [rec] vs `src/terrain/pages/`.
- **D3** near-field bubble follows: player only vs player+camera.
- **D4** land target: feature-flagged + benched, default off, until A/B proves it [rec].
