# Vegetation Grammar + Mesh-Grower Port Plan

Porting the `fable5-world-demo` procedural vegetation system into clod-poc:
the full **growth grammar** (parametric branching skeleton) and the
**mesh-grower + leaf/needle assembly** (real folded leaf strips and needle
sprays instead of flat alpha cards).

Reference root: [`docs/reference/fable5-world-demo/src/vegetation/`](../reference/fable5-world-demo/src/vegetation/)
Related status: [`clod-poc-trees-parity-status.md`](clod-poc-trees-parity-status.md)

---

## 1. Why / goal

clod-poc currently has two distinct, simpler systems:

- **Trees** ([`tree_morphology.ts`](../../tools/clod-poc/src/trees/tree_morphology.ts)) — hand-rolled
  branch nodes + flat leaf cards, deterministic via `treeHash2`, fed into a
  pure-GPU instanced ring path.
- **Understory** ([`understory_geometry.ts`](../../tools/clod-poc/src/understory/understory_geometry.ts)) —
  was flat cross-cards; **now** uses real leaf/needle assembly (Stage 1, done).

The reference produces far richer geometry: a SpeedTree-style recursive growth
grammar drives bark tubes (parallel-transport generalized cylinders) and anchors
thousands of **real** leaf/needle meshes, optionally captured into per-species
atlases for distant LODs. The goal is to bring that fidelity to clod-poc while
keeping everything **CPU-deterministic**, within vertex budgets, and compatible
with the existing TSL node materials and GPU instancing.

---

## 2. Reference architecture map

Dependency order (leaves → roots):

| File | Responsibility | Hard deps |
|---|---|---|
| `core/Seed.ts` | `Rng` (sfc32) `.float()/.int()/.chance()/.fork()`; string-keyed stream derivation | — |
| `VegTypes.ts` | Type bundle: `SpeciesParams`, `LevelParams`, `FoliageParams`, `LeafShapeParams`, `SkelBranch`, `LeafAnchor`, `Skeleton`, `GrowthInstance`, `CrownShape` | — |
| `TubeMesh.ts` | `MeshGrower` (indexed buffer accumulator + `bendNormals`/`crownAO`); `tubeForBranch`/`tubesForSkeleton` (generalized cylinders, root flare, jagged caps) | VegTypes, Rng |
| `LeafMesh.ts` | `buildLeaf`, `buildNeedleSpray`, `buildLeafCluster`, `buildSprayAt` (real foliage at anchors) | TubeMesh, VegTypes, Rng |
| `Skeleton.ts` | `growSkeleton(sp, rng, inst)` → branching grammar (tropisms, wander, droop, phyllotaxis, crown envelope, asymmetry) → branches + leaf anchors | VegTypes, Rng |
| `Species.ts` | Species presets (spruce, beech, …) — pure parameter bundles | VegTypes |
| `FoliageCards.ts` | Capture rig: render real twig tiles → per-species 2×2 atlas; place alpha-tested cards at anchors (the "ez-tree" look) | LeafMesh, TubeMesh, **WebGPU Renderer** |
| `TreeBuilder.ts` | `buildTree(sp, rng, opts)` → `BuiltTree {bark, foliage(cards), foliageMesh(real), skeleton, stats}`; LOD 0/1/2, `foliageMode` cards/mesh/hybrid, hero diet | Skeleton, TubeMesh, LeafMesh, FoliageCards |
| `Understory.ts` | `buildShrub` (multi-stem `buildTree` merge), `buildFern`, `buildFlower` | TreeBuilder, FoliageCards, LeafMesh |
| `VegLibrary.ts` | Orchestration: pools, atlases, impostors per species | all of the above |

The **vdata** vec4 (`x` hue jitter, `y` sway flex, `z` sway phase, `w` baked AO)
threads through every grower call and is consumed by the reference's
`VegMaterials`.

---

## 3. clod-poc target architecture + key decisions

### 3.1 Attribute mapping (reference vdata → clod-poc)

clod-poc keeps per-vertex `position`/`normal`/`color`/`uv` plus
`understoryWindWeight` (or `treeWind*`) and a class/kind mask; **phase** and
**worldXZ** are per-*instance* attributes set by the systems. So the vdata vec4
does **not** survive as an attribute — it must be folded at build time:

| Reference vdata | clod-poc |
|---|---|
| `x` hue jitter | fold into vertex `color` (lerp dark↔light + small jitter) |
| `y` sway flex | `understoryWindWeight` / `treeWindWeight` (per-vertex) |
| `z` sway phase | **drop** — instance attribute (`understoryWindPhase`) provides it |
| `w` baked AO | multiply into vertex `color` brightness |

