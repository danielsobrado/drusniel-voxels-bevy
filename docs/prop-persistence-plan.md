# Prop Persistence & Precision Placement System

## Executive Summary

This document outlines a comprehensive plan to replace the current procedural prop spawning system with a **persist-first architecture** that calculates precise, physics-based prop placements once and stores them permanently. This eliminates floating objects by using gravity simulation, collision detection, and pixel-wise terrain analysis for accurate initial placement.

---

## Problem Statement

Current issues with prop placement:
1. **Floating objects**: Grass, rocks, and other props hover above terrain
2. **Imprecise positioning**: Current bilinear interpolation and y_offset heuristics don't match actual terrain geometry
3. **No persistence**: Props regenerate every load, wasting computation on identical results
4. **No slope adaptation**: Objects don't align with terrain angles properly
5. **Terraforming breaks props**: Editing terrain invalidates prop positions with no update mechanism

---

## Proposed Solution

### Core Concept: Calculate Once, Persist Forever

```
First Run                          Subsequent Runs
    |                                    |
    v                                    v
[Config YAML]                    [Load props.json]
    |                                    |
    v                                    |
[Generate Candidates]                    |
    |                                    |
    v                                    |
[Physics Simulation]                     |
  - Gravity drop                         |
  - Collision detection                  |
  - Slope alignment                      |
  - Terrain type validation              |
    |                                    |
    v                                    v
[Persist to JSON] -----------------> [Spawn Entities]
```

---

## Technical Architecture

### 1. Persistence Format (JSON Schema)

```json
{
  "version": "1.0",
  "world_seed": 12345,
  "generated_at": "2026-01-18T10:30:00Z",
  "chunks": {
    "0,0,0": {
      "props": [
        {
          "id": "grass_tuft_01",
          "prop_type": "Bush",
          "position": [128.45, 32.127, 256.89],
          "rotation": [0.0, 45.5, -3.2],
          "scale": [0.95, 1.0, 0.95],
          "ground_contact": {
            "terrain_type": "TopSoil",
            "texture_blend": {
              "grass": 0.8,
              "dirt": 0.2
            },
            "slope_angle": 12.5,
            "normal": [0.05, 0.98, 0.02]
          },
          "placement_seed": 847293,
          "validated": true
        }
      ]
    }
  },
  "metadata": {
    "total_props": 145770,
    "placement_time_ms": 45000,
    "validation_errors": 0
  }
}
```

### 2. File Organization

```
saves/
  world_data.bin          # Existing voxel persistence
  props/
    props_manifest.json   # Index of all chunk prop files
    chunks/
      chunk_0_0.json      # Props for chunk at (0,0)
      chunk_0_1.json
      chunk_1_0.json
      ...
```

**Rationale**: Chunk-based files enable:
- Incremental loading/saving
- Parallel processing
- Partial updates (only dirty chunks)
- Manageable file sizes

### 3. New Module Structure

```
src/props/
  mod.rs                  # Existing (add new module exports)
  config.rs               # Extract config loading (from loader.rs)
  loader.rs               # Asset loading only
  spawner.rs              # Simplified: load-from-json or trigger generation
  placement/
    mod.rs                # Placement orchestration
    physics.rs            # Gravity simulation & collision
    terrain_analysis.rs   # Slope, normal, texture sampling
    validation.rs         # Post-placement validation
  persistence/
    mod.rs                # Save/load coordination
    schema.rs             # Rust structs matching JSON schema
    serializer.rs         # JSON serialization with serde
    migration.rs          # Version migration support
  editor/
    mod.rs                # Edit mode integration
    commands.rs           # Persist shortcuts/menu
```

---

## Phase 1: Core Persistence Infrastructure

### 1.1 Data Structures (Rust)

```rust
// src/props/persistence/schema.rs

use serde::{Deserialize, Serialize};
use bevy::prelude::*;

#[derive(Serialize, Deserialize, Clone)]
pub struct PropPlacementData {
    pub id: String,
    pub prop_type: PropType,
    pub position: Vec3,
    pub rotation: Vec3,        // Euler angles (degrees)
    pub scale: Vec3,
    pub ground_contact: GroundContactData,
    pub placement_seed: u64,
    pub validated: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GroundContactData {
    pub terrain_type: VoxelType,
    pub texture_blend: HashMap<String, f32>,
    pub slope_angle: f32,      // Degrees
    pub normal: Vec3,          // Surface normal
}

#[derive(Serialize, Deserialize)]
pub struct ChunkPropData {
    pub chunk_pos: IVec3,
    pub props: Vec<PropPlacementData>,
    pub last_modified: DateTime<Utc>,
    pub dirty: bool,
}

#[derive(Serialize, Deserialize)]
pub struct PropManifest {
    pub version: String,
    pub world_seed: u64,
    pub generated_at: DateTime<Utc>,
    pub chunk_files: HashMap<String, ChunkManifestEntry>,
    pub metadata: PropMetadata,
}

#[derive(Serialize, Deserialize)]
pub struct ChunkManifestEntry {
    pub file_path: String,
    pub prop_count: usize,
    pub hash: String,          // For change detection
}
```

### 1.2 Save/Load System

