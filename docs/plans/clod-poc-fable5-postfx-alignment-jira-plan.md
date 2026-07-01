# clod-poc PostFX / Fable5 Alignment — Jira Execution Plan

## Purpose

This plan brings clod-poc's post-processing and screen-space effects to parity with the
`docs/reference/fable5-world-demo` reference stack. It converts each effect area into
Jira-ready epics and tickets.

The goal is **not** a blind copy. The reference `PostStack.ts` is a single WebGPU/TSL
`RenderPipeline`; clod-poc must land the same capabilities behind its own seams while
preserving current strengths:

- The `AppPostProcess` interface ([`tools/clod-poc/src/app/app_post_process.ts`](../../tools/clod-poc/src/app/app_post_process.ts)) stays the single integration seam.
- Post-processing stays YAML-driven ([`tools/clod-poc/src/environment/config/postprocess.yaml`](../../tools/clod-poc/src/environment/config/postprocess.yaml)) with query-param overrides.
- Fail-loud WebGPU discipline (`window.__drusnielClod.error`, `device.onuncapturederror`) is preserved.
- Every stage is measured with the deterministic perf harness (`perf:main`) before it is called a win.
- Per-pass GPU timing reuses the existing profiler ([`tools/clod-poc/src/core/gpu_profiler.ts`](../../tools/clod-poc/src/core/gpu_profiler.ts), [`gpu_pass_timing.ts`](../../tools/clod-poc/src/core/gpu_pass_timing.ts)).

## Current State (the gap being closed)

| Aspect | Reference (`PostStack.ts`) | clod-poc WebGL path (`PostProcessPipeline`) | clod-poc **WebGPU default** (`WebGpuPostProcessPipeline`) |
|---|---|---|---|
| Backend | WebGPU / TSL `RenderPipeline` | WebGL GLSL fullscreen quad | WebGPU — **no-op passthrough** |
| Scene pass | MRT (output, velocity, depth) | single RT + depth texture | `renderer.render()` only |
| AA / temporal | `TRAANode` + analytic velocity | custom TAA + FXAA | none |
| Bloom | `BloomNode` | custom bright-pass | none |
| Tone map | AgX | ACES (options) | ACES only |
| Aerial haze | physical Hillaire + froxels | fixed-colour `mix()` by depth | none |
| AO | GTAO half-res bilateral | none | none |
| Contact shadows | SS sun-march (SSCS) | depth-ring approximation | none |
| SS bounce | half-res gather | none | none |
| Auto-exposure | GPU log-average, no readback | fixed uniform | none |
| Colour grade | per-ToD colour script | static grade | none |

**Blocking fact:** the default renderer is WebGPU ([`renderer_backend.ts`](../../tools/clod-poc/src/rendering/renderer_backend.ts) — `?renderer` defaults to `webgpu`), and its post pipeline is disabled
([`webgpu_postprocess.ts:67`](../../tools/clod-poc/src/gpu/webgpu_postprocess.ts) — *"bloom postprocess disabled: Three WebGPU cannot safely sample its render target in this path yet"*). There is no `mrt()`/`pass()`/`RenderPipeline` usage anywhere in clod-poc today. **POSTFX-100 unblocks every other epic** and must land first.

## Execution Summary

| Epic | Area | Goal | Priority |
|---|---|---|---|
| POSTFX-100 | Pipeline scaffold | Real WebGPU/TSL `RenderPipeline` behind `AppPostProcess`, MRT scene pass | P0 |
| POSTFX-200 | Tone map + bloom | AgX tone map + HDR `BloomNode` at parity | P0 |
| POSTFX-300 | Temporal AA | `TRAANode` with analytic velocity reprojection | P0 |
| POSTFX-400 | Exposure + grade | GPU auto-exposure + per-ToD filmic colour script | P1 |
| POSTFX-500 | Ambient occlusion | GTAO in a merged half-res MRT pass + bilateral upsample | P1 |
| POSTFX-600 | Aerial + volumetrics | Physical Hillaire aerial perspective + froxel fog | P1 |
| POSTFX-700 | Contact + bounce | SS contact-shadow sun-march + SS colour bounce | P2 |
| POSTFX-800 | QA / bench / guard | PostFX counters, perf gates, WebGL-path decision | P0 |

