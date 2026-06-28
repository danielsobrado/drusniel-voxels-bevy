# CLOD scripted edit events guard

`clod_edit_events_guard` validates the expanded per-frame edit stream generated
by `clod_edit_events_export`.

This is intentionally one step before actual terrain mutation. It lets CI prove
that a bench scene expands into deterministic, sane edit events before the edit
executor is wired into the runtime.

## Input

```text
clod-edit-events.csv
```

Expected columns:

```text
scene,checkpoint,edit,occurrence,frame,kind,x,y,z,radius,strength,target_height,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames
```

## Checks

The guard fails on:

- missing required columns;
- empty CSV unless explicitly allowed;
- unsupported edit kind;
- non-finite coordinates, radius or strength;
- non-positive radius;
- strength outside configured bounds;
- `level` edits without `target_height`;
- dirty-page min greater than max;
- expected dirty-page count above threshold;
- publish/collider frame expectations above threshold;
- duplicate `(scene, checkpoint, edit, occurrence)` rows;
- non-contiguous occurrences per edit group;
- non-increasing frames inside repeated edit groups;
- inconsistent repeat frame deltas when there are 3+ occurrences;
- globally unsorted frames when `require_sorted_frames = true`.

## Run

```bash
scripts/export-clod-edit-events.sh bench-runs/<run>/clod-edit-events.csv
scripts/guard-clod-edit-events.sh bench-runs/<run>/clod-edit-events.csv
```

PowerShell:

```powershell
scripts/export-clod-edit-events.ps1 -Out bench-runs/<run>/clod-edit-events.csv
scripts/guard-clod-edit-events.ps1 -Csv bench-runs/<run>/clod-edit-events.csv
```

## Config

Thresholds live in:

```text
assets/config/clod_edit_events_guard.toml
```