```rust
// src/props/persistence/serializer.rs

pub fn save_chunk_props(
    chunk_pos: IVec3,
    props: &[PropPlacementData],
) -> Result<(), PropPersistenceError> {
    let path = chunk_file_path(chunk_pos);
    let data = ChunkPropData {
        chunk_pos,
        props: props.to_vec(),
        last_modified: Utc::now(),
        dirty: false,
    };

    let json = serde_json::to_string_pretty(&data)?;
    std::fs::write(path, json)?;
    Ok(())
}

pub fn load_chunk_props(
    chunk_pos: IVec3,
) -> Result<Option<ChunkPropData>, PropPersistenceError> {
    let path = chunk_file_path(chunk_pos);
    if !path.exists() {
        return Ok(None);
    }

    let json = std::fs::read_to_string(path)?;
    let data: ChunkPropData = serde_json::from_str(&json)?;
    Ok(Some(data))
}

pub fn load_or_generate_props(
    chunk_pos: IVec3,
    world: &VoxelWorld,
    config: &PropConfig,
) -> Vec<PropPlacementData> {
    match load_chunk_props(chunk_pos) {
        Ok(Some(data)) => data.props,
        _ => {
            let props = generate_chunk_props(chunk_pos, world, config);
            save_chunk_props(chunk_pos, &props).ok();
            props
        }
    }
}
```

### 1.3 Bevy Integration

```rust
// src/props/spawner.rs (modified)

#[derive(Resource)]
pub struct PropPersistenceState {
    pub manifest: Option<PropManifest>,
    pub dirty_chunks: HashSet<IVec3>,
    pub loaded_chunks: HashMap<IVec3, Vec<Entity>>,
}

pub fn spawn_props_system(
    mut commands: Commands,
    world: Res<VoxelWorld>,
    config: Res<PropConfig>,
    assets: Res<PropAssets>,
    mut state: ResMut<PropPersistenceState>,
) {
    if !assets.loaded {
        return;
    }

    // Load manifest or create new
    let manifest = state.manifest.get_or_insert_with(|| {
        load_manifest().unwrap_or_else(|_| PropManifest::new())
    });

    // For each visible chunk
    for chunk_pos in visible_chunks() {
        if state.loaded_chunks.contains_key(&chunk_pos) {
            continue;
        }

        let props = load_or_generate_props(chunk_pos, &world, &config);
        let entities = spawn_props_from_data(&mut commands, &props, &assets);
        state.loaded_chunks.insert(chunk_pos, entities);
    }
}
```

---

## Phase 2: Physics-Based Precision Placement

### 2.1 Gravity Simulation

```rust
// src/props/placement/physics.rs

pub struct PlacementSimulation {
    pub max_drop_distance: f32,
    pub collision_margin: f32,
    pub gravity_steps: u32,
    pub step_size: f32,
}

impl PlacementSimulation {
    pub fn simulate_drop(
        &self,
        start_pos: Vec3,
        prop_bounds: Aabb,
        world: &VoxelWorld,
    ) -> Option<PlacementResult> {
        let mut pos = start_pos;
        let mut velocity = Vec3::ZERO;

        for step in 0..self.gravity_steps {
            // Apply gravity
            velocity.y -= 9.81 * self.step_size;
            pos += velocity * self.step_size;

            // Check collision with terrain
            if let Some(contact) = self.check_terrain_collision(pos, prop_bounds, world) {
                return Some(PlacementResult {
                    position: contact.position,
                    surface_normal: contact.normal,
                    terrain_type: contact.voxel_type,
                    settled: true,
                });
            }

            // Check if fallen too far
            if pos.y < start_pos.y - self.max_drop_distance {
                return None; // Invalid placement
            }
        }

        None // Didn't settle
    }

    fn check_terrain_collision(
        &self,
        pos: Vec3,
        bounds: Aabb,
        world: &VoxelWorld,
    ) -> Option<TerrainContact> {
        // Sample multiple points at prop base
        let sample_points = self.generate_base_sample_points(pos, bounds);

        for sample in sample_points {
            let voxel_pos = IVec3::new(
                sample.x.floor() as i32,
                sample.y.floor() as i32,
                sample.z.floor() as i32,
            );

            if let Some(voxel) = world.get_voxel(voxel_pos) {
                if voxel.is_solid() {
                    // Calculate precise contact point
                    let normal = self.calculate_surface_normal(voxel_pos, world);
                    return Some(TerrainContact {
                        position: self.calculate_rest_position(pos, normal),
                        normal,
                        voxel_type: voxel,
                    });
                }
            }
        }

        None
    }
}
```

### 2.2 Pixel-Wise Terrain Analysis

