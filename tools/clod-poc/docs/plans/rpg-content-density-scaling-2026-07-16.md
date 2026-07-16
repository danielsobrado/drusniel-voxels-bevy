# RPG Content Density Scaling — proving the world holds at game density

Created 2026-07-16. Status: PLANNED (no code landed from this doc yet). Revised same day
after an external review. Accepted: D0 expanded into a full incremental-mutation contract
(the review's code claims were verified against `prop_exclusion.ts`, `save_runtime.ts`,
and `prop_edit_store.ts` — all accurate); density modeled as cost-bearing benchmark
content profiles in config, not a production `density_tier` registry abstraction;
settlement numbers disambiguated and split into village vs player-base scenes; interior
benchmarking made an explicit deferred phase instead of an implied claim; the placeholder
agent harness split into three synthetic envelopes (render / simulation / query) and moved
after the core density gates; dense gates use hardware-tier shipping budgets rather than
cloned sparse-route thresholds; tail metrics + 5-run repeatability adopted throughout; the
edit storm now goes through authoritative gameplay APIs with a latency-ladder gate.
Amended against the review: the agent render envelope keeps a **naive stock-three.js
`SkinnedMesh` variant** (no custom instanced-skinning research) — measuring only static
meshes would systematically underestimate creature render cost, and skinning is a dominant
axis of it.

Plan 2 of 5 toward the browser RPG target. Owner decisions locked 2026-07-16: placeholder
agents for measurement only (real creature AI/combat is a later plan); Valheim-scale
continent. Reference feel: Valheim-density forests and player bases, Skyrim-density
settlements — desktop Chromium WebGPU.

Every performance number the engine currently brags about was measured on sparse
acceptance scenes. This plan's job is to make the numbers survive contact with actual
game content — and to fix the known scaling bugs *before* they are measured into every
baseline.

Related documents:

- `continent-fixes-and-next-steps-2026-07-14.md` — Part C1 (O(all props) per edit),
  Part E1 (density validation), E3 (authoring at scale).
- `unified-streaming-far-shell-heightmaps-handover-2026-07-16.md` — implemented streaming
  stack + counters this plan's gates read; its G8-style eviction budgets consume this
  plan's measured peaks.
- `long-map-soak-and-streaming-execution-2026-07-16.md` (plan 1) — LM0 baseline closure
  is a prerequisite; the village site sits on the LM3 coast-to-coast route, and LM3's
  representative profile is produced by this plan.
- `unified-gpu-visibility-2026-07-16.md` (plan 4) — D4's cost table is its go/no-go input.
- `docs/gpu-canopy-density-impostor-plan.md`, `docs/gpu-vegetation-candidate-rejection-plan.md`
  — existing vegetation density machinery (composed here, not re-tuned).

## Goal

Deterministic dense-region scenes (village, player base, dense forest, destructibles —
later joined by agent envelopes) running as standing gates under hardware-tier shipping
budgets, plus measured per-system cost tables (CPU ms, draws, GPU pass ms, memory) that
size streaming eviction budgets and decide plan 4's scope.

Non-goals: real creature AI, combat design, loot/inventory; new rendering techniques
(plan 4 owns that — stock three.js paths only here, explicitly including stock
`SkinnedMesh`; custom instanced-skinning research is forbidden in this plan); collapse
physics; quest/dialogue content; **interior benchmarking before D6's precondition is met**
(the engine has no local-light/interior infrastructure yet — the goal above deliberately
does not claim interiors); production content-registry schema changes before the
benchmark profile model is proven. No unmeasured "optimizations" — bench-first per
CLAUDE.md.

## Current state (as read/verified 2026-07-16)

- **Props**: `src/props/` — catalogs, colliders, LOD build + simplify, spatial grid,
  GPU ring draw, culling; `prop_system.ts` (32 KB) is the hub.
