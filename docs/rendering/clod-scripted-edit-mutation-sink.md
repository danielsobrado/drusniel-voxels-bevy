# CLOD scripted edit mutation sink

This PR adds the final pre-mutation handoff for scripted CLOD edit QA.

Input:

```text
clod-edit-mutation-requests.csv
```

Output:

```text
clod-edit-mutation-sink.csv
```

The sink records a deterministic decision per request:

- `dry_run` — default; no terrain mutation is allowed.
- `blocked` — invalid or upstream-blocked request.
- `ready` — `VOXEL_CLOD_SCRIPTED_EDITS_APPLY=1` was set, but no authoritative terrain hook is available.
- `applied_placeholder` — both apply and authoritative-hook flags are present; this still does not mutate terrain from the CLOD layer.

The authoritative terrain/world system must remain the only system that changes `VoxelWorld`. CLOD pages are derived caches; the sink only proves that the QA request stream is valid and safely gated.

Run:

```bash
scripts/export-clod-edit-mutation-sink.sh \
  bench-runs/local/clod-edit-mutation-requests.csv \
  bench-runs/local/clod-edit-mutation-sink.csv
```

Opt-in readiness mode:

```bash
VOXEL_CLOD_SCRIPTED_EDITS_APPLY=1 \
scripts/export-clod-edit-mutation-sink.sh
```

Placeholder apply mode:

```bash
VOXEL_CLOD_SCRIPTED_EDITS_APPLY=1 \
VOXEL_CLOD_SCRIPTED_EDITS_AUTHORITATIVE_HOOK=1 \
scripts/export-clod-edit-mutation-sink.sh
```
