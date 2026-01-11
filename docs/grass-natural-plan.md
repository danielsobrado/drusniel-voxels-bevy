# Make Grass Look Natural - Implementation Plan

## Problem Statement

The current grass is "chunky" because it's rendered as opaque crossed quads with a flat-color fragment shader and shadows disabled. The target look needs alpha-masked textured blades/clumps, real lighting/shadowing, and more variation (color/size/clumps) plus wind that bends tips more than bases.

## Current Implementation Analysis

### File Locations
| Component | Location |
|-----------|----------|
| Grass mesh generation & spawning | [src/vegetation/mod.rs](../src/vegetation/mod.rs) |
| Grass material definition | [src/vegetation/grass_material.rs](../src/vegetation/grass_material.rs) |
| Grass shader | [assets/shaders/grass.wgsl](../assets/shaders/grass.wgsl) |
| Debug UI / config | [src/debug_ui.rs](../src/debug_ui.rs) |
| Chunk LOD system | [src/voxel/plugin.rs](../src/voxel/plugin.rs) |
| Chunk data structures | [src/voxel/chunk.rs](../src/voxel/chunk.rs) |

### Current State

**Fragment shader** ([grass.wgsl:109-111](../assets/shaders/grass.wgsl#L109-L111)):
- Just returns flat `input.color` - no texturing, no lighting

**Material configuration** ([grass_material.rs:113](../src/vegetation/grass_material.rs#L113)):
- `shadows_enabled: false`
- `AlphaMode::Opaque`

**Per-blade variation** ([mod.rs:358-359](../src/vegetation/mod.rs#L358-L359)):
- Only yaw rotation and uniform scale
- Missing: height jitter, width jitter, lean angle, hue/value shifts

**Wind deformation** ([grass.wgsl:81-90](../assets/shaders/grass.wgsl#L81-L90)):
- Has UV.y-weighted tip bending (good)
- No per-instance phase offset
- No directional gusts

**Config integration**:
- `VegetationConfig.grass_density` exists in UI but is NOT connected to spawn code
- Hardcoded: `density: 20, max_count: 1000` at [mod.rs:158](../src/vegetation/mod.rs#L158)

**Lifecycle bug**:
- `ProceduralGrassPatch` entities spawned independently of chunks
- When chunks are despawned (culled), grass patches remain orphaned

---

## Implementation Phases

### Phase 1: Alpha-Masked Texturing (High Impact)

**Files:** `src/vegetation/grass_material.rs`, `assets/shaders/grass.wgsl`

**Steps:**

1. Add texture sampler binding to `GrassMaterial`:
   ```rust
   #[derive(Asset, TypePath, AsBindGroup, Debug, Clone)]
   pub struct GrassMaterial {
       #[uniform(0)]
       pub uniform_data: GrassMaterialUniform,
       #[texture(1)]
       #[sampler(2)]
       pub texture: Handle<Image>,
   }
   ```

2. Update `grass.wgsl` fragment shader:
   ```wgsl
   @group(#{MATERIAL_BIND_GROUP}) @binding(1) var grass_texture: texture_2d<f32>;
   @group(#{MATERIAL_BIND_GROUP}) @binding(2) var grass_sampler: sampler;

   @fragment
   fn fragment(input: FragmentInput) -> @location(0) vec4<f32> {
       let tex_color = textureSample(grass_texture, grass_sampler, input.uv);
       if tex_color.a < 0.5 {
           discard;
       }
       return tex_color * input.color;
   }
   ```

3. Enable shadows in `GrassMaterialPlugin`:
   ```rust
   MaterialPlugin::<GrassMaterial> {
       prepass_enabled: true,
       shadows_enabled: true,
       ..default()
   }
   ```

4. Set alpha mode:
   ```rust
   fn alpha_mode(&self) -> AlphaMode {
       AlphaMode::Mask(0.5)
   }
   ```

**Considerations:**
- `AlphaMode::Mask` (cutoff) is crisper but can shimmer at distance
- `AlphaMode::AlphaToCoverage` is smoother but requires MSAA

---

### Phase 2: Per-Blade Variation (Visual Quality)

**File:** `src/vegetation/mod.rs` (`build_grass_patch_mesh` function)

**Current code** (line ~359):
```rust
let yaw = hash * std::f32::consts::TAU;
let scale = 0.8 + simple_hash(i as i32 * 17, i as i32 * 29) * 0.6;
```

**Improved variation:**
```rust
// Independent height and width scaling
let height_scale = 0.7 + simple_hash(i as i32 * 17, i as i32 * 29) * 0.6;
let width_scale = 0.8 + simple_hash(i as i32 * 19, i as i32 * 31) * 0.4;

// Random lean angle (5-15 degrees)
let lean_angle = (simple_hash(i as i32 * 23, i as i32 * 37) - 0.5) * 0.26; // ~15 deg max
let lean_axis = Vec3::new(
    simple_hash(i as i32 * 41, i as i32 * 43) - 0.5,
    0.0,
    simple_hash(i as i32 * 47, i as i32 * 53) - 0.5,
).normalize_or_else(Vec3::X);
let lean_rotation = Quat::from_axis_angle(lean_axis, lean_angle);

// Combined rotation
let rotation = align * lean_rotation * Quat::from_rotation_y(yaw);

// Non-uniform scale
let scale = Vec3::new(width_scale, height_scale, width_scale);
```

**Optional: Hue/value jitter via vertex colors:**
```rust
// Per-blade color offset
let hue_shift = (simple_hash(i as i32 * 59, i as i32 * 61) - 0.5) * 0.1;
let value_shift = (simple_hash(i as i32 * 67, i as i32 * 71) - 0.5) * 0.15;
// Apply to vertex colors or pass as instance data
```

---

### Phase 3: Wind Improvements (Polish)

**File:** `assets/shaders/grass.wgsl`

**1. Per-instance phase offset:**
```wgsl
@vertex
fn vertex(vertex: Vertex) -> VertexOutput {
    // ...existing code...

    // Add instance-based phase offset for desynchronized movement
    let phase_offset = f32(vertex.instance_index) * 0.37;
    let wind_sample_pos = world_pos.xz * material.wind_scale
        + (material.time + phase_offset) * material.wind_speed;

    // ...rest of wind calculation...
}
```

**2. Directional gust layer:**
```wgsl
// Primary wind (existing)
let wind_offset = fbm(wind_sample_pos) * 2.0 - 1.0;

// Secondary gust (slower, larger scale, directional)
let gust_pos = world_pos.xz * 0.02 + material.time * 0.3;
let gust = noise(gust_pos) * 0.5;
let gust_direction = vec2<f32>(0.7, 0.3); // Dominant wind direction

// Combined displacement
local_pos.x += (wind_offset * material.wind_strength + gust * gust_direction.x) * height_factor_smooth;
local_pos.z += (wind_offset * material.wind_strength * 0.5 + gust * gust_direction.y) * height_factor_smooth;
```

**3. Tuning suggestions:**
- Increase `wind_strength` default from 0.3 to 0.4-0.5
- Add subtle Y displacement for more organic movement
- Consider adding gust_strength and gust_direction to material uniforms

---

### Phase 4: Config Integration (Workflow)

**Files:** `src/vegetation/mod.rs`, `src/debug_ui.rs`

**1. Connect VegetationConfig to spawn code:**

In `attach_procedural_grass_to_chunks`:
```rust
pub fn attach_procedural_grass_to_chunks(
    // ...existing params...
    veg_config: Res<VegetationConfig>,
) {
    // Pass config to helper
    process_chunk_for_grass(..., veg_config.grass_density, ...);
}
```

In `process_chunk_for_grass`:
```rust
fn process_chunk_for_grass(
    // ...existing params...
    density: u32,
) {
    let instances = collect_grass_instances(chunk_source_mesh, transform, density, 1000);
    // ...
}
```

**2. Add wind parameters to VegetationConfig:**
```rust
#[derive(Resource)]
pub struct VegetationConfig {
    pub grass_density: u32,
    pub wind_strength: f32,
    pub wind_speed: f32,
}

impl Default for VegetationConfig {
    fn default() -> Self {
        Self {
            grass_density: 20,
            wind_strength: 0.35,
            wind_speed: 1.8,
        }
    }
}
```

**3. Update debug UI:**
```rust
ui.add(egui::Slider::new(&mut veg.wind_strength, 0.0..=1.0).text("Wind Strength"));
ui.add(egui::Slider::new(&mut veg.wind_speed, 0.5..=5.0).text("Wind Speed"));
```

**4. Sync material uniforms when config changes:**
```rust
pub fn sync_grass_material_config(
    veg_config: Res<VegetationConfig>,
    mut materials: ResMut<Assets<GrassMaterial>>,
    handles: Res<GrassMaterialHandles>,
) {
    if !veg_config.is_changed() {
        return;
    }
    for handle in &handles.handles {
        if let Some(material) = materials.get_mut(handle) {
            material.uniform_data.wind_strength = veg_config.wind_strength;
            material.uniform_data.wind_speed = veg_config.wind_speed;
        }
    }
}
```

---

### Phase 5: Lifecycle Fix (Bug)

**File:** `src/vegetation/mod.rs`

**Problem:** Grass patches are spawned as independent entities. When chunk meshes are despawned due to LOD culling, the grass patches remain orphaned in the world.

**Option A: Parent grass to chunk entity**

In `process_chunk_for_grass`:
```rust
let grass_entity = commands.spawn((
    ProceduralGrassPatch,
    Mesh3d(mesh_handle),
    MeshMaterial3d(material_handle),
    Transform::IDENTITY,
    // ...other components...
)).id();

// Parent to chunk so it despawns with chunk
commands.entity(grass_entity).set_parent(entity);
```

**Option B: Track association and cleanup separately**

Add a component to link grass to chunk:
```rust
#[derive(Component)]
pub struct GrassChunkLink(pub Entity);
```

Add cleanup system:
```rust
pub fn cleanup_orphaned_grass(
    mut commands: Commands,
    grass_query: Query<(Entity, &GrassChunkLink), With<ProceduralGrassPatch>>,
    chunk_query: Query<Entity, With<ChunkGrassAttached>>,
) {
    let valid_chunks: HashSet<Entity> = chunk_query.iter().collect();

    for (grass_entity, link) in grass_query.iter() {
        if !valid_chunks.contains(&link.0) {
            commands.entity(grass_entity).despawn();
        }
    }
}
```

**Recommendation:** Option A is simpler and leverages Bevy's built-in hierarchy despawning.

---

## Further Considerations

### Art Direction Decision
- **Fine blades:** Current crossed-quad approach, needs good alpha texture
- **Clumpy cards:** Consider using existing `assets/models/Models/GLTF format/grass*.glb` models

### Available Assets
The project includes KayKit nature pack models:
- `grass.glb` - basic grass tuft
- `grass_large.glb` - larger grass clump
- `grass_leafs.glb` - leafy grass variation
- `grass_leafsLarge.glb` - larger leafy variation

These could be used instead of procedural crossed quads for a more stylized look.

### Performance Notes
- Current CPU-baked mesh approach is simpler to maintain
- GPU instancing would be a bigger win for very high blade counts (>50k)
- Profile before optimizing - current approach may be sufficient

### Alpha Strategy Comparison

| Strategy | Pros | Cons |
|----------|------|------|
| `AlphaMode::Mask` | Crisp edges, simple | Can shimmer/alias at distance |
| `AlphaMode::Blend` | Smooth edges | Sorting issues, slower |
| Alpha-to-coverage | Best of both worlds | Requires MSAA enabled |
| Dithered transparency | No sorting issues | Grainy appearance |

---

## Prepass Implementation (Resolved)

A custom prepass shader was implemented to enable alpha masking and shadows:

**Files:**
- `assets/shaders/grass_prepass.wgsl` - Custom prepass shader with wind animation and alpha discard

**Current settings in `GrassMaterialPlugin`:**
```rust
MaterialPlugin::<GrassMaterial> {
    prepass_enabled: true,   // Uses custom grass_prepass.wgsl
    shadows_enabled: true,   // Grass receives shadows
    ..default()
}
```

**Material impl includes:**
```rust
fn prepass_vertex_shader() -> ShaderRef {
    "shaders/grass_prepass.wgsl".into()
}

fn prepass_fragment_shader() -> ShaderRef {
    "shaders/grass_prepass.wgsl".into()
}

fn alpha_mode(&self) -> AlphaMode {
    AlphaMode::Mask(0.5)
}
```

The prepass shader applies the same wind animation as the main shader to ensure depth consistency.

See `docs/debugging_blue_vegetation.md` for investigation history of the blue artifact issue.

---

## Implementation Priority

1. **Phase 5 (Lifecycle Fix)** - Bug fix, prevents entity leaks ✅
2. **Phase 1 (Alpha-Masked Texturing)** - Custom prepass shader ✅
3. **Phase 2 (Per-Blade Variation)** - Significant visual improvement ✅
4. **Phase 4 (Config Integration)** - Enables iteration ✅
5. **Phase 3 (Wind Improvements)** - Polish ✅
