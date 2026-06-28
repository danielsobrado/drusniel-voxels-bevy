# CLOD topology runtime export

PR 23 added pure topology diagnostics plus `clod_topology_guard`. This PR wires
that helper into the Bevy CLOD runtime so every newly published `ClodPageTree`
revision can emit topology rows for CI.

## Enable

```bash
VOXEL_CLOD_TOPOLOGY_CSV=1
VOXEL_CLOD_TOPOLOGY_CSV_PATH=perf-dumps/clod-topology.csv
```

The exporter is default-off and writes only when the page tree publishes a new
revision. Each revision emits one row per CLOD page node.

## CSV schema

```text
frame,revision,level,x,z,vertex_count,triangle_count,boundary_edges,non_manifold_edges,invalid_indices,repeated_index_triangles,zero_area_triangles,duplicate_triangles,orphan_vertices,non_finite_positions,normal_count_mismatch,material_count_mismatch,paint_count_mismatch,passed
```

The schema is intentionally identical to the PR 23 guard input.

## Guard

```bash
scripts/guard-clod-topology.sh bench-runs/<run>/clod-topology.csv
```

PowerShell:

```powershell
scripts/guard-clod-topology.ps1 -Csv bench-runs/<run>/clod-topology.csv
```

## Full parity suite

`scripts/run-clod-full-parity-suite.*` now enables the exporter and runs the
topology guard after the live-LOD bench. This catches invalid indices,
degenerate geometry, duplicate triangles, non-manifold edges and attribute count
mismatches in actual published trees.

This exporter is behavior-neutral: it observes complete revisions after the
async CLOD build publishes them, then writes stats.
