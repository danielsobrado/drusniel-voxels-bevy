# Phase 2 — Bind NAADF Buffers Into the Radiance Cascade Pipeline

Status: implemented with perf caveat
Depends on: Phase 1
Produces code: yes (no visual change)

## Goal

Make the NAADF voxel, block, chunk, and chunk-lookup record buffers readable
by the radiance cascade compute pass, and flip
`naadf_gi_shader_backend_available()` to report the shader backend as
available once binding succeeds.

## Why

`radiance_cascades.wgsl` routes NAADF queries to `trace_naadf_gi_unavailable`
because the cascade pass cannot see the NAADF record buffers. The Rust gate
`naadf_gi_shader_backend_available()` forces the SDF backend until that is
fixed. Phase 2 supplies the buffers and flips the gate. It wires data, not
behavior — queries still resolve to SDF until Phase 3.

## Target files

```text
src/rendering/radiance_cascades.rs       (bind group layout + bind group + extract)
assets/shaders/radiance_cascades.wgsl    (binding declarations)
src/rendering/naadf/gpu_buffers.rs       (expose buffers to the cascade pass if needed)
```

## Work

### 2.1 Extend the cascade bind group layout

- Done. Using the NAADF record binding slots already used by the preview world
  trace (`@group(3)` bindings `0`, `1`, `5`, `11`, `20`), added storage-buffer
  bindings
  for: NAADF voxel records, material records, block records, chunk records,
  and the chunk lookup table.
- All read-only.

### 2.2 Provide the buffers, with a safe fallback

- Done. Bind the live buffers from `NaadfGpuBuffers` when the allocation exists and
  the NAADF cache is `ready`.
- Done. When NAADF is disabled, warming, stale, or the allocation is missing, bind
  small dummy buffers so the pipeline is always valid. The cascade shader must
  never fail to create its bind group because NAADF is off.

### 2.3 Declare the bindings in WGSL

- Done. Add the matching `@group(N) @binding(M)` declarations in
  `radiance_cascades.wgsl`.
- Done. Import `trace_naadf_world` (Phase 1) and the helpers in `lighting_queries.wgsl`
  so Phase 3 can call them. Importing without calling is fine.

### 2.4 Flip the backend-availability gate

- Done. `naadf_gi_shader_backend_available()` returns true once the cascade pipeline
  binds the NAADF buffers.
- Confirmed. `apply_radiance_backend_selection_with_shader_support()` already consumes
  this; confirm it now permits `GI_BACKEND_NAADF` to be *selectable*, while
  the shader still executes the SDF path because no query is wired yet.

### 2.5 Add the missing render-app pass shell

Phase 0 found that `radiance_cascades.rs` had no render-app pipeline or graph
node. Phase 2 now loads `assets/shaders/radiance_cascades.wgsl`, creates a
Core3d render graph node, queues HDR/SDR fullscreen pipelines, and binds both
the main cascade group and the NAADF record group. The current entry point is a
passthrough and only runs when the resolved backend is NAADF *and* at least one
NAADF query bit is enabled. With the Phase 2 query mask at zero, the pipeline
and buffers are valid but the pass does not draw.

## Acceptance criteria

- [x] Cascade bind group layout includes the five NAADF buffers.
- [x] Dummy buffers are bound when NAADF is unavailable; pipeline creation
      never fails.
- [x] `naadf_gi_shader_backend_available()` reports true when buffers are bound.
- [x] No visual change: every query still traces SDF this phase.
- [ ] GI bench frame time within noise of the Phase 0 baseline (binding
      unused buffers should cost almost nothing).

Perf caveat: the Phase 2 run is not within the archived Phase 0 frame-total
baseline. The cascade pass is inactive in the measured scene (`query_mask = 0`,
`naadf.gi_rays_last_frame = 0`), and NAADF-specific rows remain small, but the
overall frame total in current runs is higher than the archived baseline. Treat
this as unresolved bench comparability/perf follow-up rather than evidence that
the unused NAADF bindings are expensive.

## Verification

```powershell
rtk cargo check --features naadf
rtk cargo test --features naadf rendering::radiance_cascades --lib
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Actual verification:

```powershell
rtk cargo check
rtk cargo check --features naadf
rtk cargo test --features naadf rendering::radiance_cascades --lib
rtk cargo test --features naadf rendering::naadf --lib
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
rtk cargo run --bin bench_guard -- bench-runs/2026-05-16T14-33-26Z/summary.json
```

Latest bench:

- Run: `bench-runs/2026-05-16T14-33-26Z/summary.json`
- `bench_guard`: `PASS: 187 check(s), 0 warning(s)`
- Median frame: `41.82245 ms`
- P99 frame: `51.233 ms`
- `naadf.gi_rays_last_frame`: `0`
- `naadf.gpu_slots_used`: `282 / 384`
- `NAADF GPU Upload CPU`: `0.0 ms`
- `NAADF Chunk Table Sync`: `0.0598 ms` median
- `NAADF Dirty Queue`: `0.1881 ms` median

## Risks

- Binding NAADF buffers with the wrong `read_only` flag or a layout mismatch
  fails pipeline creation. Validate WGSL binding declarations against the Rust
  layout, the same way the build/preview pipelines already do.
- Forgetting the dummy-buffer fallback makes the GI pass crash whenever NAADF
  is disabled — a hard regression for the default configuration.

## Exit gate

NAADF buffers bound, fallback safe, gate flipped, render-app pass shell present,
zero query behavior change. Perf gate remains caveated as above.
