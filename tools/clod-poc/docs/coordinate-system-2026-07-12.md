# clod-poc coordinate system

Created: 2026-07-12

This document describes the coordinate conventions used by `tools/clod-poc`. It is a runtime
reference for terrain, streaming, vegetation, materials, camera tooling, and far-field renderers.

## Axes and units

The renderer uses the Three.js right-handed, Y-up convention:

- `X`: horizontal east/west axis.
- `Y`: elevation.
- `Z`: horizontal north/south axis.
- Runtime distances, radii, heights, and camera positions are expressed in world metres unless a
  field explicitly says pages, cells, texels, or pixels.

Terrain code commonly uses `worldCells` as the horizontal world size. A page contains
`chunks_per_page * chunk_size` cells. Do not treat page indices, cell coordinates, and world metres
as interchangeable without applying that page/cell span.

## Coordinate spaces

### Logical world space

Logical world coordinates identify a stable terrain location. Procedural terrain sampling,
streaming keys, hydrology, terrain materials, biome data, vegetation placement, and far summaries
must use this space.

With floating origin disabled, logical world coordinates and Three.js render coordinates normally
have the same numeric values.

### Render space

Render coordinates are the positions submitted to Three.js and the GPU. They remain equal to
logical world coordinates until floating-origin rebasing is enabled and a rebase occurs.

After a rebase:

```text
render XZ = logical world XZ - floating-origin offset XZ
logical world XZ = render XZ + floating-origin offset XZ
```

The offset is horizontal; Y remains elevation. Systems that sample procedural terrain must use
logical world coordinates even when their meshes are positioned in render space.

### Page, cell, and mesh-local space

- Page coordinates such as `(px, pz)` identify CLOD page footprints.
- Cell coordinates identify samples inside the terrain field.
- Mesh-local coordinates are relative to an object or page transform.
- A page applied at the wrong origin can be locally valid but appear in the wrong world region.

Convert to logical world space before comparing pages with a camera, player, vegetation ring, far
renderer, or hydrology sample.

### Texture and atlas space

Terrain albedo and normal textures use world-position projection. Triplanar sampling projects the
logical/render-equivalent world position onto the `XY`, `XZ`, and `ZY` planes and multiplies it by
the resolved texture scale.

The texture scale is UV repeats per world metre:

```text
resolved scale = slot scale * scale multiplier
repeat period in metres = 1 / resolved scale
```

The scale multiplier changes texture frequency; it does not resize the terrain or change the
camera/streaming coordinate system.

Terrain material height bands use absolute world Y. They are not relative to the player, page,
island base, or camera. If a surface remains inside one height interval, it correctly continues to
use that material. Blend height widens or narrows the transition around those absolute Y limits.

## Configured world and startup world

These values describe different things:

- `configuredWorldPages`: intended configured domain size.
- `startupWorldPages`: page window built during startup.
- `configuredWorldCells`: configured pages multiplied by cells per page.
- `startupWorldCells`: startup pages multiplied by cells per page.

In an infinite-islands scene, the startup box is bootstrap data, not the limit of the procedural
world. Live terrain, streamed CLOD roots, vegetation rings, summaries, and far renderers must follow
the canonical center outside that box.

`startupWorld` and `infiniteStartupWorld` accept only values present in
`src/app/config/clod_runtime.yaml`. The current options are `2`, `4`, `8`, `16`, and `32`. A value
such as `48` is not a valid request and falls back according to startup policy.

## Canonical world center

`src/app/frame_loop/terrain_frame_phase.ts` chooses one canonical center per frame:

| Runtime state | Canonical center |
| --- | --- |
| Player mode | Player position |
| Infinite-islands orbit mode, player spawned | Spawned player position |
| Infinite-islands orbit mode, player not spawned | Camera position |
| Other orbit scenes | Orbit-controls target |

The near-field bubble uses this center. The vegetation grass center is the same value.

For infinite islands, the vegetation ring is unbounded and copies that center without clamping. In
finite worlds, the vegetation ring is clamped inside the finite world margin.

Systems may snap the canonical center to a grid for cache stability. A snapped center is correct
when it stays within one documented snap interval of the canonical center. It is not correct for a
system to remain at the startup origin after the view moves.

## System ownership and expected centers

