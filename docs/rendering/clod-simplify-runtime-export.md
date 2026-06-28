# CLOD simplification runtime export

PR 25 added pure simplification diagnostics plus `clod_simplify_guard`. This PR
wires that helper into the Bevy CLOD runtime so every newly published
`ClodPageTree` revision can emit simplification rows for CI.

## Enable

```bash
VOXEL_CLOD_SIMPLIFY_CSV=1
VOXEL_CLOD_SIMPLIFY_CSV_PATH=perf-dumps/clod-simplify.csv
```

The exporter is default-off and writes only when the page tree publishes a new
revision. Each revision emits one row per CLOD page node.

## CSV schema

```text
revision,level,x,z,vertices,triangles,child_vertices,child_triangles,vertex_ratio,triangle_ratio,error_world,low_benefit
```

The schema is intentionally identical to the PR 25 guard input.

LOD0 rows have no child totals and report ratios as `1.0`. Parent rows compare
the published node mesh against the sum of its 2x2 children at the previous
level.

## Guard

```bash
scripts/guard-clod-simplify.sh bench-runs/<run>/clod-simplify.csv
```

PowerShell:

```powershell
scripts/guard-clod-simplify.ps1 bench-runs/<run>/clod-simplify.csv
```

## Full parity suite

`scripts/run-clod-full-parity-suite.*` now enables the exporter and runs the
simplification guard after the live-LOD bench. This catches simplification ratio
regressions, bad parent rows, excessive error and too many low-benefit pages in
actual published trees.

This exporter is behavior-neutral: it observes complete revisions after the
async CLOD build publishes them, then writes stats.
