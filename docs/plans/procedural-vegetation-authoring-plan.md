# Procedural Vegetation Authoring — Port Plan

> Created: 2026-06-17 · Status: Planning
> Scope (clod-poc): `tools/clod-poc/src/` (new generator + baker modules)
> Scope (Bevy): `src/bin/bake_impostors.rs`, `src/props/{loader,billboard,instancing,persistence}.rs`,
> `assets/config/props.yaml`, `assets/textures/billboards/generated/`
> Related: [`bevy-gpu-vegetation-port-plan.md`](bevy-gpu-vegetation-port-plan.md) (runtime cull/draw — consumes these assets),
> [`props-virtual-geometry-execution-plan.md`](props-virtual-geometry-execution-plan.md) (meshlet pilot — can consume hero meshes),
> [`clod-poc-gpu-vegetation-early-rejection.md`](clod-poc-gpu-vegetation-early-rejection.md) (current clod-poc GPU vegetation rejection status — sibling).

Port LAAS/fable5's procedural vegetation **generators** into Drusniel as
**authoring-time tooling**, not runtime generation. Generators run in the
clod-poc sandbox (and an optional headless Rust baker), emit a cached asset bundle
(LOD meshes + octahedral impostors + metadata), and the Bevy runtime **streams,
persists, and renders** that cache through its existing prop/billboard/placement
systems.

## What this is / is not

- **Is:** offline/editor generation of tree species, cluster-card foliage,
  octahedral impostors, shrubs/ferns/flowers, deadfall, rocks, moss/lichen
  dressing — baked to a versioned on-disk cache that the runtime loads.
- **Is not:** runtime procedural generation, a new runtime renderer, or replacing
  the hand-authored GLTF props (those keep working; generated assets are additive).

## Repo reality (audit — what already exists)

The Bevy side is **not greenfield**:
- **Prop assets are GLTF scenes** loaded by id/path from `config/props.yaml`
  ([`src/props/loader.rs`](../../src/props/loader.rs):
  `asset_server.load("{path}#Scene0")`). Today these are **hand-authored**, not
  generated.
- **An offline baker already exists:** [`src/bin/bake_impostors.rs`](../../src/bin/bake_impostors.rs)
  is a headless Bevy binary that loads prop GLTFs, renders them from N directions
  (default **8, axial/cylindrical around Y**), reads back via `gpu_readback`, and
  writes transparent billboard textures + `BillboardMetadata` /
  `BillboardAlphaCoverage` / `BillboardSourceBounds` to
  `assets/textures/billboards/generated/`.
- **A runtime billboard-LOD cache exists** ([`src/props/billboard.rs`](../../src/props/billboard.rs):
  `BillboardCache`, `BillboardMode`, `BillboardAsset`) consuming those baked
  textures as the far LOD tier above the custom instanced mesh path.
- **Placement persistence + manifest exists** ([`src/props/persistence/schema.rs`](../../src/props/persistence/schema.rs):
  `PropPlacementData`, `ChunkPropData`, `PropManifest` with `world_seed`,
  `terrain_config_fingerprint`, per-chunk `hash`). Placement is already
  content-fingerprinted and chunked.

