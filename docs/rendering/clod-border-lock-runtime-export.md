# CLOD border-lock runtime export

PR 21 added the pure border-lock stats helper and the standalone guard. This
PR wires that helper into the Bevy runtime so a bench run can produce the CSV
directly from published `ClodPageTree` revisions.

## Enable

```bash
VOXEL_CLOD_BORDER_LOCK_CSV=1
VOXEL_CLOD_BORDER_LOCK_CSV_PATH=perf-dumps/clod-border-locks.csv
```

The exporter is default-off and writes only when the page tree publishes a new
revision. Each revision emits one row per CLOD page node.

## CSV schema

```text
frame,level,x,z,vertex_count,triangle_count,border_edges,locked_vertices,lock_ratio,boundary_vertex_ratio
```

The schema is intentionally identical to the PR 21 guard input.

## Guard

```bash
scripts/guard-clod-border-locks.sh bench-runs/<run>/clod-border-locks.csv
```

PowerShell:

```powershell
scripts/guard-clod-border-locks.ps1 -Csv bench-runs/<run>/clod-border-locks.csv
```

## Full parity suite

`scripts/run-clod-full-parity-suite.*` now enables the exporter and runs the
border-lock guard after the live-LOD bench. This catches seam-prone page trees
even when screenshots look acceptable.
