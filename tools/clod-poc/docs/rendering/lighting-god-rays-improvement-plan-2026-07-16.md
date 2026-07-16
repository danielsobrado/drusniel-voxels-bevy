# Lighting & God Rays Improvement Plan

Created 2026-07-16. Revised same day: god rays re-scoped to a **cheap screen-space post-process
stage with a dust-in-light-beams character** (~"volumetric-like", not a real volume march). The
froxel-heavy shaft machinery from the first draft (temporal reprojection, terrain sun depth map)
moved to the optional future track in Appendix A.

Goal: make clod-poc's lighting realistic and clearly higher quality, and ship god rays that read
volumetric and dusty while costing a fraction of a millisecond. Scope is the default WebGPU/TSL
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
  jitter, no temporal reprojection/history. A raymarch fallback replicates it when the volume is
  absent. Measured cost at current settings: indistinguishable from zero end-to-end
  (2026-07-14 doc), but per-pass GPU timestamps never resolved.
- **The god-rays dropdown does nothing on the default renderer.** `godRaysMode` is only consumed
  by the frozen WebGL pipeline (`src/environment/postprocess.ts`, where `volumetric` silently
  aliases to `heavy`). The WebGPU stage list (`src/gpu/postfx_stage_flags.ts`) has no god-rays
  stage, and `webgpu_postprocess.ts` never reads `godRaysMode`. The note in
  `froxel-debug-and-god-rays-2026-07-14.md` that "the render path already handled all four" holds
  only for `?renderer=webgl`.
- Orphaned modules: `src/gpu/god_rays_screen.ts` (`buildScreenGodRays`, a finished full-res TSL
  screen-space builder used only by its test) and `src/gpu/god_rays_volumetric.ts` (a wrapper over
  three's `GodraysNode` that stands up its own shadow map and traverses the whole scene each frame
  setting `castShadow`; no importers).
- The only shafts users actually get today come implicitly from froxel `sunShaftsStrength`, gated
  to low sun elevations.

### Known defects that matter for this plan

1. `PostFxFroxelVolume.update()` derives sun/sky radiance from `DEFAULT_ENVIRONMENT_SETTINGS` /
   `DEFAULT_ENVIRONMENT_COLORS`, ignoring live GUI/environment state — fog light does not follow
   the scene light.
2. GTAO and contact shadows multiply the image *after* fog in-scatter is composited, so ambient
   occlusion darkens fog light — physically wrong and it dirties any additive shaft light too.
3. Froxel GPU pass timestamps (`froxScatter`, `froxIntegrate`) never resolve (read 0.00), so pass
   cost is currently unmeasurable (noted 2026-07-14).
4. `perf`/`potato` presets have neither forest fog nor froxels since `671f2143` — low presets have
   no atmosphere depth cue at all (open item in the 07-14 doc).
5. The sky sun disk is oversized and not transmittance-driven, which starves any screen-space
   shaft technique (and bloom) of a correct bright, warm source term.

---

## 2. Target design

### Principles

- **One sun, one atmosphere.** Sky dome, sun disk, materials, fog, and god rays all read the same
  sun transmittance and sky radiance (existing `postfx_atmosphere.yaml` parameters) so nothing
  drifts as the sun moves.
- **God rays are a dedicated cheap post-process stage** — a half-res screen-space radial march
  with a dust character, composited additively in linear light. No volume marching, no shadow
  maps, no per-frame scene traversal. Budget: **≤ 0.3 ms p95 at 1080p** in its heaviest mode.
- **Froxel fog stays what it is**: an optional, already-cheap ambience layer. It is no longer the
  owner of god rays. Its two small correctness fixes (live lighting, composite order) stay in
  scope; its expensive upgrades do not (Appendix A).
- three's `GodraysNode` path is **rejected**: it needs `renderer.shadowMap` + per-frame scene
  traversal forcing `castShadow`, duplicating a shadow system the renderer deliberately does not
  run. `god_rays_volumetric.ts` is deleted once the new stage lands.

### The dust god rays stage, concretely

A single half-res pass (reusing the existing `HalfResMrtNode` infrastructure) plus a composite
term in the output graph:

