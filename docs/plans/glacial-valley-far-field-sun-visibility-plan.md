# Plan 2 — Far-Field Sun Visibility & Fog Shafts (from glacial-valley)

> Created: 2026-06-17 · Status: Planning
> Scope (Bevy): `assets/config/naadf.yaml`, `assets/config/fog.yaml`,
> `assets/config/atmosphere.yaml`, NAADF visibility pass, far-shell/CLOD page summaries
> Scope (clod-poc): `tools/clod-poc/src/` (terrain field + environment/fog shaders)
> Parent: [`glacial-valley-port-overview.md`](glacial-valley-port-overview.md)
> Siblings: [`naadf-hdda-execution-plan.md`](naadf-hdda-execution-plan.md),
> [`laas-cdlod-far-field-reference-plan.md`](laas-cdlod-far-field-reference-plan.md)

## What this is / is not

- **Is:** using glacial-valley's **baked heightfield sun-visibility ray-march** as a
  concrete, working **reference** for the far-field/cached sun-visibility that NAADF
  and the CLOD far-shell already plan — plus the trick of **feeding that visibility
  into the fog term** so shaded air stays cold-blue and sunlit air warms (light shafts
  for free).
- **Is not:** a near-terrain technique. **GV-G0 forbids** a heightfield owning editable
  ground. The bake is per-cell over a height grid; Drusniel's near terrain is
  volumetric with caves/overhangs, so visibility there must come from the voxel field
  (NAADF), not a height grid. This plan keeps the bake strictly to **Zone 3 outer far
  field** + as a cheap **coarse summary** for distant shadowing.
- **Static-sun caveat:** glacial-valley bakes once because the sun never moves.
  Drusniel has moving time-of-day, so a one-shot bake is wrong for runtime. The borrow
  is the **algorithm shape** (march along sun azimuth over a height/summary grid,
  compare ray height to terrain), re-evaluated per the existing NAADF cadence or per
  coarse far-field update — never the "bake once at load" assumption.

## How glacial-valley does it (grounded)

