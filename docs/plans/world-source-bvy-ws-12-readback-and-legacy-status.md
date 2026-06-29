# BVY-WS-12 status — WorldSource visual-parity gate

## Current decision

CLOD/WorldSource is the default terrain path. MC/Transvoxel is legacy/fallback only and is not required for the WorldSource GPU biome/splat port.

## What is already wired

- `terrain_source.mode` defaults to `gpu_world_source`.
- `world_source_acceptance` refuses to run as an acceptance report unless `terrain_source.mode == gpu_world_source`.
- `world_source_acceptance` writes top-level `acceptance_pass` and `acceptance_blockers` fields.
- Missing GPU readback is a blocker, not a pass.
- WorldSource chunk generation uses biome-tagged material IDs.
- Surface Nets writes the terrain biome id into `uv0.y`.
- The triplanar terrain shader imports `world_source/biome_splat.wgsl` and resolves GPU splat weights from the biome id.
- The compatibility biome adapter exists only as a named fallback after material tags and active `ProceduralWorldSource` sampling.

## Remaining blocker before removing legacy bridge

The GPU drift readback pipeline still lacks the actual staging-buffer map step.

Current state:

- `assets/shaders/world_source/drift_readback.wgsl` defines the compute-side contract.
- `GpuWorldSourceDriftReadbackDispatchPlan` defines buffer sizes and workgroup count.
- `decode_staged_gpu_world_source_drift_bytes()` decodes mapped bytes into `WorldSourceGpuReadbackResult`.
- `decode_staged_gpu_world_source_drift_readback()` still reports `gpu_readback_map_not_implemented`.

Until real mapped GPU readback samples are available, `WorldSourceDriftGateReport` must remain `skipped`, and `world_source_acceptance` must report `acceptance_pass: false` with blockers including:

- `gpu_readback_unavailable`
- `drift_gate_not_passed`

## What not to do

- Do not spend BVY-WS-12 time porting MC/Transvoxel biome UVs.
- Do not mark visual parity accepted while GPU readback is skipped.
- Do not remove the compatibility fallback until the acceptance report has real GPU readback and `acceptance_pass: true`.

## Next implementation task

Implement the render-world staging-buffer map path and feed decoded samples into the drift gate:

1. Dispatch `GpuWorldSourceDriftReadbackNode` with the prepared request.
2. Map `GpuWorldSourceDriftReadbackBuffers.staging_buffer` for read after command submission completes.
3. Decode bytes with `decode_staged_gpu_world_source_drift_bytes(plan, bytes)`.
4. Store `WorldSourceGpuReadbackResult::available(samples)` in `GpuWorldSourceDriftReadbackState.latest_result`.
5. Run `world_source_acceptance` only when the readback result is available.

## Verification

```powershell
cargo test --bin world_source_acceptance
cargo test world::source
cargo test voxel::meshing::biome_channel
cargo test voxel::runtime::world_source_generation
cargo test
```
