# Fable5 Parity 3 — Terrain-Relative World-Space Probe GI

Status: implementation plan.

Scope: `tools/clod-poc` first, then Rust/Bevy through the same probe data model and acceptance contract.

This document is prescriptive. The implementer must not select a different GI architecture, cascade count, probe format, update policy, visibility source order, fallback behavior, or temporal policy.

## 1. Goal

Add stable world-space indirect diffuse lighting that improves forests, valleys, cave entrances, cliffs, water margins, CLOD transitions, and off-screen bounce while preserving Drusniel's voxel terrain, editable caves, existing raster renderer, Hillaire atmosphere, froxel fog, direct shadows, materials, and post-processing.

The completed system must:

- use terrain-relative camera-centred probe clipmaps;
- store RGB SH-L1 irradiance;
- trace against exact voxel/NAADF data near the camera;
- trace against canonical CLOD/far-summary data farther away;
- include terrain, canopy, structures, caves, water exclusion, and emissive proxy participation;
- update incrementally on the GPU;
- preserve history until replacement data is valid;
- invalidate only affected probes after edits;
- provide the same irradiance interface to terrain, trees, grass, understory, props, construction, and impostors;
- operate without hardware ray tracing;
- never replace the visible terrain renderer.

## 2. Fixed architecture

Use three nested camera-centred terrain-relative probe cascades.

```text
Cascade 0: local voxel/NAADF lighting
Cascade 1: mid-field CLOD and exact canonical tile lighting
Cascade 2: far-summary lighting
```

The fixed dimensions and spacing are:

```yaml
probe_gi:
  schema_version: 1
  enabled: true
  cascades:
    - id: near
      dimensions: [32, 8, 32]
      spacing_m: 4
      maximum_trace_distance_m: 96
    - id: mid
      dimensions: [32, 8, 32]
      spacing_m: 16
      maximum_trace_distance_m: 384
    - id: far
      dimensions: [32, 8, 32]
      spacing_m: 64
      maximum_trace_distance_m: 1536
```

Each cascade contains 8192 probes. The complete system contains 24,576 probes.

Each probe is anchored horizontally to the cascade grid and vertically to canonical terrain:

```text
probe_y = terrain_height_at_probe_xz + layer_height[cascade][layer]
```

Layer heights are fixed:

```text
near: [1.0, 2.5, 5.0, 9.0, 15.0, 24.0, 38.0, 60.0] m
mid:  [2.0, 5.0, 10.0, 18.0, 30.0, 48.0, 76.0, 120.0] m
far:  [4.0, 10.0, 20.0, 36.0, 60.0, 96.0, 152.0, 240.0] m
```

No world-static 256 x 256 field is used. The clipmap architecture is mandatory because Drusniel supports larger worlds, streaming, edits, and voxel regions.

## 3. Probe record format

Each probe stores:

```wgsl
struct ProbeGiRecord {
    sh_r: vec4<f32>,
    sh_g: vec4<f32>,
    sh_b: vec4<f32>,
    position_validity: vec4<f32>,
    normal_offset: vec4<f32>,
    revision_flags: vec4<u32>,
};
```

Meaning:

```text
sh_r/g/b.xyz/omega = SH-L1 c0, c1x, c1y, c1z
position_validity.xyz = probe world position
position_validity.w = validity 0..1
normal_offset.xyz = relocation offset
normal_offset.w = confidence
revision_flags.x = terrain revision
revision_flags.y = lighting revision
revision_flags.z = update frame
revision_flags.w = bit flags
```

The record is 96 bytes. The total raw probe buffer is approximately 2.25 MiB.

Publish three `rgba16float` 3D textures per cascade for hardware-trilinear SH sampling. The storage records remain the update source and diagnostics source.

## 4. Visibility source order

Every trace must query geometry in this exact order:

1. Exact near voxel/NAADF occupancy and distance summaries.
2. Dynamic analytical proxy overlay for construction, large props, NPCs, and moving blockers.
3. Canonical carved heightfield tile atlas where exact voxel data is absent.
4. CLOD page/far-summary occluder and material channels.
5. Far clipmap summary outside the exact page region.
6. Sky miss.

