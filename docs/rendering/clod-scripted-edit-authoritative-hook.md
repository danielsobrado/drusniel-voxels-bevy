# CLOD scripted edit authoritative hook contract

This PR adds the explicit contract between scripted CLOD edit QA and the real
terrain/world edit system.

The important rule remains unchanged: **CLOD pages are derived caches**. The
scripted edit flow must not mutate page meshes directly. Instead, it produces a
request that the authoritative `VoxelWorld`/terrain edit path can apply later.

Input:

```text
clod-edit-mutation-requests.csv
```

Output:

```text
clod-edit-authoritative-hook.csv
```

Decision values:

- `dry_run` — default; no authoritative hook is allowed.
- `hook_unavailable` — apply was requested, but the authoritative hook is not present.
- `rejected_invalid_request` — malformed or duplicate request.
- `accepted_for_authoritative_mutation` — valid request accepted by the contract hook.

Default run:

```bash
scripts/export-clod-edit-authoritative-hook.sh
```

Apply requested but hook missing:

```bash
VOXEL_CLOD_SCRIPTED_EDITS_APPLY=1 \
scripts/export-clod-edit-authoritative-hook.sh
```

Contract-hook acceptance mode:

```bash
VOXEL_CLOD_SCRIPTED_EDITS_APPLY=1 \
VOXEL_CLOD_SCRIPTED_EDITS_AUTHORITATIVE_HOOK=1 \
scripts/export-clod-edit-authoritative-hook.sh
```

This still does not edit the terrain. It only proves that the request stream can
be safely handed to the authoritative world mutator in a later PR.
