# Lookdev Render Fixes — Reference (2026-07-19)

Reference for the render-path work done across three sessions on 2026-07-19, driven by
the L0 lookdev gallery (`tools/lookdev-gallery.ts`, infinite-islands, quality=ultra,
renderPreset=ultra, materialTiers=1, agx). Commits: `1aeed3b03 fix clouds`,
`f2706ae98 ocean fixes`, plus the far-clipmap ocean + water-defaults changes that
followed.

Evidence galleries (same five probe-driven poses each):

| Run | State |
| --- | --- |
| `qa-runs/lookdev-2026-07-19/` | Baseline: egg-crate cloud ceiling, global blue wash, beige far field |
| `qa-runs/lookdev-2026-07-19-fix1/` | Atmosphere + clouds fixed; beige far field unmasked |
| `qa-runs/lookdev-2026-07-19-fix2/` | Water ripple/SSR fix (pool marbling reduced) |
| `qa-runs/lookdev-2026-07-19-fix3/` | Far-clipmap ocean: blue archipelago horizon |
| `qa-runs/lookdev-2026-07-19-fix4/` | Water deep-color/fresnel lift (final state of this pass) |

## 1. Aerial perspective rewrite (the "global blue wash")

Root causes, verified in code:

- `postfx_atmosphere.yaml` extinction values (`0.00135` / `0.0026`) were per-km-magnitude
  coefficients applied **per meter** in `src/gpu/postfx_atmosphere_nodes.ts`.
- The in-scatter term was non-physical: it multiplied optical depth × `(1−T)` ×
  `strength(0.4)`, so full energy was removed but only 40% of scattered light added
  back — distance **darkened** instead of lightening.
- A `distanceFade = smoothstep(0, 12km, d)` lerp partially hid the bug near-field
  (an earlier external analysis claimed "98% energy gone at 1 km"; that missed this
  fade — the real mechanism was the mid-far convergence to `inscatter × 0.4`).
- The "Hillaire LUTs" (`postfx_hillaire_luts.ts`) were analytic CPU fills sampled with
  wrong parametrization (sun-elevation/height indexed, not view-path; sky-view ignored
  sun azimuth).

Changes (`src/gpu/postfx_atmosphere_nodes.ts`, `src/gpu/postfx_atmosphere.ts`,
`src/environment/config/postfx_atmosphere.yaml`):

- Per-meter physical extinction: `rayleigh_extinction: 1.35e-5` (green channel),
  `mie_extinction: 2.1e-5`, RGB spread via exported `RAYLEIGH_SPECTRAL_RATIO =
  [0.43, 1.0, 2.45]` so red survives farther than blue.
- Energy-conserving composition: `color·T + (1−T)·inscatter·strength`, 4π-normalized
  phases (Mie phase clamped ≤4), `strength: 1.0`.
- Removed the `distanceFade` hack and all LUT sampling; deleted
  `postfx_hillaire_luts.ts` + test + wiring in `webgpu_postprocess.ts`.
- CPU reference implementation `aerialPerspectiveReference()` + tests (near field
  <5% change at 1 km; `T.r > T.g > T.b`; dark terrain lightens toward horizon).

Gotcha for future work: **`aerial_perspective.yaml` only feeds the legacy WebGL
composite (`src/environment/postprocess.ts`)** — it is inert on the WebGPU path.
WebGPU config is `postfx_atmosphere.yaml`.

## 2. Volumetric clouds rewrite (the "egg-crate ceiling")

Root cause: single-octave value noise at `[0.00135, 0.002, 0.00135]` (~741 m XZ /
500 m Y cells) marched with 24 steps over 14 km (~583 m/step) — step size ≈ cell size
exposed the interpolated lattice. "Detail" was the same noise on a rotated domain
(28% blend); jitter was time-varying with no cloud reprojection (crawl).

Changes (`src/gpu/postfx_cloud_nodes.ts`, `src/environment/config/postfx_clouds.yaml`):

- 3-octave fBm with skewed rotations between octaves (no shared lattice axes),
  2-octave rotated erosion carving edges, scalar domain warp (~520 m along a fixed
  non-axis direction). Base scale `0.00052`, lacunarity `2.17`.
