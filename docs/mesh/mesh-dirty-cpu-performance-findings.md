# Mesh Dirty CPU Performance Findings

Date: 2026-06-08

This note documents the investigation into `Mesh Dirty` and `Mesh Dirty Generate CPU`
spikes in the live LOD workload.

## Short Version

The slow `Mesh Dirty` frames are not sort, apply, stats recompute, water meshing,
or the Stage 5 morph/seam-normal finalize work. They are the known Surface Nets
LOD transition-promotion cost: Lod1 chunks touching Lod0 are promoted to Lod0,
then re-emitted as the LOD front moves.

The current workload is genuine LOD churn:

- `Mesh Dirty` is almost entirely `Mesh Dirty Generate CPU`.
- `Mesh Dirty Generate CPU` tracks `SN Emit CPU` closely.
- `Mesh Dirty Apply CPU`, `Mesh Dirty Sort CPU`, and `Mesh Dirty Stats CPU` are
  effectively zero.
- The queue is dominated by `LOD` and `Neighbor LOD` dirty reasons.
- The transaction path prepares one chunk per frame, while hundreds remain queued.

This matches the existing LOD diagnosis in
`docs/legacy/lod-seam-issues-and-solutions.md`: Surface Nets transition promotion is
visually correct but structurally expensive.

## Bench Runs Reviewed

Primary current run:

- `bench-runs/2026-06-08T02-03-00Z/summary.json`
- Scene: `bench/scenes/visual/visual-regression-live-lod.toml`
- Git SHA in summary: `7961f153`
- Git dirty in summary: `true`

Immediate pre-instrumentation current run:

- `bench-runs/2026-06-08T01-52-21Z/summary.json`
- Scene: `bench/scenes/visual/visual-regression-live-lod.toml`
- Git SHA in summary: `7961f153`
- Git dirty in summary: `true`

Older comparison runs:

- `bench-runs/2026-06-07T16-39-39Z/summary.json`
- `bench-runs/2026-06-07T16-40-24Z/summary.json`
- `bench-runs/2026-06-07T17-09-06Z/summary.json`
- Scene: `bench/scenes/visual/visual-regression-live-lod.toml`
- Git SHA in summaries: `0ddc2aa1`

Broader historical scan also checked other bench summaries under `bench-runs/`
with `Mesh Dirty` rows.

## Current Measurement

From `bench-runs/2026-06-08T02-03-00Z/summary.json`:

| Checkpoint | Frame p99 | Mesh Dirty p99 | Generate p99 | SN Emit p99 | Morph Finalize p99 | Queued Median | Processed Median |
|---|---:|---:|---:|---:|---:|---:|---:|
| `ridge-run-noon` | 104.710 ms | 65.037 ms | 64.783 ms | 63.672 ms | 0.001 ms | 385.867 | 1.000 |
| `jump-water-sunset` | 96.060 ms | 57.239 ms | 56.890 ms | 53.721 ms | 2.663 ms | 407.000 | 1.000 |
| `forest-look-sweep` | 82.903 ms | 45.076 ms | 44.893 ms | 43.900 ms | 0.004 ms | 648.750 | 1.000 |

Readiness caveats for the same run:

- `ridge-run-noon`: render-ready timeout after about 30.0 seconds.
- `jump-water-sunset`: ready and render-ready completed.
- `forest-look-sweep`: readiness timeout after about 75.0 seconds with dirty
  chunks still present; render-ready completed after about 4.0 seconds.

## Breakdown

The dominant rows are:

- `Mesh Dirty`
- `Mesh Dirty Generate CPU`
- `SN Emit CPU`

The non-dominant rows are:

- `Mesh Dirty Sort CPU`: near zero.
- `Mesh Dirty Apply CPU`: zero in these checkpoint summaries.
- `Mesh Dirty Stats CPU`: zero in these checkpoint summaries.
- `SN SDF CPU`: sub-millisecond p99.
- `SN Extract CPU`: sub-millisecond p99.
- `Terrain Water Mesh CPU`: around 0.6-1.4 ms p99.
- `LOD Morph Finalize CPU`: near zero except `jump-water-sunset`, where p99 was
  2.663 ms and still far below the 56.890 ms generate p99.

