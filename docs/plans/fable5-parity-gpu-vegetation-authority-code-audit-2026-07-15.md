# GPU Vegetation Authority — Code Audit and Final Main Architecture — 2026-07-15

Implementation audit baseline: `main` through `c71a79b90c1113ba42e9fd0d743f6b78ab2b358e`. Documentation-only commits may follow this baseline.

This document supersedes milestone status inferred only from `fable5-parity-gpu-vegetation-authority.md`. The code is the source of truth. The older plan remains useful for deterministic identities, layouts, acceptance semantics, and budgets, but its assumption that Drusniel still needed a second monolithic vegetation pipeline was outdated.

The project-wide revised status is `fable5-parity-clod-poc-status-r2-2026-07-15.md`.

## Verdict

The shared GPU vegetation authority blocker is code-complete for the active streamed surface categories:

- trees;
- grass;
- understory;
- stones.

The category pipelines already perform GPU lattice generation, terrain/ecology rejection, atomic accepted-instance compaction, LOD/group selection, indirect argument generation, and direct GPU-backed rendering. Adding separate `classify_clusters.wgsl`, `generate_accept.wgsl`, and duplicate accepted-instance buffers would create two competing authorities.

Ecological dressing remains a separate grammar and parent-attachment system. Its GPU scaffold is not allowed to become a second owner of trees, grass, understory, or stones. Dressing still has its own production-integration work.

Native Windows visual and performance acceptance remains pending. Code-complete is not an acceptance claim.

## Final ownership model

```text
shared contracts and deterministic identity
  src/vegetation/gpu_authority

canonical placement authority
  carved heightfield tile cache
  + explicit toroidal GPU residency
  + streaming hydrology atlas
  + vegetation-only voxel/prop/construction exclusion mask

category GPU kernels
  grass_ring.compute.wgsl
  tree_ring.compute.wgsl
  understory_ring.compute.wgsl
  stone_scatter.compute.wgsl

outputs
  atomic category/group counters
  compact GPU instance buffers
  GPU indirect arguments
  direct render consumption
```

## Milestone reconciliation

### VEG-GPU-1 — Shared contracts

**Complete.**

The repository contains shared configuration, category/channel constants, integer PCG/hash contracts, cluster-grid helpers, canonical surface sample types, fixed TypeScript/WGSL layouts, capacity validation, and packing/golden-vector tests.

### VEG-GPU-2 — Canonical terrain bindings

**Code complete; native acceptance pending.**

Existing code already provided carved tile heights, hydrology, canonical finite-difference normals, and explicit toroidal residency. The completion work adds the remaining local placement authority:

- cave entrances;
- procedural cave tunnels and chambers;
- authored carve stamps;
- active project props;
- persisted construction pieces;
- hidden or destroyed saved environmental props.

These sources become conservative 2D footprints in a vegetation-only height mask. The canonical terrain tile data is never mutated. A masked upload uses a dedicated invalid placement height. Placement WGSL preserves that invalid value through finite-coast shaping and hydrology, and understory rejects it before its legacy hydrology helper can replace it.

Mask revision is independent from source height-array identity. Project edits, save-store mutations, construction snapshots, and voxel-overlay replacement invalidate the mask. Stale atlas tiles are uploaded nearest-first while the previous valid atlas remains live until each replacement upload.

The canonical height atlas is authoritative for both continent and infinite-island tile runtimes. Missing exact residency remains conservative: it does not authorize destructive rejection.

Far summary remains a coarse rejection/render source, not an exact final placement-height source.

### VEG-GPU-3 — Cluster classification and compaction

**Architecture superseded by the existing category kernels.**

Trees, grass, understory, and stones already execute GPU rejection and atomic category/group append. A separate active-cluster authority would duplicate those paths.

The old CPU terrain-visibility prefilter is disabled in normal gameplay. It is available only as an explicit oracle/debug mode:

```text
?gpuEarlyReject=1
```

Oracle runs are not gameplay performance evidence.

### VEG-GPU-4 — Fused generation and acceptance

**Complete in category kernels.**

Each active kernel derives world-anchored candidates, samples placement authority, evaluates category rules, and appends only accepted outputs. No global candidate buffer is materialized.

### VEG-GPU-5 — Ecology, exclusions, accepted compaction

**Complete for active streamed surface categories.**

- tree species/material ecology runs in tree compute;
- grass terrain, bank, density, and edge rules run in grass compute;
- understory forest, moisture, and class rules run in understory compute;
- stone terrain affinity and class budgets run in stone compute;
- shared exclusion masking reaches every active surface category;
- accepted outputs remain atomically compacted in existing render layouts.

