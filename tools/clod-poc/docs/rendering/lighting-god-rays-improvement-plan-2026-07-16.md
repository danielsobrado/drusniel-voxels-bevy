# Lighting & God Rays Improvement Plan

Created 2026-07-16.

Goal: make clod-poc's lighting and god rays look physically plausible and clearly higher quality
than today, while keeping the frame inside the existing perf gates. Scope is the default WebGPU/TSL
pipeline only — the WebGL `PostProcessPipeline` stays a frozen fallback per
`docs/postfx-webgl-decommission-decision.md`.

---

## 1. Current state (verified in code, 2026-07-16)

### Pipeline order (`src/gpu/webgpu_postprocess.ts` → `createOutputNode`)

```
scene MRT pass (renderScale ≤ 1)
  → aerial node   (froxel composite + analytic "Hillaire" aerial, postfx_atmosphere_nodes.ts)
  → clouds composite (optional, half-res)
  → GTAO multiply (optional, half-res + bilateral upsample)
  → TRAA
  → bloom add (optional)
  → contact shadows multiply (optional)
  → screen-space bounce (optional)
  → grade (auto exposure, white balance, tints, contrast, saturation, vignette)
  → renderer tone mapping (aces default / agx)
```

### Lighting

- `src/environment/lighting_model.ts`: analytic sun transmittance (per-channel exponential
  extinction vs. air mass) + hemispherical sky/ground ambient + small ambient floor. Not derived
  from the atmosphere model; tuned constants in `lighting_model.yaml`.
- Sky dome (`src/gpu/sky_node_material.ts`): horizon/zenith/ground gradient + haze + procedural
  sun disk. The disk core is `smoothstep(0.9995, 0.9999, sunDot)` ≈ 0.8–1.8° radius — the real sun
  is 0.265°, so the disk is roughly 3–7× oversized, and its color/glow is not tied to atmospheric
  transmittance beyond the shared sun color.
- No shadow maps in the main scene by design. Sun visibility comes from: the far sun-visibility
  tile cache (`docs/far-sun-visibility-cache.md`), forest-lighting fields (canopy), screen-space
  contact shadows, GTAO, and — inside fog — 5 fixed heightfield probes.
- "Hillaire LUTs" (`src/gpu/postfx_hillaire_luts.ts`) are CPU-baked analytic fills, not integrated
  transmittance/multi-scatter LUTs. The aerial node uses single-sample analytic optical depth at
  camera height plus these textures.

### Volumetrics / god rays

- Froxel volume (`src/gpu/postfx_froxel_volume.ts`): 160×90×64 grid, exponential slices, HG phase
  g = 0.5, height fog + altitude layer, hydrology moisture, canopy slab at +13 m, cloud-shadow
  scroll, terrain sun visibility via probes at fixed distances 12/30/75/180/420 m. Hash-noise
  jitter, **no temporal reprojection/history**. A raymarch fallback replicates it when the volume
  is absent.
- **The god-rays dropdown does nothing on the default renderer.** `godRaysMode` is only consumed
  by the frozen WebGL pipeline (`src/environment/postprocess.ts`, where `volumetric` silently
  aliases to `heavy`). The WebGPU stage list (`src/gpu/postfx_stage_flags.ts`) has no god-rays
  stage, and `webgpu_postprocess.ts` never reads `godRaysMode`. The note in
  `froxel-debug-and-god-rays-2026-07-14.md` that "the render path already handled all four" holds
  only for `?renderer=webgl`.
- Orphaned modules: `src/gpu/god_rays_screen.ts` (`buildScreenGodRays`, a finished TSL
  screen-space builder used only by its test) and `src/gpu/god_rays_volumetric.ts` (a wrapper over
  three's `GodraysNode` that stands up its own shadow map and traverses the whole scene each frame
  setting `castShadow`; no importers).
- The only shafts users actually get today come implicitly from froxel `sunShaftsStrength`, which
  is further gated to low sun elevations.

### Known defects that block quality

1. `PostFxFroxelVolume.update()` derives sun/sky radiance from `DEFAULT_ENVIRONMENT_SETTINGS` /
   `DEFAULT_ENVIRONMENT_COLORS`, ignoring live GUI/environment state — fog light does not follow
   the scene light.
