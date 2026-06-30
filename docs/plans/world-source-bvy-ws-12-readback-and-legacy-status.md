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
- WorldSource chunk generation uses biome-tagged material IDs.
- Surface Nets writes the terrain biome id into `uv0.y`.
- The triplanar terrain shader imports `world_source/biome_splat.wgsl` and resolves GPU splat weights from the biome id.
- The compatibility biome adapter exists only as a named fallback after material tags and active `ProceduralWorldSource` sampling.

## Remaining blocker before removing legacy bridge

The standalone acceptance report still uses `UnavailableWorldSourceGpuReadback`, and the opt-in runtime readback artifact has not yet been verified on native Windows and promoted to the final accepted evidence.

Current state:

- `assets/shaders/world_source/drift_readback.wgsl` defines the compute-side contract.
- `GpuWorldSourceDriftReadbackDispatchPlan` defines buffer sizes and workgroup count.
- `decode_staged_gpu_world_source_drift_bytes()` decodes mapped bytes into `WorldSourceGpuReadbackResult`.
- `decode_staged_gpu_world_source_drift_readback()` maps the staging buffer after dispatch and updates `GpuWorldSourceDriftReadbackState.latest_result`.
- `GpuWorldSourceDriftReadbackSharedResult` exposes the latest mapped result to main-world acceptance code.

Until real mapped GPU readback samples are accepted by the final report, `WorldSourceDriftGateReport` must remain `skipped` in `world_source_acceptance`, and `world_source_acceptance` must report `acceptance_pass: false` with blockers including:

- `gpu_readback_unavailable`
- `drift_gate_not_passed`

## What not to do

- Do not spend BVY-WS-12 time porting MC/Transvoxel biome UVs.
- Do not mark visual parity accepted while GPU readback is skipped.
- Do not remove the compatibility fallback until the acceptance report has real GPU readback and `acceptance_pass: true`.

## Next implementation task

Verify and promote the runtime-assisted readback path:

1. Run `rtk cargo run --release -- --runtime-assisted --bench bench/scenes/terrain/world-source-readback-acceptance.toml --bench-out bench-runs/world-source-runtime-readback` from a native Windows shell.
2. Confirm the runtime log reports `gpu_readback=Available` and `drift_gate=Passed`.
3. Review `bench-runs/world-source-runtime-acceptance/summary.json` for `acceptance_pass: true`.
4. Decide whether `world_source_acceptance` gains a runtime-assisted mode or stays as the CPU/bench report paired with that artifact.
5. Remove or deprecate the legacy bridge only after the final accepted report has real GPU readback evidence.

## Verification

```powershell
rtk cargo test --bin world_source_acceptance
rtk cargo test world::source
rtk cargo test voxel::meshing::biome_channel
rtk cargo test voxel::runtime::world_source_generation
rtk cargo test
```