This is exactly what Stage 1 already did. The full port should keep this
convention: growers take an explicit base `THREE.Color` + `flex` and write
clod-poc attributes directly, rather than carrying a vec4.

### 3.2 Determinism / RNG

Reference uses sfc32 `Rng` with `.fork(key)` for decorrelated streams. clod-poc
uses counter-free spatial hashes (`treeHash2`, `understoryHash2`). **Decision:**
add a small **counter-based deterministic Rng** wrapping the existing hash (done
for understory in `makeRng`). For the tree grammar we need `.fork()` semantics —
port a minimal sfc32 `Rng` class (or seed sub-streams via `hashCombine`) so
sibling branches decorrelate without sequence coupling. Keep one canonical RNG
module reused by trees + understory.

### 3.3 The big conflict: existing clod-poc tree system

`tree_morphology.ts` + the pure-GPU ring path already render trees. The
reference `buildTree`/grammar is a **different, richer** producer. Options:

- **(A) Coexist** — grammar feeds a new "hero/near" geometry only; keep
  `tree_morphology` for mid/far/impostor. Lowest risk, some duplication.
- **(B) Replace** — grammar becomes the single source; `tree_morphology` retires;
  LOD via `buildTree` lod 0/1/2 + impostor. Cleaner long-term, larger blast radius
  (touches `tree_geometry`, `tree_system`, impostor baker, tests).

**DECISION (confirmed): (B) Replace.** The grammar becomes the single tree
geometry producer; `tree_morphology.ts` retires.

**Replacement strategy — preserve the attribute contract, swap the producer:**
The seam is `createTreeGeometry(species, lod, settings) → BufferGeometry`. Its
output attributes (`position`, `normal`, `color`, `uv`, `treeWind` vec2 =
[windWeight, flutter], `treeFoliageMask`) are consumed by `tree_system.ts`, the
TSL node material, GPU instancing, and the impostor baker. Keep those attributes
so the system/instancing/impostor seams keep working; rewrite only the *internals*
of `createTreeGeometry` to grow a skeleton → bark tubes + **real** leaf/needle
foliage.

**Material consequence (retire the foliage atlas):** the current node material
treats `treeFoliageMask = 1` verts as **atlas alpha-cut cards**
(`opacity = mix(1, atlas.w, foliageMask·useFoliageAlpha)`, `material.alphaTest =
foliage.alphaTest`). Real-mesh foliage carries its leaf shape in geometry, not in
an atlas cutout. So in the replaced world:

- `treeFoliageMask` keeps selecting **bark (triplanar) vs leaf (albedo +
  translucency) lighting**, but no longer drives opacity.
- Foliage opacity = 1, `alphaTest = 0`; the foliage atlas + `tree_alpha_mask`
  cutout machinery becomes **dead and is removed**.
- Impostors re-bake from the real geometry (baker already renders the geometry),
  so octahedral impostors still work.

This gates Stages 4–7. The atlas retirement + foliage-card config + dependent
tests are part of Stage 7's blast radius.

### 3.4 No-atlas vs capture atlas

`FoliageCards.ts` needs a live WebGPU `Renderer` to bake atlases. clod-poc's
understory/tree node materials currently use **vertex-color real meshes** (no
atlas). **Decision:** treat the capture/atlas path (Stage 5) as **optional /
deferred** — only needed if we want card-LOD + impostors matching the reference.
The grammar + real-mesh foliage (Stages 2–4) deliver the near-field win without
it.

---

## Implementation status (live)

- **Stage 0 ✅** — `src/veg/veg_rng.ts` (sfc32 Rng + `.fork`), `veg_types.ts`. Tests: `veg_rng.test.ts`.
- **Stage 1 ✅** — understory leaf/needle assembly (`understory_geometry.ts`).
- **Stage 2 ✅** — `veg_mesh_grower.ts` (clod-poc attribute model + bendNormals/crownAO), `veg_tube_mesh.ts`. Tests: `veg_tube_mesh.test.ts`.
- **Stage 3 ✅** — `veg_skeleton.ts` (`growSkeleton`). Tests: `veg_skeleton.test.ts`.
- **Stage 4 ✅** — `veg_leaf_mesh.ts` + `veg_tree_builder.ts` (`buildTree`, mesh-only foliage). Tests: `veg_tree_builder.test.ts`.
- **Stage 6 ✅** — `veg_species.ts` (oak/pine/dead lean presets + bark colours).
- **Stage 7 ✅ (logic)** — budgets raised (`tree_config.ts` + `config/trees.yaml`: near 30k / mid 13k / far 6.5k); `tree_geometry.ts` `createTreeGeometry` grows near/mid/far via the grammar (impostor LOD unchanged); **foliage atlas alpha-cut retired** in both `tree_node_material.ts` (WebGPU) and `tree_material.ts` (WebGL) — foliage is opaque vertex-colour real meshes. All 435 clod-poc tests pass; typecheck + `vite build` clean.
- **Stage 5 ⏸️** — capture atlas / card LOD: deferred (impostor baker re-bakes the real meshes; no atlas needed near-field).

