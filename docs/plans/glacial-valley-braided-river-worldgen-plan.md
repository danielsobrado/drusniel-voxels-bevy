# Plan 3 — Braided-River Worldgen (from glacial-valley)

> Created: 2026-06-17 · Status: Planning
> Scope (Bevy): `assets/config/terrain_generation.yaml`, a **new**
> `src/voxel/terrain/river.rs` (river fields + SDF stamp; do **not** put this in
> `height.rs`), `src/voxel/terrain/{noise.rs,water.rs,biome.rs}`,
> `src/voxel/meshing/sdf.rs`, `src/voxel/runtime/{generation.rs,water_bodies.rs}`
> Scope (clod-poc): `tools/clod-poc/src/terrain.ts` (worldgen field)
> Parent: [`glacial-valley-port-overview.md`](glacial-valley-port-overview.md)

## What this is / is not

- **Is:** porting glacial-valley's **river-shaping recipe** — a meandering centerline,
  variable half-width, a carved trough, gravel-bar noise that breaks the waterline into
  braids, feeder rivulets, and valley-wall framing — into Drusniel **voxel/SDF
  worldgen**.
- **Is not (GV-G0):** a heightfield. glacial-valley computes `y = terrainH(x,z)`. We do
  **not** add a height function that owns terrain. We **stamp an SDF river bed into the
  density field** and let Surface Nets extract it, so caves under the bank, overhangs,
  and edits all still work. The river is a *density modifier*, not a surface.

## The recipe, grounded

