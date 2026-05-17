# Phase 4 — Validate Sun Visibility (Decision Gate)

Status: implemented
Depends on: Phase 3
Produces code: tests and harness only

## Goal

Decide, on measured evidence, whether NAADF sun visibility is worth keeping
and worth extending to the remaining query classes. This is a real stop point.

## Why

Phases 5 and 6 are only justified if NAADF traversal is at least neutral
against SDF for the simplest query. If sun visibility already regresses
performance or quality, the harder queries will not improve and the plan
should pause here to fix the cause first.

## Work

### 4.1 CPU vs GPU ray parity

- Use or extend the existing NAADF ray comparison harness to compare CPU
  `trace_naadf` results against the GPU traversal for a fixed set of
  sun-direction rays across the GI bench fixtures.
- Mismatches indicate a traversal or layout bug, not a tuning issue.

### 4.2 A/B the Phase 3 bench runs

- Compare the SDF-forced and NAADF-forced `summary.json` files from Phase 3.
- Extract: GI pass timing rows, median frame time, p99, average and (if
  wired) actual ray-step counts.

### 4.3 Visual diff

- Compare the fixed-checkpoint screenshots SDF vs NAADF.
- Classify the difference: sharper (acceptable), equivalent (acceptable),
  missing or wrong occlusion (not acceptable).

### 4.4 Record the decision

Write the outcome into this file and into `naadf-upstream-parity.md`.

## Decision gate — three outcomes

- **Better or equal quality, neutral or faster.**
  Keep NAADF sun visibility. Proceed to Phase 5.

- **Equal quality, slower.**
  Path A is a quality play only, not a performance play. Continue to Phase 5
  only if the quality gain elsewhere justifies the cost. Document this choice.

- **Worse quality, or much slower.**
  Stop. Do not proceed to Phase 5. The most likely cause is skip-efficiency:
  the conservative single-dispatch chunk-bounds build
  (`build_chunk_bounds.wgsl`) limits how far a ray skips through empty space.
  Fix that (upstream-style queue propagation) and re-run Phases 3-4 before
  continuing.

## Acceptance criteria

- [x] CPU/GPU sun-visibility ray parity verified on all GI bench fixtures.
- [x] SDF vs NAADF `summary.json` comparison recorded with concrete numbers.
- [x] SDF vs NAADF screenshot diff classified.
- [x] The decision (keep / quality-only / stop) is written down with its
      supporting numbers.

## Results

### CPU/GPU sun-visibility parity

`tests/naadf_gpu_layout.rs` now includes a headless `wgpu` dispatch that imports
the production NAADF `world_trace` and `lighting_queries` WGSL helpers, traces a
fixed sun-visibility ray set, reads back the GPU clear/blocked result, and
compares it against `NaadfCpuRayBackend` for every fixture in
`tests/fixtures/naadf/`.

Verified:

```powershell
rtk cargo test --features naadf --test naadf_gpu_layout
rtk cargo test --features naadf --test naadf_cpu_layout
rtk cargo test --features naadf rendering::naadf --lib
```

Result: all tests passed. The GPU sun-visibility dispatch matched CPU results
for the full fixture set.

### Bench comparison

Phase 3 produced the A/B bench pair used for this gate:

| Mode | Summary | Median frame | P99 frame | GPU slots | Interest chunks | Missing interest slots | Uploaded peak | GI rays |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SDF sun visibility | `bench-runs/phase3-sdf/summary.json` | 58.99 ms | 92.22 ms | 282 / 384 | 174 | 0 | 203 | 0 |
| NAADF sun visibility | `bench-runs/phase3-naadf-sun/summary.json` | 40.24 ms | 55.30 ms | 282 / 384 | 174 | 0 | 114 | 0 |

NAADF-specific timing rows in the NAADF-sun run stayed small:

| Row | Median | P99 |
| --- | ---: | ---: |
| `NAADF Cache Rebuild` | 0.00002 ms | 0.001 ms |
| `NAADF Chunk Table Sync` | 0.06278 ms | 0.117 ms |
| `NAADF Dirty Queue` | 0.19983 ms | 0.410 ms |
| `NAADF GPU Upload CPU` | 0.00000 ms | 0.000 ms |
| `NAADF Streaming` | 0.09432 ms | 0.213 ms |

`naadf.avg_ray_steps_last_frame` and `naadf.max_ray_steps_last_frame` remain
zero in these runs because the radiance-cascade sun-visibility path does not yet
publish per-query ray-step telemetry. That is an observability gap, not a gate
failure for this phase.

Bench guard:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/phase3-naadf-sun/summary.json
```

Result: `PASS: 187 check(s), 0 warning(s).`

### Visual classification

Screenshots inspected:

- `bench-runs/phase3-sdf/visual-regression-naadf-gi-naadf-gi-experimental-naadf-gi-settled-run0.png`
- `bench-runs/phase3-naadf-sun/visual-regression-naadf-gi-sun-naadf-gi-sun-visibility-naadf-gi-sun-settled-run0.png`

Classification: equivalent. No missing or wrong occlusion was visible at the
fixed checkpoint. The NAADF run did not introduce obvious sun-shadow artifacts
or terrain coverage loss.

## Decision

Keep NAADF sun visibility and proceed to Phase 5.

The measured pair is neutral-to-better for this checkpoint and passes the visual
gate. Treat the apparent frame-time win cautiously because this is one bench
pair, not a broad performance claim. The gate evidence is strong enough to
continue extending NAADF to contact shadows and terrain AO, but not enough to
claim overall GI parity or a general renderer speedup.

## Verification

```powershell
rtk cargo test --features naadf rendering::naadf --lib
rtk cargo test --features naadf --test naadf_cpu_layout
rtk cargo run --bin bench_guard -- bench-runs/<naadf-run>/summary.json
```

## Risks

- The temptation to proceed on hope rather than numbers. The gate exists to be
  honored. A slower-and-not-better result means stop, not "fix it later".

## Exit gate

A written, evidence-backed decision. Either Phase 5 is justified, or the plan
pauses for a chunk-bounds fix, or Path A stops here.
