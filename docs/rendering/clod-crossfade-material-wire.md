# CLOD crossfade material wiring

This PR connects the renderer-agnostic crossfade bridge to the CLOD page terrain
material.

It is still opt-in:

```bash
CLOD_PAGES=1 \
VOXEL_CLOD_CROSSFADE_BRIDGE=1 \
VOXEL_CLOD_CROSSFADE_MATERIAL=1 \
cargo run --release
```

## Data flow

1. `selection.rs` picks the active CLOD cut.
2. `crossfade_runtime.rs` turns cut changes into `ClodPageFade` components.
3. `fade_material.rs` writes those fade values into each page material.
4. `triplanar_terrain.wgsl` calls `clod_apply_dither_clip()` before shading.

Each CLOD page already owns its own cloned `TriplanarMaterial`, so per-page fade
uniforms do not affect live chunks or other terrain material quality variants.

## Uniform contract

`TriplanarUniforms` now carries:

- `clod_fade`: visibility alpha, where `0.0` is hidden and `1.0` is visible;
- `clod_dither_role`: `0 = stable`, `1 = fade-in`, `2 = fade-out`.

The role ids are the same as `src/voxel/pages/dither_material.rs` and
`assets/shaders/terrain/clod_dither.wgsl`.

## Why this remains behind a flag

This is the first visual bridge from the PoC transition model into the Bevy
material. Keeping `VOXEL_CLOD_CROSSFADE_MATERIAL` separate from
`VOXEL_CLOD_CROSSFADE_BRIDGE` lets us test ECS transition state, debug overlays,
and shader clipping independently.

## Validation

Recommended local pass:

```bash
cargo test voxel::pages::dither_material voxel::pages::fade_material
CLOD_PAGES=1 VOXEL_CLOD_CROSSFADE_BRIDGE=1 VOXEL_CLOD_CROSSFADE_MATERIAL=1 cargo run --release
```
