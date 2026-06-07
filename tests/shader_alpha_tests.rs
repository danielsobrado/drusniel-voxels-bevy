fn assert_not_contains(haystack: &str, needle: &str, shader_name: &str) {
    assert!(
        !haystack.contains(needle),
        "{shader_name} should not preserve render-target alpha via `{needle}`"
    );
}

#[test]
fn fullscreen_post_passes_scrub_scene_alpha() {
    let water_compositor = include_str!("../assets/shaders/water_reflection_compositor.wgsl");
    let god_rays = include_str!("../assets/shaders/god_rays.wgsl");
    let weather_overlay = include_str!("../assets/shaders/weather_overlay.wgsl");
    let gtao = include_str!("../assets/shaders/gtao_main.wgsl");
    let radiance_cascades = include_str!("../assets/shaders/radiance_cascades.wgsl");

    for (name, shader) in [
        ("water_reflection_compositor.wgsl", water_compositor),
        ("god_rays.wgsl", god_rays),
        ("weather_overlay.wgsl", weather_overlay),
        ("gtao_main.wgsl", gtao),
        ("radiance_cascades.wgsl", radiance_cascades),
    ] {
        assert_not_contains(shader, "return scene;", name);
        assert_not_contains(shader, "return base_scene;", name);
        assert_not_contains(shader, "scene.a", name);
        assert_not_contains(shader, "base_scene.a", name);
    }
}

#[test]
fn water_reflection_compositor_rejects_sky_masks_without_water_plane_hit() {
    let water_compositor = include_str!("../assets/shaders/water_reflection_compositor.wgsl");

    assert!(
        water_compositor.contains("fn water_plane_hit_distance"),
        "water reflection compositor should validate sky mask pixels against finite water-plane hits"
    );
    assert!(
        water_compositor.contains("hit_distance <= max_distance"),
        "sky/far-clear mask pixels should not pass through at unbounded horizon distance"
    );
    assert!(
        water_compositor.contains("params2: vec4<f32>"),
        "water reflection compositor should receive a configurable sky-mask distance limit"
    );
    assert_not_contains(
        water_compositor,
        "return raw_mask;",
        "water_reflection_compositor.wgsl",
    );
}

#[test]
fn opaque_prop_shaders_write_solid_alpha() {
    let props = include_str!("../assets/shaders/props.wgsl");
    let instanced_props = include_str!("../assets/shaders/instanced_prop.wgsl");
    let simple_lod = include_str!("../assets/shaders/simple_lod.wgsl");
    let building = include_str!("../assets/shaders/building.wgsl");

    assert_not_contains(props, "final_pbr.albedo.a", "props.wgsl");
    assert!(
        instanced_props.contains("#ifdef PROP_BLEND_ALPHA"),
        "instanced_prop.wgsl should only preserve alpha for explicitly blended prop passes"
    );
    assert_not_contains(simple_lod, "albedo.a", "simple_lod.wgsl");
    assert_not_contains(building, "final_pbr.albedo.a", "building.wgsl");
}

#[test]
fn opaque_terrain_shaders_write_solid_alpha() {
    let triplanar = include_str!("../assets/shaders/triplanar_terrain.wgsl");
    let blocky = include_str!("../assets/shaders/blocky_terrain.wgsl");

    assert!(
        triplanar.contains("return vec4<f32>(color.rgb, 1.0);"),
        "triplanar terrain should not preserve sampled albedo alpha in the opaque render target"
    );
    assert!(
        triplanar.contains("return vec4<f32>(debug_color.rgb, 1.0);"),
        "triplanar atlas-debug output should keep the same opaque alpha contract"
    );
    assert!(
        blocky.contains("return vec4<f32>(color.rgb, 1.0);"),
        "blocky terrain should not preserve sampled texture-array alpha in the opaque render target"
    );
    assert_not_contains(triplanar, "return color;", "triplanar_terrain.wgsl");
    assert_not_contains(blocky, "return color;", "blocky_terrain.wgsl");
}