```rust
// src/props/placement/terrain_analysis.rs

pub struct TerrainAnalyzer {
    pub sample_resolution: u32,  // Samples per unit
}

impl TerrainAnalyzer {
    /// Sample terrain at sub-voxel precision
    pub fn analyze_position(
        &self,
        world_pos: Vec3,
        world: &VoxelWorld,
    ) -> TerrainAnalysis {
        // High-resolution height sampling
        let heights = self.sample_heights_grid(world_pos, world, 5);

        // Calculate precise surface normal from height gradient
        let normal = self.calculate_normal_from_heights(&heights);

        // Calculate slope angle
        let slope_angle = normal.y.acos().to_degrees();

        // Sample surrounding voxel types for texture blending
        let texture_blend = self.analyze_texture_composition(world_pos, world);

        // Find dominant terrain type
        let terrain_type = self.get_dominant_terrain(world_pos, world);

        TerrainAnalysis {
            normal,
            slope_angle,
            texture_blend,
            terrain_type,
            height: heights[2][2], // Center sample
        }
    }

    fn sample_heights_grid(
        &self,
        center: Vec3,
        world: &VoxelWorld,
        grid_size: usize,
    ) -> Vec<Vec<f32>> {
        let mut heights = vec![vec![0.0; grid_size]; grid_size];
        let half = grid_size as f32 / 2.0;
        let step = 1.0 / self.sample_resolution as f32;

        for (i, row) in heights.iter_mut().enumerate() {
            for (j, height) in row.iter_mut().enumerate() {
                let offset = Vec3::new(
                    (j as f32 - half) * step,
                    0.0,
                    (i as f32 - half) * step,
                );
                *height = self.find_precise_surface_height(center + offset, world);
            }
        }

        heights
    }

    fn find_precise_surface_height(
        &self,
        pos: Vec3,
        world: &VoxelWorld,
    ) -> f32 {
        // Binary search for precise surface
        let mut low = pos.y - 32.0;
        let mut high = pos.y + 32.0;

        while (high - low) > 0.01 {
            let mid = (low + high) / 2.0;
            let voxel_pos = IVec3::new(
                pos.x.floor() as i32,
                mid.floor() as i32,
                pos.z.floor() as i32,
            );

            if world.get_voxel(voxel_pos).map_or(false, |v| v.is_solid()) {
                low = mid;
            } else {
                high = mid;
            }
        }

        high
    }

    fn calculate_normal_from_heights(&self, heights: &[Vec<f32>]) -> Vec3 {
        // Sobel operator for smooth gradient
        let dx = (heights[0][2] - heights[0][0])
               + 2.0 * (heights[1][2] - heights[1][0])
               + (heights[2][2] - heights[2][0]);

        let dz = (heights[2][0] - heights[0][0])
               + 2.0 * (heights[2][1] - heights[0][1])
               + (heights[2][2] - heights[0][2]);

        Vec3::new(-dx, 8.0, -dz).normalize()
    }

    fn analyze_texture_composition(
        &self,
        pos: Vec3,
        world: &VoxelWorld,
    ) -> HashMap<String, f32> {
        let mut composition = HashMap::new();
        let radius = 2;
        let mut total = 0.0;

        for dx in -radius..=radius {
            for dz in -radius..=radius {
                let sample_pos = IVec3::new(
                    pos.x.floor() as i32 + dx,
                    pos.y.floor() as i32,
                    pos.z.floor() as i32 + dz,
                );

                if let Some(voxel) = world.get_voxel(sample_pos) {
                    let weight = 1.0 / (1.0 + (dx.abs() + dz.abs()) as f32);
                    let name = voxel_type_to_string(voxel);
                    *composition.entry(name).or_insert(0.0) += weight;
                    total += weight;
                }
            }
        }

        // Normalize
        for value in composition.values_mut() {
            *value /= total;
        }

        composition
    }
}
```

### 2.3 Slope-Based Rotation

```rust
// src/props/placement/physics.rs (continued)

pub fn calculate_prop_rotation(
    surface_normal: Vec3,
    prop_config: &PropDefinition,
    rng: &mut impl Rng,
) -> Vec3 {
    let mut rotation = Vec3::ZERO;

    // Random Y rotation (yaw)
    rotation.y = rng.gen_range(0.0..360.0);

    // Calculate pitch and roll from surface normal
    if prop_config.align_to_slope {
        // Project normal to XZ plane for roll
        let roll = surface_normal.x.atan2(surface_normal.y).to_degrees();

        // Project normal to YZ plane for pitch
        let pitch = (-surface_normal.z).atan2(surface_normal.y).to_degrees();

        // Apply with configurable strength (0.0 = no alignment, 1.0 = full)
        let strength = prop_config.slope_align_strength.unwrap_or(0.8);
        rotation.x = pitch * strength;
        rotation.z = roll * strength;
    }

    // Add small random tilt for natural variation
    if let Some(tilt_range) = prop_config.random_tilt {
        rotation.x += rng.gen_range(-tilt_range..tilt_range);
        rotation.z += rng.gen_range(-tilt_range..tilt_range);
    }

    rotation
}
```

---

## Phase 3: Spawner Rewrite

### 3.1 New Spawning Pipeline

