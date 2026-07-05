# CLOD-POC Save/Load Integrity Fixes

Implemented 2026-07-05 after the save-world review follow-up. This note records the corrected behaviour that supersedes the stale load-order wording in `docs/plans/clod-poc-procedural-save-world-plan.md` until that larger plan is regenerated.

## Correct bootstrap load order

```text
1. Parse save=<saveId>. Absent -> skip save load.
2. Open IndexedDB and read SaveWorldManifest.
3. Validate schema, seed, region size, chunk size, and canonical region keys.
4. Read every region listed in manifest.regionKeys.
5. Validate every RegionManifest, RegionVoxelDeltas, and SavedPropInstance[] as a complete region record.
6. Reject props whose regionKey does not match the region manifest.
7. Reject props whose position maps to a different region via regionKeyForWorld(position[0], position[2]).
8. Merge saved props across all loaded regions and reject duplicate saved prop IDs across the whole save.
9. Read and validate WorldMetadataRecord.
10. Validate metadata -> saved prop links and critical-path data before mutating runtime voxel state.
11. Merge voxel deltas and call replaceVoxelEdits(merged). This remains the only voxel-store mutation during load.
12. Optionally replay loaded region invalidation bounds through save_far_summary_bridge after save/far-summary integration is registered.
```

## Region-boundary rules

Save metadata region membership uses half-open area bounds:

```text
[minX, maxX) x [minZ, maxZ)
```

Exact point bounds remain point-owned, so `x = 512` belongs to `r_1_*`, not `r_0_*`. Non-point area bounds ending exactly at `x = 512` do not include `r_1_*` unless the area crosses past the boundary.

The implementation now avoids fixed metric epsilon hacks for max bounds. Exact region boundaries are handled symbolically, and `WorldMetadataStore.queryRegion()` uses the same half-open semantics as `regionKeysForBounds()`.

## Validation hardening

- Saved prop optional integer fields must be safe integers when present.
- Saved prop optional link strings must be non-empty after trimming whitespace.
- Cross-region duplicate saved prop IDs are load-blocking corruption.
- Region-local duplicate prop IDs remain region-record corruption.

## Regression coverage

The save tests cover:

```text
- exact positive and negative half-open region boundaries
- exact point ownership on a region boundary
- tiny bounds crossing a region boundary by less than the previous epsilon
- queryRegion area bounds ending exactly at a boundary
- queryRegion point bounds exactly on a boundary
- cross-region duplicate saved prop IDs rejected before voxel replacement
- saved prop position/region mismatch
- whitespace-only optional saved prop links
```
