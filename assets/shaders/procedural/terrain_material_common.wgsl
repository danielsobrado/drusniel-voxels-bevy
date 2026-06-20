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
    snow_mask_params: vec4<f32>,
    wet_mask_params: vec4<f32>,
    slope_mask_params: vec4<f32>,
    tint_strengths: vec4<f32>,
    material_roughness: vec4<f32>,
    moss_tint: vec4<f32>,
    gravel_tint: vec4<f32>,
    wet_tint: vec4<f32>,
    snow_tint: vec4<f32>,
    material_params: vec4<f32>,
) -> TerrainMaterialSample {
    let material_id = procedural_dominant_material_id(material_weights);
    let upness = clamp(normal_ws.y * 0.5 + 0.5, 0.0, 1.0);
    let snow_mask = smoothstep(snow_mask_params.x, snow_mask_params.y, world_pos.y) * smoothstep(snow_mask_params.z, snow_mask_params.w, upness);
    let moss_mask = material_weights.x * smoothstep(slope_mask_params.x, slope_mask_params.y, upness);
    let gravel_mask = material_weights.y * smoothstep(slope_mask_params.z, slope_mask_params.w, 1.0 - upness);
    let wet_silt_mask = material_weights.z * (1.0 - smoothstep(wet_mask_params.x, wet_mask_params.y, world_pos.y)) * smoothstep(wet_mask_params.z, wet_mask_params.w, upness);

    var out_albedo = albedo;
    out_albedo = mix(out_albedo, snow_tint.xyz, snow_mask * tint_strengths.x);
    out_albedo = mix(out_albedo, moss_tint.xyz, moss_mask * tint_strengths.y);
    out_albedo = mix(out_albedo, gravel_tint.xyz, gravel_mask * tint_strengths.z);
    out_albedo = mix(out_albedo, wet_tint.xyz, wet_silt_mask * tint_strengths.w);

    let recipe_roughness = material_roughness[material_id];
    var out_roughness = mix(roughness, recipe_roughness, 0.35);
    out_roughness = mix(out_roughness, material_params.z, wet_silt_mask * material_params.w);

    let micro_fade = 1.0 - smoothstep(material_params.x, material_params.y, lod_bias);
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