1. **Source/occlusion term.** From scene color and depth: sky pixels (depth ≥ 0.9999…) keep their
   radiance — the (Phase-1-corrected) bright sun disk and circumsolar sky dominate; geometry
   contributes a small "lit haze" term instead of hard black (the WebGL fallback's
   `terrainVisibility * 0.12` trick), so shafts do not die instantly against terrain.
2. **Radial march toward the projected sun.** `projectSunToScreen` (already written) gives the sun
   UV + visibility. March N samples from each pixel toward the sun UV with per-step decay —
   exactly `buildScreenGodRays`, moved to half res. N = 16 (`cheap`) / 28 (`heavy`).
3. **Banding killer.** Jitter each pixel's march start by interleaved gradient noise (IGN — one
   `fract`/`dot` expression, no texture needed). This is what makes 16 taps look like 60. The
   existing full-res 24/60-tap constants become obsolete.
4. **Dust character.** Modulate the accumulated shaft radiance by 2 octaves of animated value
   noise sampled in "beam space" (coordinates: distance along the ray to the sun, and perpendicular
   offset), drifting slowly over time. Perpendicular-biased scale produces distinct parallel
   striations — beams of unequal brightness that slowly shift, which is what reads as *dust
   hanging in light*, without any particles. A `dustStrength` / `dustScale` / `dustSpeed` triple in
   settings; strength 0 = clean classic shafts.
5. **Composite.** 4-tap upsample of the half-res shafts, tinted by the sun's transmittance color
   (warm at low sun), multiplied by god-rays exposure and a soft screen-edge/sun-behind fade
   (no pop when the sun leaves frame), then **added in linear before TRAA** — TAA temporally
   smooths both the IGN jitter and the dust noise for free when enabled; with TAA off the residual
   grain itself reads as dust, which is acceptable for the perf preset.
6. **Mode mapping** (same `GodRaysMode` union, no settings migration):

   | mode | WebGPU behaviour |
   | --- | --- |
   | `off` | stage absent from the graph |
   | `cheap` | half-res march, 16 taps, dust noise on |
   | `heavy` | half-res march, 28 taps, dust noise + slightly wider source blur |
   | `volumetric` | `heavy` + froxel fog layer forced on (ambience under the shafts); still no volume-marched shafts |

Why this reads "volumetric" despite being screen-space: depth-aware source (silhouettes carve the
beams), dust striation (interior structure instead of a uniform radial glow), transmittance tint
(beams share the atmosphere's color), and fog underneath in `volumetric` mode (haze for the beams
to live in). The known screen-space limit — no shafts when the sun is well off-screen — is handled
by the soft fade and documented as accepted; the froxel future track (Appendix A) is the answer if
that ever becomes unacceptable.

Cost estimate: half-res at 1080p ≈ 518k pixels × 16–28 taps of one texture each + noise ALU ≈
well under 0.3 ms on any WebGPU-capable GPU; verified, not assumed, in Phase 2.

---

## 3. Phases

Every phase ends green on: `npm --prefix tools/clod-poc run typecheck`, `npm --prefix tools/clod-poc test`,
`npm --prefix tools/clod-poc run build`, plus the phase's own perf/visual evidence. Perf runs follow the
deterministic process in `CLAUDE.md` (dev server on 5180, `perf:main` / `postfx-perf-matrix`,
`--warmup 600` when compute pipelines changed). No claimed improvement without before/after
`summary.json` numbers.

### Phase 0 — Measurement + wiring foundation (no visual change intended)

1. **Fix froxel/post pass GPU timing.** Investigate why `froxScatter`/`froxIntegrate` timestamps
   read 0.00 in `tools/postfx-perf-matrix.ts` runs. If WebGPU timestamp queries are unavailable,
   add a documented fallback (encoder-scoped query or per-stage A/B toggle) so the new god-rays
   stage lands with a real number attached.
2. **Wire `godRaysMode` into the WebGPU pipeline.** Add a `godrays` stage to
   `postfx_stage_flags.ts`; consume `godRaysMode` + density/decay/weight/exposure in
   `webgpu_postprocess.ts`; include the mode in `graphKey()` so live switching rebuilds (same
   ordering constraint as froxel debug — apply before the `nextKey` comparison). First cut may
   composite the existing full-res `buildScreenGodRays` as-is; the point of this phase is truthful
   controls and a measurable stage, not the final look.
