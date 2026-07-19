# GPU Visibility Primitives — shared contracts, per-system policies, evidence-gated adoption

Created 2026-07-16. Status: COMPLETE AT V0 (2026-07-19 no-go; V1/V2 not entered). Revised same day
after an external review; the file name keeps its original slug for link stability, but
the target is renamed from "one unified classify→compact→indirect architecture" to **GPU
visibility primitives with per-system policies** — trees, grass, understory, stones,
props, shadows, and terrain do not share rejection semantics, and forcing them through
one classifier or one dispatch adds coupling without evidence. Accepted from the review:
the stale perf premise rebased (the 4.7 ms `farSummaryMs` figure predates the
unified-streaming work; the final measured far-summary p95 is ~0.6 ms); the conservative
CPU-prefilter safety contract made an explicit must-preserve list with parity cases (its
rules were verified in `vegetation-terrain-rejection-status.md` — they are real config,
not folklore); the stable-ordering-vs-atomic-append contradiction resolved via an
identity rule; a three-mode telemetry policy reconciling GPU counters with the
no-gameplay-readbacks rule; two-cadence classification (never reclassify static world
state every frame); V2 demoted to primitives-extraction after the rule of three; V1
split into four separately measurable steps; "neutral but scalable" replaced by
revert-by-default plus a scale-sweep crossover requirement; three-layer parity with
zero-false-rejection priority; the shadow phase's test list expanded; and Hi-Z given
explicit conservative safety rules. Stones remain outside the vegetation classifier by
the repo's own written rule.

Plan 4 of 5 toward the browser RPG target. This remains the *conditional* plan: V0/V1
are justified by the vegetation system's own documented next step; everything after is
gated on measurements from plan 2's dense scenes.

Related documents:

- `docs/vegetation-terrain-rejection-status.md` — the conservative contract, provider
  reasons/confidence, per-kind counters, the stones exclusion, and the repo's own Bevy
  port sketch (conservative classification → compacted accepted list → generation →
  indirect draw) — this plan implements that sketch, GPU-resident.
- `docs/gpu-vegetation-candidate-rejection-plan.md` — the existing prefilter design.
- `rpg-content-density-scaling-2026-07-16.md` (plan 2) — D4's marginal-cost table is the
  go/no-go input for V3+; its density knobs drive the scale sweeps.
- `visual-stability-closure-2026-07-16.md` (plan 5) — S0 sequence metrics provide the
  motion-parity layer used here.
- `unified-streaming-far-shell-heightmaps-handover-2026-07-16.md` — current perf truth
  for V0's rebase.
- `docs/architecture/bevy-world-source-port.md` — primitives stay port-shaped (wgpu has
  the same storage-buffer/compute/indirect primitives).

## Goal

One set of **proven GPU visibility primitives** — bounds encoding, frustum math,
conservative summary sampling, classification bit masks, compaction utilities,
indirect-argument writers, counter layouts, lifecycle helpers — adopted per system with
**separate typed buffers, separate policy kernels, separate dispatches, separate
lifetimes**, and an independent keep/revert decision at every step.

Non-goals (recorded, revisited only with data):

- **No universal cross-system classifier and no shared multi-system dispatch** — shared
  conventions, not shared execution.
- **No terrain-page meshlets / Nanite-style renderer** until terrain submission or
  geometry cost is measured as the problem.
- **No gameplay GPU readbacks** (telemetry policy below).
- **The far-summary atlas is an optional conservative terrain-rejection input, not a
  visibility authority.** It can prove outside-coverage / coarse-hidden / invalid
  surface; it cannot prove occlusion by buildings, other trees, interiors, or 3D voxel
  topology (the provider itself is documented as a conservative height/terrain sampler,
  not NAADF truth).
- **Stones keep their own policy** — repose slope, cliff/stream probes, water margins,
  per-class size/sink are deliberately different; the repo's written rule: "Do not reuse
  grass/tree slope or biome rules for stones." Shared compaction utilities are fine; a
  stone-specific dispatch mask happens only if stone scatter dispatch cost measures (the
  existing TODO).
- **Compacted order must never become visual identity** (identity rule below).
- No Hi-Z before V5, and V5 is a timeboxed spike that may conclude "no".

## Current state (verified 2026-07-16)

- **The CPU prefilter is conservative by explicit config**
  (`DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.gpuEarlyReject`):
  `acceptWhenSummaryMissing: true`, `acceptWhenRevisionMismatch: true`,
  `minCoverageToAccept: 0.05`, `minClusterSize: 16` (smaller clusters bypass the
  classifier and are accepted unchanged), per-kind enablement (trees/grass/understory),
  probe-only static rejection **off by default** because probes cannot prove a whole
  footprint empty — all of it exists to prevent false vegetation holes. Provider output
  is reason-coded (outsideTerrain / terrainHidden / belowWaterOrInvalid / noCoverage /
  summaryMissing / accepted) with confidence (exact / summary / fallback).
