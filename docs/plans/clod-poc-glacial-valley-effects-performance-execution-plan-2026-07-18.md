# CLOD-POC Glacial Valley Effects and Performance Execution Plan

> Date: 2026-07-18  
> Target: `tools/clod-poc` on `main`  
> Reference: `deedy/glacial-valley`  
> Status: execution plan  
> Owner boundary: CLOD-POC first; Bevy parity is outside this document unless a shared config or contract is explicitly required.

## 1. Purpose

This plan turns the useful techniques from `deedy/glacial-valley` into a concrete, ordered implementation backlog for Drusniel CLOD-POC.

The goal is not to copy the reference architecture. The goal is to improve:

- environmental coherence;
- river and lake appearance;
- stones, cobbles, gravel bars, and ground detail;
- far lighting and atmospheric depth;
- cheap ambient effects such as mist, droplets, motes, dew, frost, and fish-rise rings;
- performance stability while walking, streaming, and changing time of day.

The plan is deliberately based on current CLOD-POC main, not the June 2026 baseline used by the older Glacial Valley plans. Water W1-W4, GPU vegetation rings, the far sun-visibility atlas, hydrology atlas sampling, SSR, caustics, flow-aware foam, deterministic stone scatter, and water acceptance already exist and must not be rebuilt.

## 2. License and source-use decision

License clearance for the Glacial Valley reference has already been established for this project.

Therefore implementation may:

- directly adapt algorithms and shader terms from `main.js`, `shaders.js`, and `trees.js`;
- translate GLSL to TSL/WGSL;
- translate JavaScript placement logic to deterministic TypeScript or GPU compute;
- preserve formulas where they are useful and correct;
- cite the reference in source comments where a non-trivial formula is adapted.

Implementation must still avoid blind copy-paste because Drusniel uses:

- WebGPU and TSL rather than the reference WebGL-only pipeline;
- infinite streamed terrain rather than one static heightfield;
- hydrology and far-summary atlases;
- editable voxel/CLOD ownership rules;
- GPU-driven vegetation and prop rings;
- quality tiers and acceptance automation.

## 3. Current main baseline

The following are already implemented and are dependencies, not new tasks.

### 3.1 Water already implemented

- Traced river and lake carving into the terrain authority.
- River continuity verification.
- Camera-following hydrology atlas Layout A:
  - water surface Y;
  - wet mask;
  - carved bed Y;
  - shoreline distance.
- Hydrology atlas Layout B:
  - flow X/Z;
  - flow strength;
  - body kind.
- Atlas-driven water clipmap rings in the vertex stage.
- Flow-aligned ripples and foam.
- River bank foam and rapid foam.
- Beer-Lambert absorption.
- Per-body water presets.
- Screen-space refraction.
- SSR with terrain/sky fallback.
- Analytic caustics.
- Wet terrain margins.
- Soft depth-based shoreline fading.
- Dedicated water acceptance captures and timing gates.

### 3.2 Far lighting already implemented

- CPU-built coarse far sun-visibility tiles.
- Budgeted tile construction.
- Camera-centered cache.
- Sun direction binning.
- Region-aware invalidation.
- GPU red-channel visibility atlas.
- Far terrain and far-shell sampling.
- Fog and god-ray use of the same atlas.
- Debug minimap and counters.

### 3.3 Stones already implemented

- Deterministic terrain-aware scatter.
- Large, medium, and small classes.
- LOD geometry and variants.
- Procedural rock generation with strata, cuts, creases, grain, moss data, and cavity AO.
- WebGPU storage-buffer instancing.
- Hydrology-aware carved-bed snapping.
- Wet-rock shading.
- GPU compute scatter path.
- YAML configuration.

### 3.4 Vegetation already implemented

- GPU ring compute.
- Toroidal camera-following placement.
- GPU rejection and culling.
- Indirect draw generation.
- Multiple LOD tiers.
- Continuous distance thinning.
- Hydrology rejection.
- Coherent gust model.
- Depth prepass where required.

## 4. Non-negotiable architecture rules

### GV-CLOD-G0 — Terrain authority remains unchanged

Glacial Valley uses one height function for everything. Drusniel must not adopt that representation.

- Near terrain remains voxel/CLOD derived.
- Caves, overhangs, edits, and voids must remain valid.
- Height-like summaries are lossy derived data only.
- No new heightfield may become gameplay, collision, editing, or CLOD page authority.

### GV-CLOD-G1 — Water remains an overlay

- Water must not enter CLOD page geometry.
- Hydrology remains the water authority.
- The water render path may consume terrain, hydrology, visibility, and prop-overlay summaries.
- Water must never write back into terrain/CLOD ownership to solve a visual problem.

### GV-CLOD-G2 — Stones and detail props remain overlays

- Small and medium stones never alter terrain.
- Large boulder participation in lighting uses a derived occlusion overlay, not terrain edits.
- Debris and ambience effects are visual-only unless a separate gameplay system explicitly owns them.

### GV-CLOD-G3 — No normal-gameplay readbacks

- New GPU detail systems must not require per-frame GPU-to-CPU readback.
- Debug counters may use throttled readback.
- Rendering must not wait for telemetry.

### GV-CLOD-G4 — Derived data is stale-safe

- Old cache/atlas data stays live until replacement data is ready.
- Rebuilds are double-buffered or versioned where visible replacement can pop.
- Missing data uses a conservative fallback and a debug-visible validity state.

### GV-CLOD-G5 — Every feature has a quality and kill switch

Each new visual feature must have:

- YAML-owned configuration;
- runtime enable/disable control;
- integrated-GPU or performance-quality fallback;
- acceptance counters;
- an isolated debug view when practical.

### GV-CLOD-G6 — No duplicated environmental math

Slope, material, shore distance, flow, depth, rapid, bar, and visibility calculations must be exposed once and shared. A feature may not create a private approximation when an authoritative value already exists.

## 5. Target architecture

The final CLOD-POC environmental stack should be:

```text
Terrain / CLOD / far summary authorities
                |
                +--> EnvironmentQuery CPU facade
                |
Hydrology atlas + far sun atlas + prop occlusion atlas
                |
                +--> Shared GPU environmental fields
                         |
                         +--> terrain materials
                         +--> water materials
                         +--> stones and debris
                         +--> vegetation
                         +--> fog and god rays
                         +--> mist, droplets, motes, rings, dew, frost
```

No new monolithic authority is introduced. `EnvironmentQuery` is a facade over existing owners, and the GPU fields remain separate textures/buffers with explicit ownership.

## 6. Configuration layout

Do not hardcode tuning values in implementation files.

Recommended configuration files:

```text
tools/clod-poc/src/app/config/
  environment_query.yaml
  sun_light.yaml                  # extend existing
  biome_visual_state.yaml
  ambience_details.yaml
  ground_debris.yaml

tools/clod-poc/config/
  water.yaml                      # extend existing body presets
  stones.yaml                     # extend existing placement modes
```

If the repository already has the canonical file for a setting, extend it instead of adding a duplicate.

All config readers must:

- validate finite values;
- clamp unsafe ranges;
- preserve backward compatibility for renamed fields when reasonable;
- expose the resolved config hash/signature in diagnostics;
- fail loudly for structurally invalid required sections;
- use safe defaults only for optional visual fields.

# Workstream 0 — Baseline, inventory, and reference snapshot

## GV-CLOD-00.1 — Record current-main ownership and status

Create an implementation status section or companion status table that maps every task in this plan to:

- `pending`;
- `in_progress`;
- `implemented`;
- `acceptance_pending`;
- `blocked`;
- `deferred`.

The status must explicitly mark the existing water W1-W4 and far sun cache as implemented foundations.

### Acceptance

- No task describes already-landed water or sun-cache work as greenfield.
- Older June Glacial Valley plans are linked as design references, not treated as current status.

## GV-CLOD-00.2 — Pin the reference implementation

Record the Glacial Valley source commit used for adaptation.

Keep a small reference index in this plan or a nearby reference note covering:

- terrain and river shaping;
- sun visibility bake;
- water shader;
- stone shader;
- mist and particle shaders;
- grass wind;
- post-process;
- seasonal state.

Do not vendor the whole repository into production source.

### Acceptance

- Adapted source comments can point to one pinned reference revision.
- Future upstream changes cannot silently change the comparison target.

## GV-CLOD-00.3 — Capture before-state evidence

Capture the same deterministic locations that later phases will use:

- close river;
- aerial river;
- still lake;
- shoreline;
- gravel-bar candidate reach;
- underwater riverbed;
- large-boulder shoreline;
- shaded valley/fog view;
- sun-facing valley/fog view;
- forest floor close view.

Record:

- URL and seed;
- camera position/yaw/pitch;
- quality flags;
- frame p50/p95/max;
- render p95;
- water p95/max;
- far-summary p95/max;
- stone/vegetation timings;
- uncaptured WebGPU errors.

### Acceptance

- Every later visual phase can produce an A/B against the same camera.
- Baseline artifacts are checked into the normal QA artifact location or referenced from the plan.

# Workstream 1 — Shared EnvironmentQuery facade

## Goal

Adopt Glacial Valley's single-query discipline without adopting its single-heightfield representation.

## GV-CLOD-01.1 — Define query contracts

Add small interfaces and immutable result types.

Recommended surface:

```ts
interface EnvironmentQuery {
  surfaceHeightBestEffort(x: number, z: number, hintM?: number): SurfaceQueryResult;
  surfaceNormal(x: number, z: number, hintM?: number): NormalQueryResult;
  materialWeights(x: number, z: number, hintM?: number): MaterialWeightsResult;
  water(x: number, z: number, hintM?: number): WaterQueryResult;
  river(x: number, z: number, hintM?: number): RiverQueryResult;
  visibility(x: number, z: number, hintM?: number): VisibilityQueryResult;
}
```

Recommended result metadata:

```ts
type QuerySource =
  | "live-terrain"
  | "terrain-tile"
  | "clod-summary"
  | "far-summary"
  | "hydrology-atlas"
  | "hydrology-cpu"
  | "sun-visibility-cache"
  | "fallback";

interface QueryMeta {
  source: QuerySource;
  revision: number;
  valid: boolean;
  cellSizeM: number;
}
```

Do not add confidence scoring until a consumer has a real branch that requires it.

### Required values

`WaterQueryResult`:

- water Y;
- carved bed Y;
- depth;
- wet mask;
- shore distance;
- body kind;
- body ID when available.

`RiverQueryResult`:

- flow direction;
- flow speed/strength;
- bed drop;
- rapid mask;
- channel-center weight;
- bank-contact weight;
- gravel-bar mask when Workstream 3 lands.

`VisibilityQueryResult`:

- sun visibility;
- validity;
- source tile revision.

## GV-CLOD-01.2 — Add batch APIs

Hot placement paths must not call object-heavy scalar APIs millions of times.

Add batch-oriented forms such as:

```ts
sampleEnvironmentBatch(input: Float32Array, output: EnvironmentBatchOutput, options: BatchOptions): void;
```

Requirements:

- allocation-free after initialization;
- caller-owned output buffers;
- explicit sample spacing/hint;
- optional field mask so callers request only needed data;
- deterministic ordering;
- no promises in the inner loop;
- no hidden tile construction larger than the caller's deadline budget.

## GV-CLOD-01.3 — Preserve scale hints end-to-end

Every query that can hit a cache or analytic sampler must carry the real consumer cell size.

This prevents far consumers from accidentally requesting one-metre precision and triggering fine-cache tile construction.

Add tests proving:

- far callers pass far cell size;
- near callers retain near precision;
- adapters do not replace the hint with `1`;
- large queries bypass inappropriate fine caches.

## GV-CLOD-01.4 — Route first consumers

Migrate only high-value duplication first:

1. river dressing;
2. stone CPU fallback;
3. ambience mask generation;
4. debug overlays.

Do not migrate all terrain, collider, and editor code in the first change.

### Acceptance

