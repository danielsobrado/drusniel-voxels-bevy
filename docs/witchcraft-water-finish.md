# Witchcraft water finish

Document status (2026-05-17): current technical note; verify file paths against code when editing.

Witchcraft is a focused final water finish block for the active voxel water shader. It does not replace the water pipeline and does not add fog, sky, lighting, temporal anti-aliasing, generated normals, raymarched reflections, depth buffer plumbing, or unrelated shaderpack systems.

## Scope

- Final water color tinting.
- Optional RGB water color multiplier.
- Fresnel-driven alpha shaping.
- Optional reflection multiplier for the existing water reflection paths.

## Runtime controls

The config section lives in `assets/config/water.yaml` under `witchcraft_finish`. It is disabled by default.

Environment variables override config at startup:

- `VOXEL_WATER_WITCHCRAFT_FINISH=1`
- `VOXEL_WATER_WITCHCRAFT_STYLE=1|3`
- `VOXEL_WATER_WITCHCRAFT_LEGACY=1`
- `VOXEL_WATER_WITCHCRAFT_REFLECT_B=160|200`
- `VOXEL_WATER_WITCHCRAFT_DEBUG=0|1|2|3`

Debug counters are recorded as:

- `Water Witchcraft Finish Enabled`
- `Water Witchcraft Finish Mode`
- `Water Witchcraft Reflect Mult`
- `Water Witchcraft Debug Mode`

## Implementation notes

`src/rendering/witchcraft_water_finish.rs` owns the config, runtime params, CPU mirror, tests, shader module registration, and the startup override that installs the repo water fragment shader into the embedded `bevy_water` fragment shader handle. The WGSL finish logic lives in `assets/shaders/witchcraft_water_finish.wgsl` and is imported by `assets/shaders/water_fragment.wgsl`.