- **The compact-active-slot pattern is already uniform** across trees, grass, and
  understory (`activeSlotIndices` built CPU-side, GPU compute processes accepted slots
  only) — three adopters of one pattern, which is what makes primitive extraction
  plausible *after* GPU migration proves what is actually common.
- **Telemetry gap on record**: tree counters are true cluster counts; grass and
  understory contribute budget counters only (no reason-separated cluster telemetry in
  their WebGPU ring path).
- **Perf truth after unified streaming** (handover): steady case frame p50 2.40 ms /
  p95 3.10 ms, render p95 2.10 ms, top prop bucket forest lighting 0.80 ms; final
  far-summary p95 ~0.6 ms; movement p99 15.0–17.4 ms dominated by streaming bursts, not
  draw submission. **On sparse scenes there is no measured submission bottleneck** — the
  case for V3+ must come from plan 2's dense scenes.
- **Constraints** (do not relearn): three.js WebGPU material hooks require TSL
  (`onBeforeCompile` dropped); classification/compaction kernels are raw WGSL
  (port-shaped); GPU timestamps available on the dev GPU; async pipeline compilation
  pollutes short windows (`--warmup 600`); normal gameplay already runs with
  `debugReadbackCounters: false`; the tree-impostor dither work is locked stable and
  keyed off stable identity — those locks are the regression net for the identity rule.

## Design

### The conservative contract (must-preserve, with parity cases)

The GPU classifier must be **exactly as conservative** as the CPU prefilter, or faster
means holes. V0 audits and enumerates the CPU rules (including any camera-bucket
quantization and decision caching found in `buildVegetationSlotPrefilter` and the
provider); the named parity cases, each a test:

```text
summary missing                → accept
summary revision stale         → accept
mixed visible/hidden probes    → accept (reject only when all probes prove rejection)
cluster < minClusterSize       → bypass, accept unchanged
near forced-visible cluster    → accept
partial world coverage         → accept uncovered
camera bucket change           → decisions refresh, no transient hole
terrain edit invalidation      → conservative retention until valid replacement
provider revision change       → conservative retention until valid replacement
per-kind disable               → that kind bypasses entirely
```

Acceptance priority: **zero false rejections** (holes); false acceptances only cost
performance and are tolerated within measured bounds.

### The identity rule (resolves ordering vs append)

Compaction may be unordered (atomic append) **only if** nothing visual derives from the
compacted index: randomness, dither, variant selection, and wind phase key off the
permanent slot / world instance ID; tests compare accepted **sets**, not array order.
Deterministic scan/scatter is the fallback if any consumer cannot meet that rule. V1C
measures both; the stable-dither lock tests must pass under either.

### Telemetry policy (counters without gameplay readbacks)

```text
gameplay   : no readbacks. CPU knows dispatch config + capacities; GPU counters stay
             GPU-local (written for the other two modes).
perf/debug : low-frequency async readback (existing statsHz-style cadence), never
             blocking frame execution; closes the grass/understory reason-telemetry gap.
acceptance : explicit validation mode; counters and decision buffers read after GPU
             completion, outside measurement windows (the exact-oracle layer).
```

### Two-cadence classification (never full reclassify per frame)

The CPU path is cheap partly because of caching/quantization; a naive GPU port that
reclassifies every cluster every frame can lose despite moving work off the CPU:

```text
world/coverage classification (expensive)  → runs on: snapped ring origin change,
    terrain revision, far-summary revision, LOD/species/density config change
view/frustum classification (cheap)        → runs on: camera bucket change (or per
    frame if measured cheap enough)
```

The two stages stay separate passes; fusing them re-couples their cadences.

## Phases

### V0 — Rebase measurements and inventory (current main, dense scenes)

1. Rebase all baseline claims to current main; consume plan 2 D4's marginal-cost table
   and fill missing rows. **Metric attribution is split** so wins/losses land on the
   right ledger: CPU classify ms / CPU buffer prep+upload ms / CPU renderer submission
   ms / GPU compute ms / draw-call count / submitted vs rendered instances / vertex
   cost / fragment-overdraw proxy — per system (trees, grass, understory, stones, props,
   construction, terrain pages, shadows).
2. Prefilter semantics audit: enumerate the exact CPU rules (config above + any
   camera-bucket/decision-cache behavior in the implementation) into the parity-case
   list; this is the contract V1B tests against.