```rust
// src/props/spawner.rs (rewritten)

pub fn generate_chunk_props(
    chunk_pos: IVec3,
    world: &VoxelWorld,
    config: &PropConfig,
) -> Vec<PropPlacementData> {
    let mut props = Vec::new();
    let simulation = PlacementSimulation::default();
    let analyzer = TerrainAnalyzer::default();

    let chunk_world_min = chunk_pos * CHUNK_SIZE_I32;
    let chunk_world_max = chunk_world_min + IVec3::splat(CHUNK_SIZE_I32);

    // Generate candidates using existing deterministic algorithm
    let candidates = generate_prop_candidates(chunk_pos, config);

    for candidate in candidates {
        // Skip if outside chunk bounds (horizontal)
        let pos_2d = Vec2::new(candidate.position.x, candidate.position.z);
        if !in_chunk_bounds_2d(pos_2d, chunk_pos) {
            continue;
        }

        // Get prop bounds from config
        let prop_def = config.get_prop(&candidate.prop_id);
        let bounds = prop_def.bounds.scaled(candidate.scale);

        // Find initial height estimate
        let start_pos = Vec3::new(
            candidate.position.x,
            find_surface_height_estimate(candidate.position.x, candidate.position.z, world) + 10.0,
            candidate.position.z,
        );

        // Simulate gravity drop
        let Some(placement) = simulation.simulate_drop(start_pos, bounds, world) else {
            continue; // Couldn't place
        };

        // Analyze terrain at contact point
        let analysis = analyzer.analyze_position(placement.position, world);

        // Validate terrain type
        if !prop_def.spawn_on.contains(&analysis.terrain_type) {
            continue;
        }

        // Validate slope
        if analysis.slope_angle < prop_def.min_slope || analysis.slope_angle > prop_def.max_slope {
            continue;
        }

        // Calculate rotation based on terrain
        let mut rng = StdRng::seed_from_u64(candidate.seed);
        let rotation = calculate_prop_rotation(analysis.normal, prop_def, &mut rng);

        // Create placement data
        props.push(PropPlacementData {
            id: candidate.prop_id.clone(),
            prop_type: candidate.prop_type,
            position: placement.position,
            rotation,
            scale: candidate.scale,
            ground_contact: GroundContactData {
                terrain_type: analysis.terrain_type,
                texture_blend: analysis.texture_blend,
                slope_angle: analysis.slope_angle,
                normal: analysis.normal,
            },
            placement_seed: candidate.seed,
            validated: true,
        });
    }

    props
}
```

### 3.2 Entity Spawning from Data

```rust
pub fn spawn_props_from_data(
    commands: &mut Commands,
    props: &[PropPlacementData],
    assets: &PropAssets,
) -> Vec<Entity> {
    props.iter().filter_map(|prop| {
        let scene = assets.scenes.get(&prop.id)?;

        let transform = Transform {
            translation: prop.position,
            rotation: Quat::from_euler(
                EulerRot::XYZ,
                prop.rotation.x.to_radians(),
                prop.rotation.y.to_radians(),
                prop.rotation.z.to_radians(),
            ),
            scale: prop.scale,
        };

        Some(commands.spawn((
            SceneRoot(scene.clone()),
            transform,
            Prop {
                id: prop.id.clone(),
                prop_type: prop.prop_type,
            },
            PersistedProp,  // Marker for persisted props
        )).id())
    }).collect()
}
```

---

## Phase 4: Edit Mode & Terraforming Integration

### 4.1 Dirty Tracking

```rust
// src/props/persistence/mod.rs

#[derive(Resource, Default)]
pub struct PropEditState {
    pub dirty_chunks: HashSet<IVec3>,
    pub modified_props: HashMap<Entity, PropModification>,
    pub deleted_props: Vec<(IVec3, u64)>,  // (chunk, seed)
    pub added_props: Vec<PropPlacementData>,
}

#[derive(Clone)]
pub enum PropModification {
    Moved { old_pos: Vec3, new_pos: Vec3 },
    Rotated { old_rot: Vec3, new_rot: Vec3 },
    Scaled { old_scale: Vec3, new_scale: Vec3 },
    Deleted,
}
```

### 4.2 Terraforming Hook

```rust
// src/voxel/terraforming.rs (add to existing)

pub fn on_terrain_modified(
    modified_chunks: &[IVec3],
    mut prop_state: ResMut<PropEditState>,
) {
    // Mark affected chunks as dirty
    for &chunk_pos in modified_chunks {
        prop_state.dirty_chunks.insert(chunk_pos);

        // Also mark adjacent chunks (props may span boundaries)
        for offset in ADJACENT_OFFSETS {
            prop_state.dirty_chunks.insert(chunk_pos + offset);
        }
    }
}
```

### 4.3 Regeneration System

```rust
pub fn regenerate_dirty_chunk_props(
    mut commands: Commands,
    mut state: ResMut<PropPersistenceState>,
    mut edit_state: ResMut<PropEditState>,
    world: Res<VoxelWorld>,
    config: Res<PropConfig>,
    assets: Res<PropAssets>,
    props_query: Query<(Entity, &Prop, &Transform)>,
) {
    if edit_state.dirty_chunks.is_empty() {
        return;
    }

    let dirty: Vec<IVec3> = edit_state.dirty_chunks.drain().collect();

    for chunk_pos in dirty {
        // Despawn existing props in chunk
        if let Some(entities) = state.loaded_chunks.remove(&chunk_pos) {
            for entity in entities {
                commands.entity(entity).despawn_recursive();
            }
        }

        // Regenerate with physics simulation
        let props = generate_chunk_props(chunk_pos, &world, &config);

        // Save to disk
        save_chunk_props(chunk_pos, &props).ok();

        // Spawn new entities
        let entities = spawn_props_from_data(&mut commands, &props, &assets);
        state.loaded_chunks.insert(chunk_pos, entities);
    }
}
```