The exclusion path is conservative. Current surface categories do not place vegetation on cave floors. A future cave-specific category must add an explicit cave-floor surface contract.

### VEG-GPU-6 — LOD, cascades, indirect draws

**Complete.**

- trees classify species, visual LODs, and shadow-cascade geometry groups;
- grass writes near, mid, far, and super groups;
- understory writes class groups and indirect counts;
- stones write class groups and indirect counts;
- render geometry consumes GPU buffers directly;
- normal gameplay readback remains disabled.

### VEG-GPU-7 — Invalidation and edits

**Code complete.**

- terrain invalidation remains tile-local;
- vegetation masks have a monotonic revision;
- project-prop and saved-prop revisions are independent;
- construction changes are detected from the persisted snapshot;
- voxel-overlay replacement is detected by source identity;
- stale masked tiles are replaced incrementally;
- old atlas content remains available until replacement upload.

### VEG-GPU-8 — Default flip and cleanup

**Code complete; native acceptance pending.**

- WebGPU category authority remains default where supported;
- CPU fallback remains for unsupported devices and explicit debug forcing;
- CPU terrain visibility filtering is default-off;
- `gpuEarlyReject=1` is the oracle switch;
- gameplay count and instance readbacks remain off;
- diagnostics publish `vegetationAuthority.mask.*` without instance readback.

The static slot sequence used to address GPU invocations is mechanical dispatch data, not CPU terrain or visibility authority.

## Main files changed

```text
tools/clod-poc/src/vegetation/gpu_authority/heightfield_mask.ts
tools/clod-poc/src/vegetation/gpu_authority/heightfield_mask.test.ts
tools/clod-poc/src/world/heightfield_tiles/heightfield_tile_gpu_atlas.ts
tools/clod-poc/src/world/heightfield_tiles/heightfield_tile_runtime.ts
tools/clod-poc/src/gpu/shaders/placement_height.wgsl
tools/clod-poc/src/gpu/understory_ring_wgsl_transforms.ts
tools/clod-poc/src/gpu/understory_ring_wgsl_transforms.test.ts
tools/clod-poc/src/gpu/wgsl_modules.ts
tools/clod-poc/src/gpu/wgsl_modules.test.ts
tools/clod-poc/src/save/prop_store.ts
tools/clod-poc/src/vegetation/terrain_rejection_config.ts
tools/clod-poc/src/runtime/vegetation/vegetation_startup.ts
tools/clod-poc/src/app/frame_loop/vegetation_frame_phase.ts
```

## Added counters

```text
vegetationAuthority.mask.revision
vegetationAuthority.mask.footprints
vegetationAuthority.mask.voxelFootprints
vegetationAuthority.mask.projectPropFootprints
vegetationAuthority.mask.constructionFootprints
vegetationAuthority.mask.destroyedPropFootprints
vegetationAuthority.mask.indexedTiles
```

## Repository tests added or extended

- project-prop footprint masking;
- saved environmental-prop revision and masking;
- source height-array immutability;
- procedural cave entrance and tunnel masking;
- no-allocation return for tiles without exclusions;
- fail-fast understory WGSL transform contract;
- composed WGSL exclusion preservation through coast and hydrology.

These tests were committed, but they have not been executed by this connector session. GitHub reported no status checks on the latest implementation commit at audit time.

## Required manual exit gate

Run from `tools/clod-poc` on the native Windows Chrome/WebGPU machine:

```powershell
npm run typecheck
npm run test -- src/vegetation/gpu_authority src/gpu/understory_ring_wgsl_transforms.test.ts src/gpu/wgsl_modules.test.ts src/world/heightfield_tiles/heightfield_tile_gpu_atlas.test.ts
npm run build
```

Then run headed Chrome/WebGPU with gameplay readbacks disabled. Validate:

```text
vegetation-canonical-river
vegetation-cave-mouth
vegetation-construction-edit
vegetation-destruction
vegetation-occluded-valley
vegetation-4km-traverse
```

Acceptance requires:

- no vegetation in cave voids, project-prop footprints, or construction footprints;
- no regeneration of destroyed environmental props;
- no CPU terrain-prefilter activity unless `gpuEarlyReject=1` is present;
- no gameplay readback counters enabled;
- no one-frame vegetation hole during mask revision uploads;
- no new movement-frame spike from mask rebuilding or tile upload;
- stable river/lake bank placement;
- stable tree camera and shadow groups.

Do not use a headless SwiftShader run to accept vegetation visuals, counts, or GPU timing.
