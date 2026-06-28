# CLOD cut-freeze export and guard

`clod-poc` has a tiny cut-freeze runtime state: toggle or set a boolean that
freezes the active rendered cut for inspection. The Rust selection parity PR
already added `VOXEL_CLOD_FREEZE_SELECTION`; this PR makes that behavior
machine-checkable.

## Export

Enable CSV export with:

```bash
CLOD_PAGES=1 \
VOXEL_CLOD_FREEZE_SELECTION=1 \
VOXEL_CLOD_CUT_FREEZE_CSV=1 \
VOXEL_CLOD_CUT_FREEZE_CSV_PATH=bench-runs/<run>/clod-cut-freeze.csv \
cargo run --release -- --bench bench/scenes/visual/visual-regression-live-lod.toml
```

Optional sampling:

```bash
VOXEL_CLOD_CUT_FREEZE_SAMPLE_EVERY=1
```

## CSV columns

- `frame`
- `freeze_requested`
- `frozen_active`
- `rendered_pages`
- `split_pages`
- `forced_splits`
- `blocked_splits`
- `near_field_forced_splits`
- `cut_digest`
- `cut_keys`

`cut_digest` is a stable hash of the sorted rendered CLOD page keys. `cut_keys`
uses the `level:x:z;level:x:z` format so it remains one CSV field.

## Guard

Run:

```bash
cargo run --bin clod_cut_freeze_guard -- \
  bench-runs/<run>/clod-cut-freeze.csv \
  --config assets/config/clod_cut_freeze_guard.toml
```

or:

```bash
scripts/guard-clod-cut-freeze.sh bench-runs/<run>/clod-cut-freeze.csv
```

The guard catches:

- freeze requested but never active;
- frozen cut digest changing unexpectedly;
- frozen rows with no rendered pages;
- split/2:1 counters advancing while frozen;
- rows marked frozen when the debug control was not requesting freeze.

This is intentionally separate from crossfade. Freeze is a debugging/QA lock on
the rendered cut; crossfade is a visual transition between cuts.
