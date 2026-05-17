# NAADF Upstream Parity

Status: evidence matrix  
Upstream target: `cg-tuwien/NAADF` commit `d72fb636fc42b22df929e554375f1e5928e790d5`  
Parity target: algorithm/test evidence, not file-for-file source parity

## Boundary

The upstream project is a MonoGame/C#/HLSL engine. Drusniel is a Bevy/Rust/WGSL
engine with an existing mesh/PBR/water renderer. Parity here means each upstream
NAADF behavior has a local implementation status, an intentional-divergence note
when needed, and concrete evidence through tests, benches, or screenshots.

Status values:

- `Parity`: local behavior is implemented and covered by direct evidence.
- `Partial`: meaningful local behavior exists, but known upstream semantics or
  evidence are missing.
- `Intentional divergence`: local behavior differs by design and the reason is
  documented.
- `Missing`: no trusted local implementation or evidence exists yet.

## Source Matrix

| Upstream source | Upstream behavior | Drusniel target | Status | Evidence |
| --- | --- | --- | --- | --- |
| [`rayTracing.fxh`][up-ray] | NAADF ray traversal through chunk, block, and voxel AADF bounds, with entity ray checks. | `assets/shaders/naadf/ray_trace.wgsl`, `src/rendering/naadf/cpu_trace.rs`, `src/rendering/naadf/entities.rs` | `Partial` | CPU fixture coverage in `rtk cargo test --features naadf --test naadf_cpu_layout`; GPU dispatch/readback coverage in `rtk cargo test --features naadf --test naadf_gpu_layout`; entity hit ordering covered by `rendering::naadf::cpu_trace` tests. `first_hit.wgsl` imports the shared ray trace shader instead of carrying a duplicate trace implementation. |
| [`chunkCalc.fx`][up-chunk] | GPU raw voxel to block/chunk build, including block hash/dedup and voxel/block directional bounds. | `assets/shaders/naadf/build_blocks.wgsl`, `assets/shaders/naadf/build_bounds.wgsl`, `assets/shaders/naadf/build_chunks.wgsl`, `tests/naadf_gpu_layout.rs` | `Partial` | `tests/naadf_gpu_layout.rs` dispatches the WGSL build passes, reads back chunk/block/voxel/material records, and compares them with CPU `build_naadf_chunk` packing for all fixtures. Intentional current gap: upstream-style block hash/dedup remains deferred until correctness is stable. |
| [`boundsCalc.fx`][up-bounds] | Queue-based multi-dispatch chunk-bound propagation across chunk groups. | `assets/shaders/naadf/build_chunk_bounds.wgsl`, CPU cache propagation | `Intentional divergence` | WGSL uses a conservative single-dispatch per-axis contiguous-empty count with binary chunk lookup. The shader documents this choice and keeps CPU cache propagation as the fuller solver. This is safe but not upstream-equivalent queue propagation. |
| [`renderFirstHit.fx`][up-first-hit] | Primary first-hit pass, sky/direct light, hit data, and motion vectors. | `assets/shaders/naadf/first_hit.wgsl`, preview pipeline in `src/rendering/naadf/pipeline.rs` | `Partial` | Shader metadata coverage in `rendering::naadf::layout::tests::wgsl_first_hit_declares_preview_material_path`; bench evidence in `bench-runs/2026-05-16T04-29-41Z/summary.json`. First-hit sky/direct lighting now uses the extracted scene sun direction. Motion output now reprojects terrain through static world position and NAADF entity volumes through previous entity transforms. Remaining gap: arbitrary non-NAADF Bevy mesh/prop objects are not covered by this NAADF entity-volume path. |
| [`renderGlobalIllum.fx`][up-gi] | Secondary GI rays, sun visibility, sampling, and denoising inputs. | `assets/shaders/naadf/gi_trace.wgsl`, `assets/shaders/radiance_cascades.wgsl` | `Partial` | `gi_trace.wgsl` performs cosine hemisphere secondary rays, NAADF chunk lookup, `trace_naadf` calls, and secondary sun visibility rays. Radiance-cascade GI secondary, sun visibility, contact shadows, and terrain AO can now route through NAADF world traversal, with CPU/GPU sun-visibility parity covered by `rtk cargo test --features naadf --test naadf_gpu_layout` and Phase 4-7 bench evidence in `bench-runs/phase3-naadf-sun/summary.json`, `bench-runs/phase5-contact-naadf/summary.json`, `bench-runs/phase5-terrain-ao-naadf/summary.json`, `bench-runs/phase6-gi-naadf-rerun/summary.json`, and `bench-runs/phase7-path-a-all-after-sdf-skip-counters/summary.json`. Accepted NAADF Phase 5-7 runs passed `bench_guard` with 187 checks and 0 warnings. Shader metadata coverage exists in `rendering::naadf::layout::tests::wgsl_gi_trace_declares_preview_compute_pass`, `rendering::radiance_cascades::tests::radiance_shader_routes_phase5_queries_to_naadf_world_trace`, and `rendering::radiance_cascades::tests::radiance_shader_routes_gi_secondary_to_naadf_world_trace`. GI sampling now receives frame-index jitter, scene sun direction, and NAADF constants for chunk validity. Remaining gap: this is Path A lighting-backend coverage, not upstream's full final-renderer GI pipeline. |
| [`renderSpatialResampling.fx`][up-spatial] | Edge-aware spatial resampling. | `assets/shaders/naadf/spatial_resampling.wgsl`, `assets/shaders/naadf/denoise.wgsl` | `Partial` | Shader metadata coverage in `rendering::naadf::layout::tests::wgsl_spatial_resampling_declares_edge_aware_helpers` and `wgsl_denoise_declares_edge_aware_compute_pass`. Visual acceptance still requires screenshot inspection from the NAADF preview/ GI benches. |
| [`renderSampleRefine.fx`][up-refine] | Temporal sample refinement and history reuse around stochastic GI samples. | `assets/shaders/naadf/temporal_accumulation.wgsl`, preview history in `src/rendering/naadf/pipeline.rs` | `Partial` | Temporal history buffers, blend/reset uniforms, moments, motion input, and reprojection helpers have shader metadata coverage in `wgsl_temporal_accumulation_declares_blend_and_reset`. GI input samples now include frame-index jitter so temporal accumulation has changing samples to refine. |
| [`renderTaaSampleReverse.fx`][up-taa] | Reverse TAA reprojection using motion/history rejection. | `assets/shaders/naadf/temporal_accumulation.wgsl` | `Partial` | Camera reprojection exists through `previous_clip_from_world` and motion output from first hit. NAADF entity-volume reprojection now uses previous entity transforms packed into the entity record. Remaining gap: no dedicated visual/reprojection fixture yet exercises a moving NAADF entity volume through the full temporal history path. |
| [`WorldRenderBase.cs`][up-render-base] | CPU render orchestration, dispatch order, histories, and shader resource binding. | `src/rendering/naadf/pipeline.rs`, `src/rendering/radiance_cascades.rs` | `Partial` | Drusniel has separate Bevy render-node orchestration for build, first hit, spatial, GI, temporal, denoise, optional path trace, and composite passes. Release parity still depends on current/preview/GI bench summaries, `bench_guard`, and screenshot inspection. |
| [`WorldData.cs`][up-world-data] | World data storage, CPU synchronization, editing, and entity data flow. | `VoxelWorld`, NAADF dirty/cache/upload systems, `src/rendering/naadf/entities.rs` | `Intentional divergence` | Drusniel keeps `VoxelWorld` authoritative and treats NAADF as a derived cache. This avoids introducing the upstream world model and preserves existing gameplay, persistence, colliders, and mesh rendering. |