## Global Rules

```text
G1.  AppPostProcess stays the only seam the app depends on; both backends implement it.
G2.  Every stage is YAML-configurable and has a query-param toggle plus an ?ablate=<stage> switch.
G3.  A disabled stage must be byte-identical to "stage removed" (no cost, no graph node).
G4.  Missing/undefined inputs degrade to a safe pass-through, never to black frames.
G5.  WebGPU stays fail-loud: validation errors surface through window.__drusnielClod.error.
G6.  Every stage carries a per-pass GPU timing tag via the existing gpu_profiler.
G7.  No stage is "done" until measured with perf:main (headed = real GPU) before/after.
G8.  Code comments must NOT name the external reference; describe the technique instead.
G9.  Never run vitest / vite build / perf / shoot through rtk (see CLAUDE.md).
```

## Suggested Config Layout (extend the existing file)

```yaml
# tools/clod-poc/src/environment/config/postprocess.yaml  (additions)
postprocess:
  pipeline:
    webgpu_tsl_enabled: false      # POSTFX-100 master switch; false = legacy no-op passthrough
    scene_mrt: true                # emit output+depth (+velocity when temporal enabled)
  tone_mapping: agx                # POSTFX-200 (aces|agx|linear|none)
  bloom:
    threshold: 0.28
    strength: 0.45
    radius: 1.5
  temporal:                        # POSTFX-300
    enabled: true
    mode: traa                     # traa | off
    velocity: analytic             # analytic reprojection (default) | mrt
  exposure:                        # POSTFX-400
    auto: true
    key: 0.10
    gain_min: 0.18
    gain_max: 4.0
    adapt: 0.07
  grade:                           # POSTFX-400 colour script
    color_script_enabled: true
    saturation: 1.0
    contrast: 1.03
    vignette: 0.42
    grain: 0.012
  gtao:                            # POSTFX-500
    enabled: false
    samples: 8
    radius_m: 1.6
    distance_falloff: 0.6
    half_res: true
    far_fade_start_m: 700
    far_fade_end_m: 1800
  aerial:                          # POSTFX-600
    mode: hillaire                 # hillaire | fixed_color (legacy)
    froxel_fog_enabled: false
    froxel_max_dist_m: 480
  contact_shadows:                 # POSTFX-700
    mode: sun_march                # sun_march | depth_ring (legacy) | off
    steps: 12
    range_m: 1.7
    max_dist_m: 240
  bounce:                          # POSTFX-700
    enabled: false
    strength: 0.16
```

---

# EPIC POSTFX-100 — WebGPU/TSL PostFX Pipeline Scaffold

Replaces the no-op `WebGpuPostProcessPipeline` with a real TSL `RenderPipeline`. This is the
enabler; no other epic can land without it.

## POSTFX-101 — Prove WebGPU render-target sampling is viable

**Type:** Spike
**Priority:** P0
**Owner:** Rendering
**Depends on:** None

### User Story

As a developer, I want to confirm whether three's WebGPU path can sample its own scene render
target, so I know if the "disabled" comment is a real engine limit or a stale workaround.

### Scope

The reference runs a full sampling post stack on the same three version, so the blocker is
likely stale. Prove it with the smallest possible graph before scoping the port.

### Implementation Notes

