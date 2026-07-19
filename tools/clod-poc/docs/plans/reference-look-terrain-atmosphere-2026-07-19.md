# Reference Look: Erosion-Shaped Terrain, Atmosphere, Grading

Status: PROPOSED (design pass, not yet accepted)
Date: 2026-07-19
References: Braffolk/fable5-world-demo (erosion-simulated heightfield, Hillaire LUT sky,
PCSS cascades, TAA, filmic grade), deedy/glacial-valley (erosion-weighted fBm + ridged
multifractals + domain warping, ray-marched heightfield shadows, Beer-Lambert water,
ACES + vignette + adaptive exposure).

## Finding that reframes the scope

Most of the "missing" rendering features already exist in this repo and simply never
appear in our evidence artifacts:

| Capability | Status | Where |
| --- | --- | --- |
| Tonemapping | SHIPPED, AgX default (aces/agx/linear/none via `toneMap=`) | `environment/postprocess.ts` |
| Bloom, vignette, contrast/saturation grade | SHIPPED, on by default | same |
| Aerial perspective | SHIPPED, per quality preset (off in the lowest preset) | `app/state/postprocess_quality_presets.ts` |
| Froxel atmosphere / god rays / forest fog | SHIPPED | `gpu/postfx_atmosphere.ts`, forest lighting config |
| Contact shadows, FXAA, clarity sharpen | SHIPPED, on by default | postprocess settings |
| TAA | shipped, default OFF | postprocess settings |
| HQ water (SSR, caustics, rock flour, shore fade) | SHIPPED, WebGPU default (W3) | `water/` |
| Domain-warped fBm + ridged massifs + macro valleys | SHIPPED | `gpu/terrain_field_core_math.ts:181` |
| Erosion shaping of the base field | **MISSING** | — |
| Reference-grade material/albedo tuning | PARTIAL (material tiers exist, garish defaults) | biome visuals |

Every screenshot that motivated "the shaders don't look very good" was captured under
`performance100`, renderScale 0.5–0.85, material tiers OFF, aerial perspective OFF.
The renderer has never been *shown* at its best in QA evidence. Therefore the plan
starts with evidence, not code.

## Phase L0 — lookdev capture profile + config-only tuning (no product code)

1. Define a canonical **lookdev profile** for captures: quality preset (aerial
   perspective on), material tiers on, HQ water, renderScale 1, DPR 1, `toneMap=agx`
   and `toneMap=aces` A/B, fixed sun angle + seed + poses.
2. Add a small pose battery (river close, river aerial, ridge line, coastline, forest
   interior) to the shot harness; output a dated gallery under `qa-runs/lookdev-<date>/`.
3. Config-only tuning pass against the reference stills: grade (contrast/saturation/
   vignette), bloom threshold/strength, fog/aerial-perspective color+density, sun
   elevation/color, biome albedo palette (kill the saturated red earth), water tint.
4. Exit gate: side-by-side gallery vs references; the user signs off on what still
   reads wrong. Only items that survive L0 justify code.

Cost: tooling + YAML only. This also fixes the standing evidence problem: future water/
terrain claims can cite lookdev captures instead of perf-preset shots.

## Phase L1 — erosion-shaped base terrain (the real gap)

The references read "real" because valleys are smooth where water would flow and ridges
stay sharp — erosion, not more octaves.

- **Approach: analytic erosion-weighted fBm** (glacial-valley technique): accumulate
  the gradient magnitude across octaves and damp higher-octave amplitude where
  accumulated slope is high (sharp ridges keep detail, basins smooth out), plus a
  slope-aware valley-floor flattening term. Pure per-sample function — no simulation
  grid — so it preserves every architectural contract (infinite streaming, seam-free
  tiles, traced hydrology purity).
- **Rejected for now: simulated hydraulic/thermal erosion** (Braffolk). Grid
  simulation fights the pure-field infinite-world architecture; only revisit per-tile
  with halos if L1's analytic read is judged insufficient in the L2 gallery.
- **Hard requirement: dual implementation + parity.** `surfaceHeightCore` has a WGSL
  mirror consumed by the GPU meshers, far-summary builder, and render atlas. The
  erosion term must land in both, gated by the existing parity infrastructure
  (far-summary strict parity, `compareStreamRootBuilds`, rim-mesher probe).
- **World identity**: new `terrainFieldConfig.erosion` block (enabled/strength/
  damping/valley-flatten), default OFF, A/B-able by URL param. terrainFieldConfig
  already participates in terrain-source identity, so caches bust per-profile without
  a TERRAIN_SOURCE_VERSION bump.
- **Interactions**: traced hydrology retraces on the eroded field automatically (pure
  function of the sampler) and should *improve* — channels follow real valleys, and
  erosion-smoothed valley floors reduce the bank-clamp ratcheting that makes water sit
  deep in trenches. Continuity + verify gates rerun unchanged.
- **Perf**: per-octave gradient accumulation roughly 1.3–1.6× field-eval cost; the
  field is on the hot path for meshing, hydrology tiles, vegetation, and far summary.
  Measure first with a field micro-bench and `build_world` timing, then perf:main.
- Exit gate: lookdev gallery A/B (flag on vs off), verify-traced-carve PASS on the
  eroded profile, field-eval + build_world + frameMs numbers reported.

## Phase L2 — atmosphere/tonemap upgrades only where L0 tuning hit its ceiling

Decided from the L0/L1 galleries, not upfront. Candidates in priority order:
1. Adaptive exposure (stops-down toward the sun; glacial-valley) — small postprocess
   change.
2. Sky model upgrade (Hillaire LUT — Braffolk) IF the current sky/aerial perspective
   reads flat in the gallery. Largest L2 item; needs its own perf gate.
3. Film grain + blue-noise dither on the output pass — trivial, kills banding.

## Phase L3 — material/albedo pass

Slope/altitude-aware blending tuning with material tiers ON (snowline consistency,
wet-bank darkening near water using the existing river wetness mask, cliff strata).
Config-first; shader changes only for gaps the gallery proves.

## Sequencing and ownership

L0 is a prerequisite for judging everything else and is safe to run alongside other
sessions (tooling + YAML). L1 is the largest code item and collides with every terrain
consumer — schedule it when no other terrain-field work is in flight; land JS+WGSL+
parity in one commit. L2/L3 are independent follow-ups scoped by evidence.

## Out of scope

Simulated erosion grids, volumetric clouds, TAA-on-by-default (visual-stability work
owns that), irradiance probes / GI.