- Migrated outputs are byte-identical or within a documented numeric tolerance.
- No measurable frame-time regression.
- Query counters identify source and sample scale.
- Scalar and batch results match.

## GV-CLOD-01.5 — Add diagnostics

Counters:

```text
environment_query.scalar_calls
environment_query.batch_calls
environment_query.samples
environment_query.by_source.*
environment_query.by_field.*
environment_query.invalid
environment_query.fallback
environment_query.min_hint_m
environment_query.max_hint_m
environment_query.max_batch_size
environment_query.time_ms
```

Debug views:

- source ownership color;
- validity;
- revision age;
- query cell size;
- requested field mask.

# Workstream 2 — Far sun visibility completion and GPU production

## Goal

Extend the existing far sun-visibility cache. Do not reimplement its current atlas/material/fog integration.

## Existing foundation

Already present:

- budgeted CPU tile builder;
- camera-centered cache;
- atlas upload;
- far materials;
- fog and god rays;
- invalidation and counters.

## GV-CLOD-02.1 — Profile the CPU tile builder

Instrument the tile build into:

- source summary fetch;
- march setup;
- march samples;
- tile packing;
- atlas upload;
- queue management;
- invalidation.

Record:

- p50/p95/max tile build time;
- samples per tile;
- cache hit ratio;
- rebuilds per kilometre walked;
- rebuilds per time-of-day hour;
- upload bytes per second.

Do not move it to GPU only because it is CPU code. Move it only if measured cost or latency justifies it.

## GV-CLOD-02.2 — Add compute-based tile production behind a kill switch

If profiling confirms value, add a WebGPU compute path that reads the far-summary height/occupancy field and writes visibility tiles directly into a GPU storage texture/buffer.

Requirements:

- same tile coordinates and sun bins as CPU path;
- same soft-penumbra formula;
- increasing march step inspired by Glacial Valley;
- explicit missing-summary state;
- deterministic tolerance against CPU reference;
- no mandatory readback;
- CPU fallback retained.

Suggested flags:

```text
sunLightGpuBuild=0|1
sunLightGpuDebug=0|1
```

### Acceptance

- GPU and CPU fields match within declared tolerance.
- GPU build removes CPU spikes without increasing render p95 beyond budget.
- No WebGPU validation errors.
- CPU fallback remains functional.

## GV-CLOD-02.3 — Improve angular updates

Current sun-direction bins can cause churn or stale lighting during time-of-day movement.

Implement one of these only after measuring:

Preferred first option:

- one current-sun field;
- rebuild only after angular threshold;
- temporal blend from old field to new field.

Optional later option:

- two adjacent angular anchor fields;
- interpolate at runtime;
- cap memory and rebuild frequency.

Do not copy the reference's permanent morning/evening static bake as the runtime model.

## GV-CLOD-02.4 — Add visibility consumption to remaining materials

Consumers, in priority order:

1. water mid/far reflection fallback;
2. large/medium stones;
3. tree billboards and far canopy;
4. ground debris;
5. mist and motes;
6. optional underwater bed tint.

Use one shared sampling helper and uniform binding layout where possible.

## GV-CLOD-02.5 — Add dynamic-prop occluder hook

Do not make vegetation a full occluder field.

Provide an optional second overlay sampled by the sun march for:

- hero boulders;
- large cliffs represented as props;
- large static construction pieces where needed later.

This hook is implemented by Workstream 5.

### Performance gates

- Normal frame update: `p95 <= 0.30 ms` for CPU-side cache management.
- No single visibility update above `2.0 ms` on the target acceptance route.
- GPU builder, if enabled, must not add more than `0.30 ms` render p95.
- Zero gameplay readbacks.

# Workstream 3 — Gravel bars, braided reaches, and underwater cobbles

## Goal

Borrow the high-value gravel-bar and riverbed ideas without replacing traced hydrology.

## GV-CLOD-03.1 — Add a deterministic gravel-bar field

Build a bar mask in river-local coordinates using existing hydrology:

- longitudinal coordinate from channel flow/trace direction;
- cross-channel coordinate from channel center/bank metric;
- channel width/depth;
- low-frequency bar placement;
- higher-frequency edge breakup;
- seed and body ID.

The field should produce:

```ts
interface GravelBarSample {
  mask: number;
  elevationOffsetM: number;
  materialWeight: number;
  vegetationSuppression: number;
  cobbleWeight: number;
}
```

The implementation may directly adapt the Glacial Valley bed-bar noise idea, but it must use Drusniel's traced channel coordinates rather than a sine-wave global centerline.

## GV-CLOD-03.2 — Apply bars to terrain carving carefully

Bars may locally raise the carved bed, but must preserve:

- downstream continuity;
- minimum wet channel width;
- monotonic river constraints where enforced;
- lake flatness;
- bank safety;
- deterministic rebuilds.

Clamp the bar elevation using:

- minimum channel depth;
- local water Y;
- visible depth requirement;
- continuity reserve;
- bank height.

Do not add bars to lakes unless a lake-delta or sandbar mode is explicitly enabled.

### Acceptance

- Existing river continuity stays at 100% on the acceptance seed set.
- No dry wall cuts the main channel.
- At least one deterministic braided/split reach appears in a dedicated test scene.
- Terrain/hydrology CPU and GPU representations agree.

## GV-CLOD-03.3 — Publish the bar mask to GPU consumers

Add the mask to the best existing field layout.

Preferred order:

1. derive cheaply in shader from existing hydrology if enough data exists;
2. pack into an unused or new compact hydrology/river atlas channel;
3. use a separate small river-detail atlas only if ownership and update cadence differ.

Do not expand high-bandwidth float textures without measuring memory/upload cost.

Consumers:

- terrain gravel/sand blending;
- water shallow color and foam breakup;
- underwater cobbles;
- driftwood deposition;
- grass and understory suppression;
- small island vegetation.

## GV-CLOD-03.4 — Add a dedicated river-cobble placement mode

Current generic stone placement rejects standing water. Keep that rule for generic stones.

Add a separate deterministic placement class for:

- underwater cobbles;
- shoreline pebbles;
- gravel-bar stones;
- anchored rapid rocks.

Placement inputs:

- carved-bed Y;
- water depth;
- shore distance;
- bed slope;
- flow strength;
- bed drop/rapid mask;
- gravel-bar mask;
- material weights;
- exclusion features.

Placement rules:

- small rounded cobbles dominate calm shallow beds;
- medium rounded stones appear in stronger flow and bar margins;
- large anchored rocks require low enough slope and sufficient sink;
- dry bank stones remain on the normal stone path;
- no floating instances;
- no position based on uncarved base terrain.

## GV-CLOD-03.5 — Reuse current GPU stone grouping

Do not create a separate per-cobble render engine.

Integrate river cobbles into existing class/variant/LOD groups, with placement-mode metadata or a dedicated preset.

Required material behavior:

- always-wet response underwater;
- depth/turbidity attenuation from water path where appropriate;
- stronger polish for rounded cobbles;
- moss/lichen reduced underwater;
- no small/medium shadows;
- fade before aliasing becomes visible.

## GV-CLOD-03.6 — Fix river dressing counters and acceptance

Counters:

```text
river_detail.bar_candidates
river_detail.bar_accepted
river_detail.cobble_candidates
river_detail.cobble_rejected_depth
river_detail.cobble_rejected_slope
river_detail.cobble_rejected_flow
river_detail.cobble_rejected_exclusion
river_detail.cobble_visible
river_detail.cobble_underwater
river_detail.cobble_shore
river_detail.cobble_rapid
```

Acceptance must fail if the target river scene produces zero accepted river cobbles after convergence.

### Performance gates

- Scatter compute/CPU fallback work is deadline-bounded.
- No full ring rebuild in one frame after a normal 8 m refresh.
- No extra hydrology CPU samples in normal WebGPU rendering.
- River cobble render delta `<= 0.35 ms p95` at high quality.

# Workstream 4 — Glacial water presets and reflection quality tiers

## Goal

Add the parts of the Glacial Valley water look not already represented, without replacing the current water pipeline.

## GV-CLOD-04.1 — Audit existing water preset fields

Map current per-body fields against the desired glacial controls:

- absorption RGB;
- shallow/deep colors;
- turbidity;
- scattering color;
- scattering extinction/strength;
- caustic depth falloff;
- rapid foam gain;
- foam thresholds;
- reflection damping;
- ripple amplitude/scale;
- tight and broad sun glitter exponents;
- glacial lake versus river defaults.

Reuse existing fields where semantics match. Do not create synonyms.

## GV-CLOD-04.2 — Add `glacial_river` and `glacial_lake` presets

The presets must be body-selectable and must not change temperate/tropical bodies.

Example schema shape:

```yaml
body_presets:
  glacial_river:
    absorption_rgb: [...]
    shallow_color: [...]
    deep_color: [...]
    turbidity: ...
    suspended_scatter:
      enabled: true
      color: [0.07, 0.38, 0.36]
      extinction: ...
      strength: ...
    caustics:
      depth_falloff: ...
    glitter:
      tight_exponent: ...
      tight_gain: ...
      broad_exponent: ...
      broad_gain: ...
```

Values must live in YAML, not shader constants, except safe defaults.

## GV-CLOD-04.3 — Add suspended rock-flour in-scattering

Adapt the Glacial Valley term:

```text
scatterAmount = 1 - exp(-thickness * extinction)
scatter = scatterAmount * scatterColor * ambientLighting
```

Integrate it with the existing refraction/transmission result.

Requirements:

- per-body branch/config;
- zero or negligible cost when disabled;
- uses already-computed path thickness;
- responds to sun visibility and sky ambient;
- fades correctly in shallow clear water;
- debug output for scatter amount.

## GV-CLOD-04.4 — Expose two-lobe sun glitter

Add preset-controlled:

- tight glint exponent/gain;
- broad sheen exponent/gain;
- optional low-sun gain curve.

Reuse the current water normal and sun/view vectors.

Do not add extra texture fetches for glitter.

## GV-CLOD-04.5 — Add reflection distance tiers

Current SSR is retained for near water.

Implement policy resolution such as:

```text
near: current SSR + validated screen color
mid: short far-summary/visibility-assisted reflection approximation
far: analytic sky/atmosphere reflection
```

Mid-tier candidate adapted from Glacial Valley:

- 5-8 growing steps along reflected ray;
- sample far terrain height/occupancy summary;
- darken or replace sky reflection when distant terrain is hit;
- use far sun visibility at the hit;
- no scene render target traversal;
- no readback.

The policy must be quality and distance driven.

## GV-CLOD-04.6 — Keep one water material implementation per quality tier

Avoid separate glacial shader forks.

- High quality uses current HQ water graph plus preset nodes.
- Low quality uses the perf material with compatible preset colors and simplified scatter.
- Debug views remain common.

## GV-CLOD-04.7 — Add glacial acceptance views

Add fixed captures:

- shallow glacial river looking downstream;
- rapid bed step;
- deep glacial lake;
- low-sun glitter;
- clear versus glacial A/B at same camera.

Debug modes:

- path thickness;
- absorption RGB;
- scatter amount;
- caustics;
- rapid mask;
- foam;
- SSR hit/miss;
- reflection tier.

### Performance gates

- Preset-only selection: zero measurable cost.
- Rock-flour term: `<= 0.20 ms render p95` delta.
- Mid reflection tier cheaper than near SSR at its activation distance.
- High-quality water remains inside existing W4 budgets.
- No frame max above `2 ms` attributable to water updates.

# Workstream 5 — Large-prop occlusion overlay

## Goal

Let hero boulders and other large static props influence far visibility, fog, and water fallback reflections without entering terrain/CLOD geometry.

## GV-CLOD-05.1 — Define overlay ownership

Create a derived overlay owned by the large-prop system.

Suggested fields:

```text
R: conservative top height or occluder depth
G: occupancy/coverage
B: coarse ambient-occlusion contribution
A: validity/revision
```

