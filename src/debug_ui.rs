use crate::props::foliage::{FoliageFadeSettings, GrassPropWindSettings};
use crate::rendering::array_loader::AtlasMapping;
#[cfg(feature = "naadf")]
use crate::rendering::naadf::{NaadfConfig, NaadfStats};
use crate::rendering::ray_tracing::RayTracingSettings;
use crate::rendering::triplanar_material::{TriplanarMaterial, TriplanarMaterialHandle};
use crate::rendering::water::WaterShaderToggles;
use crate::vegetation::VegetationConfig;
#[cfg(debug_assertions)]
use crate::vegetation::{GrassBlade, ProceduralGrassPatch};
#[cfg(debug_assertions)]
use crate::voxel::meshing::WaterMesh;
use crate::voxel::plugin::LodSettings;
use bevy::prelude::*;
use bevy_egui::{EguiContexts, EguiPlugin, egui};
use bevy_inspector_egui::quick::WorldInspectorPlugin;

#[derive(Resource, Default)]
pub struct DebugUiState {
    pub show_inspector: bool,
    pub show_settings: bool,
}

/// Controls terrain visual style settings.
/// Persists the ao_strength value that gets applied to the triplanar material.
#[derive(Resource)]
pub struct TerrainStyleSettings {
    /// Baked AO strength (0.0 = V0.3 soft look, 1.0 = full baked AO)
    pub ao_strength: f32,
}

impl Default for TerrainStyleSettings {
    fn default() -> Self {
        Self {
            ao_strength: 0.0, // Default to V0.3 look
        }
    }
}

pub struct DebugUiPlugin;

impl Plugin for DebugUiPlugin {
    fn build(&self, app: &mut App) {
        if !app.is_plugin_added::<EguiPlugin>() {
            app.add_plugins(EguiPlugin::default());
        }

        // Add WorldInspectorPlugin but control its visibility?
        // quick::WorldInspectorPlugin doesn't support easy toggling via resource out of the box in older versions,
        // but let's assume we can just add it and it renders.
        // Actually, for better control, we might want to manually invoke it or use a run_if.
        // For now, let's just add it. It puts a window on screen.
        app.add_plugins(WorldInspectorPlugin::new().run_if(should_show_inspector));

        app.init_resource::<DebugUiState>()
            .init_resource::<TerrainStyleSettings>()
            .add_systems(
                Update,
                (
                    toggle_debug_ui,
                    debug_settings_ui,
                    toggle_ao_style,
                    toggle_ssao_key,
                    toggle_sun_shadows,
                    apply_terrain_style_settings,
                ),
            );

        #[cfg(debug_assertions)]
        app.add_systems(Update, toggle_scene_visibility);
    }
}

fn should_show_inspector(state: Res<DebugUiState>) -> bool {
    state.show_inspector
}

fn toggle_debug_ui(mut state: ResMut<DebugUiState>, keys: Res<ButtonInput<KeyCode>>) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    if shift_held && keys.just_pressed(KeyCode::F4) {
        state.show_inspector = !state.show_inspector;
        state.show_settings = !state.show_settings;
    }
}

