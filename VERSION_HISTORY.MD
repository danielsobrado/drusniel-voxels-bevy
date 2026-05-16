# Version History

Current development version: **v0.5**.

### Current (v0.5)

* **Water Rendering Overhaul**: Custom water fragment over `bevy_water`, plus per-water-body presets, planar reflections, screen-space refraction, underwater caustics, and a CPU-driven wave-displacement sim for buoyancy.

  * **Per-Water-Body Presets**: Each connected water body (ocean, lake, river, pond, shallow flood) gets its own `WaterMaterial` parameters — wave amplitude/scale/count, reflection strength, Fresnel power, distortion strength, shallow/deep colour, base alpha, foam toggles, murkiness. Tuned in [assets/config/water.yaml](assets/config/water.yaml) under `body_presets`. Material LOD swaps fancy↔cheap material per body based on distance + triangle count + depth.
  * **Underwater Caustics** ([assets/shaders/water_caustics.wgsl](assets/shaders/water_caustics.wgsl)): Sine-wave + Voronoi caustic patterns projected onto terrain below `WATER_LEVEL`. Active in both triplanar (smooth terrain) and blocky (voxel) shaders, with depth attenuation and a shoreline falloff so caustics fade out in deep water and at the waterline.
  * **Planar Reflection Camera** ([src/rendering/water_reflection.rs](src/rendering/water_reflection.rs)): A dedicated reduced-resolution camera renders the scene mirrored across the water plane (`Y = WATER_LEVEL`). Mirror transform flips both position and pitch. Temporal amortization (render every N frames). Disabled automatically on integrated GPUs. **RenderLayers-based culling** excludes below-water terrain chunks from the reflection camera so underwater geometry never leaks into reflections.
  * **Reflection Compositor** ([src/rendering/water_reflection_compositor.rs](src/rendering/water_reflection_compositor.rs)): A custom post-process render graph node inserted between `EndMainPass` and `Bloom`. A dedicated water mask render layer marks water-surface pixels; the compositor blends the planar reflection texture with Schlick-Fresnel-driven strength and wave-driven UV distortion. Sidesteps `bevy_water`'s single-uniform-binding limit by compositing after the main pass. No-op when reflections are disabled.
  * **Fresnel Reflection Blending**: Schlick Fresnel drives view-angle dependent reflection strength — at glancing angles the water surface becomes a mirror; at steep angles it's transparent. Includes an approximated sun specular highlight in the reflected direction. Alpha also increases at glancing angles (physically correct — water becomes opaque when viewed at a shallow angle).

  #### Witchcraft water finish

  Optional finish pass for water color and alpha, disabled by default — a port of the WATERCOLOR_MODE / Fresnel-alpha block from Aurora's (Complementary Reimagined) `gbuffers_water.glsl`. Enable it with `witchcraft_finish.enabled: true` in [assets/config/water.yaml](assets/config/water.yaml) or `VOXEL_WATER_WITCHCRAFT_FINISH=1`. The pass is intentionally narrow: final water color tinting, optional RGB multiplier, Fresnel-driven alpha shaping, and an optional reflection multiplier for the existing reflection path.


  * **Screen-Space Refraction**: Enables Bevy's built-in `specular_transmission = 0.2`, `ior = 1.33` (water's physical IOR), and `thickness = 0.5` on the water `StandardMaterial`. Wave normals (computed in the fragment shader from `bevy_water::get_wave_height` via screen-space derivatives) drive the transmission distortion direction.
  * **Interactive Displacement System** ([src/rendering/water_displacement.rs](src/rendering/water_displacement.rs)): CPU-driven 256×256 wave physics simulation using the discrete 2D wave equation (height + velocity fields, ~0.3 ms/frame). Objects with a `WaterImpulseSource` component (e.g. the player) inject circular impulses when moving through water; the wave equation propagates them outward with configurable speed and damping. The result is uploaded to a `WaterDisplacementTexture` each frame and queried by `sample_water_displacement()` for accurate buoyancy. **Note: the texture is not yet bound to the water surface shader, so the visual surface does not react to impulses — only buoyancy queries do.**
  * **Config-Driven**: All consumed parameters live in [assets/config/water.yaml](assets/config/water.yaml) — body presets, reflection resolution scale, refraction strength/IOR, displacement grid + damping, weather coupling, witchcraft finish toggles.
  * **GPU Fallback**: Planar reflections and the displacement sim are automatically disabled on integrated GPUs via the existing `GraphicsCapabilities::integrated_gpu` flag.
