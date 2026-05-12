# LOD (Level of Detail) — Implementation Guide & Code Review

> Last updated: 2026-05-12

## Table of Contents

1. [Overview](#overview)
2. [Terrain Chunk LOD](#terrain-chunk-lod)
3. [SDF Generation Per LOD Level](#sdf-generation-per-lod-level)
4. [LOD Boundary Skirts](#lod-boundary-skirts)
5. [Terrain Material LOD](#terrain-material-lod)
6. [Props LOD Pipeline](#props-lod-pipeline)
7. [Rendering Quality Presets](#rendering-quality-presets)
8. [System Execution Order](#system-execution-order)
9. [Constants Reference](#constants-reference)
10. [Code Review Findings](#code-review-findings)

---

## Overview

The engine uses a multi-layered, distance-based LOD system spanning terrain meshing, terrain materials, prop rendering, shadow culling, and water shading. Every LOD transition uses hysteresis buffers and throttled update intervals to prevent flickering.

### Key Design Principles

- **Hysteresis everywhere** — switching FROM a level requires crossing a different threshold than switching TO it, preventing oscillation at boundaries.
- **Frame budget limiting** — mesh generation is capped at `MAX_CHUNKS_PER_FRAME = 4` for terrain edits and `MAX_LOD_DIRTY_CHUNKS_PER_FRAME = 1` for LOD-only churn.
- **Dirty reason tracking** — `MeshDirtyReason` bitmask (`Lod`, `NeighborLod`, `Visibility`, `Generation`, `WaterMaterial`, `TerrainMutation`) lets the meshing system prioritize work.
- **Cooldown per chunk** — `LOD_CHANGE_COOLDOWN_FRAMES = 30` prevents any single chunk from changing LOD more than ~twice per second.

---

## Terrain Chunk LOD

### LOD Levels

Defined in `src/voxel/chunk.rs` (`LodLevel` enum):

| Level | Grid Size | Step Size | SDF Samples | Vertex Reduction | AO |
|-------|-----------|-----------|-------------|-------------------|----|
| Lod0  | 18³ (5832) | 1 | Every voxel | Baseline | ✅ Full |
| Lod1  | 10³ (1000) | 2 | 2³ averaged | ~75% | ❌ Disabled |
| Lod2  | 6³ (216)   | 4 | 4³ averaged | ~94% | ❌ Disabled |
| Lod3  | 4³ (64)    | 8 | 8³ averaged | ~98% | ❌ Disabled |
| Culled | — | — | — | 100% (despawned) | — |

### Distance Thresholds (Default)

Configured via `LodSettings` resource, defaults from `constants.rs`:

| Transition | Distance | With Hysteresis (±20m) |
|------------|----------|------------------------|
| Lod0 → Lod1 | 176m (`DEFAULT_HIGH_DETAIL_DISTANCE`) | >196m to downgrade, <156m to upgrade |
| Lod1 → Lod2 | 248m (midpoint of 176–320) | >268m / <228m |
| Lod2 → Lod3 | 284m (midpoint of 248–320) | >304m / <264m |
| Lod3 → Culled | 320m (`DEFAULT_CULL_DISTANCE`) | >340m / <300m |

For integrated GPUs, distances are tightened: `high_detail = 64m`, `cull = 160m`, and low-detail mode switches to Blocky.

### LOD Update System

**System**: `update_chunk_lod_system` in `src/voxel/plugin.rs`

**Execution flow**:
1. Throttled to ~4 Hz (every 0.25s)
2. Skipped if camera hasn't moved >2 world units
3. For each chunk, computes distance to camera and calls `calculate_target_lod_with_hysteresis`
4. Respects per-chunk cooldown (`LOD_CHANGE_COOLDOWN_FRAMES = 30`)
5. Sorts candidates: upgrades (higher detail) first, then by distance (nearest first)
6. Applies at most `MAX_LOD_CHANGES_PER_UPDATE = 4` changes per tick
7. Marks horizontal neighbors dirty with `MeshDirtyReason::NeighborLod`

**Key file locations**:
- `calculate_target_lod_with_hysteresis` — `plugin.rs:3321`
- `update_chunk_lod_system` — `plugin.rs:3504`
- `LodSettings` — `plugin.rs:131`

---

## SDF Generation Per LOD Level

### LOD0 — Full Resolution

**Function**: `generate_sdf()` in `meshing.rs:2315`

- Samples every voxel in the 18³ padded grid
- Binary SDF: solid = -1.0, air = +1.0
- At boundary voxels adjacent to lower-LOD neighbors, uses `lower_detail_transition_step` to apply multi-sample averaging (same algorithm as LOD1+), creating a smooth transition zone
- SDF smoothing is intentionally disabled (commented out) because it causes boundary vertex divergence between chunks

### LOD1–3 — Downsampled Resolution

**Functions**: `generate_sdf_lod1/2/3()` in `meshing.rs:2358–2489`

Algorithm for each grid cell:
1. Compute base world position: `chunk_origin + (grid_pos - 1) * step`
2. Sample all voxels in the `step³` region (8 for LOD1, 64 for LOD2, 512 for LOD3)
3. Count solid voxels → compute density ratio
4. Convert to SDF: `sdf = 1.0 - 2.0 * density` (maps 0→+1, 0.5→0, 1.0→-1)

This multi-sample averaging produces smooth SDF gradients instead of hard binary edges, reducing stair-stepping on slopes.

### Mesh Generation

All LOD levels use the `fast_surface_nets` crate for isosurface extraction. The output vertex positions are scaled by `step_size` to map back to chunk-local coordinates:

```
local_position = (grid_position - 1.0) * step_size
```

LOD1+ skip ambient occlusion computation (always 1.0) since the distance makes AO imperceptible.

Material weights use `compute_vertex_material_weights_lod()` with a larger sampling radius proportional to step size.

---

## LOD Boundary Skirts

**File**: `src/voxel/skirt.rs`

Skirts are thin geometry strips extruded downward from chunk boundary edges to hide gaps between mismatched LOD meshes.

### How It Works

1. **Edge extraction** (`extract_boundary_edges`): Scans mesh triangles for edges where both vertices lie on a chunk face (NegX/PosX/NegZ/PosZ). Shared interior edges (count > 1) are filtered out — only silhouette edges get skirts.

2. **Adaptive generation** (`generate_skirts`): For each boundary edge:
   - If the neighbor has lower LOD AND the edge faces upward (avg normal.y > 0.35): emit a **horizontal lip** (small outward extension + slight downward bias to avoid z-fighting), then a **vertical drop** from the lip
   - If the neighbor has lower LOD but the edge faces sideways: emit only a **vertical drop** (no lip)
   - If neighbor has same or higher LOD: skip (no skirt needed)

3. **Depth scaling per LOD**:

| LOD Level | Skirt Depth |
|-----------|-------------|
| Lod0 | 1.5 × VOXEL_SIZE |
| Lod1 | 3.0 × VOXEL_SIZE |
| Lod2 | 8.0 × VOXEL_SIZE |
| Lod3 | 16.0 × VOXEL_SIZE |

### Edge Quantization

Boundary vertex positions are quantized to 0.0001 precision (`EDGE_QUANTIZE_SCALE = 10000.0`) for consistent edge hashing and deduplication.

---

## Terrain Material LOD

**System**: `update_terrain_material_lod` in `plugin.rs:2249`

Separate from mesh LOD — controls which triplanar material variant is used:

| Quality | Features |
|---------|----------|
| Full | 3 texture layers, normal maps, PBR |
| Reduced | 2 texture layers, simplified |

- Distance threshold: `TERRAIN_MATERIAL_LOD_DISTANCE = 96m` (scaled by quality preset)
- Hysteresis: `TERRAIN_MATERIAL_LOD_HYSTERESIS = 16m`
- Update interval: `TERRAIN_MATERIAL_UPDATE_INTERVAL = 0.5s`
- Only applies to `SurfaceNets` mode meshes

---

## Props LOD Pipeline

Props have three independent LOD mechanisms:

### 1. Shadow Distance Culling

**File**: `src/props/lod_material.rs` — `update_prop_shadow_lod` system

- Adds `NotShadowCaster` beyond `PROP_SHADOW_CULL_DISTANCE = 64m`
- Hysteresis: `PROP_LOD_MATERIAL_HYSTERESIS = 8m`
- Scaled by `RenderQualityPreset::prop_shadow_distance_scale()`

### 2. Billboard LOD

**File**: `src/props/billboard.rs` — `update_billboard_lod` system

Switches trees from 3D mesh to billboard quad at distance:
- Switch distance: `BILLBOARD_SWITCH_DISTANCE = 180m`
- Hysteresis: `BILLBOARD_LOD_HYSTERESIS = 10m`
- Update interval: `BILLBOARD_UPDATE_INTERVAL = 0.15s`

Billboard features:
- **Axial (cylindrical)** rotation — Y-axis only, suitable for trees
- **Directional modes**: SingleAxial (1 texture), Directional4, Directional8
- **Direction selection** with angular hysteresis (8% of sector width) to prevent flicker at sector boundaries
- **Wind animation**: bend segments (10), wind sway, leaf flutter via custom shader
- **Pre-baked textures**: loaded from `assets/textures/billboards/generated/*.billboard.ron`

### 3. Mesh Decimation (Infrastructure Only)

**File**: `src/props/decimation.rs`

Vertex clustering algorithm for runtime mesh simplification:
- LOD1 target: 50% vertex reduction, LOD2: 25% retention
- Grid-based clustering with configurable cell size
- Degenerate triangle removal when vertices collapse to same cluster

> **Note**: The decimation cache is populated at startup but no runtime system currently swaps mesh handles based on distance. The `MeshLod` component and `MeshLodDistances` resource exist but are unused. This appears to be staged infrastructure for a future intermediate LOD tier (50–180m range).

### Prop View Distance Culling

Separate from LOD — configured per prop type in `constants.rs`:

| Prop Type | View Distance Multiplier |
|-----------|--------------------------|
| Trees | 1.2× base (336m) |
| Rocks | 0.85× (238m) |
| Bushes | 0.6× (168m) |
| Flowers | 0.25× (70m) |

Base: `PROP_VIEW_DISTANCE_BASE = 280m`, hysteresis: 10m, update interval: 0.25s.

---

## Rendering Quality Presets

**File**: `src/rendering/quality.rs` — `RenderQualityPreset` resource

| Setting | Low | Medium | High | Performance100 |
|---------|-----|--------|------|----------------|
| Prop LOD distance scale | 0.72 | 0.86 | 1.0 | 0.62 |
| Prop shadow distance scale | 0.70 | 0.85 | 1.0 | 0.55 |
| Terrain material LOD | 65% | 82% | 100% | 100% |
| Water reflection resolution | 0.25× | 0.5× | 0.5× | 0.25× |
| Water reflection distance | 80m | 120m | 120m | 72m |

---

## System Execution Order

```
poll_chunk_generation_tasks
  → adjust_lod_for_integrated_gpu
  → update_chunk_face_visibility_system
    → update_octree_system
    → update_visible_chunks_system
      → apply_visibility_culling_system
        → update_chunk_lod_system          ← LOD assignment
          → mesh_dirty_chunks_system       ← Mesh generation + skirts
            → update_water_body_registry
            → update_water_material_lod
          → update_terrain_material_lod    ← Material quality switching
```

---

## Constants Reference

All LOD constants are centralized in `src/constants.rs`:

```rust
// Terrain LOD distances
DEFAULT_HIGH_DETAIL_DISTANCE: 176.0   // Lod0 → Lod1 threshold
DEFAULT_CULL_DISTANCE: 320.0          // Beyond = despawned
INTEGRATED_GPU_HIGH_DETAIL_DISTANCE: 64.0
INTEGRATED_GPU_CULL_DISTANCE: 160.0
LOD_HYSTERESIS: 10.0                  // Base hysteresis (doubled for terrain)

// LOD grid configurations
LOD0: 18³ grid, step 1    LOD1: 10³ grid, step 2
LOD2: 6³ grid, step 4     LOD3: 4³ grid, step 8

// Prop LOD
PROP_SHADOW_CULL_DISTANCE: 64.0
PROP_SIMPLE_MATERIAL_DISTANCE: 120.0
BILLBOARD_SWITCH_DISTANCE: 180.0

// Terrain shadows
TERRAIN_SHADOW_DISTANCE: 192.0
TERRAIN_SHADOW_HYSTERESIS: 16.0

// Grass
GRASS_FULL_DISTANCE: 64.0
GRASS_HALF_DISTANCE: 96.0
GRASS_CULL_DISTANCE: 128.0
```

---

## Code Review Findings

*Review date: 2026-05-12*

### Issue 1 — [HIGH] Massive code duplication in LOD meshing (~800 lines)

`generate_chunk_mesh_surface_nets_lod1`, `_lod2`, and `_lod3` are near-identical copies of the LOD0 function, differing only in SDF array type, step size multiplier, and AO being disabled. The SDF generation functions (`generate_sdf_lod1/2/3`) are similarly duplicated.

**Files**: `meshing.rs:3044–3600+` (LOD1), line 3229 (LOD2), plus SDF at lines 2358–2489.

**Impact**: Any bug fix or feature must be replicated across all four paths. The skirt depth table is already duplicated verbatim between functions.

**Recommendation**: Consolidate into a single generic function parameterized by step size. Use `Vec<f32>` for SDF or a const-generic approach.

---

### Issue 2 — [MEDIUM] LOD3 SDF samples 512 voxels per cell

Each of the 64 LOD3 grid cells samples an 8×8×8 = 512 voxel region (32,768 world lookups total) for a chunk producing at most ~30 triangles at ~300m distance behind fog.

**File**: `meshing.rs:2450`

**Recommendation**: Use sparse sampling (center voxel + 6 face-centers) or a binary center-sample. At LOD3 distances the density fraction is invisible.

---

### Issue 3 — [MEDIUM] LOD bands can collapse with aggressive cull distances

LOD transition distances are computed as midpoints: `lod1 = (176+320)/2 = 248`, `lod2 = (248+320)/2 = 284`. With `TERRAIN_LOD_HYSTERESIS = 20m`, the LOD2 band is only 36m wide, and LOD3's effective band overlaps with the Culled restore threshold.

On integrated GPU (cull=160), the bands compress further. No startup validation exists.

**File**: `plugin.rs:3321–3380`

**Recommendation**: Add a startup `debug_assert!` that `high_detail_distance + 4 * TERRAIN_LOD_HYSTERESIS < cull_distance`. Consider making LOD band ratios configurable rather than hardcoded midpoints.

---

### Issue 4 — [MEDIUM] Skirt depth table duplicated

The same `match my_lod { Lod0 => 1.5, Lod1 => 3.0, ... }` block appears in every LOD meshing function — a direct consequence of issue #1.

**Recommendation**: Extract to `fn skirt_depth_for_lod(lod: LodLevel) -> f32` or a const table on `LodLevel`.

---

### Issue 5 — [LOW] `LodLevel::Culled` returns step_size 0

`step_size()` returns 0 for `Culled`. The skirt lip width calculation guards with `.max(1)`, so it's safe but semantically unclear.

**File**: `chunk.rs:179–187`

**Recommendation**: Consider returning `Option<u32>` or documenting the zero as intentional.

---

### Issue 6 — [LOW] Vertical neighbors not tracked for LOD transitions

`NeighborLods` only stores horizontal neighbors (neg_x, pos_x, neg_z, pos_z). Vertical neighbors are never dirtied on LOD changes and never get skirts.

**Files**: `skirt.rs:249–254`, `plugin.rs:1683–1696`, `plugin.rs:3635–3646`

**Impact**: Acceptable for current world height (128 voxels) where vertical neighbors share similar distances. Would need fixing if world height increases significantly.

---

### Issue 7 — [LOW] Prop mesh decimation has no runtime driver

`decimation.rs` defines `MeshLod`, `MeshLodDistances`, and `DecimatedMeshCache` but no system reads these to swap mesh handles at runtime. The cache is populated but never consumed.

**Impact**: Appears to be staged infrastructure for a future intermediate prop LOD tier (50–180m). If not planned, these types are dead code.

---

### Issue 8 — [LOW] LOD0 vs LOD1+ have different "solid" definitions

LOD0 SDF (`generate_sdf`) uses `sample_voxel_solid` which checks only `is_solid()`. LOD1+ SDF functions use `sample_voxel_at_world_pos` which checks `is_solid() || is_liquid()`. Water voxels contribute to terrain SDF at LOD1+ but not LOD0.

**File**: `meshing.rs:2346–2349`

**Impact**: Minor — masked by water surface shader in practice. Could cause subtle visual differences at LOD transitions near shorelines.

**Recommendation**: Align sampling to use `is_solid()` only, or document the intentional divergence.

---

### What's Working Well

- **Hysteresis is thorough** across every LOD domain (terrain, props, billboards, water, shadows)
- **Frame budget limiting** with separate budgets for LOD churn vs terrain edits
- **Multi-sample SDF averaging** at LOD1+ produces smooth terrain without stair-stepping
- **Adaptive skirts** correctly generate transition geometry only toward lower-LOD neighbors
- **Billboard direction system** with 8-direction baked textures and angular hysteresis
- **Quality presets** coherently scale all LOD distances across Low/Medium/High tiers
- **Dirty reason bitmask** enables intelligent prioritization in the meshing system

### Summary Table

| # | Severity | Area | Issue |
|---|----------|------|-------|
| 1 | 🔴 HIGH | Meshing | ~800 lines of near-identical LOD function copies |
| 2 | 🟡 MEDIUM | SDF | LOD3 samples 512 voxels per cell |
| 3 | 🟡 MEDIUM | Thresholds | LOD bands can collapse with aggressive cull distances |
| 4 | 🟡 MEDIUM | Skirts | Depth table duplicated across LOD functions |
| 5 | 🟢 LOW | Chunk | `step_size()` returns 0 for Culled |
| 6 | 🟢 LOW | Skirts | Vertical neighbors not tracked |
| 7 | 🟢 LOW | Props | Mesh decimation infrastructure unused at runtime |
| 8 | 🟢 LOW | SDF | LOD0 vs LOD1+ disagree on water as solid |