- Steps 24→32; static per-pixel jitter; sun-occlusion march uses a cheap 2-octave
  density; erosion skipped where coverage ≈ 0; per-step early-out when
  transmittance < 0.02. Clouds remain in the half-res pass.
- `coverage` semantics changed: soft threshold on fBm (mean ~0.5); yaml set to `0.56`
  (lower = more sky covered).

## 3. Far-field ownership discovery (critical map for all far work)

Found by live probing (`tools/probe-far-ocean.ts`,
`window.__drusnielInfiniteFarShell`, `window.__drusnielFarOwnership`):

- infinite-islands **rewrites its own boot URL**, appending
  `farSummaryLayout=2&farClipmap=1&farClipmapMode=replace`.
- In replace mode the **far clipmap** (`src/terrain/far_clipmap/*`) owns the far band
  (~768 m..8192 m). The `InfiniteFarShell` is hidden and intentionally never receives
  a height provider — before this was understood, the beige horizon was misattributed
  to the shell.
- Deep-ocean summary tiles are never built, so far-clipmap cells fell back to raw
  heights (ocean floor ≈ 0 < seaLevel 18) with water coverage `−1` → dry-sea-floor
  sand to the horizon.

## 4. InfiniteFarShell ocean clamp (non-replace profiles)

`src/long-view/infiniteFarShell.ts`, `infinite_far_shell_types.ts`, bootstrap wiring:

- New `seaLevelMeters` option (wired from `world.worldSource.metadata.seaLevel`).
  CPU rebuilds clamp below-sea vertices to sea level, flatten their normals, and
  color them ocean in both color paths (the parity classifier only knows land bands,
  so underwater terrain classified as beach otherwise).
- Verified live via manual rebuild: 16,005 / 18,721 vertices ocean-clamped.
- Test added in `infiniteFarShellHeightMode.test.ts`.

## 5. Far-clipmap ocean (the actual lookdev fix)

`src/terrain/far_clipmap/far_clipmap_material.ts`, `far_clipmap_controller.ts`:

- CPU fill: cells **without** summary tiles that sample below `seaLevelM` synthesize
  open ocean (`waterLevel = seaLevelM`, `bodyKind 1`, coverage 1). Tile data stays
  authoritative when present.
- WebGPU node material previously computed `waterMask` and lifted water vertices to
  water level but **rendered land color regardless**. Now:
  `finalColor = mix(landColor, waterBodyColor, waterMask)` with a shallow→deep ramp
  (`[0.10,0.30,0.34]` → `[0.055,0.13,0.24]` over 0.4–6 m depth).
- `seaLevelM` passed from `config.seaLevelM` at the single update call site.
- Tests added in `far_clipmap_material.test.ts` (ocean fallback synthesis, dry cells
  stay dry, water-coloring source assertion).

## 6. Water surface fixes (HQ material)

`src/water/waterNodeMaterial.ts`:

- Ripples: the paired axis-aligned sinusoids (stable moiré/marbling in calm pools)
  replaced by four rotated directional waves with non-harmonic frequencies
  (1.0 / 1.83 / 3.11 / 5.27) via `rippleGrad()`.
- SSR: step length cap 28→14 m; hit-acceptance window `stepLen×2.6+0.7` →
  `stepLen×1.35+0.5` (wide windows accepted unrelated depth surfaces → alternating
  dark/bright bands); misses fall back to stable sky.
- Verified same-pose (`fix1` vs `fix2` `agx-river-close.png`): marbling visibly reduced.

`src/water/water_config_defaults.ts`:

- `deepColor [0, 0.025, 0.12]` → `[0.012, 0.06, 0.17]`; `fresnel.base 0.045` → `0.065`
  (deep pools read pure black from steep angles where fresnel adds no sky).
  Value-pinning tests updated (`deep_ocean_material.test.ts`, `water_rock_flour.test.ts`).
- **Known divergence**: the WebGL fragment (`water_glsl_fragment.ts`) still hardcodes
  the old deep color.

## 7. Tooling added

- `tools/probe-far-ocean.ts` — boots the scene headless, dumps far-summary provider
  samples, shell internals, boot URL/ownership; supports manual shell rebuild A/B.
- `window.__drusnielInfiniteFarShell` debug global (bootstrap).
- Harness notes: `CHROME_PATH` must use forward slashes; the lookdev gallery runs
  against the user's dev server at `http://127.0.0.1:5180` (do not start a second
  server); `withWaterHarness` appends `waterDebug=1` only — the rest of the boot URL
  rewrite comes from the app itself.