- **The C1 scaling bug, verified in source**: `upsertSaveRuntimeProp` and
  `removeSaveRuntimeProp` (`src/save/save_runtime.ts`) each rebuild
  `SparsePropExclusionBitsets.fromSavedProps(savedPropStore.snapshot())` **and** call
  `projectPropEditStore.restore(savedPropStore.activeProjectProps())` per single
  mutation; the destroy path does the same (backlog C1). O(all props) work on the exact
  path an RPG hammers.
- **The bitset cannot go incremental as-is** (`src/world/prop_exclusion.ts`): `exclude()`
  only sets bits (no clear); `prop_delta_count` is computed only inside `fromSavedProps`;
  there is no dirty tile/layer tracking; `gpuWords()` hands out full per-tile/layer copies
  with no invalidation signal. Exclusion semantics: a prop excludes its environmental
  candidate iff `state !== "active"` — so active↔destroyed transitions must both set and
  clear bits.
- **`ProjectPropEditStore` already has incremental `add` / `update` / `remove`**
  (`src/project/prop_edit_store.ts`); the save runtime only ever calls `restore`.
- **Content registry**: `src/content/` — YAML-driven with validation; left untouched
  until D1a's benchmark profile model proves itself.
- **Stamps/scenarios**: road/settlement stamps (`accept:phase6-road-stamp`),
  `construction_benchmark_scenarios.ts`, `perf:construction`.
- **Vegetation**: trees/grass/understory/stones/canopy with GPU paths — the densest
  existing content; composed here.
- **Agents**: nothing exists (no `src/agents/`).
- **Harnesses**: `perf:main`, `perf:move`, shot harness, acceptance suite, QA-U runner —
  reused; this plan adds scenes, profiles, and counters, not new harness types.

## Design

### Benchmark content profiles (cost model, not object counts)

`config/benchmark_content_profiles.yaml` — a benchmark-config concept, deliberately NOT
a production content-registry abstraction until the model is proven (a biome contains
empty land, forest, settlement, and dungeon at once; one scalar tier per biome would be
wrong). Counts alone are not a cost model — 800 instanced opaque rocks and 800 unique
transparent animated props are different workloads. Each profile records the
**workload descriptors**:

```text
visible instances            construction pieces (total + visible)
interactive props            colliders
shadow casters               transparent instances
unique meshes                unique materials
dynamic lights               texture residency estimate
triangles                    vegetation candidates
agents by simulation ring    (0 until D5)
```

Every baseline table in this plan reports the descriptor set alongside the timings, so a
profile is reproducible as a *workload*, not a vibe.

### Scene compositions (disambiguated)

Two outdoor scenes, stressing different systems — plus the forest ring both share:

```text
scene=rpg-village      : 30–80 distinct buildings; total construction pieces recorded
                         explicitly (target order: 1,500–4,000 pieces); avg/max pieces
                         per building recorded; 200–800 placed unique-ish props;
                         road/plaza stamps; higher unique-mesh/material counts;
                         dynamic lights when D6's precondition lands
scene=rpg-player-base  : one 200–600-piece editable modular base in a 50 m radius;
                         deep persistence/edit history; snap/support-heavy;
                         few unique materials, many modular pieces
wilderness-forest ring : existing vegetation density + ~50 interactive props/ha
```

All numbers above are initial authoring targets — D1c calibrates what the engine
sustains, and the profiles are tuned to the measured budget, not vice versa.

### Gate philosophy (three different gates, one shipping target)

```text
sparse routes    : engine-overhead HEADROOM gates (stricter than shipping; unchanged)
dense gameplay   : SHIPPING frame-budget gates per hardware tier — dense content is
                   allowed to consume the headroom sparse routes must preserve
edit storm       : RESPONSIVENESS gates — request→visible/collider/converged/durable
                   latencies + maximum-stall bounds
```

Hardware tiers: primary = the recorded dev discrete GPU (plan 1 LM0 environment record);
integrated tier is tracked non-blocking until a hardware matrix exists. Budgets are set
per tier/quality profile and recorded here — NOT cloned from sparse-route thresholds
(which would also silently inherit the unresolved settled-p95 calibration question that
plan 1 LM0.2 owns).

## Phases

