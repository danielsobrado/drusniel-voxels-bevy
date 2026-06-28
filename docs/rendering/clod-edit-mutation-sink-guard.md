# CLOD scripted edit mutation sink guard

This guard validates `clod-edit-mutation-sink.csv`, the final pre-mutation
handoff in the scripted CLOD edit QA pipeline.

The sink is intentionally conservative. CLOD pages are derived caches; they do
not own terrain mutation. The default guard policy therefore requires every row
to remain a `dry_run` decision.

## Input

```text
clod-edit-mutation-sink.csv
```

Expected columns:

- `request_id`
- `frame`
- `event_id`
- `decision`
- `reason`
- `dirty_lod0_pages`
- `dirty_parent_nodes`

Supported decisions:

- `dry_run`
- `blocked`
- `ready`
- `applied_placeholder`

## Default policy

```toml
require_dry_run_only = true
allow_blocked = false
allow_ready = false
allow_applied_placeholder = false
```

Use a separate config for future apply-mode benches. The normal complete QA
suite should fail if a row reaches `ready` or `applied_placeholder` before the
authoritative terrain mutator and collider-refresh guard are wired.

## Run

```bash
scripts/guard-clod-edit-mutation-sink.sh   bench-runs/<run>/clod-edit-mutation-sink.csv
```

PowerShell:

```powershell
scripts/guard-clod-edit-mutation-sink.ps1   -Csv bench-runs/<run>/clod-edit-mutation-sink.csv
```