## 8. Verification state and caveats

- `typecheck`, `vitest` (full suite green at session end), and `vite build` all pass.
- Visual verification via the gallery runs listed above; no per-frame **performance
  benchmark** was run for these changes. The cloud pass is ~2× worst-case ALU
  (mitigated by early-outs and the cheap light march) — run the perf harness before
  attributing any frame-time shift.
- Some parallel work was committed by the user mid-session; always re-check
  `git status` before assuming tree state.

## 9. Open items (handed to the near↔far transition session)

1. Near CLOD pages → far clipmap seam — diagnosis verified and plan reviewed in
   section 10; implementation in flight in `far_clipmap_material.ts` /
   `far_clipmap_controller.ts`.
2. Far-clipmap biome color banding and hard snow/white thresholds (part of item 1).
3. Pool centers still dark from steep angles (taste pass on body colors/scatter).
4. Vegetation reads dark — reassess only after lighting/transition settles.
5. Cloud look tuning (dark bases, coverage) — knobs, not bugs, after the rewrite.

## 10. Near↔far seam — verified diagnosis and reviewed plan (addendum)

An external analysis proposed three independent causes for the still-obvious seam.
All three were verified against the code:

1. **Palette disagreement (dominant) — confirmed with exact numbers.** Near terrain
   bands textures by absolute Y (`src/textures/terrainTextureArrays.ts`): grass
   22–66 m, rock 58–106 m, snow 86–132 m. The far clipmap painted hardcoded
   olive/tan constants with its snow band at `seaLevel+150..+270` — i.e. 168–288 m
   absolute at seaLevel 18, nearly 2× the near snow onset. Different hues AND
   different thresholds.
2. **Band quantization — confirmed.** Hard smoothsteps on `materialId`/elevation with
   zero spatial noise render as horizontal stripes.
3. **No mid-range haze — right conclusion, understated numbers.** The analysis said
   ~5–8% extinction at 4 km (Rayleigh-only); combined Rayleigh+Mie loss with the
   landed coefficients is ~10% red / ~13% green / ~19% blue at 4 km. Either way,
   too subtle to soften the hand-off.

Accepted plan (ranked): (1) bake-time per-layer average-albedo LUT with a recipe
fallback for non-resident layers, wired into `createProceduralTerrainTextures`;
(5) rewrite the far-clipmap WebGPU land palette to use the near elevation bands and
LUT colors, with per-vertex noise jitter on thresholds to kill striping (water path
untouched); (3) config-only mie-extinction raise for mid-range haze. Option (2)
(shader blend band at the ownership boundary) deferred until a residual edge is
proven — the ownership mask + `pageToShellBlendM` machinery exists if needed.
Option (4) (triplanar detail on inner far rings) deferred as most expensive.

Amendments added during review:

- **Single-source the thresholds.** Import/export the band definitions from
  `terrainTextureArrays.ts`; copying `22/66/58/106/86/132` as new literals into the
  far material recreates exactly the divergence being fixed.
- **World-anchor the threshold jitter** (key on `worldXZ`, not grid index), or ring
  refreshes/snaps make the dithered band edges crawl.
- **Albedo matching alone is not enough — lighting response must match.** Near
  terrain is lit through the standard material path; the far clipmap is a
  `MeshBasicNodeMaterial` with a hemispheric approximation (with a `max(0.5, …)`
  floor). Calibrate the palette `uExposure` against captured near-terrain pixels
  just inside the seam vs far pixels just outside in the same shot, not by eye.
  (The in-flight implementation also wires live environment lighting into ring
  materials via `getLighting` on the controller.)
- **Mie-raise side effects to check in captures:** a single coefficient touches the
  near field too (~6e-5 keeps 1 km loss ≈6% — verify river-close stays crisp), and
  the forward phase lobe (g=0.76, capped at 4) grows a sun halo as mie rises —
  check a sun-facing pose and lower `mie_g` if it blooms. With the
  energy-conserving in-scatter form, raising mie is guaranteed to lighten.
