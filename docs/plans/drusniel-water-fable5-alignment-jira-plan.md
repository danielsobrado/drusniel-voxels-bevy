# Drusniel Water / Fable5 Alignment — Jira Execution Plan

## Purpose

This plan converts the seven Drusniel water alignment points into Jira-ready execution tickets.

The goal is not to copy Fable5 directly. The goal is to adapt the useful ideas into Drusniel's Bevy/WGSL/voxel architecture while preserving the current Drusniel strengths:

- CLOD pages remain terrain-only.
- `VoxelWorld` remains authoritative.
- Near editable water remains compatible with voxel terrain.
- Large/far water can use a separate camera-following renderer.
- Water rendering remains config-driven through YAML.
- Performance and visual changes are gated by bench scenes.

## Execution Summary

| Epic | Goal | Priority |
|---|---|---|
| WATER-100 | Separate water clipmap renderer from CLOD pages | P0 |
| WATER-200 | Add hydrology-driven water flow field | P0 |
| WATER-300 | Add hybrid reflection path: planar + SSR fallback | P1 |
| WATER-400 | Upgrade caustics to compute-baked analytic texture | P1 |
| WATER-500 | Bind interactive displacement visually | P0 |
| WATER-600 | Add wet margins to terrain/water integration | P2 |
| WATER-700 | Add water-specific bench and regression scenes | P0 |

## Global Rules

```text
G1. Water must not be baked into CLOD terrain pages.
G2. CLOD page source meshes must stay terrain-only.
G3. Water systems must be configurable through YAML, not hard-coded.
G4. New render paths must have runtime toggles and bench toggles.
G5. Integrated GPU fallback must remain safe.
G6. Missing water data must degrade gracefully, not produce black pixels or invalid reflections.
G7. Every visual feature must have at least one deterministic bench or debug scene before being considered complete.
```

## Suggested Config File Layout

```yaml
# assets/config/water.yaml
water:
  renderer:
    near_voxel_meshes_enabled: true
    clipmap_enabled: false
    clipmap_min_body_area: 2048.0
    clipmap_max_distance: 4000.0

  flow:
    enabled: false
    source: hydrology
    velocity_scale: 1.0
    foam_speed_threshold: 0.35
    foam_drop_threshold: 0.18
    wet_margin_width_m: 1.5
    debug_vectors: false

  reflections:
    planar_enabled: true
    ssr_enabled: false
    planar_large_body_only: true
    planar_min_body_area: 2048.0
    ssr_max_steps: 48
    ssr_stride_px: 2
    ssr_thickness: 0.18
    sky_fallback_strength: 0.35

  caustics:
    mode: projected
    compute_enabled: false
    resolution: 256
    update_every_n_frames: 2
    intensity: 0.55
    depth_fade_m: 8.0
    shore_fade_m: 1.0

  displacement:
    visual_binding_enabled: false
    normal_strength: 0.35
    height_strength: 0.15
    max_visual_distance: 64.0

  wet_margins:
    enabled: false
    terrain_darkening: 0.18
    roughness_boost: 0.25
    normal_soften: 0.12
    rain_boost: 0.35
```

---

# EPIC WATER-100 — Separate Water Clipmap Renderer From CLOD Pages

## WATER-101 — Define Water Renderer Ownership Boundaries

**Type:** Story  
**Priority:** P0  
**Owner:** Rendering / Terrain  
**Depends on:** None

### User Story

As a developer, I want water rendering ownership to be explicit so that CLOD terrain pages, live voxel water meshes, and future clipmap water do not overlap or fight each other.

### Scope

Document and enforce the rule that CLOD pages are terrain-only and water is rendered by dedicated water systems.

### Implementation Notes

Create or update:

```text
docs/rendering/water-architecture.md
src/rendering/water/ownership.rs
src/rendering/water/mod.rs
src/terrain/pages/source_mesh.rs
```

Add durable doc comments near CLOD page source extraction:

```rust
/// Water surfaces are never included in CLOD page source meshes.
/// CLOD pages are derived terrain caches only. Water is rendered by the
/// dedicated water renderer to avoid stale water geometry, z-fighting,
/// and mismatched hydrology state.
```

### Acceptance Criteria

- CLOD source extraction rejects water meshes structurally.
- Water ownership is documented in `docs/rendering/water-architecture.md`.
- Runtime has a single debug view showing which system owns each water surface:
  - near voxel water mesh,
  - clipmap water,
  - hidden/fallback.
- No CLOD page builder code imports water rendering modules.

### Test Plan

- Unit test: CLOD source extraction fails if water section is present.
- Visual test: near lake with CLOD pages enabled does not render duplicate water.
- Debug overlay shows ownership for each visible water body.

---

## WATER-102 — Add Water Clipmap Config and Plugin Skeleton

**Type:** Story  
**Priority:** P0  
**Owner:** Rendering  
**Depends on:** WATER-101

### User Story

As a developer, I want a disabled-by-default water clipmap plugin so large and far water can be implemented without touching CLOD terrain pages.

### Scope

Add plugin structure and config plumbing. Do not implement final shader logic yet.

### Proposed Files

```text
src/rendering/water/clipmap/mod.rs
src/rendering/water/clipmap/config.rs
src/rendering/water/clipmap/mesh.rs
src/rendering/water/clipmap/plugin.rs
src/rendering/water/clipmap/systems.rs
assets/config/water.yaml
```

### Acceptance Criteria

- Plugin compiles and runs disabled by default.
- Config is loaded from YAML.
- Debug overlay reports clipmap enabled/disabled, origin, level count, and mesh count.
- Integrated GPU can force-disable the clipmap path.

### Test Plan

- Unit test config deserialization.
- Runtime smoke test with `clipmap_enabled: false` produces no entities.
- Runtime smoke test with `clipmap_enabled: true` produces placeholder clipmap entities.

---

## WATER-103 — Generate Shared Concentric Clipmap Grid Meshes

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering  
**Depends on:** WATER-102

### User Story

As a player, I want large lakes, rivers, and ocean-like water to extend far into the view without requiring many individual water meshes.

### Scope

Generate reusable concentric grid/ring meshes for water clipmap levels.

### Implementation Notes

Use shared mesh assets per level. Snap the clipmap origin to the current level cell size to reduce swimming.

Rules:

```text
1. Inner levels cover near water.
2. Outer levels cover far water.
3. Inner ring area is discarded or omitted to prevent overlap.
4. Meshes are camera-following in XZ only.
5. Height is sampled in shader or from water body data; mesh itself stays flat.
```

### Acceptance Criteria

- Six configurable clipmap levels can be generated.
- No overlapping triangles between adjacent levels.
- Camera movement snaps the grid without visible high-frequency swimming.
- Clipmap draw count remains stable during movement.

### Test Plan

- Wireframe debug view for all levels.
- Freeze-origin debug toggle.
- Movement bench checks draw count stability.

---

## WATER-104 — Select Clipmap vs Near Voxel Water Per Body

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering / World  
**Depends on:** WATER-103

### User Story

As a developer, I want large/far water bodies to use clipmap rendering while near editable water keeps using voxel water meshes.

### Scope

Add body-level renderer selection.

### Selection Policy

```text
Near editable water: live voxel water mesh.
Large lake/ocean/far water: clipmap renderer.
Small ponds: live mesh only.
Rivers: live mesh near camera, clipmap-compatible flow sampling farther away.
Missing body metadata: live mesh fallback.
```

### Acceptance Criteria

- Body renderer mode is deterministic and debug-visible.
- Large/far bodies stop spawning unnecessary high-detail water meshes where clipmap owns the area.
- Near player water remains editable and interactive.
- No z-fighting at ownership boundaries.

### Test Plan

- Lake scene: clipmap owns far water, live mesh owns near water.
- River scene: near segment uses live mesh, far segment can use clipmap sampling.
- Edit test: editing near water updates live mesh without waiting for clipmap rebuild.