The clod-poc side is **already an authoring sandbox**:
- A **GLB exporter** ([`tools/clod-poc/src/gltf_export.ts`](../../tools/clod-poc/src/gltf_export.ts):
  `buildAllLodsExportScene` → binary GLB via three's `GLTFExporter`).
- A **lil-gui authoring UI**, material carousel, and source-mesh tooling
  ([`material_carousel.ts`](../../tools/clod-poc/src/material_carousel.ts),
  [`source_mesh.ts`](../../tools/clod-poc/src/source_mesh.ts)).

**The gaps vs LAAS** (what this plan adds):
1. **Procedural source-mesh generation** (tree grammar, foliage cards, rocks,
   understory, deadfall, dressing) — Drusniel currently has none; assets are
   hand-made.
2. **Octahedral impostors** (8×8 hemi-oct, albedo + normal + depth, view-blended)
   — the existing baker only does 8-direction axial billboards.
3. **No-pop LOD ring meshes** derived from one skeleton (hero / R1 / R2), so LOD
   swaps change triangle cost, not shape.

## LAAS generator inventory (what to port, with refs)

All under [`docs/reference/fable5-world-demo/src/vegetation/`](../reference/fable5-world-demo/src/vegetation/):

| Generator | File | Produces |
|---|---|---|
| Tree skeleton + branching grammar | `Skeleton.ts`, `TreeBuilder.ts`, `TubeMesh.ts` | branch tubes, anchors, per-instance lean/age/bias |
| Species parameter space | `Species.ts`, `VegTypes.ts` | 6 species param sets |
| Cluster-card foliage (the "ez-tree look") | `FoliageCards.ts`, `LeafMesh.ts` | per-species 2×2 leaf/needle atlases captured from real leaf meshes |
| Octahedral impostors | `Impostors.ts` (8×8, 256px tiles, albedo+normal+depth), `render/ImpostorRuntime.ts` | albedo+coverage atlas, normal+depth atlas, blend material |
| Pools / variants / LOD rings | `VegLibrary.ts` | K=4 variants/species; R0/R1/R2 rings from one skeleton; hero tri-diets |
| Rocks | `RockBuilder.ts` | rock geometry (cobble/pebble/boulder), moss param |
| Understory | `Understory.ts` | shrub / fern / flower meshes |
| Deadfall | `Deadfall.ts` | logs ×3 decay, stumps, shelf/cap fungi |
| Moss/lichen dressing | `Dressing.ts` | surface dressing layers |
| Bark synthesis | `gpu/passes/BarkSynth.ts` | bark albedo/normal maps |
| Hierarchical wind (authoring-side metadata) | `render/Wind.ts` | per-vertex flex/phase attributes (`vdata`) the runtime wind reads |

LAAS does all of this **at boot on the GPU (WebGPU)**. We **decouple** it:
generate once at authoring time, cache to disk, load at runtime.

## The shared asset-cache format (the contract between clod-poc and Bevy)

A versioned, content-addressed bundle per generated prop. This is the single
interface both the TS baker and the Bevy runtime/baker agree on. Sits **alongside**
(does not replace) the hand-authored GLTF props.

```
assets/generated/vegetation/<species>/<variant>/
  lod0.glb            # hero mesh (bark + cards + mesh leaves)
  lod1.glb            # R1 ring (same skeleton, dieted)
  lod2.glb            # R2 ring
  impostor_albedo.ktx2  # 8x8 hemi-oct, rgb albedo + a coverage
  impostor_normdepth.ktx2 # rgb world-normal enc + a linear depth01
  meta.yaml           # see below
```

`meta.yaml` (YAML — repo convention):
```yaml
schema_version: 1
species: "beech"
variant: 2
seed: 12345                 # deterministic: seed+params -> identical bundle
params_fingerprint: "ab12…" # hash of the generator params
lods:
  - { file: "lod0.glb", tris: 98000, max_distance_m: 26.0 }
  - { file: "lod1.glb", tris: 12000, max_distance_m: 150.0 }
  - { file: "lod2.glb", tris: 2400,  max_distance_m: 460.0 }
impostor:
  grid: 8                   # 8x8 hemi-octahedral
  tile_px: 256
  radius: 7.4
  height: 18.2
bounds: { radius: 7.4, height: 18.2 }
wind:                       # so runtime wind matches authoring intent
  trunk_knee_m: 6.0
  flex_attribute: "vdata"   # GLB carries per-vertex flex/phase
anchors:                    # optional: dressing/attach points
  - { kind: "moss", at: [0.2, 1.1, -0.3] }
```

**Determinism + caching discipline:** seeded RNG; `seed + params_fingerprint`
uniquely determine the bundle, so re-bakes are skippable and the runtime can detect
stale caches. Extend `PropManifest`'s fingerprint set with the bundle
`schema_version` + per-asset `params_fingerprint` so a regenerated asset invalidates
dependent placement caches cleanly.

## Architecture split ("for both")

- **clod-poc = primary generator + baker + visual authoring UI.** Direct TS/Three.js
  port of the LAAS builders (same language/engine), reusing its `GLTFExporter`,
  lil-gui, and material carousel. Emits the asset-cache bundle above.
- **Bevy = primary consumer + editor preview + impostor-baker evolution.** Loads
  bundles through the existing prop loader/billboard cache; renders octahedral
  impostors as a LOD tier; previews generated variants in-editor with a "bake"
  trigger; placement persistence already exists.
- **Shared = the bundle format + fingerprinting.** Optional later: a headless
  Rust-native generator for CI determinism (Phase 6) so bakes don't require a
  browser.

## Phased plan

### Phase 0 — Define the bundle format + fingerprinting (shared, do first)
- Pin `meta.yaml` schema + directory layout above. Write a tiny shared spec doc.
- Decide impostor texture container (KTX2/Basis vs PNG) — match what Bevy's
  `AssetServer` loads cheaply and what clod-poc can export.
- Extend `PropManifest` fingerprint to include bundle `schema_version` +
  `params_fingerprint`.
- **Verify:** a hand-written sample bundle loads in Bevy (placeholder mesh + atlas)
  and is parsed by a clod-poc reader; fingerprint round-trips.

### Phase 1 — clod-poc: core tree generator + preview + export (vertical slice)
- Port `Skeleton.ts` + `TreeBuilder.ts` + `TubeMesh.ts` + `Species.ts` (start with
  **one species**), and `FoliageCards.ts` + `LeafMesh.ts` for cluster-card foliage.
- Derive R0/R1/R2 rings from one skeleton (`VegLibrary.ts` ring logic) → no-pop LODs.
- lil-gui preview: pick species/variant/seed, view LODs; export the bundle (GLB per
  LOD + `meta.yaml`) via the existing exporter.
- **Verify:** deterministic (same seed+params → byte-stable GLBs/fingerprint); LODs
  visually consistent; bundle matches Phase 0 schema.

### Phase 2 — clod-poc: octahedral impostor capture + atlas export
- Port `Impostors.ts` (8×8 hemi-oct; albedo+coverage, normal+depth) and the
  capture/compose path; export `impostor_albedo` + `impostor_normdepth` to the
  bundle. Reuse the transparent-clear + dilation discipline the Bevy baker already
  applies (halo avoidance).
- **Verify:** impostor preview blends the 3 nearest views without seams; coverage
  alpha matches the mesh silhouette.

### Phase 3 — clod-poc: rocks, understory, deadfall, dressing
- Port `RockBuilder.ts`, `Understory.ts` (shrub/fern/flower), `Deadfall.ts`
  (logs/stumps/fungi), `Dressing.ts` (moss/lichen). Each emits a bundle (LODs +
  impostor where it earns one; small clutter may skip impostors).
- **Verify:** each class previews + exports; small-clutter bundles omit impostor
  fields cleanly.

### Phase 4 — Bevy: consume bundles (loader + octahedral impostor render)
- Extend [`loader.rs`](../../src/props/loader.rs) / `props.yaml` to register
  generated bundles by id, loading per-LOD GLBs.
- Add an **octahedral impostor material** (view-blended albedo/normal/depth) as a
  LOD tier **above** the existing axial billboard
  ([`billboard.rs`](../../src/props/billboard.rs)) — extend `BillboardMode` /
  `BillboardAsset`, don't fork them. Hand off mesh-LOD → impostor → (optional)
  axial billboard by distance.
- **Verify (bench discipline):** render a generated tree through all LOD tiers on a
  `forest-*` bench scene; no popping at ring/impostor handoffs; frame time within
  threshold vs hand-authored props.

### Phase 5 — Bevy: editor preview + bake trigger + cache invalidation
- Editor mode to preview a generated species/variant/seed and its LOD tiers; a
  "bake/regenerate" action (invokes the clod-poc baker, or the Rust baker from
  Phase 6) writing the bundle; reload on change.
- Stale-cache detection via `params_fingerprint` (regenerate or warn).
- **Verify:** edit params → preview updates → bake → runtime picks up new bundle;
  fingerprint mismatch is detected.

### Phase 6 — Bevy: evolve `bake_impostors.rs` + optional Rust-native generator
- Upgrade [`bake_impostors.rs`](../../src/bin/bake_impostors.rs) from 8-axial to
  **8×8 octahedral** (albedo+normal+depth), emitting the bundle's impostor atlases —
  so impostors can be re-baked headlessly from any GLB (generated or hand-authored)
  without a browser.
- **Optional (later):** a headless Rust port of the tree/rock grammar for
  deterministic CI bakes with no browser dependency. Keep clod-poc as the
  fast-iteration authoring path; Rust baker is for reproducible pipeline runs.
- **Verify:** Rust-baked impostor bundle is interchangeable with the clod-poc one
  (same schema, visually matched).

### Phase 7 — Wind/anchor metadata round-trip
- Bake per-vertex flex/phase (`vdata`) into the GLBs and trunk-knee/wind params into
  `meta.yaml` (from `Wind.ts`), so the runtime wind shader reproduces the authoring
  motion. Reconcile with Drusniel's existing
  [`vegetation/wind.rs`](../../src/world/environment/vegetation/wind.rs).
- **Verify:** a generated tree sways consistently between clod-poc preview and Bevy
  runtime.

## Relationship to the other plans

- **Feeds** [`bevy-gpu-vegetation-port-plan.md`](bevy-gpu-vegetation-port-plan.md):
  that plan draws *instances* of these bundles; this plan produces the *source
  assets + LODs + impostors* it draws.
- **Feeds** [`props-virtual-geometry-execution-plan.md`](props-virtual-geometry-execution-plan.md):
  generated hero (LOD0) meshes are natural meshlet sources for the static-opaque
  pilot.
- **Sibling of** [`clod-poc-gpu-vegetation-early-rejection.md`](clod-poc-gpu-vegetation-early-rejection.md):
  ground-cover grass is runtime-instanced (clipmap), while shrubs/ferns/flowers here
  are baked prop bundles — keep the boundary clear (carpet vs placed prop).

## What NOT to do

- Don't add a new runtime generation system — generation is authoring-time only.
- Don't replace hand-authored GLTF props — generated bundles are additive.
- Don't fork the billboard system — extend `BillboardMode`/`BillboardAsset` for the
  octahedral tier.
- Don't re-invent the headless baker — evolve `bake_impostors.rs`.
- Don't bake non-deterministically — seed + params must fully determine the bundle.

## Open questions

1. **Impostor container:** KTX2/Basis (GPU-compressed, smaller, Bevy-loadable) vs
   PNG (simple, larger). Affects both bakers — decide in Phase 0.
2. **Generator host of record:** clod-poc-only first (fast), with the Rust-native
   generator deferred — or is browser-free CI baking a hard requirement up front?
3. **How much of LAAS's GPU bark/leaf synthesis** (`BarkSynth.ts`, GPU capture)
   ports cleanly to clod-poc's WebGL context vs needs a CPU/canvas fallback (clod-poc
   is WebGL, LAAS is WebGPU — same constraint as the grass plan).

## Reference index

- LAAS generators: [`docs/reference/fable5-world-demo/src/vegetation/`](../reference/fable5-world-demo/src/vegetation/)
- LAAS impostors: [`docs/reference/fable5-world-demo/src/vegetation/Impostors.ts`](../reference/fable5-world-demo/src/vegetation/Impostors.ts), [`render/ImpostorRuntime.ts`](../reference/fable5-world-demo/src/render/ImpostorRuntime.ts)
- Existing Bevy baker: [`src/bin/bake_impostors.rs`](../../src/bin/bake_impostors.rs)
- Existing billboard LOD: [`src/props/billboard.rs`](../../src/props/billboard.rs)
- Prop loader / config: [`src/props/loader.rs`](../../src/props/loader.rs)
- Placement persistence: [`src/props/persistence/schema.rs`](../../src/props/persistence/schema.rs)
- clod-poc GLB export: [`tools/clod-poc/src/gltf_export.ts`](../../tools/clod-poc/src/gltf_export.ts)
