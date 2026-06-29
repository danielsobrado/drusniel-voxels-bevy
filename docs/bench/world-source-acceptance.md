# WorldSource acceptance bench

BVY-WS-11 uses `world_source_acceptance` as the focused GPU-first WorldSource acceptance bench.

Run it in release mode:

```powershell
cargo run --release --bin world_source_acceptance
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
- `world_source_acceptance` reads GPU drift samples through this provider boundary;
- the current provider is `UnavailableWorldSourceGpuReadback`, so `gpu_readback.status` is `unavailable` and `drift_gate.status` is `skipped`;
- the real GPU implementation should replace that provider with one that dispatches `drift_readback.wgsl`, maps the output buffer back to `WorldSourceDriftSample`, and passes it into the existing drift gate.

Current limitation:

- `drift_readback.wgsl` currently validates GPU splat/dominant-layer resolution from prepared WorldSource samples. Full GPU height/biome drift requires a later WGSL port of `height_field.rs`, `island_shape.rs`, and `biome_region_field.rs`.
- GPU readback samples are not produced yet, so `drift_gate.status` is expected to be `skipped` with `gpu_readback_unavailable` until the readback producer is added.

Optional blocky comparison:

```powershell
cargo run --release --bin world_source_acceptance -- --blocky --run-name world-source-blocky
```
