# assets/config/building_materials.yaml

Document status (2026-05-17): current technical note; verify file paths against code when editing.

## Recommended Texture Maps by Category

| Category | Albedo | Normal | Roughness | Metallic | AO | Parallax | Reason |
|----------|--------|--------|-----------|----------|-----|----------|--------|
| **Buildings** | ✓ | ✓ | ✓ (map) | ✓ (map) | ✓ (map) | ✓ | Player stares at these up close. Worth the cost. |
| **Terrain** | ✓ | ✓ | Uniform | ❌ | SSAO | ❌ | Triplanar = 3x samples. Keep simple. |
| **Crops** | ✓ | ❌ | Uniform | ❌ | Vertex AO | ❌ | Low-poly stylized. GLTF vertex colors suffice. |
| **Props/Rocks** | ✓ | ✓ | ✓ (map) | ❌ | ✓ (map) | Optional | Mid-priority. Rocks benefit from detail. |
| **Water** | N/A | ✓ (flow) | Uniform | ❌ | ❌ | ❌ | Shader-driven, not texture-driven. |

---

## Building Materials (Full PBR)

Buildings deserve the most detail—players examine them closely when building.

```yaml
# assets/config/building_materials.yaml
texture_format:
  resolution: 1024  # 2K overkill for stylized
  maps: [albedo, normal, roughness, ao]
  # Metallic only for metal materials
  
materials:
  wood_plank:
    roughness_map: true
    ao_map: true
    parallax: 0.03  # Subtle depth
    
  stone_brick:
    roughness_map: true
    ao_map: true
    parallax: 0.05  # More pronounced
    
  metal_plate:
    roughness_map: true
    metallic_map: true  # Only material that needs it
    ao_map: true
    parallax: 0.02
    
  thatch:
    roughness_map: true
    ao_map: true
    parallax: 0.04
```

**Texture samples per fragment (building shader):**
- Current: 6 (albedo + normal triplanar)
- Recommended: 15-18 (albedo + normal + roughness + AO, optional parallax iterations)

RTX 40xx handles this trivially.

---

## Terrain (Keep Lean)

Triplanar triples every texture sample. Keep terrain simple.

```yaml
# assets/config/terrain_materials.yaml
texture_format:
  resolution: 512  # Intentionally low-res (Valheim style)
  maps: [albedo, normal]  # That's it
  
materials:
  grass:
    roughness: 0.85  # Uniform value
    
  dirt:
    roughness: 0.95
    
  rock:
    roughness: 0.90
    
  sand:
    roughness: 0.98
    
  tilled_soil:
    roughness: 0.92
```

**Why no terrain AO map?** 
- SSAO handles ambient occlusion screen-space
- Terrain AO maps look flat/baked compared to dynamic SSAO
- Saves 3 texture samples per fragment

---

## Crops (Minimal)

Low-poly stylized crops don't benefit from complex PBR.

```yaml
# assets/config/crop_rendering.yaml
crops:
  texture_maps: [albedo]  # GLTF vertex colors handle the rest
  roughness: 0.75  # Uniform - slight sheen on leaves
  metallic: 0.0
  
  # Vertex AO baked in Blender - free at runtime
  use_vertex_ao: true
  
  # Wind animation more important than texture detail
  wind:
    enabled: true
    strength: 0.15
    frequency: 1.2
```

**Crop visual priority:**
1. Wind animation (life)
2. Growth stage model swaps (progression)
3. LOD system (performance)
4. Texture detail (least important)

---

## Props/Rocks (Medium Detail)

Scattered environment props warrant mid-tier treatment.

```yaml
# assets/config/prop_materials.yaml
rocks:
  maps: [albedo, normal, roughness, ao]
  parallax: 0.0  # Skip - props are small
  resolution: 512
  
furniture:
  maps: [albedo, normal, roughness]
  ao: vertex_baked  # Bake in Blender
  
barrels_crates:
  maps: [albedo, normal]
  roughness: 0.8  # Uniform wood
```

---

## Shader Architecture

Split into specialized shaders:

```
assets/shaders/
├── building.wgsl      # Full PBR (5 maps + parallax)
├── terrain.wgsl       # Triplanar (2 maps + SSAO)
├── vegetation.wgsl    # Instanced (vertex colors + wind)
├── props.wgsl         # Standard PBR (3-4 maps)
└── water.wgsl         # Custom (flow maps + reflections)
```

---

## Building Shader Additions

```wgsl
// building.wgsl - Full PBR for RTX 40xx

struct BuildingMaterial {
    base_color: vec4<f32>,
    tex_scale: f32,
    blend_sharpness: f32,
    normal_intensity: f32,
    parallax_scale: f32,  // 0.03-0.05 for buildings
    // No uniform roughness/metallic - use maps
}

@group(2) @binding(0) var albedo_array: texture_2d_array<f32>;
@group(2) @binding(1) var normal_array: texture_2d_array<f32>;
@group(2) @binding(2) var roughness_array: texture_2d_array<f32>;
@group(2) @binding(3) var ao_array: texture_2d_array<f32>;
@group(2) @binding(4) var metallic_array: texture_2d_array<f32>;  // Optional

fn sample_building_pbr(
    world_pos: vec3<f32>,
    world_normal: vec3<f32>,
    view_dir: vec3<f32>,
    material_idx: u32
) -> PbrSample {
    // Parallax offset (only for buildings)
    let parallax_uv = parallax_mapping(world_pos, view_dir, material_idx);
    
    // Triplanar with parallax-adjusted UVs
    let albedo = triplanar_sample(albedo_array, parallax_uv, world_normal, material_idx);
    let normal = triplanar_sample_normal(normal_array, parallax_uv, world_normal, material_idx);
    let roughness = triplanar_sample(roughness_array, parallax_uv, world_normal, material_idx).r;
    let ao = triplanar_sample(ao_array, parallax_uv, world_normal, material_idx).r;
    
    return PbrSample(albedo, normal, roughness, ao, 0.0);  // metallic=0 for non-metal
}
```

---

## Performance Budget (RTX 4070)

| Category | Texture Samples | Target Objects | Frame Budget |
|----------|-----------------|----------------|--------------|
| Buildings | 15-18/frag | ~500 pieces | 2ms |
| Terrain | 6/frag | ~64 chunks | 1.5ms |
| Crops | 1/frag | ~10,000 | 0.5ms |
| Props | 9-12/frag | ~2,000 | 1ms |
| Post-process | N/A | Screen | 2ms |
| **Total** | | | **7ms** (~140 FPS) |

---

## Summary

| Category | Investment Level | Key Technique |
|----------|------------------|---------------|
| **Buildings** | HIGH | Full PBR + parallax |
| **Terrain** | LOW | Triplanar albedo+normal, SSAO |
| **Crops** | MINIMAL | Vertex colors, wind animation |
| **Props** | MEDIUM | Standard PBR, vertex AO |

The Valheim aesthetic comes from **contrast**: detailed buildings against simplified natural elements. Don't over-engineer terrain/crops—invest that budget in buildings and post-processing.
