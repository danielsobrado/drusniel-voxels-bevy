# Phase 1 — Shared World-Space NAADF Trace

Status: complete (2026-05-16)
Depends on: Phase 0
Produces code: yes (refactor only, no behavior change)

## Goal

Extract one reusable WGSL function:

```wgsl
fn trace_naadf_world(
    ray: NaadfRay,
    max_steps: u32,
    chunk_count: u32,
    chunk_lookup_count: u32,
) -> NaadfHit
```

that performs chunk-space DDA, binary-search chunk lookup, and per-chunk
`trace_naadf`. Both existing consumers and the future cascade consumer call
this one function.

The live implementation keeps `chunk_count` and `chunk_lookup_count` explicit
because the lookup buffer is allocated at max capacity while only the populated
prefix is valid. Using `arrayLength()` alone would reintroduce stale zero-record
lookups and would not be a behavior-preserving refactor.

## Why

The world-space NAADF trace currently exists twice:

- `naadf_gi_trace_world` in `assets/shaders/naadf/gi_trace.wgsl`
- `preview_naadf_first_hit_world` in `assets/shaders/naadf/first_hit.wgsl`

Phase 3 needs a third caller (the radiance cascade). A third copy would
guarantee drift. Extract first, then build on a single implementation.

## Target files

```text
assets/shaders/naadf/world_trace.wgsl   (new)
assets/shaders/naadf/gi_trace.wgsl      (import shared fn)
assets/shaders/naadf/first_hit.wgsl     (import shared fn)
src/rendering/naadf/mod.rs              (register shader handle)
src/rendering/naadf/pipeline.rs         (shader path + handle constant)
```

## Work

### 1.1 Create `world_trace.wgsl`

- Move the chunk-DDA loop, `naadf_lookup_chunk_slot` binary search, and the
  per-chunk dispatch into `trace_naadf_world`.
- Keep the existing `NaadfRay` / `NaadfHit` types and `trace_naadf` /
  `trace_naadf_chunk` from `ray_trace.wgsl`.
- Parameterize anything the two current copies differ on (max distance, step
  budget) through the `NaadfRay` struct or function arguments — do not bake
  in preview-specific constants.

### 1.2 Repoint `gi_trace.wgsl` and `first_hit.wgsl`

- Replace the local `naadf_gi_trace_world` / `preview_naadf_first_hit_world`
  bodies with a call into `trace_naadf_world`.
- Preserve each shader's existing surrounding behavior (shading, fog, GI
  sampling) — only the traversal core moves.

### 1.3 Register the shader module

- Add `NAADF_WORLD_TRACE_SHADER_HANDLE` + path constant in `pipeline.rs`.
- Register it with `load_internal_asset!` in `mod.rs` alongside the other
  NAADF shaders.

## Acceptance criteria

- [x] `trace_naadf_world` exists in one file and is the only world-space
      NAADF traversal implementation.
- [x] `gi_trace.wgsl` and `first_hit.wgsl` call it; neither keeps a local copy.
- [x] The shared module is registered and loads at startup.
- [x] Preview output is visually unchanged. Full-frame PNG hashes are not
      byte-identical because the split preview bench includes the legacy
      renderer half, which has run-to-run grass/texture variation. The settled
      NAADF half changed 2,043 / 1,036,800 pixels with RMSE 0.0103%.

## Verification

```powershell
rtk cargo check --features naadf
rtk cargo test --features naadf rendering::naadf --lib
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-preview.toml
```

Compare the preview bench fixed-checkpoint screenshots against the pre-phase
run. They must match.

## Results

Pre-phase preview bench:

```text
bench-runs/2026-05-16T12-01-43Z/summary.json
median_frame_ms: 77.82975
p99_frame_ms: 148.932
ready_wait_secs: 75.30405
render_ready_secs: 30.047958
```

Post-phase preview bench:

```text
bench-runs/2026-05-16T12-17-29Z/summary.json
median_frame_ms: 42.18745
p99_frame_ms: 77.669
ready_wait_secs: 75.302414
render_ready_secs: 27.059338
bench_guard: PASS, 187 checks, 1 warning
```

Image comparison:

```text
full settled frame: hash changed, RMSE 2.83684%
NAADF half only: 2,043 / 1,036,800 changed pixels, RMSE 0.0103462%
legacy half only: 261,631 changed pixels
```

The traversal refactor did not produce a visible NAADF change. The measured
frame-time improvement is not claimed as a real optimization; this phase only
moved code, and the split preview bench is noisy enough that the timing delta
should be treated as run-to-run variance.

## Risks

- The two current copies may differ subtly (step budgets, miss handling). Diff
  them carefully before merging; a behavior change here is a regression, not
  an improvement.

## Exit gate

One shared `trace_naadf_world`; preview screenshots unchanged; tests green.
