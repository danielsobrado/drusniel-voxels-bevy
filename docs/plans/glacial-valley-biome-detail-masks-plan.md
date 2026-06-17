# Plan 5 — Biome Detail Masks: Mist, Droplets, Motes, Dew, Gravel (from glacial-valley)

> Created: 2026-06-17 · Status: Planning
> Scope (Bevy): `assets/config/weather.yaml`, `assets/config/wind.yaml`, particle/
> weather systems, biome decals, grass/prop placement
> Scope (clod-poc): `tools/clod-poc/src/` (instanced detail + point sprites)
> Parent: [`glacial-valley-port-overview.md`](glacial-valley-port-overview.md)
> Siblings: [`bevy-gpu-vegetation-port-plan.md`](bevy-gpu-vegetation-port-plan.md),
> [`procedural-vegetation-authoring-plan.md`](procedural-vegetation-authoring-plan.md),
> [`clod-poc-grass-port-plan.md`](clod-poc-grass-port-plan.md)

## What this is / is not

- **Is:** porting glacial-valley's cheap procedural **micro-detail driven by
  biome/terrain masks** — river mist, rapid splash droplets, pollen/snow motes in
  sunbeams, dew/frost, gravel-bar pebbles — placed by **water depth, slope, sun
  visibility, and season**, not scattered uniformly.
- **Is not:** "more particles." The value is the **masks** (where detail belongs) and
  the **aggressive culling/fade** that keeps them cheap. Grass/blade rendering itself is
  owned by the [vegetation plans](bevy-gpu-vegetation-port-plan.md); this plan is the
  *ambience layer* on top.

## The detail inventory, grounded

