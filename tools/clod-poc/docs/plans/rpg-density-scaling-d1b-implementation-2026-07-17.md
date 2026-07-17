# RPG density scaling D1b — implementation handover

Date: 2026-07-17
Status: IMPLEMENTED ON MAIN, LOCAL WEBGPU EVIDENCE PENDING

## Scope landed

Two deterministic benchmark compositions now exist:

- `scene=rpg-village`
  - route site centered at `(1600, 500)`
  - 40 seeded modular buildings
  - target range: 1,500–4,000 loaded construction pieces
  - 400 seeded placed props
  - north/south and east/west road/plaza corridors reserved clear
- `scene=rpg-player-base`
  - reachable site centered at `(1900, 650)`
  - one seeded 200–600-piece modular base
  - 100 seeded placed props outside the base footprint

The requested scene is preserved in `rpgDensityScene` while runtime world identity is canonicalized to `scene=continent`. This reuses the accepted continent hydrology, CLOD, height-tile, far-summary, and far-clipmap path instead of introducing a parallel benchmark renderer.

Both profiles use a 32-page, 2,048 m authored domain. This contains the plan-1 route coordinates and keeps finite player/collider bounds consistent with the benchmark content.

## Determinism and runtime ownership

`src/qa/rpg_density_scene_composition.ts` owns the pure seeded composition.

The generator produces:

- stable construction entity IDs;
- stable prop IDs through the project-prop conversion;
- finite transforms;
- coherent connection references;
- contact-aligned floors, walls, pillars, and fences;
- road/plaza and base-footprint prop clearance.

Runtime startup:

1. resolves `rpgDensityScene`;
2. generates the composition from the resolved world seed;
3. restores the prop composition into the normal `projectPropEditStore`;
4. loads the construction composition through the normal persistence validation/store/collider/graph path using a temporary scene-and-seed-scoped storage key;
5. deletes that temporary key after startup, leaving the normal player construction save untouched.

Imported project props and loaded save-world prop authority still take precedence over the benchmark default prop composition.

## D1a descriptor gaps closed

The workload-descriptor collector now measures or sources:

- `construction_pieces_total` from `construction_placed_meshes`;
- `construction_pieces_visible` by visible construction mesh traversal;
- `interactive_props` from prop counters, with the composition count as startup fallback;
- `colliders` as the sum of prop, construction, and terrain collider counters when available.

Construction meshes now set `castShadow` and `receiveShadow`, so `shadow_casters` includes settlement pieces. Long-view realtime sun shadows remain disabled by existing renderer policy; the counter therefore records shadow-capable composition, not a dense shadow-pass cost. Shadow GPU cost belongs in the later measured A/B work, not this authoring phase.

## Construction restore scaling

D1b exposed two restore-time O(N²) patterns before the scene was gated:

- rebuilding the loaded-piece ID set for every candidate;
- testing every candidate against every previously loaded placement.

The loader now maintains one incremental loaded-ID set and uses `ConstructionOverlapIndex` for local overlap candidates by default. Strict persistence semantics remain unchanged.

## Tests added or extended

- deterministic composition equality and seed divergence;
- village/base authoring ranges;
- unique IDs and valid connection references;
- prop clearance corridors;
- strict persistence restore of both full compositions with zero dropped pieces;
- RPG scene registry and continent canonicalization;
- direct RPG world-mode classification;
- bundled phase-0 camera coordinates;
- required split construction-catalogue IDs;
- construction shadow flags;
- workload descriptor sources and summed colliders.

## URLs for local evidence

```text
http://localhost:5173/?scene=rpg-village&seed=1337&renderer=webgpu
http://localhost:5173/?scene=rpg-player-base&seed=1337&renderer=webgpu
```

After defaults apply, the URL/runtime state may show `scene=continent&rpgDensityScene=...`; this is intentional.

## Required evidence before checking D1b complete

For each URL, record:

- one settled screenshot;
- one stats snapshot after queues drain;
- startup console with zero construction or prop load errors;
- the resolved seed;
- `rpg_density_*` counters;
- `construction_placed_meshes` and `construction_colliders_active`;
- `props.total_instances`, `props.colliders_active`, and candidate counters;
- the complete `wd_*` descriptor row.

The composition table must report measured values, not YAML targets:

```text
scene | seed | buildings | pieces total | pieces visible | avg/max pieces/building
      | placed props | colliders | shadow casters | unique meshes/materials
```

## Honest remaining boundary

D1b reserves deterministic road/plaza corridors but does not yet author a new road/plaza terrain stamp. The scenes sit on the plan-1 route coordinates and remain compatible with later route/stamp composition. A visible authored road/plaza stamp should either be added before D1c or explicitly moved to the D1c route-composition work with evidence.

D1c performance baselines, five-run tables, and shipping thresholds are not part of this implementation handover and remain open.
