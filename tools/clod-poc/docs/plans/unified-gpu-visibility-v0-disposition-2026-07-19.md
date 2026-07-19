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

These are disable-one-system marginals, not independent timing rows. They overlap and
must not be added. D4 also records that the tree GPU path was disabled on several
village boots, so the table is strong enough for a **no-go now** decision but not for a
claim that GPU visibility can never pay. No matching 1x/2x/4x density crossover or
classify/upload/submission split was captured; the missing evidence is part of the
reopen trigger below.

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

Authoritative implementation and test anchors:

- `src/vegetation/vegetation_slot_prefilter.ts` and
  `src/vegetation/vegetation_slot_prefilter.test.ts` — compact stable-slot list,
  conservative cluster probes, cache identity, and revision invalidation;
- `src/vegetation/vegetation_terrain_reject_provider.ts` and its test — missing,
  revision-mismatched, bounded/unbounded, water/invalid, and fallback decisions;
- `src/vegetation/vegetation_visibility_provider.ts` and its test — unknown samples
  remain visible;
- tree/grass/understory GPU-ring creation consumes `activeSlotIndices`; gameplay
  readbacks remain disabled unless a diagnostic query explicitly requests them.

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

## Phase state

| Phase | State | Reason |
|---|---|---|
| V0 | Complete | Attribution, prefilter contract, and per-system disposition are recorded here. |
| V1A–V1D | Not entered | V0 did not fund a first classifier adopter. The unchecked implementation tasks remain conditional reference material. |
| V2 | Not entered | Zero real V1 adopters means the rule-of-three extraction precondition is false. |
| V3–V5 | Not entered | Props, shadow-caster classification, and Hi-Z did not meet their measured preconditions. |

## Verification record

The disposition was checked against current source and the recorded D4 artifact, not
against an assumed future implementation. The focused regression command is:

```powershell
npm --prefix tools/clod-poc test -- src/vegetation/vegetation_slot_prefilter.test.ts src/vegetation/vegetation_terrain_reject_provider.test.ts src/vegetation/vegetation_visibility_provider.test.ts
```

2026-07-19 result: PASS, 23/23 tests across the three files. The same worktree also
passed repository typecheck, the 4,412-test full suite (3 skipped), and the Vite build;
the shared record is in `visual-stability-closure-2026-07-16.md`.

Repository-wide typecheck/test/build results belong to the final Plan 5 verification
record because the sequence-harness work shares this worktree. A green focused test
proves the audited CPU contract; it does not manufacture the absent crossover evidence.

## Reopen trigger

Reopen V1 only when an identical deterministic density sweep records the attribution
split requested by the plan and shows either a shipping-density win or an owner-agreed
near-future 1x/2x/4x crossover. V2 may start only after three real GPU classifier
adopters have passed parity and keep/revert gates.