Alternative compact layouts are allowed after measuring format support and bandwidth.

The overlay must be:

- camera-following or tiled consistently with far-summary data;
- dirty by affected prop cells only;
- stale-safe;
- optional;
- ignored by gameplay/collision/editing.

## GV-CLOD-05.2 — Select eligible props

Initial eligible set:

- large and hero boulders;
- large static rock formations represented as props.

Explicitly exclude initially:

- small and medium stones;
- grass;
- understory;
- normal trees;
- moving actors;
- construction pieces.

Add other classes only after proving value.

## GV-CLOD-05.3 — Build conservative footprints

For each eligible prop, write a conservative low-resolution height/occupancy footprint.

Requirements:

- no per-frame full rebuild;
- stable deterministic footprint from instance transform and bounds;
- union/max operation for overlaps;
- removal/relocation invalidates affected cells;
- old overlay stays active until replacement is ready.

## GV-CLOD-05.4 — Integrate with far sun visibility

The sun visibility builder samples:

```text
occluderHeight = max(terrainSummaryHeight, propOverlayHeight)
```

Only use the prop overlay when valid.

Add debug colors distinguishing:

- terrain occluder;
- prop occluder;
- missing overlay;
- stale overlay.

## GV-CLOD-05.5 — Integrate with water reflection fallback

The mid-distance reflection march uses the combined terrain/prop occluder height so large boulders can darken or interrupt distant reflected sky.

Do not use the overlay for near SSR, which already sees rendered geometry.

## GV-CLOD-05.6 — Integrate with mist soft clipping

River mist cards may use the overlay to avoid visibly passing through hero boulders.

This must be a soft density reduction, not a hard geometric cut.

### Performance gates

- Overlay update `p95 <= 0.20 ms` CPU management.
- Upload/update only dirty regions.
- No render pass dedicated solely to overlay generation unless compute profiling proves it cheaper.
- No visible prop popping caused by overlay lag.

# Workstream 6 — Deterministic biome detail masks

## Goal

Implement masks first. Do not start by spawning particles.

## GV-CLOD-06.1 — Define mask set

Initial masks:

```text
river_mist_mask
rapid_splash_mask
sunbeam_mote_mask
calm_pool_mask
frost_mask
dew_mask
gravel_bar_mask
shore_debris_mask
```

Inputs must come from `EnvironmentQuery` or shared GPU fields.

## GV-CLOD-06.2 — Define formulas and ownership

### River mist mask

Inputs:

- wet/body mask;
- shore distance;
- water depth;
- local valley/terrain height;
- flow;
- humidity/morning-mist visual state;
- sun visibility.

Target:

- strongest above cold water and shaded low ground;
- reduced on steep exposed banks;
- distance and quality gated.

### Rapid splash mask

Inputs:

- flow strength;
- bed drop;
- shallow depth;
- rapid mask;
- waterline proximity;
- large-boulder proximity when available.

### Sunbeam mote mask

Inputs:

- sun visibility;
- view-sun alignment evaluated in shader;
- local fog/mist amount;
- season/pollen or snow state.

### Calm pool mask

Inputs:

- sufficient depth;
- very low flow;
- low bed drop;
- lake/pond body kind or calm river pocket;
- distance from shore.

### Frost mask

Inputs:

- low sun visibility;
- cold season/temperature state;
- upward-facing surface/vegetation;
- distance.

### Dew mask

Inputs:

- vegetation presence;
- morning state;
- humidity;
- no heavy rain/snow override;
- distance.

## GV-CLOD-06.3 — Build GPU-friendly mask access

Prefer deriving cheap masks in consumer shaders from existing fields.

Create a dedicated mask atlas only when:

- the formula is expensive and shared by several consumers;
- update cadence is slower than frame rate;
- packing saves repeated work;
- ownership is clear.

Avoid a giant all-effects RGBA32F atlas.

## GV-CLOD-06.4 — Add debug overlays before effects

Each mask needs:

- isolated color mode;
- numeric probe at cursor/player;
- min/max/mean counters for active region;
- validity display;
- source field display.

### Acceptance

- Mist hugs water and low ground.
- Splash appears only at rapid/shallow/drop areas.
- Calm pools exclude rapids.
- Frost is shaded/cold, not random.
- Mote visibility is spatially tied to sun visibility.
- Mask debug has no dependency on spawned effects.

# Workstream 7 — Ambient effects

## Goal

Add cheap, aggressively culled ambience driven by Workstream 6 masks.

## GV-CLOD-07.1 — River mist sheets

Adapt the Glacial Valley billboard field to CLOD-POC.

Implementation:

- instanced camera-facing cards;
- camera-relative wrapping along eligible river/lake regions;
- wind advection entirely in shader;
- low-frequency density breakup;
- terrain and large-prop soft clipping;
- sun-visibility color tint;
- near fade to avoid camera intersection;
- far fade before billboard aliasing;
- optional depth softening if available cheaply.

Do not traverse the scene each frame to hide/show objects.

Config:

```yaml
river_mist:
  enabled: true
  max_instances: ...
  spawn_radius_m: ...
  fade_start_m: ...
  fade_end_m: ...
  update_period_frames: ...
  card_width_m: ...
  card_height_m: ...
  drift_speed_mps: ...
  density: ...
  integrated_gpu_enabled: false
```

## GV-CLOD-07.2 — Rapid splash droplets

Use GPU point sprites or compact quads.

Requirements:

- spawn only from rapid splash mask;
- deterministic source points per river cell;
- procedural time phase, no CPU particle simulation;
- ballistic-looking vertical arc in shader;
- reset/wrap by hashed lifetime;
- depth and distance fade;
- no collision;
- no readback.

Optional second type:

- small foam/spray around large rocks intersecting fast water.

## GV-CLOD-07.3 — Sunbeam motes

Use player-centered wrapped points.

Brightness:

```text
sunVisibility * forwardScatter(viewDir, sunDir) * localMist * visualStateAmount
```

Requirements:

- practically invisible outside shafts;
- pollen color in warm seasons;
- snow-crystal color in cold season;
- camera-relative wrapping;
- quality-tier density;
- no CPU movement updates beyond center uniform.

## GV-CLOD-07.4 — Fish-rise rings

Implement calm-water rings as procedural quads or water decals.

Requirements:

- calm pool mask only;
- deterministic sparse event phases;
- ring expansion and fade in shader;
- body-normal/water-Y placement from hydrology atlas;
- no rings in rapids, shallow shore, ocean surf, or under land;
- low maximum instance count.

## GV-CLOD-07.5 — Dew and frost accents

Start with shader accents before adding geometry.

Preferred order:

1. grass/leaf sparkle term using existing blade/leaf data;
2. frost tint driven by frost mask;
3. optional sparse point droplets only if the shader-only result is insufficient.

Do not add thousands of separate droplets by default.

## GV-CLOD-07.6 — Quality and cumulative cost control

Every effect independently supports:

- off;
- low;
- high.

`performance100` behavior:

- mist off or minimal;
- motes off;
- droplets heavily reduced;
- fish rings reduced;
- shader-only frost/dew allowed if negligible.

Integrated GPU default:

- mist off;
- motes off;
- low droplets;
- fish rings low;
- no extra transparent pass unless explicitly enabled.

### Performance gates

Combined at high quality:

- ambient effects render delta `<= 0.50 ms p95`;
- CPU update `<= 0.20 ms p95`;
- no effect update above `1.0 ms`;
- transparent overdraw documented;
- zero WebGPU errors;
- no gameplay readbacks.

# Workstream 8 — GPU ground-debris ring

## Goal

Fill the visually clean forest/meadow floor without increasing draw-call or CPU-placement cost.

## GV-CLOD-08.1 — Define debris classes

Initial classes:

- tiny cobbles;
- flat pebbles;
- twigs;
- bark chips;
- leaf litter clusters;
- small gravel patches.

Do not include medium/large stones already owned by the stone system.

## GV-CLOD-08.2 — Reuse vegetation/stone compute patterns

Create one shared debris ring or extend an existing compatible ring.

Requirements:

- toroidal world mapping;
- deterministic PCG/hash placement;
- GPU early rejection;
- indirect draw groups;
- distance thinning;
- ring edge fade;
- material/biome weighting;
- hydrology and construction exclusion;
- no per-instance CPU transforms.

Avoid one separate ring grid per debris class. Use grouped append buffers and draw arguments.

## GV-CLOD-08.3 — Placement rules

### Forest floor

- bark, twigs, leaves;
- canopy/forest-biome weighted;
- suppress on steep rock and water;
- clumped parent field.

### River and shore

- pebbles and gravel;
- gravel-bar and shore-debris masks;
- wetness response;
- suppress where water is too deep for visible debris.

### Meadows

- sparse tiny stones and dry twigs;
- avoid visual noise near paths/construction footprints.

## GV-CLOD-08.4 — Geometry strategy

- tiny pebbles: very low-poly icosphere/slab variants;
- twigs: 2-4 segment low-poly strips/cylinders;
- bark/leaf litter: crossed or ground-aligned cards with procedural shape mask;
- far debris: fade out, no billboard tier required initially.

## GV-CLOD-08.5 — Material strategy

- share lighting and far sun visibility;
- wet darkening near water;
- biome tint;
- no individual shadows;
- depth prepass only if alpha-card overdraw requires it;
- dithered fade.

### Performance gates

- One compute pipeline family, not one per class.
- Draw calls bounded by class/material/LOD groups.
- CPU update near zero after initialization.
- High-quality debris delta `<= 0.45 ms p95`.
- No visible ring boundaries while walking.

# Workstream 9 — Biome visual-state vector and post audit

## Goal

Use one visual-state vector so terrain, water, vegetation, fog, and ambience change coherently.

## GV-CLOD-09.1 — Define shared visual state

Suggested shape:

```ts
interface BiomeVisualState {
  seasonT: number;
  green: number;
  autumn: number;
  bloom: number;
  snowlineM: number;
  glacialMurkiness: number;
  morningMist: number;
  pollenAmount: number;
  frostAmount: number;
  wetness: number;
}
```

Reuse the existing time-of-day and season clock. Do not create another clock.

## GV-CLOD-09.2 — Route consumers incrementally

Order:

1. glacial water murkiness/scatter;
2. morning mist;
3. frost/dew/motes;
4. terrain snowline and seasonal tint if not already shared;
5. grass/understory/tree seasonal color;
6. flower bloom.

Consumers read the state. They do not recompute season curves independently.

## GV-CLOD-09.3 — Add look-development controls

Add a compact GUI folder with:

- season scrub;
- glacial murkiness;
- morning mist;
- pollen/snow motes;
- frost;
- wetness.

Support reset to YAML defaults and export/log resolved values for authoring.

## GV-CLOD-09.4 — Audit post-processing before adding code

Compare current CLOD-POC post stack against the useful Glacial Valley terms:

- HDR linear output;
- ACES tone mapping;
- adaptive exposure;
- sun-facing exposure reduction;
- vignette;
- grain;
- warm/cool grade;
- sRGB conversion ownership.

Rules:

- never add a second tone mapper;
- never apply sRGB conversion twice;
- add only proven missing terms;
- adaptive exposure must be stable and not oscillate with fast camera turns;
- expose debug histogram/luminance only if existing infrastructure supports it cheaply.

### Acceptance

- Fixed season checkpoints produce coherent terrain/water/vegetation/fog changes.
- Non-glacial scenes remain unchanged when state values use current defaults.
- Post cost remains flat unless a specifically approved missing term is added.

# Workstream 10 — Integration, QA, and rollout

## GV-CLOD-10.1 — Add feature flags

Required runtime switches:

```text
environmentQueryDebug
sunLightGpuBuild
propOcclusionOverlay
riverGravelBars
riverCobbles
waterGlacialPreset
waterReflectionTierDebug
riverMist
rapidDroplets
sunbeamMotes
fishRings
dewFrost
groundDebris
biomeVisualStateDebug
```

