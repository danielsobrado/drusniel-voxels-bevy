# Props Virtual Geometry — Execution Plan

> Created: 2026-06-10 · Status: Planning  
> Scope: `src/props/`, `src/rendering/materials/props.rs`, `assets/shaders/props.wgsl`,  
> `assets/shaders/instanced_prop.wgsl`, `assets/config/`, `bench/scenes/forest/`,  
> `bench/scenes/visual/visual-regression-performance100.toml`  
> Owner: rendering / props  
> Related: [`docs/lod/lod-implementation-and-review.md`](../lod/lod-implementation-and-review.md),  
> [`docs/plans/clod-execution-plan.md`](clod-execution-plan.md) §9 (terrain meshlets deferred separately)

## Summary

Drusniel props today use a **custom GPU instancing path** (`PropInstancingPlugin`) with
distance LOD (shadow cull, billboard swap, view-distance hide) and staged mesh decimation that
is not yet wired to runtime swaps. There is **no** `MeshletMesh3d` or Bevy virtual geometry in
the project.

This plan adds **Nanite-style cluster LOD** for props by adopting Bevy's experimental meshlet
renderer (`bevy::pbr::experimental::meshlet`) where it fits, while preserving the existing
instancing and billboard tiers for cases meshlets do not cover well.

**Primary win target:** keep dense forest/rock fields visually stable at long view distances
without exploding draw/instance counts or relying solely on hard pop-off LOD.

**Explicit non-goal:** replace terrain rendering. CLOD terrain pages keep their own meshlet
decision in [`clod-execution-plan.md`](clod-execution-plan.md).

---

## Current state (baseline)

| Area | Today | File(s) |
|------|-------|---------|
| Draw path | Custom binned instancing (`Opaque3d` / `AlphaMask3d` / `Transparent3d` + shadow phase) | `src/props/instanced_render.rs` |
| Mesh asset | Plain `Mesh` cached from GLTF | `src/props/instancing.rs` |
| Material | Custom `PropsMaterial` + triplanar `props.wgsl`, forward-only | `src/rendering/materials/props.rs` |
| Instancing shader | `instanced_prop.wgsl` with per-instance transforms | `assets/shaders/instanced_prop.wgsl` |
| LOD | Shadow distance, billboard swap (~180 m trees), view-distance cull | `lod_material.rs`, `billboard.rs`, `constants.rs` |
| Mesh LOD (unused) | Vertex-cluster decimation cache at startup | `src/props/decimation.rs` |
| Bevy meshlets | Not enabled in `Cargo.toml`; zero `src/` references | — |
| Water shader | `#ifdef MESHLET_MESH_MATERIAL_PASS` compatibility hooks only | `assets/shaders/water_fragment.wgsl` |

Bench toggles already exist for prop A/B: `disable_instanced_props`, `disable_prop_lod_hiding`,
`disable_prop_shadow_lod`, `prop_subcluster_grid`, `quality_preset` — reuse these during rollout.

---

## Goals

```text
G1. Screen-error-driven cluster LOD for high-poly prop source meshes (per prop type, not per instance).
G2. Offline bake: GLTF → MeshletMesh asset, loaded like other prop cache data.
G3. Coexist with existing instancing for low-poly / massive-count props until profiling says otherwise.
G4. Preserve visual parity on forest + performance100 bench scenes within documented thresholds.
G5. Quality-preset-controlled activation (off by default until Phase 5 gate passes).
```

## Non-goals (this plan)

```text
N1. Custom from-scratch Nanite renderer (indirect draws, software rasterizer, METIS DAG).
N2. Runtime meshlet baking on the frame path.
N3. Editor viewport parity in Phase 0–3 (game binary + bench first).
N4. Merging virtual geometry with NAADF voxel preview or terrain CLOD pages.
N5. Replacing billboard LOD for trees in v1 — billboards remain the coarsest tier.
```

---

## 0. Invariants (do not violate in any phase)

```text
I1. PropMeshCache / PropInstanceGroups remain authoritative for prop identity and transforms.
    Virtual geometry is a render representation swap, not a gameplay or persistence change.
I2. MeshletMesh assets are derived offline from the same GLTF source meshes as today's Mesh cache.
    Do not bake from merged chunk geometry or runtime-modified meshes.
I3. Meshlet preprocessing never runs on the frame path. Bake at asset import / startup background only.
I4. Instanced-prop and meshlet-prop paths must be mutually exclusive per prop *type* tier, not both
    drawing the same instance (z-fighting). One owner per rendered instance.
I5. Billboard LOD remains the final coarse tier for eligible foliage until a meshlet impostor path exists.
I6. Bench before/after claims require release benches and summary.json comparison (AGENTS.md).
```

