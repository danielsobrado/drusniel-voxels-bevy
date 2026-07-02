# Vegetation Alpha Depth Prepass

## Status

The vegetation alpha depth prepass is an opt-in diagnostic/performance path for procedural grass.

It is disabled by default in:

```text
assets/config/vegetation.yaml
```

```yaml
vegetation_depth_prepass:
  enabled: false
```

Enable it for A/B testing either by editing the config file or by using the env override:

```bash
VOXEL_VEGETATION_DEPTH_PREPASS=1 cargo run --release
```

The env var overrides the config file.

Accepted true values are:

```text
1
true
yes
on
enabled
```

All other env values keep the path disabled.

## What is currently implemented

- `GrassMaterial::enable_prepass()` is gated by a cached startup resolver.
- `assets/config/vegetation.yaml` provides the default config-file state.
- `VOXEL_VEGETATION_DEPTH_PREPASS` overrides the config file for A/B runs.
- `VegetationDepthPrepassConfig` records the startup state as a typed resource.
- Startup logs print `Vegetation depth prepass: off/on` with the source: `default`, `config`, or `env`.
- The timing recorder emits `Vegetation Depth Prepass Enabled` as `0` or `1` so bench output can prove which path ran.
- The default path remains unchanged.
- Grass shadow specialization remains disabled; this gate is for the camera depth prepass, not for shadow maps.
- The same `shaders/grass.wgsl` material path is used, so wind and alpha behavior are still owned by the grass material.

## Intended use

Use this only for dense near grass / foliage overdraw experiments.

Run paired captures:

```bash
cargo run --release -- --bench bench/scenes/visual-regression.toml
VOXEL_VEGETATION_DEPTH_PREPASS=1 cargo run --release -- --bench bench/scenes/visual-regression.toml
```

When render timing is needed outside bench mode:

```bash
VOXEL_RENDER_TIMING=1 cargo run --release
VOXEL_RENDER_TIMING=1 VOXEL_VEGETATION_DEPTH_PREPASS=1 cargo run --release
```

Compare:

```text
startup log: Vegetation depth prepass: off/on
__frame_total p50/p95
Vegetation Depth Prepass Enabled
Grass Collect
Grass Cull
Grass Animate
main pass / render graph timing rows if present
visual screenshots
```

## Correctness checks

When enabled, inspect:

```text
near grass edges
wind motion
alpha mask edges
near-camera fade
billboard / prop transitions
water reflections
shadow maps
```

Disable the prepass immediately if you see:

```text
leaf/grass halos
missing grass pixels
wind/depth mismatch
alpha fade popping
reflection camera artifacts
shadow changes
```

## Current limitation

This is not yet a custom depth-only vegetation material. It only enables Bevy's material prepass variant for the grass material when explicitly requested.

The previous code disabled prepass because of shader-variant mismatch risk. Keep this opt-in until visual and bench validation prove it is safe on the current Bevy renderer.

The prepass decision is resolved at startup because Bevy material prepass specialization is static. Changing the config file or env var requires restarting the app.

## Pending production work

```text
TODO: add bench render_toggles support once the bench schema path is verified.
TODO: add debug overlay text for the current prepass state.
TODO: implement a custom depth-only grass material if Bevy's built-in prepass variant still mismatches grass.wgsl.
TODO: extend to hero tree leaves / understory only after grass A/B data is clean.
```