**Measured vertex counts** (`vegRng(42)`): oak 3703/1618/814, pine 26050/11516/5716, dead 289/184/103 (near/mid/far).

**Follow-ups / not yet done:**
- ⚠️ **Browser + WebGPU visual QA and a perf bench have NOT been run** (no WebGPU browser in this env). Trees are unverified in-app: confirm foliage renders lit (not black), LOD transitions, impostor bake looks right, and run the clod-poc QA harness with a captured summary + a frame-time bench before trusting the look/cost (budgets were raised → trees are heavier).
- Dead code to remove once verified: the foliage-atlas plumbing in `tree_node_material.ts` (now unused), `tree_alpha_mask.ts`, and `tree_morphology.ts` (no longer used by geometry; still re-exported from `trees/index.ts`).
- `treeGeometryKey` still hashes `foliage`/`morphology` settings the grammar ignores → harmless redundant rebuilds; simplify to seed + species dims.
- Per-species size reconciliation uses `targetTreeHeight()` scaling; eyeball against terrain scale during QA.

---

## 4. Stages

Each task lists a **verify** check. Run `npm --prefix tools/clod-poc run typecheck`
(rtk OK) and `npm --prefix tools/clod-poc test` (**no rtk**) after every stage.

### Stage 0 — Foundations  *(prereq for the grammar)*

- **0.1** Port a minimal deterministic `Rng` (sfc32 from `core/Seed.ts`) with
  `.float()`, `.int(n)`, `.chance(p)`, `.fork(key)` into a shared
  `src/veg/veg_rng.ts` (or reuse `understory_hash` + `hashCombine` for forks).
  *Verify:* unit test — same seed ⇒ identical sequence; `.fork('a')` ≠ `.fork('b')`.
- **0.2** Port `VegTypes.ts` → `src/veg/veg_types.ts` (types only).
  *Verify:* typecheck.
- **0.3** Decide RNG ownership (shared module) and attribute convention (§3.1)
  in code comments.
  *Verify:* review.

### Stage 1 — Leaf / needle assembly  ✅ DONE (understory)

Ported into [`understory_geometry.ts`](../../tools/clod-poc/src/understory/understory_geometry.ts):
`addLeaf` (folded/curled 4-row strip), `addNeedleSpray` (drooping stem + comb
needles), `addLeafCluster` (fanned leaves), and a real daisy `appendFlower`.
shrub/fern/sapling assembled from stems + real foliage. AO/hue folded into
vertex color; flex → `understoryWindWeight`; counter-based `makeRng`.

- *Verified:* typecheck clean; all 15 understory tests pass; within vertex
  budgets (shrub 500 / fern 500 / sapling 800 / flower 300).
- **Follow-up 1.1:** extract the leaf/needle primitives into a shared
  `src/veg/leaf_mesh.ts` so trees can reuse them (currently private methods on
  the understory `GeometryBuilder`). *Verify:* understory tests still green after
  extraction.

### Stage 2 — MeshGrower (full)

- **2.1** Port `MeshGrower` → `src/veg/mesh_grower.ts`: `vertex/tri/quad`,
  `bendNormals(center,radius,k)`, `crownAO(center,radius,strength)`, `build()`.
  Adapt to clod-poc attributes (color/windWeight/mask, no vdata vec4).
  *Verify:* unit test — `bendNormals` pushes normals toward the sphere; `crownAO`
  darkens interior verts; `build()` emits the expected attributes + 16/32-bit index.
- **2.2** Port `tubeForBranch` + `tubesForSkeleton` + `ringsForLevel` (parallel-
  transport frames, taper, root flare, jagged/broken caps).
  *Verify:* unit test — a straight branch yields a closed tube (manifold-ish:
  vert/tri counts match ring math); winding faces outward.

### Stage 3 — Growth grammar (Skeleton)

- **3.1** Port `crownEnvelope` + `perpBasis` helpers.
- **3.2** Port `growBranch` recursion: tropism (gravity/light), wander stream,
  cantilever droop + tip curl, trunk lean, taper, broken-top.
  *Verify:* unit test — trunk grows ~`height`; branch count finite (budget guard);
  deterministic per seed.
