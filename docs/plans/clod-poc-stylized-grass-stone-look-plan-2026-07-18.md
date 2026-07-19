# clod-poc Stylized Grass & Stone Look Plan

Created: 2026-07-18
Status: **IN PROGRESS — Phase 0 + G1–G5 code landed; G6 implemented in draft PR #219; G1–G6 visual/perf verification pending**
Reference: https://github.com/cortiz2894/stylized-components (GrassField system analysis)

## Current position

| Phase | Code | Verification |
|---|---|---|
| Phase 0 — baselines | Done | Done |
| G1 — shared grass albedo | Done | A/B shots + perf confirmation open |
| G2 — whole-blade shading normal | Done | Depth-prepass parity + A/B shots open |
| G3 — coherent directional wind | Done | Depth-prepass parity + animation/perf verification open |
| G4 — dry/lush patches | Done | A/B shots + dispatch timing open |
| G5 — stone dirt/trampling | Done, merged by PR #190 | Canonical stone shot + two-run perf A/B open |
| G6 — per-blade sun-light | Implemented in draft PR #219 | Typecheck/test/build + forest-edge visual/perf open |
| S1 — stylized stone preset | Optional | Decision after G5 visual acceptance |

## Goal

Close the visual gap between our grass/stone rendering and the reference's
"furry, fully covered meadow with grounded stones" look, by porting the
*techniques* (not code — theirs is GLSL/`onBeforeCompile`/R3F on a small GLB
scene; ours is TSL/WebGPU on an infinite streaming ring). Every phase is
independently shippable, measured with the shot + perf harnesses, and logged in
the Progress Log at the bottom of this file after every commit-sized chunk.

## Findings that drive this plan

Analysis of the reference (grassField README, `grassBlade.ts` shader,
`scatter.ts`, `groundMask.ts`, `bladeMaterial.ts`):

1. **Ground↔blade color unification** — ground material and blade bases share
   one uniform bag (`uGrassBottom` …) so soil and blade roots resolve to
   *identical* colors. The ground literally is grass-colored; blades are fur on
   top. Any density reads as full coverage.
2. **Whole-blade fake normal** — shading normal forced to ground-up for the
   entire blade; the true facing normal (`vBladeN`) is kept separately and used
   *only* for backlit translucency. Field shades like one continuous soft
   surface: no per-blade light/dark faces, no rotation shimmer.
3. **Coherent directional wind** — world-space wind direction (primary wave +
   2.6× harmonic + perpendicular turbulence) transformed into blade-local space
   so all blades lean together; gust waves visibly roll across the field.
4. **Spatially coherent dry/lush patches** — large-scale FBM sampled at blade
   base (`vPatch`) drives dryness in multi-meter regions; same noise drifts the
   ground color.
5. **Shared dirt/trampling field** — one `groundDirt()` function evaluated
   identically in ground/blade/flower shaders: ground paints soil, blades
   shrink + tint, flowers cull. Rocks press blades flat and splay them sideways
   (smoothstep falloff). This interaction is most of why their stones sit well.
6. **Per-blade constant shadow sample** — shadow sampled once per blade
   (constant across it) so blades are never half-lit.
7. **Their stones are hand-modeled GLBs** — no procedural rock tech to port.
   Our `rock_builder.ts` is more advanced; the gap is shading style + grounding.

Current-state mismatches found in our code at plan creation:

- Blade base `vec3(0.018, 0.055, 0.012)` vs terrain grass `vec3(0.20, 0.27,
  0.18)` / meadow `vec3(0.18, 0.34, 0.12)` — bases ~10× darker than the ground
  they stand on (`src/gpu/grass_node_material.ts:158`,
  `src/terrain/far_clipmap/far_clipmap_material.ts:119,356`).
- Terrain-normal pull only 0.35 and only at blade tips
  (`grass_node_material.ts:194`).
- Wind added in blade-local space *before* per-instance yaw, so each blade's
  push direction is randomized by its rotation — the exact "blades fan outward"
  failure the reference README warns about (`grass_node_material.ts:136-156`).
- `color_mix` is a per-cell white-noise hash — speckle, not regions
  (`src/gpu/shaders/grass_ring.compute.wgsl:295`).
