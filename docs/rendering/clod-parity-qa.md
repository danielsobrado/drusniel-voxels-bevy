# CLOD parity QA

This document describes the Bevy-side QA loop used to compare the Rust CLOD
runtime with the public `tools/clod-poc` expectations.

The goal is not to make the TypeScript PoC part of the shipping runtime. The PoC
is useful because it made several CLOD behaviours explicit:

- active page cut selection;
- 2:1 restricted quadtree selection;
- relief-sensitive splitting on rugged terrain;
- freeze/forced selection debug controls;
- visible runtime counters;
- page rebuild and publish observability after terrain changes.

The Rust path should prove those behaviours through deterministic benches, not
manual screenshots only.

## One-command local run

Linux/macOS/Git Bash:

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

A passing run should show:

- zero blocked 2:1 split rows;
- non-empty rendered CLOD cuts;
- no accidental frozen selection during bench;
- at least one published CLOD page-tree rebuild row;
- published rebuilds with non-zero node and triangle counts;
- valid source/build/publish ordering.

## Future edit-driver hook

This PR deliberately avoids inventing an untyped TOML schema for brush edits.
When the bench loader gains a first-class edit operation block, add an edit-heavy
checkpoint to `bench/scenes/terrain/clod-parity-stress.toml` and keep the same
guards. That will close the final PoC parity loop for edit-driven LOD0 page
rebuild, ancestor re-simplification, and collider refresh timing.