### D0 — Incremental prop/save mutation path (bench-first, contract-complete)

1. **Micro-bench baseline**: N props × M edits (N ∈ {1k, 10k, 50k}) through the current
   rebuild path; record ms/edit curve (in-repo, re-runnable).
2. **Failing tests, then the incremental contract** on `SparsePropExclusionBitsets`:

   ```text
   setExcluded(address, excluded)   // set AND clear
   applyDelta(previousProp, nextProp)
   consumeDirtyTileLayers(): TileLayerKey[]
   counters(): prop_delta_count kept exact incrementally
   ```

   Covered edge cases (each a named test): active→destroyed, destroyed→restored,
   environmental address change (clear old + set new), removal of a destroyed
   environmental prop, duplicate references to one candidate (prohibit or refcount —
   decide and test), `prop_delta_count` parity with `fromSavedProps` after any sequence.
3. **GPU invalidation**: per-tile/layer full-word upload stays (it is local, not O(N)),
   but consumers must re-upload exactly the tiles reported by `consumeDirtyTileLayers()`
   — failing test: one edit dirties one tile/layer, not zero, not all.
4. **Save runtime switches to the store's incremental API**: `upsert/remove/destroy`
   call `projectPropEditStore.add/update/remove` and `propExclusions.applyDelta`;
   `fromSavedProps`/`restore` remain for load/init only.
5. **Equivalence guard**: dev-build debug flag cross-checks incremental vs full rebuild
   every Nth edit until D3's storm has run green; then it is demoted to a test-only
   helper.
6. **Sibling audit**: other O(all-N)-per-edit patterns on prop/save hot paths
   (`snapshot()` spreads, full-grid rebuilds in `prop_spatial_grid`/`overlap_index`) —
   fix only what the micro-bench shows on the edit path; list-and-defer the rest here.
- [ ] baseline curve recorded (ms/edit vs N)
- [ ] contract tests (all edge cases) → green
- [ ] dirty-tile GPU invalidation test → green
- [ ] save runtime on incremental APIs; equivalence guard active
- [ ] post-fix curve flat; vitest green; sibling audit recorded

### D1a — Benchmark content-profile schema

1. `config/benchmark_content_profiles.yaml` + loader + validation (failing schema tests
   first): profiles reference existing catalogs/stamps/scenario helpers only.
2. Workload-descriptor collection: counters/introspection to *measure* every descriptor
   listed in the design at scene load and per-frame where dynamic (visible instances,
   shadow casters, transparent instances) — a profile whose descriptors cannot be
   measured cannot be gated.
3. Explicit decision recorded here later: whether/what graduates into the production
   content registry once the model has proven itself on D1b/D1c.
- [ ] schema + loader + failing tests → green
- [ ] descriptor measurement landed (each descriptor readable in stats)
- [ ] registry-graduation decision deferred and slot recorded

### D1b — Village and player-base scenes

1. `scene=rpg-village` and `scene=rpg-player-base` per the design compositions —
   deterministic (seeded stamps + scatter + placements), booting under the reuse
   profile, exposing `__drusnielClod` hooks like every gated scene.
2. The village sits on plan 1's coast-to-coast route site; the player base is reachable
   from it (shared streaming context).
3. Composition tables recorded: building count, total/visible pieces, avg/max pieces per
   building, unique meshes/materials, collider count, shadow-casting pieces — the
   disambiguated numbers, measured not estimated.
- [ ] both scenes boot deterministically (seed + shot + stats recorded)
- [ ] composition tables recorded from measured descriptors

### D1c — Composition baselines (5-run protocol)

`perf:main` settled at village center and base center + `perf:move` route village →
forest → meadow, 5 repeated runs on the recorded environment: frame p50/p95/p99/
**p99.9/max**, counts > 16.7 / > 33.3 / > 50 ms, long-task count + longest task, longest
single synchronous operation, renderMs p95, top buckets, queue-depth max + settle time,
resource creation/destruction counts, full workload descriptors. Median/worst/spread
recorded under `perf-runs/rpg-dense-baseline/`.

