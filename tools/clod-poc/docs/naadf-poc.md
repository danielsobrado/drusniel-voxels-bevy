# NAADF PoC (CLOD Phase 10)

Browser validation prototype for NAADF-inspired far-terrain query backends inside `tools/clod-poc`. This is **not** production Bevy/Rust code.

## What this PoC validates

- Streamed chunk brick + mip summary data model around the camera
- Conservative AADF-style directional skip metadata
- Dense near page table + hash fallback for resident chunks
- Explicit dense / HDDA / compare traversal modes for primary debug rays and sun visibility
- NanoVDB-style span stepping at chunk/block/voxel scale in the heightfield PoC
- Far clipmap summary rings for long-distance queries
- Query API with explicit counters (near table, hash, far clipmap, missing, HDDA)
- Multi-ring GPU far-summary height atlas for runtime far-shell displacement
- Paired GPU far-summary material-color atlas for runtime far-shell color
- Paired GPU far-summary coverage atlas for canopy/water far-shell tinting
- Paired GPU derived-normal atlas for runtime far-shell lighting
- Configurable 3x3 / 5x5 / 7x7 GPU atlas window via YAML, URL, and side menu
- Side-menu GPU atlas stats for window, pixels, upload revision, texture count, and memory estimate
- GPU procedural displacement as fallback where summary atlas data is missing
- CPU query/HDDA path as oracle/debug only
- Canopy coverage flowing through summary chain
- Sun visibility / terrain occlusion debug rays
- Acceptance scenes and metrics for port/no-port decisions

## What it intentionally does not validate

- Full 16³ voxel brick occupancy (heightfield PoC approximation only)
- Full GPU HDDA/AADF traversal yet
- Production GPU path tracing
- CLOD page mesh replacement or gameplay collision
- Sparse voxel octrees / DAGs
- Bevy/Rust integration

## Runtime data flow

```text
CPU far summary tile stream
  -> packed RGBA32F GPU height atlas
  -> paired RGBA32F GPU material-color atlas
  -> paired RGBA32F GPU derived-normal atlas
  -> paired RGBA32F GPU coverage atlas (R=canopy, G=water, B=reserved, A=valid)
  -> one vertical atlas band per far-summary ring
  -> configurable 3x3 / 5x5 / 7x7 moving tile window per ring
  -> nearest-filtered texel-center sampling in GPU material positionNode/colorNode
  -> distance-selected atlas height/color/normal/coverage where alpha is valid
  -> canopy coverage darkens/greens distant forest areas
  -> water coverage blue-tints and smooths distant wet/water areas
  -> runtime lighting normals from the derived-normal atlas
  -> procedural GPU displacement fallback where atlas is missing
  -> GPU material lighting / haze
```

CPU NAADF data still exists for oracle/debug:

```text
deterministic terrain source (surfaceHeight / macroTerrain)
  -> chunk brick (height + material + canopy + water)
  -> mip summary chain (2D heightfield proxy of 16³ brick)
  -> near page table (dense camera-centered)
  -> hash fallback (open-addressing for out-of-table residents)
  -> far clipmap summary tiles (ringed clipmap)
  -> query API (height / primary ray / sun visibility)
  -> dense or HDDA traversal mode
  -> debug overlays / acceptance counters
```

## Config

Loaded from [`config/naadf_poc.yaml`](../config/naadf_poc.yaml). Key sections:

| Section | Purpose |
|---------|---------|
| `world` | Chunk size, voxel scale, seed |
| `streaming` | Preload, per-frame job/commit budgets, eviction grace |
| `near_page_table` | Dense radius around camera |
| `hash_fallback` | Capacity for out-of-table residents |
| `chunk_bricks` / `mip_summary` | Brick build + mip levels + stored fields |
| `far_clipmap` | Distance rings and cell sizes |
| `query` | Ray step limits, LOD bias, sun unknown policy |
| `traversal` | `dense`, `hdda`, or `compare`; HDDA step budgets and compare epsilon |
| `far_shell` | Camera-relative shell distances, grid size, `height_sampling_mode`, `gpu_atlas_window_tiles` |
| `debug` | Overlay toggles |
| `acceptance` | Gate thresholds |

Default traversal remains `dense`. Use `compare` before trusting HDDA changes. Compare mode runs the dense oracle with isolated metrics, runs HDDA against live metrics, and returns the dense result as a safe fallback if there is a mismatch. It increments both `naadf_hdda_dense_mismatches` and `naadf_hdda_fallback_to_dense` on fallback.

Runtime far-shell height sampling defaults to `cpu` unless `far_shell.height_sampling_mode: gpu` is set in YAML or `naadfHeightMode=gpu` is passed in the URL. GPU mode only becomes effective when the WebGPU far terrain parity material and GPU atlas are both available; otherwise startup falls back to CPU/provider sampling and still requires a provider.

`far_shell.gpu_atlas_window_tiles` supports `3`, `5`, or `7`. The **NAADF PoC** side menu exposes the same setting as **GPU atlas window** and reloads the scene with the matching URL override because changing this value reallocates GPU atlas textures.

The **stats** folder shows GPU atlas cost: atlas window tiles, cells per ring, total pixels, texture count, upload revision, and estimated MiB. The estimate assumes four RGBA32F textures: height, material color, derived normal, and coverage.

Enable with `?naadf=1` or any `infinite-naadf-*` scene.

Runtime overrides:

```text
?scene=infinite-naadf-sun-visibility&naadfTraversal=compare
?scene=infinite-naadf-sun-visibility&naadfTraversal=hdda&naadfHddaBounds=1
?scene=infinite-naadf-sun-visibility&naadfHeightMode=gpu&naadfShellGrid=96
?scene=infinite-naadf-sun-visibility&naadfAtlasWindow=7
?scene=infinite-naadf-sun-visibility&naadfHeightMode=cpu
```

`naadfHddaBounds=1` enables AADF directional-bound skips. Leave it off while checking pure span stepping.

## Known limitations

- Heightfield 2D mip summaries, not full 3D brick occupancy
- Ring-window borders still clamp at the configured atlas edge
- Canopy/water coverage is summary-tint only; no far-shell animated water surface yet
- The atlas is still a small moving tile window per ring, not a production bindless/SSBO page table
- HDDA is a CLOD PoC approximation over the heightfield summary chain, not the production Rust/WGSL 16³ chunk → 4³ block → voxel implementation
- CPU macro terrain fallback still exists for debug/oracle paths, but should not be on the runtime far-shell hot path in GPU mode
- Sun visibility is debug-only stepping, not a path tracer
- `infinite-naadf-stress-missing` forces zero build budget to test missing paths

## Acceptance scenes

| Scene | Exercises |
|-------|-----------|
| `?scene=infinite-naadf-flat` | Baseline summaries, low ray steps |
| `?scene=infinite-naadf-hills` | Far shell ring blending |
| `?scene=infinite-naadf-mountains` | High variance refinement |
| `?scene=infinite-naadf-fast-flight` | Predictive streaming ahead |
| `?scene=infinite-naadf-fast-turn` | Stale data during turns |
| `?scene=infinite-naadf-forest` | Canopy through summary chain |
| `?scene=infinite-naadf-sun-visibility` | Sun rays + AADF skips |
| `?scene=infinite-naadf-stress-missing` | Unknown/missing handling |
