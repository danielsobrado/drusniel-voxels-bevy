# Shader-Displaced Far Clipmap Grid Plan

## Goal

Replace CPU-created far terrain geometry with reusable GPU grid tiles displaced in shaders.

The target path is:

```text
CPU:
  creates a small fixed set of reusable grid geometries once
  maintains clipmap ring origins and tile descriptors
  updates summary/height/material resources when dirty
  stops generating far terrain meshes during startup/stabilization

GPU vertex shader:
  converts reusable grid vertices to world-space positions
  samples height/normal/material summary resources
  displaces vertices vertically
  snaps rings around the canonical center

GPU fragment shader:
  samples terrain material/biome data
  applies far material LOD and fog/aerial perspective
```

This is the fifth step after:

```text
1. streamed-page bounds guard
2. canonical world-space center debug counters
3. GPU far-summary build
4. GPU vegetation candidate rejection
```

It should be implemented only after center alignment is measurable. Shader-displaced far terrain will make wrong-center bugs more visible, not less.

## Why this matters

Startup and stabilization become slow when far terrain is built as real CPU mesh data. For far views, most geometry does not need unique CPU-side vertices. The far field can be a set of reusable regular grids whose vertex positions are displaced from height/summary data in the shader.

Expected wins:

```text
less CPU mesh allocation
less CPU geometry upload churn
faster startup stabilization
more stable far terrain cost while walking
cleaner path toward Fable5-style far terrain rendering
cleaner path toward NAADF/far-summary-driven terrain queries
```

This does not replace near editable terrain or streamed CLOD pages. It replaces only far-field visual terrain where shader displacement is acceptable.

## Non-goals

- Do not replace near-field Surface Nets terrain.
- Do not replace streamed CLOD page correctness or safety pages.
- Do not remove CPU fallback.
- Do not make far clipmap terrain collidable.
- Do not require WebGPU for scene loading.
- Do not read back displaced geometry to CPU.
- Do not use this path to hide broken streamed-page bounds.
- Do not use one giant mesh for the whole world.

## Invariants

```text
I1. Near field remains live editable Surface Nets / streamed CLOD owner.
I2. Far clipmap grid is visual only.
I3. All ring origins derive from canonical world-space center.
I4. Missing summary/height data must render conservative fallback, not garbage.
I5. CPU fallback remains available.
I6. No far grid page may claim terrain readiness for safety pages.
I7. Perf runs do not map far terrain resources for debug readback.
I8. Far terrain must fade or hand off cleanly to near/streamed terrain.
```

## Render ownership model

Use three terrain ownership zones:

```text
near zone:
  live chunks / streamed CLOD pages
  editable, high-detail, validated

transition zone:
  near/streamed terrain fades out or hard-owns footprints
  far clipmap fades in only where near owner is not drawing

far zone:
  shader-displaced clipmap grid
  visual only
  driven by far-summary/height/material resources
```

The far grid must not overlap near terrain in a way that creates z-fighting. If overlap is needed for visual fade, use complementary masks or depth-biased far-only fade, not additive co-planar rendering.

## Clipmap structure

Use concentric rings around the canonical center.

Example initial config:

```yaml
farClipmapGrid:
  enabled: true
  rings:
    - level: 0
      cell_size: 8
      radius_cells: 32
      tile_cells: 16
    - level: 1
      cell_size: 16
      radius_cells: 32
      tile_cells: 16
    - level: 2
      cell_size: 32
      radius_cells: 32
      tile_cells: 16
    - level: 3
      cell_size: 64
      radius_cells: 32
      tile_cells: 16
  inner_exclusion_radius: 256
  outer_radius: 4096
  grid_resolution: 17
  morph_band_cells: 4
  height_resource: gpu_far_summary
  material_resource: gpu_far_summary
```

Start smaller if browser WebGPU pressure is high:

```text
2-3 rings first
17x17 grid per tile
limited visible tile count
```

## Grid geometry

Create one reusable plane grid per resolution.

