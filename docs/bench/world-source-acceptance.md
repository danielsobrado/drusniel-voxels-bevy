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
- `world_source_acceptance` now reads GPU drift samples through this provider boundary;
- the current provider is `UnavailableWorldSourceGpuReadback`, so `gpu_readback.status` is `unavailable` and `drift_gate.status` is `skipped`;
- the real GPU implementation should replace that provider with one that dispatches the WorldSource WGSL sample kernel, reads back `WorldSourceDriftSample` values, and passes them into the existing drift gate.

Current limitation:

- GPU readback samples are not produced yet, so `drift_gate.status` is expected to be `skipped` with `gpu_readback_unavailable` until the readback producer is added.

Optional blocky comparison:

```powershell
cargo run --release --bin world_source_acceptance -- --blocky --run-name world-source-blocky
```