#[test]
fn alpha_mask_vegetation_discards_instead_of_writing_translucent_scene_alpha() {
    let grass = include_str!("../assets/shaders/grass.wgsl");
    let billboard = include_str!("../assets/shaders/billboard.wgsl");

    assert!(
        grass.contains("if final_alpha < 0.5"),
        "grass alpha-mask pixels should be discarded by the shader cutoff"
    );
    assert!(
        grass.contains("return vec4<f32>(final_color, 1.0);"),
        "accepted grass alpha-mask pixels should write solid scene alpha"
    );
    assert!(
        billboard.contains("return vec4<f32>(final_color, 1.0);"),
        "accepted billboard alpha-mask pixels should write solid scene alpha"
    );
    assert_not_contains(
        grass,
        "return vec4<f32>(final_color, final_alpha);",
        "grass.wgsl",
    );
    assert_not_contains(
        billboard,
        "return vec4<f32>(final_color, tex_color.a);",
        "billboard.wgsl",
    );
}

#[test]
fn depth_dependent_passes_have_depth_before_weather_overlay() {
    let weather_overlay = include_str!("../src/rendering/diagnostics/weather_overlay.rs");
    let compact_weather = weather_overlay
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    assert!(
        compact_weather.contains("GodRaysLabel, WeatherOverlayLabel, Node3d::Bloom"),
        "weather overlay should run after god rays so depth-dependent lighting does not sample precipitation"
    );
    assert!(
        !compact_weather.contains("WeatherOverlayLabel, GodRaysLabel"),
        "weather overlay should not feed into the god-ray pass"
    );
}

#[test]
fn god_rays_clamps_dynamic_sample_count_before_division() {
    let god_rays = include_str!("../assets/shaders/god_rays.wgsl");

    assert!(
        god_rays.contains("let sample_count = clamp(uniforms.num_samples, 1, 128);"),
        "god rays must clamp runtime sample counts before using them in math or loops"
    );
    assert!(
        god_rays.contains("/ f32(sample_count)") && god_rays.contains("i < sample_count"),
        "god rays should use the clamped sample count for both ray stride and loop bounds"
    );
}

#[test]
fn god_rays_accept_naadf_froxel_visibility_modulation() {
    let god_rays = include_str!("../assets/shaders/god_rays.wgsl");
    let rust = include_str!("../src/rendering/effects/god_rays.rs");

    assert!(god_rays.contains("var<storage, read> naadf_froxel_mask"));
    assert!(god_rays.contains("fn naadf_froxel_column_visibility"));
    assert!(god_rays.contains("naadf_froxel_depth_sample_count"));
    assert!(god_rays.contains("naadf_froxel_strength"));
    assert!(god_rays.contains("naadf_froxel_column_visibility(in.uv)"));
    assert!(rust.contains("NAADF Froxel GodRay Strength"));
}

#[test]
fn naadf_froxel_fog_integration_is_not_a_flat_scalar() {
    let fog = include_str!("../src/world/environment/atmosphere/fog.rs");

    assert_not_contains(
        fog,
        "naadf_froxel_fog_light_factor",
        "src/atmosphere/fog.rs",
    );
    assert_not_contains(fog, "* 0.85", "src/atmosphere/fog.rs");
}

#[test]
fn terrain_materials_participate_in_depth_prepass() {
    let triplanar = include_str!("../src/rendering/materials/triplanar.rs");
    let blocky = include_str!("../src/rendering/materials/blocky.rs");
    let compact_triplanar = triplanar.split_whitespace().collect::<Vec<_>>().join(" ");
    let compact_blocky = blocky.split_whitespace().collect::<Vec<_>>().join(" ");

    assert!(
        compact_triplanar.contains("fn enable_prepass() -> bool { true }"),
        "triplanar terrain must write prepass depth for water compositing and god rays"
    );
    assert!(
        compact_blocky.contains("fn enable_prepass() -> bool { true }"),
        "blocky terrain must write prepass depth for water compositing and god rays"
    );
}

#[test]
fn terrain_caustics_do_not_tint_vertical_lod_walls() {
    let triplanar = include_str!("../assets/shaders/triplanar_terrain.wgsl");

    assert!(
        triplanar.contains("caustic_surface_mask = smoothstep(0.25, 0.65, world_normal.y)"),
        "underwater caustics should be gated to upward-facing terrain, not vertical LOD sidewalls"
    );
    assert!(
        triplanar.contains("* shoreline_caustic_falloff * caustic_surface_mask"),
        "caustic tint should include the surface-angle mask"
    );
}

