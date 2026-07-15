# Fable5 Parity 5 — Ecological Dressing, Decay, and Surface Attachment

Status: implementation plan.

Scope: `tools/clod-poc` first, then Rust/Bevy through the same class registry, deterministic IDs, placement stages, attachment records, persistence rules, GPU rendering groups, and acceptance gates.

This plan is prescriptive. The implementer must not choose different class ownership, persistence boundaries, placement order, attachment rules, render ownership, stable-ID formulas, or acceptance thresholds.

## 1. Goal

Add the ecological layers that make Drusniel's terrain and vegetation look like a living environment rather than a terrain surface populated by isolated trees and generic understory.

The system must add:

- fresh, mossy, and rotten deadfall;
- broken trunks and stumps;
- shelf fungi and cap fungi;
- moss and lichen patches;
- twig, bark-chip, leaf-litter, and needle-litter clusters;
- hanging vines;
- cliff and cave-mouth ferns;
- talus and erosion debris;
- river cobbles, wet stones, driftwood, and bank plants;
- exposed-root and buttress dressing;
- biome-specific ground clutter transitions.

It must preserve:

- canonical carved heightfield terrain;
- voxel caves, overhangs, edits, and destruction;
- deterministic environmental placement;
- persistent destruction and project-prop identity;
- existing tree, grass, understory, stone, GPU-ring, LOD, shadow, and save systems;
- one owner per rendered instance;
- no frame-path procedural mesh generation.

## 2. Fixed ownership categories

Every dressing item belongs to exactly one ownership category.

### 2.1 Persistent environmental props

These receive stable IDs and can be destroyed, harvested, or excluded by saves:

```text
DEAD_LOG_FRESH
DEAD_LOG_MOSSY
DEAD_LOG_ROTTEN
STUMP_FRESH
STUMP_ROTTEN
BROKEN_SNAG
LARGE_DRIFTWOOD
LARGE_TALUS_BOULDER
```

They are stored as deterministic candidates plus save-time exclusion records. They are not serialized individually until modified. When modified, the save stores the stable ID and state delta.

### 2.2 Parent-attached dressing

These are regenerated deterministically from a parent prop or terrain anchor and are not saved independently:

```text
SHELF_FUNGUS
CAP_FUNGUS
TRUNK_MOSS
TRUNK_LICHEN
ROOT_MOSS
HANGING_VINE
ROOT_FERN
```

Their identity includes the parent stable ID and attachment slot.

### 2.3 Terrain-attached cosmetic clusters

These regenerate from world cells and are not saved independently:

```text
MOSS_PATCH
LICHEN_PATCH
LEAF_LITTER
NEEDLE_LITTER
TWIG_CLUSTER
BARK_CHIP_CLUSTER
SMALL_TALUS
RIVER_COBBLES
WET_STONE_CLUSTER
SMALL_DRIFTWOOD
BANK_FERN
CAVE_MOUTH_FERN
CLIFF_FERN
FLOWER_PATCH
```

Saved terrain edits, structures, and project props invalidate or exclude them through existing masks.

No class may belong to more than one category.

## 3. Fixed class registry

Create a single registry in:

```text
tools/clod-poc/src/ecology/dressing/class_registry.ts
```

The registry defines exactly these 29 classes:

```ts
export const DRESSING_CLASSES = [
  "dead_log_fresh",
  "dead_log_mossy",
  "dead_log_rotten",
  "stump_fresh",
  "stump_rotten",
  "broken_snag",
  "large_driftwood",
  "large_talus_boulder",
  "shelf_fungus",
  "cap_fungus",
  "trunk_moss",
  "trunk_lichen",
  "root_moss",
  "hanging_vine",
  "root_fern",
  "moss_patch",
  "lichen_patch",
  "leaf_litter",
  "needle_litter",
  "twig_cluster",
  "bark_chip_cluster",
  "small_talus",
  "river_cobbles",
  "wet_stone_cluster",
  "small_driftwood",
  "bank_fern",
  "cave_mouth_fern",
  "cliff_fern",
  "flower_patch",
] as const;
```