fn debug_settings_ui(
    mut contexts: EguiContexts,
    state: Res<DebugUiState>,
    mut lod_settings: ResMut<LodSettings>,
    mut terrain_style: ResMut<TerrainStyleSettings>,
    atlas_mapping: Option<ResMut<AtlasMapping>>,
    veg_config: Option<ResMut<VegetationConfig>>,
    prop_fade: Option<ResMut<FoliageFadeSettings>>,
    prop_wind: Option<ResMut<GrassPropWindSettings>>,
    mut water_shader_toggles: ResMut<WaterShaderToggles>,
    ray_tracing: Option<Res<RayTracingSettings>>,
    #[cfg(feature = "naadf")] naadf_stats: Option<Res<NaadfStats>>,
    #[cfg(feature = "naadf")] mut naadf_config: Option<ResMut<NaadfConfig>>,
    mut sun_query: Query<&mut DirectionalLight>,
) {
    if !state.show_settings {
        return;
    }

    egui::Window::new("Game Tweaks").show(
        contexts.ctx_mut().ok().expect("Failed to get Egui context"),
        |ui| {
            ui.heading("LOD Settings");
            ui.add(
                egui::Slider::new(&mut lod_settings.high_detail_distance, 32.0..=512.0)
                    .text("High Detail Dist"),
            );
            ui.add(
                egui::Slider::new(&mut lod_settings.cull_distance, 64.0..=1024.0).text("Cull Dist"),
            );
            lod_settings.clamp_distance_bands();

            ui.separator();
            ui.heading("Terrain Style");
            ui.add(
                egui::Slider::new(&mut terrain_style.ao_strength, 0.0..=1.0)
                    .text("Baked AO Strength"),
            );
            ui.label("0 = V0.3 soft look, 1 = full baked AO");

            ui.separator();
            ui.heading("Water Shaders");
            ui.checkbox(
                &mut water_shader_toggles.gerstner,
                "Gerstner wave normals + displacement",
            );
            ui.checkbox(
                &mut water_shader_toggles.voronoi_foam,
                "Multi-scale Voronoi foam",
            );
            ui.add_enabled(
                false,
                egui::Checkbox::new(
                    &mut water_shader_toggles.detail_normals,
                    "Detail normals (pending Noble port)",
                ),
            );
            ui.add_enabled(
                false,
                egui::Checkbox::new(
                    &mut water_shader_toggles.water_parallax,
                    "Water parallax (pending Noble port)",
                ),
            );
            ui.label("Toggles affect render perf — rerun bench after changes");

            if let Some(ray_tracing) = ray_tracing {
                ui.separator();
                ui.heading("Voxel Ray Backend");
                ui.label(format!("Backend: {}", ray_tracing.voxel_backend.as_str()));
                ui.label(format!(
                    "Render mode: {}",
                    ray_tracing.experimental_mode.as_str()
                ));
                if let Some(reason) = ray_tracing.fallback_reason.as_deref() {
                    ui.label(format!("Fallback: {reason}"));
                }
                #[cfg(feature = "naadf")]
                if let Some(config) = naadf_config.as_deref_mut() {
                    ui.checkbox(&mut config.enabled, "Enable NAADF cache");
                    ui.checkbox(
                        &mut config.use_for_sun_visibility,
                        "Use NAADF sun visibility",
                    );
                    ui.checkbox(&mut config.use_for_terrain_ao, "Use NAADF terrain AO");
                    ui.checkbox(
                        &mut config.use_for_contact_shadows,
                        "Use NAADF contact shadows",
                    );
                }
                #[cfg(feature = "naadf")]
                if let Some(stats) = naadf_stats.as_deref() {
                    ui.label(format!(
                        "NAADF cache: {} chunks, {} dirty pending, {} in flight",
                        stats.loaded_chunks, stats.dirty_pending, stats.dirty_in_flight
                    ));
                    ui.label(format!(
                        "NAADF streaming interest: {} chunks",
                        stats.streaming_interest_chunks
                    ));
                    ui.label(format!(
                        "NAADF GPU memory: {} bytes",
                        stats.gpu_memory_bytes
                    ));
                    ui.label(format!(
                        "NAADF GPU slots: {}/{} used, {} free",
                        stats.gpu_slots_used, stats.gpu_max_chunks, stats.gpu_slots_available
                    ));
                    ui.label(format!(
                        "NAADF reserved/free-list: {}/{} ({:.0}% fragmentation)",
                        stats.gpu_slots_reserved,
                        stats.gpu_slots_free_list,
                        stats.gpu_slot_fragmentation * 100.0
                    ));
                    ui.label(format!(
                        "NAADF uploads: {} pending, {} chunks / {} bytes last frame",
                        stats.gpu_uploads_pending,
                        stats.gpu_uploaded_chunks_last_frame,
                        stats.gpu_uploaded_bytes_last_frame
                    ));
                    ui.label(format!(
                        "NAADF GPU avg ray steps: {:.1}",
                        stats.gpu_avg_ray_steps_last_frame
                    ));
                    ui.label(format!(
                        "NAADF GPU build queue: {} pending, oldest {} frames",
                        stats.gpu_build_queue_pending, stats.gpu_build_queue_oldest_age_frames
                    ));
                }
            }

            // Atlas Mapping UI moved to Pause Menu > Settings > Textures
            if let Some(_mapping) = atlas_mapping {
                // Placeholder to keep the param valid if needed, or just remove it.
            }

            ui.separator();
            if let Some(mut veg) = veg_config {
                ui.heading("Vegetation");
                ui.add(egui::Slider::new(&mut veg.grass_density, 1..=100).text("Grass Density"));
                ui.add(
                    egui::Slider::new(&mut veg.max_blades_per_chunk, 100..=5000)
                        .text("Max Blades/Chunk"),
                );
                ui.label("Note: density/max changes affect new chunks only");
                ui.separator();
                ui.heading("Wind");
                ui.add(egui::Slider::new(&mut veg.wind_strength, 0.0..=1.0).text("Wind Strength"));
                ui.add(egui::Slider::new(&mut veg.wind_speed, 0.5..=5.0).text("Wind Speed"));
                ui.separator();
                ui.heading("Near Fade");
                ui.add(egui::Slider::new(&mut veg.near_fade_start, 0.0..=3.0).text("Fade Start"));
                ui.add(egui::Slider::new(&mut veg.near_fade_end, 0.0..=6.0).text("Fade End"));
                ui.add(
                    egui::Slider::new(&mut veg.near_fade_min_alpha, 0.0..=1.0).text("Min Alpha"),
                );
            }

            if let Some(mut prop_fade) = prop_fade {
                ui.separator();
                ui.heading("Prop Foliage");
                ui.add(
                    egui::Slider::new(&mut prop_fade.near_fade_start, 0.0..=5.0).text("Fade Start"),
                );
                ui.add(egui::Slider::new(&mut prop_fade.near_fade_end, 0.0..=8.0).text("Fade End"));
                ui.add(
                    egui::Slider::new(&mut prop_fade.near_fade_min_alpha, 0.0..=1.0)
                        .text("Min Alpha"),
                );
                ui.add(
                    egui::Slider::new(&mut prop_fade.max_update_distance, 1.0..=15.0)
                        .text("Max Distance (cap 15)"),
                );
                ui.add(
                    egui::Slider::new(&mut prop_fade.max_distance_scale, 0.5..=4.0)
                        .text("Max Distance Scale"),
                );
                ui.checkbox(&mut prop_fade.front_only, "Front Only");
                ui.add(
                    egui::Slider::new(&mut prop_fade.front_cone_cos, 0.0..=1.0)
                        .text("Front Cone (cos)"),
                );
                ui.add(
                    egui::Slider::new(&mut prop_fade.update_interval, 0.0..=0.3)
                        .text("Update Interval"),
                );
            }

            if let Some(mut prop_wind) = prop_wind {
                ui.separator();
                ui.heading("Grass Props Wind");
                ui.add(
                    egui::Slider::new(&mut prop_wind.sway_strength, 0.0..=0.6)
                        .text("Sway Strength"),
                );
                ui.add(egui::Slider::new(&mut prop_wind.sway_speed, 0.0..=3.0).text("Sway Speed"));
                ui.add(
                    egui::Slider::new(&mut prop_wind.push_radius, 0.5..=4.0).text("Push Radius"),
                );
                ui.add(
                    egui::Slider::new(&mut prop_wind.push_strength, 0.0..=1.0)
                        .text("Push Strength"),
                );
                ui.add(
                    egui::Slider::new(&mut prop_wind.max_effect_distance, 2.0..=120.0)
                        .text("Max Distance"),
                );
                ui.add(
                    egui::Slider::new(&mut prop_wind.update_interval, 0.0..=0.3)
                        .text("Update Interval"),
                );
            }

            ui.separator();
            ui.heading("Sun Shadows");
            for mut light in sun_query.iter_mut() {
                ui.checkbox(&mut light.shadows_enabled, "Enable Shadows");
                ui.add(
                    egui::Slider::new(&mut light.shadow_depth_bias, 0.0..=0.2).text("Depth Bias"),
                );
                ui.add(
                    egui::Slider::new(&mut light.shadow_normal_bias, 0.0..=5.0).text("Normal Bias"),
                );
            }

            ui.separator();
            ui.label("Press Shift+F4 to toggle this window and Inspector");
            ui.label("Press F8 to toggle AO style (V0.3 <-> Full)");
            ui.label("Press F9 to toggle SSAO/GTAO");
            ui.label("Press Shift+F9 to dump terrain hole probe JSON");
            ui.label("Press Shift+F10 to dump water visual probe JSON");
            ui.label("Press F10 to toggle Sun Shadows");
            ui.label("Press F11 to cycle voxel ray backend");
        },
    );
}

