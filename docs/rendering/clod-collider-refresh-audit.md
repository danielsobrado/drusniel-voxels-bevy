# CLOD collider refresh audit

`clod-collider-refresh.csv` is the QA stream for the last part of scripted CLOD
edit parity:

```text
edit request -> authoritative terrain mutation -> CLOD rebuild -> collider refresh
```

The CLOD page layer must not edit the world directly. The audit stream therefore
starts from `clod-edit-authoritative-hook.csv` and records whether each request
would require collider invalidation and refresh.

Default decisions:

- `dry_run` — normal QA mode; no terrain mutation and no collider refresh.
- `pending_authoritative_apply` — apply was requested but the real mutator has not produced refresh telemetry yet.
- `refreshed` — future apply-mode row; collider refresh completed.
- `stale` — failure row; edited terrain still has stale collider data.
- `timeout` — failure row; refresh did not complete within the expected frame window.

Default guards require `dry_run` only. Apply-mode tests should use a stricter
config that requires `refreshed` rows and rejects `pending_authoritative_apply`.
