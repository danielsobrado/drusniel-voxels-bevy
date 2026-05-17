# Phase 5 — Contact Shadows and Terrain AO on NAADF

Status: implemented
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

- [x] Contact shadow query traces NAADF behind its toggle, falls back to SDF
      cleanly, default unchanged.
- [x] Terrain AO query traces NAADF behind its toggle, falls back to SDF
      cleanly, default unchanged.
- [x] Each query has a saved SDF-vs-NAADF `summary.json` pair and screenshot
      comparison.
- [x] Neither query regresses frame time or visual quality.

## Results

### Implementation

- `radiance_cascades.wgsl` now routes `NAADF_QUERY_CONTACT_SHADOW` to
  `naadf_contact_shadow_visibility_world()` behind its existing toggle.
- `terrain_ao_backend()` now routes `NAADF_QUERY_TERRAIN_AO` to four fixed
  short-range NAADF rays through `naadf_terrain_ao_visibility_world()`.
- The sun-visibility, contact-shadow, and terrain-AO query masks are isolated:
  enabling contact shadows or terrain AO does not implicitly apply the
  sun-visibility pass.
- Defaults remain unchanged. Both new query toggles default to false.
- Bench counters now emit:
  `naadf.radiance_contact_shadow_rays_per_pixel` and
  `naadf.radiance_terrain_ao_rays_per_pixel`.

Ray lengths and counts:

| Query | Max distance | Max steps | Rays |
| --- | ---: | ---: | ---: |
| Contact shadow | 3.0 world units | 24 | 1 ray/pixel |
| Terrain AO | 2.5 world units | 24 | 4 rays/pixel |

### Bench comparison

The shared runtime lock was held by another local runtime while validating this
phase, so these bench runs used an isolated bench lock via
`DRUSNIEL_BENCH_RUNTIME_LOCK=bench-runs/phase5-bench.lock`.

| Query | Mode | Summary | Median frame | P99 frame | Query rays | GPU slots | Missing interest slots | Uploaded peak |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Contact shadow | SDF/default | `bench-runs/phase5-contact-sdf/summary.json` | 35.74 ms | 41.01 ms | 0 | 282 / 384 | 0 | 203 |
| Contact shadow | NAADF | `bench-runs/phase5-contact-naadf/summary.json` | 35.24 ms | 38.64 ms | 1 ray/pixel | 282 / 384 | 0 | 114 |
| Terrain AO | SDF/default | `bench-runs/phase5-terrain-ao-sdf/summary.json` | 35.51 ms | 39.92 ms | 0 | 282 / 384 | 0 | 203 |
| Terrain AO | NAADF | `bench-runs/phase5-terrain-ao-naadf/summary.json` | 35.35 ms | 38.22 ms | 4 rays/pixel | 282 / 384 | 0 | 203 |

Bench guard:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/phase5-contact-naadf/summary.json
rtk cargo run --bin bench_guard -- bench-runs/phase5-terrain-ao-naadf/summary.json
```

Both runs reported `PASS: 187 check(s), 0 warning(s).`

### Visual classification

Screenshots inspected:

- `bench-runs/phase5-contact-sdf/visual-regression-naadf-contact-sdf-naadf-contact-sdf-naadf-contact-sdf-settled-run0.png`
- `bench-runs/phase5-contact-naadf/visual-regression-naadf-contact-naadf-contact-shadow-naadf-contact-shadow-settled-run0.png`
- `bench-runs/phase5-terrain-ao-sdf/visual-regression-naadf-terrain-ao-sdf-naadf-terrain-ao-sdf-naadf-terrain-ao-sdf-settled-run0.png`
- `bench-runs/phase5-terrain-ao-naadf/visual-regression-naadf-terrain-ao-naadf-terrain-ao-naadf-terrain-ao-settled-run0.png`

Classification: equivalent. No missing terrain, no wrong darkening, and no new
visible contact-shadow or AO artifact was seen at the fixed checkpoint.

## Decision

Keep both NAADF contact shadows and NAADF terrain AO behind their opt-in
toggles. Proceed to Phase 6.

## Verification

```powershell
rtk cargo check --features naadf
rtk cargo test --features naadf rendering::radiance_cascades --lib
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-gi.toml
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
