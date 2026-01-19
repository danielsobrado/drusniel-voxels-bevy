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

## Open items
- Near shallow water still needs visual tuning; adjust `WATER_FANCY_MIN_*` thresholds or tweak shader multipliers.