---

# EPIC WATER-200 — Add Hydrology-Driven Water Flow Field

## WATER-201 — Define Water Flow Data Model

**Type:** Story  
**Priority:** P0  
**Owner:** World / Rendering  
**Depends on:** WATER-101

### User Story

As a developer, I want water bodies to expose flow direction, flow speed, depth, and drop so shaders can render rivers and streams differently from still lakes.

### Scope

Create a shared flow data model independent from the renderer.

### Proposed Files

```text
src/world/water_flow/mod.rs
src/world/water_flow/types.rs
src/world/water_flow/sampling.rs
src/rendering/water/flow_bindings.rs
```

### Acceptance Criteria

- Flow samples can be queried by world XZ position.
- Still water returns near-zero flow speed.
- Rivers return stable flow direction and speed.
- Missing data returns safe defaults.

### Test Plan

- Unit tests for flow sampling defaults.
- Unit tests for river direction normalization.
- Debug overlay prints flow sample under cursor/camera.

---

## WATER-202 — Build CPU Hydrology Flow Field From Existing Water Bodies

**Type:** Story  
**Priority:** P0  
**Owner:** World Generation  
**Depends on:** WATER-201

### Scope

Build a CPU flow field from existing water body metadata and terrain height/depth data.

### Acceptance Criteria

- Each water body can produce stable depth, flow direction, flow speed, and local drop samples.
- Rivers follow downhill or channel direction when known.
- Lakes and ponds return near-zero flow.
- Flow field updates after relevant terrain or water edits.

### Test Plan

- Deterministic river sampling tests.
- Lake stillness tests.
- Edit invalidation tests.

---

## WATER-203 — Upload Flow Field To GPU

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering  
**Depends on:** WATER-202

### Scope

Upload compact flow data to GPU resources consumed by water shaders.

### Acceptance Criteria

- GPU flow texture/buffer is created only when enabled.
- Upload is throttled or dirty-region based.
- Missing flow data resolves to still-water defaults.
- Integrated GPU fallback remains safe.

### Test Plan

- GPU resource creation smoke test.
- Disabled feature produces no upload.
- Debug view confirms flow vectors match CPU samples.

---

## WATER-204 — Flow-Aware Shader Normals And Foam

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering / Shaders  
**Depends on:** WATER-203

### Scope

Use flow direction and speed to align ripple normals, scroll detail normals, and boost foam around rapids, drops, and obstacles.

### Acceptance Criteria

- River ripples align with flow direction.
- Still lakes remain calm.
- Foam increases with flow speed/drop.
- Feature is controlled by YAML and shader defs.

### Test Plan

- River flow visual bench.
- Still lake visual bench.
- Foam threshold A/B bench.

---

# EPIC WATER-300 — Hybrid Reflection Path

## WATER-301 — Add Reflection Selection Policy

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering  
**Depends on:** WATER-201

### Scope

Choose reflection mode per body or visible region.

### Policy

```text
Large calm lake/ocean: planar reflection preferred.
River/small water: SSR preferred when enabled.
Tiny/distant water: sky/IBL fallback.
Integrated GPU: cheaper fallback unless explicitly forced.
Missing metadata: current planar path or safe fallback.
```

### Acceptance Criteria

- Reflection mode is debug-visible.
- Planar path remains current default.
- SSR path can be enabled without breaking planar reflection.
- No water region samples invalid reflection textures.

### Test Plan

- Lake planar mode bench.
- River SSR mode bench.
- Disabled/fallback bench.

---

## WATER-302 — Add SSR Water Reflection Prototype

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering / Shaders  
**Depends on:** WATER-301

### Scope

Add screen-space ray marching for water reflections with safe sky/IBL fallback.

### Acceptance Criteria

- SSR never returns black holes on miss.
- SSR has configurable step count, stride, and thickness.
- SSR cost is visible in timing counters.
- SSR is disabled by default until bench-gated.

### Test Plan

- SSR miss fallback visual test.
- River reflection bench.
- Step-count performance A/B test.