## Known Fix Rows

| Gap | Status | Required evidence |
| --- | --- | --- |
| Add frame-indexed GI sampling so temporal accumulation can refine stochastic GI. | `Parity` | `gi_trace.wgsl` seeds samples with `config.w`; `gi_params_copy_frame_index_for_sample_jitter` covers uniform plumbing. Visual convergence still needs screenshot inspection. |
| Replace hardcoded/inconsistent sun directions with scene sun data. | `Parity` | `ExtractedNaadfPreviewSettings` copies `FogUniforms.sun_dir`; first-hit and GI shaders use `sun_direction_pad`. |
| Remove duplicated `trace_naadf` from `first_hit.wgsl`. | `Parity` | `wgsl_first_hit_declares_preview_material_path` requires the shared ray-trace import and rejects a local `fn trace_naadf(`. |
| Decide whether `lighting_queries.wgsl` should be runtime-loaded or remain helper-only. | `Parity` | The shader now has a dedicated handle/path and is loaded by `NaadfPlugin`; helper metadata coverage remains explicit. |
| Validate NAADF sun visibility before extending Path A to more query classes. | `Parity` | Phase 4 decision gate passed. `tests/naadf_gpu_layout.rs` dispatches the production WGSL sun-visibility helper and compares GPU results to `NaadfCpuRayBackend` across all NAADF fixtures. A/B evidence: SDF sun run `bench-runs/phase3-sdf/summary.json` (58.99 ms median, 92.22 ms p99) versus NAADF sun run `bench-runs/phase3-naadf-sun/summary.json` (40.24 ms median, 55.30 ms p99), with equivalent fixed-checkpoint screenshots and `bench_guard` passing 187 checks with 0 warnings. |
| Route contact shadows and terrain AO through NAADF behind opt-in toggles. | `Parity` | Phase 5 decision gate passed. Contact shadows use one 3.0-unit NAADF ray per pixel; terrain AO uses four 2.5-unit NAADF rays per pixel. A/B evidence: contact SDF `bench-runs/phase5-contact-sdf/summary.json` (35.74 ms median, 41.01 ms p99) versus contact NAADF `bench-runs/phase5-contact-naadf/summary.json` (35.24 ms median, 38.64 ms p99); terrain AO SDF `bench-runs/phase5-terrain-ao-sdf/summary.json` (35.51 ms median, 39.92 ms p99) versus terrain AO NAADF `bench-runs/phase5-terrain-ao-naadf/summary.json` (35.35 ms median, 38.22 ms p99). Fixed-checkpoint screenshots were visually equivalent, and both NAADF runs passed `bench_guard` with 187 checks and 0 warnings. |
| Route radiance-cascade GI secondary rays through NAADF. | `Partial` | GI secondary uses two deterministic cosine-hemisphere NAADF rays per pixel in the live radiance shader, and the radiance-cascade plugin is now installed in the main renderer. Active-pass evidence supersedes the earlier configuration-only runs: `bench-runs/path-a-review-gi-secondary-active/summary.json` (54.94 ms median, 69.09 ms p99) and `bench-runs/path-a-review-all-active-final2/summary.json` (46.60 ms median, 69.23 ms p99), both guard-clean and with 0 missing interest slots. The active pass is opt-in only because it is not yet perf-neutral enough for default promotion. |
| Add per-object/entity motion vectors for NAADF entity volumes. | `Partial` | `NaadfEntityVolumeRegistry` preserves previous stable transforms and resets them on volume revision changes; GPU packing includes the previous world-from-local matrix; `first_hit.wgsl` emits motion from `previous_world_position`. Evidence: `wgsl_entity_volume_record_matches_rust_pack_order` pins the WGSL struct field order to `pack_entity_volume_record`, `wgsl_temporal_accumulation_declares_blend_and_reset` pins the motion `.z` validity gate, `rtk cargo test --features naadf rendering::naadf --lib`, preview bench `bench-runs/2026-05-16T04-29-41Z/summary.json`, and startup bench `bench-runs/2026-05-16T04-32-46Z/summary.json`. Remaining evidence gap: a moving-entity reprojection fixture or visual bench. |
| Implement upstream-style queue propagation for chunk bounds, or keep the conservative pass documented as accepted divergence. | `Intentional divergence` | If changed, add GPU readback parity fixtures for multi-chunk empty-space propagation before enabling traversal dependence on chunk bounds. |

