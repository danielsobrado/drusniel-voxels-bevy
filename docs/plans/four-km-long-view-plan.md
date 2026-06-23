# 4 km Long-View Plan — Fable5 Techniques for Drusniel

> Created: 2026-06-22 · Status: Planning
> Goal: push **visible terrain + forest to ~4 km** without regressing the v0.5
> performance sweep or breaking editable voxel terrain.
> Reference donor: [`docs/reference/fable5-world-demo`](../reference/fable5-world-demo)
> (Claude Fable 5's three.js/WebGPU world demo — **technique reference only, not a
> renderer transplant**).

This is the **orchestration plan**. It sequences seven stages (LV-0 … LV-6). Three of
them delegate to existing plans; four are new and fully specified here. Each stage ends
with a **copy-paste implementation prompt** for another AI to execute that stage in
isolation.

---

## 0. The one decision that governs everything

```text
DO NOT extend live chunks / cull distance to 4 km.
DO extend the world with derived layers: CLOD pages + far shell + shadow/canopy proxies.
Use Fable5 as a LONG-VIEW ARCHITECTURE reference, not a renderer transplant.
```

Drusniel v0.5 deliberately tightened terrain (~320 m), high-detail terrain (~128 m),
grass (~128 m), reflections (~150 m) and cascades (~256 m) for frame time. The current
terrain distance lives at [`src/voxel/terrain/mod.rs:438`](../../src/voxel/terrain/mod.rs#L438).
Raising those numbers directly undoes the whole sweep. The 4 km view must come from
**cheap derived layers**, each paying far-cost only where it is cheap.

### Representation firewall (inherited guardrail — do not violate)

From [`laas-cdlod-far-field-reference-plan.md`](laas-cdlod-far-field-reference-plan.md)
Guardrail **G0**: a heightfield (`y = f(x,z)`) representation may own a footprint **only**
if it is (a) never editable at interactive rates and (b) acceptably single-valued at the
viewing distance. That is the outer far field (LV-2 shell) and proxies (LV-3/LV-4) — never
the near editable terrain.

### CLOD invariants (inherited — do not violate)

From [`clod-execution-plan.md` §0](../plans_completed/clod-execution-plan.md):

```text
I1. VoxelWorld stays authoritative. Pages/shells/proxies are derived caches.
I2. Lower page LODs are NEVER re-extracted from voxels (decimate merged child meshes).
I3. Page borders are locked during simplification.
I4. Derived builds NEVER run on the frame path. Stale stays visible; missing -> fallback.
I5. Near field (player bubble) stays live Surface Nets LOD0.
```

The far shell (LV-2) and proxies (LV-3/LV-4) are **new derived layers** that obey the same
spirit: built off-frame, no colliders, no edit authority, stale-tolerant.

---

## 0.5 Current CLOD code — ground truth (read before touching any stage)

CLOD pages are **already implemented and landed** (Phase 5 complete, default-off behind
`CLOD_PAGES=1`). The code is at [`src/voxel/pages/`](../../src/voxel/pages/) — **not**
`src/terrain/pages/` (the completed plan proposed that path; reality differs). Before
adding any far layer, reuse what is already there. The relevant facts:

**Page build/commit pipeline** ([`mod.rs`](../../src/voxel/pages/mod.rs),
[`plugin.rs`](../../src/voxel/pages/plugin.rs)): `clod_pages_source_meshing_system`
(main-thread throttled LOD0 capture) → `clod_pages_build_queue_system` /
`build_task_poll_system` (async compute pool: weld → lock → simplify → quadtree) →
`clod_page_mesh_commit_system` (spawns hidden mesh entities) →
`clod_page_selection_system` (per-frame DAG cut) → `clod_page_chunk_ownership_system`
(binary live-chunk vs page handover). All heavy work is already off the frame path (I4).

**Border locking finding (supersedes the completed plan):** borders are locked by **open
topological boundary**, NOT by footprint plane — Surface Nets vertices sit *inside* cells,
so page borders are non-planar (see [`mod.rs:8-11`](../../src/voxel/pages/mod.rs#L8)). Any
new doc text must use this language.

**Reusable assets the far layers should build on (do NOT reinvent):**

| Existing thing | Where | Reuse for |
|---|---|---|
| `ClodPageMeshBounds { min_y, max_y }` per node | [`render.rs:26`](../../src/voxel/pages/render.rs#L26) | **Per-page height envelope** → source for the shared terrain summary (LV-2/3/4) |
| `ClodPageSelectionIndex` (per-node center/radius/error) | [`selection.rs:48`](../../src/voxel/pages/selection.rs#L48) | Coarse outer-ring height + which pages are the far boundary |
| Pages spawn `NotShadowCaster` | [`render.rs:209`](../../src/voxel/pages/render.rs#L209) | LV-3 premise already true — only live chunks cast today; proxy is additive |
| `clod_page_dither` + `clod_fade` uniform, `AlphaMode::Mask` | [`render.rs:128`](../../src/voxel/pages/render.rs#L128), [`triplanar.rs:273`](../../src/rendering/materials/triplanar.rs#L273) | LV-2 shell↔page and LV-4 canopy fade — reuse this dither, don't add a new one |
| `TerrainMaterialQuality::{FullTriplanar, CheapTriplanar, SingleProjectionFar, HorizonProxy}` + handles + WGSL `shader_defs` | [`triplanar.rs:199`](../../src/rendering/materials/triplanar.rs#L199), [`triplanar.rs:296`](../../src/rendering/materials/triplanar.rs#L296) | LV-6 is **wiring + baking**, not inventing modes; **`HorizonProxy` IS the far-shell material** |
| `live_chunk_hidden_by_clod` "page_covers else keep live chunk to avoid bare horizon/water bands" | [`ownership.rs:118`](../../src/voxel/pages/ownership.rs#L118) | LV-2 seam: the far shell fills the band **beyond** page coverage |
| `ClodPagesConfig` (serde from `config/clod_pages.yaml`, compile-time embedded) | [`config.rs`](../../src/voxel/pages/config.rs) | Add far-layer config alongside, same pattern |

**Architectural consequence — one shared summary, three consumers.** The far shell (LV-2),
shadow proxy (LV-3), and canopy base height (LV-4) all need the same thing: a coarse
height field of the terrain at distance. That field **already exists in fragments** as the
per-page `ClodPageMeshBounds`. So instead of three new samplers (or worse, voxel
extraction at 4 km), build **one** `TerrainSummaryField` resource from the page envelope
and feed all three layers from it. This is the central architecture improvement over the
first draft of this plan.

---

## 1. Target architecture — four terrain rings + two proxy layers

| Ring | Distance | Owner | Representation |
|---|---:|---|---|
| **A. Editable near field** | 0–128/192 m | live chunks | Surface Nets LOD0, full material, colliders, edits, near shadows |
| **B. Transition field** | ~128–384 m | low chunk LOD | cheaper triplanar, no heavy shadows |
| **C. CLOD pages** | ~256 m–2 km | derived page meshes | meshopt-decimated quadtree, no colliders, stale OK |
| **D. Far vista shell** | ~1.8–4 km | terrain summary | cheap macro mesh, analytic/baked normals, no collision/edit |
| Proxy 1: **terrain shadow proxy** | ~128–3200 m | 512² macro grid | cast-only, vertex shader lift, no color/depth write |
| Proxy 2: **forest canopy shell** | ~600 m–4 km | 512² coverage grid | lit aggregate foliage surface, dithers in past impostors |

**Shared source:** rings D + both proxies read one `TerrainSummaryField` (coarse height +
coverage), assembled off-frame from the existing per-page `ClodPageMeshBounds` envelope
(see §0.5). No layer below the live bubble ever re-extracts voxels.

Vegetation distance ladder (LV-4/LV-5):

```text
0–64 m     real trees / high LOD mesh
64–180 m   lower mesh / billboard
180–650 m  axial billboards / octahedral impostors
600–4096 m canopy shell (forest mass) + sparse impostor silhouettes
```

---

## 2. What we copy vs. what we do NOT

**Copy (conceptually):** far vista shell, height-range/relief split bias, coarse terrain
shadow proxy, canopy shell + impostors, GPU instance culling + indirect draws, baked far
material.

**Do NOT copy directly:**
1. Heightfield-only CDLOD as the *main* terrain renderer (Drusniel has caves/overhangs/edits → Surface Nets). Fable5 `mat.positionNode = vec3(x, h, z)` is single-valued; our pages are decimated real voxel meshes.
2. Full far terrain shadows through normal CSM (kills texel density) → use LV-3 proxy.
3. Far grass as real blades → near only; far = material response / shell.
4. Far water reflections to 4 km → reflections stay capped (~150 m); far water = cheap shading.
5. Fable5 constants as engine constants (`WORLD_SIZE=4096`, `FAR_RADIUS=14000` in [`WorldConst.ts`](../reference/fable5-world-demo/src/world/WorldConst.ts)) → use Drusniel config rings + streaming, target only.

---

## 3. Master config (single source of truth)

Create `assets/config/long_view.yaml`. Every stage reads from it; do not scatter magic numbers.

```yaml
# assets/config/long_view.yaml
view_distance:
  target_visible_m: 4096          # goal, not a cull radius

terrain_rings:
  live_chunk_high_m: 128
  live_chunk_low_m:  384
  clod_pages_start_m: 256
  clod_pages_end_m:   2048
  far_shell_start_m:  1800
  far_shell_end_m:    4096

# Shared coarse height/coverage field — assembled off-frame from existing per-page
# ClodPageMeshBounds (§0.5). Consumed by far_shell, shadow_proxy, canopy_shell.
terrain_summary:
  grid: 512                       # NxN cells over the summarized footprint
  source: page_envelope           # page_envelope | naadf_summary  (NEVER voxel_extract)
  rebuild_debounce_ms: 250        # coalesce page-tree revisions before re-summarizing

far_shell:
  cell_size_m: 64
  normal_sample_step_m: 32
  material_quality: horizon_proxy  # EXISTING TerrainMaterialQuality::HorizonProxy variant
  cast_shadows: false
  receive_fog: true
  edge_blend_m: 256               # blend shell into outermost CLOD pages (reuse clod dither)

shadow_proxy:
  enabled: true
  start_m: 128
  end_m:   3200
  grid: 512
  cell_size_m: 8                  # Fable5 ShadowProxy quad size
  cast_only: true
  contact_shadows_max_m: 48

canopy_shell:
  enabled: true
  start_m: 600
  end_m:   4096
  grid: 512
  fade_in_m: 620                  # Fable5 CanopyShell FADE_IN
  fade_band_m: 90                 # Fable5 CanopyShell FADE_BAND
  height_lift_m: [8, 20]
  shadow_proxy: true

vegetation:
  trees: { mesh_lod0_m: 32, mesh_lod1_m: 96, billboard_m: 220, impostor_end_m: 650 }

terrain_material_lod:
  near_m: 128
  cheap_triplanar_m: 384
  single_projection_far_m: 1024
  far_shell_baked_m: 2048
```

---

## 4. Stage dependency graph

```text
LV-0  long-view bench harness          (prereq for ALL — gates every stage)
  │
  ├── LV-1  CLOD pages 256 m–2 km       (pages already landed; here = wire ring + relief bias)
  │     │
  │     └── LV-1b  TerrainSummaryField   (one coarse height/coverage field from page envelope)
  │           │                           SHARED dependency of LV-2/LV-3/LV-4
  │           ├── LV-2  far terrain shell 2–4 km     (uses summary + existing HorizonProxy mat)
  │           │     └── LV-6  far material bake       (bakes inputs for HorizonProxy/SingleProj.)
  │           ├── LV-3  far terrain shadow proxy      (pages already NotShadowCaster; additive)
  │           └── LV-4  far forest canopy shell        (+ canopy coverage from persisted props)
  │
  └── LV-5  GPU vegetation cull + indirect   (delegates: bevy-gpu-vegetation-port-plan
                                               + bevy-per-cascade-shadow-caster-culling-plan)
```

Hard rule: **no stage merges without a before/after LV-0 bench run** (CLAUDE.md perf
discipline). Visual benches run on native Windows, never WSL.

Priority order if shipping incrementally:
LV-0 → LV-1 → **LV-1b** → LV-2 → LV-3 → LV-4 → LV-5 → LV-6.

---

## LV-0 — Long-view benchmark harness (prerequisite)

**Goal:** deterministic benches that *measure* the 4 km view before any rendering change,
so every later stage has a before/after. No rendering change in this stage.

**Why first:** CLAUDE.md requires `summary.json` before/after for any frame-time-affecting
change. The existing bench scenes top out far short of 4 km; we need long-view scenes and
new counters (page count by LOD, far-shell tris, stale fallback count, horizon holes).

**Tasks**
- Add bench scenes mirroring the existing format in `bench/scenes/visual/`:
  - `bench/scenes/long-view-4km.toml` — camera at altitude looking to horizon, fixed pose.
  - `bench/scenes/long-view-forest-4km.toml` — over a forested basin.
  - `bench/scenes/long-view-edit-stress.toml` — long view + scripted edits near camera (exercises stale-page fallback later).
- Extend the bench summary writer to record: terrain draw calls, terrain triangles, shadow-pass triangles, GPU frame p50/p95, CLOD page count by LOD, far-shell triangles, far-shell GPU ms, visible-hole/seam count (reuse the wireframe/hole-probe checkpoints), page stale-fallback count.
- Add `bench_guard` thresholds for the new scenes in [`assets/config/bench_guard.toml`](../../assets/config/bench_guard.toml); document the machine.
- Wire deterministic screenshot checkpoints at the fixed poses (per CLAUDE.md visual-stability rule).

**Files:** `bench/scenes/long-view-*.toml`, bench summary writer (under `src/diagnostics/bench/`), `assets/config/bench_guard.toml`.

**Acceptance**
```text
- `cargo run --release -- --bench bench/scenes/long-view-4km.toml` produces summary.json
  with the new counters populated (even if some are zero today).
- `cargo run --bin bench_guard -- bench-runs/<run>/summary.json` runs clean on baseline.
- Screenshots are byte-stable across two runs of the same scene (deterministic).
- Documented: this is the baseline all LV-1..6 stages diff against.
```

> **Implementation prompt — LV-0**
>
> You are extending the Drusniel bench harness to measure a 4 km long view *before* any
> renderer change. Do not modify rendering. Read CLAUDE.md ("Performance Expectations") and
> mirror the existing scenes in `bench/scenes/visual/` (e.g. `visual-regression.toml`) and
> the summary writer in `src/diagnostics/bench/`.
> 1. Create three deterministic bench scenes: `bench/scenes/long-view-4km.toml`,
>    `long-view-forest-4km.toml`, `long-view-edit-stress.toml`. Fixed camera pose at
>    altitude, fixed seed, fixed sun. Match the TOML schema of the existing visual scenes
>    exactly (copy one and adapt). The edit-stress scene scripts a few near-camera voxel
>    edits per the existing edit-script mechanism if one exists; otherwise leave a TODO and
>    a static long view.
> 2. Extend the bench `summary.json` writer to record new counters: `terrain_draw_calls`,
>    `terrain_triangles`, `shadow_pass_triangles`, `gpu_frame_p50_ms`, `gpu_frame_p95_ms`,
>    `clod_page_count_by_lod` (array), `far_shell_triangles`, `far_shell_gpu_ms`,
>    `visible_hole_seam_count`, `page_stale_fallback_count`. Populate what exists today;
>    emit `0`/`null` placeholders for layers not built yet (LV-1..6 will fill them).
> 3. Add `bench_guard` thresholds for the three scenes in `assets/config/bench_guard.toml`
>    with a comment naming the machine they were tuned on.
> 4. Verify on a **native Windows shell** (NOT WSL — visual benches are WSL-forbidden per
>    CLAUDE.md): run each scene with `cargo run --release -- --bench <scene>`, confirm
>    `summary.json` has the new keys, run `bench_guard` against it, and confirm two runs of
>    `long-view-4km.toml` produce byte-identical screenshots.
> Report: the exact commands run, the new summary keys with sample values, and confirmation
> screenshots were deterministic. If you could not run visual benches (WSL), say so
> explicitly and stop.

---

## LV-1 — CLOD pages for 256 m – 2 km

**Goal:** make ring C reach ~2 km and keep geometry where it matters. **The page system is
already implemented** ([`src/voxel/pages/`](../../src/voxel/pages/), §0.5) — this stage is a
small extension of landed code, not a build-from-scratch.

**Reference:** the design is in [`clod-execution-plan.md`](../plans_completed/clod-execution-plan.md)
+ [`clod-phase5-plan.md`](../plans_completed/clod-phase5-plan.md); firewall boundaries in
[`laas-cdlod-far-field-reference-plan.md`](laas-cdlod-far-field-reference-plan.md). Borders
lock by **open topological boundary** (§0.5), not footprint plane — do not regress that.

**What this stage adds to the landed code:**
- Confirm the page ring radius reaches `clod_pages_end_m` in the LV-0 bench. The default `config/clod_pages.yaml` is `chunks_per_page: 4` (64 m footprint) × `quadtree_levels: 4` → coarsest node 512 m. To cover out to ~2 km with few nodes, either raise `quadtree_levels` to 5–6 **or** start the far shell (LV-2) earlier. Decide from the measured page count, don't guess.
- Add a **Fable5-style relief/silhouette split bias** to [`selection.rs`](../../src/voxel/pages/selection.rs). Fable5 biases splits by tile height-range/steepness in [`TerrainTiles.ts:433`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L433) (`heightRange`) and `:470` (error bias). The data is already at hand: each node's `error_world` and its `ClodPageMeshBounds {min_y, max_y}` (height range) are in `ClodPageSelectionIndex`. Apply:
  ```text
  effective_error_px = base_error_px * relief_boost
  relief_boost       = clamp(1.0 + (max_y - min_y) / page_size * 0.8, 1.0, 1.8)
  ```
  Keep the base `error_world` monotonic (do not break the DAG-cut stability the selection port relies on). Effect: flat far terrain drops triangles; cliffs/ravines/cave mouths keep geometry.

**Constraints:** invariants I1–I5 hold. Pages = decimated **real chunk meshes** (caves/overhangs preserved), never heightfield, never re-extraction. No colliders. Missing/stale page → fallback to chunk path (already implemented in `ownership.rs`).

**Files:** [`src/voxel/pages/selection.rs`](../../src/voxel/pages/selection.rs) (relief bias), [`src/voxel/pages/config.rs`](../../src/voxel/pages/config.rs) + `config/clod_pages.yaml` (levels, bias knobs), `assets/config/long_view.yaml` (ring bounds).

**Acceptance**
```text
- CLOD pages render 256 m–2 km in long-view-4km.toml; near bubble stays live chunks.
- Bubble edge invisible (binary ownership switch, no overlap fade — clod-execution-plan §7).
- No holes/seams at neighbor LOD deltas (border-chain assertion + grazing-angle sweep).
- LV-0 counters: clod_page_count_by_lod populated; terrain_triangles bounded vs baseline.
- Relief bias visibly keeps cliff/cave geometry while flat far terrain drops triangles.
- bench_guard passes on long-view scenes.
```

> **Implementation prompt — LV-1**
>
> Extend the **already-landed** CLOD page system at `src/voxel/pages/` to reach ~2 km and
> bias geometry toward relief. First read §0.5 of `docs/plans/four-km-long-view-plan.md` and
> skim the module: `mod.rs`, `plugin.rs`, `selection.rs`, `config.rs`, `ownership.rs`. Do not
> rebuild anything that exists; do not change the border-lock-by-open-boundary logic; respect
> invariants I1–I5 and the firewall in `laas-cdlod-far-field-reference-plan.md` (pages are
> decimated real Surface Nets meshes, never a heightfield, never re-extracted).
> 1. Run the LV-0 long-view bench and read `clod_page_count_by_lod`. Determine whether the
>    page ring reaches `clod_pages_end_m` (~2 km). The default is `chunks_per_page: 4`
>    (64 m) × `quadtree_levels: 4` → 512 m coarsest node. If it falls short, raise
>    `quadtree_levels` to 5–6 in `config/clod_pages.yaml` (and `config.rs` if a bound needs
>    it) OR document starting the far shell earlier — decide from the measured count.
> 2. Add a relief split bias in `selection.rs`. The needed data is already in
>    `ClodPageSelectionIndex` / `ClodPageMeshBounds`: `effective_error_px = base_error_px *
>    clamp(1.0 + (max_y-min_y)/page_size * 0.8, 1.0, 1.8)`. Mirror Fable5
>    [`TerrainTiles.ts:433`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L433)
>    /`:470`. Keep base `error_world` monotonic — do not break DAG-cut stability. Add the
>    bias constants to `config/clod_pages.yaml` (`selection.relief_boost_max` etc.).
> Verify with the LV-0 benches on native Windows: pages render to ~2 km, near bubble stays
> live chunks with an invisible seam, no holes at forced neighbor LOD deltas, relief bias
> visibly keeps cliff/cave geometry while flat far terrain drops triangles. Run `bench_guard`.
> Report before/after `summary.json` (terrain tris, draw calls, `clod_page_count_by_lod`).

---

## LV-1b — Shared terrain summary field

**Goal:** build the **one** coarse height/coverage field that LV-2 (far shell), LV-3 (shadow
proxy), and LV-4 (canopy base) all read. This is the architecture-improvement stage: it
prevents three parallel samplers and any temptation to voxel-extract at distance.

**Source (v1, ship first):** the per-page `ClodPageMeshBounds {min_y, max_y}` already
computed at commit and stored in `ClodPageSelectionIndex` (§0.5). Rasterize the outer-ring
pages' representative heights into a `terrain_summary.grid`² field covering the summarized
footprint; for cells beyond page coverage, fall back to a cheap procedural macro height
(Fable5's analytic `far` branch idea, [`MacroMap.ts:334`](../reference/fable5-world-demo/src/world/MacroMap.ts#L334)) so the horizon never has gaps.

**Source (v2, later):** swap behind `terrain_summary.source = naadf_summary` to read NAADF
voxel summary root mips (see [`naadf-hdda-execution-plan.md`](naadf-hdda-execution-plan.md))
for a true volumetric envelope incl. sky visibility. Same consumer API.

**Shape:**
- New `TerrainSummaryField` resource: a `grid`² array of `{ height, coverage, normal }` (coverage filled by LV-4 from persisted props; height/normal here).
- Built off-frame, rebuilt (debounced `rebuild_debounce_ms`) when the page tree revision changes — reuse the existing async/commit cadence; never on the hot path (I4). Stale summary stays valid.
- A small sampler API (`sample_height(world_xz) -> f32`, `sample_normal`, `sample_coverage`) that LV-2/3/4 call. **This is the only new sampler in the whole plan.**

**Files:** new `src/voxel/pages/summary.rs` (resource, builder, sampler), wired in [`plugin.rs`](../../src/voxel/pages/plugin.rs) after `clod_page_mesh_commit_system`; `assets/config/long_view.yaml` (`terrain_summary`).

**Acceptance**
```text
- TerrainSummaryField populates from the page envelope after a page build (unit test on a
  synthetic tree, like the existing pages tests in tests.rs/synthetic.rs).
- sample_height matches page top within a coarse tolerance over covered cells; procedural
  fallback is continuous (no NaN/seam) over uncovered cells.
- Rebuild is debounced and off-frame (no frame-time spike in the LV-0 bench when a page
  tree revision lands).
- Zero new voxel extraction; zero new per-frame scatter.
```

> **Implementation prompt — LV-1b**
>
> Build a single shared coarse terrain summary that the far shell, shadow proxy, and canopy
> base will all read — so none of them needs its own sampler or voxel extraction. Read §0.5
> first. Add `src/voxel/pages/summary.rs` with a `TerrainSummaryField` resource (a
> `terrain_summary.grid`² array of `{height, coverage, normal}`) and a sampler API
> (`sample_height(world_xz)`, `sample_normal`, `sample_coverage`). Source v1 = the existing
> per-page `ClodPageMeshBounds {min_y,max_y}` carried in `ClodPageSelectionIndex` (see
> `selection.rs`): rasterize outer-ring page heights into the grid; for cells with no page
> coverage, fall back to a cheap procedural macro height (pattern: Fable5
> [`MacroMap.ts:334`](../reference/fable5-world-demo/src/world/MacroMap.ts#L334) `far` branch)
> so the horizon has no gaps. Leave `coverage` for LV-4 to fill from persisted props. Keep a
> clean seam to add `source = naadf_summary` later (see `naadf-hdda-execution-plan.md`).
> Build it **off the frame path**, rebuilt with `rebuild_debounce_ms` debounce when the page
> tree revision changes — wire in `plugin.rs` after `clod_page_mesh_commit_system`, reusing
> the existing async cadence (invariant I4; stale summary stays valid). Add config under
> `terrain_summary` in `assets/config/long_view.yaml`.
> Verify: a unit test (mirror `tests.rs`/`synthetic.rs`) builds a synthetic page tree and
> asserts `sample_height` matches page tops over covered cells and is continuous (no NaN) on
> the procedural fallback. Run the LV-0 bench and confirm no frame-time spike when a page
> revision lands. Report the test output and bench delta.

---

## LV-2 — Far terrain shell (2–4 km)

**Goal:** the biggest "4 km view" win — a cheap radial shell beyond the CLOD pages giving
the horizon silhouette, with no collider, no edit authority, no heavy shadows, baked-ish
material, aerial perspective.

**Fable5 reference:** the far shell in [`TerrainTiles.ts:330-381`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L330)
— a `RingGeometry(WORLD_HALF*0.952, FAR_RADIUS, 160, 42)` whose vertices use the **analytic
`far` branch** of [`macroTerrain()`](../reference/fable5-world-demo/src/world/MacroMap.ts#L241)
(`MacroMap.ts:334` "far shell: outer ranges beyond the world edge"), finite-difference
normals interpolated via a varying, blended into the baked field across the world edge,
and dropped slightly so coarse tiles don't poke through.

**Drusniel mapping (the key correction):** Fable5's shell uses *analytic* macro height
because its whole world is procedural. Drusniel's world is voxel data, so the shell reads
the **shared `TerrainSummaryField` (LV-1b)** — no live noise stack, no voxel extraction:
- Vertex height + normal from `TerrainSummaryField::sample_height/normal`. Single-valued height is acceptable here (firewall G0 — non-editable outer field).
- Material = the **existing `TerrainMaterialQuality::HorizonProxy`** variant ([`triplanar.rs:204`](../../src/rendering/materials/triplanar.rs#L204), shader_def `TERRAIN_HORIZON_PROXY`) — do not author a new far material; LV-6 bakes its inputs.
- **Forbidden:** full voxel mesh extraction at 4 km.

**Bevy implementation shape** (port the *pattern*, not the TSL):
- New plugin `FarTerrainShellPlugin` building a single radial/grid mesh (one draw) covering `far_shell_start_m`..`far_shell_end_m`, `terrain_summary.grid` cells.
- **Ownership seam:** the shell fills the band **beyond page coverage**. [`ownership.rs:118`](../../src/voxel/pages/ownership.rs#L118) currently keeps a live chunk visible where no page covers (to avoid "bare horizon/water bands"). The shell now owns that far band instead; coordinate so the shell and live/near terrain never both draw the same footprint (binary ownership, like the live-chunk↔page switch).
- Blend the inner edge into the outermost CLOD pages over `edge_blend_m` — **reuse the existing `clod_page_dither` + `clod_fade` mechanism** ([`render.rs:128`](../../src/voxel/pages/render.rs#L128)), not a new dither, so there is no hard world-edge ring (Fable5 does `mix(baked, farMacro, edgeBlend)`).
- `cast_shadows=false` (LV-3 proxy casts instead), `receive_fog=true`. Rebuild off-frame when the summary changes (I4); stale shell stays visible.

**Files:** new `src/voxel/far_shell/` (plugin, mesh build, material assignment — sampler comes from LV-1b), `ownership.rs` (far-band coordination), `assets/config/long_view.yaml`. Material/WGSL changes go in the existing triplanar `HorizonProxy` path, not a new shader.

**Acceptance**
```text
At 4 km vista in long-view-4km.toml:
- no missing horizon gaps; no obvious square world edge (edge_blend works).
- no visible terrain popping during a slow scripted flythrough.
- far-shell GPU cost < ~0.5–1.0 ms on target desktop (LV-0 far_shell_gpu_ms counter).
- shell does not poke through outermost CLOD pages (slight drop applied).
- bench_guard passes; terrain_triangles increase is bounded and far-cheap.
```

> **Implementation prompt — LV-2**
>
> Add a far terrain vista shell covering ~1.8–4 km. Depends on LV-1b (`TerrainSummaryField`)
> and reuses existing material + dither — read §0.5 first. Port the **pattern** from Fable5
> [`TerrainTiles.ts:330-381`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L330)
> (radial ring, far height, finite-difference normals, edge blend, slight drop so it doesn't
> poke through), but get height/normal from `TerrainSummaryField::sample_height/normal` — NOT
> live analytic noise, NOT voxel extraction (firewall G0: single-valued is fine for this
> non-editable outer field).
> Build a `src/voxel/far_shell/` Bevy plugin: one mesh (one draw call), `terrain_summary.grid`
> cells over `far_shell_start_m`..`far_shell_end_m`. Use the **existing**
> `TerrainMaterialQuality::HorizonProxy` material variant (`triplanar.rs`, shader_def
> `TERRAIN_HORIZON_PROXY`) — do not write a new far shader (LV-6 bakes its inputs). Set
> `cast_shadows=false` (LV-3 casts instead), `receive_fog=true`. Coordinate ownership with
> `ownership.rs` so the shell owns the far band **beyond page coverage** (today that band
> keeps a live chunk to avoid bare horizon — see `live_chunk_hidden_by_clod`); shell and
> near/live terrain must never both draw a footprint. Blend the inner edge into the outermost
> pages over `edge_blend_m` by **reusing `clod_page_dither`/`clod_fade`** (`render.rs`), not a
> new dither. Rebuild off the frame path when the summary revision changes (I4); stale shell
> stays visible.
> Verify with `bench/scenes/long-view-4km.toml` on native Windows: no horizon gaps, no hard
> world-edge ring, no popping on a slow flythrough, `far_shell_gpu_ms` < ~1 ms, shell hidden
> behind pages where they exist, no double-draw at the shell↔page band. Run `bench_guard`.
> Report before/after `summary.json` (far_shell_triangles, far_shell_gpu_ms, terrain_triangles)
> and any visual artifact.

### LV-2b — Far shell + canopy beyond the world edge (clod-poc follow-up; also covers LV-4)

**Why:** the first clod-poc cut of the far shell/canopy builds a grid *inside* the page-covered
world `[0, worldSize]` with a circular hole, so it sheets a flat lid over the real terrain
(the terrain pokes through). At WORLD≥16 the pages fill the whole world, so there is no region
*beyond* it for a vista. Fix: extend the shells **outside** the world edge (Fable5's
`FAR_RADIUS=14000` sits well outside `WORLD_HALF=2048` — [`TerrainTiles.ts:330-381`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L330), [`WorldConst.ts`](../reference/fable5-world-demo/src/world/WorldConst.ts)).

> **Implementation prompt — LV-2b (clod-poc)**
>
> Turn the far terrain shell ([`tools/clod-poc/src/gpu/far_terrain_shell.ts`](../../tools/clod-poc/src/gpu/far_terrain_shell.ts))
> and canopy shell ([`far_canopy_shell.ts`](../../tools/clod-poc/src/gpu/far_canopy_shell.ts)) from
> *rings inside the built world* into a **horizon skirt surrounding the world**. Read both files
> first (geometry loops, `sampleHeightBlend`/`shellY`, the `startRadius` cutout). Changes, both
> files:
> 1. **Grid extent.** Add `farRadius` (world units, default `worldSize * 1.5`). Build over the
>    square `[center − farRadius, center + farRadius]` (`center = worldSize/2`), not `[0, worldSize]`.
> 2. **Inner exclusion = the world SQUARE, not a circle.** Skip a quad only when fully inside
>    `[inset, worldSize − inset]²` (`inset ≈ worldSize*0.04` so the skirt overlaps the edge for a
>    seamless join). Pages own the interior; the skirt owns everything outside. A circular hole
>    over a square world is what leaves the corners covered — use a square test.
> 3. **Height beyond the world = analytic terrain, not a clamped edge.** Inside `[0, worldSize]`
>    sample the summary as today; **outside** it sample [`surfaceHeightCore(wx,wz)`](../../tools/clod-poc/src/gpu/terrain_field_core.ts)
>    directly (it continues infinitely) so the skirt is natural receding terrain, not a flat
>    extrusion of the edge. Cross-fade the two over a band near the edge (Fable5 `mix(baked, farMacro, edgeBlend)`).
>    For the canopy this is the base height under the coverage lift.
> 4. **Far falloff + aerial fade.** Lower the skirt height gently with distance beyond the edge,
>    and fade its colour toward the sky/haze colour near `farRadius` so the rim dissolves into the
>    horizon (no hard line). Keep `MeshBasicNodeMaterial` + the manual hemispheric+sun lighting
>    already in both materials (a lit/PBR material renders black — no scene lights). Canopy keeps
>    its screen-door dither-in.
> 5. **Call sites** in [`main.ts`](../../tools/clod-poc/src/main.ts): pass `farRadius` (e.g.
>    `worldSizeCells * 1.5`) to `buildFarTerrainShell` (in `buildFarShellInstance`) and
>    `buildFarCanopyShell`. The shells now sit outside the world, so drop the in-world `startRadius`
>    dev/long-view split (or repurpose it as the square `inset`). Keep the `?farShell=1`/`?canopy=1`
>    toggles + gui checkboxes working.
> **Constraints:** `MeshBasicNodeMaterial` + manual lighting only (no classic/PBR → black). No
> bool WGSL uniforms. Summary stays corner-origin `[0, worldSize]`; clamp/branch for out-of-range.
> Build geometry once (off the render loop).
> **Verify** (vitest/build WITHOUT rtk; `tsc` via rtk OK): `typecheck`, `test`, `build`. Browser
> `?world=16&webgpuSelection=1&farShell=1&canopy=1` and `?scene=long-view-4km&world=16&webgpuSelection=1`:
> real terrain in the centre, far skirt extending to a hazy horizon, no flat lid, no hard
> world-edge line, continuous terrain↔skirt seam. Add a `far_terrain_shell` test asserting no
> emitted triangle has all three vertices inside `[inset, worldSize−inset]²` and some vertices lie
> beyond `worldSize`. Report a before/after `shoot`.
> **Acceptance:** far shell + canopy form a horizon skirt around the world (interior = pages,
> exterior = skirt), beyond-world height from the analytic field fading into haze, materials stay
> unlit-TSL, toggles + long-view scene still work, `tsc` + `vitest` + `vite build` green.

---

## LV-3 — Far terrain shadow proxy

**Goal:** macro mountain/ridge shadows to ~3.2 km **without** casting CLOD pages or the far
shell into the cascades. This is Fable5's highest-value shadow trick.

**Fable5 reference:** [`ShadowProxy.ts`](../reference/fable5-world-demo/src/world/ShadowProxy.ts)
— a static **512² grid (8 m quads)** whose vertex stage lifts to the height buffer; it sets
`colorWrite=false`, `depthWrite=false`, `depthTest=false` so the **main pass is vertex-only**,
while the shadow pass swaps in its depth material. Real terrain keeps `castShadow=false`;
sub-8 m detail is covered by **screen-space contact shadows**.

**Drusniel mapping:**
- Already true: **CLOD pages spawn `NotShadowCaster`** ([`render.rs:209`](../../src/voxel/pages/render.rs#L209)), so today only live chunks cast. The proxy is purely **additive** — nothing to "turn off" on pages.
- Do **not** extend directional cascades from ~256 m to 4000 m with all chunks casting (kills texel density). Keep the near real-terrain shadow band (~192 m).
- Add `FarTerrainShadowProxyPlugin`: a coarse macro grid (`shadow_proxy.grid`, `cell_size_m`), height lifted from the **shared `TerrainSummaryField` (LV-1b)** — same field LV-2 uses — `cast_only` (emits into the shadow atlas, nothing to the main pass; Bevy: a shadow-caster-only entity with the depth/cast path, equivalent to Fable5's `colorWrite=false`/`depthWrite=false`).
- Live chunks cast near only; pages + far shell do **not** cast; the proxy casts macro shadows; screen-space contact shadows cover near roots/grass/rocks (`contact_shadows_max_m`).

**Files:** new `src/rendering/lighting/far_terrain_shadow_proxy.rs` (plugin, proxy mesh from the LV-1b sampler, cast-only material), cascade config in [`src/rendering/lighting/mod.rs`](../../src/rendering/lighting/mod.rs), `assets/config/long_view.yaml`.

**Acceptance**
```text
- Mountains/ridges cast visible macro shadows out to ~3.2 km in long-view-4km.toml.
- Cascade near texel density UNCHANGED vs baseline (we did not widen cascades).
- shadow_pass_triangles increase is bounded (proxy is one coarse grid, not pages).
- Near contact shadows still cover roots/grass; no double-shadow / acne at the handoff.
- bench_guard passes; GPU frame p95 not regressed beyond threshold.
```

> **Implementation prompt — LV-3**
>
> Add a far terrain shadow proxy so mountains cast macro shadows to ~3.2 km without widening
> the CSM cascades. Depends on LV-1b. Note from §0.5 that CLOD pages already spawn
> `NotShadowCaster`, so only live chunks cast today and the proxy is purely additive. Port
> [`ShadowProxy.ts`](../reference/fable5-world-demo/src/world/ShadowProxy.ts): a coarse macro
> grid (config `shadow_proxy.grid`, `cell_size_m`) lifted in the vertex stage from the
> **shared `TerrainSummaryField` (LV-1b)** — the same field LV-2 uses — used **cast-only**: it
> must contribute to the shadow atlas but nothing to the main color/depth pass (Fable5 uses
> `colorWrite=false`/`depthWrite=false`; the Bevy equivalent is a shadow-caster-only entity).
> Do **not** widen the directional cascades to 4 km — that destroys near texel density and is
> explicitly forbidden. Keep the near real-terrain shadow band (~192 m). Casters: live chunks
> near only; pages + far shell do not cast; the proxy casts macro shadows; screen-space
> contact shadows cover sub-`contact_shadows_max_m` detail. Touch cascade setup in
> `src/rendering/lighting/mod.rs`; new plugin `src/rendering/lighting/far_terrain_shadow_proxy.rs`.
> Verify with `long-view-4km.toml` on native Windows: visible ridge shadows to ~3.2 km, near
> cascade texel density unchanged vs the LV-0/LV-2 baseline, `shadow_pass_triangles` bounded,
> no acne/double-shadow at the proxy↔contact handoff. Run `bench_guard`. Report before/after
> `summary.json` (shadow_pass_triangles, gpu_frame_p95_ms) and any shadow artifact.

---

## LV-4 — Far forest canopy shell

**Goal:** make forests visible as a *mass* at 600 m–4 km without drawing thousands of far
trees. Real trees stay near; far = a lit aggregate canopy surface + sparse impostor
silhouettes.

**Fable5 reference:** [`CanopyShell.ts`](../reference/fable5-world-demo/src/world/CanopyShell.ts)
— one static **512² grid**; vertices ride `heightfield + canopy-coverage lift + crown-scale
hash bumps`; forestless cells **sink below terrain and z-fail away**; normals from finite
differences shade it as rolling foliage; it **dithers IN** past the impostor mid-range
(`FADE_IN=620`, `FADE_BAND=90`) and owns the 600 m → edge band with sparse impostors.

> **clod-poc note:** the canopy's "extend beyond the world edge" follow-up shares the far-shell
> work — see [LV-2b](#lv-2b--far-shell--canopy-beyond-the-world-edge-clod-poc-follow-up-also-covers-lv-4).

**Drusniel mapping:**
- Fill the **`coverage` channel of `TerrainSummaryField` (LV-1b)** from persisted prop/tree placement (the prop persistence system) — not live per-frame scatter (memory: grass/props must be GPU-driven, no CPU per-frame scatter). The canopy shell then reads `sample_coverage` + `sample_height` from that one field; no separate coverage map subsystem.
- `FarForestCanopyShellPlugin`: one grid mesh (`canopy_shell.grid`) above terrain, height = `sample_height` + coverage lift (`height_lift_m`) + crown bumps; cells with no coverage sink and z-fail (exactly Fable5 `CanopyShell.ts`). Dither in past `fade_in_m`/`fade_band_m` — **reuse the `clod_page_dither` screen-door path**, not a new one. Optional macro canopy shadow via the LV-3 proxy (`canopy_shell.shadow_proxy`).
- Vegetation distance ladder enforced (config): real mesh < 96 m, billboard < 220 m, impostor < 650 m, canopy shell 600–4096 m. Far grass: **no blades** — terrain material response only.

**Files:** LV-1b's `summary.rs` (add coverage fill from persisted props), new `src/world/environment/vegetation/canopy_shell.rs` (shell mesh + material), `assets/config/long_view.yaml`. Check the real vegetation module path first (`src/props/` and `src/world/environment/vegetation/` both exist — match where billboards/impostors live, see [`src/props/billboard.rs`](../../src/props/billboard.rs)).

**Acceptance**
```text
- Forest mass visible 600 m–4 km in long-view-forest-4km.toml; no individual far trees drawn.
- Coverage map matches persisted tree placement (forested basins lift, clearings sink/z-fail).
- Canopy shell dithers in cleanly past the impostor range (no hard pop at fade_in_m).
- Optional macro canopy shadow reads correctly via the LV-3 proxy.
- bench_guard passes; far-forest GPU cost cheap vs drawing trees (LV-0 counters).
```

> **Implementation prompt — LV-4**
>
> Add a far forest canopy shell so forests read as a *mass* at 600 m–4 km without drawing far
> trees. Port [`CanopyShell.ts`](../reference/fable5-world-demo/src/world/CanopyShell.ts): one
> grid mesh (config `canopy_shell.grid`) above terrain, vertex height = terrain summary +
> canopy-coverage lift (`height_lift_m`) + crown-scale hash bumps; cells with no coverage
> **sink below terrain and z-fail**; finite-difference normals; **dither IN** past
> `fade_in_m`/`fade_band_m` (Fable5 `FADE_IN=620`, `FADE_BAND=90`).
> Fill the **`coverage` channel of `TerrainSummaryField` (LV-1b)** from **persisted prop/tree
> placement** (the prop persistence system), NOT live per-frame CPU scatter — this repo's rule
> is grass/props must be GPU-driven (see memory `grass-props-gpu-driven`). Read base height +
> coverage from that one field (`sample_height`/`sample_coverage`). Reuse the existing
> `clod_page_dither` screen-door fade for the dither-in, not a new mechanism. Enforce the
> vegetation distance ladder from `vegetation.trees.*`: real mesh < 96 m, billboard < 220 m,
> impostor < 650 m, shell 600–4096 m; far grass = no blades. Optionally route macro canopy
> shadow through the LV-3 proxy when `canopy_shell.shadow_proxy` is set. New plugin in the
> vegetation module — confirm the real path first (`src/props/` vs
> `src/world/environment/vegetation/`; match where `billboard.rs`/impostors live).
> Verify with `bench/scenes/long-view-forest-4km.toml` on native Windows: forest mass visible
> with no individual far trees, coverage matches placement (basins lift, clearings z-fail),
> clean dither-in with no pop, optional canopy shadow correct. Run `bench_guard`. Report
> before/after `summary.json` and any visual artifact (popping, z-fight, wrong coverage).

---

## LV-5 — GPU vegetation culling + indirect draws

**Goal:** move vegetation from CPU visibility/entity churn to GPU compacted instance lists +
indirect draws, so near+mid vegetation scales with the longer view. **Delegates to existing
plans** — do not re-design.

**Delegate to:** [`bevy-gpu-vegetation-port-plan.md`](bevy-gpu-vegetation-port-plan.md) (GPU
cull → LOD-ring classify → compact → indirect draw) and
[`bevy-per-cascade-shadow-caster-culling-plan.md`](bevy-per-cascade-shadow-caster-culling-plan.md)
(per-cascade caster culling — Fable5 [`Forests.ts`](../reference/fable5-world-demo/src/vegetation/Forests.ts)
specifically found that culling shadow casters by the main view frustum drops off-screen
casters that still need to cast visible shadows).

**clod-poc (WebGPU) status — sandbox side already built.** Unlike LV-0–LV-4, the GPU
vegetation already exists in clod-poc: [`grass_ring_compute.ts`](../../tools/clod-poc/src/gpu/grass_ring_compute.ts),
[`tree_ring_compute.ts`](../../tools/clod-poc/src/gpu/tree_ring_compute.ts), and
[`stone_scatter_compute.ts`](../../tools/clod-poc/src/gpu/stone_scatter_compute.ts) already
do GPU cull → pack → indirect draw (visible live in the debug overlay: `webgpu-ring-v1`,
`gpu-grass`, `gpu-dispatch`). So the clod-poc work here is only to **validate the existing
rings at the long-view distances** (draw calls / frame time at 4 km) and extend ring range
if a gap shows — not to build them. The Bevy delegation below is the net-new work.
Per-cascade shadow-caster culling is Bevy-specific (clod-poc uses
`forestLightingConfig.shadowProxy`, not CSM cascades).

**Why after terrain:** terrain rings must be stable first (CLAUDE.md: profiling in the loop;
get the cheap layers right before the expensive GPU-driven vegetation rewrite).

**What this stage adds:** run both delegated plans, then verify against the LV-0 long-view
forest bench (not just near scenes) — the longer view is the stress case those plans were
written before.

**Acceptance**
```text
- Vegetation cull/LOD/compact/indirect path live (per bevy-gpu-vegetation-port-plan acceptance).
- Per-cascade caster culling live; off-screen casters still shadow (per its plan's acceptance).
- long-view-forest-4km.toml: vegetation draw calls + CPU time down vs LV-4 baseline.
- No popping/flicker introduced at the new longer view distances.
- bench_guard passes.
```

> **Implementation prompt — LV-5**
>
> Convert vegetation to GPU-driven culling + indirect draws and per-cascade shadow caster
> culling. Execute the two existing plans as written — do not redesign:
> 1. [`docs/plans/bevy-gpu-vegetation-port-plan.md`](bevy-gpu-vegetation-port-plan.md):
>    clear counters → cull instances → classify LOD ring → compact visible IDs → write
>    indirect draw args → draw. Reference pattern: Fable5
>    [`Forests.ts`](../reference/fable5-world-demo/src/vegetation/Forests.ts).
> 2. [`docs/plans/bevy-per-cascade-shadow-caster-culling-plan.md`](bevy-per-cascade-shadow-caster-culling-plan.md):
>    cull casters per cascade, not by the main frustum (Fable5 found main-frustum culling
>    drops off-screen casters that still cast visible shadows).
> Then verify specifically against the long view, which those plans predate: run
> `bench/scenes/long-view-forest-4km.toml` (and the near scenes the plans already use) on
> native Windows. Confirm vegetation draw calls and CPU time drop vs the LV-4 baseline, no
> popping/flicker at the new longer distances, off-screen casters still shadow. Run
> `bench_guard`. Report before/after `summary.json` and any regression.

---

## LV-6 — Far material bake pass

**Goal:** prevent the Fable5 "35 live noise evals per pixel" terrain-material blow-up before
Drusniel hits it at long view. Tier terrain material by distance; bake far inputs.

**Fable5 reference:** [`STATUS.md`](../reference/fable5-world-demo/STATUS.md) — the terrain
splat material doing many live noise evaluations per pixel was a major cost; baking value/
fBM/ridged noise + pre-derived gradient textures took heavy views from ~73–134 ms GPU down
to ~19–23 ms at 1080p (their numbers). Bake periods in `NoiseBake` (`PERIOD_FBM/RID/VAL`).

**clod-poc (WebGPU) Phase A — do this first.** On the WebGPU side the terrain material is the
TSL [`terrain_node_material.ts`](../../tools/clod-poc/src/gpu/terrain_node_material.ts)
(`MeshBasicNodeMaterial`), shared by CLOD pages via
[`pageTerrainMaterial.ts`](../../tools/clod-poc/src/materials/pageTerrainMaterial.ts) →
[`terrainMaterialCommon.ts`](../../tools/clod-poc/src/materials/terrainMaterialCommon.ts). It
already evaluates the live per-pixel noise this stage targets (`proceduralMacroTint` /
`proceduralMicroWeight`) and already has the screen-door LOD cross-fade dither (`uFade`/
`uDither`). The LV-2 far shell's simplified `MeshBasicNodeMaterial` (hemispheric only) is the
cheapest tier / horizon-proxy equivalent. So Phase A = (1) select a material tier by
distance/LOD (full triplanar+procedural near → cheap mid → far-shell horizon proxy), reusing
`uFade` for the cross-fade; (2) **bake** `proceduralMacroTint`/`proceduralMicroWeight` into a
texture (Fable5 `NoiseBake` `PERIOD_FBM/RID/VAL` pattern) so far tiers sample it instead of
evaluating noise per pixel. Validate frame time with `npm run qa` + `shoot` at the LV-0
long-view camera. Phase B (Bevy) is the mapping below.

**Drusniel mapping (Phase B — Bevy) — the variants already exist, this stage assigns + bakes.** The enum
[`TerrainMaterialQuality`](../../src/rendering/materials/triplanar.rs#L199) already has
`FullTriplanar`, `CheapTriplanar`, `SingleProjectionFar`, `HorizonProxy`, each with a WGSL
`shader_def` and a prebuilt handle ([`triplanar.rs:296`](../../src/rendering/materials/triplanar.rs#L296)).
LV-2 already puts the far shell on `HorizonProxy`. So LV-6 is two jobs only:
```text
1. ASSIGN quality by distance/level (terrain_material_lod):
   near_m (128)             FullTriplanar
   cheap_triplanar_m (384)  CheapTriplanar
   single_projection_far_m  SingleProjectionFar   (far CLOD pages, by level)
   far_shell_baked_m (2048) HorizonProxy          (already set by LV-2)
2. BAKE the noise inputs that HorizonProxy/SingleProjectionFar shader_defs evaluate live,
   so the long view stops paying per-pixel noise (the Fable5 ~73→19 ms fix).
```
Add baked far resources and have the `HorizonProxy`/`SingleProjectionFar` WGSL branches
sample them instead of computing noise:
```yaml
far_material_bakes: { macro_albedo: true, macro_normal: true, moisture: true, snow_mask: true, biome: true }
```
Bake offline / off-frame (I4). Far CLOD pages are committed via `clod_page_mesh_commit_system`
([`render.rs:119`](../../src/voxel/pages/render.rs#L119)) which currently forces
`FullTriplanar` — change that to pick quality by the node's level/distance.

**Files:** [`src/rendering/materials/triplanar.rs`](../../src/rendering/materials/triplanar.rs) + `shaders/triplanar_terrain.wgsl` (bake sampling in the existing far branches), [`src/voxel/pages/render.rs`](../../src/voxel/pages/render.rs) (per-level quality assignment), new far-bake resource builder, `assets/config/long_view.yaml`.

**Acceptance**
```text
- Terrain material switches tier by distance per terrain_material_lod (verify each tier renders).
- Far shell + far pages sample baked inputs, not live noise (shader path confirmed).
- GPU frame time at long view improved or flat vs LV-2/LV-5 baseline (no live-noise spike).
- No visible seam at tier boundaries (cross-fade or distance hysteresis).
- bench_guard passes.
```

> **Implementation prompt — LV-6**
>
> Bake far material inputs and assign material quality by distance — the quality **variants
> already exist**, do not invent any. See §0.5 and
> [`TerrainMaterialQuality`](../../src/rendering/materials/triplanar.rs#L199)
> (`FullTriplanar`/`CheapTriplanar`/`SingleProjectionFar`/`HorizonProxy`, each with a WGSL
> `shader_def`). Motivation: Fable5 [`STATUS.md`](../reference/fable5-world-demo/STATUS.md)
> — live per-pixel splat noise cost ~73–134 ms; baking noise + gradient textures dropped it
> to ~19–23 ms. Two jobs:
> 1. Assign quality by `terrain_material_lod` (`assets/config/long_view.yaml`): FullTriplanar
>    near, CheapTriplanar to 384 m, SingleProjectionFar for far CLOD pages by level (today
>    `clod_page_mesh_commit_system` in `src/voxel/pages/render.rs` forces FullTriplanar —
>    change it to pick by level/distance), HorizonProxy on the far shell (already set by LV-2).
> 2. Build baked far resources (`far_material_bakes`: macro albedo, macro normal, moisture,
>    snow mask, biome) **offline/off-frame** (invariant I4) and make the `HorizonProxy` /
>    `SingleProjectionFar` branches in `shaders/triplanar_terrain.wgsl` sample them instead of
>    evaluating live noise. Add cross-fade or distance hysteresis so tier boundaries don't seam.
> Verify with `long-view-4km.toml` on native Windows: each tier renders, far layers sample
> bakes (confirm in the shader path, not live noise), GPU frame time improved/flat vs the
> LV-2/LV-5 baseline, no tier-boundary seam. Run `bench_guard`. Report before/after
> `summary.json` (gpu_frame_p50/p95) and the tier-boundary visual check.

---

## 5. Cross-cutting rules (every stage)

```text
- Profiling in the loop: before/after summary.json on a long-view scene for any frame-time
  change (CLAUDE.md). Visual benches on native Windows only, never WSL.
- Derived layers (pages/shell/proxies/bakes) build OFF the frame path; stale stays visible;
  missing falls back to the live path (invariant I4).
- No colliders and no edit authority outside the near bubble (invariants I1/I5).
- Representation firewall G0: heightfield-style layers only own non-editable far footprints.
- Far reflections and far real grass stay OFF — do not extend them to 4 km.
- Reuse existing material-quality / bench / bench_guard infra; do not invent a parallel QA path.
```

## 6. Definition of done (whole plan)

```text
At 4 km in long-view-4km.toml / long-view-forest-4km.toml on the target desktop:
- continuous horizon (no gaps, no square world edge), no terrain popping on slow flythrough
- forests read as mass to the horizon; no thousands of far trees drawn
- macro mountain shadows to ~3.2 km; near cascade texel density unchanged from v0.5
- near terrain still fully editable Surface Nets with colliders; edits stay instant
- GPU frame p95 within bench_guard thresholds; far layers each cheap (shell < ~1 ms)
- every stage has a recorded before/after summary.json diff
```