- Grass near stones is binary-deleted (`src/ecology/dressing/grass_suppression.ts`)
  → bald rings, no bend/flatten, no ground tint.
- Grass samples no occlusion: blades under forest canopy are as bright as open
  meadow. `out_offset.w` is currently written as constant `1.0`
  (`grass_ring.compute.wgsl:298`) — a free per-instance channel.

## File map (ours)

| Area | Files |
|---|---|
| Grass material (TSL) | `tools/clod-poc/src/gpu/grass_node_material.ts` |
| Grass ring compute | `tools/clod-poc/src/gpu/shaders/grass_ring.compute.wgsl`, `src/gpu/grass_ring_compute.ts`, `grass_ring_compute_resources.ts` |
| Grass config/system | `tools/clod-poc/src/grass/*` (`grass_config*`, `grass_system.ts`, `grass_geometry_primitives.ts`) |
| Grass controller/UI | `tools/clod-poc/src/runtime/vegetation/grass_controller.ts`, `src/ui/gui/vegetation_gui.ts` |
| Terrain colors | `tools/clod-poc/src/terrain/far_clipmap/far_clipmap_material.ts` (+ near terrain material) |
| Suppression/contact field | `tools/clod-poc/src/ecology/dressing/grass_suppression.ts`, `src/grass/grass_contact_patches.ts` |
| Stones | `tools/clod-poc/src/stones/*`, `src/gpu/stone_node_material.ts`, `src/gpu/stone_contact_patch_wgsl_transform.ts` |
| Sun-light cache | `src/forest_lighting/*`, `src/runtime/forest_lighting/*`, far sun visibility cache docs |

## Verification protocol (applies to every phase)

Checks (per repo CLAUDE.md):

```powershell
npm --prefix tools/clod-poc run typecheck   # rtk OK
npm --prefix tools/clod-poc test            # NO rtk
npm --prefix tools/clod-poc run build       # NO rtk
```

Visual A/B — deterministic shot harness, same seed/pose before vs after
(server: `npm --prefix tools/clod-poc run dev -- --host 127.0.0.1`):

```powershell
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run shoot -- --scene <scene> --seed 1 --freeze 1 --hud 1 --framealign 0 --out shots/grass-look/<phase>-<case>.png --stats shots/grass-look/<phase>-<case>-stats.json"
```

Perf A/B — perf harness, **2+ samples per side** (frame p50 variance ±1 ms),
same world/warmup/frames. NOTE: `perf:main --world 8` shows zero vegetation
counters; for veg-visible numbers use the islands scene with a `setPose` probe
and `gpuReadbacks=acceptance`. Do not edit `src/` while a perf run is active.
Report `frameMs` p50/p95, `renderMs` p95, and grass counters (visible blades,
tier distribution) in the Progress Log. No perf claim without harness numbers.

Baseline shots + perf runs are captured once in Phase 0 and reused by all
phases; re-capture only if an unrelated change lands on main mid-stream.

---

## Phase 0 — Baselines

**Goal:** frozen before-state so every later phase has an A/B anchor.

- [x] Pick and record 3 canonical poses (open meadow near, meadow with stones,
      forest-edge grass) via `__drusnielClod.setPose` / `getPose`; store poses
      in this file.
- [x] Capture baseline shots + stats JSON for the 3 poses (paths under
      `shots/grass-look/baseline-*`).
- [x] Capture perf baseline: 2 runs, islands scene, veg-visible pose,
      `gpuReadbacks=acceptance`. Record p50/p95 + grass counters below.
- [x] Note current grass settings used (density/spacing, distance, maxBlades).

**Acceptance:** paths + numbers recorded in Progress Log.

## Phase G1 — Shared grass albedo (ground↔blade unification)

**Impact: highest. Cost: color plumbing only.**

**Goal:** blade bases and the terrain's grass/meadow color resolve to the same
color so gaps between blades stop reading as a different-colored floor.

- [x] Introduce a shared grass palette (base/mid/tip + dry) as uniforms in one
      place (grass config → lighting-style handle), replacing the hardcoded
      `vec3`s in `grass_node_material.ts` (both patchV2 and legacy branches).
