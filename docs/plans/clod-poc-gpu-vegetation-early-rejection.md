# CLOD-POC GPU vegetation early rejection

Status: implemented in `tools/clod-poc` for the browser validation prototype.

This note documents the GPU vegetation candidate rejection path used by CLOD-POC. It is not the final Rust/Bevy NAADF renderer, but the same design should be ported later: shared terrain visibility summaries, conservative cluster rejection, compact accepted work, then indirect draw.

## Goal

The optimization rejects vegetation clusters before expensive GPU candidate generation. The win is measured by candidate budget reduction, not only by final visible instance count.

Bad path:

```text
generate every ring slot / candidate
sample terrain visibility later
discard many generated candidates
```

Target path:

```text
classify vegetation slots/clusters with conservative terrain visibility
build compact active-slot list
generate candidates only for accepted slots
run the existing visibility/frustum/shadow cull
draw accepted batches
```

## Runtime paths

### Trees

Tree GPU ring visibility uses the tree cluster visibility mask path:

```text
buildTreeRingClusterVisibilityMask(...)
  -> visibleClusterMask.activeSlotIndices
  -> TreeGpuRingCompute.dispatch(... activeSlotIndices ...)
  -> tree_ring.compute.wgsl reads active_slots[id.x]
```

Stats include:

```text
gpuCandidateCountBeforePrefilter
gpuCandidateCountAfterPrefilter
gpuPrefilterRejectedClusters
gpuPrefilterSkippedCandidateEstimate
```

### Grass

Grass GPU ring now uses the shared vegetation slot prefilter:

```text
buildVegetationSlotPrefilter(kind="grass", ...)
  -> activeSlotIndices
  -> GrassGpuRingCompute.dispatch(... activeSlotIndices ...)
  -> grass_ring.compute.wgsl reads active_slots[id.x]
```

Stats include:

```text
gpuRingCandidateCountBeforePrefilter
gpuRingCandidateCountAfterPrefilter
generatedCandidates
acceptedCandidates
```

The UI can show candidate reduction as:

```text
prefilter=<after>/<before>
```

or in the grass candidate field:

```text
<after>/<before>
```

### Understory

Understory GPU ring uses the shared vegetation slot prefilter:

```text
buildVegetationSlotPrefilter(kind="understory", ...)
  -> activeSlotIndices
  -> UnderstoryGpuRingCompute.dispatch(... activeSlotIndices ...)
  -> understory_ring.compute.wgsl reads active_slots[id.x]
```

Stats include:

```text
gpuCandidateCountBeforePrefilter
gpuCandidateCountAfterPrefilter
gpuCandidateCount
gpuAcceptedCount
gpuVisibleCount
```

The UI can show candidate reduction as:

```text
prefilter=<after>/<before>
```

## Conservative rejection rules

The shared slot prefilter is conservative by design.

It may reject:

```text
terrain_hidden
  all cluster probes are hidden by terrain visibility sampling
```

It must not reject:

```text
missing sampler/data
unknown samples
uncertain summary state
near forced-visible regions
visibility disabled by config
mixed clusters where any probe is visible
```

For those cases, the cluster is kept active. This avoids terrain-visibility holes.

## Data freshness and flicker control

The prefilter cache key includes:

```text
vegetation kind
cluster/grid/cell identity
quantized camera X/Z/Y
world size
visibility settings
terrain revision
provider revision
```

Camera quantization avoids tiny camera movements thrashing the cache. Terrain and provider revision keys prevent stale visibility decisions after edits or provider changes.

If the summary/provider state is missing or uncertain, the result falls back to accepted/visible, not rejected.

## Readback policy

The optimization does not require normal gameplay GPU readbacks.

Allowed:

```text
active-slot list built on CPU/summary side
candidate budget counters tracked on CPU side
shader skips non-active slots through active_slots buffer
```

Debug/perf paths may still enable GPU count readbacks through existing debug flags, but readbacks are not required for early rejection to work.

## Counters to watch

Useful existing counters / stats fields:

```text
tree.gpuCandidateCountBeforePrefilter
tree.gpuCandidateCountAfterPrefilter
tree.gpuPrefilterRejectedClusters
tree.gpuPrefilterSkippedCandidateEstimate

grass.gpuRingCandidateCountBeforePrefilter
grass.gpuRingCandidateCountAfterPrefilter
grass.generatedCandidates
grass.acceptedCandidates

understory.gpuCandidateCountBeforePrefilter
understory.gpuCandidateCountAfterPrefilter
understory.gpuCandidateCount
understory.gpuAcceptedCount
understory.gpuVisibleCount
```

Equivalent task-level names:

```text
vegetationGpuClustersTotal              = prefilter cluster count
vegetationGpuClustersRejectedEarly      = rejectedClusters
vegetationGpuClustersAccepted           = visibleClusters
vegetationGpuClustersSummaryMissing     = unknownKeptClusters
vegetationGpuCandidatesBudgetBeforeReject = candidateCountBeforePrefilter
vegetationGpuCandidatesBudgetAfterReject  = candidateCountAfterPrefilter
vegetationGpuCandidatesGenerated          = generatedCandidates / candidateCountAfterPrefilter
vegetationGpuRejectTerrainHidden          = reasonCounts.terrain_hidden
vegetationGpuRejectOutsideTerrain         = CPU/static rejection path when enabled
vegetationGpuRejectNoCoverage             = future summary/coverage path
vegetationGpuRejectInvalidSurface         = future summary/coverage path
vegetationGpuEarlyRejectMs                = not currently separated; covered by vegetation/update timing
```

## Debug flags

Current CLOD-POC paths use the existing vegetation/GPU debug controls rather than a second config system.

Normal gameplay expectations:

```text
readback counts: off
gpu timing: off unless profiling
summary missing/unknown: accept cluster
```

Debug/oracle validation:

```text
tree.gpu.debugValidateAgainstCpu
understory.gpu.debugValidateAgainstCpu
existing readback policy gates GPU count readbacks
```

## Performance validation

Use a forest/terrain-occlusion camera view and compare:

```text
before/after candidate budget
vegetationTotalMs p50/p95
statsSyncMs p50/p95
visual holes / missing accepted vegetation
GPU readback flags stayed off in normal mode
```

Expected proof:

```text
candidateCountAfterPrefilter < candidateCountBeforePrefilter
candidate generation follows the after-prefilter budget
visible output remains stable for accepted clusters
```

## Known limitations

This implementation is the safe intermediate path, not full production Bevy parity.

Current CLOD-POC path:

```text
CPU/summary side builds compact active slot list
GPU shader processes only active slots
existing cull/draw path remains intact
```

Not yet full production path:

```text
GPU-only cluster classification and compaction
full NAADF/far-summary atlas integration for all rejection reasons
coverage-driven noCoverage / invalidSurface rejection for every vegetation kind
separate vegetationGpuEarlyRejectMs timing bucket
```

## Rust/Bevy port note

The production Bevy version should use the same idea, but with NAADF/far-summary provider integration:

```text
NAADF/far summary provider
  -> conservative cluster/page visibility classification
  -> compact accepted vegetation work
  -> generate candidates only for accepted work
  -> compact visible instances
  -> indirect draw
```

Do not port the CLOD-POC heightfield approximation directly as production terrain truth. Use this as the validation path for behavior, counters, and performance expectations.