---

## 1. Configuration (single source of truth)

```yaml
# assets/config/props_virtual_geometry.yaml
virtual_geometry:
  enabled: false                    # master switch; quality preset may override
  min_triangles: 2048               # skip meshlets for tiny clutter meshes
  max_instances_per_meshlet_entity: 1 # v1: one transform per MeshletMesh3d entity
  error_threshold_px: 1.0           # cluster selection target (match CLOD plan semantics)
  hysteresis_px: 0.35
  bake:
    cluster_size: 128               # triangles per meshlet (Bevy default ballpark; tune in spike)
    simplify_ratio_per_level: 0.5
    lock_borders: true
  tiers:
    # prop_id glob → render path
    hero:      meshlet              # high-poly unique assets
    tree:      meshlet_then_billboard
    rock:      meshlet
    bush:      instanced             # keep instancing until meshlet wins measured
    flower:    instanced
    default:   instanced
  quality_preset_overrides:
    low:           { enabled: false }
    medium:        { enabled: false }
    high:          { enabled: true,  error_threshold_px: 1.0 }
    performance100: { enabled: true, error_threshold_px: 1.25 }
```

Load from the same config pipeline as `mc_transvoxel.yaml` and bench `[render_toggles]`.

---

## 2. Architecture — three render tiers

```text
                    ┌─────────────────────────────────────┐
  Near / high error │  MeshletMesh3d + MeshletMesh asset  │  cluster LOD, visibility buffer
                    └─────────────────┬───────────────────┘
                                      │ error_px > threshold
                    ┌─────────────────▼───────────────────┐
  Mid / many copies │  PropInstancingPlugin (existing)    │  GPU instancing, subclusters
                    └─────────────────┬───────────────────┘
                                      │ distance > billboard switch
                    ┌─────────────────▼───────────────────┐
  Far / trees       │  Billboard quads (existing)         │  axial / directional impostor
                    └─────────────────────────────────────┘
```

**Instance model (v1):** Bevy meshlets are **per-entity**, not per-instance-buffer. For v1,
each placed prop instance that uses the meshlet tier spawns `MeshletMesh3d(handle)` + `Transform`.
Shared `Handle<MeshletMesh>` across instances is fine; draw consolidation is the renderer's job.

Revisit **meshlet + instancing** hybrid (one meshlet draw with instance transforms) only if
Phase 0 profiling shows entity count as the bottleneck.

---

## 3. Phase 0 — Feasibility spike (timebox: 2 days)

Goal: prove one real prop can render through Bevy meshlets without forking the whole material stack.

- [ ] Enable Bevy features on a **spike branch only** first:
  ```toml
  # Cargo.toml (spike)
  bevy = { features = [ ..., "meshlet", "meshlet_processor" ] }
  ```
- [ ] Pick **one hero prop** (high triangle count, opaque, no cutout) and **one tree** prop from `assets/props/`.
- [ ] Offline bake: `MeshletMesh::from_mesh(&mesh)` in a small `examples/meshlet_prop_bake.rs` tool.
  - Record bake time, output asset size, cluster count, VRAM estimate.
  - Serialize baked asset to `assets/props/meshlets/<prop_id>.meshlet.ron` (or Bevy-native format if available).
- [ ] Render baked asset with `MeshletMesh3d` + **Bevy `StandardMaterial`** (not `PropsMaterial` yet).
  - Document visual delta vs current triplanar path.
- [ ] Run `visual-regression-performance100.toml` with spike prop swapped in a isolated subscene.
  - Capture `Render Instancing Queue Draws`, `Render Instancing Queue Instances`, frame time rows.
- [ ] **Exit criteria:**
  - Bake completes offline in < 60 s per hero mesh on dev hardware.
  - Runtime renders without validation errors on Vulkan (primary target).
  - No worse than 5% frame regression vs instanced baseline **for that single prop type** at near distance.
  - Document blockers: material API gaps, alpha cutout, shadows, prepass, reflection layers.

**If spike fails** (material incompatibility, unstable meshlet feature on 0.18, or regression without
visual win): stop and record findings; fall back to activating staged `decimation.rs` runtime LOD
(see §10 Fallback) before investing in custom cluster rendering.

---

## 4. Phase 1 — Offline bake pipeline

Goal: extend prop load path to produce meshlet assets alongside today's `Mesh` cache.

- [ ] Add `src/props/meshlet_bake.rs`:
  - Input: `CachedPropMesh.mesh` (same extraction as `instancing.rs`)
  - Output: `Handle<MeshletMesh>` stored in new `PropMeshletCache` resource
  - Gate on `min_triangles` and per-prop tier from config
