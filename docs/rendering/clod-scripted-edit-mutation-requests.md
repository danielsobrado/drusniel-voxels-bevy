# CLOD scripted edit mutation requests

This is the handoff layer between the scripted edit dry-run pipeline and the
future authoritative terrain mutator.

Input:

```text
clod-edit-dry-run.csv
```

Output:

```text
clod-edit-mutation-requests.csv
```

By default every row is exported as `mutation_status = dry_run_only`.  This is
intentional: CLOD pages are derived caches and the authoritative terrain/world
edit path must own real voxel mutation.

To mark valid rows as ready for the real mutator:

```bash
VOXEL_CLOD_SCRIPTED_EDITS_APPLY=1 \
  scripts/export-clod-edit-mutation-requests.sh \
  bench-runs/local/clod-edit-dry-run.csv \
  bench-runs/local/clod-edit-mutation-requests.csv
```

The exporter still does not mutate terrain.  It only produces an explicit,
auditable request stream with:

- edit identity and frame;
- edit kind and parameters;
- expected dirty-page/rebuild/collider thresholds;
- whether an authoritative terrain mutation is required;
- mutation status and blocking reason.

This keeps the real edit integration reviewable and prevents a hidden bench path
from mutating terrain before the rebuild/collider guards are ready.
