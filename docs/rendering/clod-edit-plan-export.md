# CLOD edit plan export

`src/bin/clod_edit_plan_export.rs` materializes `[[checkpoint.clod_edit]]` bench operations into a deterministic CSV of dirty CLOD nodes.

It is the bridge between the schema guard and the runtime rebuild observer:

1. Read one or more bench scene TOML files.
2. Resolve edit defaults, repeats, brush radius and strength.
3. Build the CLOD LOD0 grid from `config/clod_pages.yaml` unless command-line overrides are supplied.
4. Call `plan_dirty_pages_for_sphere` from `src/voxel/pages/edit_dirtiness.rs`.
5. Write one CSV row per concrete edit iteration.

Example:

```bash
scripts/export-clod-edit-plan.sh perf-dumps/clod-edit-plan.csv
```

Useful overrides:

```bash
cargo run --bin clod_edit_plan_export -- \
  bench/scenes/terrain/clod-edit-stress.toml \
  --out perf-dumps/clod-edit-plan.csv \
  --origin-min-page-x 0 \
  --origin-min-page-z 0 \
  --world-pages-x 8 \
  --world-pages-z 8 \
  --max-levels 4 \
  --influence-margin 1.0 \
  --require-edits
```

CSV columns include:

- scene/checkpoint/edit identity
- concrete iteration frame
- brush kind, position, radius, strength and optional target height
- expected dirty-page/rebuild thresholds from the scene
- `dirty_lod0_pages`
- `dirty_ancestor_nodes`
- `dirty_total_nodes`
- `lod0_page_coords`
- `ancestor_node_coords`

The intended QA loop is:

```bash
scripts/check-clod-edit-plan.sh
scripts/export-clod-edit-plan.sh bench-runs/<run>/clod-edit-plan.csv
CLOD_PAGES=1 VOXEL_CLOD_REBUILD_CSV=1 VOXEL_CLOD_STATS_CSV=1 scripts/run-clod-parity-bench.sh
cargo run --bin clod_rebuild_guard -- bench-runs/<run>/clod-rebuild-observer.csv
cargo run --bin clod_stats_guard -- bench-runs/<run>/clod-selection-runtime.csv
```

This PR does not mutate the voxel world. It exports the exact invalidation plan that the next runtime PR should consume and then compare against rebuild telemetry.
