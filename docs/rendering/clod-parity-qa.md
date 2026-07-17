# CLOD parity QA

This document describes the Bevy-side QA loop used to compare the Rust CLOD runtime with the public `tools/clod-poc` expectations.

The TypeScript PoC is not part of the shipping runtime. It is the reference for:

- active page-cut selection;
- 2:1 restricted quadtree selection;
- relief-sensitive splitting;
- freeze and forced-selection controls;
- source-build, publish, and visible-cut observability;
- page rebuild behaviour after terrain changes.

The Rust path must prove those behaviours through deterministic benches, not screenshots alone.

## Runtime controls

CLOD pages are default-off.

```text
CLOD_PAGES=1
CLOD_PAGES_BUDGET=4
CLOD_PAGES_SOURCE_MESH_BUDGET=4
```

`CLOD_PAGES_SOURCE_MESH_BUDGET` limits clean LOD0 source meshes generated on the main thread per frame. Page assembly, welding, simplification, and quadtree construction remain asynchronous.

## One-command local run

Linux, macOS, or Git Bash:

```bash
scripts/run-clod-parity-bench.sh
```

PowerShell:

```powershell
scripts/run-clod-parity-bench.ps1
```

Both runners:

1. enable `CLOD_PAGES=1`;
2. enable the CLOD selection CSV exporter;
3. enable the CLOD rebuild observer CSV exporter;
4. run `bench/scenes/terrain/clod-parity-stress.toml`;
5. run `clod_stats_guard`;
6. run `clod_rebuild_guard`.

## Manual run

```bash
CLOD_PAGES=1 \
VOXEL_CLOD_STATS_CSV=1 \
VOXEL_CLOD_REBUILD_CSV=1 \
VOXEL_CLOD_STATS_CSV_PATH=bench-runs/clod-parity/latest/clod-selection-runtime.csv \
VOXEL_CLOD_REBUILD_CSV_PATH=bench-runs/clod-parity/latest/clod-rebuild-observer.csv \
cargo run --release -- --bench bench/scenes/terrain/clod-parity-stress.toml

cargo run --bin clod_stats_guard -- \
  bench-runs/clod-parity/latest/clod-selection-runtime.csv

cargo run --bin clod_rebuild_guard -- \
  bench-runs/clod-parity/latest/clod-rebuild-observer.csv
```

## Acceptance signal

A passing run must show:

- at least one clean LOD0 source export;
- at least one complete LOD0 page column;
- zero source-export failures;
- non-empty indexed and rendered CLOD cuts;
- zero blocked 2:1 split rows;
- no accidental frozen selection;
- at least one published CLOD page-tree rebuild;
- published rebuilds with non-zero node and triangle counts;
- valid source/build/publish ordering.

The selection CSV includes:

```text
source_exports
complete_page_columns
source_pending_chunks
source_meshed_this_frame
source_failures_total
```

The guard intentionally fails legacy or current runs that contain selection samples but never built any pages.

## Edit-driver boundary

Phase 5 provides missing-page fallback and binary live/page ownership. Authoritative edit invalidation, LOD0-first rebuild ordering, ancestor dirtiness, and debounce belong to Phase 6. Keep edit-heavy acceptance on the Phase 6 harness rather than weakening the Phase 5 source-build guard.