---

## WATER-303 — Blend Planar, SSR, And Sky Fallback

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering / Shaders  
**Depends on:** WATER-302

### Scope

Blend reflection sources with Fresnel and water body policy.

### Acceptance Criteria

- Planar remains preferred for large calm water.
- SSR is preferred for small/river water when enabled.
- Sky fallback handles misses smoothly.
- Blend mode is debug-visible.

### Test Plan

- Lake, river, pond, and ocean comparison screenshots.
- Reflection mode debug screenshots.
- Integrated GPU fallback bench.

---

# EPIC WATER-400 — Compute-Baked Analytic Caustics

## WATER-401 — Add Caustics Mode Abstraction

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering / Shaders  
**Depends on:** WATER-701

### Scope

Introduce caustics modes: off, projected, compute.

### Acceptance Criteria

- Current projected caustics remain default.
- Compute mode can be enabled independently.
- Shader code paths share one config resource.
- Debug view shows caustics mode and texture resolution.

### Test Plan

- Current projected mode regression.
- Compute mode disabled smoke test.
- Config deserialization test.

---

## WATER-402 — Implement Compute Caustics Bake

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering / Compute  
**Depends on:** WATER-401

### Scope

Generate a 2D caustics texture from analytic wave derivatives using a WGSL compute pass.

### Acceptance Criteria

- Compute pass produces a stable caustics texture.
- Texture resolution and update cadence are config-driven.
- GPU timing counter exists.
- Integrated GPU fallback uses projected/off mode.

### Test Plan

- Shallow water caustics bench.
- Update cadence A/B bench.
- Integrated GPU fallback bench.

---

## WATER-403 — Feed Compute Caustics Into Terrain And Props

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering / Terrain / Props  
**Depends on:** WATER-402

### Scope

Apply compute caustics to underwater terrain and optionally rocks/props.

### Acceptance Criteria

- Terrain receives compute caustics below water.
- Caustics fade by depth and shore distance.
- Props/rocks can opt in later without terrain shader duplication.
- Projected caustics path remains available.

### Test Plan

- Underwater terrain bench.
- Shoreline fade bench.
- Caustics disabled bench.

---

# EPIC WATER-500 — Visual Interactive Displacement

## WATER-501 — Expose Displacement Texture To Water Shader

**Type:** Story  
**Priority:** P0  
**Owner:** Rendering / Shaders  
**Depends on:** WATER-101

### Scope

Bind the existing CPU water displacement texture into the water material/shader path.

### Acceptance Criteria

- Texture binding is optional and config-driven.
- Disabled path is visually identical to current water.
- Enabled path samples displacement texture safely.
- Integrated GPU fallback disables visual binding by default.

### Test Plan

- Shader compile test with binding enabled/disabled.
- Player ripple bench with visual binding disabled confirms baseline.
- Player ripple bench with visual binding enabled confirms sampled displacement.

---

## WATER-502 — Apply Displacement To Visual Normals

**Type:** Story  
**Priority:** P0  
**Owner:** Rendering / Shaders  
**Depends on:** WATER-501

### Scope

Use the displacement height gradient to perturb water normals near the camera.

### Acceptance Criteria

- Player movement creates visible water normal ripples.
- Ripples fade near simulation texture boundaries.
- Strength is config-driven.
- Buoyancy sampling and visual sampling remain consistent enough for gameplay.

### Test Plan

- Player movement ripple visual bench.
- No-impulse still-water bench.
- Boundary fade bench.

---

## WATER-503 — Optional Near Height Displacement

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering / Shaders  
**Depends on:** WATER-502

### Scope

Apply small visual height displacement near the camera only.

### Acceptance Criteria

- Height displacement only affects near water.
- Far water uses normal-only displacement.
- No cracks or z-fighting at water edges.
- Can be disabled independently from normal displacement.

### Test Plan

- Near ripple bench.
- Shoreline ripple bench.
- Far water no-vertex-displacement bench.

---

# EPIC WATER-600 — Wet Margins