A source can return:

```text
EXACT_HIT
CONSERVATIVE_HIT
MISS
UNKNOWN
```

Rules:

- `EXACT_HIT` returns material and normal from the exact source.
- `CONSERVATIVE_HIT` terminates the trace and uses summary material/normal only for GI.
- `MISS` continues to the next source or sky.
- `UNKNOWN` does not become a bright sky leak; it terminates with the previous valid probe history contribution weighted by confidence.

## 5. Ray set and update budget

Each probe update traces 16 deterministic jittered Fibonacci-sphere directions.

```yaml
probe_gi:
  rays_per_probe: 16
  probes_per_frame: 256
  probes_per_frame_after_lighting_change: 1024
  lighting_change_boost_frames: 16
  history_blend: 0.18
  boosted_history_blend: 0.55
```

The ray set rotates with a deterministic eight-frame sequence keyed by probe ID and update epoch. It must not depend on wall-clock time.

The update scheduler uses this fixed priority:

1. Invalid probes visible to the current camera.
2. Probes dirtied by terrain or structure edits.
3. Newly exposed clipmap slabs after recenter.
4. Near cascade refresh.
5. Mid cascade refresh.
6. Far cascade refresh.

Within a priority group, use ascending stable probe ID.

## 6. Trace footprint and LOD

Use one continuous ray footprint to select visibility detail and material filtering:

```text
footprint_m(t) = max(base_voxel_size_m, t * ray_spread)
lod_f = log2(footprint_m / base_voxel_size_m) + purpose_bias
```

Fixed values:

```text
ray_spread = 0.08
near purpose bias = -0.25
mid purpose bias = 0.25
far purpose bias = 0.75
```

Near traces refine mixed occupancy until an exact or conservative leaf result is available.

Far traces may terminate on unified summary records that contain conservative occluder height and majority material.

## 7. Radiance model

For each ray:

### 7.1 Terrain or structure hit

Compute:

```text
radiance = albedo / PI * (direct_sun + direct_sky + second_bounce_seed + emissive)
```

Direct sun uses:

- current atmospheric sun color;
- hit normal dot sun direction;
- NAADF/far-summary sun visibility;
- canopy chromatic transmittance;
- cloud-shadow transmittance.

Direct sky uses:

- Hillaire sky LUT sampled in the hit normal's dominant hemisphere direction;
- terrain/canopy sky visibility;
- material roughness only as a bounded diffuse-energy adjustment.

Second-bounce seed is fixed at 12% of direct diffuse and is clamped so it cannot create energy gain above the configured albedo.

### 7.2 Sky miss

Sample the Hillaire atmosphere in the ray direction and multiply by canopy/volumetric transmittance along the ray.

Cloud lighting contributes through the existing cloud shadow and atmosphere path; cloud volume is not raymarched by probe rays.

### 7.3 Water

Water surfaces are not treated as opaque diffuse GI geometry.

- Rays entering deep water terminate with a dark blue-green low-energy contribution.
- Shore and wet terrain use the terrain material below the water/wet mask.
- Water emissive/specular reflections remain in the water renderer.

## 8. Canopy participation

Use the unified far-summary canopy channels and exact near tree proxies.

Represent canopy as a terrain-relative extinction volume:

```text
canopy bottom = terrain + species-weighted 4..8 m
canopy top = terrain + canopyHeightAvg
```

Chromatic extinction coefficients are fixed:

```text
sigma_rgb = [0.128, 0.087, 0.134] per coverage-metre
```

Near exact tree crowns use fitted ellipsoid/capsule proxies already used by forest lighting and shadow systems. Far canopy uses summary coverage and height.

Canopy absorption contributes a bounded green transmitted term:

```text
transmitted_leaf_light = absorbed_sun * [0.10, 0.22, 0.08]
```

This term is capped at 20% of incident sun energy.

## 9. Voxel and cave preservation

Near traces must use voxel/NAADF geometry so they can see:

