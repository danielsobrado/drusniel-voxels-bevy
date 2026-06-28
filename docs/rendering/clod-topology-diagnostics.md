# CLOD topology diagnostics

`clod-poc` treats CLOD validation as a hard gate: meshes are welded, border
locked, simplified, then validated before they are trusted by runtime selection.
The Bevy port already has the builder validation functions; this PR adds a
small runtime/CI-facing topology stats layer and a standalone guard.

This PR is behavior-neutral. It does not change simplification or page
selection. It only adds:

- `src/voxel/pages/topology_stats.rs`
- `src/bin/clod_topology_guard.rs`
- `assets/config/clod_topology_guard.toml`
- guard scripts

## CSV schema

```text
frame,revision,level,x,z,vertex_count,triangle_count,boundary_edges,non_manifold_edges,invalid_indices,repeated_index_triangles,zero_area_triangles,duplicate_triangles,orphan_vertices,non_finite_positions,normal_count_mismatch,material_count_mismatch,paint_count_mismatch,passed
```

The schema is designed to be emitted later from each published `ClodPageTree`
revision. Until that runtime exporter lands, the guard can already be used with
fixtures or standalone exports.

## Meaning

- `invalid_indices`: index references outside `positions`.
- `repeated_index_triangles`: triangle has duplicated vertex indices.
- `zero_area_triangles`: valid indices but geometric area is zero or near-zero.
- `duplicate_triangles`: same three vertices used by more than one triangle.
- `non_manifold_edges`: edge used by more than two triangles.
- `orphan_vertices`: vertices unused by any triangle.
- `non_finite_positions`: NaN/Inf vertex coordinates.
- `*_count_mismatch`: attribute arrays that do not match vertex count.

## Guard

```bash
scripts/guard-clod-topology.sh bench-runs/<run>/clod-topology.csv
```

PowerShell:

```powershell
scripts/guard-clod-topology.ps1 -Csv bench-runs/<run>/clod-topology.csv
```

## Next PR

Wire this into the CLOD runtime so every newly published `ClodPageTree` revision
emits `clod-topology.csv`, then add the guard to the full parity suite.

This intentionally follows the border-lock PR split:

1. helper + guard;
2. runtime exporter;
3. parity-suite wiring.
