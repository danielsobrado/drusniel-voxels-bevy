# CLOD-POC Far-Summary Atlas Dirty Upload Validation

## Purpose

This note records how to validate that the NAADF far-summary GPU atlas uses dirty-rect uploads during normal movement, and full uploads only for safe fallback cases.

## Counters

The CLOD HUD/perf counters expose these values:

| Counter | Meaning |
| --- | --- |
| `naadf.farSummaryAtlas.upload.totalPixels` | Full atlas pixel count. |
| `naadf.farSummaryAtlas.upload.dirtyPixels` | Pixels touched by the last upload. |
| `naadf.farSummaryAtlas.upload.dirtyPct` | `dirtyPixels / totalPixels`. |
| `naadf.farSummaryAtlas.upload.dirtyRects` | Dirty rect count used by the last upload. |
| `naadf.farSummaryAtlas.upload.dirtyUploads` | Cumulative dirty upload count. |
| `naadf.farSummaryAtlas.upload.fullUploads` | Cumulative full upload count. |
| `naadf.farSummaryAtlas.upload.modeCode` | Last upload mode: `0=none`, `1=dirty`, `2=full`. |
| `naadf.farSummaryAtlas.upload.fallbackReasonCode` | Full fallback reason: `0=none`, `1=initial`, `2=explicit`, `3=disabled`, `4=too_many_rects`, `5=threshold`, `6=invalid_atlas`, `7=partial_ranges_unsupported`, `8=full_invalidation`. |

## Expected behavior

### First atlas population

Expected:

- `modeCode = 2`
- `fallbackReasonCode = 1`
- `dirtyPixels = totalPixels`

Reason: the first atlas population is intentionally a full upload.

### Small tile revision update

Expected:

- `modeCode = 1`
- `fallbackReasonCode = 0`
- `dirtyPixels < totalPixels`
- `dirtyUploads` increases

Reason: only the changed tile rect should be cleared/blitted/uploaded.

### One-tile camera window shift

Expected when dirty area is below threshold:

- `modeCode = 1`
- `fallbackReasonCode = 0`
- `dirtyPixels < totalPixels`

Reason: old moved/removed slots are cleared and new/moved slots are blitted, without clearing the full atlas.

### Large movement or many changed tiles

Expected when the threshold or rect-count guard is crossed:

- `modeCode = 2`
- `fallbackReasonCode = 4` for too many rects, or `5` for dirty area over threshold
- `dirtyPixels = totalPixels`

Reason: a full upload is cheaper and safer than many small row updates.

### Unsupported partial update ranges

Expected if the active renderer/texture path does not expose usable update ranges:

- `modeCode = 2`
- `fallbackReasonCode = 7`
- `dirtyPixels = totalPixels`

Reason: correctness wins over pretending dirty uploads are active.

## Validation commands

Run from `tools/clod-poc`:

```bash
npm run typecheck
npm run test
npm run build
```

Then run a NAADF/CLOD scene with the HUD/perf counters visible and verify the counter transitions above.

## Remaining runtime proof

The code verifies that Three.js `DataTexture` exposes `addUpdateRange`, `clearUpdateRanges`, and `updateRanges`. A browser/GPU capture is still required to prove the active renderer backend performs true subtexture uploads instead of internally uploading the full texture.