3. **Fix froxel lighting source.** `PostFxFroxelVolume.update()` takes the live
   `EnvironmentLighting` (from the sky handle / environment state) instead of re-deriving from
   defaults, so `volumetric` mode's fog matches the scene sun.
4. **Perf matrix cases.** Add `postfx-godrays-cheap`, `postfx-godrays-heavy`,
   `postfx-godrays-volumetric` to `tools/postfx-perf-matrix.ts`.
5. **Baselines.** Capture reference shots + stats for the QA poses used later: noon (elev 55°),
   golden hour (elev 10°), sunset grazing (elev 2°), sun-behind-trees, sun-behind-ridge (world 8,
   fixed seed/poses via the shot harness). Store under `shots/lighting-plan-baseline/`.

Acceptance: dropdown modes visibly differ on WebGPU; god-rays and froxel pass costs print non-zero
in matrix output; all matrix cases within existing thresholds; unit tests for mode → stage mapping.

### Phase 1 — Physically-based sky, sun, and shared lighting

Feeds the god rays their source term (bright, correctly colored sun) and fixes overall realism.

1. **Real Hillaire LUTs on GPU.** Replace the analytic CPU fills in `postfx_hillaire_luts.ts` with
   compute-built LUTs (same sizes: transmittance 256×64, multi-scatter 32×32, sky-view 192×108),
   integrating the actual Rayleigh/Mie/ozone profile from `postfx_atmosphere.yaml`. Rebuild only
   when sun elevation or atmosphere settings change (event-driven, not per-frame). Keep the
   current CPU fill as the no-compute fallback and for vitest (pure integrand functions with unit
   tests: zenith vs. horizon transmittance ratios, symmetry).
2. **Sky dome from the sky-view LUT.** `sky_node_material.ts` samples sky-view for the dome color
   (gradient path kept behind the potato preset). Sun disk fixed to physical angular size
   (0.265° radius, soft limb darkening), colored by the transmittance LUT at the sun's elevation —
   this makes sunsets red *and* gives screen-space shafts and bloom a physically bright, warm
   source.
3. **`deriveEnvironmentLighting` reads the LUTs.** Sun color = disk irradiance × transmittance;
   sky/ground ambient = sky-view hemisphere integrals (two small CPU sums over the LUT, cached per
   sun direction bin). `lighting_model.yaml` scales become trim factors around physical values.
   Terrain/tree/grass materials, froxel fog, and god-ray tint then agree with the sky by
   construction.
4. **Exposure calibration.** Keep auto-exposure; re-center `postfx_color_script` grades so noon vs.
   sunset brightness lands via transmittance + auto-exposure instead of per-time-of-day gain
   hacks. Verify AgX and ACES paths both stay in range.

Acceptance: golden-hour shot shows warm sun, blue-shifted shadows, red-orange horizon without
touching color script; disk size correct in screenshots (measure px vs. FOV); `lighting:verify`
suite green with updated expectations; LUT rebuild ≤ 0.3 ms amortized (only on sun move) and zero
steady-state delta in the `postfx-default` matrix case.

Note: Phase 2 does not block on Phase 1 — the dust stage can land with today's sun colors and
inherit Phase 1's transmittance tint when it arrives. Only the *final* look sign-off (Phase 4
shots) requires both.

### Phase 2 — The dust god rays stage (the core deliverable)

Implements Section 2's design. All work in `src/gpu/god_rays_screen.ts` (extended),
`webgpu_postprocess.ts` (graph), `postprocess_settings.ts` (dust params).

1. **Half-res march.** Add a `godrays` entry to the `HalfResMrtNode` pass (machinery already
   exists for clouds/AO/bounce); move `buildScreenGodRays` to consume half-res source + depth.
   Full-res path remains available behind `?godraysFullres=1` for A/B.
2. **IGN start jitter** in the march; drop `cheap` to 16 taps and cap `heavy` at 28 taps (from
   24/60 full-res). Verify no visible banding at 16 taps in the sunset pose.
3. **Lit-haze geometry term** in the source function (small, sun-visibility-weighted via the far
   sun-visibility atlas where available, constant fallback otherwise) so beams persist over
   terrain silhouettes.
4. **Dust noise modulation** in beam space with `dustStrength`/`dustScale`/`dustSpeed` settings
   (YAML + GUI + query overrides, following the existing settings plumbing pattern:
   `postprocess_settings.ts` → `environment_state.ts` → `environment_query_overrides.ts` →
   `terrain_view_state.ts` → GUI folder).
