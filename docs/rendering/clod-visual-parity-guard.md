# CLOD visual parity guard

This guard cross-checks the CLOD CSV streams that were added for the PoC parity
work:

- selection stats: `VOXEL_CLOD_STATS_CSV=1`
- crossfade/material stats: `VOXEL_CLOD_CROSSFADE_STATS_CSV=1`
- cut-freeze stats: `VOXEL_CLOD_CUT_FREEZE_CSV=1`

The focused guards validate each stream on its own. This guard validates that the
streams agree with each other.

## Run

```bash
scripts/guard-clod-visual-parity.sh \
  bench-runs/<run>/clod-selection-runtime.csv \
  bench-runs/<run>/clod-crossfade-runtime.csv \
  bench-runs/<run>/clod-cut-freeze.csv
```

PowerShell:

```powershell
scripts/guard-clod-visual-parity.ps1 `
  -SelectionCsv bench-runs/<run>/clod-selection-runtime.csv `
  -CrossfadeCsv bench-runs/<run>/clod-crossfade-runtime.csv `
  -CutFreezeCsv bench-runs/<run>/clod-cut-freeze.csv
```

## Checks

The guard fails when:

- crossfade stats are exported but the crossfade material flag is disabled;
- crossfade page entities drift too far from selected rendered pages;
- runtime fading pages exist without ECS fade components;
- fade alpha goes outside `[0, 1]`;
- fade-out pages/entities remain alive at the end of the bench;
- cut-freeze and selection disagree about frozen state;
- blocked split counters disagree across CSVs;
- the active cut digest changes while frozen;
- crossfade transition id advances while the cut is frozen.

Warnings are emitted for non-fatal mismatches such as minor rendered-page count
skew between the selection and cut-freeze streams.

## Config

Defaults live in:

```text
assets/config/clod_visual_parity_guard.toml
```

The most common adjustment is `rendered_page_delta_max`. Keep it small. If this
needs to be large, the crossfade bridge is probably keeping stale page entities
alive too long.