- Stand up a throwaway `RenderPipeline` with `pass(scene, camera)` → `getTextureNode('output')` → identity output, wired through `AppPostProcess.render`.
- Reference: [`docs/reference/fable5-world-demo/src/render/PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 116–141 (`pass`, `setMRT`, `getTextureNode`).
- Compare the pinned three version in `tools/clod-poc/package.json` against the reference's `0.184.0`.

### Acceptance Criteria

- A one-node TSL pass renders the scene identically to the current passthrough (screenshot diff < 0.5%).
- No WebGPU validation errors in `device.onuncapturederror`.
- Written verdict: engine-limited (with the exact failing API) **or** stale comment (proceed).

### Test Plan

- `shoot` a `sanity` scene through the TSL identity pass vs. the current passthrough; diff PNGs.
- Confirm `window.__drusnielClod.error` stays null.

---

## POSTFX-102 — Introduce the TSL pipeline behind `AppPostProcess`

**Type:** Story
**Priority:** P0
**Owner:** Rendering
**Depends on:** POSTFX-101

### User Story

As a developer, I want a real WebGPU post pipeline implementing `AppPostProcess` so effect
stages can be added incrementally without touching the app wiring.

### Scope

New class (e.g. `WebGpuTslPostPipeline`) implementing `render/setSize/updateSettings/dispose`.
Select it at [`terrain_view_startup.ts:302`](../../tools/clod-poc/src/app/bootstrap/terrain_view_startup.ts) behind `postprocess.pipeline.webgpu_tsl_enabled`; keep the legacy no-op as the fallback until POSTFX-800.

### Proposed Files

```text
tools/clod-poc/src/gpu/postfx/webgpu_tsl_post_pipeline.ts
tools/clod-poc/src/gpu/postfx/scene_pass.ts        # MRT scene pass + texture-node accessors
tools/clod-poc/src/gpu/postfx/camera_sync.ts       # render-time camera/prev-matrix sync
tools/clod-poc/src/gpu/postfx/postfx_graph.ts      # ordered stage assembly
tools/clod-poc/src/environment/config/postprocess.yaml  # pipeline.* block
```

### Implementation Notes

- Port the render-time `syncCamera` seam ([`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 94–113): sync camera pose **after** all update fns to avoid one-frame-stale poses during motion.
- MRT: `mrt({ output })` by default; add `velocity` only when temporal MRT mode is selected (POSTFX-300).
- Tag the scene pass render target via `gpu_profiler` (`'scene'`).

### Acceptance Criteria

- With `webgpu_tsl_enabled: false`, behaviour is byte-identical to today (legacy passthrough).
- With `webgpu_tsl_enabled: true` and no stages, output matches the identity spike.
- `AppPostProcess` seam and app wiring are unchanged apart from the selection line.

### Test Plan

- Unit test: pipeline builds and disposes without leaking GPU resources (mock renderer).
- `shoot` parity: legacy vs. TSL-empty produce identical PNGs.
- Typecheck (`rtk npm --prefix tools/clod-poc run typecheck` — tsc-only is rtk-safe).

---

## POSTFX-103 — Stage registry, `?ablate`, and `?postmin` bisect

**Type:** Story
**Priority:** P0
**Owner:** Rendering
**Depends on:** POSTFX-102

### Scope

An ordered, toggleable stage registry so each later epic plugs in one node and gets a
query-param switch and ablation for free.

### Implementation Notes

- Mirror the reference bisect probes: `?postmin=1` (bare scene through pipeline) and
  `?ablate=bloom,taa,ao,aerial,contact,bounce` ([`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 74–76, 123–135).
- Reuse the existing flag parser in [`postprocess.ts`](../../tools/clod-poc/src/environment/postprocess.ts) (`applyPostProcessQueryOverrides`).

### Acceptance Criteria

- Each stage can be individually disabled by config, per-stage flag, and `?ablate`.
- `?postmin=1` outputs the raw scene pass (no stages) for regression bisection.
- Stage order is data-defined and documented.

### Test Plan

- Unit tests for stage-registry enable/disable and `?ablate` parsing.
- `?postmin=1` screenshot equals the identity spike.

---

# EPIC POSTFX-200 — Tone Mapping + Bloom

## POSTFX-201 — AgX tone mapping parity

**Type:** Story
**Priority:** P0
**Owner:** Rendering
**Depends on:** POSTFX-102

### Scope

Move tone mapping into the TSL pipeline; default AgX to match the reference while keeping
`aces|linear|none` selectable ([`toneMappingModeToThree`](../../tools/clod-poc/src/environment/postprocess.ts)).

### Acceptance Criteria

- `tone_mapping: agx` yields the reference tone response; `aces` reproduces today's look.
- Debug/probe modes bypass tone mapping (reference uses `NoToneMapping` for probes).
- Tone-map choice is YAML + `?toneMap` driven.

### Test Plan

- `shoot` the same scene under agx/aces/none; confirm distinct, correct responses.

---

## POSTFX-202 — HDR bloom via `BloomNode`

**Type:** Story
**Priority:** P0
**Owner:** Rendering / Shaders
**Depends on:** POSTFX-201

### Scope

Replace the custom bright-pass with three's `BloomNode` at reference parameters
(`bloom(taaed, 0.28, 0.45, 1.5)` — [`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) line 515).

