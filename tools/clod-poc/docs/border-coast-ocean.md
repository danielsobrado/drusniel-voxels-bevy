# Border Coast And Ocean

## Status And Scope

This is a prototype-only design for `tools/clod-poc`.

The implementation boundary is strict:

- All code, configuration, tests, scenes, and assets live under `tools/clod-poc`.
- Main Bevy/Rust production code is unchanged.
- Production `water.yaml`, terrain generation, and colliders are unchanged.
- The Rust CLOD page builder is unchanged.

The goal is to hide the finite playable-world border with a natural coastal transition
without changing CLOD ownership rules. Land inside the playable bounds remains real
terrain. Water and the deep ocean are separate render-only geometry.

## Required Ownership

| Region or feature | Location | Geometry owner | CLOD source mesh | Collision |
|---|---|---|---|---|
| Inland terrain | Inside playable bounds | Terrain generator | Yes | Existing PoC terrain policy |
| Beaches and dunes | Inside playable bounds | Terrain generator | Yes | Existing PoC terrain policy |
| Rocky beaches and cliffs | Inside playable bounds | Terrain generator | Yes | Existing PoC terrain policy |
| Coves and terrain reefs | Inside playable bounds | Terrain generator | Yes | Existing PoC terrain policy |
| Water over in-bounds coast | Inside playable bounds | Water renderer | No | No |
| Surf, foam, and breakers | Near shoreline | Water/effect renderer | No | No |
| Deep ocean | Outside playable bounds | Ocean renderer | No | No |
| Optional scenic props | Outside playable bounds | Prop renderer | No | No |

No terrain heightfield, terrain page, terrain collider, or terrain simplification input
may be generated outside the playable bounds. Optional outside-border scenic props must
be non-collidable and must not be used as terrain or CLOD source data.

## Spatial Model

Let the playable terrain domain be the closed square:

```text
P = [0, worldSize] x [0, worldSize]
```

For a point inside `P`, define `borderDistance` as the shortest X/Z distance to any
side of the playable domain. The coastal transition occupies an inward-facing band:

```text
coastBand = borderDistance <= coastWidth
```

Only samples inside `P` are evaluated by terrain generation. There is no terrain
fallback outside `P`.

The visible shoreline must not follow `borderDistance` directly. A deterministic,
low-frequency coastal field perturbs the inland reach of the sea and controls local
coastal character. This creates coves, headlands, beaches, and cliff runs while keeping
all generated terrain within the playable domain.

The outermost in-bounds terrain strip must descend below the minimum visible ocean
surface by a configured concealment depth. The terrain mesh still ends at the exact
playable boundary, but its terminal edge is underwater and hidden by the ocean surface,
fog, depth attenuation, and wave treatment. This removes the visible rectangular land
edge without extending terrain generation beyond the border.

## Coastal Terrain Generation

Coastal shaping is an in-bounds modifier applied before leaf CLOD page source meshes
are built. It must be deterministic for a given world seed.

Suggested inputs:

- normalized inward border distance;
- broad coastline noise for headlands and coves;
- lower-frequency regional noise for coastal type;
- existing inland height, slope, and material fields;
- deterministic masks for cliffs, dunes, rocks, and reefs.

The modifier should produce continuous height and material fields:

- **Beach:** a shallow slope through sea level with a broad sand band.
- **Dune:** low ridges landward of sandy beaches, blended into inland terrain.
- **Rocky beach:** a steeper shore with rock material and deterministic rock props.
- **Cliff:** elevated inland terrain with a steep descent before the submerged edge.
- **Cove:** a local inward displacement of the shoreline with protected shallow water.
- **Reef:** submerged in-bounds terrain or non-collidable visual props. Terrain reefs
  participate in CLOD; visual reef props do not.

Transitions between types must be blended through continuous masks. Coastal type must
not be selected independently per page because page-local classification would expose
page seams.

At the exact playable boundary:

- height is below sea level by at least the concealment depth;
- the boundary is deterministic from either adjacent page;
- existing page border locking and validation remain authoritative;
- no vertex is emitted outside `P`.

## CLOD Pipeline

The coastal modifier belongs upstream of the TypeScript PoC leaf-page source builder:

```text
in-bounds terrain field
        |
        v
coastal height/material modifier
        |
        v
LOD0 terrain page source meshes
        |
        v
child merge -> border lock -> simplify -> normals -> error
        |
        v
derived parent page caches
        |
        v
normal CLOD selection
```

Beaches, cliffs, coves, and terrain reefs therefore appear in LOD0 source meshes and
all parent pages remain derived caches. Parent pages must not resample either the
terrain field or the coastal field.

The coastal terrain must use the normal `selectCut()` path. There must not be a
separate non-CLOD border terrain ring because that would conceal selection errors and
create a second terrain ownership model.

