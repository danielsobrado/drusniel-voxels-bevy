# Glacial Valley — Reference Adoption Overview & Firewall

> Created: 2026-06-17 · Status: Scoping
> Reference: [`docs/reference/glacial-valley/`](../reference/glacial-valley/)
> (`main.js`, `shaders.js`, `trees.js`, `README.md`) — a ~2,400-line Three.js/WebGL2
> demo: no engine, no textures, no models, all procedural math.

This is the scoping/firewall document for borrowing from the `glacial-valley` demo.
It states **what we take, what we refuse, and why**, then links the per-part plans.
It mirrors the role [`laas-cdlod-far-field-reference-plan.md`](laas-cdlod-far-field-reference-plan.md)
plays for the LAAS demo: fix the boundary first so the borrow can't creep.

> **Do not implement from this overview.** It is scope only. All implementation
> happens through the per-plan phase gates (each plan's numbered steps + Verify). If a
> step isn't in a per-plan gate, it isn't approved work yet.

## What glacial-valley actually is

A static-sun alpine valley at sunrise. One height function (`terrainH`,
[`main.js:96`](../reference/glacial-valley/main.js#L96)) drives the terrain mesh, the
player physics, water depth, and **every** object placement. Sun visibility is
ray-marched over a baked heightfield ([`bakeShadows`](../reference/glacial-valley/main.js#L176))
because the sun never moves. Water, grass, mist, motes, dew, birds, fish-rings and
post (ACES) are all procedural. It is gorgeous and it is **structurally a 2.5D
heightfield**.

## The non-negotiable guardrail (read before any port)

### GV-G0 — Representation firewall (inherited from LAAS G0)
A `y = f(x,z)` heightfield representation may **never** own any footprint inside the
editable voxel world. Drusniel terrain is authoritative voxel data (invariant I1),
the live bubble is editable Surface Nets (I5), CLOD pages are voxel-derived
decimations (I2–I3). glacial-valley's height function cannot express overhangs,
caves, arches, cave mouths, or post-edit voids — the exact things our SDF produces.
See [`laas-cdlod-far-field-reference-plan.md` §0](laas-cdlod-far-field-reference-plan.md)
for the full argument; it applies here verbatim and *more* strongly.

> Consequence: we borrow **algorithms and looks**, never the terrain representation.
> The braided-river port (Plan 3) stamps an **SDF into the density field**, it does
> **not** introduce a heightfield.

### Licensing — cleared
The reference license has been checked and is **fine to use directly**. Code may be
adapted/translated from `main.js`/`shaders.js` without a clean-room rewrite; still
translate (GLSL→WGSL, JS→Rust) and adapt to our bindings rather than blind-pasting,
for correctness, not legal, reasons.

## What we take vs refuse

| glacial-valley feature | Verdict | Plan |
|---|---|---|
| Glacial/cold **water look** (turquoise rock-flour scatter, fast red absorption, depth caustics, rapid foam, sun glitter) | **Take as a preset** on top of the existing water upgrade | [Plan 1](glacial-valley-water-preset-plan.md) |
| **Baked heightfield sun-visibility** ray-march + sun-vis-tinted height fog | **Take as a reference** for NAADF/CLOD far-field visibility + fog shafts (not for near terrain) | [Plan 2](glacial-valley-far-field-sun-visibility-plan.md) |
| **Braided-river shaping** (meander + half-width + gravel bars + rivulets) | **Take as voxel/SDF worldgen** (never a heightfield) | [Plan 3](glacial-valley-braided-river-worldgen-plan.md) |
| **"One terrain query" discipline** | **Take as a shared query layer**, not a single height fn | [Plan 4](glacial-valley-terrain-query-discipline-plan.md) |
| **Biome micro-detail** (mist, splash droplets, motes/pollen, dew/frost, gravel bars) | **Take as biome detail masks**, aggressively culled | [Plan 5](glacial-valley-biome-detail-masks-plan.md) |
| **Seasonal / day-night art-direction state vector** | **Take as an explicit biome visual-state struct** | [Plan 6](glacial-valley-biome-visual-state-plan.md) |
| **Terrain heightfield architecture** | **REFUSE** (GV-G0) | — |
| **Whole-cloth water-renderer replacement** | **REFUSE** — ours is deeper; we add a preset | [Plan 1](glacial-valley-water-preset-plan.md) |
| **Using fog to hide draw distance** | **REFUSE** (already banned by the far-field plan) | — |
| (License) | Cleared — direct adaptation OK | — |
| **Baking the sun (static-sun assumption)** | **REFUSE for runtime** — Drusniel has moving time-of-day; the bake is a *reference* for a cached far-field pass only | [Plan 2](glacial-valley-far-field-sun-visibility-plan.md) |

## Two-target discipline (every plan)

Per [`clod-execution-plan.md` §10](../plans_completed/clod-execution-plan.md), behaviour that does not
yet exist is prototyped in the cheap **clod-poc** Three.js sandbox first, then ported
to **Bevy**. glacial-valley *is itself* a Three.js sandbox, so for the looks (water,
detail, art direction) the clod-poc port is nearly a like-for-like translation and is
the fast iteration surface; the Bevy port is the WGSL/Rust re-implementation that must
be **benched** per [`CLAUDE.md`](../../CLAUDE.md). Each plan carries its own
clod-poc ↔ Bevy parity matrix.

### clod-poc as the look-dev preview (the "editor preview" idea)
The other reviewer suggested a small Three.js procedural preview for biome/water
look-dev. We already have one: [`tools/clod-poc/`](../../tools/clod-poc/) is a
deployable Vite app with a player controller and `lil-gui` panel
([`laas-cdlod-far-field-reference-plan.md` §5.2](laas-cdlod-far-field-reference-plan.md)).
So "editor preview" is **not a new tool** — it's the rule that every glacial-valley
look (water preset, detail masks, visual-state vector) lands first as a toggleable
clod-poc control, and the Bevy build is validated against it by feel + bench. No
separate plan; it's a cross-cutting acceptance rule in Plans 1, 5, and 6.

## Recommended integration order (value × safety)

Two cheap "skeletons" lead so the later plans bind to shared structures instead of
inventing private ones (the share-the-control-vector / share-the-query argument):

1. **[Plan 6 · VS-1 skeleton only](glacial-valley-biome-visual-state-plan.md)** — the
   `BiomeVisualState` resource + YAML + debug UI, **no shader consumers yet**. Cheap;
   gives water/details/snowline/season one place to read from. (Rest of Plan 6 lands
   later as VS-2/3.)
2. **[Plan 4 · TQ-0 contract only](glacial-valley-terrain-query-discipline-plan.md)** —
   the `TerrainQuery` trait + result structs, **no migration, no new logic**. So the
   river/detail plans consume one query surface from day one instead of re-deriving
   slope/water/visibility in four places.
3. **[Plan 1 — Glacial water preset](glacial-valley-water-preset-plan.md)** — highest
   look-per-effort; rides on the already-planned water upgrade; reads
   `glacial_murkiness` from VS-1.
4. **[Plan 3 — Braided-river worldgen spike](glacial-valley-braided-river-worldgen-plan.md)**
   — biome-quality, clod-poc first, SDF stamps only; brings the **TQ-1 river/detail
   adapter** with it.
5. **[Plan 5 — Biome detail masks](glacial-valley-biome-detail-masks-plan.md)** — ship
   **masks-as-debug-overlays first (DM-0)**, then one consumer at a time; reads VS-1 +
   TQ-1.
6. **[Plan 2 — Far-field sun visibility / fog shafts](glacial-valley-far-field-sun-visibility-plan.md)**
   — reference for the NAADF + far-shell work already on the roadmap.
7. **Finish [Plan 6](glacial-valley-biome-visual-state-plan.md) (VS-2/3) and
   [Plan 4](glacial-valley-terrain-query-discipline-plan.md) (migrate remaining
   consumers)** opportunistically, once their consumers exist.

## Reference index

- Terrain height fn (meander/bars/rivulets/ridged): [`main.js:96-145`](../reference/glacial-valley/main.js#L96-L145)
- Heightfield + shadow bake: [`main.js:151-218`](../reference/glacial-valley/main.js#L151-L218)
- Day/night + season state: [`main.js:938-989`](../reference/glacial-valley/main.js#L938-L989)
- GLSL common (sun vis, atmo, lighting): [`shaders.js:4-190`](../reference/glacial-valley/shaders.js#L4-L190)
- Water shader: [`shaders.js:377-475`](../reference/glacial-valley/shaders.js#L377-L475)
- Detail placement (grass/dew/pebble/mist/mote/splash/ring): [`main.js:426-810`](../reference/glacial-valley/main.js#L426-L810)
- Post (ACES/vignette/grain): [`shaders.js:1218-1242`](../reference/glacial-valley/shaders.js#L1218-L1242)
- Sibling firewall: [`laas-cdlod-far-field-reference-plan.md`](laas-cdlod-far-field-reference-plan.md)
