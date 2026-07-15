# Fable5 Parity — Index, Dependencies, and Frame Budget

Status: coordination document for the six prescriptive parity plans plus the tree
performance plan. It does not add a new feature. It fixes the cross-plan gaps:
build order, shared contracts, and a single reconciled GPU frame budget with the
owned optimization levers to test if the combined feature set misses that budget.

All numbers here are **design-stage allocations**, not measurements. They are
validated only through the tree performance captures and the unified visual/perf
regression gates. Do not claim any figure below as achieved until the harness
confirms it on the reference machine.

## 1. Plan map and build order

| # | Plan | File | Role |
|---|------|------|------|
| 1 | Hydraulic + thermal erosion | `fable5-parity-hydraulic-thermal-erosion.md` | Upstream generation artifact |
| 2 | GPU vegetation authority | `fable5-parity-gpu-vegetation-authority.md` | Canonical scatter/compaction pipeline |
| 3 | Terrain-relative probe GI | `fable5-parity-terrain-relative-probe-gi.md` | Indirect lighting, feeds materials |
| 4 | Continuous tree morphology | `fable5-parity-continuous-tree-morphology.md` | Per-instance variation on top of #2 |
| 5 | Ecological dressing | `fable5-parity-ecological-dressing.md` | New categories on top of #2 |
| 6 | Unified visual/perf regression | `fable5-parity-unified-visual-regression.md` | Validates all of the above |
| 7 | Tree performance gap | `fable5-tree-performance-gap-plan.md` | Status doc; foundation + measurement |

Dependency graph:

```text
        (7 tree perf: GPU ring, PCG hash, impostors, shadow-LOD budget — already shipped)
                                   |
1 erosion ─────► 2 vegetation authority ──► 4 morphology
     │                    │            └──► 5 dressing
     │                    │
     └─ sediment/hardness/deposition feed 2 and 5
3 probe GI ──► sample_probe_gi() consumed by materials in 2/4/5
6 regression ──► validates 1–5 (harness built early, baselines added as each lands)
```

Milestone build order (the dependencies are milestone edges, not whole-plan locks):

1. Build QA-U1..U4 first: manifest/schema loading, environment capture, deterministic
   browser control, and metric collection. QA-U5..U7 and the first baselines can then
   advance in parallel with feature work.
2. Complete ERO-1..ERO-6 through publication of the versioned
   `sediment/hardness/deposition` channel contract. Plan 2's cluster/hash/buffer work
   may proceed in parallel, but VEG-GPU-2/5 and dressing environment acceptance may
   not consume erosion data before that publication gate.
3. Complete VEG-GPU-1..VEG-GPU-5 before MORPH-4 or dressing's GPU placement
   integration. MORPH-1..3 and the dressing vertical-slice content work may proceed
   against their CPU oracles before that edge.
4. Build PGI-1..PGI-6 in parallel. PGI-7 material integration waits for the material
   interfaces used by Plans 2, 4, and 5 to be stable.
5. Add QA-U8 baselines as each deterministic scene lands, then run the combined profile.

## 2. Canonical shared contracts

These are declared once and referenced by every plan. Redeclaring them per-plan is
the primary drift risk called out in review.

- **Identity/scatter hash** — one integer hash family. VEG-GPU-1 extracts the shipped
  `tree_pcg2d` implementation from
  `tools/clod-poc/src/trees/tree_ring_math.ts` and the composed tree shader into shared
  CPU/WGSL modules. Existing tree code delegates to those modules. Plans 2, 4, and 5
  use the exact tuple fold and 64-bit stable-ID construction in Plan 2; no second
  `hash(...)` family is allowed. Golden vectors cover TypeScript, WGSL, and Rust.
- **Canonical terrain sample** — one struct. Plan 2 defines `VegetationSurfaceSample`;
  Plan 5's `DressingEnvironmentSample` must **extend** it (add dressing-only fields),
  not restate it. Plan 3's visibility sampler shares the same provider order.