- [ ] 5-run baseline tables (both scenes + route) recorded with environment records

### D2 — Dense standing gates (hardware-tier shipping budgets)

1. Promote the D1c route + settled poses to standing acceptance: shipping-budget gates
   per the gate philosophy (primary tier now; thresholds calibrated from the 5-run
   spread, then frozen). Streaming cleanliness gates unchanged in kind: coverage-oracle
   zeroes, queues drain at the village edge (the village is a worst-case streaming wave:
   structures + props + vegetation + tiles landing together).
2. Recalibrate residency/eviction budgets from measured density peaks (bubble page
   cache, `max_resident_tiles`, far-summary grace, prop/vegetation pools) — the measured
   input the streaming stack's eviction sizing asked for. Config changes land only with
   an A/B.
3. Memory-envelope rows (post-GC floor, high-water per window, resource counts) join the
   gate, calibrated from the 5-run spread.
- [ ] dense gates wired + calibrated + frozen (tier budgets recorded here)
- [ ] residency/eviction changes (if any) A/B'd and recorded
- [ ] 5-run green + one fresh-profile run green

### D3 — Edit storm through authoritative APIs

The RPG's worst frame is the player leveling a forest or wrecking a base — and the storm
must exercise **the same authoritative APIs gameplay uses** (dig tool path, construction
controller, prop destruction), never direct store mutation, however convenient the
automation hooks make it.

1. Scripted storm on the dense scenes (seeded, ~60 s, camera orbiting): fell 50 trees,
   break 100 props, dig a 20 m trench through the village edge, place 30 construction
   pieces, break 10.
2. **Latency ladder measured per edit class** (calibrated gates on each):

   ```text
   request → visible update
   request → collider-ready
   request → derived-summary convergence (far summary / vegetation masks)
   request → durable save (region flush)
   plus: max queued work, max per-frame apply, cancelled/restarted job count
   ```

3. Correctness gates: no ghost colliders; no floating vegetation on dug terrain;
   destroyed environmental props stay destroyed after reload (D0 edge case, end-to-end);
   construction support state correct; terrain/water ownership clean; save counts + IDs
   match (`world:verify`); invalidation backlog bounded (churn ceiling); old valid
   output stays visible until replacement (no hole frames during the storm).
4. Save → reload the stormed world; gate load time and post-load parity.
5. Frame gates during the storm: responsiveness budgets (max stall bound, zero frames
   > 100 ms after warmup) — per the gate philosophy, distinct from traversal budgets.
- [ ] storm script via authoritative APIs only (reviewed against direct-mutation)
- [ ] latency-ladder tables + gates calibrated + green
- [ ] correctness gates green; save/reload parity green (`world:verify`)
- [ ] storm frame gates green (numbers here)

### D4 — Per-system cost table → plan 4 go/no-go

Marginal costs, not just a combined profile — one dominant system hides another:

1. Per-system **A/B toggles** (trees / grass / understory / props / construction /
   shadows / water off-on) on the village settled pose and the dense route: marginal
   frame cost, draws, instances submitted vs rendered, CPU submit ms, GPU pass ms where
   timestamped.
2. Beyond submission: candidate-generation cost, frustum/terrain rejection rates,
   shadow-caster counts, alpha overdraw proxy (transparent instances × coverage),
   GPU memory + upload traffic, indirect-buffer update cost where applicable.
3. Record the handoff: which systems justify GPU-driven visibility work (plan 4 V0
   quotes this table), which do not, and which are cheaper to fix locally.
- [ ] toggle A/B table recorded (marginal costs per system)
- [ ] extended cost rows recorded
- [ ] go/no-go per system recorded with the owner; linked from plan 4 V0

### D5 — Synthetic agent envelopes (render / simulation / query)

Three decoupled workloads — deliberately not a creature runtime (no navigation, no
perception, no combat, no custom skinning research):