The list contains 29 entries and that is the canonical count. Any count assertion must expect 29.

Each registry record defines:

```ts
export interface DressingClassDefinition {
  readonly id: DressingClassId;
  readonly ownership: "persistent" | "parent_attached" | "terrain_attached";
  readonly geometryFamily: string;
  readonly materialFamily: string;
  readonly placementStage: number;
  readonly spacingM: number;
  readonly maximumPerCluster: number;
  readonly lodDistancesM: readonly [number, number, number];
  readonly castsNearShadow: boolean;
  readonly castsProxyShadow: boolean;
  readonly cavePolicy: "reject" | "mouth_only" | "allow_floor" | "allow_wall";
  readonly attachmentPolicy: string;
}
```

Unknown class IDs fail startup and asset loading.

## 4. Fixed placement stages

Placement executes in this exact order:

```text
Stage 0: canonical terrain and voxel surface samples
Stage 1: trees and persistent large rocks
Stage 2: deadfall, stumps, snags, driftwood, large talus
Stage 3: shrubs, saplings, normal understory
Stage 4: parent-attached fungi, moss, lichen, vines, root ferns
Stage 5: river cobbles, wet stones, small talus, bank/cave/cliff ferns
Stage 6: litter, twigs, bark chips, moss patches, lichen patches, flowers
Stage 7: grass exclusion and blending around accepted dressing
```

Later stages may inspect earlier accepted records. Earlier stages never inspect later stages.

All stages are deterministic and world anchored.

## 5. Stable identities

Persistent environmental prop ID:

```text
stable_id = hash64(
  world_id,
  class_id,
  cluster_x,
  cluster_z,
  candidate_index,
  generator_schema_version
)
```

Parent-attached ID:

```text
stable_id = hash64(parent_stable_id, class_id, attachment_slot)
```

Terrain-attached ID:

```text
stable_id = hash64(world_id, class_id, world_cell_x, world_cell_z, candidate_index)
```

Camera position, LOD, residency, append order, and frame number are forbidden identity inputs.

## 6. Environmental sampling contract

Every placement decision receives:

```ts
export interface DressingEnvironmentSample {
  readonly positionWs: readonly [number, number, number];
  readonly normalWs: readonly [number, number, number];
  readonly materialWeights: readonly [number, number, number, number];
  readonly hardness: number;
  readonly sediment: number;
  readonly deposition: number;
  readonly moisture: number;
  readonly waterDepthM: number;
  readonly shoreDistanceM: number;
  readonly flowSpeed: number;
  readonly flowDirection: readonly [number, number];
  readonly canopyCoverage: number;
  readonly canopyHeightM: number;
  readonly forestEdge: number;
  readonly sunExposure: number;
  readonly caveCoverage: number;
  readonly caveMouthFactor: number;
  readonly structureCoverage: number;
  readonly terrainValidity: number;
}
```

Source order is identical to GPU vegetation authority:

1. canonical carved tile atlas;
2. exact voxel overlay;
3. hydrology channels;
4. far-summary ecology channels;
5. save and construction exclusion masks.

Parent-attached records also receive parent bounds, orientation, species/class, age, health, decay, and authored attachment anchors.

## 7. Fixed ecological rules

### 7.1 Dead logs

A dead-log candidate requires:

```text
slope <= 30 degrees
water depth <= 0.12 m
supported endpoints within 0.35 m of terrain
no structure exclusion
no persistent exclusion
```

Orientation:

```text
65% follows local downhill contour
20% aligns with prevailing windfall direction
15% random deterministic direction
```

Decay class selection:

```text
fresh:  age < 0.33
mossy:  age 0.33..0.72
rotten: age > 0.72
```

Decay age derives from stable ID, moisture, canopy shade, and biome temperature.

Mossy and rotten logs increase local fungi and moss attachment probability.

### 7.2 Stumps and broken snags

Stumps occur near deterministic dead-tree removals and deadfall origins. They do not appear as independent random clutter without a paired tree/deadfall event.