/// Toggle Sun shadows with F10
fn toggle_sun_shadows(
    mut sun_query: Query<&mut DirectionalLight>,
    keys: Res<ButtonInput<KeyCode>>,
) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    if !shift_held && keys.just_pressed(KeyCode::F10) {
        for mut light in sun_query.iter_mut() {
            light.shadows_enabled = !light.shadows_enabled;
            info!(
                "Sun Shadows: {} (F10 to toggle)",
                if light.shadows_enabled { "ON" } else { "OFF" }
            );
        }
    }
}
fn toggle_ao_style(
    keys: Res<ButtonInput<KeyCode>>,
    mut terrain_style: ResMut<TerrainStyleSettings>,
) {
    if keys.just_pressed(KeyCode::F8) {
        // Toggle between 0.0 (V0.3 look) and 1.0 (full AO)
        terrain_style.ao_strength = if terrain_style.ao_strength < 0.5 {
            1.0
        } else {
            0.0
        };
        let style_name = if terrain_style.ao_strength < 0.5 {
            "V0.3 (soft)"
        } else {
            "Full AO"
        };
        info!("Terrain style: {} (F8 to toggle)", style_name);
    }
}

/// Toggle SSAO with F9 key to identify if dark shadows come from screen-space AO
/// Toggle SSAO/GTAO with F9 key to identify if dark shadows come from screen-space AO
fn toggle_ssao_key(
    mut commands: Commands,
    keys: Res<ButtonInput<KeyCode>>,
    cameras: Query<
        (
            Entity,
            Option<&bevy::pbr::ScreenSpaceAmbientOcclusion>,
            Option<&crate::rendering::gtao::GtaoSettings>,
        ),
        With<Camera3d>,
    >,
    mut ssao_enabled: Local<bool>,
) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    if !shift_held && keys.just_pressed(KeyCode::F9) {
        *ssao_enabled = !*ssao_enabled;
        for (entity, existing_ssao, existing_gtao) in cameras.iter() {
            if *ssao_enabled {
                // Re-enable SS AO features
                if existing_ssao.is_none() {
                    commands
                        .entity(entity)
                        .insert(bevy::pbr::ScreenSpaceAmbientOcclusion::default());
                }
                if existing_gtao.is_none() {
                    commands
                        .entity(entity)
                        .insert(crate::rendering::gtao::GtaoSettings::default());
                }
                info!("SSAO/GTAO: ON (F9 to toggle)");
            } else {
                // Disable all SS AO features
                if existing_ssao.is_some() {
                    commands
                        .entity(entity)
                        .remove::<bevy::pbr::ScreenSpaceAmbientOcclusion>();
                }
                if existing_gtao.is_some() {
                    commands
                        .entity(entity)
                        .remove::<crate::rendering::gtao::GtaoSettings>();
                }
                info!("SSAO/GTAO: OFF (F9 to toggle)");
            }
        }
    }
}

