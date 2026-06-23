# Understory GPU-Ring Port Plan

## Motivation

Profiling (`?profile=1`) shows the clod-poc per-frame `props` cost swinging
7→30 ms in **playing** mode but collapsing to ~1 ms in **orbit** mode. The only
difference between the two is the ring center (`player.position` vs. the fixed
`controls.target`), which proves the cost is **movement-gated CPU re-scatter**,
not steady per-frame work.

The dominant remaining CPU scatterer is **understory**. Grass and trees already
moved to the GPU ring (toroidal clipmap + GPU cull + indirect draw); understory
did not. `UnderstorySystem.refreshForCenter()`
([understory_system.ts](../../tools/clod-poc/src/understory/understory_system.ts))
still, every `placement.refreshDistanceM` of travel:

- clones geometry + allocates `new THREE.InstancedMesh` per class (GC pressure),
- runs `setMatrixAt` loops in `populatePatchMeshes`,
- calls `computeBoundingBox/Sphere`,
- flags `instanceMatrix.needsUpdate` → full GPU re-upload on the next render.

This is exactly the CPU-per-frame-scatter the project mandate forbids for
vegetation. Porting understory to the GPU ring eliminates the `props` hitch and
unifies understory with grass/trees.

This does **not** address the separate orbit-mode `render` spike (up to 94 ms),
which is GPU-side (no pipeline pre-warm + whole-world frustum). That is tracked
separately.

## Reference architecture (what we mirror)

Trees are the closest template (discrete instances, per-group regions, indirect
draw). Key files:

- Compute: [tree_ring_compute.ts](../../tools/clod-poc/src/gpu/tree_ring_compute.ts)
- WGSL: [tree_ring.compute.wgsl](../../tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl)
- Ring math: [tree_ring_math.ts](../../tools/clod-poc/src/trees/tree_ring_math.ts)
- Draw material (reads storage buffer): `createTreeRingNodeMaterialHandle`
  in [tree_node_material.ts](../../tools/clod-poc/src/trees/tree_node_material.ts)
- System wiring: `updateGpuRingTrees` / `createGpuRingDrawResources` in
  [tree_system.ts](../../tools/clod-poc/src/trees/tree_system.ts)

### Contract recap

1. A `grid×grid` toroidal cell field covers `distanceM*2`. One compute thread
   per slot derives a world cell via `round((cam/cell - slot)/grid)*grid + slot`.
2. Each thread hashes a jittered position, samples the terrain field
   (`surfaceHeightField` / `densityGradient` from the shared `terrainCommon`
   WGSL module), applies an accept mask, picks a group, and `atomicAdd`s into a
   per-group region of a shared `cell` storage buffer (`vec4` = `cellX, cellZ,
   height, normalY`). Overflow past the per-group cap is dropped + flagged.
3. `build_indirect_args` writes the 5-uint draw args per group
   (`indexCount, instanceCount, 0, 0, firstInstance=group*cap`).
4. Draw: one `InstancedBufferGeometry` per group shares the source geometry +
   `setIndirect(indirect, group*5*4)`, `frustumCulled=false`. The node material
   reads `storage(cell).element(instanceIndex)` (the `firstInstance` offset puts
   `instanceIndex` in the right group region) and **re-derives** jitter / scale /
   yaw / wind phase from `hash(worldCell, salt)` — the compute stores only the
   minimal `vec4`.
5. Optional double-buffered async counter readback for stats/parity (never
   blocks; skips a dispatch when both slots are busy).

## Understory specifics & divergences from trees