Production configuration remains YAML-owned. URL flags are temporary overrides and debug controls.

## GV-CLOD-10.2 — Add counters to `__drusnielClod.stats.counters`

At minimum:

```text
environment_query.*
sunLightCache.gpuBuild*
prop_occlusion.*
river_detail.*
water.glacial*
water.reflection_tier.*
ambience.mist.*
ambience.droplets.*
ambience.motes.*
ambience.fish_rings.*
ambience.dew_frost.*
ground_debris.*
```

Counters must distinguish:

- generated;
- accepted;
- visible;
- culled;
- rejected by major reason;
- update/build time;
- GPU submit time versus actual GPU timing when available.

Do not label queue-submit CPU time as GPU execution time.

## GV-CLOD-10.3 — Extend deterministic acceptance scenes

Add or extend the normal infinite-islands battery with:

### River detail case

- close braided reach;
- aerial braided reach;
- underwater bed/cobbles;
- shore/bar transition;
- rapid rock droplets.

### Atmosphere case

- shaded valley mist;
- sunlit valley mist;
- god-ray/mote alignment;
- time-of-day transition.

### Ground-detail case

- forest floor debris;
- river bar debris;
- meadow debris;
- walking ring-boundary capture.

### Glacial water case

- clear/glacial A/B;
- deep lake;
- shallow river;
- rapid foam;
- low-sun glitter.

## GV-CLOD-10.4 — Add visual invariants

Automated or semi-automated gates:

- no floating river cobbles;
- no cobbles above water when classed underwater;
- no mist hard-slicing terrain near reference cameras;
- no fish rings in rapid mask;
- no debris inside water/building exclusion masks;
- no dry wall across river continuity probes;
- no missing water atlas rings;
- no visible debris/stone ring seam in movement capture;
- no stale overlay black tiles;
- no WebGPU errors.

## GV-CLOD-10.5 — Add performance A/B matrix

For every phase run:

```text
feature off / feature on
static / moving
high quality / performance quality
discrete GPU / integrated-GPU policy
fresh startup / reuse acceptance
```

Required reported metrics:

- frame p50/p95/max;
- fps P5;
- render p95;
- water p95/max;
- far summary p95/max;
- visibility build p95/max;
- prop/debris compute submit p95/max;
- ambience CPU p95/max;
- visible counts;
- atlas uploads and bytes;
- uncaptured WebGPU errors.

## GV-CLOD-10.6 — Rollout policy

Each workstream lands in small commits:

1. contract/config/tests;
2. debug mask or CPU reference;
3. GPU implementation;
4. visual integration;
5. acceptance and perf evidence;
6. default enablement.

Do not enable a feature by default in the same commit that first makes it render unless acceptance and perf evidence are included.

# 11. Recommended implementation order

## Phase A — Shared foundations

1. `GV-CLOD-00` baseline and reference pin.
2. `GV-CLOD-01` EnvironmentQuery contract, batch API, and first consumers.
3. `GV-CLOD-09.1` visual-state skeleton only.

Exit criteria:

- shared contracts exist;
- no visual change required;
- tests and typecheck green;
- no hot-path regression.

## Phase B — River/stone visual payoff

1. `GV-CLOD-03.1` gravel-bar field.
2. `GV-CLOD-03.2` safe bed integration.
3. `GV-CLOD-03.3` GPU mask publication.
4. `GV-CLOD-03.4-03.6` underwater cobbles and counters.

Exit criteria:

- continuity remains 100%;
- accepted underwater cobbles are non-zero;
- no floating stones;
- movement performance inside gate.

## Phase C — Water preset and reflections

1. `GV-CLOD-04.1-04.2` preset audit/config.
2. `GV-CLOD-04.3` rock-flour scatter.
3. `GV-CLOD-04.4` glitter.
4. `GV-CLOD-04.5` reflection tiers.
5. `GV-CLOD-04.7` acceptance.

Exit criteria:

- glacial and clear bodies differ by preset only;
- existing water battery still passes;
- high-quality budget maintained.

## Phase D — Visibility and prop overlay

1. `GV-CLOD-02.1` profile existing builder.
2. `GV-CLOD-05` prop occlusion overlay.
3. `GV-CLOD-02.4` remaining visibility consumers.
4. `GV-CLOD-02.2` GPU builder only if profiling supports it.
5. `GV-CLOD-02.3` angular refinement only if needed.

Exit criteria:

- large boulders affect far visibility/reflection without terrain edits;
- no cache spikes;
- GPU builder is optional and parity-tested.

## Phase E — Masks and ambience

1. `GV-CLOD-06` all debug masks.
2. `GV-CLOD-07.1` mist.
3. `GV-CLOD-07.2` droplets.
4. `GV-CLOD-07.3` motes.
5. `GV-CLOD-07.4` fish rings.
6. `GV-CLOD-07.5` dew/frost.

Exit criteria:

- masks are correct before effects;
- combined ambience within budget;
- performance preset disables expensive layers.

## Phase F — Ground debris and visual-state completion

1. `GV-CLOD-08` debris ring.
2. `GV-CLOD-09.2-09.3` route state consumers and look-dev controls.
3. `GV-CLOD-09.4` post audit.
4. `GV-CLOD-10` full acceptance integration.

Exit criteria:

- ground no longer reads unnaturally clean;
- no visible ring seams;
- seasonal state is coherent;
- final battery green.

# 12. File-level implementation guide

The exact split may evolve, but new code should remain small and responsibility-focused.

Suggested modules:

```text
tools/clod-poc/src/environment/
  environment_query.ts
  environment_query_types.ts
  environment_query_batch.ts
  environment_query_debug.ts
  environment_query_stats.ts

  biome_visual_state.ts
  biome_visual_state_config.ts
  biome_visual_state_debug.ts

tools/clod-poc/src/water/
  river_gravel_bar.ts
  river_gravel_bar_config.ts
  river_detail_masks.ts
  water_glacial_preset.ts
  water_reflection_tiers.ts

tools/clod-poc/src/stones/
  river_cobble_scatter.ts
  river_cobble_config.ts
  river_cobble_validation.ts

tools/clod-poc/src/lighting/
  prop_occlusion_overlay.ts
  prop_occlusion_config.ts
  prop_occlusion_debug.ts

tools/clod-poc/src/ambience/
  ambience_config.ts
  ambience_masks.ts
  river_mist.ts
  rapid_droplets.ts
  sunbeam_motes.ts
  fish_rings.ts
  dew_frost.ts
  ambience_stats.ts

tools/clod-poc/src/debris/
  debris_config.ts
  debris_ring.ts
  debris_instances.ts
  debris_debug.ts

tools/clod-poc/src/gpu/shaders/
  environment_query.wgsl
  gravel_bar.wgsl
  prop_occlusion.compute.wgsl
  debris_ring.compute.wgsl
```

Do not create these files if existing modules already own the responsibility cleanly. Extend existing water, stone, far-summary, and GPU binding modules when that keeps ownership clearer.

# 13. Testing requirements

## Unit tests

- EnvironmentQuery scalar/batch parity.
- Source/revision/validity metadata.
- Cell-size hint propagation.
- Gravel-bar determinism.
- Gravel-bar channel continuity constraints.
- River-cobble deterministic subsets under lower budgets.
- Underwater cobble carved-bed snapping.
- Glacial preset parsing and body isolation.
- Scatter formula numeric tests.
- Reflection tier policy.
- Prop overlay footprint union/removal.
- Mask formulas.
- Visual-state season curves.
- Debris ring deterministic world mapping.

## GPU parity tests

- CPU/GPU gravel-bar mask tolerance.
- CPU/GPU sun visibility tolerance if GPU builder lands.
- CPU/GPU river-cobble acceptance parity where both paths exist.
- CPU/GPU debris ring hashing and band selection.
- Shader module binding/size validation.
- Storage-buffer capacity and indirect argument validation.

## Integration tests

- Infinite-world movement across tile/ring boundaries.
- Teleport and large snap.
- Terrain revision invalidation.
- Water atlas recenter.
- Prop overlay dirty region.
- Quality tier changes.
- WebGL fallback where applicable.
- Feature-disabled byte/visual stability where promised.

## Browser smoke

- WebGPU initialization.
- Zero uncaptured errors.
- All debug views render.
- GUI toggles do not recreate pipelines every frame.
- No material churn from normal state updates.

# 14. Definition of done

The complete plan is done only when all of the following are true:

- EnvironmentQuery is the shared query path for river details, stones, and ambience masks.
- Far sun visibility remains stable while walking and changing time of day.
- Large hero boulders can influence far lighting/reflection through an overlay without changing terrain.
- At least one deterministic river reach visibly braids around gravel bars while continuity remains 100%.
- Underwater and shoreline cobbles are visible, correctly seated, and non-zero in acceptance.
- Glacial water has body-specific rock-flour scatter, absorption, caustics, foam, and glitter.
- Near/mid/far water reflection policies are explicit and measured.
- Mist, droplets, motes, fish rings, dew, and frost are mask-driven and independently disabled.
- Ground debris uses GPU ring/indirect patterns and has no visible ring seam.
- Seasonal/biome visual state drives all participating systems coherently.
- Existing non-glacial scenes remain visually stable at default values.
- Existing water W4 acceptance remains green.
- New river-detail, atmosphere, and ground-detail acceptance cases are green.
- No WebGPU validation errors.
- No new normal-gameplay readbacks.
- Combined new effects remain inside the declared performance budgets.

# 15. Final performance budget summary

These are target gates for implementation acceptance, not claims about current measured performance.

| Area | Target |
|---|---:|
| EnvironmentQuery management | `<= 0.20 ms p95` |
| Far visibility cache management | `<= 0.30 ms p95` |
| Any far visibility update spike | `<= 2.00 ms max` |
| Prop occlusion overlay management | `<= 0.20 ms p95` |
| Glacial scatter render delta | `<= 0.20 ms p95` |
| River cobble render delta | `<= 0.35 ms p95` |
| Ambient effects combined render delta | `<= 0.50 ms p95` |
| Ambient effects CPU update | `<= 0.20 ms p95` |
| Ground debris render delta | `<= 0.45 ms p95` |
| Water update spike | remain inside existing W4 gate |
| GPU-to-CPU gameplay readbacks | `0` |
| Uncaptured WebGPU errors | `0` |

# 16. Explicitly rejected work

Do not implement any of the following as part of this plan:

- replacing Drusniel terrain with the Glacial Valley heightfield;
- replacing traced rivers with sine-wave centerlines;
- replacing the current water renderer with the reference two-pass renderer;
- adding a second full-scene refraction render;
- baking static morning/evening shadows as the only runtime lighting model;
- inserting stones into CLOD page geometry;
- letting small stones edit terrain;
- spawning ambience uniformly without masks;
- one render engine per effect or debris class;
- per-frame scene traversal to hide objects for refraction;
- mandatory GPU readbacks for counters;
- enabling all transparent ambience on integrated GPUs;
- adding a second tone mapper or duplicate sRGB conversion;
- weakening continuity, performance, or error gates to make a phase pass.

# 17. Related plans

This document is the consolidated current-main execution owner for CLOD-POC Glacial Valley adoption.

Older plans remain useful design references:

- `docs/plans/glacial-valley-port-overview.md`
- `docs/plans/glacial-valley-water-preset-plan.md`
- `docs/plans/glacial-valley-far-field-sun-visibility-plan.md`
- `docs/plans/glacial-valley-braided-river-worldgen-plan.md`
- `docs/plans/glacial-valley-terrain-query-discipline-plan.md`
- `docs/plans/glacial-valley-biome-detail-masks-plan.md`
- `docs/plans/glacial-valley-biome-visual-state-plan.md`
- `tools/clod-poc/docs/far-sun-visibility-cache.md`
- `tools/clod-poc/docs/plans/water-rivers-gpu-fable5-parity-plan-2026-07-17.md`

Where an older plan conflicts with current main status, this document and the current implementation take precedence.