* **Performance Optimization Sweep**: Systematic GPU/CPU cost reduction across all major rendering and simulation systems, using distance-based culling, budget limiting, and quality scaling.
* **Experimental NAADF Backend**: Added a default-off derived voxel ray cache for GI/preview experiments. It is opt-in through the `naadf` Cargo feature and [assets/config/naadf.yaml](assets/config/naadf.yaml), keeps the current renderer as the shipping default, and preserves integrated-GPU fallback unless explicitly overridden. See [docs/rendering/naadf.md](docs/rendering/naadf.md), [docs/rendering/naadf-debugging.md](docs/rendering/naadf-debugging.md), [docs/rendering/naadf-benchmarks.md](docs/rendering/naadf-benchmarks.md), and [docs/rendering/naadf-completion-jira-plan.md](docs/rendering/naadf-completion-jira-plan.md).

  #### 0.5v NAADF implementation work

  The v0.5 cycle now includes the first substantial NAADF porting slice from the upstream `cg-tuwien/NAADF` structure into Drusniel's voxel renderer:

  * **CPU NAADF construction**: Builds 16x16x16 chunks as 4x4x4 block groups with 4x4x4 voxel blocks, including per-voxel 2-bit directional skip fields, per-block 2-bit directional skip fields, and per-chunk 5-bit directional skip fields across loaded known-empty neighbor chunks.
  * **Skip traversal backend**: CPU ray traversal now consumes voxel, block, and chunk skip records instead of only doing dense DDA stepping. Tests cover empty/mixed/full fixtures, loaded-empty chunk skipping, and DDA-equivalence cases.
  * **Dynamic entity voxel contract**: NAADF now has a `NaadfEntityVoxelVolume` component and registry for rotated dynamic voxel volumes. The CPU ray backend traces those volumes in entity-local voxel space and returns the nearest terrain/entity hit, and the GPU preview path uploads entity records/materials so first-hit preview can compare static terrain hits against dynamic volume hits.
  * **GPU record layout parity**: GPU upload packing now mirrors the CPU-built records: voxel records carry occupancy plus 12-bit directional skip data, block record word 5 carries per-block skip data, and chunk record word 6 carries per-chunk skip data.
  * **GPU build shader groundwork**: `build_blocks.wgsl`, `build_bounds.wgsl`, and `build_chunks.wgsl` are no longer empty/scaffold-only. They now generate voxel/block/chunk records using workgroup-local propagation and the same record words that traversal reads.
  * **GPU chunk-bound pass**: `build_chunk_bounds.wgsl` computes safe contiguous loaded-empty chunk skips into chunk record word 6, including bounded perpendicular-slab validation, so GPU-built records are no longer limited to CPU-uploaded chunk skip data.
  * **WGSL traversal hooks**: `ray_trace.wgsl` reads voxel, block, and chunk records and chooses the deepest safe skip level available for the current ray step.
  * **Production query routing groundwork**: Radiance cascade uniforms now carry both the resolved voxel backend and a per-query NAADF routing mask for GI secondary rays, sun visibility, terrain AO, and contact shadows. The shader branches by purpose while retaining the current SDF path whenever the NAADF shader backend is unavailable.
  * **Preview/filter compute bodies**: First-hit preview, minimal preview GI, temporal accumulation, spatial resampling, denoise, reference path-trace, and preview composite shaders now have dispatchable compute entry points instead of helper-only bodies. Temporal accumulation keeps color plus luminance moments, reprojects history from the first-hit depth buffer, rejects stale history outside the variance envelope, and resets when history dimensions or generations change; denoise uses low/medium/high multi-pass depth/normal-aware presets to preserve voxel edges and is available as an opt-in preview toggle. First-hit misses now carry fog-tinted sky RGB through the preview filters, with a default-off debug composite toggle for rendering the NAADF miss sky.
  * **Render graph preview node**: NAADF preview mode now registers a Core3d render graph view node that loads NAADF shaders, creates compute/render pipelines, extracts preview activation/fog state into the render world, dispatches GPU build stages, renders a shaded first-hit preview texture through a GPU chunk lookup table, applies preview fog, runs a conservative GI estimate, filters/denoises from first-hit color/depth/normal textures, optionally runs a debug reference path-trace pass, accumulates against per-view temporal history, records per-pass dispatch counters, and alpha-composites hits over the current view.
  * **Preview configuration and diagnostics**: [assets/config/naadf.yaml](assets/config/naadf.yaml) and the debug UI now expose NAADF GPU/debug flags plus preview ray-step, bounce, GI strength, accumulation/blend, opt-in denoise quality, spatial filter radius/sigma, reference path-trace sample count/strength, miss-sky compositing, composite mode, and history-resolution settings while keeping NAADF default-off. The history-resolution setting can scale the NAADF preview/filter/history render targets; fullscreen composite maps that scaled preview back over the full scene. The debug UI also reports last-frame preview pass dispatch counts and chunk-bound propagation diagnostics for updates, unknown-neighbor stops, saturated fields, and pass count.
  * **GPU chunk lookup table**: Uploaded chunk slots now publish a sorted `(x, y, z, slot)` lookup buffer. The preview shader walks chunk-space along each ray and binary-searches that table instead of brute-force scanning every valid chunk record.
  * **Persistent preview history**: The preview graph keeps per-view ping-pong `rgba16float` color history and `rg16float` moments history in the render world, resetting them when preview history generation or viewport size changes.
  * **HUD/backend fallback polish**: NAADF runtime selection now reports clearer fallback reasons when the feature is not compiled or the runtime needs to be restarted with NAADF enabled.

  Remaining NAADF gaps are still documented rather than hidden: GPU chunk-bound propagation is conservative bounded-slab validation rather than the full upstream queue solver, temporal filtering still lacks per-object motion vectors and production TAA tuning, GI/reference tracing are preview/debug approximations rather than full upstream path tracing, and benchmark visual validation remains future work.

