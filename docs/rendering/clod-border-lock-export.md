# CLOD border-lock diagnostics

`clod-poc` exposes locked-border debug views because CLOD seams usually come
from one of two mistakes:

1. outer border vertices were not protected before simplification;
2. an internal open boundary survived weld/merge and later looked like a page
   edge.

The Rust builder already uses topological open-boundary detection for lock
masks. This PR adds a small statistics helper plus a standalone guard so bench
runs can validate that published CLOD page meshes have sane border-lock data.

## CSV schema

```text
frame,level,x,z,vertex_count,triangle_count,border_edges,locked_vertices,lock_ratio,boundary_vertex_ratio
```

The helper is `voxel::pages::border_lock_stats::border_lock_stats` and the row
format is produced by `ClodBorderLockStats::to_csv_record(frame)`.

## Guard

```bash
scripts/guard-clod-border-locks.sh bench-runs/<run>/clod-border-locks.csv
```

PowerShell:

```powershell
scripts/guard-clod-border-locks.ps1 -Csv bench-runs/<run>/clod-border-locks.csv
```

The guard fails when:

- the CSV is empty;
- a page has border edges but zero locked vertices;
- lock ratios fall outside expected bounds;
- published page meshes are empty;
- required levels are missing when the level-completeness check is enabled.

## Next wiring step

This PR intentionally keeps the stats helper independent from the async build
queue. The next PR should emit `clod-border-locks.csv` when a new
`ClodPageTree` revision is published, using this helper for each node mesh.