Broken snags use the tree structural system and persistent environmental IDs. Their crown coverage is zero and their decay/attachment channels remain active.

### 7.3 Fungi

Shelf fungi attach to:

```text
mossy logs
rotten logs
rotten stumps
old broadleaf trunks
broken snags
```

Cap fungi attach to terrain within:

```text
1.5 m of rotten wood
moisture >= 0.55
sun exposure <= 0.55
water depth = 0
```

Fungi are rejected in snow-dominant and dry-sand material regions.

### 7.4 Moss and lichen

Moss probability increases with:

```text
moisture
canopy shade
north-facing exposure bias
low-to-moderate slope
wood decay
shore proximity outside water
```

Lichen probability increases with:

```text
rock weight
hardness
sun exposure
moderate dryness
cliff or boulder curvature
```

Moss and lichen never occupy the same attachment slot. Moss wins when moisture is above 0.60; lichen wins otherwise.

### 7.5 Litter

Leaf litter requires broadleaf canopy coverage.

Needle litter requires pine/spruce canopy coverage.

Both are reduced by:

```text
flowing water
steep slope
exposed rock
recent terrain edits
construction footprint
```

Litter clusters blend into grass by writing a local grass-density suppression weight, not by deleting grass globally.

### 7.6 River and shore dressing

River cobbles require:

```text
shore distance between -2.0 m and 4.0 m
flow speed >= 0.15
sediment/deposition compatible with exposed bed or bank
```

Wet stone clusters require:

```text
shore distance between -1.0 m and 2.0 m
or wetness >= 0.70
```

Driftwood requires:

```text
shore distance 0.0..3.0 m
flow direction available
low bank slope
```

Orientation aligns 70% with flow and 30% perpendicular to represent lodged debris.

### 7.7 Cliff and cave dressing

Cliff fern:

```text
slope 55..88 degrees
moisture >= 0.45
rock weight >= 0.45
surface support from exact voxel or canonical terrain
```

Cave-mouth fern:

```text
cave mouth factor >= 0.45
sky exposure 0.10..0.65
moisture >= 0.50
```

Cave-floor classes are limited to moss patch, cap fungus, wet stone cluster, and cave-mouth fern within the configured entrance depth. No normal tree, grass, or flower placement is introduced by this plan inside deep caves.

## 8. Parent attachment system

Generated trees, logs, stumps, snags, and boulders expose deterministic attachment anchors.

Required anchor kinds:

```text
trunk_low
trunk_mid
trunk_high
root_flare
branch_dead
log_top
log_side
log_end
stump_top
stump_side
rock_shaded
rock_exposed
rock_crack
```

Anchor record:

```ts
export interface DressingAttachmentAnchor {
  readonly slot: number;
  readonly kind: DressingAnchorKind;
  readonly positionLocal: readonly [number, number, number];
  readonly normalLocal: readonly [number, number, number];
  readonly tangentLocal: readonly [number, number, number];
  readonly radiusM: number;
  readonly exposure01: number;
}
```

Anchors are emitted by the source generator or imported asset metadata. Runtime geometric scanning to invent anchors is forbidden.

Attachment placement:

1. Transform anchor to world.
2. Check parent age/health/decay rules.
3. Check environment moisture/exposure.
4. Check deterministic probability.
5. Check save/structure exclusion.
6. Emit parent-relative instance.

Parent-attached instances follow parent wind and destruction state.

## 9. Geometry families

Create or complete these generated geometry families in the CLOD-POC authoring pipeline:

```text
dead_log: fresh, mossy, rotten; 4 structural variants each
stump: fresh, rotten; 4 variants each
broken_snag: 4 variants
fungus_shelf: 6 cluster variants
fungus_cap: 6 cluster variants
moss_patch: 8 patch variants
lichen_patch: 8 patch variants
litter_leaf: 8 clusters
litter_needle: 8 clusters
twig_cluster: 8 clusters
bark_chip_cluster: 6 clusters
vine: 6 curves/card clusters
fern_bank: 6 variants
fern_cliff: 6 variants
fern_cave: 6 variants
river_cobble: 12 clusters
wet_stone: 8 clusters
driftwood: 6 variants
small_talus: 12 clusters
flower_patch: 8 variants
```

