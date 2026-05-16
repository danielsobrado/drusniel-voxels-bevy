# Phase 4 — Validate Sun Visibility (Decision Gate)

Status: planned
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

- [ ] CPU/GPU sun-visibility ray parity verified on all GI bench fixtures.
- [ ] SDF vs NAADF `summary.json` comparison recorded with concrete numbers.
- [ ] SDF vs NAADF screenshot diff classified.
- [ ] The decision (keep / quality-only / stop) is written down with its
      supporting numbers.

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