| System | Coordinate responsibility |
| --- | --- |
| Camera | Render-space view; world-space proxy is required after rebasing |
| Player | Canonical center in play mode |
| Near-field bubble | Canonical logical world center |
| CLOD streaming and selection | Same world region as the near-field bubble |
| Grass, trees, understory, stones | Canonical vegetation-ring center |
| Hydrology atlas | Logical world window centered around the active ring/view |
| Far summary | Logical world center, optionally snapped |
| Far clipmap | Logical world sampling center plus its documented grid snap |
| Infinite far shell | Logical world sampling center; render transform subtracts floating-origin offset |
| Terrain textures | World-position projection and absolute world-Y material bands |

The far shell is a separate renderer from near CLOD terrain. It uses macro/horizon material data and
is not expected to reproduce close-range external PBR image detail. During a sliced far-shell
rebuild, the old shell can remain visible until the new center is committed; use readiness and
center counters before treating that frame as converged.

## Camera and URL coordinates

The deterministic shot harness represents a camera pose as:

```text
cam=x,y,z,yaw,pitch,fov
```

The runtime automation hook uses the equivalent object:

```ts
{ p: [x, y, z], yaw, pitch, fov? }
```

`setPose()` sets the camera and derives the orbit target from the camera forward direction. Query
parameters `x`, `z`, and `yaw` are also used by startup/player paths; a requested player spawn can be
adjusted to nearby valid dry terrain. For reproducible camera-only captures, prefer the full `cam`
pose or `window.__drusnielClod.setPose()`.

## Floating origin

Floating origin is gated and off by default. It becomes effective only when requested by URL and the
active world source is unbounded.

On rebase, the controller shifts scene objects, camera, orbit target, player state, and collider
footprints in render space while accumulating the logical world offset. World samplers must add the
offset back or use the provided world-camera proxy.

Relevant counters:

- `floatingOriginEnabled`
- `floatingOriginRebaseCount`
- `floatingOriginLastRebaseFrame`
- `floatingOriginOffsetX`
- `floatingOriginOffsetZ`

## Diagnosing coordinate disagreement

Use deterministic poses and inspect counters rather than inferring alignment from a screenshot.
The most useful counters are:

- `canonical_world_center_x` / `canonical_world_center_z`
- `canonical_world_center_source`
- `canonical_world_camera_x` / `canonical_world_camera_z`
- `canonical_world_player_x` / `canonical_world_player_z`
- `vegetation_ring_center_x` / `vegetation_ring_center_z`
- `vegetation_grass_center_x` / `vegetation_grass_center_z`
- `camera_to_vegetation_ring_center_m`
- `camera_to_clod_center_m`
- `camera_to_far_shell_center_m`
- `camera_to_water_ocean_center_m`
- `far_clipmap_center_x` / `far_clipmap_center_z`
- `far_clipmap_snap_error_max_m`
- `live_clod_stream_bounds_guard_rejected_pages`

Interpretation examples:

- Camera-to-CLOD near zero but camera-to-vegetation large: vegetation uses the wrong center.
- Camera-to-near systems near zero but camera-to-far-shell large: far shell is stale, rebuilding, or
  using the wrong origin.
- Correct center with page bounds rejection: page/local-to-world conversion is wrong.
- Correct centers with flat close terrain: inspect material source, texture scale, height bands, and
  readiness; it is not automatically a coordinate fault.
- GPU vegetation tier counts all zero with readbacks disabled: telemetry is unavailable, not proof
  that placement coordinates or rendering are disabled.

## Source map

- `src/app/frame_loop/terrain_frame_phase.ts`: canonical center and vegetation ring center.
- `src/app/world_mode.ts`: configured/startup world description and far ownership.
- `src/app/bootstrap/world_build_startup.ts`: startup-world query resolution.
- `src/app/bootstrap/diagnostics_startup.ts`: deterministic camera pose hooks.
- `src/app/bootstrap/clod_poc_bootstrap.ts`: floating-origin and far-summary/far-shell wiring.
- `src/precision/floating_origin.ts`: render/world offset controller.
- `src/gpu/terrain_node_material.ts`: WebGPU world-position texture projection and height bands.
- `src/grass/grass_gpu_ring_runtime.ts`: vegetation center passed to GPU placement.
- `src/long-view/infiniteFarShell.ts`: far-shell world center and render transform.

When these semantics change, create a new dated coordinate document rather than hiding the age by
renaming this file. Keep older dated documents as historical evidence unless they are explicitly
being removed as obsolete.
