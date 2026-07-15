# Fable5 Parity 4 — Continuous Per-Instance Tree Morphology

Status: implementation plan.

Scope: `tools/clod-poc` first, then Rust/Bevy using the same deterministic morphology contract, packed instance data, shader deformation, impostor layers, and acceptance gates.

This plan is prescriptive. The implementer must not choose a different parameter set, packing scheme, deformation order, age buckets, impostor representation, identity rule, or fallback policy.

Cross-plan build order and shared contracts live in `fable5-parity-index-and-budget-2026-07-15.md`. This plan sits on top of Plan 2 (its GPU stage generates morphology during candidate acceptance) and reuses the shared `tree_pcg2d` hash; read the budget doc before implementing.

## 1. Goal

Eliminate visible cloned-tree repetition while preserving Drusniel's existing procedural grammar, four structural variants per species, GPU ring rendering, hierarchical wind, per-cascade shadows, crown proxies, octahedral impostors, canonical terrain placement, voxel edits, and deterministic world identity.

The completed system must provide continuous variation in:

- age and overall maturity;
- trunk lean;
- crown directional bias;
- crown width and vertical compression;
- branch droop response;
- foliage density and health;
- bark age and damage tint;
- root-flare prominence;
- wind stiffness;
- snow/wetness response inputs.

Variation is instance data, not unique runtime mesh generation. Existing structural variants continue to supply topological diversity; continuous GPU deformation supplies silhouette diversity within each structural variant.

## 2. Fixed identity model

Every tree is identified by:

```text
tree_id = [stable_id_hi, stable_id_lo] from Plan 2's canonical world-cell tuple
```

Morphology values are derived only from:

```text
world seed
tree_id
species configuration
canonical terrain sample
ecology sample
hydrology sample
local canopy competition sample
```

They must not depend on:

- camera position;
- frame number;
- ring index;
- current LOD;
- GPU append order;
- residency order;
- save/load order;
- platform-specific random generators.

The full two-word ID is carried in Plan 2's 48-byte instance prefix. `hash01` and
`hashSigned` below call the shared `treePcg2dU32` channel fold; they do not truncate the
ID or introduce another hash. The same tree must produce the same morphology in CPU
oracle, GPU ring, CLOD-POC, Bevy, save reload, and impostor selection.

## 3. Fixed morphology parameters

Naming: this per-instance variation type is `TreeInstanceMorphology`, deliberately distinct from the existing `TreeMorphology` in `tree_morphology.ts`, which already means the *grown branch/leaf/crown skeleton*. Do not reuse the `TreeMorphology` name; the two types coexist (skeleton vs per-instance deformation) and conflating them breaks both.

Extend every tree instance with exactly these values:

```ts
export interface TreeInstanceMorphology {
  age01: number;
  leanX: number;
  leanZ: number;
  crownBiasX: number;
  crownBiasZ: number;
  crownWidth: number;
  crownFlattening: number;
  branchDroop: number;
  foliageDensity: number;
  health01: number;
  rootFlare: number;
  stiffness: number;
}
```

Ranges:

```text
age01             0.00..1.00
leanX/Z          -0.22..0.22 horizontal metres per metre of height
crownBiasX/Z     -0.35..0.35 normalized crown-radius offset
crownWidth        0.82..1.18
crownFlattening   0.82..1.20
branchDroop      -0.18..0.32
foliageDensity    0.55..1.15
health01          0.00..1.00
rootFlare         0.75..1.35
stiffness         0.65..1.35
```

The values are clamped before packing and again after unpacking in WGSL.

## 4. Deterministic derivation

Create one pure function:

```ts
export function deriveTreeInstanceMorphology(
  identity: TreeIdentity,
  species: TreeSpeciesId,
  terrain: TreeTerrainSample,
  ecology: TreeEcologySample,
  competition: TreeCompetitionSample,
): TreeInstanceMorphology;
```

Use these exact derivation rules.

The morphology channels extend Plan 2's shared numeric registry:

```text
MORPH_AGE_CHANNEL=0x1101, MORPH_LEAN_CHANNEL=0x1102,
MORPH_CROWN_BIAS_CHANNEL=0x1103, MORPH_WIDTH_CHANNEL=0x1104,
MORPH_FLAT_CHANNEL=0x1105, MORPH_DROOP_CHANNEL=0x1106,
MORPH_HEALTH_CHANNEL=0x1107, MORPH_FLARE_CHANNEL=0x1108,
MORPH_FOLIAGE_CARD_CHANNEL=0x1109
```

