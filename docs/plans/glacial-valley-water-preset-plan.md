# Plan 1 — Glacial Water Preset (from glacial-valley)

> Created: 2026-06-17 · Status: Planning
> Scope (Bevy): `assets/config/water.yaml`, `assets/shaders/water_fragment.wgsl`,
> `water_functions.wgsl`, `water_reflection_compositor.wgsl`, `src/rendering/water/`
> Scope (clod-poc): `tools/clod-poc/src/` (water material, when one exists)
> Parent: [`glacial-valley-port-overview.md`](glacial-valley-port-overview.md)
> Sibling (mechanism owner): [`water-renderer-visual-upgrade-plan.md`](water-renderer-visual-upgrade-plan.md)

## What this is / is not

- **Is:** a **cold/glacial water preset** — values and a small number of shading
  terms unique to glacial water (turquoise rock-flour scattering, fast per-channel
  red absorption, depth-faded caustics, drop-keyed rapid foam, tight sun glitter).
- **Is not:** a new water pipeline. The transmission/Fresnel/reflection *machinery*
  is owned by the [sibling water-upgrade plan](water-renderer-visual-upgrade-plan.md).
  This plan **adds a preset and two cheap terms on top of it.** If the sibling plan
  has not landed Phase 1–2 yet, this plan supplies the *target look* those phases aim
  at for cold bodies; land them first, then dial the preset.

License is cleared ([overview](glacial-valley-port-overview.md)); translate the GLSL
to WGSL and adapt to our bindings (correctness, not legal).

## The glacial look, grounded in the reference

glacial-valley's water frag ([`shaders.js:377-475`](../reference/glacial-valley/shaders.js#L377-L475))
composes these, in order:

| Term | Reference | What makes it "glacial" |
|---|---|---|
| **Per-channel absorption** of the refracted bed | [:432](../reference/glacial-valley/shaders.js#L432) `exp(-path * vec3(0.62,0.18,0.14)*1.5)` | red dies ~4× faster than blue → teal deepening |
| **Rock-flour in-scatter** | [:433-435](../reference/glacial-valley/shaders.js#L433-L435) `(1-exp(-path*0.30))` × `vec3(0.07,0.38,0.36)` × sky/sun ambient | the milky turquoise; scatter color is the signature |
| **Depth-faded caustics** | [:425-429](../reference/glacial-valley/shaders.js#L425-L429) Voronoi `^5`, `× exp(-depth*1.8)` | bright in shallows, gone in deep |
| **Bed-gradient rapids** | [:403-406](../reference/glacial-valley/shaders.js#L403-L406) `smoothstep(slope) × smoothstep(shallow)` → choppier normals + foam | whitewater only where the bed steps in shallow water |
| **Rapid/shore/streak foam** | [:461-470](../reference/glacial-valley/shaders.js#L461-L470) three fbm bands | froths at drops, clears on calm reaches |
| **Sun glitter** | [:456-459](../reference/glacial-valley/shaders.js#L456-L459) `pow(ndh,750)*1.6 + pow(ndh,90)*0.07` | tight sparkle + soft sheen for low sun |
| **Reflection darkened by coarse march** | [:437-452](../reference/glacial-valley/shaders.js#L437-L452) 5-step heightfield march | mountains darken the rim instead of bright sky |

**Mapping to the sibling plan:** absorption + refraction = sibling Phase 1; Fresnel +
reflection blend = Phase 2; flow ripples = Phase 3; slope foam = Phase 4; dark-bank
rim = Phase 5. So glacial-valley **confirms and tunes** that roadmap. The two genuinely
*new* contributions here are (a) the **rock-flour in-scatter color term** and (b) the
**preset values** that say "cold turbid alpine," neither of which the LAAS plan carries.

## Bevy plan

### GW-1 Add a glacial preset block to `water.yaml`
- Add a `glacial_river` and `glacial_lake` preset with: per-channel `absorption_rgb`
  (high R, low G/B), `rock_flour_scatter_color` (teal, ≈`(0.07,0.38,0.36)`),
  `scatter_strength`, `caustic_depth_falloff`, `rapid_foam_gain`, `glitter_tight`/
  `glitter_soft` exponents. Reuse existing `clarity`/`murkiness`/`deep_color` plumbing
  where it already exists (the sibling plan notes these are plumbed to the compositor).
- **Verify:** preset loads; selecting it on a body changes only that body; no shader
  change yet (values feed existing terms).

### GW-2 Rock-flour in-scatter term (the one new shading term)
- In the compositor's transmission path (where sibling Phase 1 computes column
  thickness + per-channel absorption), add the additive in-scatter
  `scatter = (1 - exp(-thickness * scatter_k)) * rock_flour_color * ambient`, ambient
  tracking sun-vis + sky as in [`:434`](../reference/glacial-valley/shaders.js#L434).
  Drive `scatter_k`/color from the preset. Gate behind a `shader_def` so non-glacial
  bodies pay nothing.
- **Verify (bench):** glacial bodies read milky-turquoise with red-absorbed depth;
  clear bodies unchanged; fragment-cost delta within `bench_guard` threshold on the
  water bench scene. Report scene + before/after `summary.json` per CLAUDE.md.

### GW-3 Drop-keyed rapid foam + caustic depth-fade tuning (preset-only if sibling P4 landed)
- If sibling Phase 4 (slope-keyed rapid foam) is in: just tune via `rapid_foam_gain`
  + the bed-drop threshold to the glacial values. If not: this plan's GW-3 is the
  trigger to land that term, keyed on bed gradient along flow
  ([`:403-406`](../reference/glacial-valley/shaders.js#L403-L406)), and fade caustics
  by `exp(-depth·k)` with `k = caustic_depth_falloff`.
- **Verify:** rapids froth at bed steps, calm reaches clear; caustics fade with depth;
  benched.

### GW-4 Glitter tuning
- Expose the two specular exponents (tight glint + broad low-sun sheen) as preset
  values feeding the existing sun-spec term. Low morning/evening sun should sparkle.
- **Verify:** visible glitter at low sun angles in the time-of-day sweep; benched.

## clod-poc plan

clod-poc water today is a flat `WATER_LEVEL` material band (no surface mesh) — see the
sibling plan's Phase 7 note. Two cases:

| State | Action |
|---|---|
| **No water surface mesh** | Skip the shading port. Add only the **preset values** to the content config so the look is authored once and shared with Bevy. |
| **A water plane gets added** (e.g. for the river spike in [Plan 3](glacial-valley-braided-river-worldgen-plan.md)) | Port a *minimal* glacial frag: per-channel absorption of the refracted scene + rock-flour in-scatter + depth caustics + sun glitter. This is the literal translation of [`shaders.js:377-475`](../reference/glacial-valley/shaders.js#L377-L475) re-implemented (GV-G1), and the cheapest place to dial the preset before the Bevy WGSL port. |

- **Parity:** preset value names match `water.yaml`; clod-poc is the look-dev surface,
  Bevy is validated against it ([overview §clod-poc preview](glacial-valley-port-overview.md)).

## Guardrails

- **Don't replace planar reflections** — Drusniel's are better than glacial-valley's
  5-step march for lakes (sibling plan "Keep" list). The march is only a *reference*
  for the dark-bank rim (sibling Phase 5).
- **Preset, not default:** glacial values must not bleed into temperate/tropical bodies.
- **Bench every shading phase** (GW-2/3/4) on the water bench scenes; presets-only
  steps (GW-1) need no bench.

## Reference index

- glacial water frag: [`shaders.js:377-475`](../reference/glacial-valley/shaders.js#L377-L475)
- Drusniel water: [`assets/shaders/water_fragment.wgsl`](../../assets/shaders/water_fragment.wgsl), [`water_reflection_compositor.wgsl`](../../assets/shaders/water_reflection_compositor.wgsl)
- Presets: [`assets/config/water.yaml`](../../assets/config/water.yaml)
- Mechanism owner: [`water-renderer-visual-upgrade-plan.md`](water-renderer-visual-upgrade-plan.md)