#[test]
fn blocky_caustics_do_not_tint_vertical_lod_walls() {
    let blocky = include_str!("../assets/shaders/blocky_terrain.wgsl");

    assert!(
        blocky.contains("caustic_surface_mask = smoothstep(0.25, 0.65, pbr_input.world_normal.y)"),
        "blocky terrain caustics should be gated to upward-facing terrain, not vertical LOD sidewalls"
    );
    assert!(
        blocky.contains("* shoreline_caustic_falloff * caustic_surface_mask"),
        "blocky caustic tint should include the surface-angle mask"
    );
}

#[test]
fn triplanar_normal_lod_uses_camera_distance() {
    let triplanar = include_str!("../assets/shaders/triplanar_terrain.wgsl");

    assert!(
        triplanar.contains("mesh_view_bindings::view"),
        "triplanar terrain should import the view uniform for camera-relative LOD decisions"
    );
    assert!(
        triplanar.contains("length(view.world_position - pbr_input.world_position.xyz)"),
        "triplanar normal-map LOD should use camera distance, not distance from world origin"
    );
    assert!(
        !triplanar.contains("let frag_dist = length(pbr_input.world_position.xyz);"),
        "normal-map LOD must not depend on absolute world coordinates"
    );
}

#[test]
fn gtao_is_registered_as_a_real_post_process_node() {
    let gtao = include_str!("../src/rendering/effects/gtao.rs");
    let gtao_shader = include_str!("../assets/shaders/gtao_main.wgsl");
    let compact = gtao.split_whitespace().collect::<Vec<_>>().join(" ");

    assert!(
        compact.contains("add_render_graph_node::<ViewNodeRunner<GtaoNode>>(Core3d, GtaoLabel)"),
        "GTAO must be registered in the Core3d graph"
    );
    assert!(
        compact.contains("Node3d::EndMainPass, GtaoLabel, WaterReflectionCompositorLabel"),
        "GTAO should run after the main pass and before water/god-ray compositing"
    );
    assert!(
        compact.contains("render_pass.draw(0..3, 0..1)"),
        "GTAO node should execute a fullscreen pass"
    );
    assert!(
        !gtao.contains("GTAO implementation stub"),
        "GTAO should not be left as a no-op stub"
    );
    assert!(
        gtao_shader.contains("scene_texture") && gtao_shader.contains("depth_texture"),
        "GTAO shader should sample scene color and prepass depth"
    );
    assert!(
        gtao_shader.contains("center_depth <= 0.001"),
        "GTAO should treat Bevy reversed-Z near-zero depth as sky/far clear"
    );
    assert!(
        gtao_shader.contains("sample_depth - center_depth"),
        "GTAO occluder tests should compare closer reversed-Z samples against the center depth"
    );
    assert!(
        gtao_shader.contains("4u") && !gtao_shader.contains(", 2u)"),
        "GTAO shader should allow the configured High/Ultra 3-4 sample quality"
    );
    assert!(
        !std::path::Path::new("assets/shaders/gtao_prepass.wgsl").exists()
            && !std::path::Path::new("assets/shaders/gtao_denoise.wgsl").exists(),
        "inactive GTAO prototype shaders should not be shipped as active-looking assets"
    );
}

#[test]
fn internal_shader_handles_are_unique_for_water_and_god_rays() {
    let water = include_str!("../src/rendering/water/mod.rs");
    let god_rays = include_str!("../src/rendering/effects/god_rays.rs");

    let noble_gerstner_uuid = water
        .lines()
        .skip_while(|line| !line.contains("NOBLE_GERSTNER_HANDLE"))
        .find_map(uuid_from_line)
        .expect("NOBLE_GERSTNER_HANDLE should use uuid_handle!");
    let god_rays_uuid = god_rays
        .lines()
        .skip_while(|line| !line.contains("GOD_RAYS_SHADER_HANDLE"))
        .find_map(uuid_from_line)
        .expect("GOD_RAYS_SHADER_HANDLE should use uuid_handle!");

    assert_ne!(
        noble_gerstner_uuid, god_rays_uuid,
        "internal shader handles must not alias the same asset UUID"
    );
}