| Detail | Reference | Mask / placement rule |
|---|---|---|
| **River mist sheets** | [`mistField` + shaders.js:738-788](../reference/glacial-valley/main.js#L629-L670) | along the meander, wind-advected, **height-soft-clipped to terrain** ([:778](../reference/glacial-valley/shaders.js#L778)) so sheets never slice ground; sun-vis tinted |
| **Splash droplets** | [`main.js:762-810`](../reference/glacial-valley/main.js#L762-L810) | placed where `rapidMask = slope·2` is high at the shallow waterline, and ringing boulders at the waterline |
| **Motes (pollen/snow)** | [`shaders.js:791-829`](../reference/glacial-valley/shaders.js#L791-L829) | box around the player, **brightness = sunVis · forward-scatter** ([:810-811](../reference/glacial-valley/shaders.js#L810-L811)) — only visible in sunbeams |
| **Dew / frost** | [`main.js:471-488`](../reference/glacial-valley/main.js#L471-L488), [`shaders.js:863-890`](../reference/glacial-valley/shaders.js#L863-L890) | on blade tips; frost where **sun vis is low** (shaded cold ground) |
| **Fish-rise rings** | [`main.js:737-760`](../reference/glacial-valley/main.js#L737-L760) | on **calm** pools: `depth deep AND slope < 0.15` |
| **Gravel bars / pebbles** | [`main.js:491-514`](../reference/glacial-valley/main.js#L491-L514) | near waterline `slope < 0.5`; ties to river bars from [Plan 3](glacial-valley-braided-river-worldgen-plan.md) |

Common thread: each is gated by a **terrain/biome query** ([Plan 4](glacial-valley-terrain-query-discipline-plan.md)
data: water depth, slope, sun vis) and **faded by distance + a season/visual-state
factor** ([Plan 6](glacial-valley-biome-visual-state-plan.md)).

## clod-poc plan (look-dev surface)

clod-poc already has grass + point-sprite plumbing
([`grass.ts`](../../tools/clod-poc/src/grass.ts), instancing helpers). It's the cheap
place to dial each mask.

| Step | Detail | Action |
|---|---|---|
| **DM-c1** | River mist | Port the mist billboard field ([main.js:629-670](../reference/glacial-valley/main.js#L629-L670), [shaders.js:738-788](../reference/glacial-valley/shaders.js#L738-L788)): wind-advected sheets, height-soft-clip, sun-vis tint. Place along the river spike's meander. |
| **DM-c2** | Splash | Port splash droplets keyed on the river spike's `rapidMask` ([Plan 3](glacial-valley-braided-river-worldgen-plan.md) BR-3). |
| **DM-c3** | Motes | Port sunbeam motes; brightness from forward-scatter · sun vis ([Plan 2](glacial-valley-far-field-sun-visibility-plan.md)). |
| **DM-c4** | Dew/frost | Port dew on grass tips + frost-in-shade; gated by sun vis. |
| **Control** | All | `lil-gui` toggles + density sliders per detail; the human A/B surface for Bevy. |
| **Verify** | All | `vitest`/`tsc` green; Pages deploy stays green; each detail individually toggleable. |

- **Parity:** mask names/params match Bevy config; clod-poc is canonical for the look.

## Bevy plan

Each detail is a **biome-masked particle/decal** consuming `TerrainQuery`
([Plan 4](glacial-valley-terrain-query-discipline-plan.md)) and the visual-state vector
([Plan 6](glacial-valley-biome-visual-state-plan.md)). Reuse existing weather/particle
infra ([`weather.yaml`](../../assets/config/weather.yaml)); do **not** build a new
particle engine.

### DM-1 River mist (highest payoff)
- Spawn wind-advected mist cards along water bodies (river/lake), height-soft-clipped to
  terrain, tinted by far-field sun vis. Config: `weather.yaml` `morning_mist.*` (density,
  height band, drift speed, sun-vis tint).
- **Verify (bench):** mist hugs the river, fades into terrain (no hard slice), warms in
  sun / cools in shade; particle cost within `bench_guard`; report `summary.json`.

### DM-2 Rapid splash droplets
- Spawn at waterline cells where `rapidMask` (from [Plan 3](glacial-valley-braided-river-worldgen-plan.md))
  is high; ring boulders/rocks at the waterline. Aggressive distance cull.
- **Verify:** droplets only at rapids/rocks, none on calm reaches; benched.

### DM-3 Sunbeam motes + dew/frost
- Motes: a player-centered volume, **brightness from sun-vis · forward-scatter** so they
  only read in shafts (cheap, additive). Dew on vegetation tips; frost tint where sun vis
  is low. Season-gated by [Plan 6](glacial-valley-biome-visual-state-plan.md).
- **Verify:** motes invisible except in sunbeams; frost only in cold shade; benched.

### DM-4 Gravel bars + fish rings (ambience polish)
- Gravel/pebble material + scatter on river bars (shares [Plan 3](glacial-valley-braided-river-worldgen-plan.md)
  bar mask); fish-rise rings on calm deep pools.
- **Verify:** gravel reads on bars; rings only on calm water; benched.

## Guardrails

- **Cull or it costs:** every detail must distance-cull + fade by visual-state; an
  always-on particle field is a rejected change. Reference does `smoothstep(dist)` fades
  everywhere ([e.g. shaders.js:779, 875](../reference/glacial-valley/shaders.js#L779)).
- **Masks come from the query** ([Plan 4](glacial-valley-terrain-query-discipline-plan.md)),
  not re-derived per system — keeps detail consistent with terrain/water/props.
- **Reuse weather/particle infra**; no new engine (CLAUDE.md simplicity).
- **Bench each** DM phase; details stack, so watch cumulative particle cost.

## Reference index

- Mist: [`main.js:629-670`](../reference/glacial-valley/main.js#L629-L670), [`shaders.js:738-788`](../reference/glacial-valley/shaders.js#L738-L788)
- Splash: [`main.js:762-810`](../reference/glacial-valley/main.js#L762-L810), [`shaders.js:1043+`](../reference/glacial-valley/shaders.js#L1043)
- Motes/insects: [`shaders.js:791-860`](../reference/glacial-valley/shaders.js#L791-L860)
- Dew: [`main.js:471-488`](../reference/glacial-valley/main.js#L471-L488), [`shaders.js:863-890`](../reference/glacial-valley/shaders.js#L863-L890)
- Fish rings: [`main.js:737-760`](../reference/glacial-valley/main.js#L737-L760)
- Pebbles: [`main.js:491-514`](../reference/glacial-valley/main.js#L491-L514)
- Drusniel: [`weather.yaml`](../../assets/config/weather.yaml), [`wind.yaml`](../../assets/config/wind.yaml)