3. Per-system go/no-go with the owner. Expected shape from current evidence: vegetation
   V1 justified as the documented next step; props/shadows pending dense-scene numbers;
   terrain deferred. If nothing beyond vegetation justifies adoption, this plan ends at
   V2 and says so.
- [x] rebased attribution table recorded (or linked from plan 2 D4) per system —
      2026-07-17 link: `perf-runs/rpg-dense-cost/cost-table.md` from plan 2 D4.
      Dominant village settled cost is **construction** (~22 ms frame p95 when
      toggled off); vegetation/props/water marginals <3 ms at this pose.
- [x] prefilter audit → parity-case list recorded in
      `unified-gpu-visibility-v0-disposition-2026-07-19.md`
- [x] per-system go/no-go recorded in the same disposition: no new classifier is
      justified by current attribution, so V1 is not entered

### V1A — GPU classification mask (one vegetation kind first)

**NOT ENTERED (2026-07-19): V0 no-go.** The unchecked implementation tasks below are
conditional design, not remaining work under the recorded disposition.

1. Failing tests: GPU decision mask matches the CPU reference per parity case on
   synthetic inputs (validation-mode readback).
2. Implement for trees first (true cluster counts already exist): classification writes
   a per-cluster decision mask on the world/coverage cadence; view cadence separate.
   CPU path stays behind `vegGpuClassify=0/1`. No compaction change in this step.
3. Recompute-trigger tests: no reclassification without a trigger; camera-bucket change
   refreshes without transient holes.
- [ ] parity-case unit tests → green (synthetic oracle)
- [ ] trigger/cadence tests → green
- [ ] flag-gated, CPU path intact; A/B recorded (classify ms moved, nothing else)

### V1B — Three-layer parity harness

1. **Exact synthetic oracle**: small buffers, acceptance-mode readback after completion,
   per-decision comparison against the CPU reference (all parity cases).
2. **Visual motion parity**: plan 5 S0 sequences — slow translation/rotation through
   cluster and LOD boundaries, flag on vs off; flicker/pop within the locked bounds.
3. **Mutation parity**: terrain edit + summary revision change mid-sequence; both paths
   must conservatively retain vegetation until valid replacement decisions exist
   (one-frame holes are failures, not noise).
- [ ] oracle layer green (zero false rejections; false-acceptance rate recorded)
- [ ] motion parity green (S0 metrics, both flag states)
- [ ] mutation parity green (edit + revision cases)

### V1C — Compaction strategy A/B

1. Compare: no compaction (mask-only skip in the consumer) vs atomic append under the
   identity rule vs deterministic scan/scatter — on classify+compact GPU ms, buffer
   traffic, and consumer cost.
2. Stable-dither lock tests and V1B layers must pass under the chosen strategy; any
   consumer found deriving identity from compacted order is fixed or the strategy falls
   back to deterministic.
- [ ] three-way A/B recorded; choice + reasons written here
- [ ] identity-rule audit of consumers recorded; dither locks green

### V1D — Indirect dispatch and draw

1. Dispatch candidate generation by accepted count (indirect dispatch args from the
   compacted list).
2. Indirect draws only where the three.js path measurably benefits — and expect
   **draw-call count to stay flat** (species × LOD × material × cascade partitioning
   persists; indirect changes instance counts inside draws, not command counts). Wins
   must show up in the attribution ledger's correct rows.
3. Extend to grass and understory (V1A–V1D per kind, reusing the harness); closes their
   reason-telemetry gap via the perf/debug mode.
- [ ] indirect dispatch A/B recorded
- [ ] indirect draw A/B recorded (attribution split, `--warmup 600`)
- [ ] grass + understory migrated with the same gates; telemetry gap closed

**Keep/revert rule for every V1 step**: a win at shipping density keeps; **neutral
defaults to revert** unless a scale sweep (plan 2 density knobs at 1× / 2× / 4×) shows a
measured crossover at a density the owner agrees is near-future-real. "Potential
scalability" without a crossover table is not evidence. Reverts are recorded with
numbers, per repo rule.

### V2 — Extract primitives (rule of three, inside vegetation)

**NOT ENTERED (2026-07-19):** no V1 adopter was funded, so the three-adopter
precondition is unmet.

Only after trees + grass + understory all run the GPU path: extract **what proved
common** into `src/gpu/visibility/` — bounds encoding, frustum helpers, conservative
summary sampling, mask/compaction utilities, indirect-arg writers, counter layouts,
lifecycle helpers. Policies, typed buffers, kernels, dispatches, and lifetimes stay
per-system. The TSL/WGSL boundary decision is recorded here: compute classification/
compaction in raw WGSL (port-shaped), material-facing integration in TSL, shared part is
buffer schemas + algorithms.