## WATER-601 — Compute Water Proximity / Wetness Field

**Type:** Story  
**Priority:** P2  
**Owner:** World / Terrain  
**Depends on:** WATER-201

### Scope

Compute wetness near water surfaces and shorelines.

### Acceptance Criteria

- Terrain near water receives wetness value.
- Wetness fades with distance from water.
- Wetness can be queried by terrain shader.
- YAML controls width and strength.

### Test Plan

- Shoreline wetness debug view.
- Riverbank wetness debug view.
- No-water terrain returns zero wetness.

---

## WATER-602 — Add Wet Terrain Shading

**Type:** Story  
**Priority:** P2  
**Owner:** Rendering / Terrain Shaders  
**Depends on:** WATER-601

### Scope

Darken, smooth, and slightly increase reflectivity of terrain near water without changing the underlying material.

### Acceptance Criteria

- Wet margins are visible but subtle.
- Wetness respects terrain material type.
- Rain can boost wetness.
- Wetness can be disabled globally.

### Test Plan

- Before/after wet margin screenshots.
- Rain wetness bench.
- Dry terrain bench.

---

# EPIC WATER-700 — Water Bench And Regression Scenes

## WATER-701 — Add Water Bench Scene Definitions

**Type:** Story  
**Priority:** P0  
**Owner:** QA / Rendering  
**Depends on:** WATER-101

### Scope

Add deterministic water bench scene TOML files.

### Proposed Files

```text
bench/scenes/water-lake-reflection.toml
bench/scenes/water-river-flow.toml
bench/scenes/water-shore-foam.toml
bench/scenes/water-caustics-shallow.toml
bench/scenes/water-player-ripples.toml
bench/scenes/water-integrated-gpu-fallback.toml
bench/scenes/water-all-features-high.toml
bench/scenes/water-all-features-performance100.toml
```

### Acceptance Criteria

- Each scene runs through existing bench command.
- Each scene captures screenshots at deterministic checkpoints.
- Each scene records water-specific timing rows.
- Bench scenes can toggle water features independently.

### Test Plan

- Run every water bench locally.
- Confirm summary JSON includes water counters.
- Confirm screenshots are saved.

---

## WATER-702 — Add Water Performance Counters

**Type:** Story  
**Priority:** P0  
**Owner:** Rendering / QA  
**Depends on:** WATER-701

### Required Counters

```text
Water Meshes Total
Water Meshes Visible
Water Clipmap Levels Visible
Water Clipmap Triangles
Water Reflection Mode Planar Count
Water Reflection Mode SSR Count
Water Reflection Active
Water Reflection Sampled
Water SSR GPU Time
Water Planar Reflection GPU Time
Water Caustics Compute GPU Time
Water Displacement Sim CPU Time
Water Displacement Upload CPU Time
Water Wet Margin Shader Enabled
```

### Acceptance Criteria

- Counters appear in bench CSV/summary.
- Counters are zero when feature is disabled.
- Counters are stable across deterministic runs.

### Test Plan

- Feature-toggle A/B benches.
- Compare high vs performance100 presets.
- Confirm integrated GPU fallback counters.

---

## WATER-703 — Add Bench Guard Thresholds For Water

**Type:** Story  
**Priority:** P0  
**Owner:** QA / Rendering  
**Depends on:** WATER-702

### Proposed Thresholds

```toml
[water]
max_water_reflection_p95_ms = 2.0
max_water_ssr_p95_ms = 1.25
max_water_caustics_compute_p95_ms = 0.75
max_water_displacement_cpu_p95_ms = 0.50
max_water_upload_p95_ms = 0.35
max_water_total_extra_p95_ms = 3.0
```

### Acceptance Criteria

- Bench guard accepts water summary files.
- Threshold failures clearly name the failing water subsystem.
- Water guard can compare direct-water and visual-regression runs.

### Test Plan

- Passing baseline run.
- Artificial failure threshold test.
- Feature-disabled run confirms zero/low counters.

---

# Recommended Execution Order

