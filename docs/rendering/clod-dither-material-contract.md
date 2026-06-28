# CLOD dither material contract

`clod-poc` has a dedicated runtime dither material with:

- `uFadeAlpha`
- `uDitherRole`
- a 16×16 Bayer dither texture
- role ids: stable, fade-in, fade-out

The Rust port now has the same renderer-facing contract without replacing the
main Bevy terrain material yet:

- `src/voxel/pages/dither_material.rs`
- `assets/shaders/terrain/clod_dither.wgsl`

## Why this is split out

The crossfade state and runtime bridge are already independent of the render
backend. This PR adds the small missing material contract so the next PR can
wire page fade components into the actual terrain material/shader path with a
minimal diff.

## Shader policy

The Rust helper and WGSL helper both treat `fade_alpha` as literal visibility:

- stable: always visible;
- fade-in: visible where the Bayer threshold is below alpha;
- fade-out: visible where the complementary Bayer threshold remains above
  `1.0 - alpha`.

That gives complementary masks for old/new cuts and avoids both pages drawing the
same pixels during most of the transition.

## Next integration step

Wire `ClodPageFade { alpha, role }` from `crossfade_runtime.rs` into the CLOD
page terrain material uniforms, then call:

```wgsl
clod_apply_dither_clip(fragment_position.xy, clod_fade_alpha, clod_dither_role);
```

from the fragment shader before returning the final color.
