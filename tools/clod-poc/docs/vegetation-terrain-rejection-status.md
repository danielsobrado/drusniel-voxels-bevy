# Vegetation terrain rejection status

This note tracks the conservative pre-generation rejection work for CLOD-POC vegetation.

## Default safety posture

GPU vegetation early rejection is enabled through the shared TypeScript config object `DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.gpuEarlyReject`.

Current defaults:

```yaml
vegetation:
  gpuEarlyReject:
    enabled: true
    debugValidateCpuOracle: false
    debugReadbackCounters: false
    statsHz: 4
    minClusterSize: 16
    maxRejectedUnknownRatio: 0.0
    rejectKinds:
      trees: true
      grass: true
      understory: true
    conservative:
      acceptWhenSummaryMissing: true
      acceptWhenRevisionMismatch: true
      minCoverageToAccept: 0.05
```

Normal gameplay does not require GPU readbacks for this optimization. Readback-based count validation remains behind existing debug/perf flags.

Probe-only static terrain rejection is disabled by default. It is an opt-in tuning/debug path because center/corner probes cannot prove that a whole page has no valid interior vegetation. This prevents false vegetation holes until summary/coverage data can prove full-footprint rejection.

## Shared provider

The formal provider is `createVegetationTerrainRejectProvider()` in `src/vegetation/vegetation_terrain_reject_provider.ts`.

Provider output:

```text
reject: boolean
reason:
  outsideTerrain
  terrainHidden
  belowWaterOrInvalid
  tooFarForKind
  noCoverage
  summaryMissing
  accepted
confidence:
  exact
  summary
  fallback
```

Current CLOD-POC source data is still the conservative height/terrain visibility sampler. Missing summaries, stale revisions, unknown height samples, mixed probes, and near clusters are accepted/fallback-kept. This avoids vegetation holes.

## GPU trees

GPU tree rings build a cluster visibility mask before dispatch. The runtime passes `activeSlotIndices`, `candidateCountBeforePrefilter`, and `candidateCountAfterPrefilter` into the tree GPU ring compute path. The compute shader processes only the accepted active slots.

Counters to watch:

- `treeGpuCandidateCountBeforePrefilterAvg`
- `treeGpuCandidateCountAfterPrefilterAvg`
- `treeGpuPrefilterRejectedClustersAvg`
- `treeGpuPrefilterSkippedCandidateEstimateAvg`

## GPU grass

GPU grass rings use `buildVegetationSlotPrefilter()` before dispatch. The resulting `activeSlotIndices` buffer is bound to the compute shader, and `grass_cull` dispatches over the compact active-slot list. Candidate generation work now scales with the post-prefilter budget.

Counters to watch:

- `grassGpuCandidateCountBeforePrefilterAvg`
- `grassGpuCandidateCountAfterPrefilterAvg`
- `grassGpuCandidateCountAvg`

The GUI shows `after/before` in the grass candidate field when prefiltering reduces the active budget.

## GPU understory

GPU understory rings use the same shared slot prefilter and active-slot buffer pattern as grass. The compute shader reads `active_slots[id.x]` and skips sentinel slots, so rejected clusters are skipped before the expensive placement path runs.

Counters to watch:

- `understoryGpuCandidateCountBeforePrefilterAvg`
- `understoryGpuCandidateCountAfterPrefilterAvg`
- `understoryGpuCandidateCountAvg`

The GUI shows `prefilter=after/before` in the understory GPU summary when prefiltering reduces the active budget.

## Aggregate counters

The helper `aggregateGpuVegetationEarlyRejectCounters()` exposes the requested aggregate names:

```text
vegetationGpuClustersTotal
vegetationGpuClustersRejectedEarly
vegetationGpuClustersAccepted
vegetationGpuClustersSummaryMissing
vegetationGpuCandidatesBudgetBeforeReject
vegetationGpuCandidatesBudgetAfterReject
vegetationGpuCandidatesGenerated
vegetationGpuRejectOutsideTerrain
vegetationGpuRejectTerrainHidden
vegetationGpuRejectNoCoverage
vegetationGpuRejectInvalidSurface
vegetationGpuEarlyRejectMs
```

Tree cluster counters are true cluster counts. Grass and understory currently expose candidate-budget deltas, not full reason-separated cluster counts, because their WebGPU ring path uses active slot lists without a separate cluster telemetry buffer.

## CPU trees

CPU tree patches can be rejected before `generateTreeInstances()` by terrain-hidden visibility. The opt-in static rule path is kept behind the shared static rejection toggle.

## CPU grass

CPU grass has a static footprint rejection gate before the candidate loop in `generateGrassInstances()`, but that path is opt-in through `DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled`. With defaults, grass keeps all pages and relies on existing per-candidate validation.

## CPU understory

CPU understory pages have a static footprint rejection gate before `createPatch()`, but that path is opt-in through `DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled`. Fully rejected opt-in pages do not allocate patch groups or meshes. The generator no longer owns a separate duplicate rejection path.

## Perf probe

Suggested A/B URLs:

```text
?perfProbe=1&gpuEarlyReject=0&perfWarmupFrames=120&perfSampleFrames=300
?perfProbe=1&gpuEarlyReject=1&perfWarmupFrames=120&perfSampleFrames=300
?perfProbe=1&gpuEarlyReject=1&gpuEarlyRejectDebugOracle=1&perfWarmupFrames=120&perfSampleFrames=300
```

Report these values from `window.__drusnielPerf.snapshot()`:

```text
clusters total:
clusters rejected early:
candidate budget before:
candidate budget after:
candidates actually generated:
vegetationTotalMs p50/p95:
statsSyncMs p50/p95:
visual differences:
```

## Known limitations

This is still a browser validation prototype. The provider currently wraps the existing height/terrain visibility sampler. It does not yet use the production Bevy/Rust NAADF far-summary atlas as its first source of truth.

For Rust/Bevy NAADF parity, port the same idea as:

```text
NAADF / far-summary provider
  -> conservative page or cluster classification
  -> compacted accepted cluster list
  -> candidate generation only for accepted clusters
  -> indirect draw of accepted batches
```

## Stones

Stones are GPU-scattered. Their terrain rejection stays inside the stone GPU scatter path because stone placement uses different rules from trees/grass: repose slope, stream/cliff probes, water margin, stone terrain weights, and per-class radius/sink config. A CPU-side grass/tree rejection gate is intentionally not shared with stones.

TODO: If stone scatter dispatch cost becomes measurable, add a stone-specific GPU cluster mask or dispatch skip. Do not reuse grass/tree slope or biome rules for stones.
