# WorldSource acceptance bench

BVY-WS-11 uses `world_source_acceptance` as the focused GPU-first WorldSource acceptance bench.

Run it in release mode:

```powershell
rtk cargo run --release --bin world_source_acceptance
```

The binary writes:

```text
bench-runs/world-source-<unix-seconds>/summary.json
```

The summary includes:

- build profile and release-mode flag;
- terrain source startup report with `gpu_world_source`, `cpu_world_source_reference`, or `legacy` label;
- measured WorldSource chunk voxel generation timing;
- measured mesh build timing for sampled chunks;
- estimated solid/water draw impact from generated meshes;
- GPU readback provider status;
- CPU/GPU drift gate status.

BVY-WS-12 status:

- the acceptance bench writes source-aware biome material tags into generated chunks;
- runtime async WorldSource chunk generation uses the same source-aware tagging path;
- Surface Nets reads those source-aware biome tags before using the old compatibility adapter;
- `material_draw_impact.compatibility_biome_channel_active` should be `false` for this bench path.

GPU readback boundary:

- `src/world/source/drift_readback.rs` defines `WorldSourceGpuReadbackProvider`;
- `assets/shaders/world_source/drift_readback.wgsl` defines the GPU readback shader contract;
- Rust wire structs are `GpuWorldSourceDriftReadbackParams`, `GpuWorldSourceDriftInputSample`, and `GpuWorldSourceDriftOutputSample`;
- `GpuWorldSourceDriftReadbackDispatchPlan` calculates sample count, workgroup count, and required buffer byte sizes;
- `build_gpu_world_source_drift_input_samples` prepares input buffers from the CPU reference source and drift sample points;
- `decode_gpu_world_source_drift_outputs` maps GPU output wire structs back to `WorldSourceDriftSample` and rejects invalid IDs;
- the render-app path can dispatch `drift_readback.wgsl`, map the staging buffer, publish `WorldSourceGpuReadbackResult`, and evaluate the runtime drift gate when `VOXEL_WORLD_SOURCE_DRIFT_READBACK=1`;
- the runtime-assisted path writes `bench-runs/world-source-runtime-acceptance/summary.json` by default, or the path in `VOXEL_WORLD_SOURCE_DRIFT_ACCEPTANCE_OUT`;
- `world_source_acceptance` still uses `UnavailableWorldSourceGpuReadback`, so `gpu_readback.status` is `unavailable`, `drift_gate.status` is `skipped`, and `acceptance_pass` is `false`;
- the remaining acceptance work is to verify the opt-in runtime path and either feed that result into a runtime-assisted report or archive it alongside the standalone bench.

Current limitation:

- `drift_readback.wgsl` currently validates GPU splat/dominant-layer resolution from prepared WorldSource samples. Full GPU height/biome drift requires a later WGSL port of `height_field.rs`, `island_shape.rs`, and `biome_region_field.rs`.
- The standalone bench does not produce GPU readback samples, so `drift_gate.status` is expected to be `skipped` with blockers `gpu_readback_unavailable` and `drift_gate_not_passed` until runtime readback evidence is accepted.

Optional blocky comparison:

```powershell
rtk cargo run --release --bin world_source_acceptance -- --blocky --run-name world-source-blocky
```

Runtime-assisted readback artifact, from a native Windows shell:

```powershell
rtk cargo run --release -- --runtime-assisted --bench bench/scenes/terrain/world-source-readback-acceptance.toml --bench-out bench-runs/world-source-runtime-readback
```