- **Cluster grid** — `cluster_size_m: 32`, world-anchored, declared once and shared
  by Plans 2 and 5. Per-category *max distance* and *spacing* differ; the grid does not.
- **No-readback discipline** — identical wording across 2/3/4/5: zero count/instance
  readback on the gameplay path; async debug readback only outside the measured window.

### 2.1 Implementation-blocker closure

The four cross-plan contract blockers are resolved. They are not implementation choices:

| Blocker | Binding resolution | Owning gate |
|---|---|---|
| Frame-budget rules contradicted each other and assumed overlap | `frame_ms_p95 <= 11.1 ms` is binding at the exact Lane B balanced profile; 8.0 ms is advisory; overlap credit is zero. Plan 7 establishes the baseline and Plan 6 applies the measured feasibility equation and A/B deltas. | QA-U4 + Plan 7 capture |
| Hash and stable identity were underspecified | Plan 2 defines the raw integer `treePcg2dU32`, fixed category/channel IDs, exact tuple fold, two-word stable ID, and normative golden vectors. Plans 4/5 delegate to it. | VEG-GPU-1 |
| Candidate storage exceeded portable WebGPU limits | Candidate generation and acceptance are one fused dispatch with no global candidate-record buffer. Only per-category accepted instances persist. | VEG-GPU-4/5 |
| Cross-plan GPU ABIs disagreed | Plan 2 owns the 112-byte `VegetationSurfaceSample`, which Plan 5 extends by exact prefix, and the 96-byte tree record shared with Plan 4: 48-byte transform/identity prefix plus three morphology `vec4`s. | VEG-GPU-1/2 + MORPH-1/4 |

Implementation may begin against these contracts. The unknown combined frame delta is
an acceptance result to measure, not a reason to invent different layouts or defer the
four blocker resolutions above.

## 3. Frame budget reconciliation

Reference machine is Lane B from Plan 6 §2.2: native Windows, Chrome WebGPU,
2560 x 1440 CSS pixels, DPR 1, `quality=balanced`, and the exact adapter, driver,
browser major version, and OS build recorded in the run manifest. Every absolute
millisecond allocation in Plans 1–5 is defined against this profile. A changed adapter,
driver, browser major, viewport, DPR, or quality token is non-comparable until a new
baseline is explicitly accepted.

- Binding 90 fps acceptance gate: `frame_ms_p95 <= 11.1 ms`.
- Headroom target for controlled stationary scenes: `frame_ms_p95 <= 8.0 ms`.
  This is advisory and does not replace the binding movement/combined-scene gate.

### 3.1 The naive sum does not fit

Adding the plans' *gross* GPU budgets:

```text
vegetation authority   2.50 ms
probe GI               3.00 ms
morphology             0.70 ms  (0.40 render + 0.30 shadow)
dressing               2.75 ms  (1.25 placement + 1.50 render)
erosion                0.00 ms  (one-time build; steady-state zero)
                       -------
gross new              8.95 ms
```

8.95 ms of gross feature allocations leaves only 2.15 ms for all pre-existing frame
work under the 11.1 ms gate, so the gross sum cannot establish feasibility. It is also
not a pure addition because Plan 2 replaces legacy scatter and morphology folds into
its acceptance pass.

### 3.2 Net accounting

| Plan | Gross allocation | Nature | Net delta required from harness | Budgeted overlap credit |
|------|------:|--------|---------------------------------------:|--------------------------:|
| 1 erosion | 0.00 | one-time build | 0.00 | n/a |
| 2 vegetation authority | 2.50 | **replaces** existing tree/grass/understory/stone scatter | changed minus accepted legacy baseline | 0.00 ms |
| 4 morphology | 0.70 | derivation folds into #2 acceptance; vertex/shadow ALU remains new | Plan 2+4 minus Plan 2-only | 0.00 ms |
| 5 dressing | 2.75 | placement shares #2 sampling/acceptance; render work is new | Plan 2+5 minus Plan 2-only | 0.00 ms |
| 3 probe GI | 3.00 | additive compute plus material sampling | GI-on minus GI-off | 0.00 ms |