### 4.4 Manual Save System

```rust
// src/props/editor/commands.rs

pub fn save_props_hotkey(
    keyboard: Res<ButtonInput<KeyCode>>,
    state: Res<PropPersistenceState>,
    edit_state: Res<PropEditState>,
) {
    // Ctrl+Shift+S to save props
    if keyboard.pressed(KeyCode::ControlLeft)
        && keyboard.pressed(KeyCode::ShiftLeft)
        && keyboard.just_pressed(KeyCode::KeyS)
    {
        save_all_props(&state, &edit_state);
        info!("Props saved to disk");
    }
}

pub fn save_all_props(
    state: &PropPersistenceState,
    edit_state: &PropEditState,
) -> Result<(), PropPersistenceError> {
    // Save manifest
    if let Some(ref manifest) = state.manifest {
        save_manifest(manifest)?;
    }

    // Save any modified chunks
    for (&chunk_pos, props) in &state.chunk_prop_data {
        if edit_state.dirty_chunks.contains(&chunk_pos) {
            save_chunk_props(chunk_pos, props)?;
        }
    }

    Ok(())
}
```

---

## Phase 5: UI Integration

### 5.1 Menu Options

```rust
// src/ui/menu.rs (add to existing)

pub fn props_menu(ui: &mut egui::Ui, world: &mut World) {
    ui.menu_button("Props", |ui| {
        if ui.button("Save All Props (Ctrl+Shift+S)").clicked() {
            // Trigger save
            world.send_event(SavePropsEvent);
            ui.close_menu();
        }

        if ui.button("Regenerate All Props").clicked() {
            // Mark all chunks dirty and regenerate
            world.send_event(RegenerateAllPropsEvent);
            ui.close_menu();
        }

        if ui.button("Regenerate Visible Props").clicked() {
            world.send_event(RegenerateVisiblePropsEvent);
            ui.close_menu();
        }

        ui.separator();

        if ui.button("Clear Prop Cache").clicked() {
            // Delete all prop JSON files
            world.send_event(ClearPropCacheEvent);
            ui.close_menu();
        }
    });
}
```

### 5.2 Debug Overlay

```rust
// Add to existing debug overlay

fn render_prop_debug_info(ui: &mut egui::Ui, state: &PropPersistenceState) {
    ui.label(format!("Loaded chunks: {}", state.loaded_chunks.len()));
    ui.label(format!("Total props: {}",
        state.loaded_chunks.values().map(|v| v.len()).sum::<usize>()));
    ui.label(format!("Dirty chunks: {}", state.dirty_chunks.len()));

    if let Some(ref manifest) = state.manifest {
        ui.label(format!("Manifest version: {}", manifest.version));
        ui.label(format!("Generated: {}", manifest.generated_at));
    }
}
```

---

## Implementation Timeline

### Milestone 1: Core Persistence (Foundation)
- [ ] Create persistence module structure
- [ ] Implement JSON schema structs with serde
- [ ] Add save/load functions for chunk props
- [ ] Add manifest file handling
- [ ] Integrate with existing spawner as fallback

### Milestone 2: Physics Placement (Accuracy)
- [ ] Implement gravity simulation
- [ ] Add terrain collision detection
- [ ] Create high-resolution surface sampling
- [ ] Implement slope-based rotation calculation
- [ ] Add terrain type validation

### Milestone 3: Spawner Rewrite (Integration)
- [ ] Modify spawner to load-or-generate
- [ ] Add chunk-based prop loading
- [ ] Implement prop entity spawning from data
- [ ] Add async/parallel chunk processing
- [ ] Performance optimization (batch spawning)

### Milestone 4: Edit Mode (Persistence)
- [ ] Add dirty chunk tracking
- [ ] Hook into terraforming system
- [ ] Implement regeneration on terrain change
- [ ] Add manual save hotkey (Ctrl+Shift+S)
- [ ] Add save confirmation UI

### Milestone 5: Polish (UX)
- [ ] Add menu options
- [ ] Implement debug overlay additions
- [ ] Add progress bar for initial generation
- [ ] Error handling and recovery
- [ ] Documentation

---

## Performance Considerations

### Initial Generation (One-Time)
- **Estimated time**: 30-60 seconds for full world (145K+ props)
- **Parallelization**: Use rayon for chunk processing
- **Progress feedback**: Show loading bar with chunk count

### Runtime Loading
- **Chunk load time**: <5ms per chunk (JSON parse + entity spawn)
- **Memory**: ~50 bytes per prop in memory
- **File size**: ~200 bytes per prop in JSON (~30MB total)

### Optimizations
1. **Lazy loading**: Only load chunks near player
2. **Background saving**: Use async I/O for persistence
3. **Compression**: Optional gzip for chunk files
4. **Binary fallback**: Add bincode format for production builds

