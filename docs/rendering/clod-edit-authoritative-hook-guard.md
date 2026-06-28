# CLOD scripted edit authoritative hook guard

This guard validates `clod-edit-authoritative-hook.csv`, the audit stream that
models the handoff from scripted CLOD edit QA to the authoritative terrain/world
edit path.

The CLOD page layer is a derived cache. This guard keeps the default complete QA
suite from accidentally blessing real terrain mutation before the VoxelWorld edit
hook and collider-refresh guard are wired.

## Input

```text
clod-edit-authoritative-hook.csv
```

Expected columns:

- `request_id`
- `frame`
- `checkpoint`
- `decision`
- `requires_authoritative_world_mutation`
- `hook_available`
- `apply_requested`
- `dirty_lod0_pages`
- `dirty_nodes`
- `note`

Supported decisions:

- `dry_run`
- `hook_unavailable`
- `rejected_invalid_request`
- `accepted_for_authoritative_mutation`

## Default policy

```toml
require_dry_run_only = true
allow_hook_unavailable = false
allow_rejected_invalid_request = false
allow_accepted_for_authoritative_mutation = false
```

That means the normal complete QA run must audit the hook contract but keep every
row in dry-run mode. A future apply-mode bench can provide a separate config once
the real authoritative mutator and collider-refresh telemetry are present.

## Run

```bash
scripts/guard-clod-edit-authoritative-hook.sh \
  bench-runs/<run>/clod-edit-authoritative-hook.csv
```

PowerShell:

```powershell
scripts/guard-clod-edit-authoritative-hook.ps1 \
  -Csv bench-runs/<run>/clod-edit-authoritative-hook.csv
```
