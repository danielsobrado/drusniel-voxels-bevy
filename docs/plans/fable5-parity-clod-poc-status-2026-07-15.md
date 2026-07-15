# Fable5 Parity — CLOD-POC Implementation Status

Status: current implementation audit.

Audit scope: `tools/clod-poc` on `main` at
`d891f0418d76168d13f5716918b7ed5f38e67da9`.

This file records what is present in the repository. It does not replace the
prescriptive contracts in the individual plans.

## Status rules

- **Done — code**: the planned CLOD-POC slice is implemented and has repository tests or build evidence.
- **Partial**: useful code exists, but the planned authority, runtime integration, or exit gate is incomplete.
- **Pending**: no implementation matching the plan milestone was found, or the milestone is blocked by an earlier dependency.
- **Acceptance pending**: code may exist, but native Windows Lane B visual/performance evidence has not been accepted.

A code-complete label is not a claim that the visual or performance acceptance gate passed.

## Executive status

| Plan | CLOD-POC status | Verdict |
|---|---|---|
| Hydraulic + thermal erosion | **Substantially code complete; acceptance pending** | ERO-1 through ERO-6 are present. ERO-7 still needs authoritative captures, timings, and final default-path acceptance. |
| GPU vegetation authority | **In progress** | VEG-GPU-1 is done. VEG-GPU-2 is incomplete. VEG-GPU-3 through VEG-GPU-8 remain pending. This is the main shared blocker. |
| Terrain-relative probe GI | **Pending** | The prescriptive PGI implementation is not present. Existing older GI/forest-lighting systems do not satisfy this plan. |
| Continuous tree morphology | **Mostly implemented on the current tree paths; final authority and impostor work pending** | Core derivation, attributes, deformation, health, foliage retention, packing, diagnostics, and tests exist. Canonical Plan 2 integration, the competition texture, and full age-layer impostors are incomplete. |
| Ecological dressing | **CPU vertical slice implemented; production integration incomplete** | Registry, deterministic placement rules, several classes, hydrology placement, attachments, rendering, diagnostics, and GPU scaffolding exist. Save authority, exact voxel/cave/structure sampling, tree attachments, and default GPU ownership are incomplete. |
| Unified visual/performance regression | **New unified plan pending** | Existing specialized QA tools remain useful, but QA-U1 through QA-U8 have not been implemented as specified. |
| Tree performance gap | **Foundations shipped; authoritative measurement pending** | GPU tree ring, indirect draws, PCG scatter, impostors, shadow-LOD budgets, presets, and no-readback gameplay defaults exist. Native Lane B captures remain the release evidence gap. |

## 1. Hydraulic and thermal erosion

### Milestone status

| Milestone | Status | Repository state |
|---|---|---|
| ERO-1 — Contracts and config | **Done — code** | Strict config, fixed-point contracts, artifact types/header, manifest references, hash-chain integration, and tests exist under `src/world/erosion` and `world_manifest`. |
| ERO-2 — CPU oracle | **Done — code** | Typed-array simulation stages, checkpoint/resume, worker lifecycle, and cancellation are implemented. |
| ERO-3 — GPU parity path | **Done — code; acceptance pending** | Integer WebGPU pipelines, shared-device use, compact resume checkpoints, final readback, diagnostics, and parity support exist. Native target evidence still needs to be recorded as an accepted result. |
| ERO-4 — Artifact persistence | **Done — code** | Artifact codec/store, cache validation, corruption handling, persistence fallback, and warm-load lifecycle are present. |
| ERO-5 — Hydrology authority switch | **Done — code** | Hydrology graph construction can consume the erosion artifact and cache identity is connected to erosion authority. |
| ERO-6 — Materials and ecology | **Done — code** | Sediment, deposition, hardness, and wetness channels are exposed to terrain material/ecology consumers. |
| ERO-7 — Acceptance and default flip | **Acceptance pending** | The continent path is integrated, but the plan is not complete until the named visual scenes, timing gates, determinism, hydrology validators, and default-path A/B evidence are captured on Lane B. |

### Still pending