- [x] Feed the *same* base color into the terrain materials' grass/meadow
      constants (far clipmap `grass`/`meadowColor`; find and wire the near
      terrain material's equivalent).
- [x] Blade base color = terrain grass color exactly; mid/tip stay independent
      (slightly brighter/yellower per reference gradient design).
- [x] Stone moss tint (`rock_builder` moss channel → `stone_node_material`)
      pulls toward the same shared base color (weld stones into the meadow).
- [x] GUI: expose the shared base color + tip color in vegetation GUI as live
      uniforms (no rebuild).
- [ ] Verify: A/B shots on all 3 poses; grass coverage should read continuous.
      Typecheck/test/build green. Perf: no measurable change expected — confirm
      with 1 run.

**Acceptance:** in the meadow pose, ground between blades is not
distinguishable by color from blade roots at gameplay camera height.

**Risk:** global look change — terrain color shifts everywhere grass grows.
Keep old colors as a config fallback for quick visual revert.

## Phase G2 — Whole-blade shading normal (furry carpet)

**Goal:** shade every blade with the terrain normal; keep the true blade
normal only for the transmission term (mirrors reference `vBladeN` design).

- [x] In `grass_node_material.ts`: raise terrain-normal pull to ~1.0 over the
      whole blade (uniform `uNormalPull`, default 1.0, live-tunable for A/B).
- [x] Keep `bladeNormal` (true facing) as a separate node; use it only in the
      `transmission`/`back` term and (if needed) a subtle edge darkening.
- [ ] Check interaction with alpha-to-coverage and the depth prepass tiers
      (no shading change should affect masks, but verify prepass parity).
- [ ] Verify: A/B shots; look for elimination of per-blade dark/bright facets
      and rotation shimmer during small camera moves (2-frame settle compare).

**Acceptance:** meadow reads as a soft continuous surface; no shimmer bands.

**Risk:** field may look *too* flat; that's why `uNormalPull` stays a uniform —
final value is an art call (reference uses 1.0).

## Phase G3 — Coherent directional wind

**Goal:** one world-space wind direction with harmonics; all blades lean
together; gust waves travel across the field.

- [x] Add `uWindDir` (vec2, normalized) to grass config + material + GUI.
- [x] Build wind displacement in world space: primary sine along `uWindDir`,
      second harmonic at ~2.6× freq, perpendicular turbulence term (reference
      recipe); keep our existing gust field as amplitude modulation.
- [x] Counter-rotate the wind vector by `aRotY` before adding to local X/Z
      (equivalent of reference's `transpose(instRot)` fix) so lean direction is
      world-consistent despite per-blade yaw.
- [x] Keep amplitude ∝ `uvY²` base-pinning (already correct).
- [ ] If the depth prepass encodes wind, share the same formulation to avoid
      shadow/mask desync (reference caveat).
- [ ] Verify: short animated capture (settle + N frames) at meadow pose —
      blades lean uniformly; typecheck/test; 1 perf run (ALU-only change).

**Acceptance:** visible traveling gust waves; no blades "fanning outward".

## Phase G4 — Spatially coherent dry/lush patches

**Goal:** dryness/color variation in multi-meter regions instead of per-blade
speckle.

- [x] In `grass_ring.compute.wgsl`: add a low-frequency FBM/noise term (reuse
      existing WGSL noise helpers) sampled at blade world XZ; combine with the
      existing hash so `color_mix = patch_term ⊕ small per-blade jitter`.
- [x] Expose patch scale (m) + strength in config/GUI (compute-side params;
      document that changes need a ring refresh, not a scene rebuild).
- [ ] Optional (stretch): drift the terrain grass color with the same noise for
      ground/blade patch agreement (reference does this; needs the shared
      palette from G1).
- [ ] Verify: A/B shots at meadow pose + one far pose (patches must survive
      tier transitions without banding at ring band edges).

**Acceptance:** distinct lush/dry regions visible at mid distance; no added
per-frame cost (compute path only, measure dispatch timing once).

## Phase G5 — Dirt + trampling around stones

**Goal:** stones sit in the meadow: grass presses down and splays around them
over a dirt-tinted contact ring, instead of a binary bald disc.

- [x] Extend `GrassSuppressionPatch` semantics: inner radius = suppress, outer
      band = trample, while preserving the legacy `radiusM` contract.
- [x] Keep stone contact authority GPU-resident. Select nearby accepted stones
      after movement-triggered scatter without CPU readback.
- [x] Rasterize the selected contacts into a fixed camera-centred GPU field so
      grass and terrain use one indexed sample instead of a 24–32-patch loop per
      vertex/fragment.
- [x] Press blades flat, splay them away from the contact, and tint blade roots
      toward the configured dirt color.
- [x] Apply the same near-field dirt footprint to the WebGPU terrain material;
      far clipmap intentionally skips this small-scale interaction.
- [x] Scale blade height before wind and derive wind amplitude from the reduced
      effective height so squashed blades cannot retain full wind displacement.
- [x] Add focused suppression/trample and WGSL/storage-binding contract tests.
- [ ] Verify: A/B shots at the `stones-shore` pose.
- [ ] Verify: populated-scene perf A/B, 2 runs per side, against the `< 0.3 ms`
      frame-p95 regression budget.
- [ ] Re-run and record final typecheck, full tests, and build on the merged G5
      implementation; PR #190 had no attached GitHub Actions run.

**Acceptance:** no bald color-discontinuous rings around stones; blades
visibly lean away at contact; frame p95 regression < 0.3 ms or the contact
field resolution/radius/cap must be reduced.

**Implementation note:** PR #190 replaced the originally planned TSL uniform
array loop with a GPU-rasterized contact field. This is the intended design:
stone authority remains GPU-only and material cost is one field lookup.

## Phase G6 — Per-blade sun-light term

**Goal:** grass under forest canopy darkens like everything else.

- [x] In the composed grass ring WGSL: sample the canonical forest-lighting
      field once per accepted blade at its base and write one visibility scalar
      into `out_offset.w`.
- [x] Derive direct-sun visibility from the existing packed `shadowProxy`
      channel. Do not create a second grass-only lighting field.
- [x] In `grass_node_material.ts`: multiply only the direct-sun contribution by
      the constant per-blade scalar. Hemisphere/ambient and transmission remain
      independent so canopy grass is darkened, not crushed to black.
- [x] Bind a GPU mirror of the canonical forest-lighting texture into the grass
      ring compute bind group. Cache-not-ready, disabled, or unavailable resolves
      to visibility `1.0`.
- [x] Keep the sample constant across each blade — no per-vertex or per-fragment
      forest-lighting lookup and no half-lit blades.
- [x] Bilinear-filter the coarse field in compute to prevent visible lighting
      blocks at the default 128-cell forest-lighting resolution.
- [x] Add focused tests for texture-channel interpretation, unavailable-cache
      fallback, WGSL binding composition, filtered sampling, and direct-sun-only
      material use.
- [ ] Run and record typecheck, full tests, and production build for PR #219.
- [ ] Verify: forest-edge A/B shot (grass darkens under canopy and remains bright
      in clearings); perf A/B on ring dispatch timing.

**Acceptance:** visible canopy darkening on grass; zero per-fragment cache cost;
dispatch-time regression negligible.

**Implementation note:** the canonical CPU-built forest-light field remains the
authority. Its packed primary bytes are mirrored to a 128×128 `rgba8unorm` GPU
texture only when the existing field rebuild publishes an update. Grass reads
`G = shadowProxy`; no readback and no duplicate field build are introduced.

## Phase S1 (optional, art direction) — Stylized stone shading preset

Not scheduled — decide after G1+G5 visual acceptance, since moss-albedo welding
(G1) and contact dirt (G5) may close most of the stone gap.

- [ ] Evaluate: "stylized" `rock_builder` preset (lower `macro`/`ridged`/
      `micro`, more cut rounding) + softer wrap ramp in `stone_node_material`.
- [ ] Only if the realism-vs-stylized direction is explicitly chosen — this
      changes the whole scene's art style, user call.

---

## Out of scope (recorded so we don't re-litigate)

- Reference's CPU area-weighted mesh scatter — irrelevant to our GPU ring.
- Their flower cross-billboards — we have understory flowers; revisit after G1.
- Their cel-shaded WaterFloor — separate track (we have our own water work).
- Copying any GLSL/R3F code — techniques only.

## Canonical grass-look scene (discovered during Phase 0)

Plain `scene=infinite-islands` boots **fail loud** at HEAD with
`InternalBorderNotWelded: L2:1,1` on the CPU worker mesher path (any seed/world
tried). Boots succeed with the acceptance streaming bundle (GPU root mesher).
All grass-look shots/perf runs use this URL parameter set on top of
`scene=infinite-islands&seed=1&world=16&hud=1`:

```text
farSummaryLayout=2&farClipmap=1&farClipmapMode=replace&webgpuSelection=1
liveBubbleBudget=4&liveBubbleGpuChunkBudget=16&liveBubbleMaxInflightChunks=128&liveBubbleColliderRadius=128
liveClodRootBudget=16&liveClodRootApplyBudget=4&liveClodRootMaxInflightBatches=1&liveClodRootMaxCached=512
liveClodRootMaxLevel=1&liveClodRootRadius=384&liveClodRootGpuMesher=1&liveClodRootGpuBatchSize=4
liveClodRootGpuMaxInflightBatches=2&liveClodRootGpuFallback=1&liveClodRootBoundsGuard=1
farClipmapInnerRadius=384&farClipmapOuterRadius=4096&farSummaryMaxTileBuildsPerFrame=4&farSummaryMaxBuildMsPerFrame=6
gpuReadbacks=acceptance   (for live grass counters in HUD)
```

Poses (freeze=0; teleports need streamed-roots convergence before capture or
the safety system lifts the camera):

- `grass-ground`: cam `2048,24,1728,2.65,-0.12,55` — forest-edge grass,
  ~1.5-5k blades visible.
- `overview`: cam `2048,96,2048,2.65,-0.43,55` — canonical acceptance view.
- `stones-shore`: cam `2048,25,1280,2.65,-0.45,55` — cobble shore.

Learned: grass blades are 4 cm wide — subpixel beyond ~30 m, so only
ground-level poses judge blade shading; `clodPerf=1` disables vegetation;
`freeze=1` at boot keeps the grass ring empty.

## Progress Log

*(update after every commit-sized chunk — sessions can die, disk is durable)*

- 2026-07-18: Plan created from reference-repo analysis + code audit. No
  implementation started.
- 2026-07-19 Phase 0 DONE: baselines under `tools/clod-poc/shots/grass-look/`
  (`baseline-overview.png`, `baseline-meadow-ground.png` = grass-ground pose,
  `baseline-stones-shore.png`, + stats JSONs). Perf baseline (scratchpad
  `perf-grass-pose.ts`, 240 warmup + 300 frames, grass-ground pose):
  run1 p50 19.3 / p95 32.9 ms, run2 p50 19.1 / p95 31.9 ms @ 1,501 visible
  blades (gpu n/m/f/s 386/955/160/0). Pre-existing findings to flag: broken
  plain infinite-islands boot (weld error), grass-ring HUD counter lags ~1
  probe behind after teleports.
- 2026-07-19 G1–G4 CODE: commit `ef5682fa5` — shared palette + terrain/stone
  moss weld, `uNormalPull`, world-space `uWindDir` wind, compute patch FBM +
  config/GUI. Visual/perf verify checkboxes remain open.
- 2026-07-19: Fixed stale clod-poc tests for hydrology Layout B packing, tree
  impostor async readback mocks, bake handoff expectations, TREE-9 WGSL compose,
  and GPU-ring failure fixtures. Typecheck and 4,192 tests were green before G5.
- 2026-07-19 G5 CODE MERGED: PR #190, merge commit
  `3f22eff432ab97f8972f888efc5768871d3fb51c`. Added the GPU-resident,
  rasterized stone/grass contact field, suppression/trample bands, blade
  shrink/flatten/splay, reduced-height wind, root dirt tint, and matching near
  terrain tint. Focused contract tests landed. Canonical visual shots, two-run
  perf A/B, and final full typecheck/test/build evidence remain open.
- 2026-07-19 G6 CODE IN DRAFT: PR #219. Reuses the canonical forest-lighting
  `shadowProxy` field through a small GPU mirror, samples it once per accepted
  blade with bilinear filtering, stores visibility in `out_offset.w`, and applies
  it only to direct sun. Focused contract tests are included. Full
  typecheck/test/build, forest-edge visual A/B, and dispatch perf evidence remain
  open; the PR stays draft until those gates are recorded.
