# Water Visuals Summary

## Goal
Improve close-range water visuals without a large performance hit, while keeping far water cheap.

## What changed
- Split voxel water into two materials: near uses `bevy_water` (`StandardWaterMaterial`), far uses a cheap `StandardMaterial` for performance.
- Added water material LOD logic with distance + hysteresis + update interval, so switching does not thrash.
- Added extra gating for the fancy water shader:
  - Minimum triangle count (`WATER_FANCY_MIN_TRIANGLES`).
  - Minimum vertical water depth (`WATER_FANCY_MIN_DEPTH`).
- Added `WaterMesh` + `WaterMeshDetail` components to tag voxel water entities and store water mesh detail metrics.
- Switched voxel water UVs to world-space and set vertex colors to full alpha.
- Tuned voxel water shader parameters (amplitude, UV scale, clarity, edge scale) and added a sync system so `WaterSettings` updates do not overwrite voxel overrides.
- Updated water settings in the environment to use blend alpha and a blue base color.
- Debug UI water toggle now targets voxel water via `WaterMesh` (not a material handle).

## Key knobs
- Water material LOD:
  - `WATER_FANCY_DISTANCE`, `WATER_FANCY_HYSTERESIS`, `WATER_MATERIAL_UPDATE_INTERVAL`
  - `WATER_FANCY_MIN_TRIANGLES`, `WATER_FANCY_MIN_DEPTH`
- Voxel water shader tuning:
  - `VOXEL_WATER_WAVE_AMPLITUDE_MULT`
  - `VOXEL_WATER_WAVE_UV_SCALE`
  - `VOXEL_WATER_CLARITY_MULT`
  - `VOXEL_WATER_EDGE_SCALE_MULT`

## Files touched
- Water visuals: `src/rendering/materials.rs`, `src/voxel/plugin.rs`, `src/voxel/meshing.rs`, `src/constants.rs`, `src/environment.rs`, `src/debug_ui.rs`, `src/rendering/plugin.rs`

## Current status
- Far water looks acceptable with the cheap material.
- Near water uses the fancy shader only for larger/deeper surfaces; shallow, thin streams stay on the cheap material.

## Findings
- Close-range shallow water shows blue striping on sand while the main area stays sandy; the tint is too weak near the camera.
- The issue shows up primarily at close range; far water tends to look correct.
- Border triangles on shallow water had z-fighting/blinking; mitigated via depth bias + surface offset, but visual mismatch persists.
- The voxel water shader path (small `coord_scale`) needs a stronger shallow tint and higher base alpha to avoid brown/sandy reads.
- Depth-based coloring can wash out when the depth delta goes negative; clamping the depth difference helps keep the tint stable.

## Fixes Applied (Session 2)

### Water Striping Fix (RESOLVED)
The blue striping on terrain near water edges was caused by Surface Nets mesh generation creating smooth interpolated water surfaces that extended beyond actual water voxel boundaries onto terrain.

**Root cause:** Surface Nets generates smooth surfaces at the boundary between "inside" and "outside" SDF values. The interpolated vertices could extend slightly beyond water voxels, creating thin water triangles that rendered on top of terrain.

**Solution:** Switched water mesh generation from Surface Nets to blocky face rendering:
- Water faces are now generated exactly at voxel boundaries
- No interpolation artifacts that could extend beyond water voxels
- Clean, blocky edges that align perfectly with the underlying voxel grid

**Additional changes:**
- `WATER_SURFACE_OFFSET`: Reset to 0.0 (no vertical offset needed)
- `depth_bias`: Increased from 2.0 to 4.0 on all water materials
- Water SDF: Simplified to only mark water voxels as "inside" (solid terrain no longer marked)
- Water shader: Added minimum depth (0.3) for voxel water, increased shallow_color mix to 0.85

### River Generation
Added procedural river generation to create natural water channels:

**Configuration** (`assets/config/terrain_generation.yaml`):
```yaml
rivers:
  enabled: true
  scale: 0.003         # Lower = larger rivers
  width: 4.0           # Main river width
  depth: 6.0           # Carve depth below water level
  octaves: 3           # Meandering detail
  tributary_scale: 0.008
  tributary_width: 2.0
```

**Implementation:**
- Rivers use domain-warped noise for natural meandering
- Main rivers + smaller tributaries combine for varied water networks
- Rivers carve terrain down below WATER_LEVEL, creating natural channels that fill with water
- Smooth-step blending at river edges for gradual banks

**Files touched:**
- `src/voxel/meshing.rs` - Switched water mesh from Surface Nets to blocky faces
- `src/terrain/generation/config.rs` - Added RiverConfig struct
- `src/voxel/terrain.rs` - Added `river_carve()` function, integrated into `get_height()`
- `assets/config/terrain_generation.yaml` - Added rivers configuration
- `src/constants.rs` - Updated WATER_SURFACE_OFFSET to 0.0
- `src/rendering/materials.rs` - Updated depth_bias values
- `assets/shaders/water_fragment.wgsl` - Added voxel water depth fixes

## Current status
- Water striping issue is **FIXED**
- Water now renders with clean blocky edges
- Both near and far water look correct
- River generation creates varied water channels