### Implementation Notes

- `import { bloom } from 'three/addons/tsl/display/BloomNode.js'`.
- Add bloom **after** temporal resolve when POSTFX-300 lands; until then, after the scene pass.
- Parameters (threshold/strength/radius) from `postprocess.yaml`.

### Acceptance Criteria

- Highlights bloom without haloing the whole frame; disabled path adds zero cost.
- `?bloom=0` / `?ablate=bloom` removes the node entirely.
- Bloom GPU time appears as its own timing row.

### Test Plan

- Bright-highlight scene A/B (bloom on/off) screenshots + `perf:main` bloom row.

---

# EPIC POSTFX-300 — Temporal Anti-Aliasing (TRAA)

## POSTFX-301 — TRAA node with analytic velocity reprojection

**Type:** Story
**Priority:** P0
**Owner:** Rendering / Shaders
**Depends on:** POSTFX-103

### User Story

As a player, I want the dense geometry (terrain morph, instanced vegetation) to stop
shimmering, without the ghosting that a naive velocity buffer causes.

### Scope

Port `TRAANode` fed by **analytic camera reprojection** from each pixel's depth, not the
velocity MRT (which is garbage for `positionNode`-displaced geometry and sky pixels).

### Implementation Notes

- Faithfully port `velReproject` / `velLoad` ([`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 463–509): prev view/proj matrices, uv flip convention, far-plane limit covers sky.
- `import { traa } from 'three/addons/tsl/display/TRAANode.js'`.
- clod-poc already has a WebGL analog (depth-reprojected TAA + Halton jitter + history clamp in [`postprocess.ts`](../../tools/clod-poc/src/environment/postprocess.ts)); reuse its jitter/clamp intuition but drive the TSL node.
- Keep `velocity: mrt` as a config fallback for diagnostics only.

### Acceptance Criteria

- Static-camera geometry shows no history rejection; rotation shows no sky smearing.
- `?taa=0` / `?ablate=taa` bypasses cleanly.
- Bloom and grade run **after** temporal resolve.

### Test Plan

- Shimmer A/B on a dense forest/terrain scene (TAA on/off) — count edge-flicker pixels across frames.
- Pan/rotate sequence: confirm no cloud/sky drag (reference's `skyveldbg` regression).
- `perf:main` temporal row.

---

## POSTFX-302 — Camera jitter + freeze/determinism integration

**Type:** Story
**Priority:** P1
**Owner:** Rendering
**Depends on:** POSTFX-301

### Scope

Wire Halton jitter into the scene-pass projection and ensure `?freeze=1` / `settle()` still
produce deterministic captures with temporal on.

### Acceptance Criteria

- Jitter is applied to the scene pass and removed before reprojection math.
- `?freeze=1` converges to a stable frame within `settle()` budget.
- Shot harness batteries remain deterministic (no per-run drift).

### Test Plan

- `battery` run passes with temporal enabled.
- Freeze-frame repeatability: two runs of the same seed diff < 0.2%.

---

# EPIC POSTFX-400 — Auto-Exposure + Filmic Colour Grade

## POSTFX-401 — GPU auto-exposure (no readback)

**Type:** Story
**Priority:** P1
**Owner:** Rendering / Compute
**Depends on:** POSTFX-102

### Scope

Port the GPU log-average, center-weighted metering with smoothed feedback and gain clamp; no
CPU readback ([`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 517–561).

### Implementation Notes

- `instancedArray(2,'float')` exposure buffer + a `compute(1)` metering kernel run once per frame after render.
- Key `0.10`, gain clamp `[0.18, 4.0]`, adapt `0.07` from YAML.
- Add `?lockexp=1` to freeze exposure for deterministic motion probes (reference parity).

### Acceptance Criteria

- Frame adapts toward mid-grey without pumping; canopy interiors stay dark (no pastel wash).
- `auto: false` uses the fixed `exposure` uniform (today's behaviour).
- No `readPixels`/buffer readback on the frame path.

### Test Plan

- Bright→dark ToD sweep: exposure settles monotonically, no oscillation.
- `?lockexp=1` freeze test for deterministic diffs.

---

## POSTFX-402 — Per-ToD filmic colour script

**Type:** Story
**Priority:** P1
**Owner:** Rendering / Shaders
**Depends on:** POSTFX-401

### Scope

Port the colour-script grade: white balance, shadow/highlight split toning, saturation,
contrast around mid-grey, restrained vignette + deterministic grain.

### Implementation Notes

- Port [`docs/reference/fable5-world-demo/src/render/ColorScript.ts`](../../docs/reference/fable5-world-demo/src/render/ColorScript.ts) (`GradeUniforms`, `gradeParamsAt(tod)`) and the grade node ([`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 563–594).
- Drive `tod` from clod-poc's environment state / forest lighting controller.
- Grade runs **last**, after exposure multiply and bloom add.

### Acceptance Criteria

- Grade shifts believably across time-of-day (teal-orange split visible at golden hour).
- `?grade=0` / `color_script_enabled: false` yields a neutral grade.
- Vignette and grain match reference restraint (grain freeze-deterministic).

### Test Plan

- ToD sweep screenshots (dawn/noon/golden/dusk) vs. reference frames.
- Neutral-grade A/B.

---

# EPIC POSTFX-500 — Ground-Truth Ambient Occlusion (GTAO)

## POSTFX-501 — Half-res merged MRT pass

**Type:** Story
**Priority:** P1
**Owner:** Rendering
**Depends on:** POSTFX-103

### Scope

Introduce the merged half-res MRT pass that the reference uses to co-locate expensive
screen-space layers (AO now; clouds/bounce later) in one raster.

### Implementation Notes

- Port [`docs/reference/fable5-world-demo/src/render/HalfResMrt.ts`](../../docs/reference/fable5-world-demo/src/render/HalfResMrt.ts) (`HalfResMrtNode`, per-attachment texture nodes).
- 0.5 scale; jitter + TRAA absorb the upsample.

### Acceptance Criteria

- Half-res pass exposes named attachments consumable exactly like full-res texture nodes.
- Pass is created only when at least one half-res layer is enabled.
- Per-layer GPU timing tags present.

### Test Plan

- Unit test: attachment nodes resolve by name.
- Empty half-res pass (all layers off) allocates nothing.

---

## POSTFX-502 — GTAO layer + joint-bilateral upsample

**Type:** Story
**Priority:** P1
**Owner:** Rendering / Shaders
**Depends on:** POSTFX-501

### Scope

Port the terrain-tuned GTAO and its depth-guided bilateral upsample with the gated
average-fallback that prevents the horizon-black collapse.

### Implementation Notes

- Port [`docs/reference/fable5-world-demo/src/render/Gtao.ts`](../../docs/reference/fable5-world-demo/src/render/Gtao.ts) (8 samples / 1.6 m radius — mesh-viewer defaults cost ~50 ms on vistas).
- Bilateral upsample + gated fallback ([`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 336–389): full-res depth guide; `wsum` floor prevents fabricated black.
- Far-fade `smoothstep(700, 1800, dist)`; indirect-only approximation on sun-lit pixels.

### Acceptance Criteria

- Contact darkening in crevices/understory; **no** horizon-black band on grazing terrain/water.
- Half-res AO within noise of a full-res reference render.
- `?ablate=ao` removes AO and (per reference) its contact contribution.

### Test Plan

- Grazing-horizon scene: confirm no black band (the failure mode the fallback fixes).
- AO on/off screenshots + `perf:main` AO row (target sub-frame budget).

---

# EPIC POSTFX-600 — Physical Aerial Perspective + Froxel Volumetrics

## POSTFX-601 — Hillaire aerial perspective from depth

**Type:** Story
**Priority:** P1
**Owner:** Rendering / Shaders
**Depends on:** POSTFX-103

### Scope

Replace clod-poc's fixed-colour depth `mix()` haze with physical in-scatter from depth.

### Implementation Notes

- Port the atmosphere `aerial(col, dirW, camAltKm, distKm)` consumer ([`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 239–261) and its source [`docs/reference/fable5-world-demo/src/sky/Atmosphere.ts`](../../docs/reference/fable5-world-demo/src/sky/Atmosphere.ts).
- Needs a sun-direction + atmosphere source; wire from clod-poc environment/forest-lighting state.
- Reversed-z aware: sky already carries atmosphere; only shade non-sky pixels.
- Keep `mode: fixed_color` as the legacy fallback.

### Acceptance Criteria

- Distant terrain gains altitude/distance-correct haze that tracks time-of-day.
- Sky pixels are not double-hazed (branch on far-plane depth).
- `?aerial=0` / `mode: fixed_color` restores prior behaviour.

### Test Plan

- Long-view vista (align with `four-km-long-view-plan`) at multiple ToD; compare haze falloff.
- `?fog=0` disables cleanly.

---

## POSTFX-602 — Froxel volumetric fog (local shafts / valley fog)

**Type:** Story
**Priority:** P2
**Owner:** Rendering / Compute
**Depends on:** POSTFX-601

### Scope

Add froxel volumetrics applied **before** the km-scale Hillaire haze (local shafts/valley fog
≤ ~480 m).

### Implementation Notes

- Port [`docs/reference/fable5-world-demo/src/gpu/passes/Froxels.ts`](../../docs/reference/fable5-world-demo/src/gpu/passes/Froxels.ts); apply via `froxels.apply(col, fogDist, screenUV)` ([`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 255–258).
- Gated by `froxel_fog_enabled`; longer `--warmup` for the compute pipeline (CLAUDE.md guidance).

### Acceptance Criteria

- Valley fog / light shafts appear in near range and fade into aerial haze without a seam.
- Disabled by default; enabling it shows a bounded GPU cost row.
- Integrated/weak GPU path can force it off.

### Test Plan

- Valley scene with low sun: shafts visible; A/B `perf:main` with `--warmup 600`.

---

# EPIC POSTFX-700 — Contact Shadows + Screen-Space Bounce

## POSTFX-701 — Screen-space contact-shadow sun-march (SSCS)

**Type:** Story
**Priority:** P2
**Owner:** Rendering / Shaders
**Depends on:** POSTFX-103

### Scope

Upgrade clod-poc's depth-ring contact approximation to a real short depth-march toward the
sun, floored so it stays a contact cue (never pitch black).

### Implementation Notes

- Port the SSCS march ([`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 390–440): 12 quadratic steps, first-hit-wins early exit, near-field only (< 240 m), distance fade + floor.
- Needs the same sun direction as POSTFX-601.
- Keep `mode: depth_ring` (current) and `off` as options.

### Acceptance Criteria

- ~0.1–2 m contact occlusion the cascades can't resolve appears under foliage/rocks.
- Never fully black (no-black-shadows rule); fades out past the near band.
- `?contact=0` / `?ablate=contact` disables.

### Test Plan

- Trunk-on-ground / rock-on-terrain close-up A/B; confirm soft contact, no black.
- `perf:main` contact row.

---

## POSTFX-702 — Screen-space colour bounce

**Type:** Story
**Priority:** P2
**Owner:** Rendering / Shaders
**Depends on:** POSTFX-501, POSTFX-701

### Scope

Add the subtle half-res colour-bleed gather composited by receiver chroma.

### Implementation Notes

- Port the bounce layer + composite ([`PostStack.ts`](../../docs/reference/fable5-world-demo/src/render/PostStack.ts) lines 185–217, 449–461): 8-tap depth-gated gather in the merged half-res pass, `strength ~0.16`.

### Acceptance Criteria

- Local green-on-trunk / warm-on-rock bleed visible but subtle; off by default.
- `?ablate=bounce` removes the layer and its cost.

### Test Plan

- Forest close-up A/B (bounce on/off); confirm subtle tint, no colour wash.

---

# EPIC POSTFX-800 — QA Harness, Counters, Guard, WebGL Decommission

## POSTFX-801 — PostFX perf counters + per-pass timing rows

**Type:** Story
**Priority:** P0
**Owner:** Rendering / QA
**Depends on:** POSTFX-102

### Required Counters (via `window.__drusnielClod.stats` + `gpu_pass_timing`)

```text
PostFX Pipeline Mode            (legacy | tsl)
PostFX Scene Pass GPU ms
PostFX Bloom GPU ms
PostFX TRAA GPU ms
PostFX HalfRes MRT GPU ms
PostFX GTAO GPU ms
PostFX Aerial GPU ms
PostFX Froxel GPU ms
PostFX Contact GPU ms
PostFX Bounce GPU ms
PostFX Grade GPU ms
PostFX Auto-Exposure Compute ms
PostFX Total Extra ms
```

### Acceptance Criteria

- Counters land in `perf-runs/<run>/summary.json` and the shot `stats` JSON.
- A disabled stage reports zero.
- Counters are stable across deterministic runs.

### Test Plan

- Per-stage `?ablate` A/B; confirm the matching row goes to zero.

---

## POSTFX-802 — Deterministic PostFX scenes + battery entries

**Type:** Story
**Priority:** P0
**Owner:** QA / Rendering
**Depends on:** POSTFX-801

### Scope

Add deterministic shot/perf scenes exercising each stage so regressions are caught early.

### Proposed Additions

```text
tools/clod-poc shot battery: postfx-bloom, postfx-taa-shimmer, postfx-gtao-horizon,
  postfx-aerial-vista, postfx-contact-closeup, postfx-grade-tod-sweep
perf:main cases: postfx-off, postfx-full, and per-stage ablation cases
```

### Acceptance Criteria

- Each scene runs headed (real GPU) via `shoot` / `perf:main`.
- Each captures screenshots at fixed checkpoints and records the POSTFX counters.
- Battery stays deterministic with temporal enabled.

### Test Plan

- Run each scene locally; confirm PNGs + counters saved (NOT via rtk).

---

## POSTFX-803 — PostFX perf gate thresholds

**Type:** Story
**Priority:** P0
**Owner:** QA / Rendering
**Depends on:** POSTFX-801

### Proposed Thresholds (tune per target hardware class, document the machine)

```text
PostFX Total Extra p95   <= 4.0 ms
PostFX GTAO p95          <= 1.25 ms
PostFX TRAA p95          <= 0.75 ms
PostFX Bloom p95         <= 0.60 ms
PostFX Aerial p95        <= 0.50 ms
PostFX Auto-Exposure p95 <= 0.20 ms
```

### Acceptance Criteria

- A regression run that blows a budget names the offending stage.
- Gate compares `postfx-off` vs `postfx-full` from the same session.
- Disabled-stage runs report zero/low.

### Test Plan

- Passing baseline; artificial over-budget failure; feature-disabled run.

---

## POSTFX-804 — WebGL `PostProcessPipeline` decommission decision

**Type:** Story
**Priority:** P1
**Owner:** Rendering
**Depends on:** POSTFX-200..700 landed

### Scope

Once the TSL stack reaches parity, decide the fate of the WebGL GLSL `PostProcessPipeline`
([`postprocess.ts`](../../tools/clod-poc/src/environment/postprocess.ts)): keep as the `?renderer=webgl` fallback, freeze, or remove.

### Acceptance Criteria

- Documented decision: keep-as-fallback / freeze / remove, with rationale.
- If kept: a note that it is a lower-fidelity fallback, not maintained at parity.
- If removed: `?renderer=webgl` behaviour and any dependents are handled.

### Test Plan

- Confirm the chosen path still boots `?renderer=webgl` (or documents its removal).

---

# Recommended Execution Order

```text
1.  POSTFX-101 — Prove WebGPU RT sampling
2.  POSTFX-102 — TSL pipeline behind AppPostProcess
3.  POSTFX-103 — Stage registry + ablate/postmin
4.  POSTFX-801 — PostFX counters + timing rows
5.  POSTFX-802 — Deterministic PostFX scenes
6.  POSTFX-201 — AgX tone mapping
7.  POSTFX-202 — Bloom node
8.  POSTFX-301 — TRAA (analytic velocity)
9.  POSTFX-302 — Jitter + freeze determinism
10. POSTFX-401 — GPU auto-exposure
11. POSTFX-402 — Per-ToD colour script
12. POSTFX-501 — Half-res merged MRT pass
13. POSTFX-502 — GTAO + bilateral upsample
14. POSTFX-601 — Hillaire aerial perspective
15. POSTFX-701 — SSCS contact shadows
16. POSTFX-602 — Froxel volumetrics
17. POSTFX-702 — SS colour bounce
18. POSTFX-803 — Perf gate thresholds
19. POSTFX-804 — WebGL decommission decision
```

## Release Gates

### Gate A — Scaffold Safety Baseline
- POSTFX-101/102/103 complete; POSTFX-801/802 complete.
- `webgpu_tsl_enabled: false` is byte-identical to today.
- Empty TSL pipeline matches identity spike; no WebGPU validation errors.

### Gate B — Core Look Parity
- POSTFX-201/202/301 complete.
- Shimmer measurably reduced with TRAA; bloom + AgX match reference response.
- `perf:main` shows bounded per-stage cost.

### Gate C — Tone/Exposure Parity
- POSTFX-401/402 complete.
- Auto-exposure adapts without pumping; ToD grade believable; `?lockexp=1` deterministic.

### Gate D — AO Parity
- POSTFX-501/502 complete.
- No horizon-black collapse; AO cost within threshold.

### Gate E — Atmosphere Parity
- POSTFX-601 complete (602 optional/deferred).
- Physical aerial haze tracks distance/altitude/ToD; sky not double-hazed.

### Gate F — Contact/Bounce Parity
- POSTFX-701 complete (702 optional/deferred).
- Contact cue present, never black.

### Gate G — Full PostFX Alignment
- Gates A–F complete; POSTFX-803 thresholds in place; POSTFX-804 decision recorded.
- `postfx-full` passes perf gate on the documented target machine.

# Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| WebGPU RT sampling really is blocked | Whole plan stalls | POSTFX-101 spike first; reference proves it works on same three version |
| TRAA velocity wrong for displaced geometry | Ghosting / shimmer | Port analytic reprojection exactly; keep MRT-velocity as diagnostic only |
| GTAO bilateral collapse | Horizon-black band | Port the gated average-fallback verbatim; grazing-horizon regression scene |
| Auto-exposure pumping | Frame brightness oscillates | Smoothed feedback + gain clamp; `?lockexp=1` for probes |
| Half-res upsample smearing | Woven artifacts on near geometry | Depth-aware gate + jitter+TRAA absorb (reference approach) |
| Stages land without measurement | Silent perf regressions | Counters (POSTFX-801) + scenes (POSTFX-802) are P0 and land before effects |
| Reference names leak into code comments | Violates project rule | G8: describe technique, never name the reference |
| Two divergent post stacks | Maintenance drift | POSTFX-804 forces an explicit keep/freeze/remove decision |

# Definition Of Done For Each Ticket

```text
1. Stage implemented behind YAML config + query toggle + ?ablate switch.
2. No hard-coded tuning outside constants/config.
3. Disabled path adds zero GPU cost and no graph node.
4. Per-pass GPU timing tag present; counter wired into stats/summary.
5. Deterministic shot and/or perf:main scene added or updated.
6. Measured before/after with perf:main (headed, real GPU) — numbers recorded.
7. Fail-loud preserved; no silent WebGL fallback in gated WebGPU paths.
8. Code comments describe the technique without naming the external reference.
```