- Run and retain the ERO-7 native Windows/WebGPU acceptance battery.
- Confirm zero CPU/GPU mismatches on the canonical and seeded grids in the authoritative environment.
- Record cold-build, readback, warm-load, peak-buffer, and main-thread-slice results.
- Capture the five erosion visual scenes and hydrology/CLOD regressions.
- Port the accepted artifact consumer and later the builder to Rust/Bevy; this is outside the CLOD completion gate.

## 2. Canonical GPU vegetation authority

The plan file already contains the correct current status and remains the binding source.

| Milestone | Status | Repository state |
|---|---|---|
| VEG-GPU-1 — Shared contracts | **Done — code** | Shared integer PCG/hash, fixed layouts, capacity validation, cluster planning, canonical sample types, and golden tests are present. |
| VEG-GPU-2 — Canonical terrain bindings | **Partial** | Canonical carved-height and hydrology bindings are substantially integrated. Exact voxel/occupancy, project-prop exclusion, unified far-summary bindings, and native river/lake parity remain. |
| VEG-GPU-3 — Cluster classification and compaction | **Pending** | Must wait for the VEG-GPU-2 exit gate. |
| VEG-GPU-4 — Fused candidate generation | **Pending** | Current category-specific ring/scatter kernels are not the final unified authority. |
| VEG-GPU-5 — Ecology, exclusions, accepted compaction | **Pending** | This is the dependency required by final morphology and dressing GPU integration. |
| VEG-GPU-6 — LOD, cascades, indirect draws | **Pending** | Existing per-category indirect paths are foundations, not completion of this unified milestone. |
| VEG-GPU-7 — Invalidation and voxel edits | **Pending** | No accepted unified cluster-local replacement pipeline yet. |
| VEG-GPU-8 — Default flip and cleanup | **Pending** | Legacy/category-specific normal gameplay ownership has not been removed. |

### Immediate blocker

Finish VEG-GPU-2 before extending the unified pipeline. Starting VEG-GPU-3 while exact
voxel, exclusion, and far-summary provider contracts are still incomplete would bake the
wrong acceptance semantics into every downstream category.

## 3. Terrain-relative probe GI

| Milestone | Status |
|---|---|
| PGI-1 — Data and empty clipmaps | **Pending** |
| PGI-2 — Terrain-relative positioning and relocation | **Pending** |
| PGI-3 — Near exact tracing | **Pending** |
| PGI-4 — Mid/far summary tracing | **Pending** |
| PGI-5 — Radiance and SH | **Pending** |
| PGI-6 — Scheduling, history, and edits | **Pending** |
| PGI-7 — Material integration | **Pending** |
| PGI-8 — Default flip | **Pending** |

No `probe_gi` runtime matching the plan's three terrain-relative cascades, SH-L1 records,
visibility-provider order, relocation, publication textures, or `sample_probe_gi()` material
contract was found. Existing radiance-cascade, forest-lighting, ambient, GTAO, and fog code
must not be relabelled as completion of this plan.

## 4. Continuous per-instance tree morphology

### Milestone status

| Milestone | Status | Repository state |
|---|---|---|
| MORPH-1 — Contracts and derivation | **Done — code** | Types, species config, stable channels, deterministic derivation, packing, validation, diagnostics, WGSL mirror, and tests exist. |
| MORPH-2 — Geometry attributes | **Done — code** | Required morphology attributes are generated and tests verify them across species, variants, and LODs. Vertex-buffer packing was hardened for WebGPU limits. |
| MORPH-3 — Near/far mesh deformation | **Done — code; visual acceptance pending** | Runtime deformation is connected to detailed and cheap tree materials with fixed ordering, root anchoring, crown start, health tint, foliage retention, and wind scaling. |
| MORPH-4 — GPU generation integration | **Partial** | The existing GPU tree ring generates and carries morphology records. Final integration into Plan 2's fused VEG-GPU-5 acceptance pass cannot be complete until VEG-GPU-5 exists. |
| MORPH-5 — Foliage density and health | **Done — code** | Deterministic foliage-card retention and health-based material tint are active in the current CLOD tree material path. Camera/shadow/LOD visual parity still needs Lane B evidence. |
| MORPH-6 — Competition field | **Partial** | A deterministic CPU competition sampler and tests exist, and current GPU derivation has local competition logic. The prescribed streamed GPU competition texture and CPU/GPU `1/255` parity gate are not complete. |
| MORPH-7 — Impostor texture arrays | **Partial** | Age-bucket constants, layer indexing/blending helpers, bake synchronization, and impostor hardening exist. Full 12-layer-per-species dual-channel arrays and proven runtime age interpolation were not found as a completed path. |
| MORPH-8 — Bevy bundle/runtime port | **Pending** | Outside CLOD-POC; no accepted Rust/Bevy parity port yet. |

