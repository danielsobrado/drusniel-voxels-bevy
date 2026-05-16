# Phase 5 — Contact Shadows and Terrain AO on NAADF

Status: planned
Depends on: Phase 4 (passed)
Produces code: yes

## Goal

Extend NAADF traversal to two more query classes, one at a time, each with its
own bench and visual gate:

- `NAADF_QUERY_CONTACT_SHADOW`
- `NAADF_QUERY_TERRAIN_AO` via `terrain_ao_backend()`

## Why

These are short-range occlusion queries. NAADF traversal at full voxel
resolution should resolve them more accurately than the blurry SDF volume,
and short rays keep the per-query cost low. They are the natural next step
after sun visibility.

## Target files

```text
assets/shaders/radiance_cascades.wgsl     (terrain_ao_backend + contact shadow path)
assets/shaders/naadf/lighting_queries.wgsl (naadf_terrain_ao_visibility,
                                            naadf_contact_shadow_visibility,
                                            naadf_short_range_occlusion)
src/rendering/radiance_cascades.rs        (query mask wiring)
```

## Work

Do contact shadows first, then terrain AO. For each, in order:

### 5.1 Wire the query

- Replace the SDF-only branch with a NAADF branch gated by
  `use_naadf_for_query(<mask>)`, calling the matching helper in
  `lighting_queries.wgsl` (`naadf_contact_shadow_visibility` /
  `naadf_terrain_ao_visibility`, both built on `naadf_short_range_occlusion`).
- Apply the Phase 0.2 coordinate conversion.
- Keep the SDF branch for the non-NAADF path and for cache-not-ready fallback.

### 5.2 Tune ray length and count

- Contact shadows and AO use short rays. Pick a max distance consistent with
  the SDF path's effective range so the comparison is fair.
- Keep ray counts low and fixed; record them.

### 5.3 Per-query bench and visual gate

- Bench with the query forced to SDF, then to NAADF.
- Compare `summary.json` and fixed-checkpoint screenshots.
- A query only ships if it is no worse visually and not worse on frame time.

### 5.4 Update the parity matrix

- Record each query's status and evidence in `naadf-upstream-parity.md`.

## Acceptance criteria

- [ ] Contact shadow query traces NAADF behind its toggle, falls back to SDF
      cleanly, default unchanged.
- [ ] Terrain AO query traces NAADF behind its toggle, falls back to SDF
      cleanly, default unchanged.
- [ ] Each query has a saved SDF-vs-NAADF `summary.json` pair and screenshot
      comparison.
- [ ] Neither query regresses frame time or visual quality.

## Verification

```powershell
rtk cargo check --features naadf
rtk cargo test --features naadf rendering::radiance_cascades --lib
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Risks

- Routing both queries at once hides which one caused a regression. Wire and
  bench them separately.
- AO that samples too short reads flat; too long reads as soft shadowing.
  Match the SDF path's effective AO range.

## Exit gate

Contact shadows and terrain AO each trace NAADF behind a toggle, each gated by
its own bench/visual evidence, defaults unchanged.
