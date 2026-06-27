# CLOD-POC Border Ocean

The border ocean is a render-only deep sea outside the playable CLOD-POC world. It hides the rectangular world limit and gives the player a believable coast-to-deep-water horizon without expanding the editable terrain simulation.

## Ownership

The playable world remains owned by terrain, hydrology, vegetation, props, colliders, and the CLOD page cache. Border ocean code must not feed data back into any of those systems.

The dependency direction is one way:

```text
terrain/world bounds -> coast shaping -> water visuals -> deep ocean render ring
```

Forbidden dependency direction:

```text
deep ocean -> terrain pages
```

## Zones

The world edge uses three visual zones.

1. **Playable terrain and inland water**
   - Uses normal terrain, hydrology, fake-body water, collision, vegetation, and gameplay systems.
   - Player movement stays inside this world.

2. **Coast and transition gap**
   - Uses border coast shaping, surf, cliffs, beach material, fog, and foam.
   - This area hides the hard world edge.
   - Deep ocean mesh and sampler must not occupy this gap.

3. **Deep ocean ring**
   - Render-only mesh outside the transition gap.
   - Uses configured wind waves, choppiness, deep colors, Fresnel, foam, reflection approximation, and fog.
   - May become a future boat-gameplay seam, but currently has no terrain or collider ownership.

## Runtime contract

The deep ocean must follow these rules:

- Do not create terrain chunks.
- Do not create CLOD pages.
- Do not create terrain colliders.
- Do not mark water as editable voxels.
- Do not feed water surfaces into the CLOD page source mesh.
- Do not spawn inside the configured transition gap.
- Do not rely on hardcoded wave constants.
- Do not require WebGPU-only features for the basic render path.

The hard player clamp remains the final safety rail. Soft pushback may guide the player away from the edge, but it must not replace the clamp.

## Config source of truth

`tools/clod-poc/config/border_coast_ocean.yaml` owns the tunable border-ocean values.

Important fields:

```yaml
deep_ocean:
  start_outside_border_m: 64
  visual_extent_m: 4096
  far_subdivisions: 64

  wave:
    wind_speed: 14
    wind_direction_deg: 45
    height_scale: 1.3
    choppiness: 1.6
    coarse_patch_m: 250
    fine_patch_m: 37

  shading:
    deep_color: "#042c4e"
    shallow_color: "#0a5c5a"
    fog_far_m: 1800
    reflection_strength: 0.46

gameplay:
  soft_pushback_enabled: true
  world_edge_margin_m: 16
  pushback_start_inside_world_m: 48
  pushback_strength: 36
```

The strict parser and runtime parser must stay aligned. Tests should fail if one parser accepts or maps fields differently from the other.

## Mesh and sampler contract

The deep-ocean mesh is a ring around the world. Its inner hole is larger than the playable square by `start_outside_border_m`, which leaves room for coast and surf transition visuals.

The sampler follows the same rule:

```text
inside playable square: false
inside transition gap: false
inside deep ocean ring: true
outside visual extent: false
```

This prevents future boat or current code from accidentally treating the transition gap as open ocean.

## Material contract

Both render paths should respect the same resolved visual configuration.

- WebGL shader material receives explicit deep-ocean material params.
- WebGPU node material receives the shared resolved visual config.
- Wave constants are generated from YAML before material creation.
- Fog distance must come from deep-ocean shading config, not generic lake ripple defaults.
- The node material must stay transparent through the configured transition gap and only fade in after that gap.

The node material currently derives fog distance from `visual.rippleLoopDistance * 4`. The shared deep-ocean visual resolver maps `fogFarM / 4` into `rippleLoopDistance` to preserve parity without duplicating node material logic.

## Gameplay contract

Border-ocean gameplay settings only configure the player boundary behavior. They do not make the deep-ocean ring playable terrain.

- `soft_pushback_enabled` may guide the player away from the edge.
- `world_edge_margin_m` keeps the hard clamp inside the simulation and must stay greater than zero.
- `pushback_start_inside_world_m` controls the soft pushback band and must be greater than zero when soft pushback is enabled.
- `pushback_strength` controls the inward acceleration and must be greater than zero when soft pushback is enabled.

If soft pushback is disabled, the hard clamp remains active and the pushback band/acceleration resolve to zero.

## Acceptance counters

The border-ocean acceptance scene must publish at least:

```text
border_ocean.scene
border_ocean.coast_runtime_active
border_ocean.deep_ocean_enabled
border_ocean.deep_ocean_mesh_present
border_ocean.deep_ocean_vertices
border_ocean.deep_ocean_triangles
border_ocean.deep_ocean_draw_calls
border_ocean.deep_ocean_start_outside_m
border_ocean.deep_ocean_extend_m
border_ocean.deep_ocean_surface_y
border_ocean.deep_ocean_transition_gap_vertices
border_ocean.wave_count
border_ocean.wave_wind_speed
border_ocean.wave_height_scale
border_ocean.wave_choppiness
border_ocean.shading_fog_far_m
border_ocean.shading_reflection_strength
border_ocean.player_margin_m
border_ocean.player_pushback_band_m
border_ocean.player_pushback_accel
border_ocean.player_soft_pushback_enabled
border_ocean.frame_ms_p95
border_ocean.page_source_purity
border_ocean.interior_water_wet_ratio
border_ocean.playable_ocean_outside_ok
border_ocean.cliff_dry_above_sea
```

## Visual regression

Run the default WebGL visual gate:

```bash
npm run border-ocean:visual
```

Run the optional WebGPU parity check when the machine supports WebGPU in Chromium:

```bash
BORDER_OCEAN_VISUAL_WEBGPU=1 npm run border-ocean:visual
```

Make WebGPU parity mandatory on a GPU-capable machine:

```bash
BORDER_OCEAN_VISUAL_WEBGPU=1 BORDER_OCEAN_REQUIRE_WEBGPU=1 npm run border-ocean:visual
```

The visual runner captures noon, sunset, storm/fog, and cheap-mode WebGL scenes, validates the stats payload, and optionally compares WebGL against WebGPU with thresholds from `config/border_ocean_scene.yaml`.

## QA checklist

Before changing the border ocean, verify:

- The player cannot leave the playable simulation.
- Soft pushback values come from `border_coast_ocean.yaml`.
- Disabling soft pushback still keeps the hard clamp active.
- Enabled soft pushback has a positive band and acceleration.
- The deep-ocean sampler is false inside the playable square.
- The deep-ocean sampler is false inside the transition gap.
- The deep-ocean mesh has zero vertices inside the transition gap.
- Config changes affect generated waves.
- Strict and runtime config parsers stay aligned.
- WebGL and WebGPU use the same resolved visual values.
- The border-ocean acceptance scene still passes.
- The visual regression command still passes.

## Future work

TODO: add boat-specific gameplay ownership before allowing travel into the deep ocean ring.
