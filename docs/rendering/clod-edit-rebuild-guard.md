# CLOD edit rebuild guard

`clod_edit_rebuild_guard` compares two CSVs from the CLOD parity pipeline:

1. `clod-edit-plan.csv` from `clod_edit_plan_export`.
2. `clod-rebuild-observer.csv` from the runtime rebuild observer.

The guard does not inspect meshes. It answers a narrower but important QA question:

> For every planned dirty edit, did the runtime publish a complete CLOD page-tree rebuild inside the expected frame window?

## Inputs

```bash
scripts/export-clod-edit-plan.sh bench-runs/<run>/clod-edit-plan.csv
CLOD_PAGES=1 \
VOXEL_CLOD_REBUILD_CSV=1 \
VOXEL_CLOD_REBUILD_CSV_PATH=bench-runs/<run>/clod-rebuild-observer.csv \
scripts/run-clod-parity-bench.sh
scripts/guard-clod-edit-rebuild.sh \
  bench-runs/<run>/clod-edit-plan.csv \
  bench-runs/<run>/clod-rebuild-observer.csv
```

## Matching rule

For each plan row with `dirty_lod0_pages >= --min-dirty-pages`, the guard finds a rebuild row where:

- the rebuild is a complete publication;
- `input_frame >= plan.frame`;
- `published_frame <= plan.frame + expected_rebuild_publish_max_frames`.

If a plan row has no `expected_rebuild_publish_max_frames`, the guard uses `--default-max-publish-frames`, default `120`.

By default, one rebuild row can satisfy multiple planned edits because edits may be batched. Pass `--require-distinct-rebuilds` for stricter one-edit/one-publication validation.

## Failure examples

The guard fails on:

- dirty edit with no later rebuild publication;
- rebuild publication with zero pages, nodes, or triangles;
- tree revision that did not advance;
- missing source/build timing marks;
- invalid dirty page expectation ranges inherited from the edit plan.

## Options

```bash
cargo run --bin clod_edit_rebuild_guard -- \
  --plan bench-runs/<run>/clod-edit-plan.csv \
  --rebuild bench-runs/<run>/clod-rebuild-observer.csv \
  --default-max-publish-frames 120 \
  --min-matched-ratio 1.0 \
  --max-unmatched-edits 0
```

This guard should run after `clod_edit_plan_guard`, `clod_stats_guard`, and `clod_rebuild_guard`. It is the cross-file check that links planned edits to real runtime CLOD rebuild publications.