Each `hash01`/`hashSigned` treats `tree_id_lo/hi` as the two bitcast cell words and
calls the shared PCG tuple fold with the named channel. No local random helper is allowed.

### 4.1 Age

```text
base = hash01(tree_id, MORPH_AGE_CHANNEL)
old_forest = ecology.oldForestBias
competition_penalty = competition.crownPressure * 0.18
age01 = clamp(0.10 + base * 0.78 + old_forest * 0.22 - competition_penalty, 0, 1)
```

### 4.2 Lean

Lean combines slope, prevailing wind, and deterministic asymmetry:

```text
slope_dir = normalized horizontal downhill direction
wind_dir = normalized configured prevailing wind direction
random_dir = unit vector from hash angle using MORPH_LEAN_CHANNEL

lean_vector =
    slope_dir * terrain.slope01 * species.slopeLean
  + wind_dir * species.windLean
  + random_dir * species.randomLean

lean magnitude *= lerp(0.55, 1.15, age01)
lean magnitude *= lerp(1.20, 0.75, stiffness)
clamp vector length to 0.22
```

### 4.3 Crown bias

```text
light_dir = competition.openLightDirectionXZ
random_dir = hash unit vector using MORPH_CROWN_BIAS_CHANNEL
bias = light_dir * competition.directionalPressure * 0.28
     + random_dir * 0.07
clamp vector length to 0.35
```

### 4.4 Width and flattening

```text
crownWidth = clamp(
  0.88
  + age01 * 0.20
  - competition.crownPressure * 0.12
  + hashSigned(tree_id, MORPH_WIDTH_CHANNEL) * 0.08,
  0.82,
  1.18
)

crownFlattening = clamp(
  1.00
  - terrain.exposure01 * species.exposureFlattening
  + age01 * species.ageFlattening
  + hashSigned(tree_id, MORPH_FLAT_CHANNEL) * 0.06,
  0.82,
  1.20
)
```

### 4.5 Droop, foliage, health, flare, stiffness

```text
branchDroop = clamp(
  species.baseDroop
  + age01 * species.ageDroop
  + ecology.moisture * species.moistureDroop
  + hashSigned(tree_id, MORPH_DROOP_CHANNEL) * 0.08,
  -0.18,
  0.32
)

health01 = clamp(
  0.72
  + ecology.moistureSuitability * 0.18
  + ecology.temperatureSuitability * 0.14
  - competition.crownPressure * 0.18
  - ecology.stress * 0.32
  + hashSigned(tree_id, MORPH_HEALTH_CHANNEL) * 0.10,
  0,
  1
)

foliageDensity = clamp(
  0.58
  + health01 * 0.48
  + age01 * 0.10
  - competition.crownPressure * 0.12,
  0.55,
  1.15
)

rootFlare = clamp(
  0.85
  + age01 * 0.28
  + terrain.exposedRootPotential * 0.18
  + hashSigned(tree_id, MORPH_FLARE_CHANNEL) * 0.08,
  0.75,
  1.35
)

stiffness = clamp(
  species.baseStiffness
  + (1 - age01) * 0.12
  + health01 * 0.08
  - branchDroop * 0.25,
  0.65,
  1.35
)
```

## 5. Species configuration

Each species entry in `tools/clod-poc/config/trees.yaml` already has a `morphology:` block that configures the structural grammar (the grown skeleton). This plan adds a **separate** `morphology_runtime:` block for per-instance deformation; the two blocks are distinct and must not be merged. Extend each species entry with:

```yaml
morphology_runtime:
  slope_lean: 0.10
  wind_lean: 0.05
  random_lean: 0.04
  exposure_flattening: 0.08
  age_flattening: 0.05
  base_droop: 0.02
  age_droop: 0.10
  moisture_droop: 0.05
  base_stiffness: 1.00
```

Use these species defaults:

