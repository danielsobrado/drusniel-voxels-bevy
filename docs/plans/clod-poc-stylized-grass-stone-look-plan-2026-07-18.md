# clod-poc Stylized Grass & Stone Look Plan

Created: 2026-07-18  
Completed: 2026-07-19  
Status: **COMPLETE — G1–G6 and S1 implemented and verified. Realistic remains the default; stylized and toon scene presets are selectable in the GUI.**

Reference: https://github.com/cortiz2894/stylized-components (`GrassField` system analysis)

## Current position

| Phase | Code | Verification |
|---|---|---|
| Phase 0 — baselines | Done | Done |
| G1 — shared grass albedo | Done | Done; terrain/moss weld verified, palette remains GUI-tunable |
| G2 — whole-blade shading normal | Done | Done; `uNormalPull` is live and final gates passed |
| G3 — coherent directional wind | Done | Done; direction and turbulence are live in the GUI |
| G4 — dry/lush patches | Done | Done; compute dispatch remained 0.0–0.1 ms |
| G5 — stone dirt/trampling | Done; PR #190 plus raster-dispatch correction | Done; visible GUI A/B and no measured regression |
| G6 — per-blade sun visibility | Done; PR #219 plus #223 | Done; visible GUI A/B and unchanged dispatch timing |
| S1 — stylized stone/scene presets | Done | Done; realistic, stylized, and toon compared in one boot |

## Goal

Close the visual gap between the CLOD-POC grass/stone rendering and the reference's furry, fully covered meadow with grounded stones.

The work ports techniques rather than source code. The reference is GLSL/React Three Fiber over a small GLB scene; CLOD-POC is TSL/WebGPU over an infinite streamed GPU ring.

## Techniques adopted

1. **Ground/blade color unification** — terrain grass, blade roots, and stone moss use one shared palette.
2. **Whole-blade fake normal** — the terrain normal shades the grass carpet; the true blade normal remains available for transmission.
3. **Coherent directional wind** — wind is built in world space and counter-rotated into blade-local space.
4. **Spatially coherent dry/lush patches** — low-frequency compute noise replaces per-blade color speckle.
5. **GPU-resident stone contact field** — stones suppress, flatten, splay, and dirt-tint nearby grass without CPU readback.
6. **Per-blade constant sun visibility** — one filtered forest-light sample is stored per accepted blade and affects direct sun only.
7. **Selectable style presets** — realistic remains byte-compatible with the previous default; stylized and toon are explicit art-direction options.

## Implementation map

| Area | Primary files |
|---|---|
| Grass material | `tools/clod-poc/src/gpu/grass_node_material.ts` |
| Grass ring compute | `tools/clod-poc/src/gpu/shaders/grass_ring.compute.wgsl`, `src/gpu/grass_ring_compute.ts` |
| Grass palette/config | `tools/clod-poc/src/grass/*` |
| Stone contact compute | `tools/clod-poc/src/gpu/stone_scatter_compute.ts`, `stone_contact_patch_wgsl_transform.ts` |
| Contact settings/material integration | `tools/clod-poc/src/grass/grass_contact_patches.ts` |
| Forest-light authority | `tools/clod-poc/src/forest_lighting/*` |
| Stone style presets | `tools/clod-poc/src/stones/stone_style.ts` |
| Scene-wide style presets | `tools/clod-poc/src/style/scene_style.ts` |
| GUI | `tools/clod-poc/src/ui/gui/vegetation_gui.ts` and scene-style GUI integration |

## Verification protocol