---

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Physics simulation too slow | Medium | High | Use multi-sample method instead of full physics; use Rapier HeightField for faster raycasts; parallelize with rayon |
| JSON files grow too large | Low | Medium | Chunk-based storage; switch to bincode+zstd (~90% size reduction); rkyv for zero-copy loading |
| Migration issues between versions | Medium | Medium | Version field in schema; additive-only schema changes; explicit migration functions |
| Terrain changes invalidate many props | Medium | Low | Background regeneration; 8-neighbor dirty flagging; only regenerate visible chunks first |
| Memory pressure from large worlds | Low | Medium | Stream chunks; despawn distant props; use rkyv memory-mapped loading |
| Props overlap/cluster unnaturally | Medium | Medium | Use Poisson disk sampling; R-tree spatial index for collision avoidance |
| Props at chunk boundaries break | Medium | Medium | Always dirty adjacent chunks; use world-space coordinates (not chunk-local) |
| Floating point precision issues | Low | Low | Use double precision for initial generation; snap to grid if needed |

---

## Configuration Additions

```yaml
# config/props.yaml (additions)

persistence:
  enabled: true
  save_directory: "saves/props"
  format: "json"           # "json", "bincode", or "rkyv"
  compression: "none"      # "none", "zstd", or "gzip"
  compression_level: 3     # 1-19 for zstd (3 = fast, 19 = max compression)
  auto_save_interval: 300  # seconds, 0 = disabled

placement:
  method: "multi_sample"   # "physics", "multi_sample", or "single_raycast"

  # Physics simulation settings (when method = "physics")
  physics:
    gravity: 9.81
    max_drop_distance: 32.0
    simulation_steps: 100
    step_size: 0.05
    use_rapier: false      # Use Rapier physics engine for collision

  # Multi-sample settings (when method = "multi_sample")
  multi_sample:
    sample_points: 5       # 4 corners + center
    footprint_scale: 0.8   # Scale factor for sampling footprint

  terrain_analysis:
    sample_resolution: 4   # samples per voxel
    height_precision: 0.01
    normal_method: "sobel" # "sobel", "central_diff", or "rapier"

  slope_alignment:
    default_strength: 0.8
    max_tilt: 15.0         # degrees

  # Collision avoidance between props
  collision:
    enabled: true
    method: "rtree"        # "rtree", "quadtree", or "none"
    min_distance: 0.5      # Minimum distance between prop centers

  # Distribution algorithm
  distribution:
    method: "poisson"      # "poisson", "grid_jitter", or "random"
    poisson_min_distance: 1.0  # For poisson disk sampling
```

---

## Compatibility

### Backward Compatibility
- If no prop files exist, fall back to current procedural generation
- Generate and persist on first run
- Existing saves continue to work (voxels unaffected)

### Forward Compatibility
- Version field in manifest enables migrations
- Additive schema changes won't break loading
- Old prop files can coexist with new format

---

## Success Criteria

1. **No floating props**: All props visually rest on terrain
2. **Slope alignment**: Props tilt naturally on slopes
3. **Persistence works**: Props survive restart without regeneration
4. **Edit mode functional**: Terrain changes trigger prop updates
5. **Performance acceptable**: <100ms per chunk load, <60s initial generation
6. **File size reasonable**: <50MB for full world prop data

---

## Appendix A: Research Findings & Crate Recommendations

This section incorporates additional research on optimal techniques and Rust ecosystem tools.

### A.1 Recommended Crates

| Crate | Purpose | Notes |
|-------|---------|-------|
| **bevy_rapier3d** | Physics & collision | HeightField collider for terrain, Voxels shape for voxel grids, built-in raycasting |
| **parry3d** | Lightweight collision | Rapier's collision subset - raycasting without full physics overhead |
| **poisson_diskus** | Natural distribution | O(N) Poisson disk sampling for avoiding prop clustering |
| **rstar** | Spatial indexing | R-tree for 2D/3D point queries, fast "what's nearby" checks |
| **broccoli** | 2D collision broad-phase | Hybrid KD-Tree + sweep-and-prune for ground-level collision |
| **rkyv** | Zero-copy serialization | Memory-mapped data, extremely fast deserialization |
| **zstd** / **flate2** | Compression | zstd typically faster, flate2 for gzip compatibility |

### A.2 Alternative Placement Methods

**Multi-Point Sampling (Simpler than Full Physics)**

Instead of full gravity simulation, sample terrain at multiple base points:

```rust
/// Faster alternative: sample 4 corners + center of prop footprint
pub fn multi_sample_placement(
    pos: Vec3,
    footprint: Vec2,  // (width, depth)
    world: &VoxelWorld,
) -> Option<PlacementResult> {
    let half = footprint * 0.5;
    let samples = [
        Vec3::new(pos.x - half.x, pos.y, pos.z - half.y),  // corner 1
        Vec3::new(pos.x + half.x, pos.y, pos.z - half.y),  // corner 2
        Vec3::new(pos.x - half.x, pos.y, pos.z + half.y),  // corner 3
        Vec3::new(pos.x + half.x, pos.y, pos.z + half.y),  // corner 4
        pos,  // center
    ];

    let heights: Vec<(Vec3, f32)> = samples.iter()
        .filter_map(|&p| find_surface_height(p, world).map(|h| (p, h)))
        .collect();

    if heights.len() < 3 {
        return None;  // Not enough contact points
    }

    // Use lowest contact point as base height
    let min_height = heights.iter().map(|(_, h)| *h).min_by(f32::total_cmp)?;

    // Fit plane to contact points for normal calculation
    let normal = fit_plane_normal(&heights);

    Some(PlacementResult {
        position: Vec3::new(pos.x, min_height, pos.z),
        surface_normal: normal,
        contact_points: heights,
    })
}
```