Near geometry must have real silhouette depth. Mid geometry may use cluster cards. Far geometry uses coverage cards or is omitted when below a two-pixel projected size.

No class generates unique geometry on the gameplay frame path.

## 10. Materials

Create material families:

```text
wood_decay
fungus
moss
lichen
litter
wet_stone
river_cobble
fern
vine
flower_patch
```

Material inputs include:

```text
class/variant
age/decay
wetness
snow coverage
probe GI
sun and shadow
forest lighting
wind
parent tint
```

Rules:

- moss darkens and increases roughness when wet;
- lichen remains matte and does not become glossy when wet;
- rotten wood has lower saturation, darker cavities, and softer normals;
- wet stones darken and gain controlled specular response;
- fungi remain diffuse and non-emissive;
- litter receives low wind flutter only;
- parent-attached moss/lichen inherits parent world transform and wind deformation.

## 11. GPU placement and rendering

Use the canonical GPU vegetation authority pipeline.

Add `DRESSING` category classes and class-specific acceptance functions. Do not create a second scatter framework.

GPU stages:

```text
classify dressing clusters
  -> generate terrain-attached candidates
  -> accept by environment/class rules
  -> generate parent attachment candidates from visible/resident parent records
  -> compact by class/LOD/shadow group
  -> indirect draw
```

Persistent large environmental candidates use the same GPU generation but check the save exclusion hash table.

Parent attachment candidates are generated only for resident parents and are reconstructed deterministically when the parent enters residency.

## 12. Persistence rules

Save schema extension:

```ts
export interface EnvironmentalPropDelta {
  readonly stableId: string;
  readonly classId: PersistentDressingClassId;
  readonly state: "destroyed" | "harvested" | "moved" | "replaced";
  readonly transformOverride?: SerializedTransform;
  readonly payload?: Record<string, unknown>;
}
```

Rules:

- untouched deterministic props are not serialized;
- destroyed/harvested stable IDs enter the exclusion store;
- moved/replaced props get a transform override;
- parent-attached and terrain-attached cosmetic items are never independently saved;
- destroying a parent removes its attachments automatically;
- regeneration after a version bump must run stable-ID migration or explicitly mark incompatible environmental deltas.

## 13. Voxel edit behavior

A voxel edit invalidates dressing clusters and parent attachments overlapping the dirty bounds.

Rules:

- terrain-attached items resample exact edited surfaces;
- unsupported items are removed after replacement buffers commit;
- cave-mouth factor updates when entrances open or close;
- deep cave creation does not spawn forest dressing until cave-specific rules accept it;
- stale dressing remains visible until the coherent replacement is ready unless it intersects newly solid geometry, in which case it is hidden immediately by the edit mask;
- no full-world or full-ring rebuild is permitted.

## 14. Configuration

Create `tools/clod-poc/config/ecological_dressing.yaml`:

```yaml
ecological_dressing:
  schema_version: 1
  enabled: true
  cluster_size_m: 32
  generator_schema_version: 1

  persistence:
    stable_environmental_props: true
    save_cosmetic_items: false

  densities:
    deadfall_per_hectare: 28
    stumps_per_hectare: 12
    broken_snags_per_hectare: 6
    moss_patches_per_hectare: 180
    lichen_patches_per_hectare: 90
    litter_clusters_per_hectare: 420
    twig_clusters_per_hectare: 160
    river_cobble_clusters_per_100m: 18
    driftwood_per_100m: 2
    cave_mouth_ferns_per_100m2: 8

  lod:
    persistent: [45, 180, 700]
    parent_attached: [25, 90, 260]
    terrain_attached: [20, 70, 220]

  shadow:
    persistent_near: true
    persistent_proxy_far: true
    parent_attached_near: false
    terrain_attached_near: false

  invalidation:
    debounce_ms: 100
    maximum_clusters_per_frame: 8

  debug:
    show_class: false
    show_anchors: false
    show_rejections: false
```

