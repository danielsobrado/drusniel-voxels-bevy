# CLOD apply-mode readiness guard

`clod_apply_mode_guard` is the final cross-stream QA check for scripted terrain
edits. It compares these artifacts from one bench run directory:

- `clod-edit-mutation-requests.csv`
- `clod-edit-authoritative-hook.csv`
- `clod-collider-refresh.csv`
- `clod-rebuild-observer.csv`

Default policy is dry-run only. For future real apply-mode tests, copy
`assets/config/clod_apply_mode_guard.toml` and set:

```toml
require_dry_run_only = false
require_authoritative_acceptance = true
require_collider_refresh = true
require_rebuild_after_apply = true
allow_pending_authoritative_apply = false
```

The guard does not know how to mutate the world. It only verifies that the audit
streams produced by the real mutator are coherent.
