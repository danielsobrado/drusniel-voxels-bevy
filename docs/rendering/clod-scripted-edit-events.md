# CLOD scripted edit events

PR 8 added the `[[checkpoint.clod_edit]]` scene schema and PR 10 exported the
expected dirty-page plan. This PR adds the missing middle layer: deterministic
scripted edit events that can be emitted by the bench runner and consumed by a
future runtime mutator.

The event layer is intentionally runtime-neutral. It does **not** change
`VoxelWorld`, terrain brushes, colliders, or CLOD pages directly. It only:

1. resolves defaults;
2. validates operation fields;
3. expands repeats into concrete per-frame events;
4. exports those events to CSV.

That keeps the next PR small: the bench runner only needs to enqueue these
events, and the terrain edit adapter only needs to consume them.

## Supported edit kinds

- `dig`
- `raise`
- `level`
- `smooth`

`level` requires `target_height`; the other edit kinds reject
`target_height` to prevent ambiguous fixture semantics.

## Event CSV

Use:

```bash
scripts/export-clod-edit-events.sh bench-runs/<run>/clod-edit-events.csv
```

PowerShell:

```powershell
scripts/export-clod-edit-events.ps1 -Out bench-runs/<run>/clod-edit-events.csv
```

CSV columns:

```text
scene,checkpoint,edit,occurrence,frame,kind,x,y,z,radius,strength,target_height,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames
```

## Intended runtime flow

The later execution PR should follow this shape:

```rust
for event in due_scripted_clod_edit_events(current_frame) {
    // 1. apply event to VoxelWorld through the same brush/edit path used by gameplay;
    // 2. record dirty pages with edit_dirtiness;
    // 3. let the normal source mesh + CLOD rebuild queue publish a new tree;
    // 4. compare clod-edit-events.csv + clod-edit-plan.csv against rebuild/collider telemetry.
}
```

Do not rebuild CLOD pages directly from this module. `VoxelWorld` remains
authoritative; CLOD pages are derived caches.

## Why separate from the dirty-page plan?

The dirty-page plan answers “what should be invalidated?”. Scripted events answer
“what terrain operation should happen, and on which frame?”. Keeping these as
separate CSVs lets QA catch three different classes of bug:

- scene schema bug: invalid operation never becomes an event;
- planner bug: event exists but expected dirty nodes are wrong;
- runtime bug: event and plan exist but rebuild/collider telemetry never follows.