#[test]
fn pcss_is_not_advertised_as_active_without_shader_integration() {
    let pcss = include_str!("../src/rendering/shadows/pcss.rs");
    let pcss_config = include_str!("../assets/config/pcss.yaml");

    assert!(
        pcss.contains("config.enabled = false"),
        "PCSS plugin should disable the compatibility config until shader integration exists"
    );
    assert!(
        !pcss.contains("PcssShadows"),
        "PCSS should not tag lights with a marker that the render path never consumes"
    );
    assert!(
        pcss_config.contains("enabled: false"),
        "PCSS config should not default to an advertised active state"
    );
    assert!(
        !std::path::Path::new("assets/shaders/pcss_shadows.wgsl").exists(),
        "inactive PCSS utility shader should not be shipped as an active-looking shader"
    );
}

#[test]
fn contact_shadows_are_not_shipped_as_unused_placeholder_shader() {
    let grass = include_str!("../assets/shaders/grass.wgsl");

    assert!(
        grass.contains("fn compute_grass_self_shadow"),
        "grass contact shadows should live in the compiled grass material shader"
    );
    assert!(
        !std::path::Path::new("assets/shaders/contact_shadows.wgsl").exists(),
        "unused standalone contact_shadows.wgsl should not be shipped as an active-looking shader"
    );
}

#[test]
fn volumetric_clouds_are_not_shipped_as_inactive_prototype_shaders() {
    let rendering_mod = include_str!("../src/rendering/mod.rs");

    assert!(
        !rendering_mod.contains("volumetric_clouds"),
        "inactive volumetric cloud prototypes should not be advertised from the rendering module"
    );
    assert!(
        !std::path::Path::new("src/rendering/volumetric_clouds.rs").exists(),
        "unused volumetric_clouds.rs prototype should not be compiled as an active-looking module"
    );
    assert!(
        !std::path::Path::new("assets/shaders/volumetric_clouds.wgsl").exists()
            && !std::path::Path::new("assets/shaders/cloud_noise.wgsl").exists(),
        "unused volumetric cloud prototype shaders should not be shipped as active-looking assets"
    );
}

#[test]
fn inactive_sdf_and_stochastic_probe_prototypes_are_not_shipped_as_shaders() {
    let radiance = include_str!("../assets/shaders/radiance_cascades.wgsl");

    assert!(
        radiance.contains("fn soft_shadow_backend"),
        "active SDF-style shadow routing should live in the compiled radiance cascade shader"
    );
    assert!(
        !std::path::Path::new("assets/shaders/sdf_shadows.wgsl").exists(),
        "unused standalone sdf_shadows.wgsl should not be shipped as an active-looking shader"
    );
    assert!(
        !std::path::Path::new("assets/shaders/stochastic_probes.wgsl").exists(),
        "unused stochastic probe prototype shader should not be shipped as an active-looking shader"
    );
}

#[test]
fn inactive_vegetation_and_water_foam_prototypes_are_not_shipped_as_shaders() {
    let grass = include_str!("../assets/shaders/grass.wgsl");
    let water_fragment = include_str!("../assets/shaders/water_fragment.wgsl");
    let water = include_str!("../src/rendering/water/mod.rs");

    assert!(
        grass.contains("fn simple_wrap_lighting"),
        "active vegetation SSS should live in the compiled grass shader"
    );
    assert!(
        water_fragment.contains("#import noble_foam"),
        "active water foam should route through the compiled Noble foam shader"
    );
    assert!(
        !water.contains("WATER_FOAM_HANDLE") && !water.contains("/assets/shaders/water_foam.wgsl"),
        "unused water_foam.wgsl should not be registered as an internal shader asset"
    );
    assert!(
        !std::path::Path::new("assets/shaders/sss_vegetation.wgsl").exists(),
        "unused standalone sss_vegetation.wgsl should not be shipped as an active-looking shader"
    );
    assert!(
        !std::path::Path::new("assets/shaders/wind_animation.wgsl").exists(),
        "unused standalone wind_animation.wgsl should not be shipped as an active-looking shader"
    );
    assert!(
        !std::path::Path::new("assets/shaders/water_foam.wgsl").exists(),
        "unused standalone water_foam.wgsl should not be shipped as an active-looking shader"
    );
}