```text
oak:
  slopeLean 0.08, windLean 0.04, randomLean 0.05
  exposureFlattening 0.05, ageFlattening 0.08
  baseDroop 0.03, ageDroop 0.12, moistureDroop 0.05, stiffness 0.90

pine:
  slopeLean 0.06, windLean 0.05, randomLean 0.03
  exposureFlattening 0.10, ageFlattening 0.02
  baseDroop -0.02, ageDroop 0.06, moistureDroop 0.02, stiffness 1.15

birch:
  slopeLean 0.10, windLean 0.07, randomLean 0.05
  exposureFlattening 0.07, ageFlattening 0.04
  baseDroop 0.04, ageDroop 0.10, moistureDroop 0.06, stiffness 0.82

willow:
  slopeLean 0.08, windLean 0.04, randomLean 0.04
  exposureFlattening 0.04, ageFlattening 0.10
  baseDroop 0.12, ageDroop 0.16, moistureDroop 0.10, stiffness 0.72

spruce:
  slopeLean 0.05, windLean 0.04, randomLean 0.025
  exposureFlattening 0.09, ageFlattening 0.02
  baseDroop 0.00, ageDroop 0.05, moistureDroop 0.02, stiffness 1.22

dead:
  slopeLean 0.12, windLean 0.08, randomLean 0.08
  exposureFlattening 0.00, ageFlattening 0.00
  baseDroop 0.08, ageDroop 0.14, moistureDroop 0.00, stiffness 0.78
```

Unknown keys fail config parsing.

## 6. Packed instance layout

Store morphology in three `vec4<f32>` values:

```wgsl
struct TreeInstanceMorphologyGpu {
    morphology0: vec4<f32>, // age, leanX, leanZ, health
    morphology1: vec4<f32>, // crownBiasX, crownBiasZ, crownWidth, crownFlattening
    morphology2: vec4<f32>, // branchDroop, foliageDensity, rootFlare, stiffness
};
```

This layout is used by:

- CPU tree instance records;
- GPU candidate acceptance;
- visible tree instance buffers;
- shadow instance buffers;
- near/far/impostor render materials;
- save/debug exports;
- Bevy instance extraction.

In the canonical Plan 2 storage layout these vectors immediately follow the shared
48-byte transform/identity prefix, producing one 96-byte
`VegetationTreeInstance`. There is no competing 80-byte tree record or separate
morphology side buffer.

Do not repack values into normalized integers in this phase. The extra 48 bytes per tree is accepted to keep parity and debugging exact. Compression may be considered only after measured memory pressure and is outside this plan.

## 7. Required geometry attributes

Every generated tree mesh must expose:

```text
position
normal
uv
color
treeWind        vec3: branch stiffness weight, flutter weight, species index
treeFoliageMask f32: 0 trunk/branch, 1 foliage
treeFoliageCard f32: 0 mesh/branch, 1 card
treeVariant     f32
treeHeight01    f32
treeRadial01    f32
treeBranchLevel f32
treeBranchPhase f32
treeRootMask    f32
```

Add the new attributes in the grammar mesh builder, not through post-hoc spatial guesses.

Definitions:

```text
treeHeight01 = clamp(vertex_y / generated_tree_height, 0, 1)
treeRadial01 = horizontal distance from local trunk axis / generated crown radius
treeBranchLevel = normalized grammar branch level 0..1
treeBranchPhase = deterministic branch identity hash 0..1
treeRootMask = root flare/buttress participation 0..1
```

The four structural variant meshes and all LOD meshes derive these attributes from the same generated skeleton.

## 8. Deformation order

The vertex shader applies transforms in this exact order:

1. Base structural-variant local position.
2. Age scaling.
3. Crown width and flattening.
4. Root flare.
5. Branch droop.
6. Crown directional bias.
7. Trunk lean.
8. Hierarchical wind.
9. Instance rotation and scale.
10. World transform.

Changing this order changes silhouettes and invalidates impostor parity.

### 8.1 Age scaling

```text
height scale = lerp(0.72, 1.08, smoothstep(0, 1, age01))
radius scale = lerp(0.78, 1.12, age01)
crown start shift = lerp(0.08, -0.04, age01) * tree height
```

Trunk and branches use height/radius scaling. Foliage also uses foliage-density masking.

### 8.2 Crown width and flattening

For vertices with `treeHeight01` above the species crown start:

```text
xz *= crownWidth
y around crown centre *= crownFlattening
```

Blend over 10% of tree height to avoid a hard boundary.

### 8.3 Root flare

For `treeRootMask > 0`:

```text
xz *= mix(1, rootFlare, treeRootMask)
y unchanged
```

### 8.4 Branch droop

Apply only to branch level greater than zero:

```text
droop_weight = treeBranchLevel * treeHeight01 * treeHeight01
position_y -= branchDroop * droop_weight * species_height
position_xz += branch_direction_xz * branchDroop * droop_weight * species_height * 0.18
```

