# Plan 6 — Biome Visual-State Vector & Seasonal Art Direction (from glacial-valley)

> Created: 2026-06-17 · Status: Planning
> Scope (Bevy): `assets/config/atmosphere.yaml`, time-of-day/season system, shader
> uniforms shared across terrain/water/vegetation/fog/post
> Scope (clod-poc): `tools/clod-poc/src/` (shared uniform block + post)
> Parent: [`glacial-valley-port-overview.md`](glacial-valley-port-overview.md)

## What this is / is not

- **Is:** making **biome/seasonal visual state explicit** — one small, shared
  state vector (season, lushness, autumn, bloom, snowline, glacial murkiness, morning
  mist, light palette) that drives terrain/water/vegetation/fog/post consistently, plus
  glacial-valley's compact **ACES post grade**.
- **Is not:** a new lighting or time-of-day engine. Drusniel already has time-of-day,
  atmosphere, fog, clouds, GI. This adds the **explicit state struct + season curves**
  so all systems read the same authored values instead of each inventing their own.

## How glacial-valley does it (grounded)

A single shared uniform object `U` ([main.js:290-310](../reference/glacial-valley/main.js#L290-L310))
is handed to **every** material. `updateDayNight(seasonClock)`
([main.js:950-989](../reference/glacial-valley/main.js#L950-L989)) sets, each frame:

| Uniform | Reference | Role |
|---|---|---|
| `uSeasonT` 0→4 | [:982](../reference/glacial-valley/main.js#L982) | winter→spring→summer→autumn→winter phase |
| `uGreen` (lushness) | [:983](../reference/glacial-valley/main.js#L983) | grass/leaf green-up, blade height ([shaders.js:489](../reference/glacial-valley/shaders.js#L489)) |
| `uAutumn` | [:984](../reference/glacial-valley/main.js#L984) | russet/gold grade |
| `uBloom` | [:985](../reference/glacial-valley/main.js#L985) | wildflower presence ([shaders.js:563](../reference/glacial-valley/shaders.js#L563)) |
| `uSnowUp` (snowline retreat, m) | [:986](../reference/glacial-valley/main.js#L986) | terrain snow line ([shaders.js:261](../reference/glacial-valley/shaders.js#L261)) |
| sun color / sky / horizon / ground bounce | [:971-979](../reference/glacial-valley/main.js#L971-L979) | shared light palette |
| `uVisW` (morning/evening bake blend) | [:968](../reference/glacial-valley/main.js#L968) | feeds [Plan 2](glacial-valley-far-field-sun-visibility-plan.md) |
| `exposureBase` | [:988](../reference/glacial-valley/main.js#L988) | adaptive exposure (stop down at noon / toward sun) |

Because *one* vector drives terrain albedo, grass, flowers, leaves, water, mist and
post, the season reads coherently — the same idea as the [terrain query](glacial-valley-terrain-query-discipline-plan.md)
discipline, but for **look** instead of geometry.

The post grade is tiny and worth having
([`postFrag`, shaders.js:1218-1242](../reference/glacial-valley/shaders.js#L1218-L1242)):
ACES tonemap → slight per-channel warm/cool → radial vignette → film grain → sRGB, with
**adaptive exposure** that stops down toward the sun ([main.js:1096-1100](../reference/glacial-valley/main.js#L1096-L1100)).

## The state vector

```yaml
biome_visual_state:
  season_t: 0.0          # 0..4 winter→spring→summer→autumn→winter
  green: 0.75            # lushness
  autumn: 0.0
  bloom: 0.3
  snowline_m: 180.0
  glacial_murkiness: 0.6 # → water preset (Plan 1)
  morning_mist: 0.8      # → detail masks (Plan 5)
```

This is the **integration hub** for the other plans: `glacial_murkiness` drives
[Plan 1](glacial-valley-water-preset-plan.md), `morning_mist` drives
[Plan 5](glacial-valley-biome-detail-masks-plan.md), `snowline_m`/`green`/`autumn` drive
terrain + vegetation, `season_t` gates detail spawn/fade.

## Bevy plan

### VS-1 State skeleton — **lands first, before Plans 1/3/5** (keep it light)
- Add a `BiomeVisualState` resource + `atmosphere.yaml` block + a debug UI to scrub the
  fields. Compute season curves (green/autumn/bloom/snowline) from the existing
  time-of-day/season clock à la
  [updateDayNight:982-986](../reference/glacial-valley/main.js#L982-L986). Drive it from
  the existing day-night system; do **not** add a second clock. **No shader consumers and
  no post work in VS-1** — this is the shared control vector the water/detail/snowline
  plans bind to so they don't each invent private knobs.
- **Verify:** values animate across a season sweep and via the debug UI; no bench
  movement yet (nothing consumes it).

### VS-2 Route terrain + vegetation albedo through it
- Feed `green`/`autumn`/`snowline_m` into terrain material + vegetation shaders
  (snow line [shaders.js:261-266](../reference/glacial-valley/shaders.js#L261-L266); grass
  green-up [shaders.js:489, 529-533](../reference/glacial-valley/shaders.js#L489)).
- **Verify (bench):** summer reads lush, autumn russet, winter snows down to the snow
  line, across the season sweep; `summary.json` within threshold (uniform reads are
  cheap); fixed screenshot checkpoints stable.

### VS-3 Wire the integration hooks
- `glacial_murkiness` → water preset ([Plan 1](glacial-valley-water-preset-plan.md));
  `morning_mist`/`season_t` → detail masks ([Plan 5](glacial-valley-biome-detail-masks-plan.md)).
- **Verify:** changing one state value moves water + mist together coherently; benched.

### VS-4 Post-grade audit only — no new post code unless a gap is proven
- Drusniel already has HDR/tonemapping, and the water-upgrade plan warns about
  double-tonemap risk. So VS-4 is an **audit**, not a feature: confirm whether the
  current post stack already does ACES + vignette + grain + adaptive exposure that stops
  down toward the sun ([main.js:1096-1100](../reference/glacial-valley/main.js#L1096-L1100)).
  If it does, record the finding and stop. Add new post code **only** if the audit proves
  a missing, wanted gap — and never a second tonemap.
- **Verify:** written finding (what exists vs what's missing); any added grade benched
  with post cost flat and no double-tonemap.

## clod-poc plan

clod-poc is the direct analog — it already shares one uniform set and a post pass.

| Step | Action |
|---|---|
| **VS-c1** | Add a `BiomeVisualState`-shaped shared uniform block (same field names as `atmosphere.yaml`) handed to all materials, mirroring [main.js:290-310](../reference/glacial-valley/main.js#L290-L310). |
| **VS-c2** | Port season curves + the ACES post grade ([shaders.js:1218-1242](../reference/glacial-valley/shaders.js#L1218-L1242)) into [`postprocess.ts`](../../tools/clod-poc/src/postprocess.ts). |
| **VS-c3** | `lil-gui` sliders for every state field → the look-dev surface a human uses to author values that then go into `atmosphere.yaml`. |
| **Verify** | `vitest`/`tsc` green; Pages deploy green; season sweep reads coherently. |

- **Parity:** field names match the Bevy resource/`atmosphere.yaml`; clod-poc authors
  the values, Bevy consumes them.

## Guardrails

- **One clock, one state:** reuse the existing time-of-day/season system; do not fork a
  second timeline (the duplication this plan exists to prevent).
- **State is read-only to consumers:** terrain/water/veg/fog/post **read** the vector;
  they don't each recompute season. Same discipline as [Plan 4](glacial-valley-terrain-query-discipline-plan.md).
- **Bench VS-2/3/4**; uniform reads are cheap but the season sweep is the visual-stability
  proof (fixed screenshot checkpoints).

## Reference index

- Shared uniforms: [`main.js:290-310`](../reference/glacial-valley/main.js#L290-L310)
- Season/day-night curves: [`main.js:950-989`](../reference/glacial-valley/main.js#L950-L989)
- Adaptive exposure: [`main.js:1096-1100`](../reference/glacial-valley/main.js#L1096-L1100)
- Post grade (ACES/vignette/grain): [`shaders.js:1218-1242`](../reference/glacial-valley/shaders.js#L1218-L1242)
- Season use in shaders: [`shaders.js:261-266`](../reference/glacial-valley/shaders.js#L261-L266), [`:489`](../reference/glacial-valley/shaders.js#L489), [`:1151-1156`](../reference/glacial-valley/shaders.js#L1151-L1156)
- Drusniel: [`atmosphere.yaml`](../../assets/config/atmosphere.yaml), [`tools/clod-poc/src/postprocess.ts`](../../tools/clod-poc/src/postprocess.ts)