### Remaining CLOD work

- Replace current-ring-specific MORPH-4 ownership with canonical VEG-GPU-5 generation.
- Implement the prescribed competition texture rather than relying on the current synthetic/local approximation.
- Finish and wire the full age-layer impostor array path.
- Add the seven deterministic morphology acceptance scenes to the unified QA battery.
- Capture near/far/impostor/shadow parity and the isolated morphology GPU delta on Lane B.

## 5. Ecological dressing

The current runtime is useful, but it is not yet the complete authority described by the plan.
It currently rebuilds CPU candidate lists around the camera and writes Three.js instanced
meshes. GPU resources and compute dispatch classes exist, but the normal integration still
constructs the CPU `DressingSystem`.

| Milestone | Status | Repository state |
|---|---|---|
| DRESS-1 — Registry, IDs, config | **Done — code** | Canonical 29-class registry, ownership categories, numeric IDs, deterministic stable IDs, strict config, and validation exist. |
| DRESS-2 — Persistent deadfall vertical slice | **Partial** | Logs, paired stumps, snags, decay rules, stable IDs, rendering, and a persistence bridge exist. The live runtime does not yet consume the persistence bridge/global save exclusions, so destroy/reload acceptance is not complete. |
| DRESS-3 — Attachment anchors and fungi | **Partial** | Anchor/attachment contracts and deterministic attachments to generated dressing parents exist. Full attachment to canonical tree/prop bundle anchors, wind/LOD following, and parent-destruction propagation are incomplete. |
| DRESS-4 — Terrain cosmetic clusters | **Partial** | Litter, moss/lichen, twigs, chips, flowers, and related placement/rendering code exist. Exact edit/structure exclusions and complete grass-suppression integration are not authoritative in the current runtime sample. |
| DRESS-5 — Hydrology dressing | **Mostly done — code; acceptance pending** | River cobbles, wet stones, driftwood, bank classes, shore/depth/flow affinity, support offsets, and flow-aligned driftwood fixes exist. Native river-bank visual correctness remains unaccepted. |
| DRESS-6 — Cliff and cave dressing | **Partial** | Cave/cliff class rules and affinity helpers exist, but the active environment sampler currently reports no exact voxel surface and a zero cave-mouth factor. Local reaction to cave opening/closing edits is therefore not complete. |
| DRESS-7 — Full GPU integration | **Partial scaffold** | GPU layouts, resources, shaders, dispatch, counters, capacity checks, and LOD classification scaffolding exist. They are not the default runtime authority and are not integrated into VEG-GPU-5 indirect groups. CPU candidate arrays remain in normal dressing gameplay. |
| DRESS-8 — Bevy bundle/runtime port | **Pending** | Outside CLOD-POC; no accepted Rust/Bevy port yet. |

### Remaining CLOD work

- Feed the active runtime the canonical `VegetationSurfaceSample` prefix plus exact voxel,
  cave, structure, edit, erosion, hydrology, and persistence state.
- Wire save exclusions and modified transforms into candidate acceptance and regeneration.
- Consume authored tree/prop anchors and follow parent transforms, wind, LOD, and destruction.
- Move generation/acceptance/render grouping into the canonical VEG-GPU-5/6 path.
- Remove the CPU camera-radius candidate rebuild from normal gameplay after parity acceptance.
- Replace placeholder/primitive visual content where necessary before claiming Fable5 visual parity.

## 6. Unified visual and performance regression

