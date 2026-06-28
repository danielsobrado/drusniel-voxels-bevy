# CLOD weld runtime export

PR 27 added pure weld/seam diagnostics plus `clod_weld_guard`. This PR wires
that helper into the Bevy CLOD runtime so every newly published `ClodPageTree`
revision can emit weld rows for CI.

## Enable

```bash
VOXEL_CLOD_WELD_CSV=1
VOXEL_CLOD_WELD_CSV_PATH=perf-dumps/clod-weld.csv
```

The exporter is default-off and writes only when the page tree publishes a new
revision. Each revision emits one row per CLOD page node.

## CSV schema

```text
revision,level,page_x,page_z,vertices,triangles,unique_position_buckets,duplicate_position_groups,duplicate_vertices,border_vertices,open_boundary_edges,max_normal_delta,max_material_delta,max_paint_delta
```

The schema is intentionally identical to the PR 27 guard input.

## Guard

```bash
scripts/guard-clod-welds.sh bench-runs/<run>/clod-weld.csv
```

PowerShell:

```powershell
scripts/guard-clod-welds.ps1 bench-runs/<run>/clod-weld.csv
```

## Full parity suite

`scripts/run-clod-full-parity-suite.*` now enables the exporter and runs the
weld guard after the live-LOD bench. This catches duplicate quantized vertices,
normal/material/paint conflicts and unexpected open boundary spikes in actual
published trees.

This exporter is behavior-neutral: it observes complete revisions after the
async CLOD build publishes them, then writes stats.
