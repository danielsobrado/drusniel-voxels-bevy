# GPU visibility V0 disposition

Created 2026-07-19. Status: COMPLETE — V1/V2 not entered.

## Decision

V0 ends with a no-go for a new GPU vegetation classifier on current evidence. V1 is
therefore not entered, and V2's rule-of-three precondition is unmet. This is the plan's
evidence-gated stop condition, not an implementation deferral hidden as completion.

The current dense-village baseline is 28.50 ms frame p95. The measured marginal frame
p95 costs are construction 22.10 ms, grass 2.90 ms, vegetation 2.90 ms, props 2.00 ms,
trees 1.70 ms, and water 1.60 ms. Plan 2 records construction as local mesh/batch work
first, explicitly outside Plan 4 visibility; it also records no GPU-visibility go for
vegetation, props, or water. Source: `perf-runs/rpg-dense-cost/cost-table.md` and
`rpg-content-density-scaling-2026-07-16.md` D4.

## CPU prefilter contract audit

`buildVegetationSlotPrefilter()` already creates a compact `activeSlotIndices` list
before the tree, grass, and understory GPU candidate passes. The audited conservative
contract is:

- accept every slot if rejection, early rejection, view rules, or the vegetation kind
  is disabled;
- accept clusters smaller than `gpuEarlyReject.minClusterSize` unchanged;
- probe the camera-nearest sample, center, and four corners, deduplicating coincident
  probes at partial edge clusters;
- reject a cluster only when every probe rejects; any accepted or unknown probe keeps
  the full cluster;
- accept missing summaries and revision mismatches under the shipping conservative
  configuration;
- preserve bounded-world rejection separately from unbounded/island worlds;
- cache decisions only when enabled, keyed by kind, cluster/grid geometry, cell size,
  quantized camera X/Z/Y buckets, world size, visibility settings, terrain revision,
  and provider revision;
- retain stable slot IDs in `activeSlotIndices`; visual identity does not derive from
  compacted order;
- keep gameplay free of GPU readbacks; validation/perf readbacks remain diagnostic.

The existing unit coverage verifies disabled/full acceptance, small-cluster bypass,
hidden-cluster compaction, unknown-cluster acceptance, cache reuse, terrain-revision
identity, and provider-revision invalidation. The provider suite covers missing,
stale/mismatched, bounded/unbounded, distance, water/invalid, and coverage reasons.

## Per-system go/no-go

| System | V0 disposition | Evidence |
|---|---|---|
| Trees, grass, understory | No-go for V1 now | Existing CPU prefilter already removes work before GPU generation; combined measured marginals are below 3 ms and no classify/upload/submission bottleneck or 1x/2x/4x crossover was recorded. |
| Construction | Local optimization track | 22.10 ms is dominant, but Plan 2 attributes the next action to mesh/batch work, not the vegetation rejection semantics in Plan 4. |
| Props | No-go/defer | 2.00 ms marginal; no near-future crossover evidence. Props also require their own catalog/LOD policy. |
| Shadows | No-go/defer | No measured heavy caster-submission precondition from V0; far shadow proxies remain the existing answer. |
| Terrain pages | Defer | Streaming/ownership policy is not vegetation visibility and current evidence does not identify submission as the bottleneck. |
| Water | Out of classifier scope | 1.60 ms marginal; ownership and shoreline stability are handled by Plan 5. |
| Stones | Explicitly excluded | Repository policy keeps stones outside the vegetation classifier. |

## Reopen trigger

Reopen V1 only when an identical deterministic density sweep records the attribution
split requested by the plan and shows either a shipping-density win or an owner-agreed
near-future 1x/2x/4x crossover. V2 may start only after three real GPU classifier
adopters have passed parity and keep/revert gates.

