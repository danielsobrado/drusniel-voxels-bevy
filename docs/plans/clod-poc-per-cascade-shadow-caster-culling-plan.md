# Per-Cascade Shadow Caster Culling (clod-poc) — Plan

> Created: 2026-06-17 · Status: Planning (mostly **N/A today** — see below)
> Scope: `tools/clod-poc/src/` (only if/when a shadow system is added)
> Related: [`bevy-per-cascade-shadow-caster-culling-plan.md`](bevy-per-cascade-shadow-caster-culling-plan.md)
> (the substantive engine-side plan).

## Honest status: not applicable yet

clod-poc has **no shadow system**. Its lighting is **analytic** — the grass and terrain
shaders compute sun/hemisphere lighting directly in the fragment stage
([`grass.ts`](../../tools/clod-poc/src/grass.ts) `FRAGMENT_SHADER`: `uSunColor·pow(sun,…)`
+ hemi), with no directional-light shadow map, no cascaded shadow maps (CSM), and no
shadow-caster pass. A grep across `tools/clod-poc/src` for `shadowMap` / `DirectionalLight`
/ `castShadow` / `CSM` / `cascade` finds nothing.

Therefore the LAAS lesson — *separate visible-instance culling from per-cascade
shadow-caster culling* — has **nothing to attach to in clod-poc right now**. There is no
caster list that could incorrectly drop off-screen casters, because there are no casters.

This file exists (per request) to (a) record that finding so it isn't re-investigated,
and (b) capture the design rule for if/when clod-poc grows shadows.

## If/when clod-poc adds shadows — the design rule

clod-poc is a CLOD terrain + WebGL sandbox; the realistic shadow options are a single
directional shadow map or three.js CSM (`CSMShadowNode`/`CSM`), not a bespoke cascade
system. If that happens, bake in the separation from day one:

- **Two queries, never one list.** Build the *visible* set from the camera frustum (the
  grass system already does page/distance culling in
  [`grass.ts`](../../tools/clod-poc/src/grass.ts) `GrassSystem.refreshPatches`) and a
  *separate* caster set from each cascade's frustum/distance band. Don't reuse the visible
  set as the caster set.
- **Caster distance is cascade-relative**, not camera-distance-LOD — so an off-screen prop
  still inside a cascade's shadow volume keeps casting.
- **Per-patch granularity is fine** at clod-poc's scale (page-sized patches), mirroring the
  Bevy plan's per-group reasoning — per-instance caster culling is not worth it here.
- If grass ever casts shadows, prefer **not** casting from thin near-field blades (cost ≫
  benefit); reserve casters for larger props — the same "grass is `NotShadowCaster`"
  decision the Bevy side already made.

## Interim

Nothing to do. Keep clod-poc's analytic lighting. Revisit only if a shadow feature is
actually requested for the sandbox; at that point this file becomes the starting spec and
the [Bevy plan](bevy-per-cascade-shadow-caster-culling-plan.md) is the reference for the
caster-selection rules.

## Reference index

- clod-poc grass culling (the existing visible-set query): [`tools/clod-poc/src/grass.ts`](../../tools/clod-poc/src/grass.ts)
- Engine-side substantive plan: [`bevy-per-cascade-shadow-caster-culling-plan.md`](bevy-per-cascade-shadow-caster-culling-plan.md)