Class-specific parameters remain in the registry/config sections and are validated against the canonical class list.

## 15. TypeScript module layout

Create:

```text
tools/clod-poc/src/ecology/dressing/
  class_registry.ts
  config.ts
  constants.ts
  types.ts
  stable_id.ts
  environment_sample.ts
  placement_stages.ts
  persistent_candidates.ts
  terrain_candidates.ts
  attachment_anchors.ts
  attachment_candidates.ts
  decay.ts
  hydrology_affinity.ts
  cave_affinity.ts
  grass_suppression.ts
  persistence_bridge.ts
  invalidation.ts
  diagnostics.ts
  validation.ts
  integration.ts
  gpu/
    layouts.ts
    resources.ts
    dispatch.ts
    class_rules.wgsl
    terrain_candidates.compute.wgsl
    attachment_candidates.compute.wgsl
    classify_lod.compute.wgsl
```

Rules:

- `class_registry.ts` is the only class list.
- `stable_id.ts` is the only stable-ID implementation.
- `placement_stages.ts` owns the stage ordering.
- `persistence_bridge.ts` is the only dressing module that writes save deltas.
- `environment_sample.ts` delegates to canonical terrain/hydrology/voxel providers.
- GPU class rules mirror pure CPU rules and have parity tests.

## 16. Rust/Bevy module layout

Create:

```text
src/world/ecology/dressing/
  mod.rs
  config.rs
  classes.rs
  types.rs
  stable_id.rs
  environment.rs
  placement.rs
  attachments.rs
  persistence.rs
  invalidation.rs
  diagnostics.rs

src/rendering/vegetation/dressing/
  mod.rs
  assets.rs
  instances.rs
  gpu.rs
  materials.rs
  lod.rs
  shadows.rs

assets/config/ecological_dressing.yaml
assets/shaders/dressing/
  common.wgsl
  placement.wgsl
  material.wgsl
```

Generated asset bundles live under:

```text
assets/generated/dressing/<class>/<variant>/
```

Each bundle contains LOD meshes, optional impostors/cards, material metadata, bounds, anchors, and content fingerprint.

## 17. Implementation sequence

### DRESS-1 — Registry, IDs, and config

- Add canonical 29-class registry, ownership categories, stable IDs, config, and validation.

Exit gate: class count, ownership, IDs, and unknown-key failures are locked by tests.

### DRESS-2 — Persistent deadfall vertical slice

- Implement fresh/mossy/rotten logs, stumps, broken snags, deterministic pairing, save exclusions, LODs, and shadows.

Exit gate: destroy/reload preserves exclusion and untouched props regenerate identically.

### DRESS-3 — Attachment anchors and fungi

- Emit anchors from generators and bundles.
- Add shelf/cap fungi, trunk/root moss, and lichen.

Exit gate: attachments remain aligned through wind, LOD, and parent destruction.

### DRESS-4 — Terrain cosmetic clusters

- Add litter, twigs, chips, moss/lichen patches, flowers, and grass suppression.

Exit gate: forest floor has no bare ten-metre patches in the acceptance scene unless material/ecology explicitly requires bare ground.

### DRESS-5 — Hydrology dressing

- Add river cobbles, wet stones, driftwood, and bank ferns from canonical graph channels.

Exit gate: placement follows carved banks and flow with no floating/underwater mistakes.

### DRESS-6 — Cliff and cave dressing

- Add cliff/cave ferns and cave-specific moss/fungi rules using exact voxel samples.

Exit gate: cave-mouth dressing reacts locally to opening/closing edits.

### DRESS-7 — Full GPU integration

- Move class placement into the GPU vegetation authority path.
- Add indirect groups and diagnostics.

Exit gate: normal gameplay has no CPU candidate arrays or readbacks.

### DRESS-8 — Bevy bundle/runtime port

- Export assets and anchors.
- Add Rust class registry, placement, persistence, and rendering.