From [`terrainH`, main.js:96-145](../reference/glacial-valley/main.js#L96-L145):

| Piece | Reference | Voxel translation |
|---|---|---|
| **Meander centerline** `m(x)` | [`meanderC:93`](../reference/glacial-valley/main.js#L93) sum of 3 sines | a 1-D centerline curve along the river axis |
| **Variable half-width** `hw(x)` | [`halfWidth:94`](../reference/glacial-valley/main.js#L94) base + 2 sines | width of the low-density channel |
| **Bed trough + cross-section** | [:100-108](../reference/glacial-valley/main.js#L100-L108) `cross = 1-q²`, `bed = -1.7·cross^0.7 + bars·1.9` | depth the density field is pushed down across the channel |
| **Gravel bars** (the braiding!) | [:105](../reference/glacial-valley/main.js#L105) `fbmE(x·0.0062, dz·0.030)` | bar noise that locally raises the bed above the waterline → islands/braids |
| **Feeder rivulets** | [:118-128](../reference/glacial-valley/main.js#L118-L128) gaussian channels `exp(-d²/k)` on the bank | thin tributary carves into the bank density |
| **Bank slope / valley walls** | [:131-143](../reference/glacial-valley/main.js#L131-L143) `smoothstep` walls + ridged peaks | frames the river; in voxel land this is the existing terrain, the river just subtracts |
| **Water surface** | flat `WATER_Y` | a water body whose surface = local channel waterline; ties to [`water_bodies.rs`](../../src/voxel/runtime/water_bodies.rs) |

The braiding **emerges**: bars cross the waterline so the single trough reads as
multiple channels. That's the high-value idea and it's pure noise math — trivially
voxel-compatible as a density stamp.

## clod-poc plan (do first — cheapest spike)

clod-poc worldgen is JS, like the reference, so this is the validation surface.

### BR-1 River fields as functions
- In [`terrain.ts`](../../tools/clod-poc/src/terrain.ts), add `riverCenter(x)`,
  `riverHalfWidth(x)`, `gravelBar(x,z)`, `bankSlopeMask(x,z)` matching
  [main.js:93-106](../reference/glacial-valley/main.js#L93-L106).
- **Verify:** plotting the channel shows meander + braids; bars create islands.

### BR-2 Stamp into the density/surface field (not a separate height map)
- Apply the river as a **subtractive modifier** on the existing terrain field:
  `density += riverBedSDF(x,z,y)` so caves/edits still compose. Even though clod-poc's
  own terrain is heightfield-ish, **author the API as an SDF stamp** so the Bevy port
  is a straight translation, not a redesign.
- **Verify:** river reads as carved channel with gravel-bar braids; bank rivulets feed
  in; `vitest` + `tsc --noEmit` green (Pages deploy stays green).

### BR-3 Rapids/water-surface hooks
- Expose `riverDepth(x,z)` and a `rapidMask = bankSlope + shallowDepth + flowNoise`
  ([cf. main.js:774](../reference/glacial-valley/main.js#L774)) for the detail-mask and
  water-preset plans to consume.
- **Verify:** rapid mask lights up at bed steps/shallows; feeds [Plan 5](glacial-valley-biome-detail-masks-plan.md) splash placement.

## Bevy plan

### BR-4 River SDF stamp in the density field
- Put `riverCenter/halfWidth/gravelBar` and the bed-SDF in a **new
  [`src/voxel/terrain/river.rs`](../../src/voxel/terrain/river.rs)** (a density modifier),
  not in `height.rs` — the filename matters: `river = height` is the wrong mental model
  the firewall fights. `height.rs` may *call* `river.rs` only if legacy generation needs
  it. Apply the bed as an **SDF subtraction in
  [`src/voxel/meshing/sdf.rs`](../../src/voxel/meshing/sdf.rs)** / the density generator
  ([`runtime/generation.rs`](../../src/voxel/runtime/generation.rs)), config-driven from
  [`terrain_generation.yaml`](../../assets/config/terrain_generation.yaml)
  (`river.meander_*`, `river.half_width_*`, `river.bar_*`, `river.rivulet_*`).
- **Critical (GV-G0):** the river edits **voxel density**, then the normal mesher
  extracts it. Do **not** special-case it in the mesher or add a height path.
- **Verify (bench):** river channel + braids appear in a worldgen bench; cave/overhang
  test scenes still mesh (no topology regression); Alt+F10 hole-probe clean at banks;
  `summary.json` meshing rows within threshold.

### BR-5 Tie the channel to a water body
- The carved channel registers a water body in [`water_bodies.rs`](../../src/voxel/runtime/water_bodies.rs)
  with the **glacial preset** from [Plan 1](glacial-valley-water-preset-plan.md); river
  depth feeds the absorption/rapid-foam terms.
- **Verify:** water fills the channel to the right line; glacial look applies; benched.

### BR-6 Biome wiring
- Expose `riverDepth`/`rapidMask`/`bankSlope` from the terrain query (see
  [Plan 4](glacial-valley-terrain-query-discipline-plan.md)) so props, grass, gravel
  decals, and splash particles place against the same river data — glacial-valley's
  "one query drives placement" discipline, done the voxel way.
- **Verify:** gravel bars get pebble/gravel material; willows hug banks; benched.

## Acceptance gates

- **BR-A1** — The river stamp is deterministic from seed + config (same seed → same
  channel), covered by a golden test.
- **BR-A2** — The stamp composes additively/subtractively with cave and overhang density
  (a cave under the bank survives; the river doesn't fill it).
- **BR-A3** — Disabling the river config restores previous terrain generation **exactly**
  (golden diff = 0).
- **BR-A4** — Water-body extraction must **not** infer water from a heightfield; it
  consumes the river channel mask / connected-water metadata
  ([`water_bodies.rs`](../../src/voxel/runtime/water_bodies.rs)).
- **BR-A5** — Brush edits near the river dirty terrain, water-body metadata, CLOD pages,
  **and** the far-visibility summary ([Plan 2 FV-A3](glacial-valley-far-field-sun-visibility-plan.md)).

## Guardrails

- **GV-G0:** SDF density stamp only. Any line that looks like `y = riverHeight(x,z)`
  owning terrain is the firewall breach — stop.
- **Parity:** clod-poc field functions and Bevy functions share param names + formulas;
  add a golden test (model: [`src/voxel/pages/tests.rs`](../../src/voxel/pages/tests.rs))
  so the two can't silently diverge.
- **Bench** BR-4/5/6; the cave/overhang scenes are the topology firewall proof.

## Reference index

- River/terrain fn: [`main.js:93-145`](../reference/glacial-valley/main.js#L93-L145)
- Rapid mask (placement): [`main.js:762-810`](../reference/glacial-valley/main.js#L762-L810)
- Drusniel terrain gen: [`src/voxel/terrain/`](../../src/voxel/terrain/), [`meshing/sdf.rs`](../../src/voxel/meshing/sdf.rs), [`terrain_generation.yaml`](../../assets/config/terrain_generation.yaml)
- Water bodies: [`src/voxel/runtime/water_bodies.rs`](../../src/voxel/runtime/water_bodies.rs)
- clod-poc worldgen: [`tools/clod-poc/src/terrain.ts`](../../tools/clod-poc/src/terrain.ts)
