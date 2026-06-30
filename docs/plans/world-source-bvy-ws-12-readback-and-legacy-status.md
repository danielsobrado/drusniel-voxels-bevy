# BVY-WS-12 status — WorldSource visual-parity gate

## Current decision

CLOD/WorldSource is the default terrain path. MC/Transvoxel is legacy/fallback only and is not required for the WorldSource GPU biome/splat port.

## What is already wired

- `terrain_source.mode` defaults to `gpu_world_source`.
- `world_source_acceptance` refuses to run as an acceptance report unless `terrain_source.mode == gpu_world_source`.
- `world_source_acceptance` writes top-level `acceptance_pass` and `acceptance_blockers` fields.
- Missing GPU readback is a blocker, not a pass: the standalone report records `acceptance_pass: false` with `gpu_readback_unavailable` and `drift_gate_not_passed`.
- The render-app readback path has request extraction, compute dispatch, staging-buffer map/decode, shared-result publication, and opt-in runtime drift-gate evaluation behind `VOXEL_WORLD_SOURCE_DRIFT_READBACK=1` or `--runtime-assisted`.
- Runtime-assisted readback writes `bench-runs/world-source-runtime-acceptance/summary.json` by default; override with `VOXEL_WORLD_SOURCE_DRIFT_ACCEPTANCE_OUT`.
- Native Windows runtime verification on 2026-06-30 produced `acceptance_pass: true`, `gpu_readback.status: available`, 5 GPU samples, `drift_gate.status: passed`, 5 comparisons, and 0 failures.
- `world_source_acceptance` now validates the runtime artifact and records `runtime_gpu_readback_acceptance.status = accepted` before using its GPU readback/drift-gate result for top-level acceptance.
- WorldSource chunk generation uses biome-tagged material IDs.
- Surface Nets writes the terrain biome id into `uv0.y`.
- The triplanar terrain shader imports `world_source/biome_splat.wgsl` and resolves GPU splat weights from the biome id.
- The compatibility biome adapter is no longer exported from the mesh module and exists only as private fallback for explicit legacy mode.

## Remaining blocker before removing legacy bridge

The standalone bench path still uses `UnavailableWorldSourceGpuReadback` when no accepted runtime artifact is available. With the reviewed runtime artifact present, `world_source_acceptance` pairs the focused CPU/mesh bench report with the accepted GPU readback evidence.

Current state:

- `assets/shaders/world_source/drift_readback.wgsl` defines the compute-side contract.
- `GpuWorldSourceDriftReadbackDispatchPlan` defines buffer sizes and workgroup count.
- `decode_staged_gpu_world_source_drift_bytes()` decodes mapped bytes into `WorldSourceGpuReadbackResult`.
- `decode_staged_gpu_world_source_drift_readback()` maps the staging buffer after dispatch and updates `GpuWorldSourceDriftReadbackState.latest_result`.
- `GpuWorldSourceDriftReadbackSharedResult` exposes the latest mapped result to main-world acceptance code.

When no accepted runtime readback artifact is present, `WorldSourceDriftGateReport` remains `skipped` in `world_source_acceptance`, and `world_source_acceptance` reports `acceptance_pass: false` with blockers including:

- `gpu_readback_unavailable`
- `drift_gate_not_passed`

Accepted runtime-assisted evidence:

- Command: `rtk cargo run --release -- --runtime-assisted --bench bench/scenes/terrain/world-source-readback-acceptance.toml --bench-out bench-runs/world-source-runtime-readback`
- Runtime acceptance artifact: `bench-runs/world-source-runtime-acceptance/summary.json`
- Bench artifact: `bench-runs/world-source-runtime-readback/summary.json`
- Result: `acceptance_pass: true`, no blockers, `gpu_readback.status: available`, 5 samples, `drift_gate.status: passed`, 5 comparisons, 0 failures.
- Bench note: the scene run completed after a readiness timeout, but the readback acceptance artifact was written before the timeout and contains the accepted drift-gate result.
- Paired final report artifact: `bench-runs/world-source-runtime-paired/summary.json`, with `runtime_gpu_readback_acceptance.status: accepted`, top-level `acceptance_pass: true`, no blockers, `gpu_readback.status: available`, 5 samples, `drift_gate.status: passed`, 5 comparisons, and 0 failures.

## What not to do

- Do not spend BVY-WS-12 time porting MC/Transvoxel biome UVs.
- Do not mark visual parity accepted while GPU readback is skipped.
- Do not remove explicit legacy mode until the paired acceptance report, visual parity, and bench thresholds are reviewed together.

## Next implementation task

Use the paired report as the acceptance handoff, then continue legacy-removal gating:

1. Keep `world_source_acceptance` red when `runtime_gpu_readback_acceptance.status` is not `accepted`.
2. Re-run the runtime-assisted artifact before making visual or frame-timing claims that depend on current GPU output.
3. Remove or deprecate the legacy bridge only after the paired acceptance report, visual parity, and bench thresholds are reviewed together.

## Verification

```powershell
rtk cargo test --bin world_source_acceptance
rtk cargo test world::source
rtk cargo test voxel::meshing::biome_channel
rtk cargo test voxel::runtime::world_source_generation
rtk cargo test
```
