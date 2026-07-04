# Pure-GPU trees — implementation plan

Document status: historical implementation record. The pure-GPU tree ring path is now the
TreeSystem GPU route; current incomplete verification and quality gates live in
`docs/plans/clod-poc-trees-parity-status.md`,
`docs/plans/clod-poc-tree-performance-plan.md`, and
`docs/plans/clod-poc-tree-billboard-quality-plan.md`.

Goal: make clod-poc trees **fully GPU-driven** — GPU scatter + per-frame GPU cull into
compacted indirect draws, instances and counts never touching the CPU — matching the
quality and performance of the LAAS reference in `docs/reference/fable5-world-demo`.
This removes the current tree GPU path's two CPU bottlenecks (CPU patch scatter via
`generateTreeInstances`, and the per-frame GPU→CPU→GPU readback in `tree_gpu_cull.ts`),
and makes **LOD crossfade GPU-native** instead of CPU-path-only.

This started as a plan and now serves as the implementation history for the tree GPU ring.
The sibling grass/vegetation rejection state is tracked by
`docs/plans/clod-poc-gpu-vegetation-early-rejection.md`.

---

## 1. What the current tree GPU path is (and why it isn't "pure GPU")

`TreeSystem` today, even with `gpu.enabled`, is a hybrid:

| Stage | Where | Cost |
|---|---|---|
| Scatter (placement) | **CPU** — `generateTreeInstances` per CLOD page | per-page main-thread spike |
| Cull + LOD | GPU — `tree_cull.compute.wgsl` → `visibleBuffer` of compact records | ok |
| Readback | **CPU** — `mapAsync` (`tree_gpu_cull.ts:126`) | latency + a frame of lag |
| Draw | **CPU** — `applyGpuVisibleRecords` writes `InstancedMesh` matrices | per-frame main-thread writes |

Records carry one `lod` each, which is why crossfade only exists in the CPU path
(`updatePatchLods`): there is no GPU-resident per-LOD draw buffer to dither against.

The pure-GPU path deletes the readback and the CPU instance writes entirely, and lets the
GPU emit each tree into its LOD bucket(s) — crossfade falls out for free.

---

## 2. Reference architecture (LAAS — what we are matching)

Grounded in `src/gpu/passes/Scatter.ts`, `src/vegetation/Forests.ts`,
`src/render/VegInstance.ts`, `src/render/VegPrepass.ts`.

1. **GPU scatter, instance data stays on GPU.** One compute thread per child-grid cell
   (`TREE_CELL = 3.4 m`). Each cell jitters to a world position, samples the site
   (biome/slope/snow/moisture/rockExp from textures), gates acceptance by a per-biome
   density × a **parent clump field** (hashed coarse-grid parents → light-competition
   clumping; the same field correlates understory), picks species by a weighted table,
   computes scale/yaw/lean/variant, and **atomically appends** into two `vec4` storage
   buffers: `A = (x,y,z,scale)`, `B = (yaw, leanX, leanZ, idF)` where `idF = class*8 +
   variant`. Determinism via integer `pcg2d(cell, salt)` (sin hashes band at large
   coords). Only the final **counts** read back once at boot.
2. **Per-frame GPU cull → compact → indirect.** `Forests.update` runs each frame:
   `clearK` (zero per-group counters) → one `makeCull` kernel per layer → `indirectK`.
   The cull kernel, per instance: reconstruct center+radius from `idF`/class table,
   `dist = |A.xyz − camU|`, **frustum test** (6 planes as a uniform array), optional
   **terrain-occlusion march** (7 samples along the camera sight line, skip if a ridge
   hides it), then pick the LOD **ring band** and `atomicAdd` the instance **slot** into
   the per-`(pool, ring)` **compact region**. `indirectK` copies each group's counter into
   the draw's `instanceCount` word. **Nothing reads back.**
3. **Indirect draws.** One `IndirectStorageBufferAttribute` holds `D` draws × 5 words;
   `geometry.setIndirect(attr, d*20)` points each mesh at its slot; meshes are
   `frustumCulled = false`.