- [ ] Hook bake into existing startup / prop preload chain in `src/props/mod.rs` (parallel task pool, not `Update`).
- [ ] Add cache stats to debug UI (meshes baked, clusters, bake seconds, skipped reasons).
- [ ] Version stamp baked files; invalidate when GLTF mtime or bake settings change.
- [ ] **Exit criteria:** all `tier: meshlet` props have baked assets at startup; game runs with `enabled: false` unchanged.

---

## 5. Phase 2 — Material bridge

Goal: meshlet entities shade with prop-consistent lighting and textures.

Bevy meshlet materials require dedicated shader entry points:
`meshlet_mesh_fragment_shader`, `meshlet_mesh_prepass_fragment_shader`,
`meshlet_mesh_deferred_fragment_shader` on the `Material` trait.

- [ ] **Path A (preferred):** extend `PropsMaterial` with meshlet shader variants.
  - New assets: `assets/shaders/props_meshlet.wgsl` — port triplanar sampling from `props.wgsl`
    using `resolve_vertex_output` (`MESHLET_MESH_MATERIAL_PASS` pattern from `water_fragment.wgsl`).
  - Keep one uniform layout; share bind group structure with non-meshlet props where possible.
- [ ] **Path B (interim):** per-prop `StandardMaterial` textures for meshlet tier only.
  - Accept visual parity loss short-term; bench document delta.
- [ ] Handle alpha modes:
  - v1: **opaque meshlet props only**
  - cutout / blended props stay on `PropInstancingPlugin` until meshlet alpha path is verified
- [ ] **Exit criteria:** hero prop meshlet render matches instanced reference within bench screenshot
  threshold at near camera; no shader panic on DX12/Vulkan.

---

## 6. Phase 3 — Runtime spawn routing

Goal: wire virtual geometry into the existing spawn pipeline without breaking instancing.

- [ ] Add `PropRenderPath` enum: `Instanced | Meshlet | BillboardOnly`
- [ ] Extend `spawn_instanced_prop` / `instanced_render::spawn_instanced_prop` routing in `src/props/spawner.rs`:
  ```text
  config tier + triangle count + quality preset → PropRenderPath
  ```
- [ ] Meshlet spawn path:
  ```rust
  // conceptual
  commands.spawn((
      MeshletMesh3d(meshlet_handle),
      MeshMaterial3d(props_material),
      transform,
      PropInstance { ... },
  ));
  ```
- [ ] Ensure **I4**: instanced groups exclude prop types assigned to meshlet tier.
- [ ] Retire or bypass unused `decimation.rs` runtime swap for types on meshlet tier (meshlet DAG supersedes discrete LOD1/LOD2).
- [ ] Keep `update_instanced_prop_lod`, billboard, and shadow LOD systems; meshlet path uses renderer cluster LOD instead of CPU mesh swap.
- [ ] **Exit criteria:** forest scene shows meshlet-tier trees/rocks with instanced-tier flowers/bushes unchanged.

---

## 7. Phase 4 — Shadows, prepass, reflections

Goal: meshlet props participate in the same lighting ecosystem as instanced props.

- [ ] Shadows: verify meshlet shadow pass; if gap, keep `NotShadowCaster` distance rules from `lod_material.rs`.
- [ ] Depth prepass: confirm meshlet depth output matches instanced props (water and SSAO depend on this).
- [ ] Reflection layer: today instanced groups get `REFLECTION_RENDER_LAYER` at group granularity
  ([`docs/implementation/prop-reflection-layers.md`](../implementation/prop-reflection-layers.md)).
  Apply equivalent layer to meshlet entities.
- [ ] Targeting / interaction raycasts: no change expected (gameplay uses colliders / bounds, not draw path).
- [ ] **Exit criteria:** `visual-regression.toml` screenshots stable; water reflections show meshlet props.

---

## 8. Phase 5 — Quality presets and rollout

- [ ] Add `virtual_geometry` block to `RenderQualityPreset` in `src/rendering/quality.rs`.
- [ ] Default: `enabled: false` globally until bench gate passes.
- [ ] `High`: enable meshlet tier for hero + tree + rock per config.
- [ ] `Performance100`: enable with relaxed `error_threshold_px` (cheaper clusters far away).
- [ ] Bench toggle: `disable_prop_virtual_geometry` for A/B (mirror `disable_instanced_props` pattern).
- [ ] Feature flag in `Cargo.toml`:
  ```toml
  prop_virtual_geometry = ["bevy/meshlet", "bevy/meshlet_processor"]
  ```
  Keep off default feature set until Phase 8 gate.

---

