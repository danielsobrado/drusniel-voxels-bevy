# Phase 3 — Sun Visibility / Soft Shadow on NAADF

Status: planned
Depends on: Phase 2
Produces code: yes (first real behavior change)

## Goal

Make `soft_shadow_backend()` in `radiance_cascades.wgsl` trace NAADF for the
`NAADF_QUERY_SUN_VISIBILITY` query, behind `RayTracingSettings`. Exactly one
query class. Everything else stays on SDF.

## Why

Sun visibility is the simplest query: a single ray, a binary occluded/clear
result. It is the safest first production consumer of NAADF traversal and the
cleanest thing to A/B in Phase 4.

## Target files

```text
assets/shaders/radiance_cascades.wgsl    (soft_shadow_backend body)
assets/shaders/naadf/lighting_queries.wgsl (naadf_sun_visibility, if adjusted)
src/rendering/radiance_cascades.rs       (confirm selection + fallback policy)
src/rendering/ray_tracing.rs             (RayTracingSettings exposure)
```

## Work

### 3.1 Replace the stub call in `soft_shadow_backend`

- `soft_shadow_backend()` currently calls `trace_naadf_gi_unavailable()` when
  `use_naadf_for_query(NAADF_QUERY_SUN_VISIBILITY)` is true.
- Replace that with a real NAADF trace: build a `NaadfRay` toward the sun and
  call `naadf_sun_visibility` (from `lighting_queries.wgsl`), which wraps
  `trace_naadf_world`.
- Apply any coordinate conversion recorded in Phase 0.2 when constructing the
  ray origin and direction.
- Keep `soft_shadow_sdf` as the path for the non-NAADF branch.

### 3.2 Decide NAADF vs SDF shadow shape

- The SDF path produces penumbra via `soft_shadow_sdf`. A single NAADF ray is
  a hard occlusion test.
- For Phase 3, a hard NAADF shadow is acceptable as long as it is not visually
  worse than SDF. If penumbra loss is unacceptable, take a small fixed number
  of jittered NAADF rays and average. Keep the ray count low and fixed; record
  it.

### 3.3 Honor cache readiness

- When the NAADF cache is warming or stale, or on integrated GPU, selection
  must already resolve to SDF via `apply_radiance_backend_selection`. Confirm
  `soft_shadow_backend` is never reached with NAADF selected while the cache
  is not `ready`.

### 3.4 Expose the toggle

- Ensure `RayTracingSettings` can select the NAADF backend for sun visibility
  and that `voxel_backend_query_mask` carries `NAADF_QUERY_SUN_VISIBILITY`.
- Default remains SDF. NAADF sun visibility is opt-in this phase.

## Acceptance criteria

- [ ] With NAADF selected for sun visibility, `soft_shadow_backend` traces
      NAADF; with SDF selected, it traces SDF.
- [ ] Warming / stale cache and integrated GPU fall back to SDF with no
      flicker on stream-in.
- [ ] Default configuration is unchanged (SDF).
- [ ] NAADF sun shadows are no worse than SDF on the GI bench checkpoints.
- [ ] GI bench frame time is not worse than the Phase 0 baseline.

## Verification

```powershell
rtk cargo check --features naadf
rtk cargo test --features naadf rendering::radiance_cascades --lib
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Run the bench once with sun visibility forced to SDF and once forced to NAADF;
keep both `summary.json` files for Phase 4.

## Risks

- A single hard NAADF ray vs SDF penumbra can read as harsher shadows. If so,
  the jittered-sample option in 3.2 is the mitigation — do not silently ship a
  visual regression.
- Coordinate conversion errors surface here first. A wrong origin traces empty
  space and every surface reads as lit.

## Exit gate

Sun visibility traces NAADF behind the toggle, falls back cleanly, default
unchanged, no visual or perf regression. Both A/B `summary.json` runs saved.