```text
1. WATER-101 — Define ownership boundaries
2. WATER-701 — Add water bench scenes
3. WATER-702 — Add water counters
4. WATER-501 — Expose displacement texture to shader
5. WATER-502 — Apply displacement to visual normals
6. WATER-201 — Define flow data model
7. WATER-202 — Build CPU hydrology flow field
8. WATER-203 — Upload flow field to GPU
9. WATER-204 — Flow-aware shader normals and foam
10. WATER-102 — Clipmap plugin skeleton
11. WATER-103 — Clipmap grid meshes
12. WATER-104 — Body renderer selection
13. WATER-301 — Reflection selection policy
14. WATER-302 — SSR render path
15. WATER-303 — Reflection blending
16. WATER-401 — Caustics mode abstraction
17. WATER-402 — Compute caustics bake
18. WATER-403 — Feed caustics into terrain/props
19. WATER-601 — Wetness field
20. WATER-602 — Wet terrain shading
21. WATER-703 — Bench guard thresholds
```

## Release Gates

### Gate A — Safety Baseline

Required before merging large water renderer changes:

- WATER-101 complete.
- WATER-701 complete.
- WATER-702 complete.
- Existing planar reflections still pass current visual benches.
- CLOD page source extraction remains water-free.

### Gate B — Interactive Water

Required before claiming interactive water visuals:

- WATER-501 complete.
- WATER-502 complete.
- Player ripple bench passes.
- Displacement disabled path still renders identical to baseline.
- Integrated GPU fallback works.

### Gate C — Flow/River Parity

Required before claiming Fable5-style river behavior:

- WATER-201 complete.
- WATER-202 complete.
- WATER-203 complete.
- WATER-204 complete.
- River flow direction visible in shader matches debug vectors.
- Still lakes remain calm.

### Gate D — Large/Far Water

Required before claiming Fable5-style large/far water coverage:

- WATER-102 complete.
- WATER-103 complete.
- WATER-104 complete.
- Clipmap does not overlap near voxel water.
- Draw count remains stable during camera movement.

### Gate E — Reflection Upgrade

Required before enabling hybrid reflection by default:

- WATER-301 complete.
- WATER-302 complete.
- WATER-303 complete.
- SSR does not produce black holes on miss.
- Planar reflection remains preferred for large calm water.
- Reflection mode is debug-visible per body/region.

### Gate F — Caustics Upgrade

Required before enabling compute caustics by default:

- WATER-401 complete.
- WATER-402 complete.
- WATER-403 complete.
- Compute timing is within threshold.
- Caustics fade correctly with depth and shore distance.

### Gate G — Full Water Alignment

Required before calling Drusniel water broadly aligned with Fable5 concepts:

- Gates A-F complete.
- WATER-601 and WATER-602 complete or explicitly deferred.
- Bench guard thresholds include water systems.
- High preset and performance100 preset both pass water scenes.

# Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Clipmap overlaps live voxel water | Z-fighting and visual artifacts | Explicit ownership map and debug overlay |
| Flow field is wrong or noisy | Rivers look fake | Start with CPU debug vectors before shader polish |
| SSR creates black holes | Very visible reflection failures | Always blend to sky/IBL fallback |
| Compute caustics is too expensive | Frame-time regression | Start at 256², update every 2 frames, bench-gated |
| Visual displacement swims with camera | Ripples look detached | Snap simulation center and fade near texture boundary |
| Wet margins over-darken terrain | Muddy visuals | Keep subtle defaults and material-specific response |
| Too many features land without tests | Hard regressions | Bench scenes are P0 and must land early |

# Definition Of Done For Each Ticket

```text
1. Code implemented behind config/toggle.
2. No hard-coded tuning values outside constants/config.
3. Runtime logging for important fallback/error states.
4. Debug or bench visibility for the feature.
5. Unit test, shader compile test, or visual bench depending on ticket type.
6. Documentation update when ownership, config, or behavior changes.
7. No regression to existing planar reflection and water preset behavior.
```