/// Apply terrain style settings to the triplanar material
fn apply_terrain_style_settings(
    terrain_style: Res<TerrainStyleSettings>,
    mat_handle: Option<Res<TriplanarMaterialHandle>>,
    mut materials: ResMut<Assets<TriplanarMaterial>>,
) {
    if !terrain_style.is_changed() {
        return;
    }

    let Some(handle) = mat_handle else { return };

    // Check current value first (immutable access doesn't trigger change detection)
    let needs_update = materials
        .get(&handle.handle)
        .is_some_and(|m| (m.uniforms.ao_strength - terrain_style.ao_strength).abs() > 0.001);

    if needs_update {
        if let Some(material) = materials.get_mut(&handle.handle) {
            material.uniforms.ao_strength = terrain_style.ao_strength;
        }
    }
}

#[cfg(debug_assertions)]
#[derive(Debug)]
struct DebugVisibilityToggles {
    show_water: bool,
    show_grass: bool,
}

#[cfg(debug_assertions)]
impl Default for DebugVisibilityToggles {
    fn default() -> Self {
        Self {
            show_water: true,
            show_grass: true,
        }
    }
}

#[cfg(debug_assertions)]
fn toggle_scene_visibility(
    keys: Res<ButtonInput<KeyCode>>,
    mut visibility_queries: ParamSet<(
        Query<&mut Visibility, With<bevy_water::WaterTiles>>,
        Query<&mut Visibility, With<WaterMesh>>,
        Query<&mut Visibility, With<GrassBlade>>,
        Query<&mut Visibility, With<ProceduralGrassPatch>>,
    )>,
    mut toggles: Local<DebugVisibilityToggles>,
) {
    let mut water_changed = false;
    let mut grass_changed = false;

    if keys.just_pressed(KeyCode::F6) {
        toggles.show_water = !toggles.show_water;
        water_changed = true;
    }

    if keys.just_pressed(KeyCode::F7) {
        toggles.show_grass = !toggles.show_grass;
        grass_changed = true;
    }

    if water_changed {
        let water_visibility = if toggles.show_water {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };

        for mut visibility in visibility_queries.p0().iter_mut() {
            *visibility = water_visibility;
        }

        for mut visibility in visibility_queries.p1().iter_mut() {
            *visibility = water_visibility;
        }

        info!("Water visibility: {}", toggles.show_water);
    }

    if grass_changed {
        let grass_visibility = if toggles.show_grass {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };

        for mut visibility in visibility_queries.p2().iter_mut() {
            *visibility = grass_visibility;
        }

        for mut visibility in visibility_queries.p3().iter_mut() {
            *visibility = grass_visibility;
        }

        info!("Grass visibility: {}", toggles.show_grass);
    }
}
