# CLOD simplification diagnostics

This diagnostic layer checks whether published CLOD page trees are simplifying
reasonably by level.

It does **not** change the simplifier. It only exposes guardable statistics so
we can catch broken simplification before it becomes a visual seam, a triangle
budget regression, or a runtime selection anomaly.

## CSV contract

The follow-up runtime export writes rows with this shape:

```csv
revision,level,x,z,vertices,triangles,child_vertices,child_triangles,vertex_ratio,triangle_ratio,error_world,low_benefit
```

Where:

- `revision` is the `ClodPageTree` revision.
- `level` is the CLOD level.
- `x,z` are the page/node coordinates at that level.
- `vertices` / `triangles` are the published node mesh counts.
- `child_vertices` / `child_triangles` are the totals of the 2x2 children.
- `vertex_ratio` / `triangle_ratio` are current counts divided by child totals.
- `error_world` is the accumulated simplification error on the node.
- `low_benefit` mirrors the simplifier output flag.

LOD0 rows have no children, so child counts are zero and ratios are `1.0`.

## Guard

Run:

```bash
scripts/guard-clod-simplify.sh bench-runs/<run>/clod-simplify.csv
```

PowerShell:

```powershell
scripts/guard-clod-simplify.ps1 bench-runs/<run>/clod-simplify.csv
```

Config:

```toml
assets/config/clod_simplify_guard.toml
```

The guard fails on:

- missing CSV or missing rows;
- no parent rows when parent rows are required;
- parent pages with zero/too-few triangles or vertices;
- invalid/non-finite ratios;
- ratios above `max_triangle_ratio` / `max_vertex_ratio`;
- suspiciously tiny ratios below minimum collapse thresholds;
- `error_world` above the configured maximum;
- too many `low_benefit` pages.

## Why separate from topology guard?

Topology diagnostics answer: "is the mesh valid?"

Simplification diagnostics answer: "is the CLOD hierarchy economically useful?"

A page can be topologically valid but still bad for runtime if it keeps nearly
all child triangles at parent LODs, or if error climbs beyond the selection
metric budget.

## Relation to `clod-poc`

The PoC has dedicated simplification tests, triangle-quality helpers and stats.
This Rust module turns the same class of checks into bench-regression telemetry.
