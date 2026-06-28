# clod-poc Trees → fable5 Parity Plan (JIRAs)

> Scope: **clod-poc first.** This plan brings clod-poc's tree pipeline to parity
> with the `docs/reference/fable5-world-demo` reference. The Bevy port of any of
> this is explicitly out of scope here and is tracked separately
> ([bevy-gpu-vegetation-port-plan.md](bevy-gpu-vegetation-port-plan.md),
> [bevy-per-cascade-shadow-caster-culling-plan.md](bevy-per-cascade-shadow-caster-culling-plan.md)).

## Motivation

The GPU tree ring is already at parity: [tree_ring.compute.wgsl](../../tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl)
does clustered-Poisson + ecology + frustum + terrain-ridge occlusion + 4 LOD
rings with dithered crossfade + atomic compact regions + indirect draws, never
touching the CPU — the same architecture as the reference's
[Scatter.ts](../../docs/reference/fable5-world-demo/src/gpu/passes/Scatter.ts) +
[Forests.ts](../../docs/reference/fable5-world-demo/src/vegetation/Forests.ts).

The remaining parity gaps, in priority order:

1. **Impostors / billboards are not real on the WebGPU path.** In the GPU ring,
   [`geometryForGpuRing`](../../tools/clod-poc/src/trees/tree_system.ts#L1285)
   returns the procedural impostor-*card* geometry, **not** a baked octahedral
   atlas. The baker [tree_impostor_baker.ts](../../tools/clod-poc/src/trees/tree_impostor_baker.ts)
   only supports **WebGL** render-target baking (`isWebGlRenderTargetRenderer`
   needs `getContext()`), so under WebGPURenderer it returns `supported:false`
   and no atlas is ever baked. The node impostor material
   [tree_impostor_material.ts](../../tools/clod-poc/src/trees/tree_impostor_material.ts)
   sets `colorNode = sample.xyz` — a single-frame unlit pick, **no relight, no
   view blend**. Reference: `IMPOSTOR_GRID = 8`, albedo+normal+depth atlases,
   runtime relight through captured normals, 4-tile bilinear view blend
   ([ImpostorRuntime.ts](../../docs/reference/fable5-world-demo/src/render/ImpostorRuntime.ts)).
2. **Tree shadow casters.** Reference culls casters **per CSM cascade** with
   fitted crown shadow-proxy ellipsoids + an impostor-band shadow fade.
   clod-poc only sets `castShadow` flags; there is no per-cascade caster cull or
   crown proxy ([tree_system.ts:1037](../../tools/clod-poc/src/trees/tree_system.ts#L1037)
   notes "no real-time shadow-map pass").
3. **Species count.** Ring WGSL is hard-coded to 3 species (`TREE_SPECIES_COUNT = 3u`);
   spec target is ≥6 with per-instance uniqueness.
4. **Hero near-tree fidelity.** Spec floor is ≥100k tris with real mesh leaves
   in the ≤26 m ring; clod-poc near trees are grammar-grown and unverified
   against that floor.

## Reference architecture (what we mirror)

| Concern | Reference file | clod-poc counterpart |
| --- | --- | --- |
| GPU placement+cull+indirect | `gpu/passes/Scatter.ts`, `vegetation/Forests.ts` | `gpu/shaders/tree_ring.compute.wgsl`, `gpu/tree_ring_compute.ts` ✅ |
| Octahedral atlas frames | `vegetation/Impostors.ts` (`IMPOSTOR_GRID=8`, albedo+normal+depth) | `trees/tree_impostor_octahedral.ts`, `trees/tree_impostor_baker.ts` (WebGL-only, 4×4) ⚠️ |
| Relit billboard draw | `render/ImpostorRuntime.ts` (relight + 4-tile blend) | `trees/tree_impostor_material.ts` (single-frame, unlit) ⚠️ |
| Per-cascade shadow casters | `vegetation/Forests.ts` (crown proxies) | none ⚠️ |
| Mid/far canopy field | `world/CanopyShell.ts` | `gpu/far_canopy_shell.ts` ✅ |

### Contract for the impostor work (read before EPIC A/B)

- Atlas encoding (match reference): **albedo** RGB sqrt-encoded + coverage in A;
  **normalDepth** = world-space normal (xyz, in the capture frame) + linear
  depth in A. Two RG…BA8 (or RGBA16F for normal) atlases, `grid×grid` tiles of
  `resolutionPx`, padding per `octFrames`.
- Runtime draw (match `ImpostorRuntime.ts`): camera-facing cylindrical
  billboard quad per instance; rotate `view = cameraPos - instancePos` into the
  instance capture frame by its yaw; map to hemi-octahedral cell; sample the
  **four** neighbouring tiles and blend bilinearly; sqrt-decode albedo; rotate
  the captured normal back by yaw and **relight** with the same sun+hemi model
  the near tree material uses. Depth parallax is **not** applied (reference D-4).
- The GPU ring's impostor group must draw this material over the **baked atlas
  geometry/material**, replacing the procedural card returned by
  `geometryForGpuRing`.

---

# EPIC A — WebGPU octahedral impostor bake

Goal: produce albedo + normal+depth octahedral atlases per species on the
**WebGPU** device, at boot, without hitching, so the perf path has real atlases.

## TREE-1 — WebGPU render-to-atlas baker
**Type:** Story · **Epic:** A · **Depends on:** —

**Description:** Add a WebGPU bake path alongside the WebGL one in
[tree_impostor_baker.ts](../../tools/clod-poc/src/trees/tree_impostor_baker.ts).
Detect a `WebGPURenderer` (it does **not** expose `getContext()` returning WebGL,
which is why the current guard rejects it) and bake each species by rendering the
`sourceLod` mesh into the atlas tiles with an orthographic camera per
`octFrames(grid, resolutionPx, padding)` frame, into a `RenderTarget` sized
`grid*resolutionPx`. Reuse the existing octahedral frame math in
[tree_impostor_octahedral.ts](../../tools/clod-poc/src/trees/tree_impostor_octahedral.ts).
Spread bakes across frames (`maxBakesPerFrame`) exactly like the WebGL path so
startup never hitches.

**Acceptance criteria:**
- [ ] Under WebGPURenderer, `bakeTreeImpostorAtlases` returns `supported:true`
      and a ready atlas per species (no `"renderer does not expose WebGL …"`).
- [ ] Bake is frame-spread; no single-frame stall >8 ms during boot bake
      (measured via the perf harness boot window).
- [ ] WebGL path is unchanged and still passes its existing test.
- [ ] `npm --prefix tools/clod-poc test` + `rtk npm --prefix tools/clod-poc run typecheck` green.

**AI execution prompt:**
```
Obey CLAUDE.md (clod-poc Web QA; never run vitest/vite through rtk). In tools/clod-poc/src/trees/tree_impostor_baker.ts add a WebGPU render-to-atlas bake path next to the WebGL one. Detect WebGPURenderer (it lacks a WebGL getContext, the reason the current guard rejects it). For each species, render geometries[species][settings.impostors.sourceLod] into a grid*resolutionPx RenderTarget, one orthographic view per octFrames() frame (reuse tree_impostor_octahedral.ts), spread across frames by impostors.maxBakesPerFrame so boot never hitches. Keep the WebGL path and its test intact. Add a unit test that the WebGPU branch reports supported:true with a ready atlas. Run npm --prefix tools/clod-poc test and rtk npm --prefix tools/clod-poc run typecheck.
```

## TREE-2 — Normal+depth atlas channel
**Type:** Task · **Epic:** A · **Depends on:** TREE-1

**Description:** Extend the baker to also emit a **normal+depth** atlas
(world-space normal in the capture frame in RGB, linear depth in A) in addition
to the sqrt-encoded albedo+coverage atlas. Reference layout:
[Impostors.ts](../../docs/reference/fable5-world-demo/src/vegetation/Impostors.ts).
This is the data the relight in TREE-5 consumes. Use a small MRT or a second
bake pass with a normal/depth-writing material.

**Acceptance criteria:**
- [ ] `TreeImpostorAtlas` carries `albedo` and `normalDepth` textures + the
      `radius`/`centerY` fit metadata the runtime billboard needs.
- [ ] Albedo is sqrt-encoded + coverage in A; normal atlas stores the capture-
      frame normal, A = linear depth.
- [ ] A decode round-trip unit test (encode→decode normal/albedo) is within tolerance.
- [ ] typecheck + test green.

**AI execution prompt:**
```
Obey CLAUDE.md. Extend the WebGPU impostor baker (TREE-1) to also bake a normal+depth atlas: RGB = world-space normal in the capture frame, A = linear depth, alongside the sqrt-encoded albedo+coverage atlas (mirror docs/reference/fable5-world-demo/src/vegetation/Impostors.ts). Add radius/centerY fit metadata to TreeImpostorAtlas. Add a normal/albedo encode→decode round-trip unit test. Keep WebGL fallback compiling. Run test + typecheck (typecheck may use rtk; test/vite must not).
```

## TREE-3 — Bake-config parity (grid 8, atlas size, enable on WebGPU)
**Type:** Task · **Epic:** A · **Depends on:** TREE-2

**Description:** Raise impostor config to reference parity in
[tree_config.ts](../../tools/clod-poc/src/trees/tree_config.ts): default
`octahedralGridSize` 4→**8**, choose `resolutionPx` so the atlas stays within a
sane VRAM budget (document the choice), and turn impostors **on by default** for
the WebGPU perf scene (currently `enabled:false`, `bakeOnStart:false`). Keep a
URL/UI toggle to disable.

**Acceptance criteria:**
- [ ] `octahedralGridSize: 8`; atlas VRAM budget documented in the config comment.
- [ ] Impostors enabled + `bakeOnStart` true on the WebGPU path; toggle still works.
- [ ] Config loader round-trip test updated and green.

**AI execution prompt:**
```
Obey CLAUDE.md. In tools/clod-poc/src/trees/tree_config.ts set impostors.octahedralGridSize to 8, pick resolutionPx within a documented VRAM budget, and enable impostors + bakeOnStart on the WebGPU path (keep a toggle). Update the config round-trip test. Run test + typecheck.
```

---

# EPIC B — Relit, view-blended billboard in the GPU ring

Goal: the ring's impostor group draws a real octahedral billboard that relights
and blends views, replacing the procedural card.

## TREE-4 — Wire baked atlas geometry into the GPU ring impostor group
**Type:** Story · **Epic:** B · **Depends on:** TREE-2

**Description:** Replace the Stage-3b shortcut in
[`geometryForGpuRing`](../../tools/clod-poc/src/trees/tree_system.ts#L1285) so the
**impostor** LOD uses the baked impostor billboard geometry + atlas material
(`createTreeBakedImpostorGeometry` / `createTreeImpostorNodeMaterial`) when an
atlas is ready, falling back to the procedural card only when no atlas exists.
The ring draw reads the per-instance `cell` storage buffer and re-derives
yaw/scale; the billboard must orient from `cameraPosition - worldPos` like the
CPU path's `axialBillboard`.

**Acceptance criteria:**
- [ ] With a ready atlas, the ring impostor group draws the baked billboard
      (not the card); shot harness shows oriented impostors at the impostor ring.
- [ ] No atlas → graceful fallback to the procedural card (no black, no crash).
- [ ] CPU/GPU ring count parity test still passes (`debugValidateAgainstCpu`).
- [ ] typecheck + test green.

**AI execution prompt:**
```
Obey CLAUDE.md. In tools/clod-poc/src/trees/tree_system.ts, change geometryForGpuRing so the "impostor" LOD uses the baked octahedral billboard geometry+atlas material when an atlas is ready (createTreeBakedImpostorGeometry / createTreeImpostorNodeMaterial), falling back to the procedural card otherwise. Orient the billboard from cameraPosition-worldPos in the ring material (match axialBillboard). Keep the GPU/CPU ring count parity validation passing. Verify with the shot harness (impostor ring oriented, no black). Run test + typecheck.
```

## TREE-5 — Relit, 4-tile-blended impostor TSL material
**Type:** Story · **Epic:** B · **Depends on:** TREE-2, TREE-4

**Description:** Rewrite [tree_impostor_material.ts](../../tools/clod-poc/src/trees/tree_impostor_material.ts)
`createTreeImpostorNodeMaterial` to mirror
[ImpostorRuntime.ts](../../docs/reference/fable5-world-demo/src/render/ImpostorRuntime.ts):
rotate the view dir into the capture frame by instance yaw → hemi-octahedral
cell → sample the **four** neighbouring tiles → bilinear blend; **sqrt-decode**
albedo; rotate the captured normal back by yaw and **relight** with the same
sun+hemispheric model the near tree node material uses (so impostors respond to
sun/GI like real geometry). Do not apply depth parallax (reference D-4). Keep it
a **TSL node material** (the classic `onBeforeCompile`/`MeshBasic` path renders
black under WebGPU — see project memory).

**Acceptance criteria:**
- [ ] Impostor crowns are lit (not flat/unlit); rotating the camera shows smooth
      view interpolation with **no tile pop**.
- [ ] Side-by-side shot: near-mesh tree vs impostor of the same species reads as
      the same tree under the same sun (color/shading match within tolerance).
- [ ] No silver/over-bright crowns at glancing sun (clamp specular like the ref).
- [ ] typecheck + test green; a WGSL/TSL unit test covers the oct-cell + blend math.

**AI execution prompt:**
```
Obey CLAUDE.md and project memory (impostor must be a TSL node material; classic onBeforeCompile/MeshBasic renders black on WebGPU). Rewrite createTreeImpostorNodeMaterial in tools/clod-poc/src/trees/tree_impostor_material.ts to mirror docs/reference/fable5-world-demo/src/render/ImpostorRuntime.ts: rotate view dir into the capture frame by instance yaw, pick the hemi-octahedral cell, sample the four neighbour tiles and bilinear-blend, sqrt-decode albedo, rotate the captured normal back by yaw and relight with the near-tree sun+hemi model. No depth parallax. Add a unit test for the oct-cell selection + 4-tile blend weights. Verify with shots: lit crowns, smooth view interpolation (no tile pop), near-vs-impostor species match. Run test + typecheck.
```

## TREE-6 — Impostor crossfade band continuity with far mesh
**Type:** Task · **Epic:** B · **Depends on:** TREE-5

**Description:** Ensure the far-mesh→impostor dither crossfade partitions pixels
(complementary dither, matched bands) so no holes/double-draw appear at the
boundary, mirroring the reference's matched in/out band rule. The ring already
emits `treeLodFade`; confirm the impostor material consumes it with the same
screen-door dither as the card LODs.

**Acceptance criteria:**
- [ ] No visible pop and no holes at the far→impostor boundary in a slow
      dolly-out shot; the transition is dithered.
- [ ] Frozen-frame shot at the boundary shows complementary dither (no overdraw
      doubling).
- [ ] typecheck + test green.

**AI execution prompt:**
```
Obey CLAUDE.md. Make the far-mesh→impostor crossfade in the tree GPU ring use complementary screen-door dither with matched bands (mirror the matched in/out-band rule in docs/reference/fable5-world-demo/src/vegetation/Forests.ts). Confirm the impostor TSL material consumes treeLodFade with the same dither as the card LODs. Verify with a slow dolly-out shot (no pop, no holes) and a frozen boundary shot (complementary dither). Run test + typecheck.
```

---

# EPIC C — Tree shadow casters (per-cascade + crown proxies)

Goal: trees cast correct shadows from a real-time sun, including off-screen and
ridge-hidden casters, without card raggedness or blob shadows.

## TREE-7 — Per-cascade caster cull in the ring compute
**Type:** Story · **Epic:** C · **Depends on:** —

**Description:** Extend [tree_ring.compute.wgsl](../../tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl)
+ [tree_ring_compute.ts](../../tools/clod-poc/src/gpu/tree_ring_compute.ts) to
append casters into per-(group,cascade) regions tested against each CSM cascade
ortho frustum (extra plane uniforms), **skipping** the camera frustum + terrain-
occlusion march for casters (an off-screen / ridge-hidden tree still casts).
Mirror the caster-group layout in
[Forests.ts](../../docs/reference/fable5-world-demo/src/vegetation/Forests.ts).
Coordinate with the existing realtime sun shadow pass
[realtime_sun_shadows.ts](../../tools/clod-poc/src/rendering/realtime_sun_shadows.ts).

**Acceptance criteria:**
- [ ] Caster instance lists are produced per cascade; indirect draw args written.
- [ ] Casters ignore camera frustum + occlusion (sun-behind-camera trees still
      cast into the visible scene); verified in a shot with low sun behind camera.
- [ ] GPU/CPU parity test extended to caster counts.
- [ ] typecheck + test green.

**AI execution prompt:**
```
Obey CLAUDE.md. Extend tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl and gpu/tree_ring_compute.ts to append shadow casters into per-(group,cascade) regions tested against each CSM cascade ortho frustum (new plane uniforms), skipping the camera frustum + terrain-occlusion march for casters (mirror docs/reference/fable5-world-demo/src/vegetation/Forests.ts). Wire to tools/clod-poc/src/rendering/realtime_sun_shadows.ts. Extend the CPU/GPU parity test to caster counts. Verify with a low-sun-behind-camera shot that off-screen trees still cast. Run test + typecheck.
```

## TREE-8 — Crown shadow-proxy ellipsoids for far casters
**Type:** Task · **Epic:** C · **Depends on:** TREE-7

**Description:** For the far/impostor caster band, draw fitted crown-proxy
ellipsoids (per-pool dims, species crown density) instead of card geometry, with
a world-anchored hash dither + crown-edge falloff and an impostor-band fade —
mirroring `crownProxyGeometry` / `proxyCasterMat` in
[Forests.ts](../../docs/reference/fable5-world-demo/src/vegetation/Forests.ts).
This restores bulk canopy occlusion (cards leak ~40% and PCSS flattens speckle)
and avoids blob shadows from class-max dims.

**Acceptance criteria:**
- [ ] Far tree shadows read as filled crowns with ragged edges (not hollow card
      speckle, not solid ovals); noon forest-interior shot shows dapple only at
      true crown gaps.
- [ ] Shadow field fades out across the impostor band (no hard shadow circle at
      the impostor ring boundary).
- [ ] typecheck + test green.

**AI execution prompt:**
```
Obey CLAUDE.md. For the far/impostor tree caster band, draw fitted crown-proxy ellipsoids (per-pool dims + species crown density, world-anchored hash dither, crown-edge falloff, impostor-band fade) instead of card geometry, mirroring crownProxyGeometry/proxyCasterMat in docs/reference/fable5-world-demo/src/vegetation/Forests.ts. Verify with a noon forest-interior shot (filled ragged crowns, dapple only at true gaps) and a boundary shot (shadow fades out, no hard circle). Run test + typecheck.
```

---

# EPIC D — Species & hero-tree fidelity

## TREE-9 — Expand ring species 3 → 6 with ecology selection
**Type:** Story · **Epic:** D · **Depends on:** —

**Description:** Raise `TREE_SPECIES_COUNT` 3→6 in
[tree_ring.compute.wgsl](../../tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl)
and add the 3 new species to [tree_species.ts](../../tools/clod-poc/src/trees/tree_species.ts)
+ the grammar in [veg/](../../tools/clod-poc/src/veg/), extending `select_species`
weighting (height band, moisture, slope health, clump, material bias) so each
species occupies a distinct niche. Per-instance uniqueness already comes from the
grammar growth seed — keep it.

**Acceptance criteria:**
- [ ] 6 species placed, each with a distinct ecological niche (gallery shot shows
      species sorted by altitude/moisture/slope, not random).
- [ ] Group buffers/caps and the indirect arg count updated for 6×4 groups.
- [ ] GPU/CPU parity test passes with 6 species.
- [ ] typecheck + test green.

**AI execution prompt:**
```
Obey CLAUDE.md. Raise TREE_SPECIES_COUNT to 6 in tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl, add 3 species to tree_species.ts + the veg/ grammar, and extend select_species weighting so each occupies a distinct niche (height/moisture/slope/clump/material). Update group buffers/caps and indirect arg counts for 6×4 groups. Keep per-instance grammar uniqueness. Extend the GPU/CPU parity test to 6 species. Verify with a gallery shot (ecology-sorted species). Run test + typecheck.
```

## TREE-10 — Hero near-tree triangle floor audit
**Type:** Task · **Epic:** D · **Depends on:** TREE-9

**Description:** Measure near-ring (≤ hero distance) tree triangle counts via the
shot stats and raise grammar/leaf detail until a hero forest shot meets the
spec's near-tree fidelity (real mesh leaves, no smooth low-poly silhouettes).
Document the achieved tris and the perf cost.

**Acceptance criteria:**
- [ ] Hero forest shot reports near-tree tris meeting the documented floor;
      silhouettes read as foliage, not low-poly.
- [ ] Perf harness shows the cost; no regression in frame p95 beyond the
      documented budget at the hero bookmark.
- [ ] Stats JSON + shot archived per CLAUDE.md "Reporting".

**AI execution prompt:**
```
Obey CLAUDE.md "Deterministic clod-poc Performance Process" and "Reporting". Capture near-ring tree triangle counts from shot stats at a hero forest bookmark; raise the veg/ grammar + leaf detail until near trees meet the spec fidelity floor (real mesh leaves, craggy silhouette). Run a baseline/after perf A/B (server first, same world/warmup/frames) and report frameMs p50/p95, renderMs p95, tris, and visible counts. Archive stats JSON + shot.
```

---

# EPIC E — Parity validation & perf gate

## TREE-11 — Impostor visual-honesty + perf parity gate
**Type:** Task · **Epic:** E · **Depends on:** TREE-5, TREE-6, TREE-8

**Description:** Add an acceptance test/QA scene that asserts impostor parity:
lit (not unlit), view-blended (no pop), species-matched to near mesh, shadows
filled. Run the deterministic perf A/B (CPU vs GPU ring with impostors on) and
gate on frame p95. Extend the existing acceptance suite
([src/acceptance/tests/visualHonesty.test.ts](../../tools/clod-poc/src/acceptance/tests/visualHonesty.test.ts)).

**Acceptance criteria:**
- [ ] Acceptance test fails if impostors render unlit, pop on rotation, or mismatch
      the near mesh species color beyond tolerance.
- [ ] Perf A/B archived: GPU-ring-with-impostors frame p95 ≤ the documented budget
      and materially better than the all-mesh case at distance.
- [ ] `npm --prefix tools/clod-poc test`, `run build`, and `run qa` green;
      results summarized per CLAUDE.md "Reporting".

**AI execution prompt:**
```
Obey CLAUDE.md (Web QA + Reporting; no rtk for vitest/vite/qa). Extend tools/clod-poc/src/acceptance/tests/visualHonesty.test.ts (or add a sibling) to assert impostor parity: lit crowns, no tile pop on rotation, near-vs-impostor species color match within tolerance, filled crown shadows. Run the deterministic perf A/B (server first; baseline all-mesh vs GPU ring impostors on, same world/warmup/frames) and gate frame p95 on a documented budget. Run test, build, and qa; archive artifacts and summarize scene + counters.
```

## TREE-12 — Update docs + parity status
**Type:** Task · **Epic:** E · **Depends on:** TREE-11

**Description:** Record the achieved parity (and any documented deviations, e.g.
no depth parallax, instance-granularity culling) in this plan + the clod-poc QA
notes, and update project memory `pure-gpu-trees-plan` / a new
`clod-poc-trees-parity` pointer.

**Acceptance criteria:**
- [ ] Parity table in this plan marked done/deviation per item with evidence
      links (shots, perf runs).
- [ ] Memory index updated.

**AI execution prompt:**
```
Update this plan's parity table with done/deviation status + evidence links (shots, perf-runs). Note deviations (no depth parallax; instance-granularity culling). Update the memory index pointer for clod-poc tree parity.
```

---

## Suggested order

1. EPIC A (TREE-1 → TREE-3) — real atlases on WebGPU (unblocks everything).
2. EPIC B (TREE-4 → TREE-6) — relit billboard in the ring (the headline gap).
3. EPIC E TREE-11 perf/visual gate (lock in the win before extending scope).
4. EPIC C (TREE-7 → TREE-8) — shadow casters.
5. EPIC D (TREE-9 → TREE-10) — species + hero fidelity.
6. TREE-12 — close out.

EPIC A+B+E-11 alone close the "ring in GPU + billboards" parity the original
question was about; C/D are the remaining spec-fidelity items.
```