5. **Composite** additively in linear, pre-TRAA, tinted by sun transmittance color, with soft
   screen-edge fade. `volumetric` mode = same + `froxelsEnabled` forced on for the ambience layer.
6. **Delete `god_rays_volumetric.ts`** and its `GodraysNode` import; update the 07-14 doc's
   cross-reference (its "all four modes handled" claim is corrected by this plan).
7. **Optional (only if budget allows after measurement):** faint near-camera mote sparkle —
   high-frequency thresholded noise inside strong-shaft regions. Stretch goal; striation noise is
   expected to sell the dust feel alone.

Acceptance:
- Visual: sunset-behind-trees and ridge poses show distinct, slowly drifting beams with interior
  striation; noon shafts are subtle but present through canopy gaps; no banding; no pop when
  panning the sun off-screen. A/B against Phase 0 baselines.
- Temporal: fixed-pose 120-frame luma-variance probe — dust drift visible, per-pixel flicker at or
  below the TAA-on baseline.
- Perf: `postfx-godrays-cheap` ≤ +0.15 ms and `postfx-godrays-heavy` ≤ +0.3 ms render p95 vs.
  `postfx-default` (1080p, world 8, 600 frames); `postfx-godrays-volumetric` additionally within
  the froxel case's existing envelope. Numbers quoted from `summary.json`, per-pass timing from
  Phase 0's fix.

### Phase 3 — Presets, low-end story, and gates

1. **Preset mapping** (extend `postprocess_quality_presets.ts`; URL flags still win):

   | preset | god rays | fog | added cost budget (render p95, 1080p) |
   | --- | --- | --- | --- |
   | ultra | `volumetric` (heavy + froxels) | froxels on | ≤ 0.4 ms combined |
   | balanced | `heavy` | froxels on (already in preset) | ≤ 0.3 ms |
   | perf | `cheap` | analytic height fog only | ≤ 0.2 ms |
   | potato | `off` | analytic height fog only | ≤ 0.1 ms |

   The analytic height fog is a small addition to the aerial node (height-integrated fog using the
   Phase 1 sun color, no marching) so `perf`/`potato` stop rendering a fog-less world — closes the
   `671f2143` gap.
2. **Composite-order fix (cheap, one graph reshuffle).** Move the GTAO/contact multiplies before
   the aerial/fog composite in `createOutputNode` so AO stops darkening fog and additive shaft
   light. Verify with A/B shots; expect fog over occluded ground to brighten slightly — that is
   the correction, flag it in the phase notes.
3. **Gates.** Extend `postfx_perf_gate.ts` thresholds to the new cases; run the movement-route
   acceptance (`accept:infinite-islands -- --reuse`) to confirm streaming worlds hold frame p95;
   decide on Phase 3 numbers whether `cheap` becomes the default `godRaysMode` in
   `postprocess.yaml` (recommendation: yes, if the perf preset delta is ≤ 0.2 ms).

Acceptance: matrix table for all presets within budget; no `qa` harness threshold regressions;
`startup_world_pages`/gate set unchanged.

### Phase 4 — Polish and integration

1. **Bloom retune** against the physical sun disk (threshold in scene-referred units so only
   sun/speculars bloom; small veiling-glare tail). Bloom + shafts must compose without double-glow
   around the disk — tune shaft `weight` and bloom threshold together on the sunset pose.
2. **Ownership cleanup.** Keep forest-lighting `sunShaftsStrength`/fog defaults at 0 (post stage
   owns shafts, froxels own fog — confirms the `671f2143` decision); document in
   `forest_lighting_config.ts` and the rendering docs.
3. **Debug views.** `?godraysDebug=shaft|source|dust` overlay (pre-tint accumulation, source
   buffer, noise field) following the froxel-debug pattern — same graph-rebuild constraint.
4. **Tests.** Unit: LUT integrand values, sun-disk angular size, mode→stage mapping, IGN/beam-space
   math (pure helpers), preset tables, dust settings plumbing. Extend the `lighting:verify` npm
   script with the new test files. Visual: add the five QA poses to the shot battery with stats
   JSON so future regressions are caught by `qa`/battery runs.

---

## 4. Verification protocol (applies to every phase)

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort   # separate shell