`branch_direction_xz` is derived from the local radial vector and `treeBranchPhase` fallback when radial length is zero.

### 8.5 Crown bias

```text
bias_weight = smoothstep(crown_start, 1, treeHeight01)
position_xz += crownBiasXZ * crown_radius * bias_weight
```

### 8.6 Lean

Lean is a smooth trunk bend, not a rigid shear:

```text
lean_weight = treeHeight01 * treeHeight01
position_x += leanX * local_height * lean_weight
position_z += leanZ * local_height * lean_weight
```

Normals are transformed using the analytic derivative of the bend. Reusing unmodified normals is forbidden.

### 8.7 Wind

Multiply existing trunk/branch wind amplitude by:

```text
wind_scale = 1 / stiffness
wind_scale *= lerp(0.85, 1.10, age01)
```

Foliage flutter also multiplies by health-dependent foliage retention:

```text
flutter_scale = mix(0.75, 1.05, health01)
```

## 9. Foliage density and health

Do not remove triangles on the CPU.

Every foliage card/cluster receives a deterministic `treeBranchPhase` and local alpha mask seed.

The shader computes:

```text
keep_threshold = foliageDensity * mix(0.72, 1.0, health01)
branch_phase_u24 = round(treeBranchPhase * 16777216)
card_channel = MORPH_FOLIAGE_CARD_CHANNEL ^ branch_phase_u24 ^ card_corner_identity
keep = hash01(tree_id, card_channel) <= keep_threshold
```

The mask is world/tree anchored and identical in camera and shadow passes.

Health also changes color:

```text
healthy = configured species foliage color
stressed = species-specific dry/yellow/brown color
final = mix(stressed, healthy, health01)
```

Health may not make foliage emissive or brighter than the configured lit range.

Dead species uses health to control bark dryness, broken-card occupancy, and fungal/darkening inputs, not green foliage.

## 10. Competition field

Create a low-frequency deterministic canopy competition sampler shared by CPU and GPU.

For each candidate tree, sample eight directions at radii:

```text
8 m
16 m
32 m
```

Use the deterministic tree distribution, not the currently visible tree list.

Output:

```ts
export interface TreeCompetitionSample {
  crownPressure: number;
  directionalPressure: number;
  openLightDirectionXZ: [number, number];
}
```

The sampler must be deterministic and independent of streaming state.

Near GPU generation may read a precomputed competition texture derived from the same deterministic distribution. CPU and GPU values must match within `1/255` after texture quantization.

## 11. Terrain and voxel interaction

Morphology responds to the canonical placement surface:

- lean uses actual voxel/heightfield slope;
- root flare increases on exposed or eroded ground;
- health responds to canonical wetness, shore distance, material, altitude, and ecology;
- trees rejected by edits or structure footprints never receive morphology records;
- regeneration after a terrain edit preserves tree identity when its world cell remains valid;
- a tree moving vertically because the surface changed retains morphology because identity excludes height.

No morphology deformation can move the root contact point away from the instance origin.

The root vertex at `treeHeight01 = 0` must remain fixed except for root-flare radial scaling.

## 12. Impostor parity

### 12.1 Atlas representation

Use a 2D texture array per species and channel.

Layers are:

```text
4 structural variants x 3 age buckets = 12 layers per species
```

Age buckets:

```text
young:  age01 = 0.20
mature: age01 = 0.60
old:    age01 = 0.92
```

Each layer contains the existing `8 x 8` hemi-octahedral view grid.

Tile resolution is bound to the canonical quality token:

| `quality` | tile px | full 8 x 8 layer | worst-case two-channel runtime bytes, 6 species x 12 layers |
|---|---:|---:|---:|
| `ultra` | 96 | 768 x 768 | 324 MiB |
| `balanced` | 64 | 512 x 512 | 144 MiB |
| `perf` | 48 | 384 x 384 | 81 MiB |
| `potato` | 32 | 256 x 256 | 36 MiB |

The byte column assumes two uncompressed RGBA8 channels and is therefore the portable
fallback, not a compression claim. MORPH-7 records actual uploaded texture bytes and
must remain within the selected row even when compressed texture support differs.

Channels:

```text
albedo + coverage
normal + depth
```

Bake with neutral morphology values except age:

```text
lean = 0
crown bias = 0
crown width = 1
crown flattening = 1
branch droop = species base
foliage density = 1
health = 1
root flare = 1
stiffness = 1
```

Runtime applies lean, crown bias, crown width, crown flattening, health color, foliage-density dither, and overall age interpolation to the impostor quad and sampling coordinates.

