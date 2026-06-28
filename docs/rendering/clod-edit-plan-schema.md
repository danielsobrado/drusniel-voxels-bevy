# CLOD edit-operation bench schema

This document defines the typed bench-scene contract for scripted terrain edits
used by the CLOD parity workflow.

The public `tools/clod-poc` made the edit path explicit: edit LOD0 terrain,
rebuild dirty page meshes, re-simplify ancestors, publish a new active page tree,
refresh collider data, and verify the active cut remains restricted. The Bevy
side should test that path through deterministic bench operations rather than
manual editor clicks.

## Scene-level defaults

```toml
[clod_edit_defaults]
radius = 4.0
strength = 0.45
expected_dirty_pages_min = 1
expected_rebuild_publish_max_frames = 90
expected_collider_refresh_max_frames = 120
```

Defaults are optional, but every operation must resolve `radius` and `strength`
from either the operation or this table.

## Checkpoint operation block

```toml
[[checkpoint.clod_edit]]
name = "dig-ridge-entrance"
frame = 60
kind = "dig"
position = [278.0, 66.0, 244.0]
radius = 5.5
strength = 0.55
repeat_every_frames = 45
repeat_count = 3
expected_dirty_pages_min = 1
expected_dirty_pages_max = 8
expected_rebuild_publish_max_frames = 90
expected_collider_refresh_max_frames = 120
```

Supported `kind` values:

- `dig`
- `raise`
- `level`
- `smooth`

`level` requires `target_height`.

## Validation

Run the schema guard before wiring a scene into automated benches:

```bash
cargo run --bin clod_edit_plan_guard -- \
  --require-edits \
  bench/scenes/terrain/clod-edit-stress.toml
```

The guard checks:

- valid TOML shape;
- at least one edit operation when `--require-edits` is set;
- unique operation names per checkpoint;
- finite positions;
- positive radius and strength;
- operation frames inside `hold_frames`;
- repeated operations remain inside the checkpoint window;
- `level` operations include `target_height`;
- dirty-page expectations are internally consistent;
- expected rebuild/collider latency limits are greater than zero.

## Runtime integration target

The future bench driver should consume these blocks and, at the requested frame,
call the same terrain-edit code path as the player/editor brush. The expected
result is then checked by the existing CLOD CSV guards:

1. `clod_stats_guard` for active-cut selection health;
2. `clod_rebuild_guard` for edit-to-publish latency and non-empty page trees.

Do not add a separate fake terrain mutation path for the bench. The point of
this schema is to stress the real runtime edit system.

