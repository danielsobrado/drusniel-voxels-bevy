# Water Edge / Hydrology Lessons — Port Plan

> Created: 2026-06-17 · Status: Planning
> Scope (Bevy): `src/voxel/runtime/water_bodies.rs`, `src/voxel/terrain/water.rs`,
> `src/voxel/meshing/water.rs`, `src/rendering/water/`,
> `src/rendering/diagnostics/water_visual_probe.rs`, `assets/config/water.yaml`
> Scope (clod-poc): `tools/clod-poc/src/{terrain,grass,terrain_textures}.ts`
> Related: [`bevy-gpu-vegetation-port-plan.md`](bevy-gpu-vegetation-port-plan.md) &
> [`clod-poc-gpu-vegetation-early-rejection.md`](clod-poc-gpu-vegetation-early-rejection.md) (consume the gating rule),
> [`procedural-vegetation-authoring-plan.md`](procedural-vegetation-authoring-plan.md).

Steal LAAS/fable5's hard-won **water-edge / hydrology discipline** — the rules,
classification, and shoreline artifact handling. Drusniel's *classification* is
already stronger; its *renderer look* is not — the shading-composition port is
covered separately in
[`water-renderer-visual-upgrade-plan.md`](water-renderer-visual-upgrade-plan.md).
This plan is the rules/diagnostics half; the two share the far-rim probe (L7).

## What this is / is not