The feasibility equation is:

```text
measured accepted balanced baseline frame p95
+ measured net feature delta p95
+ variance/streaming reserve
<= 11.1 ms
```

The baseline, net delta, and reserve are currently unknown. Therefore this document
does **not** label the combined plan feasible, infeasible, or "tight". Plan 7 establishes
the baseline and Plan 6 measures isolated and combined A/B deltas before implementation
may claim an answer.

WebGPU exposes one ordered queue and no application-schedulable async-compute queue.
Pass ordering may help a driver, but it earns zero design-budget credit. A producer that
writes data sampled by the same frame's raster is a dependency. Probe GI therefore
publishes through an N-1 double buffer; even then, any hiding is reported only as an
observed A/B result, never subtracted in advance.

## 4. Optimization menu to close the gap

Levers to bring the combined profile under the 11.1 ms gate at the `balanced` preset. Each is owned
by a plan and must be validated, not assumed. Ordered by reliability.

- **O1 — Preset scaling (owner: all; primary knob).** Keep probe GI at three cascades
  and bind its rays/update quota, dressing density, vegetation distance/capacity, and
  morphology impostor resolution to
  the existing `quality=ultra|balanced|perf|potato` presets from Plan 7. The 11.1 ms gate
  is binding at `balanced`; `ultra` is allowed to exceed on high-end machines. This is the
  reliable lever because it does not depend on driver behavior.
- **O2 — Net, not gross, via legacy deletion (owner: 2).** Plan 2 VEG-GPU-8 already
  removes the legacy per-category scatter. Measure the *before* so the 2.5 ms is booked
  as a delta over deleted work, not an addition.
- **O3 — Fold morphology into acceptance (owner: 4).** MORPH-4 already generates
  morphology inside #2's acceptance pass — zero extra dispatch. Apply full vertex
  deformation to the near LOD only; far/impostor use baked age buckets (already the
  impostor design). Keeps shadow/far ALU minimal.
- **O4 — Cascade scheduling (owner: 3).** Make near eligible every frame, mid every two,
  and far every four within Plan 3's per-preset global update quota. Interleaving alone
  redistributes a fixed quota and claims no saving while backlog exists; only a measured
  lower dispatched-probe count is a saving.
- **O5 — Cluster classification amortization (owner: 2/5).** World-anchored clusters
  change slowly. Reclassify only on `camera_cluster_snap` or edit invalidation (Plan 2
  §14 already has the snap hook); skip re-running classification every frame.
- **O6 — Dressing draw reduction (owner: 5).** Far LOD = coverage cards, omit below 2 px
  (Plan 5 §9); near shadows off for terrain/parent-attached classes (Plan 5 §14 config);
  push the card/impostor transition in aggressively. Merge dressing indirect draws into
  the vegetation-authority batches by shared material family to cut draw-call count.
- **O7 — Pass ordering and N-1 publication (owner: 2/3/5).** Order passes for correct
  dependencies and locality; publish probe results from a completed buffer. Budgeted
  saving is zero. Record any measured driver hiding as an environment-specific result.

## 5. Memory budget

Plan 2 does not allocate a global candidate-record buffer. Candidate generation and
acceptance are fused per active cluster, and only accepted instance records persist.
Per-preset accepted-instance capacities and authority-buffer VRAM caps are normative in
Plan 2. Each individual storage binding must also fit the WebGPU device limit and the
128 MiB portable-target ceiling. Overflow remains a hard failure, never silent density
loss.

## 6. Validation path

No figure in this document is a result. The order of proof:

1. Plan 7 captures establish the current tree/scatter baseline on Lane B hardware.
2. Each feature lands behind its Plan 6 scene baseline and timing/counter gates.
3. The combined `frame_ms_p95 <= 11.1` gate at `balanced` is the acceptance bar; per-plan
   budgets are sub-allocations of it, not independent promises.
4. Report before/after from `summary.json` per the repo perf process; never from FPS.