- **Verification additions:** capture at least one grazing-angle pose looking along
  the seam (band edges and the zigzag are worst there; the standard five poses view
  it mostly head-on), plus one `materialDebugMode=ownership` shot so palette
  agreement cannot mask an ownership regression. Baseline remains
  `qa-runs/lookdev-2026-07-19-fix4`; perf A/B per CLAUDE.md for any frame-touching
  change.

Implementation state at time of writing: `terrain_layer_average_albedo.ts` (+ test)
exists; `far_clipmap_material.ts` carries palette uniforms
(`uGroundMeadow…uSand/uRock/uSnow`, `uExposure`) resolved from near-terrain layer
averages with revision-based re-resolve after texture re-bakes;
`far_clipmap_controller.ts` gained frame-uniform updates and live lighting wiring;
tests cover palette resolution and re-bake refresh in
`far_clipmap_material.test.ts`.

## 11. Industry patterns for the near↔far hand-off (reference)

Shipped-game techniques for this exact problem, ranked by fit:

1. **Near converges to far via a world macro color map** (Horizon Zero Dawn,
   The Witcher 3): one low-frequency world albedo is the hue authority; far renders
   only it, near blends toward it with distance, so the seam vanishes by
   construction. Stronger than far-imitates-near averaging — a macro map keeps
   spatial variation. Our far-summary tiles could serve as that authority.
2. **Detail layers normalized to average-neutral** (MS Flight Simulator): divide
   each near detail layer by its average at bake time and move the hue into the
   shared base; mip-fading detail then lands exactly on the far color with no
   exposure calibration.
3. **Bake far tiles by rendering the near material top-down at low res**
   (Frostbite virtual texturing, Ghost of Tsushima): far color = actual near shader
   output, amortized per tile rebuild. Highest-fidelity endpoint of
   "adjust to expected texture".
4. **Ground albedo under fading vegetation = vegetation average color**
   (Ghost of Tsushima grass): makes distance fade of grass/understory/canopy
   invisible. `GRASS_SHARED_BASE_LINEAR` sharing is the start of this.
5. **Sky-matched horizon haze** (Valheim, Breath of the Wild): fog/in-scatter color
   sampled from the sky gradient at the horizon (or an art-directed per-time-of-day
   ramp) instead of a fixed constant — far terrain dissolves into whatever the sky
   is doing and forgives residual palette error.
6. **Dithered cross-fade band resolved by TAA** (Unreal LOD fades, No Man's Sky):
   render both owners over a 100–300 m band, blend with screen-space blue-noise
   dither; kills the zigzag page edge and LOD silhouette pops; double-shading only
   inside the band. Ownership mask + TAA already exist here.
7. **Baked distant impostors / periodically re-rendered horizon cubemap**
   (GTA V LOD city, Elden Ring baked distant meshes, Sea of Thieves island
   billboards): beyond ~8 km, render the mostly-static far field into a cubemap on
   rebase-snap (one face per N frames) and composite as sky — outermost band
   becomes nearly free and perfectly stable.
8. **Stylized silhouette layering** (Firewatch): flatten far terrain into a few
   tonal bands lerped toward the horizon tint; reads as intentional style, cheapest
   option, legitimate destination for a stylized target.

Suggested sequence: finish palette/LUT work → (5) sky-matched haze tint →
(6) dither band → (1)/(3) if palette matching plateaus → (7) for the outermost
ring → (8) as the always-available taste lever.

**Project-fit recommendation (given the 90 fps goal and current setup):** the known
perf bottleneck is CPU-side far-ring source refresh (p95), not shading ALU — which
disqualifies (3) for now (adds render-target work to the tile-rebuild path) and
defers (7). Chosen chain: finish palette/LUT → **(5)** sky-matched haze (few ALU in
an owned full-screen pass, zero CPU, biggest payoff-per-cost; forgives residual
palette error) → **(1)-lite**: the macro authority already exists as far-summary
tiles / `farSummaryGpuAtlas`, so the near CLOD material can distance-gate one
summary-color sample from ~400–700 m and lerp toward it, making near *arrive* at
the far palette before the hand-off → **(6)** only for whatever geometric seam
survives, gated to TAA-on profiles (dither reads as noise without TAA).
(8) stays as zero-cost insurance once the horizon is honest. Nothing in the chain
touches the tile-refresh path; each step gets a gallery re-capture vs fix4 and a
perf A/B, with only (1)-lite expected to register in the numbers.
