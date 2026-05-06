# Shader Weather Rendering

Drusniel weather is shader-first. The CPU owns a small `WeatherRuntime` resource and only updates uniforms, quality flags, and debug counters. Rain, snow, terrain wetness, puddles, snow tint, water reflection response, fog, and god-ray attenuation are evaluated in WGSL where practical.

## Runtime Selection

`VOXEL_WEATHER=clear|rain|snow` selects the startup weather kind. `VOXEL_WEATHER_QUALITY=off|low|medium|high|ultra` selects the weather shader quality cap.

In a live build, the debug test keys are:

- `F2`: cycle clear, rain, and snow shader paths.
- `Shift+F2`: cycle weather quality from Off through Ultra.
- `Ctrl+F2`: cycle the global render preset from Low through Performance100.

The hotkeys are for visual A/B testing only. Bench scenes should still use their TOML quality preset and fixed environment variables for repeatable measurements.

## GPU Effects

- `assets/shaders/weather_common.wgsl` contains shared remap, mask, and cheap noise helpers.
- `assets/shaders/weather_overlay.wgsl` generates fullscreen rain streaks and snow flakes from the weather uniforms.
- `assets/shaders/triplanar_terrain.wgsl` applies shader-side wetness, puddles, animated puddle normals on higher quality, and snow tint.
- `assets/shaders/blocky_terrain.wgsl` applies a cheaper blocky wetness, puddle, and snow response without extra textures.
- `assets/shaders/water_reflection_compositor.wgsl` uses rain and snow factors to adjust reflection blend and distortion.
- `assets/shaders/god_rays.wgsl` attenuates god rays during rain and snow without increasing sample count.

## Explicit Non-Goals

This system does not implement weather physics. It does not spawn CPU rain or snow particles, mutate voxels for snow accumulation, build CPU puddle maps, trace rain collisions, or drive `WaterDisplacementPlugin` from rain.

## Profiling

Weather changes that affect rendering should be checked with a release bench:

```powershell
cargo run --release -- --bench bench/scenes/visual-regression.toml
```

Compare `bench-runs/<run>/summary.json` before and after. Use the weather counters and timing rows such as `Weather Rain Factor`, `Weather Overlay Density`, `Weather Overlay Pass Active`, `Material Sync Weather`, `Weather Fog Mult`, `Weather GodRay Intensity Mult`, and water weather boost counters. Do not add overlapping timing rows together.