- cave ceilings;
- cave walls;
- cave mouths;
- arches and overhangs;
- dug tunnels;
- player-created voids;
- terrain added through building or edits.

The heightfield path must never answer an exact near trace where voxel overlay coverage exists.

Probe relocation prevents probes from sitting inside solids:

1. Sample six axis directions at 0.5 probe spacing.
2. Compute the least-penetrating escape direction.
3. Move by at most 45% of probe spacing.
4. Mark invalid if no free position exists.
5. Invalid probes sample neighboring valid probes and never inject sky.

Terrain edits invalidate probes whose trace sphere intersects the dirty bounds. The invalidation radius equals each cascade's maximum trace distance capped to two probe-grid cells for immediate updates; farther influence converges through normal refresh.

## 10. Dynamic and structure proxies

Create a dedicated proxy buffer for non-terrain GI participation.

Supported shapes:

```text
AABB
oriented box
capsule
ellipsoid
height slab
emissive sphere
emissive box
```

Static construction and large props upload persistent proxies when created or changed.

Dynamic NPC/prop proxies update at a maximum of 10 Hz and affect only the near cascade.

Small props, grass blades, leaves, particles, and water droplets do not receive individual proxies.

## 11. Sampling in materials

Create one shared function:

```wgsl
fn sample_probe_gi(position_ws: vec3<f32>, normal_ws: vec3<f32>) -> vec3<f32>
```

Sampling rules:

1. Select the finest cascade containing the position with a two-cell safety margin.
2. Trilinearly sample the three SH textures.
3. Evaluate SH against the surface normal.
4. Blend to the next cascade over the outer two cells.
5. Clamp negative irradiance to zero.
6. Multiply by material diffuse albedo outside the function.

The same function must be used by:

- terrain;
- CLOD pages;
- far terrain where within cascade coverage;
- tree near/far/impostor materials;
- grass;
- understory;
- stones;
- project props;
- construction;
- characters where their material path supports custom irradiance.

The existing hemispheric ambient becomes a low fallback floor only:

```text
hemisphere floor strength = 0.08
```

Screen-space bounce remains enabled as high-frequency contact bounce but is limited to 25% of final indirect diffuse. Probe GI owns stable low-frequency indirect lighting.

## 12. Temporal policy

Probe history uses exponential accumulation.

Reject history when:

- terrain revision changed for the probe;
- probe relocated by more than 20% of spacing;
- validity changed from invalid to valid;
- lighting epoch changed by a sun jump greater than 12 degrees;
- world source or material palette hash changed.

Otherwise blend with the configured history factor.

No screen-space reprojection is used for probe storage. Material sampling naturally remains world-space stable.

## 13. Configuration

Create `tools/clod-poc/config/probe_gi.yaml`:

```yaml
probe_gi:
  schema_version: 1
  enabled: true
  rays_per_probe: 16
  probes_per_frame: 256
  probes_per_frame_after_lighting_change: 1024
  lighting_change_boost_frames: 16
  history_blend: 0.18
  boosted_history_blend: 0.55
  ray_spread: 0.08
  hemisphere_floor_strength: 0.08
  screen_space_bounce_max_fraction: 0.25

  cascades:
    - id: near
      dimensions: [32, 8, 32]
      spacing_m: 4
      layer_heights_m: [1, 2.5, 5, 9, 15, 24, 38, 60]
      maximum_trace_distance_m: 96
      purpose_bias: -0.25
    - id: mid
      dimensions: [32, 8, 32]
      spacing_m: 16
      layer_heights_m: [2, 5, 10, 18, 30, 48, 76, 120]
      maximum_trace_distance_m: 384
      purpose_bias: 0.25
    - id: far
      dimensions: [32, 8, 32]
      spacing_m: 64
      layer_heights_m: [4, 10, 20, 36, 60, 96, 152, 240]
      maximum_trace_distance_m: 1536
      purpose_bias: 0.75

  canopy:
    sigma_rgb: [0.128, 0.087, 0.134]
    transmitted_rgb: [0.10, 0.22, 0.08]
    transmitted_energy_cap: 0.20

  relocation:
    enabled: true
    maximum_spacing_fraction: 0.45
    invalid_after_failed_axes: 6

  dynamic_proxies:
    update_hz: 10
    near_cascade_only: true

  debug:
    enabled: false
    mode: irradiance
    freeze_updates: false
```