### 12.2 Age interpolation

Blend the two nearest age layers. Never hard-switch age buckets.

### 12.3 Quad deformation

The impostor quad:

- rotates through the existing octahedral view blend;
- applies trunk/crown lean by offsetting the quad top relative to the root;
- scales width by crown width;
- scales upper/lower extents using age and crown flattening;
- keeps the root world position fixed;
- uses normal/depth data from the same blended age/view layers.

### 12.4 Shadow proxies

Crown shadow proxies use the same morphology:

```text
proxy centre += crown bias and lean at crown centre
proxy radius x/z *= crown width
proxy height *= crown flattening and age height scale
proxy density *= foliage density and health retention
```

## 13. Configuration and file changes

Modify:

```text
tools/clod-poc/src/veg/veg_types.ts
tools/clod-poc/src/veg/veg_skeleton.ts
tools/clod-poc/src/veg/veg_tree_builder.ts
tools/clod-poc/src/veg/veg_tube_mesh.ts
tools/clod-poc/src/veg/veg_leaf_mesh.ts
tools/clod-poc/src/trees/tree_instances.ts
tools/clod-poc/src/trees/tree_geometry.ts
tools/clod-poc/src/trees/tree_geometry_types.ts
tools/clod-poc/src/trees/tree_config_types.ts
tools/clod-poc/src/trees/tree_config_parsing.ts
tools/clod-poc/src/trees/tree_node_material.ts
tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl
tools/clod-poc/src/trees/tree_ring_impostor_node_material.ts
tools/clod-poc/src/trees/tree_crown_proxy_math.ts
```

Create:

```text
tools/clod-poc/src/trees/morphology/
  constants.ts
  types.ts
  derive.ts
  competition.ts
  packing.ts
  deformation_reference.ts
  impostor_layers.ts
  diagnostics.ts
  validation.ts
  morphology.wgsl
```

`derive.ts` is the only production CPU implementation of morphology formulas. GPU formulas mirror it through `morphology.wgsl` and parity tests.

The existing `src/trees/tree_morphology.ts` (structural skeleton) is unrelated to this new `src/trees/morphology/` directory (per-instance variation). Keep them separate; do not move skeleton code into the new directory or vice versa.

## 14. Rust/Bevy module layout

Create:

```text
src/rendering/vegetation/tree_morphology/
  mod.rs
  config.rs
  types.rs
  derive.rs
  competition.rs
  packing.rs
  impostors.rs
  diagnostics.rs

assets/shaders/tree_morphology/
  morphology.wgsl
  deformation.wgsl
  impostor.wgsl
```

Extend the generated vegetation bundle metadata with:

```yaml
morphology_schema_version: 1
structural_variants: 4
impostor_age_buckets: [0.20, 0.60, 0.92]
required_vertex_attributes:
  - treeHeight01
  - treeRadial01
  - treeBranchLevel
  - treeBranchPhase
  - treeRootMask
```

The Bevy loader rejects a generated asset bundle missing these attributes when continuous morphology is enabled.

## 15. Implementation sequence

### MORPH-1 — Contracts and derivation

- Add types, config, stable channels, CPU derivation, and packing.

Exit gate: repeated derivation is bit-stable and all values remain within ranges.

### MORPH-2 — Geometry attributes

- Emit structural attributes from the grammar and preserve them through all mesh LODs and exports.

Exit gate: every leafy species/variant/LOD contains valid nonzero attribute ranges.

### MORPH-3 — Near/far mesh deformation

- Add fixed deformation order and analytic normal correction.
- Integrate camera and shadow materials.

Exit gate: CPU reference deformation and sampled GPU vertices agree within 1 mm.

### MORPH-4 — GPU generation integration

Depends on Plan 2 (GPU vegetation authority): morphology is generated inside that plan's candidate-acceptance compute pass, so MORPH-4 cannot start until Plan 2's acceptance stage (VEG-GPU-5) exists. MORPH-1..3 can proceed on the existing tree ring beforehand.

- Generate morphology during candidate acceptance.
- Pack into visible and shadow instance records.

Exit gate: CPU and GPU morphology values agree within `1e-5`.

### MORPH-5 — Foliage density and health

- Add deterministic card retention and health color.
- Share mask in camera and shadow passes.

Exit gate: no camera/shadow mismatch and no temporal flicker.

### MORPH-6 — Competition field

