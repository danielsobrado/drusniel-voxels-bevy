# WorldSource horizon summary contract

`tools/clod-poc` uses one `TerrainSummaryField` for the far shell, canopy shell, and shadow proxy. ISLE-14 keeps that single-summary rule and extends the summary samplers so horizon samples can come from the active `WorldSource` instead of clamping to the finite baked grid.

## Contract

The summary owns two data paths:

1. Baked CLOD-page envelope data inside the summary footprint.
2. Analytic `WorldSource` fallback beyond that footprint.

The far shell, canopy shell, and shadow proxy must continue to receive the same `TerrainSummaryField`; do not create a separate horizon summary and do not increase the near terrain cull distance.

## Runtime behavior

`buildTerrainSummary(..., { worldSource })` stores:

- `analyticHeightSampler`
- `analyticBiomeSampler`
- per-cell `biomeId`

Summary samplers now behave as follows:

| Sampler | Inside footprint | Outside footprint |
| --- | --- | --- |
| `sampleHeight` | baked height field | `WorldSource.sampleHeight` |
| `sampleHeightBlend` | baked min/max blend | `WorldSource.sampleHeight` |
| `sampleNormal` | baked finite-difference normal | analytic finite-difference normal from `WorldSource.sampleHeight` |
| `sampleCoverage` | baked coverage | `0` |
| `sampleBiomeId` | baked biome id | `WorldSource.sampleBiome` |

`sampleSkirtHeight` still blends through the same function used by the finite-world skirt, but outside-footprint height now starts from the active `WorldSource` height.

## Far-shell color

The far shell already writes vertex colors from material/biome IDs through `writeBiomeRgb`. The far-summary sampler now keeps the provider material ID even when far height and normal are macro-blended for horizon shaping. That prevents distant terrain from drifting into unrelated macro terrain colors.

## Acceptance

For `infinite-islands` and related streaming scenes:

- Distant terrain must use the same height source as near terrain.
- Far shell and canopy biome color must match `WorldSource.sampleBiome` outside the finite summary grid.
- The same `TerrainSummaryField` must feed far shell, canopy, and shadow.
- No cull-distance increase is allowed as a substitute for horizon continuity.
