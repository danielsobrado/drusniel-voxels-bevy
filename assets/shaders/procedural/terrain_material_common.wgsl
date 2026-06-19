#import "shaders/procedural/terrain_recipes.wgsl"::{
    procedural_material_roughness,
}

struct TerrainMaterialSample {
    albedo: vec3<f32>,
    normal_ws: vec3<f32>,
    roughness: f32,
    ao: f32,
    material_id: u32,
    debug_value: f32,
};

fn procedural_dominant_material_id(material_weights: vec4<f32>) -> u32 {
    let best = max(max(material_weights.x, material_weights.y), max(material_weights.z, material_weights.w));
    if (material_weights.y == best) {
        return 1u;
    }
    if (material_weights.z == best) {
        return 2u;
    }
    if (material_weights.w == best) {
        return 3u;
    }
    return 0u;
}

fn sample_procedural_terrain_material(
    world_pos: vec3<f32>,
    normal_ws: vec3<f32>,
    material_weights: vec4<f32>,
    lod_bias: f32,
    albedo: vec3<f32>,
    sampled_normal_ws: vec3<f32>,
    roughness: f32,
    ao: f32,
) -> TerrainMaterialSample {
    let material_id = procedural_dominant_material_id(material_weights);
    let upness = clamp(normal_ws.y * 0.5 + 0.5, 0.0, 1.0);
    let snow_mask = smoothstep(76.0, 130.0, world_pos.y) * smoothstep(0.58, 0.92, upness);
    let moss_mask = material_weights.x * smoothstep(0.55, 0.92, upness);
    let gravel_mask = material_weights.y * smoothstep(0.28, 0.72, 1.0 - upness);
    let wet_silt_mask = material_weights.z * (1.0 - smoothstep(18.0, 28.0, world_pos.y)) * smoothstep(0.42, 0.86, upness);

    var out_albedo = albedo;
    out_albedo = mix(out_albedo, vec3<f32>(0.86, 0.89, 0.90), snow_mask * 0.22);
    out_albedo = mix(out_albedo, vec3<f32>(0.18, 0.32, 0.13), moss_mask * 0.08);
    out_albedo = mix(out_albedo, vec3<f32>(0.42, 0.41, 0.39), gravel_mask * 0.10);
    out_albedo = mix(out_albedo, vec3<f32>(0.18, 0.15, 0.12), wet_silt_mask * 0.20);

    let recipe_roughness = procedural_material_roughness(material_id);
    var out_roughness = mix(roughness, recipe_roughness, 0.35);
    out_roughness = mix(out_roughness, 0.58, snow_mask * 0.18);
    out_roughness = mix(out_roughness, 0.35, wet_silt_mask * 0.30);

    let micro_fade = 1.0 - smoothstep(45.0, 85.0, lod_bias);
    let normal_mix = clamp(micro_fade, 0.0, 1.0);
    let out_normal = normalize(mix(normal_ws, sampled_normal_ws, normal_mix));
    let out_ao = ao;

    return TerrainMaterialSample(
        clamp(out_albedo, vec3<f32>(0.0), vec3<f32>(1.0)),
        out_normal,
        clamp(out_roughness, 0.04, 1.0),
        out_ao,
        material_id,
        f32(material_id) / 3.0,
    );
}