# perf (same world/warmup/frames for baseline + after; warmup 600 when compute changed)
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 600 --frames 300 --case current-textured --out perf-runs/lighting-<phase>-after"
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npx tsx tools/postfx-perf-matrix.ts --case postfx-default,postfx-godrays-cheap,postfx-godrays-heavy,postfx-godrays-volumetric --world 8 --warmup 600 --frames 600 --out perf-runs/lighting-<phase>-matrix"

# deterministic shots for the five QA poses
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run shoot -- --scene phase1-terrain --seed 1 --world 8 --freeze 1 --hud 1 --framealign 0 --out shots/lighting-plan/<pose>.png --stats shots/lighting-plan/<pose>-stats.json"
```

Report per phase: frame p50/p95, render p95, god-rays/froxel pass timings, shot paths + stats, and
any visual tradeoff found. Unbenchmarked changes are stated as such.

---

## 5. Risks & accepted limitations

- **Screen-space limit (accepted):** shafts only exist while the sun is on/near screen; the soft
  fade prevents pops, and `volumetric` mode's fog keeps atmosphere when the sun leaves frame. If
  gameplay later demands shafts with the sun far off-screen, Appendix A is the path — do not try
  to stretch the screen-space march to cover it.
- **Noise vs. TAA:** dust drift must survive TRAA (history weight 0.88) without smearing into mush;
  tune `dustSpeed` against the movement-route ghosting probe. With TAA off (perf preset), residual
  grain is accepted as part of the dusty look.
- **TSL/three r185 API friction** for half-res MRT reuse; mitigation: the `HalfResMrtNode` pattern
  is already proven for clouds/AO/bounce, and the full-res fallback stays behind a flag.
- **Double-glow with bloom** around the corrected sun disk; handled explicitly in Phase 4.1.
- **Order-of-landing:** Phase 2 before Phase 1 means shafts temporarily inherit today's paler sun
  color — acceptable; tint updates automatically when Phase 1 lands.

## 6. File impact map

| area | files |
| --- | --- |
| pipeline wiring | `src/gpu/webgpu_postprocess.ts`, `src/gpu/postfx_stage_flags.ts`, `src/gpu/webgpu_postprocess_config.ts` |
| dust god rays stage | `src/gpu/god_rays_screen.ts` (extended: half-res, IGN, dust noise), `src/gpu/postfx_half_res_mrt.ts` (new entry) |
| settings/state/GUI | `src/environment/postprocess_settings.ts`, `src/environment/config/postprocess.yaml`, `src/app/state/environment_state.ts`, `src/app/state/environment_query_overrides.ts`, `src/app/bootstrap/terrain_view_state.ts`, `src/ui/gui/environment_gui.ts`, `src/app/state/postprocess_quality_presets.ts` |
| sky/sun/lighting | `src/gpu/postfx_hillaire_luts.ts`, `src/gpu/sky_node_material.ts`, `src/environment/lighting_model.ts`, `src/environment/config/lighting_model.yaml` |
| fog fixes | `src/gpu/postfx_froxel_volume.ts` (live lighting), `src/gpu/postfx_atmosphere_nodes.ts` (analytic height fog for low presets) |
| perf/QA tooling | `tools/postfx-perf-matrix.ts`, `src/gpu/postfx_perf_gate.ts`, shot battery configs |
| deletions (Phase 2) | `src/gpu/god_rays_volumetric.ts` |

---

## Appendix A — Future track (explicitly out of scope now)

Kept for the record from the first draft; revisit only if the screen-space limitation becomes a
product problem, and only with Phase 0's per-pass timing in place:

- **Froxel temporal reprojection** (blue-noise jitter + history volume, exponential blend ~0.9) —
  removes fog shimmer and halves effective sample cost; prerequisite for froxel-owned shafts.
- **Richer froxel sun visibility**: 8–12 log-spaced heightfield probes toward the sun + far
  sun-visibility atlas reuse beyond probe range.
- **Terrain-only sun depth map** (single 1024² ortho over the froxel range, refresh on
  camera-cell/sun change) for crisp volumetric silhouettes — decision-gated at ≤ 0.5 ms p95 and a
  clear visual win over the dust stage in the sun-behind-trees pose.
- Froxel lateral resolution 192×108 on ultra; unified phase function (`mieG`) between aerial and
  froxels.