Unknown keys and invalid dimensions fail startup.

## 14. TypeScript module layout

Create:

```text
tools/clod-poc/src/lighting/probe_gi/
  config.ts
  constants.ts
  types.ts
  cascade_layout.ts
  clipmap_origin.ts
  probe_scheduler.ts
  probe_invalidation.ts
  proxy_types.ts
  proxy_store.ts
  proxy_upload.ts
  material_bindings.ts
  diagnostics.ts
  validation.ts
  integration.ts
  gpu/
    resources.ts
    layouts.ts
    pipelines.ts
    dispatch.ts
    publish.ts
    shaders/
      common.wgsl
      sh.wgsl
      atmosphere_sampling.wgsl
      visibility_sampling.wgsl
      proxy_intersection.wgsl
      canopy_extinction.wgsl
      probe_relocate.compute.wgsl
      probe_trace.compute.wgsl
      probe_publish.compute.wgsl
      probe_debug.wgsl
```

Rules:

- `visibility_sampling.wgsl` is the only probe module that knows terrain-provider order.
- `sh.wgsl` owns all SH projection/evaluation functions.
- `proxy_store.ts` owns proxy identity and revisions.
- materials receive only published textures, cascade uniforms, and the shared sampling module.
- no material implements its own probe selection logic.

## 15. Rust/Bevy module layout

Create:

```text
src/rendering/lighting/probe_gi/
  mod.rs
  config.rs
  types.rs
  cascades.rs
  scheduler.rs
  invalidation.rs
  proxies.rs
  extract.rs
  resources.rs
  pipelines.rs
  render_nodes.rs
  materials.rs
  diagnostics.rs

assets/shaders/probe_gi/
  common.wgsl
  sh.wgsl
  atmosphere_sampling.wgsl
  visibility_sampling.wgsl
  proxy_intersection.wgsl
  canopy_extinction.wgsl
  relocate.wgsl
  trace.wgsl
  publish.wgsl
  sample.wgsl
```

The plugin runs in Bevy's render world. The simulation world extracts dirty bounds, lighting state, proxy changes, and provider revisions.

## 16. Implementation sequence

### PGI-1 — Data and empty clipmaps

- Add config, cascade grids, world anchoring, resources, publish textures, and debug visualization.

Exit gate: camera motion recentres by whole cells with no texture-coordinate swimming.

### PGI-2 — Terrain-relative positioning and relocation

- Sample canonical terrain height.
- Position layers and relocate probes out of solids.

Exit gate: cave/overhang test shows no probes trapped in solids and no sky leaks.

### PGI-3 — Near exact tracing

- Implement voxel/NAADF and proxy intersections.
- Produce grayscale visibility and hit-distance debug output.

Exit gate: CPU oracle rays and GPU rays agree on first-hit class for 99.9% of deterministic rays.

### PGI-4 — Mid/far summary tracing

- Add canonical tile, CLOD summary, and far-summary traversal.
- Add continuous footprint LOD.

Exit gate: 4 km traces remain bounded and missing data does not create bright leaks.

### PGI-5 — Radiance and SH

- Add atmosphere, sun, sky, materials, canopy extinction, and SH projection.

Exit gate: canonical material-color scenes produce expected RGB irradiance signs and magnitudes.

### PGI-6 — Scheduling, history, and edits

- Add priorities, history rules, clipmap slabs, dirty bounds, and lighting boosts.

Exit gate: movement and edits converge without full-volume rebuild spikes.

### PGI-7 — Material integration

- Integrate terrain, CLOD, trees, impostors, grass, understory, stones, props, and construction.
- Reduce hemispheric ambient and cap screen-space bounce.

