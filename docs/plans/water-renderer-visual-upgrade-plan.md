# Water Renderer Visual Upgrade — Port Plan

> Created: 2026-06-17 · Status: Planning
> Scope (Bevy): `assets/shaders/water_fragment.wgsl`, `water_functions.wgsl`,
> `water_reflection_compositor.wgsl`, `witchcraft_water_finish.wgsl`,
> `src/rendering/water/`, `assets/config/water.yaml`
> Scope (clod-poc): optional/minimal — `tools/clod-poc/src/` (only if a water surface exists)
> Related: [`water-edge-hydrology-lessons-plan.md`](water-edge-hydrology-lessons-plan.md)
> (sibling — the rules/classification; this plan is the *look*).

**Decision (overrides the hydrology plan's earlier "don't port the renderer" stance):**
Drusniel's water does not look good enough, so we **do** take LAAS/fable5's water
*shading composition*. The good news from the audit: this is a **shader-composition
port into Drusniel's existing custom WGSL**, not a pipeline or `bevy_water` rewrite.

## What this is / is not

- **Is:** porting LAAS's water *shading math* (spectral depth absorption of the
  refracted scene, flattened-normal Fresnel, flow-field ripples, slope foam,
  dark-bank reflection) into Drusniel's existing water WGSL, technique by technique,
  each independently visible and benchable.