- **3.3** Port child spawning: whorl vs spiral (golden-angle) phyllotaxis,
  planar two-sided distribution, crown envelope × asymmetry length shaping.
- **3.4** Port foliage-anchor placement: anchors only at `foliage.anchorLevel`
  on non-broken branches; `z→out` quaternion + twist-to-up + droop.
  *Verify:* unit test — anchors lie on anchor-level branches; counts scale with
  `spacing`; `Skeleton` reports finite `crownCenterY`/`crownRadius`.

### Stage 4 — TreeBuilder integration

> Gated by the §3.3 coexist-vs-replace decision (confirm with user first).

- **4.1** Port `buildTree`: grow skeleton → `tubesForSkeleton` (bark) +
  real-mesh foliage (`buildLeafCluster`/`buildSprayAt` at anchors) →
  `{bark, foliageMesh, skeleton, stats}`. Start **mesh-only** (skip cards).
  *Verify:* unit test — returns non-empty bark + foliage geometry; tri stats > 0;
  honors LOD level cuts (`maxLevel`, `branchStride`, `lodK`).
- **4.2** Apply `bendNormals` + `crownAO` to foliage using skeleton crown bounds.
- **4.3** Wire LOD 0/1/2 (tube level cuts + foliage anchor stride). Hero diet
  optional.
  *Verify:* vert/tri budget table per LOD documented + asserted in tests.

### Stage 5 — Foliage cards / capture atlas  *(optional / deferred)*

- **5.1** Port `buildTwigTile` + the capture rig (`FoliageCards.ts`) onto a
  WebGPU `Renderer` (sqrt-encoded albedo, CPU background dilation).
- **5.2** Port `buildFoliageCards` (place alpha-tested cluster cards at anchors,
  `lying`/`cross` modes).
- **5.3** Hook card LOD into `buildTree` (`foliageMode: 'cards'|'hybrid'`).
  *Verify:* atlas renders without dark halos; card path matches mesh silhouette;
  **must run in a native browser/WebGPU context, not vitest.**

### Stage 6 — Species presets

- **6.1** Port `Species.ts` presets (spruce, beech, conifer/broadleaf set, snag,
  cliff tree) → clod-poc `veg_species.ts`, mapping foliage colors to existing
  palettes.
- **6.2** Reconcile with `tree_species.ts` (oak/pine/dead) — map or extend.
  *Verify:* each species builds within budget; visual spot-check list recorded.

### Stage 7 — System wiring + GPU instancing

- **7.1** Feed grammar geometry into the tree ring path / instanced meshes
  (`tree_system.ts`), preserving per-instance `treeWorldXZ`/phase attributes and
  the TSL node material (lit vertex color + sway). Honor
  [[grass-props-gpu-driven]] (no per-frame CPU scatter).
- **7.2** Hydrology compliance: snap/drop vs `waterSurfaceTexture` like grass/
  stones ([[hydrology-terrain-field-linkage]]).
- **7.3** Shrub/understory: optionally replace the simple-stem shrub with a
  grammar-grown multi-stem (`buildShrub` analog) once Stage 4 lands.
  *Verify:* clod-poc QA harness + bench scene; no floating/black vegetation.

### Stage 8 — Tests, budgets, QA (continuous)

- **8.1** Determinism tests for every new builder (seed ⇒ identical buffers).
- **8.2** Vertex/tri budget asserts per class/species/LOD.
- **8.3** `npm run typecheck` (rtk OK), `npm test` (no rtk), `npm run build`
  (no rtk), `npm run qa` for browser visual/perf. Trees/foliage are perf-
  sensitive — capture before/after counts.

---

## 5. Risks / open questions

1. **Coexist vs replace** the existing tree system (§3.3) — confirm before Stage 4.
2. **RNG fork semantics** — counter hash vs ported sfc32; pick one canonical
   module (Stage 0).
3. **Atlas/impostor LOD** (Stage 5) needs WebGPU + can't be vitest-verified;
   may stay deferred if real-mesh + existing impostor baker suffice.
4. **Vertex budgets** — the grammar can emit huge meshes; LOD cuts + anchor
   stride (Stage 4.3) are mandatory, not optional.
5. **Black-under-WebGPU** — any new material must be a TSL node material, never
   `onBeforeCompile`/`ShaderMaterial` ([[webgpu-classic-material-renders-black]]).
6. **No visual benches from WSL**; run native Windows for QA/screenshots.