```ts
interface FarClipmapGridGeometry {
  resolution: number;        // vertices per side, e.g. 17
  indexCount: number;
  vertexBuffer: GPUBuffer | THREE.BufferGeometry;
  indexBuffer: GPUBuffer | typed array;
}
```

Local vertex attributes:

```text
localGridUv: vec2<f32> in [0, 1]
optional edgeFlags: u32
```

No baked world positions. The shader computes world position from tile descriptor.

## Tile descriptors

Each visible tile has a descriptor.

```ts
interface FarClipmapTileDescriptor {
  ring: number;
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  sizeX: number;
  sizeZ: number;
  cellSize: number;
  summaryLevel: number;
  fadeIn: number;
  fadeOut: number;
  flags: number;
}
```

GPU layout:

```wgsl
struct FarClipmapTileDescriptor {
    origin_size_xz: vec4<f32>,   // originX, originZ, sizeX, sizeZ
    cell_lod_fade: vec4<f32>,    // cellSize, summaryLevel, fadeIn, fadeOut
    tile_meta: vec4<u32>,        // ring, tileX, tileZ, flags
};
```

Use instancing: one grid mesh, many tile descriptors.

## Center and snapping

All ring origins must derive from canonical center.

```text
canonical center -> snapped ring origin -> tile descriptors
```

Snapping rule:

```ts
snap = ring.cellSize * ring.tileCells;
snappedOriginX = floor(canonicalX / snap) * snap;
snappedOriginZ = floor(canonicalZ / snap) * snap;
```

Counters must report both requested and snapped centers:

```text
far_clipmap_grid_center_x
far_clipmap_grid_center_z
far_clipmap_grid_snapped_origin_x
far_clipmap_grid_snapped_origin_z
far_clipmap_grid_snap_error_x
far_clipmap_grid_snap_error_z
far_clipmap_grid_distance_to_canonical_xz
```

The snapped origin may differ from canonical by at most one snap interval. The requested center should match canonical.

## Shader displacement

Vertex shader logic:

```wgsl
fn vertex_main(vertex: GridVertex, instance: u32) -> VertexOut {
    let tile = tile_descriptors[instance];
    let world_xz = tile.origin_xz + vertex.local_uv * tile.size_xz;
    let h = sample_far_height(world_xz, tile.summary_level);
    let normal = sample_far_normal(world_xz, tile.summary_level);

    var pos = vec3<f32>(world_xz.x, h, world_xz.y);
    pos.y = apply_morph_or_edge_fix(pos, normal, tile, vertex);

    return project(pos, normal, tile);
}
```

Fragment shader logic:

```wgsl
fn fragment_main(input: VertexOut) -> FragmentOut {
    let material = sample_far_material(input.world_xz, input.summary_level);
    let color = shade_far_terrain(material, input.normal, input.world_pos);
    return apply_fog_and_fade(color, input.fade);
}
```

Do not use CPU-generated far normals when GPU summaries are available. Sample or reconstruct normals from height summary.

## Height/material sources

Preferred source after GPU far-summary is stable:

```text
height summary texture/buffer
normal/slope summary
material/biome summary
water/land mask
```

Fallback sources:

```text
CPU far-summary texture upload
existing far terrain height sampler
flat conservative debug height
```

Fallback must render visibly safe terrain, not random data.

## Ring cracks and morphing

Cracks can occur between rings with different cell sizes.

Initial strategy:

```text
rings overlap by morph band
outer edge of inner ring fades out
inner edge of outer ring fades in
height samples use same source so vertical mismatch is small
```

If cracks remain:

```text
add ring edge skirts in shader
or add precomputed edge stitch strips
```

Do not start with complex stitching. Start with overlap/fade and measure.

## Near/far handoff

The far grid should not draw inside the near exclusion radius.

Options:

```text
1. do not create tiles intersecting near exclusion region
2. create tiles but fragment-discard/fade inside exclusion region
3. use stencil/ownership mask from near terrain
```

Start with option 2 because it is simple and robust:

```wgsl
let d = distance(input.world_xz, canonical_center_xz);
let nearFade = smoothstep(innerRadius, innerRadius + fadeBand, d);
alpha *= nearFade;
```