Exit gate: CLOD-POC and Bevy deterministic galleries match.

## 18. Tests

Required tests:

- canonical class list contains exactly 29 unique IDs;
- each class has exactly one ownership category;
- stable IDs are camera/residency independent;
- placement stages execute in fixed order;
- dead logs have supported endpoints;
- paired stump/deadfall identities are stable;
- decay selection responds to age/moisture deterministically;
- fungi attach only to valid parent/terrain conditions;
- moss and lichen slot exclusion is deterministic;
- broadleaf/needle litter follows canopy species channels;
- river cobbles and driftwood use graph shore/flow channels;
- cave classes obey cave policies;
- parent attachments follow parent transform/wind;
- destroying a parent removes attachments;
- save exclusion prevents deterministic prop regeneration;
- terrain edits invalidate only overlapping clusters;
- grass suppression is local and reversible;
- CPU/GPU class rules match;
- buffer capacity overflow fails;
- unknown terrain data keeps conservative candidates where required;
- no cosmetic class is serialized independently.

## 19. Acceptance scenes

```text
dressing-forest-floor
  broadleaf and conifer regions with litter, moss, twigs, logs, stumps, fungi

dressing-decay-gallery
  every persistent decay class and attachment family

dressing-river-bank
  cobbles, wet stones, driftwood, ferns, flow alignment

dressing-cliff-cave
  cliff ferns, cave-mouth ferns, moss, fungi, voxel surfaces

dressing-destruction-save
  destroy/harvest/move/reload persistent environmental props

dressing-construction
  place structure and verify local exclusion/invalidation

dressing-4km-traverse
  density, streaming, LOD, and performance route
```

## 20. Diagnostics and counters

Expose:

```text
dressing_enabled
dressing_class_count
dressing_clusters_active
dressing_candidates_generated
dressing_candidates_accepted
dressing_persistent_visible
dressing_parent_attached_visible
dressing_terrain_attached_visible
dressing_saved_exclusions
dressing_attachment_parents
dressing_attachment_count
dressing_invalidated_clusters
dressing_gpu_ms
dressing_main_thread_ms
dressing_overflow_count
```

Per-class generated/accepted/visible counters are required in debug stats.

Debug modes:

```text
class color
ownership category
stable ID prefix
placement stage
attachment anchors
decay age
moisture affinity
shore/flow affinity
cave policy
rejection reason
grass suppression
```

## 21. Performance gates

Dense forest and river route:

```text
normal gameplay readbacks = 0
main-thread dressing p95 <= 0.50 ms
GPU dressing placement/update p95 <= 1.25 ms
GPU dressing render p95 <= 1.50 ms
capacity overflows = 0
edit invalidation processes <= 8 clusters/frame
single edit max-frame regression <= 3 ms
steady-state frame p95 regression <= 5%
```

Persistent prop save operations must update exclusion structures incrementally. Rebuilding all saved-prop exclusions after one edit is forbidden.

## 22. Visual and correctness gates

- Forest floors contain visible macro, meso, and micro layers.
- Deadfall and stumps have plausible pairing and orientation.
- Decay stages are visibly distinct.
- Fungi and moss attach to valid surfaces and follow parent motion.
- River dressing follows canonical carved water and flow.
- Cave and cliff dressing uses exact voxel surfaces where required.
- No props float, sink, or spawn inside structures.
- No camera-relative pattern swimming appears.
- No abrupt density band appears at LOD or residency boundaries.
- Destroyed persistent props remain absent after reload.
- Cosmetic dressing regenerates identically without save bloat.

## 23. Explicit non-goals

Do not:

- create another general prop renderer;
- save every cosmetic cluster;
- scan runtime meshes to invent attachment anchors;
- run unique mesh generation on the frame path;
- make dressing a second terrain or hydrology authority;
- place river dressing from visual water alone;
- spawn normal forest vegetation deep inside caves;
- rebuild all exclusions after one prop edit;
- allow duplicate ownership between understory, stones, and dressing;
- hide low dressing quality with fog.