Repository checks:

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run build
```

Deterministic visual captures use the same scene, seed, pose, and settled streamed-root state. Performance comparisons use at least two samples per side and report frame p50/p95, render p95, grass counts, tier distribution, and compute dispatch timing.

## Phase 0 — Baselines

- [x] Record canonical grass-ground, overview, and stone-shore poses.
- [x] Capture baseline images and stats under `tools/clod-poc/shots/grass-look/`.
- [x] Capture two populated grass performance runs.
- [x] Record active grass settings and deterministic blade counts.

Baseline performance at the grass-ground pose:

- run 1: frame p50 19.3 ms, p95 32.9 ms;
- run 2: frame p50 19.1 ms, p95 31.9 ms;
- visible blades: 1,501;
- GPU tiers near/mid/far/super: 386/955/160/0.

## G1 — Shared grass albedo

- [x] Introduce one shared base/mid/tip/dry grass palette.
- [x] Feed the same base color into near and far terrain grass/meadow shading.
- [x] Match blade roots exactly to the terrain grass base.
- [x] Pull stone moss toward the same grass base.
- [x] Expose base, tip, and dry colors as live GUI settings.
- [x] Verify terrain/grass/moss color welding in deterministic captures.
- [x] Verify final typecheck/build gates and no measurable performance regression.

The close blade-level comparison remained constrained by the recorded pose/placement quirks. This does not block acceptance because the shared palette is directly wired and remains live-tunable in the GUI.

## G2 — Whole-blade shading normal

- [x] Apply terrain-normal pull across the complete blade.
- [x] Keep the true blade normal separate for backlit transmission.
- [x] Keep `uNormalPull` live-tunable, with 1.0 as the reference-style default.
- [x] Verify alpha-to-coverage/depth-prepass compatibility through the final gates.
- [x] Verify the completed material path without introducing mask or performance regressions.

## G3 — Coherent directional wind

- [x] Add normalized world-space wind direction.
- [x] Add primary wave, 2.6× harmonic, and perpendicular turbulence.
- [x] Counter-rotate displacement into blade-local space so blade yaw does not randomize lean direction.
- [x] Preserve `uvY²` base pinning.
- [x] Keep direction, turbulence, strength, and speed live in the GUI.
- [x] Verify the final animation/material gates and no meaningful performance regression.

## G4 — Spatially coherent dry/lush patches

- [x] Replace color speckle with low-frequency compute-side patch noise.
- [x] Keep a small per-blade jitter on top of the coherent patch value.
- [x] Expose patch scale and strength in config and GUI.
- [x] Verify patch behavior across the final visual evaluation.
- [x] Verify grass dispatch remained approximately 0.0–0.1 ms.
- [ ] Optional stretch: drive terrain grass color with exactly the same patch noise.

The terrain-noise stretch item is intentionally parked and is not required by the completed acceptance contract.

## G5 — Dirt and trampling around stones

- [x] Preserve legacy suppression radius semantics while adding inner suppress and outer trample bands.
- [x] Keep contact selection GPU-resident with no stone-position readback.
- [x] Rasterize selected contacts into one camera-centred field.
- [x] Sample that field from both grass and near terrain.
- [x] Shrink, flatten, and splay grass around eligible stones.
- [x] Tint blade roots and near terrain with the same dirt footprint.
- [x] Scale wind from the reduced effective blade height.
- [x] Create and dispatch `rasterize_contact_field` after `select_contact_patches`.
- [x] Limit contact selection to large and medium stones to avoid sub-cell cobble speckles at the 1 m field resolution.
- [x] Add focused suppression, WGSL, binding, and raster-dispatch contract tests.
- [x] Add live GUI controls for enable, flatten, splay, minimum height, dirt tint/color, and contact radii.
- [x] Verify the live contact field through GUI A/B: 1,247 sampled scene pixels changed, mean RGB delta 106.
- [x] Verify two populated performance runs with unchanged deterministic blade counts and no regression.
- [x] Verify typecheck and production build.

Final performance runs at the canonical grass pose:

- run 1: frame p50 8.4 ms, p95 15.0 ms;
- run 2: frame p50 7.0 ms, p95 13.4 ms;
- visible blades remained 1,501 with GPU tiers 386/955/160/0;
- grass dispatch remained 0.0–0.1 ms.

The improvement against the original baseline includes intervening `main` work and is not attributed to G5. The valid G5 conclusion is no measured regression.

## G6 — Per-blade sun visibility

- [x] Reuse the canonical forest-lighting field rather than creating a grass-only cache.
- [x] Mirror the existing packed field to a 128×128 `rgba8unorm` GPU texture only when the authority publishes an update.
- [x] Sample `G = shadowProxy` once per accepted blade.
- [x] Bilinear-filter the coarse field in compute; correction merged through PR #223.
- [x] Store visibility in `out_offset.w` as a constant across the blade.
- [x] Apply visibility only to direct sunlight.
- [x] Leave hemisphere light, ambient floor, and transmission independent.
- [x] Fail open to visibility 1.0 when the field is disabled or unavailable.
- [x] Add focused binding, filtering, fallback, packed-channel, and direct-sun-only tests.
- [x] Add a live canopy-shade-strength GUI control.
- [x] Verify GUI A/B: shade strength 1→0 changed 40 blade-scale pixels, mean RGB delta 167.
- [x] Verify typecheck/build and unchanged 0.0–0.1 ms grass dispatch timing.

The captured meadow pose contains little visible grass under the shadow proxy, so the pixel count is intentionally small. The A/B confirms that the per-blade value is live and controllable.

## S1 — Selectable stylized stone and scene presets

- [x] Implement `realistic`, `stylized`, and `toon` stone presets.
- [x] Keep `realistic` as the byte-compatible default geometry/shading path.
- [x] Add live wrap, grain, and albedo-flatten uniforms.
- [x] Add rebuild-time geometry softening for stylized silhouettes.
- [x] Add deterministic tests per style/seed/preset/detail.
- [x] Add a GUI preset selector.
- [x] Extend the selector to a homogeneous scene-wide style registry covering stones, trees, understory, grass, and water-material instances.
- [x] Verify stone preset captures in one boot:
  - realistic→stylized: 25,729 sampled scene pixels changed, mean RGB delta 42;
  - realistic→toon: 56,550 pixels changed, mean RGB delta 31.
- [x] Verify scene-wide captures in one boot:
  - realistic→stylized: 11,575 scene pixels changed, mean delta 64;
  - realistic→toon: 18,413 scene pixels changed, mean delta 68;
  - toon↔realistic close-up under trees: 218,140 pixels changed, mean delta 25.
- [x] Verify typecheck, production build, and stone tests 41/41.

## Canonical grass-look scene

Plain `scene=infinite-islands` historically failed loudly on the CPU worker path with `InternalBorderNotWelded: L2:1,1`. The completed visual/performance work therefore used the acceptance streaming bundle and GPU root mesher.

Canonical poses:

- `grass-ground`: `2048,24,1728,2.65,-0.12,55`;
- `overview`: `2048,96,2048,2.65,-0.43,55`;
- `stones-shore`: `2048,25,1280,2.65,-0.45,55`.

Important capture notes:

- grass blades are approximately 4 cm wide and become subpixel beyond roughly 30 m;
- `clodPerf=1` disables vegetation;
- `freeze=1` at boot leaves the grass ring empty;
- teleports require streamed-root convergence before capture or the safety system can lift the camera.

## Validation result

The closing G5/G6 run recorded:

- typecheck: passed;
- production build: passed;
- test suite: 4,377 passed and 4 failed;
- all four failures were pre-existing water-foam/biome-visual failures unrelated to grass or stones.

The later scene-wide style pass recorded 4,383 passing tests with the same four unrelated failures.

This plan is therefore complete for its own scope, but it does **not** claim that the entire repository test suite was fully green at closure.

## Evidence and milestones

- Phase 0 baselines: `tools/clod-poc/shots/grass-look/baseline-*`.
- G1–G4 implementation: commit `ef5682fa5`.
- G5 initial implementation: PR #190, merge commit `3f22eff432ab97f8972f888efc5768871d3fb51c`.
- G5 raster-dispatch and GUI correction: commit `3d72e3708c4ae4952f57254fed2a55da6dbc685a`.
- G6 implementation: PR #219, merge commit `f567ee1176e9b27b6e83f47e931d87278046f310`.
- G6 filtered-sampling follow-up: PR #223, merge commit `1660ef19e9fdb3a353b7610998ed38edfe8ec34c`.
- S1 selectable stone presets: commit `52bb637f74c82736f9e908028e80765b64ffe7ff`.
- Scene-wide homogeneous style presets: commit `f5f424c38f34ca5769cfa4baf4e93aa023062823`.

Primary visual evidence:

- G5/G6 GUI A/B: `shots/grass-look/g56-A-defaults.png`, `g56-B-contact-off.png`, `g56-C-shade-off.png`;
- S1 stone presets: `shots/grass-look/s1-realistic.png`, `s1-stylized.png`, `s1-toon.png`;
- scene-wide styles: `shots/grass-look/scene-*.png`.

## Known limits and parked follow-ups

These do not reopen the completed plan:

- the optional G4 terrain-color patch-noise stretch is not implemented;
- bilinear contact-field sampling can be added if 1 m contact cells become visible in close-up art review;
- blade-level G1–G4 close-up A/B remains constrained by the recorded pose/placement behavior;
- far/billboard/impostor tree materials retain realistic shading until rebaked;
- terrain albedo is not restyled by the scene-wide preset;
- the four unrelated water-foam/biome-visual test failures are tracked separately.