Later, use an ownership mask if z-fighting or overdraw is too high.

## Water and shoreline interaction

Far terrain must agree with water/ocean resources.

Rules:

```text
water height uses same canonical center / world coordinates
shoreline material uses water coverage from far summary
underwater far terrain may be hidden or fogged
far terrain does not cast opaque shadows as water
```

Add debug counters:

```text
far_clipmap_grid_water_center_distance_xz
far_clipmap_grid_water_level
far_clipmap_grid_shoreline_tiles
```

## CPU fallback

Fallback modes:

```text
WebGPU unavailable -> existing CPU far terrain path
shader compile failure -> existing CPU far terrain path
missing GPU far-summary -> CPU summary upload or old CPU far terrain path
far grid render failure -> disable far grid and use CPU far terrain
```

The fallback path must be kill-switchable:

```text
farClipmapGrid=0
```

## Config and URL flags

```text
farClipmapGrid=0|1
farClipmapGridRings=N
farClipmapGridResolution=17|33
farClipmapGridInnerRadius=N
farClipmapGridOuterRadius=N
farClipmapGridMorphBand=N
farClipmapGridDebug=0|1
farClipmapGridFallback=0|1
```

Initial default:

```text
manual populatedPerf: enabled after center debug and far-summary GPU are stable
acceptance diagnosis: opt-in first
normal dev: off until visual parity is clean
```

## Module layout

Suggested files:

```text
tools/clod-poc/src/terrain/far_clipmap_grid/far_clipmap_grid_config.ts
tools/clod-poc/src/terrain/far_clipmap_grid/far_clipmap_grid_types.ts
tools/clod-poc/src/terrain/far_clipmap_grid/far_clipmap_grid_planner.ts
tools/clod-poc/src/terrain/far_clipmap_grid/far_clipmap_grid_geometry.ts
tools/clod-poc/src/terrain/far_clipmap_grid/far_clipmap_grid_renderer.ts
tools/clod-poc/src/terrain/far_clipmap_grid/far_clipmap_grid_counters.ts
tools/clod-poc/src/terrain/far_clipmap_grid/shaders/far_clipmap_grid.wgsl
```

Tests:

```text
tools/clod-poc/src/terrain/far_clipmap_grid/far_clipmap_grid_planner.test.ts
tools/clod-poc/src/terrain/far_clipmap_grid/far_clipmap_grid_geometry.test.ts
tools/clod-poc/src/terrain/far_clipmap_grid/far_clipmap_grid_counters.test.ts
```

Adjust paths after reading latest main.

## Implementation phases

### Phase 1 — planner/config only

Add pure tile planning:

```text
ring definitions
tile coordinates around canonical center
near exclusion mask
ring snapping
tile descriptor generation
visible tile budget caps
```

No rendering change yet.

### Phase 2 — reusable grid geometry

Build reusable grid geometry once.

Tests:

```text
17x17 grid has expected vertices
indices are valid
winding is consistent
edge vertices identifiable
no per-tile world positions are baked
```

### Phase 3 — debug material renderer

Render clipmap grid flat at constant height or sampled CPU-uploaded height.

Goal:

```text
prove rings follow canonical center
prove tile descriptors and instancing work
prove near exclusion works
```

No material parity yet.

### Phase 4 — GPU far-summary sampling

Connect vertex shader to GPU far-summary height/normal/material resources.

Fallback if unavailable:

```text
use CPU-uploaded summary texture
or disable far grid and use old CPU far terrain path
```

### Phase 5 — far material parity

Use the same material ID/biome mapping as existing far terrain.

Add debug modes:

```text
height grayscale
ring color
material ID color
biome color
normal color
```

### Phase 6 — transition and fade

Implement near exclusion and ring morph/fade.

Check:

```text
no z-fighting near live terrain
no visible holes between rings
no harsh pop when walking across snap boundary
```

### Phase 7 — disable CPU far geometry build in target mode

Only after visual parity:

```text
farClipmapGrid=1 -> skip CPU far terrain mesh generation for covered far field
farClipmapGrid=0 -> old behavior
```

This is the actual performance step.