- Add deterministic competition sampling and GPU texture.

Exit gate: CPU/GPU competition parity within `1/255`.

### MORPH-7 — Impostor texture arrays

- Bake 12 layers per species for both channels.
- Add age interpolation and runtime morphology transforms.

Exit gate: orbit and dolly tests show no age or morphology snap at mesh/impostor boundary.

### MORPH-8 — Bevy bundle and runtime port

- Extend bundle schema, loader, instance data, materials, shadows, and editor preview.

Exit gate: CLOD-POC and Bevy gallery captures match the morphology manifest.

## 16. Tests

Required tests:

- stable identity is independent of camera/ring/residency;
- morphology derivation is deterministic;
- all parameter ranges clamp correctly;
- species defaults parse and unknown fields fail;
- new geometry attributes exist on every LOD;
- root contact stays fixed;
- deformation order matches the CPU reference;
- analytic normal correction remains normalized and faces the expected hemisphere;
- age scaling is monotonic;
- crown width affects crown vertices but not trunk base;
- lean bends the top more than the base;
- crown bias affects crown only;
- branch droop increases with branch level/height;
- foliage mask is identical in camera and shadow paths;
- competition sampler is streaming-independent;
- GPU packing matches CPU layout;
- impostor layer selection and interpolation are continuous;
- crown proxy dimensions match morphology;
- saved/reloaded trees retain morphology;
- terrain height changes do not change identity.

## 17. Acceptance scenes

```text
tree-morphology-species-gallery
  six species, four variants, young/mature/old rows

tree-morphology-repeat-strip
  100 same-species trees proving non-cloned silhouettes

tree-morphology-slope-wind
  slope and wind lean directions visible together

tree-morphology-competition
  clearing edge versus dense interior crowns

tree-morphology-health
  wet healthy, dry stressed, damaged, and dead examples

tree-morphology-lod-orbit
  near/far/impostor orbit for fixed identities

tree-morphology-forest-dolly
  slow dolly through all LOD boundaries
```

## 18. Diagnostics and counters

Expose:

```text
tree_morphology_enabled
tree_morphology_instances
tree_morphology_age_mean
tree_morphology_age_p10
tree_morphology_age_p90
tree_morphology_lean_mean
tree_morphology_lean_max
tree_morphology_health_mean
tree_morphology_foliage_mean
tree_morphology_competition_samples
tree_morphology_impostor_layers_ready
tree_morphology_cpu_gpu_mismatches
tree_morphology_instance_bytes
```

Debug modes:

```text
age
lean direction
crown bias
width
flattening
droop
foliage density
health
root flare
stiffness
structural variant
impostor age layers
```

## 19. Performance and memory gates

Dense forest on target desktop:

```text
morphology derivation occurs inside existing GPU candidate acceptance
additional CPU frame cost <= 0.10 ms p95
additional GPU tree render cost <= 0.40 ms p95
additional GPU shadow cost <= 0.30 ms p95
normal gameplay readbacks = 0
instance morphology storage <= 48 bytes per tree
impostor texture-array VRAM <= selected preset allocation (324/144/81/36 MiB)
frame p95 regression <= 5%
```

Texture arrays must use KTX2/Basis compression in the persisted Bevy asset bundle.
Compression on disk is not reported as VRAM saved: the runtime reports the actual
uploaded format and byte count. Browser bake intermediates and an uncompressed runtime
fallback must still fit the preset's worst-case allocation above.

## 20. Visual gates

- No two adjacent same-species trees with different IDs may have identical full silhouettes in the repeat strip.
- Root contacts remain planted.
- Lean direction is plausible relative to slope and wind.
- Dense-forest crowns bias toward openings.
- Young, mature, and old trees are visibly distinct without becoming different species.
- Health affects density and color without producing neon or emissive foliage.
- Wind remains coherent across near, far, impostor, and shadow paths.
- Mesh-to-impostor handoff preserves root, height, width, lean, crown bias, exposure, and dominant color.
- Shadow proxies remain aligned with visible crowns.

## 21. Explicit non-goals

Do not:

- generate one unique mesh per runtime tree;
- remove the four structural variants;
- change tree placement identity after terrain height changes;
- use camera-relative random values;
- deform roots away from the placement origin;
- apply morphology only to the color pass and not shadows;
- hard-switch impostor age buckets;
- use unchanged normals after non-rigid bending;
- make continuous morphology a save payload for deterministic environmental trees;
- alter hand-authored project prop meshes through this system.