#[test]
fn inactive_weather_particle_classifier_is_not_shipped_as_shader() {
    let rendering_plugin = include_str!("../src/rendering/plugin.rs");
    let weather_overlay = include_str!("../assets/shaders/weather_overlay.wgsl");

    assert!(
        weather_overlay.contains("rain_streak_mask") && weather_overlay.contains("snow_flake_mask"),
        "active precipitation rendering should live in the fullscreen weather overlay shader"
    );
    assert!(
        !rendering_plugin.contains("WEATHER_PARTICLE_CLASSIFY_HANDLE")
            && !rendering_plugin.contains("/assets/shaders/weather_particle_classify.wgsl"),
        "inert weather particle classifier should not be registered as an internal shader asset"
    );
    assert!(
        !std::path::Path::new("assets/shaders/weather_particle_classify.wgsl").exists(),
        "unused weather_particle_classify.wgsl should not be shipped as an active-looking shader"
    );
}

#[test]
fn disabled_foliage_prepass_shaders_are_not_registered_or_shipped() {
    let grass_material = include_str!("../src/world/environment/vegetation/grass_material.rs");
    let billboard_material = include_str!("../src/props/billboard.rs");

    assert!(
        grass_material.contains("fn enable_prepass() -> bool") && grass_material.contains("false"),
        "grass material should keep prepass disabled until its alpha-cutout prepass is migrated"
    );
    assert!(
        billboard_material.contains("fn enable_prepass() -> bool")
            && billboard_material.contains("false"),
        "billboard material should keep prepass disabled until its alpha-cutout prepass is stable"
    );
    assert!(
        !grass_material.contains("grass_prepass.wgsl")
            && !std::path::Path::new("assets/shaders/grass_prepass.wgsl").exists(),
        "disabled grass prepass shader should not be registered or shipped as active-looking"
    );
    assert!(
        !billboard_material.contains("billboard_prepass.wgsl")
            && !std::path::Path::new("assets/shaders/billboard_prepass.wgsl").exists(),
        "disabled billboard prepass shader should not be registered or shipped as active-looking"
    );
}

#[test]
fn inactive_legacy_water_and_sdf_volume_shaders_are_not_shipped() {
    let water = include_str!("../src/rendering/water/mod.rs");
    let water_fragment = include_str!("../assets/shaders/water_fragment.wgsl");
    let radiance = include_str!("../assets/shaders/radiance_cascades.wgsl");

    assert!(
        water_fragment.contains("#import noble_gerstner")
            && water_fragment.contains("#import noble_detail_normals"),
        "active water waves/detail normals should use the compiled Noble shader modules"
    );
    assert!(
        radiance.contains("@group(0) @binding(1) var sdf_volume: texture_3d<f32>;"),
        "active radiance SDF sampling should live in the compiled radiance cascade shader"
    );
    assert!(
        !water.contains("GERSTNER_WAVES_HANDLE")
            && !water.contains("/assets/shaders/gerstner_waves.wgsl"),
        "unused legacy gerstner_waves.wgsl should not be registered as an internal shader asset"
    );
    assert!(
        !std::path::Path::new("assets/shaders/gerstner_waves.wgsl").exists(),
        "unused legacy gerstner_waves.wgsl should not be shipped as an active-looking shader"
    );
    assert!(
        !std::path::Path::new("assets/shaders/water_detail_normals.wgsl").exists(),
        "unused texture-bound water_detail_normals.wgsl should not be shipped as active-looking"
    );
    assert!(
        !std::path::Path::new("assets/shaders/sdf_volume.wgsl").exists(),
        "unused sdf_volume.wgsl compute prototype should not be shipped as active-looking"
    );
}

fn uuid_from_line(line: &str) -> Option<&str> {
    let start = line.find("uuid_handle!(\"")? + "uuid_handle!(\"".len();
    let rest = &line[start..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}
