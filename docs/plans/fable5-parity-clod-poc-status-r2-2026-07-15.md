# Fable5 Parity — CLOD-POC Status R2 — 2026-07-15

Audit baseline: `main` through `c71a79b90c1113ba42e9fd0d743f6b78ab2b358e` before this document commit.

This file supersedes the GPU vegetation authority section and execution order in `fable5-parity-clod-poc-status-2026-07-15.md`. The earlier status was based on the prescriptive plan layout rather than the category GPU pipelines that already existed on `main`.

The detailed code audit is `fable5-parity-gpu-vegetation-authority-code-audit-2026-07-15.md`.

## Revised executive status

| Plan | CLOD-POC status | Verdict |
|---|---|---|
| Hydraulic + thermal erosion | Substantially code complete; acceptance pending | No change from the earlier audit. |
| GPU vegetation authority | **Code complete for active streamed trees, grass, understory, and stones; native acceptance pending** | The shared blocker is removed from the code path. Existing category kernels remain the single GPU authority; a second monolithic pipeline is not added. |
| Terrain-relative probe GI | Pending | No change from the earlier audit. |
| Continuous tree morphology | Mostly implemented; remaining morphology-specific work and acceptance pending | It no longer waits for a second vegetation generation pipeline. |
| Ecological dressing | CPU vertical slice plus GPU scaffold; production GPU ownership incomplete | Dressing remains its own grammar/attachment plan and is not part of the resolved shared tree/grass/understory/stone blocker. |
| Unified visual/performance regression | Pending | This remains the main proof and release blocker. |
| Tree performance gap | Foundations shipped; native measurement pending | No change from the earlier audit. |

## Revised GPU vegetation milestone status

| Milestone | Status | Code-driven resolution |
|---|---|---|
| VEG-GPU-1 — Shared contracts | **Done — code** | Shared config, deterministic identity, layouts, capacity checks, and canonical sample contracts remain normative. |
| VEG-GPU-2 — Canonical terrain bindings | **Done — code; acceptance pending** | Carved tile height, hydrology, exact toroidal residency, conservative voxel/cave masking, project props, construction, and saved environmental exclusions are bound through the vegetation height atlas. |
| VEG-GPU-3 — Cluster classification and compaction | **Architecture superseded** | Existing category GPU kernels already perform conservative GPU rejection and atomic category/group compaction. The old separate active-cluster pipeline would duplicate authority. |
| VEG-GPU-4 — Fused candidate generation | **Done in category kernels** | Candidate lattice derivation, sampling, acceptance, and append occur in GPU compute without a global candidate buffer. |
| VEG-GPU-5 — Ecology, exclusions, accepted compaction | **Done for active streamed categories** | Category ecology remains in its mature compute kernel; shared exclusion masking now reaches every surface category. |
| VEG-GPU-6 — LOD, cascades, indirect draws | **Done — code** | Visual groups, tree shadow groups, indirect arguments, and GPU-backed draw consumption already exist. |
| VEG-GPU-7 — Invalidation and edits | **Done — code** | Independent mask revisions trigger nearest-first tile replacement while old atlas contents remain live until upload. |
| VEG-GPU-8 — Default flip and cleanup | **Done — code; acceptance pending** | WebGPU authority remains default where supported. CPU terrain visibility filtering is opt-in oracle mode through `gpuEarlyReject=1`; gameplay readbacks remain off. |

## Landed authority completion

The completion work on `main` adds:

- a vegetation-only exclusion mask over canonical height tiles;
- cave entrance, procedural tunnel/chamber, and authored carve-stamp exclusion footprints;
- project-prop and placed-construction footprints;
- hidden/destroyed saved environmental-prop footprints with an independent save-store mutation revision;
- exclusion-preserving coast and hydrology shader logic;
- an explicit understory guard before its legacy hydrology helper can replace an excluded height;
- mask revision tracking independent of source height-array identity;
- nearest-first stale tile uploads without clearing the previous valid atlas first;
- canonical height-atlas authority for both continent and infinite-island tile runtimes;
- default-off CPU terrain prefiltering, retained only as an oracle/debug path;
- coarse diagnostics under `vegetationAuthority.mask.*`;
- tests for masks, saved exclusions, shader transforms, and composed WGSL contracts.

## Corrected critical path

```text
native typecheck and focused tests
  -> headed Chrome/WebGPU visual validation
  -> movement/performance validation with readbacks disabled
  -> unified QA foundation and retained evidence
  -> morphology-specific completion
  -> dressing GPU ownership
  -> probe GI
  -> accepted contract port to Rust/Bevy
```

The shared GPU vegetation authority is no longer the reason to delay morphology or other consumers. Final Fable5 parity is still not complete because native acceptance, unified QA, dressing, morphology-specific gaps, and probe GI remain.

## Native verification still required

From `tools/clod-poc`:

```powershell
npm run typecheck
npm run test -- src/vegetation/gpu_authority src/gpu/understory_ring_wgsl_transforms.test.ts src/gpu/wgsl_modules.test.ts src/world/heightfield_tiles/heightfield_tile_gpu_atlas.test.ts
npm run build
```

Then use headed Chrome/WebGPU with normal gameplay readbacks disabled. Validate river/lake banks, cave mouths, project props, construction placement/removal, destroyed environmental props, long traversal, tree shadows, and movement-frame stability.

Do not treat a headless SwiftShader run as vegetation visual, count, or GPU-timing acceptance.