## Verification Commands

Correctness evidence:

```powershell
rtk cargo test --features naadf rendering::naadf --lib
rtk cargo test --features naadf --test naadf_cpu_layout
rtk cargo test --features naadf --test naadf_gpu_layout
```

Release evidence before claiming visual or performance parity:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-current.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-preview.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-startup-stability.toml
rtk cargo run --bin bench_guard -- <summary.json> ...
```

Do not treat an existing bench directory as release evidence until its
`summary.json` has been compared, `bench_guard` has passed where applicable, and
the fixed checkpoint screenshots have been inspected.

[up-ray]: https://github.com/cg-tuwien/NAADF/blob/d72fb636fc42b22df929e554375f1e5928e790d5/NAADF/Content/shaders/render/rayTracing.fxh
[up-chunk]: https://github.com/cg-tuwien/NAADF/blob/d72fb636fc42b22df929e554375f1e5928e790d5/NAADF/Content/shaders/world/data/chunkCalc.fx
[up-bounds]: https://github.com/cg-tuwien/NAADF/blob/d72fb636fc42b22df929e554375f1e5928e790d5/NAADF/Content/shaders/world/data/boundsCalc.fx
[up-first-hit]: https://github.com/cg-tuwien/NAADF/blob/d72fb636fc42b22df929e554375f1e5928e790d5/NAADF/Content/shaders/render/versions/base/renderFirstHit.fx
[up-gi]: https://github.com/cg-tuwien/NAADF/blob/d72fb636fc42b22df929e554375f1e5928e790d5/NAADF/Content/shaders/render/versions/base/renderGlobalIllum.fx
[up-spatial]: https://github.com/cg-tuwien/NAADF/blob/d72fb636fc42b22df929e554375f1e5928e790d5/NAADF/Content/shaders/render/versions/base/renderSpatialResampling.fx
[up-refine]: https://github.com/cg-tuwien/NAADF/blob/d72fb636fc42b22df929e554375f1e5928e790d5/NAADF/Content/shaders/render/versions/base/renderSampleRefine.fx
[up-taa]: https://github.com/cg-tuwien/NAADF/blob/d72fb636fc42b22df929e554375f1e5928e790d5/NAADF/Content/shaders/render/versions/base/renderTaaSampleReverse.fx
[up-render-base]: https://github.com/cg-tuwien/NAADF/blob/d72fb636fc42b22df929e554375f1e5928e790d5/NAADF/World/Render/Versions/WorldRenderBase.cs
[up-world-data]: https://github.com/cg-tuwien/NAADF/blob/d72fb636fc42b22df929e554375f1e5928e790d5/NAADF/World/Data/WorldData.cs