## Water And Ocean Pipeline

Water is built and rendered independently from terrain pages:

```text
shoreline/depth fields ──> in-bounds coastal water ─┐
                                                    ├─> water render passes
outside-border ocean domain ──> deep ocean surface ┘

terrain page meshes ──> CLOD derivation and selection
```

The water renderer may sample terrain-derived shoreline or depth summaries, but it
must never append water vertices or indices to a `PageMesh`. Water surfaces, surf
meshes, foam ribbons, and ocean patches must not enter child merge, border locking,
simplification, parent error computation, or CLOD selection.

Deep ocean geometry starts at or slightly inside the playable border and extends to
the visual horizon. A small overlap with the submerged in-bounds terrain is allowed to
prevent cracks. The overlap does not transfer ownership: the ocean remains render-only.

The ocean should use camera-relative or ring-based geometry so its outer boundary is
outside the visible horizon. Depth color, atmospheric haze, normal detail, and wave
scale should transition from coastal shallows to deep ocean without exposing the
square playable footprint.

## Surf And Shoreline Effects

Surf is derived from the relationship between sea level and in-bounds terrain:

- shoreline foam follows the sea-level crossing;
- breakers use shallow-water depth and coast-facing gradients;
- cove water is calmer than exposed headlands;
- reef foam may use submerged terrain depth or an explicit visual mask.

These effects are visual only. They must not create colliders, terrain pages, or CLOD
source triangles. Shoreline extraction should consume a bounded field or texture rather
than generate terrain outside the playable domain.

## Preventing A Visible Rectangular Border

The design relies on all of the following:

1. The shoreline meanders inside the playable bounds.
2. Every side and corner reaches submerged terrain before the exact boundary.
3. Deep ocean overlaps the submerged terminal terrain strip.
4. Coastal materials and slopes vary continuously across page boundaries.
5. Ocean geometry reaches beyond the camera horizon.
6. Fog, depth attenuation, and wave detail hide the underwater terminal edge.

Corners require explicit validation. Taking the minimum distance to four sides can
produce diagonal or pinched patterns near corners; broad coastal noise and a corner
blend must keep them looking like bays, headlands, or open water rather than square
terrain corners.

## Invariants And Guards

The PoC implementation should make ownership failures measurable:

- `terrainSamplesOutsidePlayableBounds == 0`
- `terrainVerticesOutsidePlayableBounds == 0`
- `waterTrianglesInLeafSourceMeshes == 0`
- `waterTrianglesInParentSimplifierInput == 0`
- `outsideTerrainPagesBuilt == 0`
- `coastalLeafPagesBuilt > 0` for the border-coast scene
- `coastalPagesSelected > 0` when the camera approaches the coast

Use a terrain-only material/geometry tag before page derivation and assert that every
triangle passed to the simplifier has that ownership. Do not rely only on visual
inspection to prove that water was excluded.

Derived-cache behavior should also be tested: modifying the deterministic coastal
source must change affected leaf pages and their ancestors, while unrelated pages
remain unchanged.

## Deterministic Verification Scene

Add a CLOD-POC-only deterministic scene when implementation begins. It should provide:

- fixed seed and frozen time;
- camera poses for one beach, cliff, cove, reef, and corner;
- a high oblique pose that would reveal a rectangular edge;
- terrain-only, water-only, CLOD-level, and page-boundary debug views;
- counters for the invariants above;
- selected page IDs and triangle counts;
- screenshots and stats through the existing shot harness.

The critical views are:

1. inland-to-ocean final render;
2. terrain-only render proving the coast is real page terrain;
3. CLOD debug render proving coastal pages participate in selection;
4. water-only render proving independent ownership;
5. page source/simplifier diagnostics proving zero water triangles;
6. all four corners from elevated oblique cameras.

Because visual benches must not run from WSL, capture these shots from a native Windows
shell and report the generated PNG and stats JSON paths.

## Acceptance Criteria

The feature is accepted only when:

- no hard rectangular world edge is visible from the required border and corner poses;
- beach and cliff geometry is present in LOD0 terrain source meshes;
- coastal terrain remains visible and correct across CLOD selections;
- parent pages are derived from child page meshes;
- water and deep ocean are rendered independently from terrain pages;
- no water triangle reaches any CLOD simplifier input;
- no terrain is sampled or generated outside the playable bounds;
- any outside-border scenic prop is non-collidable and excluded from CLOD;
- deterministic shots and counters verify the ownership rules.

## Non-Goals

- Production Bevy/Rust integration.
- Changes to production water configuration.
- Changes to production terrain generation or colliders.
- Ocean physics, swimming, boats, or water collision.
- Infinite playable terrain.
- Using an outside-border terrain skirt as a substitute for deep ocean.