1. **Bake** ([`bakeShadows`, main.js:176-204](../reference/glacial-valley/main.js#L176-L204)):
   for each grid cell, march along the horizontal sun direction with a **growing step**
   (`stp *= 1.10`, 44 steps), sample bilinear terrain height, and take a **soft**
   visibility `clamp(0.5 + (ray-terrain)/(d*0.035))` so penumbra is gradual, not binary.
2. **Store** two bakes (morning/evening) in texture channels G/B alongside height in R
   ([`gridTexture`, :206-218](../reference/glacial-valley/main.js#L206-L218)).
3. **Blend at runtime** by sun position
   ([`visFrom`/`sunVis`, shaders.js:89-98](../reference/glacial-valley/shaders.js#L89-L98);
   weights set in [`updateDayNight`, main.js:968](../reference/glacial-valley/main.js#L968)) —
   `vis = G·wMorning + B·wEvening + max(1-wM-wE,0)` (high sun ⇒ unshadowed).
4. **Feed fog**: `applyAtmo` ([`shaders.js:154-173`](../reference/glacial-valley/shaders.js#L154-L173))
   computes a height-falloff mist integral and **tints it by `sunVis` at the midpoint**
   ([:168-169](../reference/glacial-valley/shaders.js#L168-L169)) — shaded fog is cold,
   lit fog is warm. That single line is the "god-ray-ish" payoff, far cheaper than
   volumetrics.

## Bevy plan

### FV-1 Far-field visibility summary (reference-shaped, not baked-once)
- Where NAADF / the CLOD far-shell already maintain a coarse height/occupancy summary,
  add a **sun-visibility channel** computed by the glacial-valley march shape (growing
  step, soft penumbra clamp) over that summary, re-evaluated on the existing NAADF
  update cadence or far-shell rebuild — **not** per frame, **not** for in-bubble cells.
- Reconcile with [`naadf-hdda-execution-plan.md`](naadf-hdda-execution-plan.md): if
  NAADF already yields sun visibility over voxel summaries, this plan contributes only
  the **soft-penumbra clamp** and **growing-step march** as a tuning reference for the
  *far* tier and the explicit decision to store it where the far-shell can read it.
- **Verify (bench):** distant mountains cast long soft shadows on the far field;
  in-bubble shadows unchanged (CSM/PCSS still own those); `visual-regression-live-lod`
  mesher/selection rows flat (GV-G0 firewall holds); report `summary.json` deltas.

### FV-2 Sun-visibility-tinted height fog (the cheap shafts)
- In the fog/atmosphere shader, multiply the **fog in-scatter color** by far-field sun
  visibility sampled at the view-ray midpoint, à la
  [`applyAtmo:168-169`](../reference/glacial-valley/shaders.js#L168-L169): shaded air →
  cold tint, sunlit air → warm. Drive strength from `fog.yaml`/`atmosphere.yaml`.
- This is **froxel/height-fog occlusion**, the item the NAADF plan lists (sun mask →
  fog occlusion) before volumetric GI. Keep it as a multiply on the existing fog, not a
  new pass.
- **Verify (bench):** valley-shadow air reads cold and sunlit air warm across a
  time-of-day sweep; fragment-cost delta within `bench_guard`; no banding at the
  far-shell seam.

### FV-3 (optional) Cave-mouth shafts via voxel summaries
- Only after FV-1/2: feed NAADF voxel-summary visibility (not the height grid) into the
  fog term near cave mouths so shafts read at openings. This is the genuinely volumetric
  case the height bake **cannot** do — explicitly the NAADF path, cited here so the
  far-field borrow doesn't get mis-applied to caves.
- **Verify:** shafts appear at cave mouths in a known cave scene; benched.

## clod-poc plan

clod-poc is the cheapest place to validate the **march + soft-penumbra + fog-tint**
loop before the Bevy summary work, exactly as glacial-valley demonstrates it:

| clod-poc step | Action |
|---|---|
| **Field source** | clod-poc has a terrain field ([`terrain.ts`](../../tools/clod-poc/src/terrain.ts)). Add a coarse height/summary grid (it may already sample heights for collision). |
| **March** | Port `bakeShadows` ([main.js:176-204](../reference/glacial-valley/main.js#L176-L204)) as a coarse visibility grid; re-run it when the (debug) sun direction changes, not once. |
| **Fog tint** | In the environment/fog shader ([`environment.ts`](../../tools/clod-poc/src/environment.ts)), tint fog by sampled visibility ([`applyAtmo:168-169`](../reference/glacial-valley/shaders.js#L168-L169)). |
| **Control** | `lil-gui` toggle + sun-direction slider so a human can A/B the cold/warm fog and confirm the Bevy port matches. |

- **Parity:** same march params (step growth 1.10, 44 steps, penumbra `/(d*0.035)`),
  same fog-tint formula names; clod-poc is the look-dev surface.

## Guardrails

- **GV-G0:** the height-grid march owns **only** Zone 3 + coarse far summaries. Never
  in-bubble, never replacing NAADF voxel visibility for near/cave geometry.
- **No baking-once:** re-evaluate with time-of-day; the static-sun bake is a shape
  reference, not a runtime model.
- **No fog draw-distance cutout** (far-field plan's standing ban): fog *tint* by
  visibility is allowed; fog *hiding* far geometry is not.
- **Bench FV-1/2/3**; the live-lod scene is the firewall proof.

## Reference index

- Shadow bake: [`main.js:176-204`](../reference/glacial-valley/main.js#L176-L204)
- Vis texture pack + blend: [`main.js:206-218`](../reference/glacial-valley/main.js#L206-L218), [`shaders.js:89-98`](../reference/glacial-valley/shaders.js#L89-L98)
- Sun-vis-tinted fog: [`shaders.js:154-173`](../reference/glacial-valley/shaders.js#L154-L173)
- Sibling mechanism: [`naadf-hdda-execution-plan.md`](naadf-hdda-execution-plan.md), [`laas-cdlod-far-field-reference-plan.md`](laas-cdlod-far-field-reference-plan.md)
- Drusniel config: [`naadf.yaml`](../../assets/config/naadf.yaml), [`fog.yaml`](../../assets/config/fog.yaml), [`atmosphere.yaml`](../../assets/config/atmosphere.yaml)