So the slow row is not a broad `mesh_dirty_chunks_system` bookkeeping problem.
It is CPU-side Surface Nets mesh emission during LOD churn.

## Queue Shape

The same run shows `Mesh Dirty LOD Churn Only = 1` in all checkpoints, with
hundreds of dirty chunks queued and only one chunk processed per frame.

| Checkpoint | LOD Reason Median | Neighbor LOD Reason Median | Queued Median | Deferred Median | Processed Median |
|---|---:|---:|---:|---:|---:|
| `ridge-run-noon` | 118.933 | 385.583 | 385.867 | 384.867 | 1.000 |
| `jump-water-sunset` | 128.000 | 407.000 | 407.000 | 406.000 | 1.000 |
| `forest-look-sweep` | 257.600 | 648.650 | 648.750 | 647.750 | 1.000 |

This is consistent with the LOD transaction budget:

- `src/voxel/meshing/commit.rs`
  - `MAX_LOD_TRANSACTION_PREPARE_CHUNKS_PER_FRAME = 1`
- `src/voxel/runtime/mesh_scheduler.rs`
  - LOD-churn-only dirty sets route through `process_lod_mesh_transaction`.

That budget protects frame timing from even worse spikes, but it also means the
front drains slowly while the camera keeps moving.

## Root Cause

The hot path is:

1. LOD changes mark chunks dirty with `LOD` and `NeighborLOD` reasons.
2. `mesh_dirty_chunks_system` identifies the frame as LOD churn only.
3. The LOD mesh transaction prepares one chunk per frame.
4. `prepare_lod_chunk_commit` calls `transition_refined_surface_nets_lod`.
5. `transition_refined_surface_nets_lod` promotes a Surface Nets Lod1 chunk to
   Lod0 whenever it touches a Lod0 neighbor.
6. That promoted chunk is emitted at Lod0 density.
7. As the LOD front moves, the promoted ring is re-emitted repeatedly.

Important code references:

- `src/voxel/runtime/mesh_scheduler.rs`
  - Records `Mesh Dirty`, `Mesh Dirty Generate CPU`, and dirty reason counters.
  - Routes LOD-churn-only work through `process_lod_mesh_transaction`.
- `src/voxel/meshing/commit.rs`
  - `MAX_LOD_TRANSACTION_PREPARE_CHUNKS_PER_FRAME = 1`.
  - `prepare_lod_chunk_commit` wraps `generate_chunk_mesh_for_request` in
    `mesh_dirty_generate_us`.
- `src/voxel/lod/mod.rs`
  - `transition_refined_surface_nets_lod` promotes Lod1 touching Lod0 to Lod0.
- `src/voxel/meshing/surface_nets.rs`
  - Surface Nets emission dominates the measured p99.

## Comparison To Earlier Runs

The current run is not clearly worse than the June 7 live-LOD runs at
`0ddc2aa1`. The same shape existed there: `Mesh Dirty` was already dominated by
`Mesh Dirty Generate CPU`, with one chunk processed per frame and hundreds
queued.

Historical live-LOD examples:

| Run | Checkpoint | Mesh Dirty Median | Mesh Dirty p99 | Generate p99 | Queued Median | Processed Median |
|---|---|---:|---:|---:|---:|---:|
| `2026-06-07T16-39-39Z` | `ridge-run-noon` | 7.675 ms | 80.523 ms | 80.276 ms | 407.167 | 1.000 |
| `2026-06-07T16-40-24Z` | `jump-water-sunset` | 7.086 ms | 86.537 ms | 85.964 ms | 407.000 | 1.000 |
| `2026-06-07T16-40-24Z` | `forest-look-sweep` | 6.626 ms | 86.338 ms | 86.091 ms | 677.000 | 1.000 |
| `2026-06-07T17-09-06Z` | `ridge-run-noon` | 7.514 ms | 65.239 ms | 65.034 ms | 248.000 | 1.000 |
| `2026-06-07T17-09-06Z` | `jump-water-sunset` | 9.532 ms | 58.301 ms | 58.095 ms | 281.000 | 1.000 |
| `2026-06-07T17-09-06Z` | `forest-look-sweep` | 10.309 ms | 63.149 ms | 62.900 ms | 623.000 | 1.000 |

Current examples:

| Run | Checkpoint | Mesh Dirty Median | Mesh Dirty p99 | Generate p99 | Queued Median | Processed Median |
|---|---|---:|---:|---:|---:|---:|
| `2026-06-08T01-52-21Z` | `ridge-run-noon` | 3.968 ms | 56.706 ms | 56.383 ms | 327.750 | 1.000 |
| `2026-06-08T01-52-21Z` | `jump-water-sunset` | 8.210 ms | 57.542 ms | 57.201 ms | 386.000 | 1.000 |
| `2026-06-08T01-52-21Z` | `forest-look-sweep` | 9.794 ms | 60.800 ms | 60.571 ms | 619.000 | 1.000 |
| `2026-06-08T02-03-00Z` | `ridge-run-noon` | 4.619 ms | 65.037 ms | 64.783 ms | 385.867 | 1.000 |
| `2026-06-08T02-03-00Z` | `jump-water-sunset` | 7.467 ms | 57.239 ms | 56.890 ms | 407.000 | 1.000 |
| `2026-06-08T02-03-00Z` | `forest-look-sweep` | 7.615 ms | 45.076 ms | 44.893 ms | 648.750 | 1.000 |

Conclusion: there is no clear new current-HEAD regression in these summaries.
The performance debt was already present in the Surface Nets transition-promotion
path.

## Temporary Instrumentation Finding

Temporary instrumentation added a `LOD Morph Finalize CPU` row around:

- `recompute_morphed_seam_normals`
- `pad_morph_targets_identity`

That row showed morph finalization is not the primary source of the long
`Mesh Dirty Generate CPU` frames:

- `ridge-run-noon`: 0.001 ms p99.
- `jump-water-sunset`: 2.663 ms p99.
- `forest-look-sweep`: 0.004 ms p99.

If this row is useful for future debugging, the surgical implementation is:

1. Add `morph_finalize_us` to `MeshGenerationTimingStats`.
2. Accumulate it in `MeshGenerationTimingStats::add`.
3. Wrap the four Surface Nets morph-finalize blocks in `surface_nets.rs`.
4. Emit `LOD Morph Finalize CPU` next to the other mesh generation rows in
   `mesh_scheduler.rs`.

The current committed code may not include this row; check `git status` and the
timing row list before relying on it.

## Bench Guard Result

Command:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/2026-06-08T02-03-00Z/summary.json
```

Result: failed with 4 failures, all consistent with this investigation.

Failed rows:

| Guard Row | Value | Failure Threshold |
|---|---:|---:|
| `live_lod_ridge_mesh_dirty_p99` | 65.037 ms | fail > 10.000 ms |
| `live_lod_jump_mesh_dirty_p99` | 57.239 ms | fail > 10.000 ms |
| `live_lod_forest_mesh_dirty_p99` | 45.076 ms | fail > 10.000 ms |
| `live_lod_frame_p99` for forest | 82.903 ms | fail > 25.000 ms |

## Ruled Out

These are not the main cause in the measured live-LOD runs:

- Dirty chunk sorting.
- Mesh apply.
- Stats recompute.
- SDF sampling.
- Surface Nets extraction.
- Water meshing.
- Morph finalize / seam-normal recompute.
- A new current-HEAD regression relative to the June 7 live-LOD summaries.

## Recommended Direction

Do not raise the LOD transaction prepare budget as a quick fix. Existing LOD
notes report that `1 -> 8` chunks per frame regressed frame p99 and `Mesh Dirty`
p99.

The productive directions remain the ones already captured in the LOD docs:

1. Fix MC+Transvoxel seam holes and chunk-square artifacts, then rerun the same
   live-LOD A/B. The MC path has much better structural cost because it avoids
   whole-chunk Lod0 promotion.
2. If Surface Nets must remain primary, pursue face-local transition refinement
   instead of whole-chunk promotion. This converges on transition-cell meshing.
3. As a partial mitigation only, reduce LOD-change frequency or increase
   hysteresis. That trades visual responsiveness for fewer promoted re-emits.

Relevant docs:

- `docs/legacy/lod-seam-issues-and-solutions.md`
- `docs/legacy/mctx-decision.md`
- `docs/legacy/mc-transvoxel-hole-diagnosis.md`