1. **Render envelope**: 0/10/25/50/100 agents at the village; two variants — (a) shared
   static low-poly mesh (floor cost), (b) **stock three.js `SkinnedMesh`, one rig, 2–3
   shared clips, naive one-mesh-per-agent** (honest naive-skinning cost; if 100 naive
   skinned agents are slow, that *is* the measurement — batching research belongs to a
   later creature plan). Counters: `agents_total`, `agent_anim_ms`, `agent_draws`.
2. **Simulation envelope**: structure-of-arrays placeholder agents, deterministic seeded
   wander, near/mid/frozen tick rings; measures movement/state/scheduler cost
   independently of rendering. Counters: `agents_full/mid/frozen`, `agent_sim_ms`.
3. **Query envelope**: representative terrain-height, collider, and interaction queries
   per agent per ring under a configurable budget; measures the world-query cost axis.
   Counter: `agent_terrain_query_ms`.
4. **Budget reservation**: from the three envelopes, agree the reserved CPU/GPU headroom
   line with the owner (e.g. "X ms/frame for 40 village agents at descriptors Y") and
   record it. Future real-creature work must fit inside it or renegotiate explicitly.
5. **Representative profile completion**: add the agreed envelope load to the dense
   scenes; re-run D2 gates. This combined profile is what plan 1 LM3 uses as the
   representative release-gate profile.
- [ ] render envelope tables (static + naive-skinned variants)
- [ ] simulation envelope tables (ring sweep)
- [ ] query envelope tables (budget sweep)
- [ ] reserved budget agreed + recorded
- [ ] D2 gates re-run green with envelopes; representative profile handed to plan 1 LM3

### D6 — Interior benchmark (deferred; precondition-gated)

Interiors stress what the outdoor scenes do not: many unique meshes/materials, local
shadowed lights, room-scale occlusion, alpha effects, narrow collision, dense
interactables. **Precondition**: the local-light/interior lighting work (the lights and
god-rays effort is embryonic as of 2026-07-16) reaches the point where a lit multi-room
interior is representable. Then: `scene=rpg-dense-interior` — a large multi-room building
interior (Valheim-style same-world interior, consistent with the streamed voxel
architecture — no separate-cell system), with its own profile, descriptors, 5-run
baseline, and shipping-budget gate. Until then this plan makes **no interior performance
claims**.

- [ ] precondition met (linked evidence) → scene + profile + baseline + gate
- [ ] or: explicitly re-deferred with the reason recorded

## Verification protocol (every phase, per CLAUDE.md)

```powershell
npm --prefix tools/clod-poc run typecheck        # rtk OK
npm --prefix tools/clod-poc test                 # NO rtk
npm --prefix tools/clod-poc run build            # NO rtk
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

- Every gate table ships with its environment record (plan 1 LM0 template) and the full
  workload-descriptor set.
- Perf claims from `summary.json`/acceptance reports: p50/p95/p99/p99.9/max + threshold
  buckets + named counters; never FPS alone; `--warmup 600` where compute/indirect paths
  are hot. 5-run median/worst/spread for anything that becomes a gate.
- Micro-benches live in-repo and re-runnable. Shots + stats for every visual claim.
- Update this doc per commit-sized chunk (`md-progress-logging`).

## Risks and rollbacks

- **The village might just be too heavy.** That is a finding: the profile YAML is the
  tuning knob, and the recorded outcome is "the engine sustains these descriptors at the
  tier budget" — the number the whole project needs.
- **D0 is a correctness-critical refactor on the save path**: the equivalence guard and
  the D3 end-to-end reload test are the safety net; any divergence found demotes the
  incremental path behind its flag until fixed.
- **Synthetic envelopes can still mislead** about real creatures (no pathfinding, no
  perception). The reserved budget is a floor with its assumptions documented — not a
  promise that real AI fits.
- **Descriptor drift**: a profile edited without re-recording descriptors invalidates its
  gate — the descriptor set is measured at load, so gates fail loudly on drift rather
  than silently passing a different workload.
- **Scene determinism**: stamps + scatter + placements + envelopes all derive from the
  scene seed; nondeterminism found becomes a failing test, not a tolerance bump.