**When to use each approach:**
- **Full physics**: Complex props, irregular shapes, need absolute precision
- **Multi-sample**: Simple props (grass, flowers), faster, good enough for most cases
- **Single raycast**: Flat-bottom props, fastest, acceptable for dense vegetation

### A.3 Voxel Raycasting (Amanatides & Woo Algorithm)

For non-vertical rays or more efficient traversal:

```rust
/// Efficient DDA-based voxel traversal
pub struct VoxelRaycast {
    pub current: IVec3,
    pub step: IVec3,
    pub t_max: Vec3,
    pub t_delta: Vec3,
}

impl VoxelRaycast {
    pub fn new(origin: Vec3, direction: Vec3) -> Self {
        let step = IVec3::new(
            if direction.x >= 0.0 { 1 } else { -1 },
            if direction.y >= 0.0 { 1 } else { -1 },
            if direction.z >= 0.0 { 1 } else { -1 },
        );

        let current = origin.floor().as_ivec3();

        // Distance to next voxel boundary
        let t_max = Vec3::new(
            Self::calc_t_max(origin.x, direction.x, step.x),
            Self::calc_t_max(origin.y, direction.y, step.y),
            Self::calc_t_max(origin.z, direction.z, step.z),
        );

        // Distance between voxel boundaries
        let t_delta = Vec3::new(
            (1.0 / direction.x).abs(),
            (1.0 / direction.y).abs(),
            (1.0 / direction.z).abs(),
        );

        Self { current, step, t_max, t_delta }
    }

    pub fn next(&mut self) -> IVec3 {
        let prev = self.current;

        if self.t_max.x < self.t_max.y && self.t_max.x < self.t_max.z {
            self.current.x += self.step.x;
            self.t_max.x += self.t_delta.x;
        } else if self.t_max.y < self.t_max.z {
            self.current.y += self.step.y;
            self.t_max.y += self.t_delta.y;
        } else {
            self.current.z += self.step.z;
            self.t_max.z += self.t_delta.z;
        }

        prev
    }
}
```

### A.4 Prop Collision Avoidance with Spatial Index

```rust
use rstar::{RTree, AABB, PointDistance};

#[derive(Clone)]
struct PlacedProp {
    position: [f32; 2],  // XZ only for ground collision
    radius: f32,
    id: usize,
}

impl rstar::RTreeObject for PlacedProp {
    type Envelope = AABB<[f32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(
            [self.position[0] - self.radius, self.position[1] - self.radius],
            [self.position[0] + self.radius, self.position[1] + self.radius],
        )
    }
}

pub struct PropSpatialIndex {
    tree: RTree<PlacedProp>,
}

impl PropSpatialIndex {
    pub fn can_place(&self, pos: Vec3, min_distance: f32) -> bool {
        let search_point = [pos.x, pos.z];

        // Find nearest neighbor
        if let Some(nearest) = self.tree.nearest_neighbor(&search_point) {
            let dist = ((nearest.position[0] - pos.x).powi(2)
                      + (nearest.position[1] - pos.z).powi(2)).sqrt();
            dist >= min_distance + nearest.radius
        } else {
            true  // No props placed yet
        }
    }

    pub fn insert(&mut self, pos: Vec3, radius: f32, id: usize) {
        self.tree.insert(PlacedProp {
            position: [pos.x, pos.z],
            radius,
            id,
        });
    }
}
```

### A.5 Poisson Disk Sampling for Natural Distribution

```rust
use poisson_diskus::Builder;

pub fn generate_candidate_positions(
    chunk_bounds: (Vec2, Vec2),
    min_distance: f32,
    seed: u64,
) -> Vec<Vec2> {
    let (min, max) = chunk_bounds;
    let size = max - min;

    let poisson = Builder::with_seed(seed)
        .with_dimensions([size.x as f64, size.y as f64], min_distance as f64)
        .build();

    poisson.into_iter()
        .map(|[x, y]| Vec2::new(min.x + x as f32, min.y + y as f32))
        .collect()
}
```

This produces naturally-spaced candidates without clustering, unlike pure random.

### A.6 Rapier Integration for Precise Terrain Collision