* **Gameplay & Collider Bench Validation**: Added a collider-walk bench path that drives the player through spawn-adjacent routes, a historical fall-through route, and a dig-crust checkpoint that removes terrain below the player and verifies the hard crust rejects below-floor/bedrock edits. It logs coordinates, validity, collider readiness, stall events, fall-through events, and dig/crust rejection counters. The bench now turns at world borders and uses terrain height/collider readiness checks to steer around missing ground or blocking terrain, making spawn and movement regressions reproducible in v0.5.
* **Shadow Budget System** (`rendering/shadow_budget.rs`): New distance-based shadow culling for terrain chunks — chunks beyond 192m get `NotShadowCaster` added (with 16m hysteresis). Point light shadow budget limits concurrent shadow-casting lights to the 4 closest within 80m. Water meshes permanently marked `NotShadowCaster` (translucent surfaces shouldn't cast opaque shadows). Shadow stats shown in F3 debug overlay.

  * **Cascade Shadow Tightening**: Directional light cascade max distance reduced from 1024m to 256m — 4× better shadow texel density at the same 4096² resolution. Integrated GPUs get further reduction (2 cascades, 96m range).
  * **Grass Distance Culling**: New distance-aware grass system — grass patches cull entirely beyond 128m, density reduces at 64–96m, with hysteresis to prevent pop-in. A periodic `cull_distant_grass` system despawns patches on chunks the player moves away from, reclaiming draw calls.
  * **Water Reflection Optimization**: Reflection camera now renders every 2nd frame (temporal amortization). Resolution reduced from 0.5× to 0.35× (672×378). Render distance tightened from 200m to 150m. Reflections are inherently distorted so the quality impact is minimal.
  * **Water Displacement Throttle**: CPU wave simulation (`256×256` grid) now runs every 2nd frame instead of every frame. Adds a "settled" check that skips simulation entirely when no active impulses and all energy has damped below threshold — saves ~0.15ms/frame when idle.
  * **Screen-Space God Rays** (`rendering/god_rays.rs`): New post-process render graph node performs GPU Gems 3-style radial blur toward the sun's screen-space position, producing volumetric light shafts independently of Bevy's built-in `VolumetricFog`. Sky pixels contribute fully; geometry above a luminance threshold creates shafts. Configurable via `fog.yaml` (intensity, decay, density, samples). Fixes the v0.4 issue where god rays only appeared when volumetric fog was active.
  * **Volumetric Fog / God Rays**: Default step counts halved from 64 to 32 for both volumetric fog raymarching and screen-space god ray radial blur samples. Barely visible quality difference outdoors.
  * **Volumetric Cloud Optimization**: Primary raymarching steps reduced from 64 to 32, render scale from 0.5× to 0.25× (quarter resolution). Temporal reprojection compensates for the lower sample count.
  * **Prop LOD Improvements**: Material LOD now enabled by default (distant props skip PBR normal maps). Shadow cull distance tightened from 80m to 64m. Base view distance reduced from 350m to 280m. Billboard switch distance tightened from 250m to 180m. Flower visibility multiplier reduced (0.35→0.25).
  * **Terrain Cull Distance**: High-detail distance reduced from 160m to 128m (aligned with shadow cull). Overall cull distance tightened from 400m to 320m (fog hides terrain beyond ~220m).
* **New Editor**: Initial Draft of the editor, most functioanlity is Mock

  * **Embedded Bevy view with Debug Bridge**
    ![Editor 1 - Preview](docs/images/editor1.jpg)
  * **Initial Wireframe view**
    ![Editor 1 - Preview](docs/images/editor2.jpg)

### v0.4

* **Bevy 0.18 Rendering Stack**: HDR pipeline with tonemapping, bloom, debanding, and color grading on the main camera.
* **Radiance Cascades GI**: Screen-space global illumination using voxel SDF data for efficient ray marching, providing realistic indirect lighting with multi-cascade probe system and temporal reprojection.
* **Adaptive GI Enhancements**: Stochastic one-from-eight probe selection (~8x GI performance gain at Low quality), SDF-based terrain shadows leveraging voxel data, and screen-screen contact shadows for vegetation micro-detail. Quality presets (Low/Medium/High/Ultra) with ~15% performance range. Toggle with Alt+1/2/3/4, debug with Alt+P.
* **Aerial Perspective**: Custom shaders (buildings, props, grass) now blend toward fog color at distance, matching terrain fog behavior for consistent atmospheric depth.
* **Environment Map Lighting**: Skybox-based IBL (Image-Based Lighting) for improved PBR reflections and ambient lighting that tracks time-of-day.
* **Ambient + Atmospheric Effects**: GTAO (Ground Truth Ambient Occlusion via XeGTAO port), PCSS soft shadows, distance + volumetric fog with atmospheric falloff, and time-of-day color blending.
* **Volumetric Clouds**: Raymarched volumetric clouds with temporal reprojection, Henyey-Greenstein scattering, and configurable cloud types (stratus/stratocumulus/cumulus).
* **Enhanced Water** *(superseded by v0.5 water overhaul)*: Initial Gerstner wave simulation with foam generation and caustic effects.
* **Weather Particles**: GPU-accelerated weather system (rain/snow/dust) via bevy_hanabi with camera-following emitters.
* **Vegetation Wind**: Multi-layer wind animation for vegetation (trunk sway, branch movement, leaf flutter) with configurable presets. Enhanced grass shader with SSS (subsurface scattering) and contact shadows for realistic foliage rendering.
* **Wind + Foliage Notes**: Detailed write-up on segmented tree bending, UV-based leaf flutter, and depth pre-pass optimization for alpha-cutout foliage in [docs/wind-foliage-depth-prepass.md](docs/wind-foliage-depth-prepass.md).
* **Vegetation Alpha Fade**: Grass-like props fade to a configurable minimum alpha near the camera to keep visibility through dense foliage. Tuned in the Shift+F4 settings.
* **Shadow + LOD Alignment**: Cascade shadows tuned to fog visibility and chunk LOD cull distances to avoid dark banding.
* **Texture Quality**: Texture arrays with mipmaps and anisotropic filtering for terrain, plus expanded PBR materials for buildings/props.
* **Chunk LOD System**: High/low/culled LODs with skirts for seam hiding and integrated GPU fallbacks.
* **Prop LOD System**: Multi-level LOD for props with billboard and mesh decimation support:
  * **Billboard LOD**: Distant trees rendered as axial (Y-axis rotation) billboards for ~95% vertex reduction. Distance-based switching with hysteresis to prevent flickering.
  * **Mesh Decimation**: Vertex clustering algorithm creates LOD1 (50%) and LOD2 (75%) decimated mesh variants at load time for mid-distance props.
  * **Extended View Distance**: Props now visible up to 350-420 units (trees furthest) to reduce pop-in.
* **Snap Point Building System**: Enshrouded-style modular construction with automatic piece alignment:
  * **Snap Point Detection**: Spatial hash index for O(1) queries finds compatible connection points within 0.75m radius.
  * **Snap Groups**: Compatibility rules (FloorEdge↔WallBottom, WallSide↔WallSide, etc.) ensure pieces connect logically.
  * **Ghost Preview**: Color-coded placement preview (green=valid, red=invalid, blue=snapped) with gizmo visualization.
  * **Piece Registry**: Extensible registry with predefined pieces (floors, walls, fences, pillars) and configurable snap points.
  * **Snap Toggle**: Press X to toggle snap mode on/off for free placement when needed.
* **Meshing Settings**: Greedy meshing toggle in Settings > Meshing (runtime flag; algorithm integration pending).
* **Config-Driven Tuning**: YAML configs for fog, AO, terrain generation, props, camera exposure, clouds, water, wind, weather, and GI.
* **World + Tools**: Save/load persistence, minimap, and debug overlays.
* **Enhanced Terrain Tools**: Gradual sculpting (Raise/Lower/Level/Smooth) with brush size/strength controls and visual preview cursor. Toggled via T key with dedicated hotbar UI.
* **UI + Modes**: Settings menu (graphics/meshing/gameplay/atmosphere/fog/visual), map overlay, inventory/hotbar, chat overlay, and photo mode (DoF/motion blur).
* **Prop Persistence System**: Calculate-once, persist-forever prop placement with multi-sample terrain analysis, slope-based rotation, and chunk-based JSON storage. Props are precisely placed using 5-point sampling for accurate ground contact, then saved to `saves/props/` for instant loading on subsequent runs. Supports dirty chunk regeneration when terrain is modified.

Examples of volumetric fog in this version (toggle with Alt+L; parameters are tunable in the Settings > Fog menu):

![V0.4 Volumetric Fog 1](docs/images/V0.4-rays1.jpg)
![V0.4 Volumetric Fog 2](docs/images/V0.4-rays2.jpg)

Debug overlay examples (toggle with F3; sub-toggles are listed in the Debug tab):

![V0.4 Debug Overlay 1](docs/images/v0.4-debug1.jpg)
![V0.4 Debug Overlay 2](docs/images/v0.4-debug2.jpg)

Minimap example (toggle with M):

![V0.4 Minimap](docs/images/v0.4-minimap.jpg)

Terraforming tools in action (toggle with T):

* **Terrain Conform**: Props like buildings now automatically flatten the terrain beneath them for seamless integration.
* **Sculpting**: Improved brush controls for raising, lowering, leveling, and smoothing terrain.

![V0.4 Terraforming](docs/images/V0.4-terraforming1.jpg)

New Atlas Texture Mapping UI (Settings > Textures):

* **Live Editing**: Reassign block face mappings (Top/Side/Bottom) in real-time.
* **3D Preview**: Visualize changes instantly on a rotating 3D block preview.
* **Visual Picker**: Select atlas tiles directly from a visual grid instead of guessing indices.

![V0.4 Texture Mapping](docs/images/V0.4-textureMapping.jpg)

Props and vegetation with LOD optimizations:

![V0.4 Props and Vegetation](docs/images/v0.4-props1.jpg)

#### Known Issues (v0.4)

* **Volumetric Fog Performance**: Volumetric fog can cause significant frame drops, especially on mid-tier GPUs.
* **God Rays With fog**: ~~Fixed in v0.5~~ — screen-space god rays now work independently of volumetric fog.
* **Mesh gaps**: Small gaps happening sometimes.
* **Culling on close distance**: When digging and there are close distance polygons, culling and visibility has issues.
* **Shallow water**: Shore foam, edge coloring, and caustics improved in v0.5.
* **LODS**: Small gaps and errors can be seen far away in the LODs.

### V0.3

* **PBR Materials & Parallax Mapping**: Implemented PBR material blending and parallax occlusion mapping, specifically enhancing rock textures.
* **Texture Splatting**: Added smooth triplanar material blending (texture splatting) using vertex weights for seamless terrain transitions.
* **Surface Nets Improvements**: Addressed chunk seams and fixed UV mapping/repeat samplers for surface nets.
* **Material & Mesh Updates**: Ongoing updates to materials and mesh generation.
* **Smooth Slope Movement**: Enhanced character controller with bilinear terrain height detection and step-up logic for fluid movement over terrain.

![V0.3 Preview](docs/images/V0.3.jpg)

### V0.2

* **Procedural Generation**: Added procedural grass mesh patches.
* **Terrain & Environment**: Adjusted terrain balance by reducing sand beach areas; tweaked lighting and reintroduced water rendering.
* **Assets**: Integrated new texture assets (PNG files).
* **Rendering**: Improved visual fidelity with lighting adjustments.

![V0.2 Preview](docs/images/V0.2.jpg)

### V0.1

* **Core Systems**: Initial implementation work.
* **Chunk Rendering**: Fixed visibility issues with chunk boundary faces.
* **Modesty Fix**: Adjustments for content appropriateness for tilable terrain.

![V0.1 Preview](docs/images/V0.1.jpg)