- **Is:** porting the *rules and diagnostics* — dry-sentinel edge logic, conservative
  far-water reduction (with LAAS's failure-mode catalog), wet-cell smoothing,
  waterY-vs-apron gating, per-kind (lake/river) shoreline behavior, wet-margin rules,
  the far-rim reflection artifact and its debug views.
- **Is not:** the shading-composition / visual-quality upgrade — that's the
  [renderer plan](water-renderer-visual-upgrade-plan.md). This plan keeps planar
  reflections, caustics, buoyancy displacement, and per-body presets as-is.

## Repo reality (audit)

**Drusniel is already ahead on rendering + classification:**
- **Per-body presets** — [`water.yaml`](../../assets/config/water.yaml) `body_presets:`
  (ocean/lake/…) with wave/colour/reflection/fresnel/foam/murkiness tuning read by
  `WaterMaterial`.
- **Rich classification** — [`water_bodies.rs`](../../src/voxel/runtime/water_bodies.rs):
  `WaterBodyKind { Ocean, Lake, River, Pond, ShallowFlood, Unknown }`,
  `WaterBodyMaterialMode { Fancy, Cheap, Hidden, Unknown }`, per-body **edge masks**
  (N/S/W/E), body grouping. This is *more* structured than LAAS's field.
- **Shoreline generation** — [`terrain/water.rs`](../../src/voxel/terrain/water.rs):
  `ShorelineKind`, `ShorelineProfile`, `WaterGenerationMetadata { surface_y, bed_y }`,
  `WATER_LEVEL`, `is_surface_water`, `is_cave_aquifer`.
- **Water debug probe exists** — [`water_visual_probe.rs`](../../src/rendering/diagnostics/water_visual_probe.rs):
  reflection eligible/active, reflection debug view, solid-colour debug, compositor
  toggles, per-mesh probes.

**Substrate difference (important):** LAAS water is a **clipmap heightfield** (a
render field of wet/dry cells); Drusniel water is **per-body meshes** with edge masks.
So LAAS's cell-field tricks (sink dry cells, N smoothing iterations, border clamp)
**don't drop in verbatim** — they translate to Drusniel's *mesh-edge + far-LOD +
material-mode* world. The plan does that translation rather than copying the field.

**clod-poc water has grown beyond the original minimal path:** the older flat
`WATER_LEVEL = 18` / sand-band setup now sits beside visual hydrology code such
as `tools/clod-poc/src/water/hydrologySystem.ts`,
`tools/clod-poc/src/water/visualHydrologyField.ts`, and
`tools/clod-poc/src/systems/hydrology_packing.ts`. Bevy also has the corresponding
derived visual hydrology field under `src/terrain/hydrology/`. The architectural
split still matters: use clod-poc as the fast browser proving ground, and keep
Bevy's authoritative target on voxel water plus render-oriented hydrology fields.

## The LAAS lessons (the actual steal)

From [STATUS.md](../reference/fable5-world-demo/STATUS.md) (the "strict hydrology"
and far-rim diagnosis entries):

| # | Lesson | LAAS form | Drusniel translation |
|---|---|---|---|
| L1 | **waterY-vs-apron gating** | Gate veg/debris on the *actual* water surface (`waterY`), never the widen-blurred `riverDepth` apron (~0.12 m floor flags whole gorge floors "river" → bald banks). Generous ≥0.25 m thresholds apply only to sim-res `W−h`, not `waterY−h`. | Gate vegetation/prop placement on `WaterGenerationMetadata.surface_y`, never a blurred/proxy field. **Highest-value; feeds the veg plans.** |
| L2 | **Dry sentinel / banks-as-walls** | Dry cells in the render field sink below their 3×3 neighbors so banks read as water *walls*, not membranes stretched up the bank; border texels clamped so water can't bleed off-world infinitely. | Far/LOD water-mesh edges: never extend a water quad across a dry/edge-mask boundary; clamp body extent to the edge mask so a lake doesn't smear onto the bank at distance. |
| L3 | **Wet-cell smoothing** | Wet-masked smoothing iterations (×2) so coarse verts don't tent a single wet texel across a 48 m cell. | Smooth far-LOD water-body surfaces only across same-body wet cells; don't average across the shoreline. |
| L4 | **Conservative far reduction + failure catalog** | Collapse-to-min of wet neighbors at distance — but min-of-wet *broke* lens/dome cases, narrow channels, and tall banks (vs beaches). | Drive far simplification via `WaterBodyMaterialMode` (Fancy→Cheap→Hidden) by distance/size, using LAAS's failure catalog as the regression set (narrow rivers, tall-bank lakes, domed large lakes). |
| L5 | **Lake-vs-river behavior** | River channel-scar thins hard (cobbled bed), banks stay green from ~0.5 m above the line; lakes get a wetland margin. | Per-`WaterBodyKind` shoreline behavior already exists structurally — add the margin/bed rules per kind. |
| L6 | **Wet-margin rules** | Waterline fringe darkening + submerged biofilm/algae; soft bank margin (full effect ~0.5 m above waterline); channel-scar thinning. | Encode in `ShorelineProfile`; reuse existing foam/shore data. |
| L7 | **Far-rim reflection black-stripe** | Large lakes show a solid black rim at grazing; root cause = `fragZ−zScene` collapsing where the opaque depth behind far-rim water belongs to the **bank** at the waterline (ray-thin ≠ shallow). | Known-artifact note + a far-rim probe; check Drusniel's planar-reflection compositor for the same waterline depth-test ambiguity. |
| L8 | **Underwater camera guard** | A CPU `waterY` mirror guards the underwater transition. | Per-body `surface_y` guard for the camera transition (verify Drusniel has one). |
| L9 | **Debug probes** | `probe-horizon.ts` (far-rim at 8 yaws), `probe-wetmargin.ts` (wet transect), caustics/reflection views. | Extend `water_visual_probe.rs` with far-rim, wet-margin, and caustics views. |

## Architecture split ("for both")

- **Bevy = the substantive port.** Refine classification far-reduction + edge/dry-
  sentinel meshing + wet-margin ruleset + far-rim artifact probe, all by **extending**
  the existing water modules (don't add a parallel water system).
- **clod-poc = lightweight + prototyping.** Port only the L1 gating rule into its
  grass/material classification, plus a shoreline/wet debug view. Cheap place to
  validate the rules before they touch the Bevy water path.
- **Shared = a documented hydrology-rules reference** (L1–L9) that both engines and
  the vegetation plans cite, so the gating/margin rules have one source of truth.

## Phased plan

### Phase 0 — Shared hydrology-rules reference (do first; durable artifact)
- Write `docs/rendering/water-hydrology-rules.md` capturing L1–L9 with the precise
  thresholds and the **far-reduction failure catalog** (narrow channel, tall bank,
  domed lake, lens/dome) as a named regression set.
- **Verify:** the veg plans can cite L1 by reference; the catalog is concrete enough
  to build bench scenes from.

### Phase 1 — Bevy: L1 waterY-vs-apron gating (highest value)
- Audit every vegetation/prop placement gate that touches water; ensure it keys on
  `WaterGenerationMetadata.surface_y` (true surface), not any blurred/proxy/apron
  field. Apply the threshold split (generous only for sim-res comparisons).
- **Verify:** banks regrow vegetation to the true shoreline on a lake+river bench
  scene; no bald-bank bands; cross-checks the
  [veg](bevy-gpu-vegetation-port-plan.md) placement gates.

### Phase 2 — Bevy: L2/L3/L4 far-water reduction + edge discipline
- Far/LOD water meshing: clamp body extent to edge masks (L2 — no across-bank smear,
  no off-world bleed); smooth only within same-body wet cells (L3).
- Map distance/size → `WaterBodyMaterialMode` (Fancy/Cheap/Hidden) with the L4 failure
  catalog as the regression set.
- **Verify (bench discipline):** the four catalog cases hold at range; no membrane
  stretch over banks; frame time improves or holds when far bodies drop to Cheap/Hidden.

### Phase 3 — Bevy: L5/L6 per-kind shoreline + wet-margin rules
- Encode wet-margin rules into `ShorelineProfile` per `WaterBodyKind` (river channel-
  scar bed + green bank from ~0.5 m above line; lake wetland margin; waterline fringe
  + submerged biofilm darkening).
- **Verify:** rivers read as cobbled-bed-with-green-banks, lakes as wetland-margin, on
  the bench scenes; no hard waterline color cliff.

### Phase 4 — Bevy: L7/L9 far-rim artifact + debug views
- Add a far-rim probe (horizon sample at 8 yaws, per L9) and a known-artifact note;
  inspect the planar-reflection compositor for the L7 waterline depth-test ambiguity
  and mitigate if present.
- Extend [`water_visual_probe.rs`](../../src/rendering/diagnostics/water_visual_probe.rs)
  with far-rim, wet-margin, and caustics debug views (reflection view already exists).
- **Verify:** the far-rim probe quantifies any black-stripe at grazing across yaws;
  debug views toggle cleanly; document the artifact + mitigation honestly.

### Phase 5 — Bevy: L8 underwater camera guard
- Confirm/strengthen a per-body `surface_y` guard for the underwater camera transition.
- **Verify:** transition is correct entering each water-body kind; no flicker at the
  surface plane.

### Phase 6 — clod-poc: L1 gating + shoreline debug view
- Add a `waterY`/wet-margin gate to clod-poc's grass/material classification
  ([`grass.ts`](../../tools/clod-poc/src/grass.ts) `acceptsGrassCandidate`,
  [`terrain.ts`](../../tools/clod-poc/src/terrain.ts) sand/water band): gate on the
  true `WATER_LEVEL`-derived surface with the soft bank margin from L6.
- Add a simple shoreline/wet debug overlay.
- **Verify:** clod-poc grass stops cleanly at the waterline with a soft bank margin;
  prototype validates the rule before/with Phase 1.

## Relationship to the other plans

- **L1 is a dependency of** the vegetation plans: both
  [`clod-poc-gpu-vegetation-early-rejection.md`](clod-poc-gpu-vegetation-early-rejection.md) and
  [`bevy-gpu-vegetation-port-plan.md`](bevy-gpu-vegetation-port-plan.md) cull/place near
  water — they must gate on the true surface, not a proxy. Land L1 first or alongside.
- **L5/L6 inform** the authoring plan's understory/shrub placement near shorelines.

## What NOT to do

- Don't do the shading-composition upgrade here — that's the
  [renderer plan](water-renderer-visual-upgrade-plan.md). Keep Drusniel's planar
  reflection, caustics, and displacement (those genuinely stay).
- Don't add a parallel water system — extend `water_bodies.rs` / `terrain/water.rs` /
  `water/` / `water_visual_probe.rs`.
- Don't copy the clipmap cell-field verbatim — translate to per-body meshes + edge
  masks + material modes.
- Don't gate vegetation on any blurred/apron field (the whole point of L1).

## Open questions

1. Does Drusniel build any **far/LOD water representation** today, or is far water just
   the same per-body mesh? (Grep found none — confirms L2/L4 are partly *new* far-LOD
   logic, not just a refinement.)
2. Does the planar-reflection compositor exhibit the **L7 far-rim** ambiguity at
   grazing on large lakes? (Phase 4 probe answers this — don't assume.)
3. Is there already an **underwater camera guard** (L8), or is that new?

## Reference index

- LAAS waterY field / sampling: [`world/Heightfield.ts`](../reference/fable5-world-demo/src/world/Heightfield.ts), [`world/WaterSurface.ts`](../reference/fable5-world-demo/src/world/WaterSurface.ts)
- LAAS rivers / channel logic: [`gpu/passes/FlowRivers.ts`](../reference/fable5-world-demo/src/gpu/passes/FlowRivers.ts)
- LAAS hydrology notes: [`STATUS.md`](../reference/fable5-world-demo/STATUS.md) ("strict hydrology", far-rim entries)
- Drusniel classification: [`src/voxel/runtime/water_bodies.rs`](../../src/voxel/runtime/water_bodies.rs)
- Drusniel shoreline/gen: [`src/voxel/terrain/water.rs`](../../src/voxel/terrain/water.rs)
- Drusniel water meshing: [`src/voxel/meshing/water.rs`](../../src/voxel/meshing/water.rs)
- Drusniel water render + debug: [`src/rendering/water/`](../../src/rendering/water/), [`src/rendering/diagnostics/water_visual_probe.rs`](../../src/rendering/diagnostics/water_visual_probe.rs)
- Per-body presets: [`assets/config/water.yaml`](../../assets/config/water.yaml)