Exit gate: all material classes use the same sampling function and maintain LOD exposure parity.

### PGI-8 — Default flip

- Make probe GI default-on for WebGPU gameplay.
- Retain `probeGi=0` as a diagnostic A/B flag for one release cycle.

Exit gate: all performance and visual gates pass.

## 17. Tests

Required tests:

- cascade origin snaps to exact cell multiples;
- moving less than one cell does not remap probes;
- layer heights remain terrain-relative;
- record packing matches WGSL;
- SH projection/evaluation matches CPU reference;
- sky-only scene reproduces expected sky color;
- white diffuse plane produces non-negative irradiance;
- canopy extinction is chromatic and energy-bounded;
- exact voxel hit overrides heightfield hit;
- cave ceiling blocks sky;
- unknown provider does not inject bright sky;
- probe relocation escapes a wall and invalidates an enclosed cell;
- terrain edit dirties intersecting probes only;
- lighting jump activates boosted update budget;
- cascade blending is continuous;
- old probe history remains available until replacement publishes;
- dynamic proxies affect near cascade only;
- no material samples a private probe implementation.

## 18. Acceptance scenes

```text
probe-gi-open-meadow
probe-gi-forest-interior
probe-gi-golden-valley
probe-gi-cave-mouth
probe-gi-overhang
probe-gi-river-bank
probe-gi-construction-interior
probe-gi-edit-tunnel
probe-gi-tree-lod-orbit
probe-gi-4km-traverse
```

Capture each with probe GI disabled/enabled using identical frozen world state.

## 19. Diagnostics and counters

Expose:

```text
probe_gi_enabled
probe_gi_total_probes
probe_gi_valid_probes
probe_gi_invalid_probes
probe_gi_updated_this_frame
probe_gi_dirty_queue
probe_gi_new_slab_queue
probe_gi_unknown_trace_count
probe_gi_exact_hit_count
probe_gi_conservative_hit_count
probe_gi_sky_miss_count
probe_gi_relocated_count
probe_gi_proxy_count
probe_gi_trace_ms
probe_gi_relocate_ms
probe_gi_publish_ms
probe_gi_total_ms
probe_gi_near_age_p95_frames
probe_gi_mid_age_p95_frames
probe_gi_far_age_p95_frames
```

Debug modes:

```text
probe positions
validity
age
cascade id
relocation vectors
irradiance RGB
SH lobe
first-hit class
unknown traces
canopy extinction
```

## 20. Performance gates

At 1440p target desktop:

```text
probe GI total GPU p95 <= 3.0 ms
normal update budget = 256 probes/frame
boosted update budget = 1024 probes/frame for <= 16 frames
main-thread p95 <= 0.5 ms
proxy upload amortized <= 256 KiB/frame
probe storage and textures <= 16 MiB
no synchronous readback during gameplay
movement max frame regression <= 3 ms
```

## 21. Visual gates

- Forest interiors are darker and greener than open sky but retain readable detail.
- Off-screen surfaces continue contributing stable bounce.
- Cave interiors do not glow from heightfield-only sky leaks.
- Cave mouths and overhangs transition gradually.
- Near tree, far tree, and impostor exposure match through LOD transitions.
- Terrain material bounce colors are visible without excessive saturation.
- Probe GI does not flatten direct-shadow contrast.
- Fog shafts remain owned by froxels and are not painted into materials.
- Screen-space bounce may add contact detail but cannot dominate the indirect result.
- No visible probe-grid bands appear during a 4 km traverse.

## 22. Explicit non-goals

Do not:

- replace terrain, water, vegetation, or prop rendering with ray tracing;
- implement ReSTIR GI or neural radiance caching;
- require hardware ray tracing;
- use a fixed world-sized probe volume;
- treat the heightfield as exact inside voxel-overlay regions;
- voxelize every leaf or grass blade;
- read back probes every frame;
- let unknown data become an unoccluded sky miss;
- use probe GI for specular reflections;
- remove the existing direct shadow, atmosphere, froxel, GTAO, or post-processing systems.