- [ ] primitives extracted from three real adopters (diff shows net deletion or
      near-neutral LOC, not a framework)
- [ ] per-kind parity harnesses re-run green on the extracted primitives
- [ ] shader-ownership decision recorded

### V3 — Props (only if plan 2 D4 says so)

1. Precondition quoted from the D4 table (instance counts at village density are the
   likely trigger).
2. Prop policy kernel (its own rules — props have catalogs/LOD bands, no
   terrain-coverage rejection semantics), reusing primitives; render-only (colliders and
   gameplay queries keep reading the spatial grid, never the visible list).
3. V1-style step gates + keep/revert. Stones are explicitly not part of this phase.
- [ ] precondition quoted
- [ ] prop policy behind flag; parity + A/B recorded; keep/revert decision

### V4 — Per-shadow-view caster classification (only if V0 says so)

Shadow classification is per light view, never derived from camera visibility. The
existing tree shadow path classifies casters before camera-frustum rejection and keeps
per-cascade caster groups — that ordering is preserved. Failing tests beyond the
off-screen-caster case:

```text
object behind camera inside cascade      → in that cascade's list
wind/animation                           → conservative expanded bounds still cover
cascade overlap                          → stable membership, no per-frame flip
low sun                                  → long-shadow casters far outside view included
camera moves while light space changes   → no one-frame caster loss
far impostor/proxy handoff               → caster ownership transfers without a gap
caster list overflow                     → degrades conservatively (overflow = cast all)
terrain edit invalidation                → caster set refreshes with retention
```

- [ ] precondition quoted from V0
- [ ] test list above → green; flag-gated adoption for the heaviest measured caster
      system (likely trees; shadow proxies stay the far-field answer)
- [ ] A/B (shadow pass ms, caster draws) + plan 5 shadow poses recorded; keep/revert

### V5 — Hi-Z occlusion spike (last, timeboxed, may conclude "no")

1. Precondition: V0/V3 numbers show meaningful occluded-but-submitted cost (forest
   interior, village walls).
2. Conservative rules are part of the spike's definition, not follow-up polish: camera
   cuts invalidate history; newly visible objects get a grace period; near-plane
   intersections accepted; partially off-screen bounds accepted; fast/dynamic objects
   expanded or bypassed; depth bias scales with mip and projected size.
3. Measured against a no-Hi-Z oracle: false-occlusion rate (target ~zero), pyramid
   build cost **included** in the A/B, disocclusion popping tested in motion (plan 5
   S0), one system (trees), one flag.
4. Decision recorded: adopt with a follow-up plan, or park with numbers. A pass that
   saves 0.3 ms and pops trees a frame late is a loss.
- [ ] precondition quoted
- [ ] spike A/B + false-occlusion + disocclusion-motion results recorded
- [ ] adopt/park decision written here

## Verification protocol (every phase, per CLAUDE.md)

```powershell
npm --prefix tools/clod-poc run typecheck        # rtk OK
npm --prefix tools/clod-poc test                 # NO rtk
npm --prefix tools/clod-poc run build            # NO rtk
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

- Every A/B: same world/scene/poses, `--warmup 600` minimum on compute/indirect changes,
  attribution-split metrics (never a single "it got faster"), environment records per
  plan 1 LM0, 5-run spreads for anything that gates.
- Parity is a gate at every step: oracle + motion + mutation layers, plus the stable-
  dither locks; gated scenes keep fail-loud WebGPU diagnostics (no silent WebGL
  fallback).
- Flags stay until the keep decision is recorded; reverts recorded with numbers.
- Update this doc per commit-sized chunk (`md-progress-logging`).

## Risks and rollbacks

- **Silent hole regressions** are the failure mode that matters: the conservative
  contract + zero-false-rejection oracle exist precisely because a faster classifier
  that drops one summary-missing rule looks like a win in every timing table.
- **Building the framework anyway**: the primitives phase requires three real adopters
  first and is judged by net code, not abstraction elegance; "this plan ends at V2" (or
  earlier) remains a legitimate recorded outcome.
- **Per-frame GPU reclassification** can invert the win — the two-cadence rule and
  trigger tests are the guard.
- **three.js indirect-path friction**: if the library fights indirect submission at our
  scale, the attribution ledger shows it (CPU submission row rises) and the CPU path
  stays — that finding is valuable and gets recorded.
- **Shadow correctness regressions** cost more than they save; V4 lands nothing without
  its full test list and plan 5 shadow poses green.
