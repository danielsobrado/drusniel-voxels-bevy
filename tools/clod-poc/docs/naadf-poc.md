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
- Camera-relative infinite far shell sampling via `queryTerrainHeight`
- Canopy coverage flowing through summary chain
- Sun visibility / terrain occlusion debug rays
- Acceptance scenes and metrics for port/no-port decisions

## What it intentionally does not validate

- Full 16³ voxel brick occupancy (heightfield PoC approximation only)
- Production GPU path tracing or NAADF as visible terrain renderer
- CLOD page mesh replacement or gameplay collision
- Sparse voxel octrees / DAGs
- Bevy/Rust integration

## Data flow

```text
deterministic terrain source (surfaceHeight / macroTerrain)
  -> chunk brick (height + material + canopy + water)
  -> mip summary chain (2D heightfield proxy of 16³ brick)
  -> near page table (dense camera-centered)
  -> hash fallback (open-addressing for out-of-table residents)
  -> far clipmap summary tiles (ringed clipmap)
  -> query API (height / primary ray / sun visibility)
  -> dense or HDDA traversal mode
  -> far shell / canopy shell / shadow debug / ray debug overlays
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
| `far_shell` | Camera-relative shell distances |
| `debug` | Overlay toggles |
| `acceptance` | Gate thresholds |

Default traversal remains `dense`. Use `compare` before trusting HDDA changes; compare mode returns the HDDA result plus dense-vs-HDDA mismatch metadata and increments `naadf_hdda_dense_mismatches`.

Enable with `?naadf=1` or any `infinite-naadf-*` scene.

Runtime traversal overrides:

```text
?scene=infinite-naadf-sun-visibility&naadfTraversal=compare
?scene=infinite-naadf-sun-visibility&naadfTraversal=hdda&naadfHddaBounds=1
```

`naadfHddaBounds=1` enables AADF directional-bound skips. Leave it off while checking pure span stepping.

## Known limitations

- Heightfield 2D mip summaries, not full 3D brick occupancy
- HDDA is a CLOD PoC approximation over the heightfield summary chain, not the production Rust/WGSL 16³ chunk → 4³ block → voxel implementation
- TypeScript synchronous builds under frame budgets (no worker offload)
- Macro terrain fallback still used when summaries are missing (counted, not silent)
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
| `?scene=infinite-naadf-stress-missing` | Missing tile counting |
| `?scene=infinite-naadf-far` | Far shell summary query mode |

## How to run tests

```powershell
npm --prefix tools/clod-poc test
```

NAADF unit tests live under `src/naadf/__tests__/`.

## How to run debug scenes

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1
```

Examples:

```text
http://127.0.0.1:5173/?scene=infinite-naadf-flat&farShell=1
http://127.0.0.1:5173/?scene=infinite-naadf-fast-flight&farShell=1
http://127.0.0.1:5173/?scene=infinite-naadf-sun-visibility&farShell=1
http://127.0.0.1:5173/?scene=infinite-naadf-sun-visibility&naadfTraversal=compare&naadfHddaBounds=1
```

Use the **NAADF PoC** GUI folder for overlays and per-frame counters.