## 9. Phase 6 — Bench gates and profiling

Required scenes (release, before merge):

```powershell
rtk cargo run --release --features prop_virtual_geometry -- --bench bench/scenes/visual/visual-regression-performance100.toml
rtk cargo run --release --features prop_virtual_geometry -- --bench bench/scenes/forest/forest-ab-disable-instanced-props.toml
rtk cargo run --release --features prop_virtual_geometry -- --bench bench/scenes/visual/visual-regression.toml
```

Report in PR / summary:

| Metric | Source |
|--------|--------|
| Frame time (total, render prepare, queue) | `bench-runs/<run>/summary.json` |
| `Render Instancing Queue Draws` / `Instances` | summary counters |
| Prop chunks / items | bench report rows |
| Screenshot checkpoints | near + far camera |
| VRAM / meshlet cluster counts | new debug counters |
| First fully textured frame (if NAADF scene coupled) | NAADF startup bench only when touching shared render hooks |

Run bench guard:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

**Merge gate:**

```text
- No bench_guard failures on performance100 with virtual geometry ON vs baseline OFF.
- No new screenshot diffs beyond documented near-field triplanar parity tradeoffs.
- Instanced-prop counters drop for meshlet-tier types without total frame regression > 3%.
```

---

## 10. Fallback — staged decimation (if meshlets blocked)

If Bevy 0.18 meshlets remain too experimental for production:

- [ ] Activate existing `decimation.rs` runtime mesh swap (`MeshLod` component) for 50–180 m band.
- [ ] Wire `update_prop_mesh_lod` system (new) using distances already documented in
  [`lod-implementation-and-review.md`](../lod/lod-implementation-and-review.md).
- [ ] Keep instancing + billboards; no `MeshletMesh3d`.
- [ ] Re-evaluate Bevy meshlet track quarterly (jms55 / Bevy `experimental::meshlet` changelog).

This fallback is **cheaper but not Nanite-class**; document it explicitly in release notes if taken.

---

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bevy meshlet API unstable across 0.18→0.19 | integration churn | feature-gated module; thin adapter struct |
| `PropsMaterial` triplanar ≠ meshlet vertex inputs | visual parity | Phase 0 spike; Path B interim |
| Per-entity meshlet cost for 10k+ instances | CPU/memory | keep bushes/flowers instanced; cluster selection reduces GPU cost |
| Slow offline bake | long startup | cache to disk; async background bake with occupancy preview unchanged |
| Alpha cutout props | unsupported v1 | route to instancing |
| Custom instancing shadow path divergence | missing shadows | Phase 4 explicit pass |
| VRAM growth from cluster hierarchies | OOM on integrated GPUs | `min_triangles`, tier gating, `Performance100` stricter threshold |

---

## 12. Deferred (explicitly not v1)

```text
- Meshlet + GPU instancing in one draw (per-transform cluster culling).
- Meshlet impostors replacing billboard quads.
- METIS / custom DAG builder (use Bevy's builder unless profiling proves inadequate).
- Software rasterizer / visibility buffer export to NAADF.
- CLOD terrain page meshlet rendering (see clod-execution-plan.md §9).
- Editor viewport meshlet preview.
- Runtime mesh editing of meshlet assets.
```

---

## 13. Task checklist (rollup)

```text
Phase 0  [ ] Cargo meshlet spike  [ ] bake example  [ ] one prop rendered  [ ] perf note
Phase 1  [ ] PropMeshletCache  [ ] offline bake  [ ] disk cache  [ ] stats
Phase 2  [ ] props_meshlet.wgsl  [ ] PropsMaterial trait impl  [ ] opaque only
Phase 3  [ ] PropRenderPath routing  [ ] spawner integration  [ ] I4 exclusivity
Phase 4  [ ] shadows  [ ] prepass depth  [ ] reflection layer
Phase 5  [ ] quality presets  [ ] bench toggle  [ ] feature flag
Phase 6  [ ] performance100 A/B  [ ] forest A/B  [ ] bench_guard  [ ] PR metrics
```

---

## 14. References

- Bevy virtual geometry overview: [Virtual Geometry in Bevy 0.14](https://jms55.github.io/posts/2024-06-09-virtual-geometry-bevy-0-14/) (API concepts still apply; verify against 0.18 docs)
- `MeshletMesh3d`: `bevy::pbr::experimental::meshlet::MeshletMesh3d` (requires `meshlet` feature)
- Current props instancing: `src/props/instanced_render.rs`
- Current LOD review: `docs/lod/lod-implementation-and-review.md` § Props LOD Pipeline
- Profiling workflow: `docs/reference/profiling.md`, `AGENTS.md` § Profiling
