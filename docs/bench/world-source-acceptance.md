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
- CPU/GPU drift gate status.

BVY-WS-12 status:

- the acceptance bench now writes source-aware biome material tags into generated chunks;
- Surface Nets reads those source-aware biome tags before using the old compatibility adapter;
- `material_draw_impact.compatibility_biome_channel_active` should be `false` for this bench path;
- runtime chunk generation still needs the same source-aware material tagging hook before the temporary compatibility adapter can be fully removed.

Current limitation:

- GPU readback samples are not produced yet, so `drift_gate.status` is expected to be `skipped` with `gpu_readback_unavailable` until the readback producer is added.

Optional blocky comparison:

```powershell
cargo run --release --bin world_source_acceptance -- --blocky --run-name world-source-blocky
```