### Phase 8 — acceptance hard checks

Add perf and visual counters to acceptance.

## Counters

Top-level counters:

```text
far_clipmap_grid_enabled
far_clipmap_grid_renderer_ready
far_clipmap_grid_tiles_visible
far_clipmap_grid_rings_visible
far_clipmap_grid_instances_drawn
far_clipmap_grid_vertices_per_tile
far_clipmap_grid_indices_per_tile
far_clipmap_grid_cpu_geometry_builds_skipped
far_clipmap_grid_cpu_geometry_build_ms_saved_estimate
far_clipmap_grid_fallback_active
far_clipmap_grid_failed_frames
far_clipmap_grid_summary_missing_tiles
far_clipmap_grid_material_missing_tiles
```

Timing counters:

```text
far_clipmap_grid_plan_ms_p50
far_clipmap_grid_plan_ms_p95
far_clipmap_grid_upload_ms_p95
far_clipmap_grid_render_cpu_ms_p95
far_clipmap_grid_shader_compile_ms
```

Center counters:

```text
far_clipmap_grid_center_x
far_clipmap_grid_center_z
far_clipmap_grid_distance_to_canonical_xz
far_clipmap_grid_snapped_origin_x
far_clipmap_grid_snapped_origin_z
far_clipmap_grid_snap_error_x
far_clipmap_grid_snap_error_z
```

Quality/debug counters:

```text
far_clipmap_grid_near_excluded_tiles
far_clipmap_grid_morph_band_tiles
far_clipmap_grid_water_overlap_tiles
far_clipmap_grid_height_source_code
far_clipmap_grid_material_source_code
```

Source codes:

```text
0 none
1 gpu_far_summary
2 cpu_summary_upload
3 debug_flat
4 old_cpu_fallback
```

## Acceptance checks

Initial opt-in checks:

```text
far_clipmap_grid_enabled = 1
far_clipmap_grid_renderer_ready = 1
far_clipmap_grid_tiles_visible > 0
far_clipmap_grid_distance_to_canonical_xz <= snap interval
far_clipmap_grid_failed_frames = 0
far_clipmap_grid_summary_missing_tiles = 0 or low during warmup
```

After old CPU far geometry is skipped:

```text
far_clipmap_grid_cpu_geometry_builds_skipped > 0
farSummaryMs p95 does not regress
startup stabilization time improves
longViewDiagnosticsMs stays low
no bounds guard rejections caused by far grid
```

Visual checks:

```text
terrain, far shell, water, vegetation, and far grid appear in the same world region
no far grid stuck at startup origin
no grass/trees floating on a different far terrain center
no visible ring cracks at normal camera height
no severe shimmer while walking
```

## Tests

Planner tests:

```text
canonical center creates deterministic snapped origins
moving within snap interval keeps ring origins stable
crossing snap boundary updates origins predictably
near exclusion removes or fades inner tiles
tile budget cap respected
ring count config respected
finite scene fallback untouched
```

Geometry tests:

```text
grid resolution produces correct vertex count
grid indices in range
edge flags correct
no world-space positions baked into reusable grid
```

Counter tests:

```text
source code mapping stable
missing summary increments missing tiles
fallback active increments fallback counter
center distance computed correctly
```

Shader validation:

```text
WGSL compiles in browser/WebGPU path
shader handles missing summary resource safely
height source debug mode renders flat fallback
```

## Browser commands

```bash
cd tools/clod-poc

npm run typecheck
npm test -- src/terrain/far_clipmap_grid/far_clipmap_grid_planner.test.ts
npm test -- src/terrain/far_clipmap_grid/far_clipmap_grid_geometry.test.ts
npm test -- src/terrain/far_clipmap_grid/far_clipmap_grid_counters.test.ts
npm test
npm run build

node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene biome-near
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene walk
```

Manual populated URL should include:

```text
populatedPerf=1&worldCenterDebug=1&farSummaryGpu=1&farClipmapGrid=1
```

Debug URL additions:

```text
farClipmapGridDebug=1&farClipmapGridResolution=17
```

## Performance expectations

This feature should reduce:

```text
startup far terrain mesh creation
far terrain geometry upload churn
stabilization work caused by far terrain rebuilds
CPU far terrain memory churn
```

It may increase:

```text
GPU vertex shader work
far terrain overdraw if near exclusion/fades are too broad
summary texture sampling cost
```

Expected net:

```text
startup/stabilization faster
CPU p95 lower or flatter
renderMs may rise slightly, but should stay bounded
```

If renderMs rises too much:

```text
reduce grid resolution
reduce ring count
increase cell size at far rings
tighten near/far fade overlap
add frustum tile culling
```

## Risks and mitigations

### Wrong center creates far terrain in wrong place

Mitigation:

```text
requires canonical center counters
hard-check distance to canonical
visual debug ring colors
```

### Ring cracks

Mitigation:

```text
start with overlap/fade
add morph band
add shader skirts only if needed
```

### Material mismatch with near terrain

Mitigation:

```text
reuse material/biome mapping
add material ID debug mode
fade normal maps at distance
```

### Missing summary data causes garbage heights

Mitigation:

```text
safe fallback height
missing summary counters
fallback to old CPU far terrain path
```

### Too much GPU cost

Mitigation:

```text
small initial grid resolution
visible tile cap
frustum culling
ring LOD scaling
config kill switch
```

### Z-fighting with near terrain

Mitigation:

```text
near exclusion radius
fade band
optional ownership mask later
```

## Rollout order

```text
1. planner/config only
2. reusable grid geometry tests
3. flat debug far grid behind farClipmapGrid=1
4. center counters and ring debug colors
5. sample GPU far-summary height
6. sample material/biome summary
7. near exclusion and fade/morph band
8. skip CPU far geometry in target mode
9. acceptance hard checks
10. tune ring config for perf
```

## Implementation prompts for follow-up agents

### Prompt 1 — planner/config

```text
Read latest main. Add far clipmap grid config and pure tile planner. It must derive ring snapped origins from the canonical world center, generate tile descriptors, apply near exclusion, and expose counters. Do not render yet.
```

### Prompt 2 — reusable geometry

```text
Read latest main. Add reusable grid geometry generation for far clipmap tiles. Add tests for vertex/index counts, edge flags, winding, and no baked world positions.
```

### Prompt 3 — flat debug renderer

```text
Read latest main. Add farClipmapGrid=1 debug renderer that draws reusable grid tiles at a flat height using tile descriptors. Add ring color debug mode and center counters. Keep old far terrain path available.
```

### Prompt 4 — summary displacement

```text
Read latest main. Connect far clipmap grid vertex displacement to GPU far-summary height/normal resources, with CPU summary or flat fallback when missing. Do not read back displaced geometry.
```

### Prompt 5 — material parity

```text
Read latest main. Add far material/biome sampling for shader-displaced clipmap grid. Reuse existing terrain material mapping and add debug modes for material ID, biome, height, and normals.
```

### Prompt 6 — transition/fade

```text
Read latest main. Add near exclusion and ring morph/fade bands for the far clipmap grid. Ensure it does not z-fight with live/streamed terrain. Add counters for excluded and morph-band tiles.
```

### Prompt 7 — skip CPU far geometry

```text
Read latest main. When farClipmapGrid=1 and resources are ready, skip old CPU far terrain geometry builds for the covered far field. Keep farClipmapGrid=0 fallback. Add counters for skipped CPU builds and failed frames.
```

### Prompt 8 — acceptance

```text
Read latest main. Add infinite-islands acceptance checks for far clipmap grid enabled, renderer ready, visible tiles > 0, failed frames = 0, center distance within threshold, and CPU far geometry builds skipped in target mode.
```

## Done criteria

```text
WebGPU unavailable path works
old CPU far terrain fallback works
farClipmapGrid=1 follows canonical center
far grid does not appear at startup/finite-world origin
visible far terrain aligns with water, vegetation, and streamed terrain
no full far terrain mesh rebuild is needed during stabilization in target mode
perf mode does not read back far grid geometry
startup/stabilization improves or CPU far terrain build counters drop to near zero
```