4. **Storage-buffer material** (`VegInstance.instanceVeg`): the vertex stage fetches
   `slot = compact[instanceIndex + groupBase]`, then `A = bufA[slot]`, `B = bufB[slot]`;
   rotates **position and normal** by yaw (assign `normalLocal` before returning, exactly
   like three's `InstanceNode`), applies lean shear + hierarchical wind, then dithered LOD
   crossfade and a per-instance tint.
5. **GPU-native crossfade.** Ring bands **overlap** (`dist < R0+BAND` *and*
   `dist ≥ R0−BAND ...`): a boundary tree is appended to **both** adjacent LOD groups, and
   each group's material applies a **complementary** screen-door dither — the outgoing ring
   draws where `IGN < fadeOut`, the incoming where `IGN ≥ 1 − fadeIn`, with `fadeOut +
   fadeIn = 1` so the two split the pixel set exactly. (No CPU secondary-placement; this is
   what my current CPU crossfade emulates by hand.)
6. **Overdraw control** (`VegPrepass`): a depth-only **prepass twin** sharing the same
   geometry/indirect slot and the same `positionNode`/`maskNode`/`opacityNode`, then the
   color pass runs `depthFunc = EQUAL` so the full lighting model executes once per pixel.
7. **CPU per frame is only:** copy camera pos → uniform, compute 6 frustum planes →
   uniform array, dispatch kernels. Counters read async ~every N frames for HUD only.

---

## 3. What clod-poc already has (the gap is moderate, not green-field)

- **Grass already does all of this** via a **toroidal clipmap** (even better than LAAS's
  fixed boot pool for a streamed world): `src/gpu/shaders/grass_ring.compute.wgsl`
  (`clear_counters`, `grass_cull_fine/far`, `build_indirect_args`, atomic append into tier
  regions, indirect args) + `grass_node_material.ts` `webgpu-ring-v1` (reads instances from
  `storage().element(instanceIndex)`), driven by `grass_ring_compute.ts`. The dispatch grid
  **is** the slot grid; every per-instance value re-derives from `pcg2d(worldCell)`; **no
  candidate buffer, no upload, no readback.**
- **GPU terrain field exists**: `src/gpu/shaders/terrain_field.wgsl` —
  `surfaceHeightField(x,z)`, `densityGradient` → normal, dig edits via `brushSdf`. The cull
  kernel can evaluate height + normal on-GPU with no baked textures.
- **Tree assets exist**: per-LOD geometry (`tree_geometry.ts`), foliage atlas
  (`tree_alpha_mask.ts`), octahedral impostor math + baker (`tree_impostor_*`), and the
  WebGPU node material (`tree_node_material.ts`) already does vertex-colour albedo, foliage
  cutout, wind, hemi+sun lighting, and the **dither `maskNode`** I added (the exact hook
  crossfade needs).

**The gap for trees:**
1. No GPU tree scatter — placement is CPU (`generateTreeInstances`).
2. The tree cull shader emits **records for readback**, not compact slot lists + indirect.
3. The tree node material reads `InstancedMesh` attributes, not storage buffers + a compact
   index list.
4. No indirect-draw meshes per `(species, LOD)`.
5. Impostor atlas baking is WebGL-only (`isWebGlRenderTargetRenderer` guard) — a WebGPU
   render-to-atlas bake is needed, or fall back to the procedural impostor cards.

---

## 4. Target architecture for clod-poc trees

Mirror the **grass toroidal clipmap**, not LAAS's fixed boot pool, because clod-poc streams
a bubble around the camera rather than a fixed 4 km world:

- **Slot grid = clipmap over the tree bubble.** Dispatch `GRID²` threads where
  `GRID = ceil(2 * distanceM / TREE_CELL)` (`TREE_CELL ≈ 3.4 m`). Each slot → the world tree
  cell congruent to it nearest the camera (`worldCell()`, already in grass `GroundRing`).
  No candidate upload; a slot's tree changes only when its world cell changes.
- **Scatter inside the cull kernel** (one pass): derive `wc`, `wpos = (wc +
  pcg2d(wc,salt)) * CELL`, sample `surfaceHeightField`/`densityGradient`, evaluate a tree
  density/clump/slope/snow mask, accept via `pcg2d(wc,salt2) < accept`. Accepted → derive
  species/scale/yaw/variant from `pcg2d` and append the **packed cell** (+ groundY) into the
  per-`(species, LOD)` compact region. Re-derive transform in the vertex stage like grass —
  so we store a compact cell, not a full `A/B` record (less bandwidth than LAAS, which it
  can afford because clod-poc placement is hash-derived, not erosion-field-driven).
- **Per-`(species, LOD)` indirect draws.** `species(3) × LOD(4) = 12` draw groups (plus the
  overlapping crossfade bands → an instance can land in two groups). One
  `IndirectStorageBufferAttribute`; each draw mesh `frustumCulled=false`,
  `setIndirect(attr, d*20)`.
- **Storage-buffer tree node material.** A `webgpu-ring`-style variant of
  `tree_node_material.ts`: fetch `slot = compact[instanceIndex + groupBase]`, re-derive
  transform from the packed cell, rotate position **and normal** by yaw, apply wind + the
  existing dither `maskNode` (now fed by the ring's distance fade, not a CPU attribute).
- **GPU crossfade** via overlapping bands + complementary dither (§2.5) — delete the CPU
  secondary-placement and the `treeLodFade` instanced attribute for the GPU path; keep them
  for the WebGL CPU fallback.

---

## 5. Staged plan

Each stage ends green (typecheck + vitest + build) and is independently reviewable. CPU
path stays the default/fallback throughout; the GPU path is behind `gpu.enabled` + WebGPU.

**Stage 0 — WGSL building blocks & tests (no rendering change).**
Port to WGSL with CPU oracles for unit tests: `pcg2d(cell, salt)`, `worldCell(slot, grid,
cell, camXZ)` (reuse grass's), a tree `acceptMask(h, normalY, wpos)` (slope/snow/height +
a parent clump field), and `treeLodRing(dist, params)` with band overlap. Mirror the
grass-ring shader-assembly path. Verify each against a TS port (the pattern the grass plan
and `clod-poc-self-polyfill-tests` already use).

**Stage 1 — GPU scatter+cull→compact→indirect for ONE species, near+mid only (flagged).**
New `tree_ring.compute.wgsl` (model on `grass_ring.compute.wgsl`): `clear_counters`,
`tree_cull` (scatter+accept+LOD-ring+atomic append of packed cell into 2 regions),
`build_indirect_args`. New driver `tree_ring_compute.ts`. New storage-buffer material
variant. Gate behind `?world=...&treeGpu=1`. Goal: validate the
compute→storage→indirect→material pipeline end-to-end on WebGPU. No crossfade yet.

**Stage 2 — GPU crossfade (band overlap + complementary dither).**
Overlap the near/mid bands in `tree_cull`; feed the material's `maskNode` from the ring's
`smoothstep` distance fade using the **complementary partition** (heed the LAAS bug: the two
edges must use *different* comparisons or you get hole bands at the 50/50 crossover).
Regression: a probe that samples the band and asserts no transparent holes.

**Stage 3 — all species, all 4 LODs + impostors.**
Extend to `species × LOD` groups. For the impostor LOD, either (a) port impostor baking to a
WebGPU render-to-atlas pass, or (b) use the procedural impostor cards (already in
`tree_geometry.ts`) as the GPU-path placeholder and keep `imp=fallback` status. Octahedral
frame selection moves into the vertex stage (camera-to-instance direction → atlas UV rect),
as the impostor material already computes on CPU today.

**Stage 4 — overdraw + shadow correctness (quality parity). Done.**
Depth-prepass twins now use the existing `VegPrepass` helper for foliage-card tree ring
draws, sharing the exact color-pass `positionNode` and complementary-dither `maskNode`;
the WebGPU renderer already installs `@invariant` clip position for Metal depth-EQUAL.
The LAAS shadow-caster half is N/A in clod-poc because there is no real-time shadow-map
pass.

**Stage 5 — wire as a TreeSystem mode + retire the readback path. Done.**
The ring compute + indirect meshes are the single TreeSystem GPU route; the CPU patch path
remains the WebGL/default fallback. The old `tree_gpu_*` readback path and
`tree_cull.compute.wgsl` have been removed. `TreeStats`/`tree_info.ts` report `gpu=ring`
with candidate/accepted/visible counts from ring stats.

---

## 6. Gotchas to carry over from LAAS (documented bugs, pre-paid)

- **Fade distance uniform, not TSL `cameraPosition`.** The shadow pass binds
  `cameraPosition` to the cascade camera (~hundreds of m away) → every ring fades out → veg
  casts no shadows. Use a `vegViewPos`-style main-camera uniform for all fade distances
  (`VegInstance.ts:48`).
- **Complementary fade partition.** Outgoing ring draws where `IGN < fadeOut`, incoming
  where `IGN ≥ 1 − fadeIn`, `fadeOut + fadeIn = 1`. Same comparison on both = hole bands.
- **`@invariant` clip position** when using a depth-EQUAL prepass, or Metal's reassociated
  position math fails the depth test → background through blade/leaf holes
  (`VegPrepass.ts:38`).
- **Pin caster `colorNode.a = 1` and express cutouts via `maskShadowNode`**, else three
  derives a bogus alpha from a vec3 colorNode and every shadow fragment discards.
- **Atomic append with cap + overflow flag** per region; clamp `instanceCount` to cap in
  `build_indirect_args` (LAAS `indirectK`).
- **Rotate normals with the instance** (assign `normalLocal` before returning position), or
  yawed trunks light from the wrong side.

---

## 7. Verification & perf gates

- **Determinism**: integer `pcg2d` only; CPU oracle tests per WGSL helper (Stage 0).
- **Parity**: GPU vs CPU visible LOD counts within tolerance (extend the existing
  `validateGpuRecords` idea to the ring path) behind a debug flag.
- **Perf** (per repo `CLAUDE.md`): native-Windows bench before/after on the deterministic
  visual scenes; compare `summary.json`. Target: remove the CPU `generateTreeInstances`
  spike and the readback latency; watch the new compute dispatch time and overdraw (the
  depth prepass should keep shaded-pixel cost flat).
- **Visual QA**: `tools/clod-poc` QA harness on a captured WebGPU summary (`?world=...&treeGpu=1`),
  checking crossfade has no holes and impostor transitions don't pop.

---

## 8. Stage Decisions

1. **Impostor baking on WebGPU**: **Decision: Stage 3b.** Ship procedural
   impostor cards first and defer WebGPU atlas baking.
2. **Packed-cell storage vs full A/B record**: **Decision: grass-style packed-cell
   storage.** Store compact world-cell/ground data and re-derive tree transforms in the
   material for consistency with the existing ring infra.
3. **tree_gpu_cull transition path**: **Decision: replace in place.** The pure GPU
   ring path is the TreeSystem GPU route; do not keep the readback route wired through
   runtime selection.
4. **Scope of this effort now**: **Decision: all stages.** Stages 0-5 are complete for the
   pure-GPU ring path, with clod-poc-specific shadow-caster work explicitly N/A because the
   app has no real-time shadow-map pass.