2. GTAO and contact shadows multiply the image *after* fog/shafts are composited, so ambient
   occlusion darkens in-scattered fog light — physically wrong and visibly dirties shafts.
3. Froxel hash jitter is time-animated with no history buffer → shimmer/crawl in fog and shafts;
   TRAA only partially hides it (and is off in the perf preset).
4. Froxel GPU pass timestamps (`froxScatter`, `froxIntegrate`) never resolve (read 0.00), so pass
   cost is currently unmeasurable (noted 2026-07-14).
5. `perf`/`potato` presets have neither forest fog nor froxels since `671f2143` — low presets have
   no atmosphere depth cue at all (open item in the 07-14 doc).
6. Phase functions disagree: froxels hardcode g = 0.5 while the aerial Mie uses g = 0.76; fog color
   mixes `hillaire.mieColor`/`rayleighColor` with magic gains (`phase*18`) rather than shared
   radiance.

---

## 2. Target design

One sun, one atmosphere, one fog system:

- **Sky + sun + aerial + fog derive from a single atmosphere parameter set** (existing
  `postfx_atmosphere.yaml`) via real precomputed LUTs. Materials, sky dome, froxels, and aerial
  perspective all read the same sun transmittance and sky radiance so nothing drifts.
- **God rays are owned by the froxel system** (they are "volumetric fog with good sun
  visibility"), not by a separate additive effect. The screen-space radial blur remains as the
  cheap fallback for low presets and sun-in-frame accents.
- **Sun visibility inside fog gets a real occluder source** (more heightfield probes + canopy, and
  optionally a small terrain-only sun depth map behind a measured decision gate) so shafts trace
  ridge lines and tree crowns instead of five fixed probes.
- **Temporal reuse everywhere noise is added**: blue-noise jitter + froxel history reprojection,
  halving effective per-frame sample cost — quality and performance from the same change.
- three's `GodraysNode` path is **rejected**: it needs `renderer.shadowMap` + per-frame scene
  traversal forcing `castShadow`, duplicating a shadow system the renderer deliberately does not
  run. Delete `god_rays_volumetric.ts` once the froxel path lands (Phase 2).

Mode mapping after this plan (same `GodRaysMode` union, no settings migration):

| mode | WebGPU behaviour |
| --- | --- |
| `off` | no shafts (froxels may still fog without directional shafts) |
| `cheap` | screen-space radial blur, 24 samples, half-res occlusion buffer |
| `heavy` | screen-space radial blur, 60 samples, half-res occlusion buffer |
| `volumetric` | froxel shafts: improved sun visibility + temporal reuse (+ optional shadow map on ultra) |

---

## 3. Phases

Every phase ends green on: `npm --prefix tools/clod-poc run typecheck`, `npm --prefix tools/clod-poc test`,
`npm --prefix tools/clod-poc run build`, plus the phase's own perf/visual evidence. Perf runs follow the
deterministic process in `CLAUDE.md` (dev server on 5180, `perf:main` / `postfx-perf-matrix`,
`--warmup 600` when compute pipelines changed). No claimed improvement without before/after
`summary.json` numbers.

### Phase 0 — Measurement + wiring foundation (no visual change intended)

The point: make later phases measurable and make the existing controls truthful.

1. **Fix froxel pass GPU timing.** Investigate why `froxScatter`/`froxIntegrate` timestamps read
   0.00 in `tools/postfx-perf-matrix.ts` runs (compute passes likely missing timestamp tagging the
   way `tagGpu` covers render targets). If WebGPU timestamp queries are unavailable, add a
   documented fallback (encoder-scoped query or per-pass toggle A/B) so froxel cost is a number,
   not an inference.
2. **Wire `godRaysMode` into the WebGPU pipeline.** Add a `godrays` stage to
   `postfx_stage_flags.ts`; consume `godRaysMode` + density/decay/weight/exposure in
   `webgpu_postprocess.ts`; include the mode in `graphKey()` so live switching rebuilds (same
   constraint as froxel debug — apply before `nextKey` comparison). `cheap`/`heavy` composite
   `buildScreenGodRays` (already written and unit-tested) additively **before grade**, gated by
   `projectSunToScreen(...).visible`. `volumetric` initially = froxels forced on + shaft gain
   (placeholder until Phase 2). Update `environment_gui.ts` help text.
3. **Fix froxel lighting source.** `PostFxFroxelVolume.update()` takes the live
   `EnvironmentLighting` (from the sky handle / environment state) instead of re-deriving from
   defaults.
4. **Perf matrix cases.** Add `postfx-godrays-cheap`, `postfx-godrays-heavy`,
   `postfx-godrays-froxel` cases to `tools/postfx-perf-matrix.ts`.
5. **Baselines.** Capture reference shots + stats for the QA poses used later: noon (elev 55°),
   golden hour (elev 10°), sunset grazing (elev 2°), sun-behind-trees, sun-behind-ridge (world 8,
   fixed seed/poses via the shot harness). Store under `shots/lighting-plan-baseline/`.

Acceptance: dropdown modes visibly differ on WebGPU; froxel pass cost prints non-zero in matrix
output; all matrix cases within existing thresholds; new unit tests for mode → stage mapping.

### Phase 1 — Physically-based sky, sun, and shared lighting

The realism foundation: everything downstream (fog, shafts, materials) inherits it.

1. **Real Hillaire LUTs on GPU.** Replace the analytic CPU fills in `postfx_hillaire_luts.ts` with
   compute-built LUTs (same sizes: transmittance 256×64, multi-scatter 32×32, sky-view 192×108),
   integrating the actual Rayleigh/Mie/ozone profile from `postfx_atmosphere.yaml`. Rebuild only
   when sun elevation or atmosphere settings change (event-driven, not per-frame). Keep the
   current CPU fill as the no-compute fallback and for vitest (pure functions for the integrand
   with unit tests against known values: zenith vs. horizon transmittance ratios, symmetry).
2. **Sky dome from the sky-view LUT.** `sky_node_material.ts` samples sky-view for the dome color
   (gradient path kept behind the potato preset). Sun disk fixed to physical angular size
   (0.265° radius, soft limb darkening), colored by the transmittance LUT at the sun's elevation —
   this is what makes sunsets red *and* feeds correct energy into bloom and screen-space shafts.
3. **`deriveEnvironmentLighting` reads the LUTs.** Sun color = disk irradiance × transmittance;
   sky/ground ambient = sky-view hemisphere integrals (two small CPU sums over the LUT, cached per
   sun direction bin). `lighting_model.yaml` scales become trim factors around physical values
   rather than the whole model. Terrain/tree/grass materials and the froxel volume then agree with
   the sky by construction.
4. **Exposure calibration.** Keep auto-exposure; re-center `postfx_color_script` grades so noon vs.
   sunset brightness lands via transmittance + auto-exposure instead of per-time-of-day gain
   hacks. Verify AgX and ACES paths both stay in range.

Acceptance: golden-hour shot shows warm sun, blue-shifted shadows, red-orange horizon without
touching color script; disk size correct in screenshots (measure px vs. FOV); `lighting:verify`
suite green with updated expectations; LUT rebuild cost ≤ 0.3 ms amortized (only on sun move) and
zero steady-state delta in `postfx-default` matrix case.

### Phase 2 — Volumetric god rays done right

The quality core. All work in `postfx_froxel_volume.ts` + `postfx_atmosphere_nodes.ts`.

1. **Temporal reprojection for the froxel volume.** Add a history scatter volume; each frame,
   jitter the froxel sample position with blue noise (replace `hashNoise` for the slice jitter),
   reproject history by world-position lookup through the previous view-projection (uniforms
   already exist for TRAA), exponential blend ~0.9 with out-of-range rejection. This removes fog
   shimmer *and* lets the scatter kernel drop to ~half effective samples for the same quality.
   Keep a `?froxelHistory=0` escape hatch and the current path as fallback.
2. **Real occluders for shafts.** Replace the 5 fixed probes with N (8–12) log-spaced heightfield
   probes toward the sun (near-field detail, far reach), keep the canopy slab + cloud shadow, and
   reuse the far sun-visibility atlas for distances beyond the probe range so ridge shadows in fog
   match the far material shadows.
3. **Decision gate: terrain-only sun depth map.** Prototype a single 1024² ortho depth render of
   terrain (+ optionally tree shadow proxies) covering the froxel range (~480 m) around the
   camera, refreshed on camera-cell/sun change, sampled in the scatter kernel for crisp
   silhouettes. Adopt only if: visual win in the sun-behind-trees/ridge shots AND ≤ 0.5 ms p95 at
   1080p balanced. Otherwise ship probes-only and document.
4. **Composite order fix.** Move the GTAO/contact multiplies so they apply to surface radiance
   *before* fog in-scatter is added (restructure `createOutputNode`: beauty → AO/contact → aerial+
   froxel → clouds → TRAA → bloom → bounce → grade). Fog stops being dirtied by AO; shafts stay
   luminous over dark ground.
5. **Shaft look controls.** Unify phase: use `mieG` from atmosphere settings for the froxel
   directional term (keep a separate softer ambient phase); drive fog sun radiance from Phase 1
   lighting (kills the `phase*18` magic gains); expose `sunShaftsStrength` and shaft phase in the
   environment GUI's froxel folder; remove the hard low-sun-only gating so noon crepuscular rays
   through canopy still read (weaker, physically via phase).
6. **Screen-space polish (cheap/heavy).** Build the occlusion buffer at half res with a small blur
   before the march (three-ish quality at half the bandwidth), keep the existing TSL march,
   composite in linear before grade. Delete `god_rays_volumetric.ts` and its GodraysNode
   dependency once `volumetric` routes to froxels.

Acceptance: sun-behind-trees and ridge-grazing shots show distinct shafts aligned with geometry
(compare against Phase 0 baselines); a fixed-pose 120-frame luma-variance probe shows temporal
noise reduced ≥ 2× with history on vs. off; `postfx-godrays-froxel` case ≤ +0.8 ms p95 vs.
`postfx-default` at 1080p balanced; no TRAA ghosting regression on the movement route
(`perf:move` / movement route profile).

### Phase 3 — Performance, presets, and the low-end story

1. **Budgets (1080p, world 8, balanced hardware target, frame gate 8 ms):**

   | preset | atmosphere/shaft configuration | added cost budget (p95 render) |
   | --- | --- | --- |
   | ultra | froxel shafts + history + (optional) sun depth map, clouds | ≤ 1.2 ms |
   | balanced | froxel shafts + history, probes only | ≤ 0.8 ms |
   | perf | screen-space `cheap` shafts + analytic height fog (no froxels) | ≤ 0.3 ms |
   | potato | analytic height fog only (restores the `671f2143` gap), no shafts | ≤ 0.1 ms |

   The perf/potato analytic height fog is a small addition to the aerial node (height-integrated
   fog with the Phase 1 sun color, no marching) so low presets stop rendering a fog-less world.
2. **Cost levers, in order:** temporal reuse (fewer effective samples), half-depth scatter kernel
   dispatch when history confidence is high, skip scatter+integrate entirely when sun and camera
   cell are unchanged (refresh cadence with dither), lateral grid option 192×108 only on ultra.
3. **Preset wiring.** Extend `postprocess_quality_presets.ts` with `godRaysMode` + fog tier per the
   table; presets keep overriding cleanly (`custom` untouched); URL flags still win.
4. **Gates.** Extend `postfx_perf_gate.ts` thresholds to the new cases; run the movement-route
   acceptance (`accept:infinite-islands -- --reuse`) to confirm streaming worlds hold frame p95;
   record before/after in `perf-runs/` and quote p50/p95 + froxel pass timings in the PR/doc.

Acceptance: matrix table for all presets within budget; no `qa` harness threshold regressions;
`startup_world_pages`/gate set unchanged.

### Phase 4 — Polish and integration

1. **Bloom retune** against the physical sun disk (threshold in scene-referred units so only
   sun/speculars bloom; small veiling-glare tail) — sun through leaves reads as glare, terrain
   does not glow.
2. **Ownership cleanup.** Keep forest-lighting `sunShaftsStrength`/fog defaults at 0 (froxels own
   atmosphere — confirms the `671f2143` decision); document in `forest_lighting_config.ts` and the
   rendering docs; delete dead god-rays code and stale doc claims (update
   `froxel-debug-and-god-rays-2026-07-14.md` cross-reference).
3. **Debug views.** Add `froxelDebug=sunvis` (sun visibility term) next to
   density/transmittance/scatter — the tool that makes shaft-occluder bugs diagnosable. Same
   graph-rebuild constraint as existing modes.
4. **Tests.** Unit: LUT integrand values, sun-disk angular size, mode→stage mapping, reprojection
   math (pure helper), preset tables. Extend `lighting:verify` npm script with the new test files.
   Visual: add the five QA poses to the shot battery with stats JSON so future regressions are
   caught by `qa`/battery runs.

---

## 4. Verification protocol (applies to every phase)

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort   # separate shell

# perf (same world/warmup/frames for baseline + after; warmup 600 when compute changed)
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 600 --frames 300 --case current-textured --out perf-runs/lighting-<phase>-after"
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npx tsx tools/postfx-perf-matrix.ts --case postfx-default,postfx-froxels,postfx-godrays-froxel --world 8 --warmup 600 --frames 600 --out perf-runs/lighting-<phase>-matrix"

# deterministic shots for the five QA poses
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run shoot -- --scene phase1-terrain --seed 1 --world 8 --freeze 1 --hud 1 --framealign 0 --out shots/lighting-plan/<pose>.png --stats shots/lighting-plan/<pose>-stats.json"
```

Report per phase: frame p50/p95, render p95, froxel pass timings, shot paths + stats, and any
visual tradeoff found. Unbenchmarked changes are stated as such.

---

## 5. Risks & open questions

- **TSL/three r185 API friction** for 3D history textures and compute timestamps; mitigation:
  every new path keeps the current implementation as a code-level fallback (pattern already used
  for froxel volume vs. raymarch fallback).
- **Two temporal systems** (froxel history + TRAA) can double-smear; fog history lives in froxel
  space (view-frozen), TRAA continues to operate on the composited image — validate with the
  movement-route ghosting probe before enabling both by default.
- **Sun depth map on streaming worlds**: terrain pages in/out; the map must tolerate missing pages
  (fall back to probes per-texel). Behind the Phase 2 decision gate, ultra-only.
- **Composite reorder (Phase 2.4)** changes the look of existing presets slightly (fog gets
  brighter over occluded ground — that is the point); communicate in the phase notes with A/B
  shots so it is not mistaken for a regression.
- **Open question:** should `volumetric` become the `balanced` default once budgets are proven, or
  stay opt-in? Decide on Phase 3 numbers.

## 6. File impact map

| area | files |
| --- | --- |
| pipeline wiring | `src/gpu/webgpu_postprocess.ts`, `src/gpu/postfx_stage_flags.ts`, `src/gpu/webgpu_postprocess_config.ts` |
| screen god rays | `src/gpu/god_rays_screen.ts` (reused), `src/environment/postprocess_settings.ts` |
| volumetric shafts | `src/gpu/postfx_froxel_volume.ts`, `src/gpu/postfx_atmosphere_nodes.ts`, `src/gpu/postfx_atmosphere.ts`, `src/environment/config/postfx_atmosphere.yaml` |
| sky/sun/lighting | `src/gpu/postfx_hillaire_luts.ts`, `src/gpu/sky_node_material.ts`, `src/environment/lighting_model.ts`, `src/environment/environment.ts`, `src/environment/config/lighting_model.yaml` |
| presets/state/GUI | `src/app/state/postprocess_quality_presets.ts`, `src/app/state/environment_state.ts`, `src/app/bootstrap/terrain_view_state.ts`, `src/ui/gui/environment_gui.ts` |
| perf/QA tooling | `tools/postfx-perf-matrix.ts`, `src/gpu/postfx_perf_gate.ts`, shot battery configs |
| deletions (Phase 2/4) | `src/gpu/god_rays_volumetric.ts` |