- **Is not:** a `bevy_water` rip-and-replace up front, a WebGPU/TSL pipeline port, or
  the hydrology/classification rules (that's the [sibling plan](water-edge-hydrology-lessons-plan.md)).

## The visual delta (grounded in the shaders)

What [`water_fragment.wgsl`](../../assets/shaders/water_fragment.wgsl) composes today vs
what [`WaterMaterial.ts`](../reference/fable5-world-demo/src/render/WaterMaterial.ts)
does:

| Aspect | Drusniel today | LAAS | Look impact |
|---|---|---|---|
| **Depth color** | **scalar** Beer's law `exp(-depth·clarity)` lerping `deep_color`↔`shallow_color` ([:122](../../assets/shaders/water_fragment.wgsl#L122)) | **per-channel** absorption `exp(-thick·SIGMA.rgb)` of the **actually refracted scene** (red dies first → teal depths) + sky-tracked turbidity in-scatter | **Biggest gap.** Drusniel shows a 2-colour gradient; LAAS shows the absorbed riverbed. This is most of "looks like real water." |
| **Refraction** | none in-fragment (depth-tint only; planar *reflection* handled in a separate compositor) | samples scene colour at a ripple-refracted, **depth-validated** uv (front-of-water samples fall back to straight uv → no halo) | Transmitted detail + no refraction leak |
| **Fresnel** | only inside the stylized witchcraft finish (`1−ndot`) | reflectance on a **flattened** normal so ripple tilt can't explode `(1−cosθ)^5` → no grazing "white sheet" | Kills the mirror/white-sheet failure |
| **Ripples** | Gerstner / wave-height derivatives + detail normals | **two-phase flowmap** over baked fbm gradients, advected along the **hydrology flow field** (zero in lakes → breeze drift) | No sliding-texture artifact; rivers actually flow |
| **Foam** | edge foam + crest foam keyed on `normal.y·amplitude` | shore feather + **rapid foam keyed on surface DROP along flow** (froths at steps, clear on smooth grades); two-phase **clumpy** pattern | Whitewater reads physical, not striped/uniform |
| **Reflection at grazing** | planar reflection (good for lakes) but reflects bright sky at the rim | SSR march returning **dark banks/trees**, sky fallback with **crowned-horizon occlusion** | Fixes far-rim black/white (= hydrology L7) |
| **Stylised grade** | "witchcraft finish" (Aurora/Complementary colour) on by config | none — physical composition, tonemapped by the post stack | May be fighting realism; revisit |

**Keep (Drusniel is genuinely better here):** planar reflections (higher quality than
LAAS's SSR for lakes — we improve its rim, don't replace it), caustics, CPU
wave-displacement sim, per-body presets, buoyancy.

## Constraints (be honest)

- **TSL → WGSL is a manual rewrite**, not a copy. But we're editing an *existing*
  WGSL shader with existing bindings, so it's shading math, not pipeline plumbing.
- **`bevy_water` is the base** ([`water/mod.rs`](../../src/rendering/water/mod.rs) imports
  its fragment/vertex). As we override more of its fragment, we approach forking it —
  call that decision explicitly (see Strategy), don't drift into it.
- **Refraction inputs already exist (RESOLVED).** The planar-reflection **compositor**
  ([`water_reflection_compositor.wgsl`](../../assets/shaders/water_reflection_compositor.wgsl))
  is a fullscreen post pass that already binds `scene_texture` (opaque HDR scene),
  `scene_depth_texture`, `reflection_texture`, and `water_mask_texture`, and already
  does a **primitive** refraction (uv-distorted scene sample at a ≤0.28 constant blend,
  no thickness, no absorption). So the transmission/reflection upgrades land **in the
  compositor**, where all inputs coexist — not in the in-mesh fragment. This is much
  smaller than a mesh-shader rewrite.
- **The current "Fresnel" is fake.** It's `pow(1.0 - uv.y, fresnel_power)` — a vertical
  **screen-position** gradient ([:183](../../assets/shaders/water_reflection_compositor.wgsl#L183))
  with a `max(fresnel, 0.28)` floor forcing ≥28% reflection everywhere. That flat
  screen-gradient sheen is a prime suspect for "doesn't look good."
- **Rendering is perf-sensitive (CLAUDE.md):** refraction + flow ripples + reflection
  march add fragment cost. **Every phase must run the visual benches and compare
  `summary.json`** before/after; use the deterministic water-containing scenes and the
  bench guard.

## Strategy: two-pass split, incremental (recommended)

The audit shows the work splits cleanly across the two passes Drusniel already has,
so we don't fork `bevy_water` at all:

- **Compositor pass** (`water_reflection_compositor.wgsl`) — owns
  **transmission + reflection**: spectral refraction-absorption, real Fresnel, the
  reflection/refraction blend, dark-bank rim. Highest-ROI work, all inputs already
  bound.
- **In-mesh fragment** (`water_fragment.wgsl`) — owns the **surface**: ripple normals,
  foam, and the (now default-off) finish. Flow-field ripples + slope foam live here.
- Add each technique behind a shader-def / config toggle, A/B against the current
  look, keep `bevy_water`'s scaffolding. Low risk, each step shippable, easy revert.
- One reconciliation point: the compositor's refraction distortion (`wave_distortion`)
  and the mesh ripple normals should share a flow/normal source so transmission and
  surface agree (Phase 3).

## Phased plan (visual ROI order; each independently benched)

### Phase 0 — Baseline + water debug ladder
- Capture before-screenshots of the current water on a **lake+river bench scene** (8
  yaws incl. grazing, per the hydrology far-rim probe).
- Port LAAS's component debug ladder (`?waterdbg=1..6`: foam / fresnel / refraction /
  reflection / column thickness / SSR mix) into Drusniel's existing water debug
  toggles (it already has `water_reflection_debug_view` / solid-colour debug).
- **Verify:** baseline `summary.json` recorded; each water component isolatable in a
  debug view.

### Phase 1 — Per-channel Beer–Lambert refraction in the compositor (biggest ROI)
- In `water_reflection_compositor.wgsl`, upgrade the existing primitive refraction
  ([:163](../../assets/shaders/water_reflection_compositor.wgsl#L163)): compute water
  column **thickness** from `scene_depth_texture` vs the water surface depth (`surface_y`
  is already a uniform); **depth-validate** the refracted uv (samples in front of the
  water fall back to the straight uv → no halo); absorb the refracted scene per-channel
  `exp(-thick·SIGMA.rgb)` (red dies first → teal depths); add turbidity in-scatter
  tracking the sky. Drive `SIGMA`/turbidity from the per-body preset
  (`clarity`/`murkiness`/`deep_color` already plumbed to the compositor).
- Replace the flat `≤0.28` refraction blend with this thickness-driven transmitted term.
- **Verify (bench):** riverbed reads through shallow water with teal-deepening; no
  refraction halo at edges; fragment-cost delta within threshold on the water scene.

### Phase 2 — Real Fresnel (replace the screen-Y gradient) + reflection/refraction blend
- In the compositor, replace `fresnel = pow(1.0 - uv.y, fresnel_power)` and its
  `max(.,0.28)` floor ([:183-185](../../assets/shaders/water_reflection_compositor.wgsl#L183))
  with a **real view-angle Fresnel on a flattened normal**: reconstruct the water-surface
  world position from `uv` + `surface_y`, take the view direction, and use a mostly-up
  (flattened) normal so ripple tilt can't explode `(1−cosθ)^5`. Blend the Phase-1
  refraction against the planar `reflection_texture` by that Fresnel.
- **Verify:** the flat screen-gradient sheen and the grazing "white sheet" are gone;
  lake mirrors correctly head-on; reflection vanishes looking straight down; benched.

### Phase 3 — Two-phase flowmap ripple normals along the flow field
- Replace/augment the Gerstner normal with two-phase flowmap fbm-gradient ripples
  advected along the hydrology **flow field** (rivers stream, lakes get breeze drift).
  Reuse the wave-displacement/flow data Drusniel already simulates.
- **Verify:** no sliding-texture artifact through the loop; river normals follow flow;
  benched (normals are cheap — one-two fetches).

### Phase 4 — Slope-keyed rapid foam + two-phase clumpy foam
- Add foam keyed on **surface drop along flow** (whitewater at steps, clear on smooth
  grades) and convert crest/edge foam to the two-phase **clumpy** pattern (decorrelated
  scales, variance-renormalised) instead of stripes.
- **Verify:** rapids froth at drops, calm reaches run clear; no banded foam; benched.

### Phase 5 — Dark-bank reflection at grazing (= hydrology L7)
- Improve the planar reflection rim with LAAS's **crowned-horizon occlusion** idea so
  grazing rays return dark banks/tree-line, not bright horizon; fix the waterline
  depth-test ambiguity if the far-rim probe (hydrology Phase 4) confirms it.
- **Verify:** far-rim probe shows no black/white stripe across yaws; benched. (Shared
  acceptance with [hydrology L7](water-edge-hydrology-lessons-plan.md).)

### Phase 6 — Retire the witchcraft finish (DECIDED: off)
- User call: the witchcraft finish doesn't look good — the physical composition is the
  chosen look. Default the finish **off** (`witchcraft_finish_enabled` → false by
  config) so the mesh fragment stops applying `apply_witchcraft_water_finish`. Keep the
  code path behind config for now (cheap to keep, easy to delete later) rather than
  ripping it out mid-port.
- **Verify:** default water uses the physical path end-to-end; no witchcraft grade
  unless explicitly enabled; benched.

### Phase 7 (optional) — clod-poc
- clod-poc water is a flat `WATER_LEVEL` material band with no surface mesh. Only if a
  water plane is added there: a *minimal* version (depth-fade absorption + flattened
  Fresnel + a cheap reflection) — not the full stack. Otherwise this plan is Bevy-only
  and clod-poc keeps just the hydrology gating from the sibling plan.

## Reconciliation

- **Sibling:** [`water-edge-hydrology-lessons-plan.md`](water-edge-hydrology-lessons-plan.md)
  — Phase 5 here *is* hydrology L7; the wet-margin rules (L6) feed foam/shore-feather
  thresholds. Land the far-rim probe once, share it.
- **`bevy_water`:** stay incremental until/unless a fork is clearly cheaper (Strategy).
- **Meshlet pass:** `water_fragment.wgsl` already has a `MESHLET_MESH_MATERIAL_PASS`
  path — keep new code on both branches.

## Open questions

1. ~~Can the fragment bind the opaque scene colour for refraction?~~ **RESOLVED:** the
   compositor already binds scene colour + depth + reflection + mask and does primitive
   refraction; Phase 1/2/5 land there.
2. ~~Is the witchcraft finish wanted?~~ **RESOLVED (user):** no — default it off; physical
   composition is the look (Phase 6).
3. Does Drusniel's flow/wave-displacement data expose a **per-fragment flow direction**
   the ripples/foam can read (Phase 3/4), or is only wave height available? (Last open
   unknown; gates how literal the LAAS flow-ripple/slope-foam port can be.)

## Reference index

- LAAS water material: [`render/WaterMaterial.ts`](../reference/fable5-world-demo/src/render/WaterMaterial.ts)
- LAAS caustics: [`render/Caustics.ts`](../reference/fable5-world-demo/src/render/Caustics.ts)
- Drusniel water fragment: [`assets/shaders/water_fragment.wgsl`](../../assets/shaders/water_fragment.wgsl)
- Drusniel water functions: [`assets/shaders/water_functions.wgsl`](../../assets/shaders/water_functions.wgsl)
- Drusniel reflection compositor: [`assets/shaders/water_reflection_compositor.wgsl`](../../assets/shaders/water_reflection_compositor.wgsl), [`src/rendering/water/reflection_compositor.rs`](../../src/rendering/water/reflection_compositor.rs)
- Drusniel witchcraft finish: [`assets/shaders/witchcraft_water_finish.wgsl`](../../assets/shaders/witchcraft_water_finish.wgsl), [`src/rendering/water/finish.rs`](../../src/rendering/water/finish.rs)
- Per-body presets: [`assets/config/water.yaml`](../../assets/config/water.yaml)
- Water debug probe: [`src/rendering/diagnostics/water_visual_probe.rs`](../../src/rendering/diagnostics/water_visual_probe.rs)