| Aspect | Trees | Understory |
| --- | --- | --- |
| Groups | 3 species × 4 LODs = 12 | **6 classes × 1 LOD = 6** (`group = UNDERSTORY_CLASSES.indexOf(cls)`) |
| Cell size | `TREE_GPU_RING_CELL = 3.4` | `placement.spacingM` (default **3.0**) |
| Grid (default) | — | `ceil(distanceM*2/spacing)` = `ceil(300/3)` = **100** → 10 000 slots |
| Per-group cap | `maxVisible/12` | `maxInstances/6` = `12000/6` = **2000** |
| Group selection | species weights | **ecology-weighted class selection** (the hard part) |
| Geometry attrs | position/normal/color/uv/treeWind/treeFoliageMask + index | position/normal/color/uv/**understoryWindWeight/understoryClassMask** + index |

### The three genuinely hard parts

1. **Ecology + class selection.** `sampleUnderstoryEcology` +
   `understoryClassWeight` ([understory_ecology.ts](../../tools/clod-poc/src/understory/understory_ecology.ts))
   use multi-octave `fractalNoise2D` / `valueNoise2D` / `smoothstep` and a
   6-way weighted pick. **Decision:** port these faithfully to WGSL using the
   **noise fallback** branch for forest influence (`treeInfluence ?` → use
   `fractalNoise2D`), so understory is self-contained and does not depend on a
   frame-lagged GPU tree/canopy field. This is the bulk of the WGSL work and
   must be covered by a CPU/GPU parity test.

2. **O(n²) cross-class spacing dedup.** The CPU path rejects candidates within a
   class-dependent radius (`dead_log`/`stump` 1.7×, `flower`/`fern` 0.55×, else
   0.9× spacing) by scanning already-accepted instances. A per-cell parallel
   cull cannot see siblings. **Decision:** approximate — the one-candidate-per-
   cell grid already enforces base spacing of `spacingM`; large classes
   (`dead_log`/`stump`) additionally gate on a **coarser sub-grid hash** (accept
   only on cells whose `floor(worldCell/2)` parent hash passes), giving the
   sparser look without a neighbor scan. **This is an intentional fidelity
   change** — document it; visual QA must confirm density looks right.

3. **Priority ranking → capacity.** CPU ranks by `hash` priority then slices to
   `limit`. GPU uses the per-group atomic counter cap; selection order within a
   group is arbitrary. Matches trees; acceptable.

## File-by-file changes

New:

- `tools/clod-poc/src/trees/`-style **`understory/understory_ring_math.ts`** —
  group index, grid/slot count, per-group capacity, `packUnderstoryRingParams`,
  accept/ecology param extraction (pure functions; unit-tested).
- **`gpu/understory_ring_compute.ts`** — `UnderstoryGpuRingCompute` class
  (mirrors `TreeGpuRingCompute`): buffers, bind group, 3 pipelines
  (`clear_counters`, `understory_cull`, `build_indirect_args`), async readback,
  `stats()`, `destroy()`.
- **`gpu/shaders/understory_ring.compute.wgsl`** — cull shader: hash, toroidal
  cell, accept mask, ecology sample, class selection, append, indirect args.
- **`gpu/shaders/understory_ecology.wgsl`** (or inline) — WGSL ports of
  `fractalNoise2D` / `valueNoise2D` / `smoothstep` + class weights.
- **`createUnderstoryRingNodeMaterialHandle`** in `understory_node_material.ts`
  — reads the `cell` storage buffer; derives transform + wind from worldCell
  hashes; optional ring-edge distance fade.
- Tests: `understory_ring_math.test.ts`, `understory_ring_compute.test.ts`,
  and a CPU/GPU parity helper `generateUnderstoryRingValidationCounts`.

Edited:

- `gpu/wgsl_modules.ts` — add `composeUnderstoryRingShader(workgroupSize)`.
- `understory/understory_config.ts` — add a `gpu` block
  (`{ enabled, maxVisible, workgroupSize, fallbackToCpu, readbackVisibleLists,
  debugShowGpuCounts, debugValidateAgainstCpu }`) mirroring `tree_config` GPU
  settings; `refreshDistanceM` stays for the CPU fallback.
- `understory/understory_system.ts` — add `gpuDevice`/`gpuBackend`/`supportsGpu`
  options; `understoryUsesGpuRingDraw()`; `updateGpuRingUnderstory()` path +
  `createGpuRingDrawResources()` + `clearGpuRing()`; keep the CPU path as the
  documented fallback. Extend `UnderstoryStats` with `gpuStatus`,
  `gpuVisibleCount`, `gpuOverflowed`, `gpuDispatchMs`, `gpuCandidateCount`.
- `main.ts` — pass `gpuDevice`/`gpuBackend`/`supportsGpu` to `UnderstorySystem`
  (mirror the `TreeSystem` block at ~line 2307); surface new HUD stats.

## Phased delivery (each phase independently green)

- **Phase 1** — `understory_ring_math.ts` + `packUnderstoryRingParams` +
  `understory_ring_math.test.ts`. Pure TS, no GPU. Verify: `npm test` for the
  new suite + `tsc`.
- **Phase 2** — WGSL cull shader + `UnderstoryGpuRingCompute` +
  `understory_ring_compute.test.ts` (mock `GPUDevice`, assert dispatch order,
  buffer sizes, readback resolution, overflow flag). Verify: vitest + `tsc`.
- **Phase 3** — `createUnderstoryRingNodeMaterialHandle` + ring draw resources
  (storage attributes, 6 group meshes, `setIndirect`). Verify: `tsc` + build.
- **Phase 4** — wire `UnderstorySystem` GPU path + `main.ts`; CPU fallback
  preserved and selected when `!isWebGpu` or device limits insufficient.
  Verify: `tsc` + build + existing `understory_system.test.ts` still green.
- **Phase 5** — `generateUnderstoryRingValidationCounts` parity test
  (tolerance like trees, ~2%); full `npm test` + `npm run build`; **harness QA**
  (`scene=phase1-terrain`, shots + `window.__drusnielClod.stats`) and
  **before/after `?profile=1`** capture proving the playing-mode `props` hitch
  is gone. Report counters: `understory.gpuVisibleCount`, `gpuDispatchMs`,
  `gpuOverflowed`, frame `props`/`render` ms before/after.

## Risks / open questions

- **Storage-buffer-per-stage limit.** Understory cull needs uniform + counters +
  indirect + cell (+ dig edits + field params if it samples carved terrain) =
  up to 6 storage bindings, same as trees
  (`TREE_GPU_RING_STORAGE_BINDINGS = 6`). Add the same
  `…ComputeUnsupportedReason` guard → CPU fallback on low-limit devices.
- **Does understory need dig-edit terrain?** Trees bind `digEdits`/`fieldParams`
  so `surfaceHeightField` matches carved terrain. Understory currently samples
  via the CPU `sampler` (which already reflects edits). To keep parity, bind the
  same dig-edit buffers in the cull shader. Confirm in Phase 2.
- **Spacing fidelity** (hard part #2) is the most likely visual regression —
  gate on shot-harness comparison before declaring done.
- **Wind look.** Current sway is an object-space XZ bend keyed by
  `understoryWindWeight` + per-instance `windPhase`. The ring material must
  reproduce it deterministically from the worldCell hash; compare against a
  frozen shot.
