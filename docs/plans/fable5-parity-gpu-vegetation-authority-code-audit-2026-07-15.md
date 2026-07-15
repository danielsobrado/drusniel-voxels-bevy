# GPU Vegetation Authority — Code Audit and Final Main Architecture — 2026-07-15

Audit baseline: `main` through `e52d3812b69c5c4e5dd8a0d7c3d8825cd7d51538` before this document commit.

This document supersedes milestone status inferred only from `fable5-parity-gpu-vegetation-authority.md`. The code is the source of truth. The older plan remains useful for contracts, deterministic identities, buffer layouts, and acceptance scenes, but its assumption that Drusniel still needed a second monolithic vegetation pipeline was outdated.

## Final verdict

The shared GPU vegetation authority blocker is code-complete on `main` for the active streamed categories:

- trees;
- grass;
- understory;
- stones.

The active category pipelines already perform GPU candidate generation, terrain/ecology rejection, atomic accepted-instance compaction, LOD selection, indirect argument generation, and direct GPU-backed rendering. Building `classify_clusters.wgsl`, `generate_accept.wgsl`, and another parallel accepted-instance system would duplicate working production paths and create two authorities.

Ecological dressing keeps its separate grammar and parent-attachment pipeline. Its GPU scaffold remains under `tools/clod-poc/src/ecology/dressing/gpu`; it is not allowed to become a second owner of tree, grass, understory, or stone placement.

Native Windows visual and performance acceptance is still required. That is an exit-gate activity, not missing authority code.

## Code-driven architecture amendment

The final ownership model is:

```text
shared contracts and deterministic identity
  src/vegetation/gpu_authority

canonical terrain authority
  carved heightfield tile cache
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

The old proposed monolithic cluster/generate/classify pipeline is not implemented because it would repeat these category kernels, their mature render layouts, tree shadow groups, and category-specific ecology.

## Milestone reconciliation

### VEG-GPU-1 — Shared contracts

**Complete.**

Evidence:

- `tools/clod-poc/config/vegetation_gpu_authority.yaml`;
- `src/vegetation/gpu_authority/config.ts`;
- `constants.ts`, `hashes.ts`, `pcg2d.ts`, and WGSL equivalents;
- `cluster_grid.ts` and `cluster_planner.ts`;
- fixed TypeScript/WGSL layouts and packing tests;
- capacity and portable storage-binding validation.

### VEG-GPU-2 — Canonical terrain bindings

**Code complete.**

Existing code already bound canonical carved tile height, explicit toroidal residency, hydrology, finite-difference normals, and category placement shaders.

This audit added the remaining local authority layer:

- voxel cave entrances, procedural cave tunnels/chambers, and authored carve stamps become conservative vegetation exclusion footprints;
- active project props become exclusion footprints;
- placed construction pieces become exclusion footprints from the persisted construction snapshot;
- destroyed or hidden saved environmental props remain excluded;
- exclusions are rasterized only into the vegetation GPU height atlas, not the canonical terrain source;
- masked tiles use a dedicated invalid placement height, so normal surface categories reject them without CPU instance inspection;
- mask revision is tracked independently from height-array identity;
- only stale atlas tiles are re-uploaded, nearest first;
- the previous valid atlas content remains resident until each replacement upload commits.

Files:

- `src/vegetation/gpu_authority/heightfield_mask.ts`;
- `src/world/heightfield_tiles/heightfield_tile_gpu_atlas.ts`;
- `src/world/heightfield_tiles/heightfield_tile_runtime.ts`;
- `src/app/frame_loop/vegetation_frame_phase.ts`.

The older requirement to use far-summary as an exact placement source was incorrect. Far-summary is deliberately coarse and is suitable for conservative rejection and far rendering, not final instance height. Exact placement continues to prefer the carved tile atlas and hydrology. Missing exact samples never authorize a destructive rejection.

### VEG-GPU-3 — Cluster classification and compaction

**Superseded by the existing category-kernel architecture.**

The original separate active-cluster append pass is not a required second authority. Trees, grass, understory, and stones already reject on GPU and append accepted category/group outputs atomically. The earlier CPU terrain-visibility prefilter is now disabled in normal gameplay and remains opt-in only with:

```text
?gpuEarlyReject=1
```

That mode is an oracle/debug path. It is not used to claim gameplay performance.

### VEG-GPU-4 — Fused generation and acceptance

**Complete in the existing category kernels.**

Each active kernel derives its world-anchored lattice position, samples terrain/hydrology, evaluates category rules, and appends accepted output without materializing a global candidate buffer.

The shared PCG/hash implementation remains normative for stable identity. Category-specific legacy hash helpers should continue converging on the shared module when touched, but they do not move authority back to CPU.

### VEG-GPU-5 — Ecology, exclusions, accepted compaction

**Complete for the active streamed categories.**

- tree material/species ecology runs in tree compute;
- grass terrain, bank, density, and edge rules run in grass compute;
- understory forest/moisture/class rules run in understory compute;
- stone terrain affinity and class budgets run in stone compute;
- voxel, project-prop, construction, and destroyed-environmental-prop exclusions now enter the shared vegetation-only height atlas;
- accepted outputs remain atomically compacted in the existing render layouts.

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

- terrain cache invalidation stays tile-local;
- vegetation authority masks have their own monotonic revision;
- project-prop and save updates are detected through the project prop revision;
- construction updates are detected through the persisted snapshot;
- voxel overlay replacement is detected by source identity;
- stale masked tiles are replaced incrementally instead of rebuilding CPU instance arrays;
- old atlas data remains live until the replacement upload occurs.

The mask path is conservative: current surface categories do not place vegetation on cave floors. A future cave-specific class must add an explicit cave-floor surface contract rather than weakening the current rejection.

### VEG-GPU-8 — Default flip and cleanup

**Code complete.**

- WebGPU category authority remains default-on where supported;
- CPU fallback remains available for unsupported devices and explicit debug forcing;
- CPU terrain visibility/active-slot filtering is default-off;
- `gpuEarlyReject=1` is the explicit oracle switch;
- normal gameplay count and instance readbacks remain off;
- diagnostics publish `vegetationAuthority.mask.*` counters without instance readback.

The static world-lattice slot sequence used to address GPU invocations is mechanical dispatch data, not a CPU terrain or visibility authority.

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

These counters are mirrored on the normal coarse diagnostics cadence.

## Tests added

`src/vegetation/gpu_authority/heightfield_mask.test.ts` covers:

- project-prop footprint masking;
- source height-array immutability;
- procedural cave entrance and tunnel masking;
- no-allocation return for tiles without exclusions.

Existing tests continue to cover deterministic hashes, packing, atlas toroidal residency, canonical height sampling, category compute composition, indirect counts, and debug-readback policy.

## Required manual exit gate

Run from `tools/clod-poc` on the native Windows Chrome/WebGPU machine:

```powershell
npm run typecheck
npm run test -- src/vegetation/gpu_authority src/world/heightfield_tiles/heightfield_tile_gpu_atlas.test.ts src/gpu/wgsl_modules.test.ts
npm run build
```

Then run headed captures with readbacks disabled:

```powershell
npm run dev
```

Validate these scenes or their current equivalents:

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
- no new frame spike caused by mask rebuilding or tile upload;
- river/lake bank placement remains visually consistent.

Do not use a headless SwiftShader run to accept vegetation visibility, tree counts, or GPU timing.
