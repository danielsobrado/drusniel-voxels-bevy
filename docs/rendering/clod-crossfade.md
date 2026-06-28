# CLOD crossfade state

`voxel::pages::crossfade` ports the transition model from the public `tools/clod-poc` runtime into Rust.

The PoC has three separate concepts:

- `clodCrossfade.ts`: compares the previous and next active cuts, starts a transition, and assigns per-node fade state.
- `clodDitherMaterial.ts`: uses a 4x4 Bayer pattern as a screen-door dither mask.
- `clodCutFreeze.ts`: freezes selection for debugging.

The Rust module intentionally lands only the renderer-agnostic part:

- `ClodCutSnapshot`
- `ClodTransition`
- `ClodFadeState`
- `ClodDitherRole`
- `ClodCrossfadeSequencer`
- `generate_dither_pattern(size)`

## Behaviour

When the active cut changes:

1. nodes present in the previous cut but absent from the next cut become `FadeOut`;
2. nodes absent from the previous cut but present in the next cut become `FadeIn`;
3. unchanged nodes remain `Stable`;
4. after `duration_frames`, only the stable next cut remains visible.

The dither pattern is byte-valued `0..=15`; shader code can normalize it as `threshold = value / 16.0`.

## Next integration step

A follow-up render PR should map `ClodFadeState` onto page mesh entities/materials:

- keep old page entities alive while they fade out;
- spawn new page entities with `fade_alpha = 0.0` and `FadeIn`;
- pass `fade_alpha` and `dither_role` to a CLOD terrain material specialization;
- remove fade-out page entities once `is_transition_complete()` returns true.

This keeps policy and rendering separate and makes the transition logic easy to unit-test.
