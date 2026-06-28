# CLOD scripted edit dry-run adapter

This PR adds the dry-run adapter between scripted edit dispatch and the real
terrain-edit path.

The adapter reads `clod-edit-dispatch.csv`, converts each row into a typed
terrain edit request, and computes the conservative CLOD dirty-page plan for the
request.  It does **not** mutate terrain.  Mutation remains explicitly disabled
until the next integration step wires the requests into the authoritative world
edit system with collider refresh telemetry enabled.

## Export

```bash
scripts/export-clod-edit-events.sh bench-runs/local/clod-edit-events.csv
scripts/export-clod-edit-dispatch.sh \
  bench-runs/local/clod-edit-events.csv \
  bench-runs/local/clod-edit-dispatch.csv
scripts/export-clod-edit-dry-run.sh \
  bench-runs/local/clod-edit-dispatch.csv \
  bench-runs/local/clod-edit-dry-run.csv
```

PowerShell:

```powershell
scripts/export-clod-edit-events.ps1 bench-runs/local/clod-edit-events.csv
scripts/export-clod-edit-dispatch.ps1 `
  bench-runs/local/clod-edit-events.csv `
  bench-runs/local/clod-edit-dispatch.csv
scripts/export-clod-edit-dry-run.ps1 `
  bench-runs/local/clod-edit-dispatch.csv `
  bench-runs/local/clod-edit-dry-run.csv
```

## Environment

The exporter defaults match the small CLOD PoC gate:

- `VOXEL_CLOD_EDIT_DRY_RUN_PAGE_SIZE=64`
- `VOXEL_CLOD_EDIT_DRY_RUN_MIN_PAGE_X=0`
- `VOXEL_CLOD_EDIT_DRY_RUN_MIN_PAGE_Z=0`
- `VOXEL_CLOD_EDIT_DRY_RUN_WORLD_PAGES_X=8`
- `VOXEL_CLOD_EDIT_DRY_RUN_WORLD_PAGES_Z=8`
- `VOXEL_CLOD_EDIT_DRY_RUN_MAX_LEVELS=4`
- `VOXEL_CLOD_EDIT_DRY_RUN_INFLUENCE_MARGIN=0`

## CSV columns

`clod-edit-dry-run.csv` contains request identity, edit parameters, mutation
mode, dirty-page counts, rebuild/collider frame expectations, and a dispatch
status.  The status is `ready` when the computed dirty LOD0 page count is inside
the edit expectation window.

## Next PR

The next PR should add a guard for this dry-run CSV, then wire a default-off
runtime adapter that can emit the typed requests during Bevy bench execution.
