# WorldSource parity test ledger

Last updated: 2026-06-30.

Scope: BVY-WS-12 WorldSource GPU readback acceptance, paired acceptance, visual-regression readiness, and legacy-bridge removal gating.

## Current summary

| Area | Status | Evidence |
| --- | --- | --- |
| Runtime-assisted GPU readback | Pass | `bench-runs/world-source-runtime-acceptance/summary.json` records `acceptance_pass: true`, no blockers, `gpu_readback.status: available`, 5 samples, `drift_gate.status: passed`, 5 comparisons, and 0 failures. |
| Paired `world_source_acceptance` | Pass | `bench-runs/world-source-runtime-paired/summary.json` records `runtime_gpu_readback_acceptance.status: accepted`, top-level `acceptance_pass: true`, no blockers, available GPU readback, and passed drift gate. |
| Missing-runtime-artifact path | Expected red | `world_source_acceptance` must stay red when the runtime artifact is missing or rejected, with `gpu_readback_unavailable` and `drift_gate_not_passed`. |
| Visual-regression render-ready | Pass | `bench-runs/2026-06-30T15-14-58Z/summary.json` has 7 checkpoints, all with `ready_timed_out: false`, `render_ready_timed_out: false`, and `render_ready_wait_frames: 90`. |
| Visual `bench_guard` | Fail | `bench_guard` still fails frame-total thresholds: ridge p99, jump avg/p99, and forest avg/p99. GPU opaque, mesh dirty, and instancing checks pass. |
| Legacy bridge removal | Blocked | Wait for accepted paired report, visual parity review, and frame-total guard resolution. |

## Commands and results

Run commands through `rtk` except Vite/Vitest commands under `tools/clod-poc`.
Runtime and visual benches must be run from native Windows, not WSL.

### Runtime readback acceptance

```powershell
rtk cargo run --release -- --runtime-assisted --bench bench/scenes/terrain/world-source-readback-acceptance.toml --bench-out bench-runs/world-source-runtime-readback
```

Result:

- Status: pass.
- Runtime artifact: `bench-runs/world-source-runtime-acceptance/summary.json`.
- Bench artifact: `bench-runs/world-source-runtime-readback/summary.json`.
- Acceptance fields: `acceptance_pass: true`, `acceptance_blockers: []`, `gpu_readback.status: available`, 5 GPU samples, `drift_gate.status: passed`, 5 comparisons, 0 failures.
- Note: the scene run can complete after a readiness timeout; the acceptance artifact is valid when written before timeout and accepted by the drift gate.

### Paired focused acceptance

```powershell
rtk cargo run --release --bin world_source_acceptance -- --run-name world-source-runtime-paired
```

Result:

- Status: pass.
- Artifact: `bench-runs/world-source-runtime-paired/summary.json`.
- Acceptance fields: `runtime_gpu_readback_acceptance.status: accepted`, `acceptance_pass: true`, `acceptance_blockers: []`, `gpu_readback.status: available`, 5 samples, `drift_gate.status: passed`, 5 comparisons, 0 failures.
- `material_draw_impact.compatibility_biome_channel_active: false`.

### Visual-regression bench

```powershell
rtk cargo run --release -- --bench bench/scenes/visual/visual-regression.toml
```

Latest accepted readiness artifact:

- Artifact: `bench-runs/2026-06-30T15-14-58Z/summary.json`.
- Screenshots:
  - `visual-regression-ridge-run-noon-end-run0.png`
  - `visual-regression-jump-water-sunset-landing-run0.png`
  - `visual-regression-forest-look-sweep-right-run0.png`
  - `visual-regression-forest-ssao-baked-off-end-run0.png`
  - `visual-regression-ridge-fog-god-rays-end-run0.png`
  - `visual-regression-forest-shadow-ray-flag-end-run0.png`
  - `visual-regression-photo-cinematic-effects-end-run0.png`
- Render-ready status: all 7 checkpoints passed.
- Render-ready diagnostics: each run records `render_ready_signature`, `render_ready_signature_changes`, `render_ready_last_changed_fields`, and `render_ready_max_stable_frames`.

### Visual bench guard

```powershell
rtk cargo run --bin bench_guard -- bench-runs/2026-06-30T15-14-58Z/summary.json
```

Result:

- Status: fail.
- Failed checks:
  - `ridge_frame_p99`: `40.205 ms`, fail threshold `20.310 ms`.
  - `jump_frame_avg`: `17.393 ms`, fail threshold `12.220 ms`.
  - `jump_frame_p99`: `52.128 ms`, fail threshold `13.640 ms`.
  - `forest_frame_avg`: `17.377 ms`, fail threshold `13.870 ms`.
  - `forest_frame_p99`: `50.993 ms`, fail threshold `17.000 ms`.
- Passing checks include:
  - `ridge_frame_avg`: `6.113 ms`.
  - instancing prepare avg for ridge, jump, and forest.
  - mesh dirty p99 for ridge, jump, and forest.
  - GPU opaque avg for ridge, jump, and forest.
  - instanced group and instance count guards.

## Focused Rust tests

These were run after the render-ready gate update:

```powershell
rtk cargo test --lib diagnostics::bench
rtk cargo test --lib world::source::drift_readback_acceptance
rtk cargo test --lib world::source::drift_readback_runtime_acceptance
rtk cargo test --bin world_source_acceptance
```

Results:

- `diagnostics::bench`: 26 passed, 912 filtered out.
- `world::source::drift_readback_acceptance`: 3 passed, 935 filtered out.
- `world::source::drift_readback_runtime_acceptance`: 4 passed, 934 filtered out.
- `world_source_acceptance` binary tests: 8 passed.

Earlier parity-focused tests in this lane:

```powershell
rtk cargo test --lib voxel::meshing::biome_channel
rtk cargo test --lib voxel::runtime::world_source_generation
```

Recorded results:

- `voxel::meshing::biome_channel`: 5 passed.
- `voxel::runtime::world_source_generation`: 2 passed.

## Not run in the latest pass

- Full `rtk cargo test`.
- clod-poc Vite/Vitest checks. These are not required for the Bevy WorldSource readback gate unless clod-poc files change; if needed, run Vite-based commands directly, not through `rtk`.
- Fresh runtime-assisted readback after the render-ready fix. The accepted runtime artifact remains the current reviewed GPU readback evidence.

## Next required verification

Before removing or further deprecating the explicit legacy path:

1. Fix or explain the visual-regression frame-total guard failures.
2. Re-run native Windows visual-regression and `bench_guard`.
3. Re-run runtime-assisted readback if making new GPU-output or frame-timing claims.
4. Re-run the focused Rust tests above.
