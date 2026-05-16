# Phase 2 — Bind NAADF Buffers Into the Radiance Cascade Pipeline

Status: planned
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

- Using the free slots identified in Phase 0.3, add storage-buffer bindings
  for: NAADF voxel records, material records, block records, chunk records,
  and the chunk lookup table.
- All read-only.

### 2.2 Provide the buffers, with a safe fallback

- Bind the live buffers from `NaadfGpuBuffers` when the allocation exists and
  the NAADF cache is `ready`.
- When NAADF is disabled, warming, stale, or the allocation is missing, bind
  small dummy buffers so the pipeline is always valid. The cascade shader must
  never fail to create its bind group because NAADF is off.

### 2.3 Declare the bindings in WGSL

- Add the matching `@group(N) @binding(M)` declarations in
  `radiance_cascades.wgsl`.
- Import `trace_naadf_world` (Phase 1) and the helpers in `lighting_queries.wgsl`
  so Phase 3 can call them. Importing without calling is fine.

### 2.4 Flip the backend-availability gate

- `naadf_gi_shader_backend_available()` returns true once the cascade pipeline
  binds the NAADF buffers.
- `apply_radiance_backend_selection_with_shader_support()` already consumes
  this; confirm it now permits `GI_BACKEND_NAADF` to be *selectable*, while
  the shader still executes the SDF path because no query is wired yet.

## Acceptance criteria

- [ ] Cascade bind group layout includes the five NAADF buffers.
- [ ] Dummy buffers are bound when NAADF is unavailable; pipeline creation
      never fails.
- [ ] `naadf_gi_shader_backend_available()` reports true when buffers are bound.
- [ ] No visual change: every query still traces SDF this phase.
- [ ] GI bench frame time within noise of the Phase 0 baseline (binding
      unused buffers should cost almost nothing).

## Verification

```powershell
rtk cargo check --features naadf
rtk cargo test --features naadf rendering::radiance_cascades --lib
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Risks

- Binding NAADF buffers with the wrong `read_only` flag or a layout mismatch
  fails pipeline creation. Validate WGSL binding declarations against the Rust
  layout, the same way the build/preview pipelines already do.
- Forgetting the dummy-buffer fallback makes the GI pass crash whenever NAADF
  is disabled — a hard regression for the default configuration.

## Exit gate

NAADF buffers bound, fallback safe, gate flipped, zero visual change, no perf
regression.