The repository already has specialized QA, performance, screenshot, water, tree, CLOD, and
Bevy tools. Those foundations remain valuable. The new unified plan, however, has not been
migrated into the required canonical manifests and runner.

| Milestone | Status | Evidence |
|---|---|---|
| QA-U1 — Schema and validation | **Pending** | `validation/manifests/visual-regression.yaml` is absent and both legacy `config/qa_visual.yaml` and `config/qa_perf_move.yaml` still exist. |
| QA-U2 — Deterministic runtime hooks | **Pending as unified contract** | Existing hooks do not establish the complete shared CLOD/Bevy freeze/readiness contract. |
| QA-U3 — Image metrics and reports | **Pending as unified contract** | Specialized image/report code exists, but the prescribed unified modules and reports are absent. |
| QA-U4 — Timing and counter integration | **Pending as unified contract** | Existing perf outputs exist, but the canonical manifest-driven absolute-gate layer is absent. |
| QA-U5 — Specialized command orchestration | **Pending** | No canonical allowlisted orchestration manifest/runner. |
| QA-U6 — Determinism double-run | **Pending** | No prescribed fresh-process unified A/B battery. |
| QA-U7 — Baseline workflow | **Pending** | No authoritative main/clean-tree baseline update workflow matching the plan. |
| QA-U8 — Initial CLOD and Bevy batteries | **Pending** | Mandatory unified baselines and Lane A/B/C commands are not present. |

This means none of the new parity feature plans can currently claim final visual/performance
acceptance through Plan 6, even when their code slices are substantially implemented.

## 7. Tree performance gap

### Done

- GPU tree ring path and indirect draws.
- Quality presets controlling tree distance, density, spacing, visible capacity, and shadow LOD.
- Gameplay readback/count/CPU-validation defaults disabled.
- Integer PCG scatter in the composed GPU path.
- Shadow-cascade append work gated by configured maximum tree shadow LOD.
- Crown proxy casters for far/impostor shadows.
- Runtime path labels and diagnostics.
- Octahedral impostor support and current bake/runtime hardening.
- Deterministic capture checklist and commands.

### Pending

- Authoritative Lane B captures for `ultra`, `balanced`, `perf`, and `potato`.
- Median-of-run p95 reporting from the required deterministic harness.
- Confirmation that the baked impostor atlas is always selected by the GPU ring when ready.
- Final CPU-oracle parity cleanup for species and hydrology, if the debug oracle remains required.
- Use the measured baseline to determine whether the combined parity budget is feasible.

## Recommended execution order from the current repository state

1. **Implement QA-U1 through QA-U4 now.** Feature code is already landing faster than the acceptance system, so status is becoming harder to prove.
2. **Finish VEG-GPU-2**: exact voxel/occupancy, project-prop exclusions, far summaries, and native parity.
3. **Implement VEG-GPU-3 through VEG-GPU-5** before adding more category-specific GPU paths.
4. **Complete MORPH-4 and DRESS-7 on the unified authority**, then delete normal-gameplay duplicate generation paths only after parity.
5. **Complete ERO-7 evidence**; erosion should not remain permanently “implemented but unaccepted.”
6. **Start PGI-1 through PGI-6 in parallel** once its visibility providers are stable; PGI-7 waits for material interfaces.
7. **Finish morphology impostors and competition plus dressing persistence/cave/anchor integration.**
8. **Add QA-U5 through QA-U8 baselines and run the combined balanced profile.**
9. **Port accepted contracts to Rust/Bevy**, not intermediate CLOD approximations.

## Current bottom line

CLOD-POC has moved beyond planning for erosion, tree morphology, ecological dressing, and
tree performance foundations. The repository is not at combined Fable5 parity yet.

The critical path is no longer “add more visual systems.” It is:

```text
unified QA foundation
  -> finish canonical terrain providers
  -> unified GPU vegetation authority
  -> morphology/dressing authority integration
  -> probe GI
  -> native visual/performance acceptance
```

Until that chain is complete, use **code complete**, **partial**, and **acceptance pending**
explicitly. Do not label the combined Fable5 parity effort complete or within budget.