```rust
use bevy_rapier3d::prelude::*;

/// Use Rapier's HeightField for terrain raycasting
pub fn setup_terrain_collider(
    commands: &mut Commands,
    heights: &[f32],  // Row-major height samples
    rows: usize,
    cols: usize,
    scale: Vec3,
) {
    let heightfield = Collider::heightfield(
        heights.to_vec(),
        rows,
        cols,
        scale,
    );

    commands.spawn((
        heightfield,
        RigidBody::Fixed,
        CollisionGroups::new(Group::GROUP_1, Group::ALL),
    ));
}

/// Raycast against terrain using Rapier
pub fn raycast_terrain(
    rapier_context: &RapierContext,
    origin: Vec3,
    direction: Vec3,
    max_distance: f32,
) -> Option<(Vec3, Vec3)> {  // (hit_point, normal)
    let filter = QueryFilter::default()
        .groups(CollisionGroups::new(Group::ALL, Group::GROUP_1));

    rapier_context.cast_ray_and_get_normal(
        origin,
        direction,
        max_distance,
        true,
        filter,
    ).map(|(_, hit)| (origin + direction * hit.time_of_impact, hit.normal))
}
```

### A.7 Bevy Transform Alignment

```rust
/// Use Bevy's aligned_by for cleaner rotation
pub fn align_prop_to_terrain(
    surface_normal: Vec3,
    random_yaw: f32,
) -> Transform {
    // Forward direction (arbitrary, will rotate around normal)
    let forward = Vec3::new(random_yaw.cos(), 0.0, random_yaw.sin());

    Transform::IDENTITY
        .looking_to(forward, surface_normal)  // Align up to normal
}

/// Alternative: partial alignment with strength
pub fn partial_align_to_terrain(
    surface_normal: Vec3,
    strength: f32,  // 0.0 = upright, 1.0 = fully aligned
    random_yaw: f32,
) -> Transform {
    let blended_up = Vec3::Y.lerp(surface_normal, strength).normalize();
    let forward = Vec3::new(random_yaw.cos(), 0.0, random_yaw.sin());

    Transform::IDENTITY.looking_to(forward, blended_up)
}
```

### A.8 Binary Format Comparison

| Format | File Size (145K props) | Load Time | Notes |
|--------|------------------------|-----------|-------|
| JSON (pretty) | ~35 MB | ~200ms | Human readable, debugging |
| JSON (compact) | ~25 MB | ~150ms | Still readable |
| Bincode | ~8 MB | ~30ms | Fast, compact |
| Bincode + zstd | ~3 MB | ~40ms | Best compression |
| rkyv | ~10 MB | ~5ms | Zero-copy, fastest load |

**Recommendation**: Start with JSON for development, switch to bincode+zstd for release.

### A.9 Adjacent Chunk Handling

Props near chunk boundaries need special care:

```rust
const ADJACENT_OFFSETS: [IVec3; 8] = [
    IVec3::new(-1, 0, -1), IVec3::new(0, 0, -1), IVec3::new(1, 0, -1),
    IVec3::new(-1, 0,  0),                        IVec3::new(1, 0,  0),
    IVec3::new(-1, 0,  1), IVec3::new(0, 0,  1), IVec3::new(1, 0,  1),
];

pub fn mark_chunk_and_neighbors_dirty(
    chunk_pos: IVec3,
    dirty_set: &mut HashSet<IVec3>,
) {
    dirty_set.insert(chunk_pos);
    for offset in ADJACENT_OFFSETS {
        dirty_set.insert(chunk_pos + offset);
    }
}
```

### A.10 Debug Visualization

```rust
/// Draw debug lines showing prop contact normals
pub fn debug_draw_prop_contacts(
    gizmos: &mut Gizmos,
    props: &[PropPlacementData],
    show_normals: bool,
    show_footprints: bool,
) {
    for prop in props {
        let pos = prop.position;

        if show_normals {
            let normal_end = pos + prop.ground_contact.normal * 2.0;
            gizmos.line(pos, normal_end, Color::srgb(0.0, 1.0, 0.0));
        }

        if show_footprints {
            // Draw circle at base
            gizmos.circle(
                Isometry3d::new(pos, Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)),
                0.5,
                Color::srgb(1.0, 1.0, 0.0),
            );
        }
    }
}
```

---

## Appendix B: Existing Code References

Key files to modify:
- [spawner.rs](src/props/spawner.rs) - Main spawning logic
- [loader.rs](src/props/loader.rs) - Asset loading
- [mod.rs](src/props/mod.rs) - Module exports
- [config/props.yaml](config/props.yaml) - Configuration

Key files to reference:
- [persistence.rs](src/voxel/persistence.rs) - Existing voxel persistence pattern
- [world.rs](src/voxel/world.rs) - Chunk coordinate system
- [terrain.rs](src/voxel/terrain.rs) - Terrain analysis patterns

---

## Appendix C: JSON Example (Full Chunk)

```json
{
  "chunk_pos": [5, 0, 3],
  "props": [
    {
      "id": "grass_tall_01",
      "prop_type": "Bush",
      "position": [85.234, 12.567, 51.891],
      "rotation": [2.3, 127.5, -1.8],
      "scale": [0.9, 1.1, 0.9],
      "ground_contact": {
        "terrain_type": "TopSoil",
        "texture_blend": {"grass": 1.0},
        "slope_angle": 8.5,
        "normal": [0.02, 0.99, 0.01]
      },
      "placement_seed": 8472931234,
      "validated": true
    }
  ],
  "last_modified": "2026-01-18T10:30:00Z",
  "dirty": false
}
```
