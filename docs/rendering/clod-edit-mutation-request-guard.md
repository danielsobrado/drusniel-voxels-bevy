# CLOD scripted edit mutation request guard

This guard validates `clod-edit-mutation-requests.csv`, the handoff stream
created by `clod_edit_mutation_request_export`.

The guard does **not** mutate terrain. It exists so the future real mutator can
be reviewed against a stable request contract before it is allowed to change the
authoritative voxel world.

## Input

```text
clod-edit-mutation-requests.csv
```

Expected columns include:

- `request_id`
- `frame`
- `kind`
- `radius`
- `strength`
- `dirty_lod0_pages`
- `dirty_total_nodes`
- `apply_enabled`
- `requires_authoritative_world_mutation`
- `mutation_status`
- `reason`

Supported statuses:

- `dry_run_only`
- `ready_to_apply`
- `blocked_dirty_page_mismatch`
- `blocked_dispatch_status`
- `blocked_invalid_request`

## Default policy

The default config is conservative:

```toml
allow_ready_to_apply = false
allow_blocked_requests = false
require_authoritative_world_mutation = true
require_apply_enabled_consistency = true
require_unique_request_ids = true
```

This means the current complete QA path should only contain valid
`dry_run_only` requests. Once the authoritative mutator is wired, create a
separate config or set `allow_ready_to_apply = true` for the apply-mode bench.

## Run

```bash
scripts/guard-clod-edit-mutation-requests.sh \
  bench-runs/<run>/clod-edit-mutation-requests.csv
```

PowerShell:

```powershell
scripts/guard-clod-edit-mutation-requests.ps1 \
  -Csv bench-runs/<run>/clod-edit-mutation-requests.csv
```
