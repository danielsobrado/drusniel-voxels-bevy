use crate::audio::events::{AudioEventId, GameAudioEvent};
use crate::props::foliage::{FoliageFadeSettings, GrassPropWindSettings};
use crate::rendering::ao_config::AmbientOcclusionConfig;
use crate::rendering::array_loader::AtlasMapping;
#[cfg(feature = "naadf")]
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::gtao::gtao_settings_from_config;
#[cfg(feature = "naadf")]
use crate::rendering::naadf::{
    NaadfCacheState, NaadfConfig, NaadfDenoiseQuality, NaadfPreviewCompositeModeConfig, NaadfStats,
};
#[cfg(not(feature = "naadf"))]
use crate::rendering::ray_tracing::NAADF_NOT_COMPILED_REASON;
#[cfg(feature = "naadf")]
use crate::rendering::ray_tracing::{
    ExperimentalRenderMode, VoxelRayBackendMode, activate_naadf_preview,
};
use crate::rendering::ray_tracing::{
    RayTracingSettings, VOXEL_RAY_NOTICE_SECONDS, VoxelRayBackendNotice,
};
use crate::rendering::triplanar_material::{TriplanarMaterial, TriplanarMaterialHandle};
use crate::rendering::water::WaterShaderToggles;
use crate::ui::theme;
use crate::vegetation::VegetationConfig;
#[cfg(debug_assertions)]
use crate::vegetation::{GrassBlade, ProceduralGrassPatch};
#[cfg(debug_assertions)]
use crate::voxel::meshing::WaterMesh;
use crate::voxel::plugin::LodSettings;
use bevy::prelude::*;
use bevy_egui::{EguiContexts, EguiPlugin, egui};
use bevy_inspector_egui::quick::WorldInspectorPlugin;

pub fn apply_drusniel_egui_style(ctx: &egui::Context) {
    let mut style = (*ctx.style()).clone();
    style.visuals = theme::fantasy_egui_visuals();
    style.visuals.window_fill = theme::DR_EGUI_DEBUG_WINDOW_FILL;
    style.visuals.panel_fill = theme::DR_EGUI_DEBUG_PANEL_FILL;
    style.visuals.extreme_bg_color = theme::DR_EGUI_DEBUG_EXTREME_BG;
    style.visuals.faint_bg_color = theme::DR_EGUI_DEBUG_FAINT_BG;
    style.visuals.window_stroke = egui::Stroke::new(1.5, theme::DR_EGUI_PANEL_BORDER);
    style.visuals.widgets.noninteractive.fg_stroke =
        egui::Stroke::new(1.0, theme::DR_EGUI_TEXT_MUTED);
    style.visuals.widgets.inactive.bg_stroke =
        egui::Stroke::new(1.0, theme::DR_EGUI_DEBUG_INACTIVE_STROKE);
    style.visuals.widgets.hovered.bg_stroke = egui::Stroke::new(1.0, theme::DR_EGUI_GOLD);
    style.visuals.widgets.active.bg_stroke = egui::Stroke::new(1.5, theme::DR_EGUI_GOLD);
    style.visuals.widgets.noninteractive.corner_radius = egui::CornerRadius::same(4);
    style.visuals.widgets.inactive.corner_radius = egui::CornerRadius::same(4);
    style.visuals.widgets.hovered.corner_radius = egui::CornerRadius::same(4);
    style.visuals.widgets.active.corner_radius = egui::CornerRadius::same(4);
    style.visuals.widgets.open.corner_radius = egui::CornerRadius::same(4);
    style.visuals.selection.bg_fill = theme::DR_EGUI_DEBUG_SELECTION_BG;
    style.visuals.selection.stroke = egui::Stroke::new(1.0, theme::DR_EGUI_GOLD);
    style.spacing.item_spacing = egui::vec2(8.0, 6.0);
    style.spacing.button_padding = egui::vec2(8.0, 5.0);
    style.spacing.slider_width = 180.0;
    ctx.set_style(style);
}

#[derive(Resource, Default)]
pub struct DebugUiState {
    pub show_inspector: bool,
    pub show_settings: bool,
}

impl DebugUiState {
    pub fn needs_cursor(&self) -> bool {
        self.show_inspector || self.show_settings
    }

    fn toggle_shortcut(&mut self, control_held: bool) {
        if control_held {
            self.show_inspector = !self.show_inspector;
        } else {
            self.show_settings = !self.show_settings;
            if !self.show_settings {
                self.show_inspector = false;
            }
        }
    }
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

        app.add_systems(Update, toggle_naadf_split_view_key);

        #[cfg(debug_assertions)]
        app.add_systems(Update, toggle_scene_visibility);
    }
}

fn should_show_inspector(state: Res<DebugUiState>) -> bool {
    state.show_inspector
}

fn toggle_debug_ui(
    mut state: ResMut<DebugUiState>,
    keys: Res<ButtonInput<KeyCode>>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    let control_held = keys.pressed(KeyCode::ControlLeft) || keys.pressed(KeyCode::ControlRight);
    if shift_held && keys.just_pressed(KeyCode::F4) {
        let before = state.show_settings;
        state.toggle_shortcut(control_held);
        let after = state.show_settings;
        if before != after {
            if after {
                audio_events.write(GameAudioEvent::ui(AudioEventId::DebugPanelOpen));
            } else {
                audio_events.write(GameAudioEvent::ui(AudioEventId::DebugPanelClose));
            }
        }
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
    #[cfg(feature = "naadf")] naadf_cache_state: Option<Res<NaadfCacheState>>,
    #[cfg(feature = "naadf")] mut naadf_config: Option<ResMut<NaadfConfig>>,
    mut sun_query: Query<&mut DirectionalLight>,
) {
    if !state.show_settings {
        return;
    }

    let Ok(ctx) = contexts.ctx_mut() else {
        return;
    };
    apply_drusniel_egui_style(ctx);

    egui::Window::new("Game Tweaks").show(ctx, |ui| {
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
                ui.label(format!(
                    "Requested backend: {}",
                    ray_tracing.voxel_backend.as_str()
                ));
                ui.label(format!(
                    "Effective backend: {}",
                    ray_tracing.effective_backend().as_str()
                ));
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
                        &mut config.gpu.allow_integrated_gpu,
                        "NAADF allow integrated GPU",
                    );
                    ui.checkbox(&mut config.gpu.prefer_gpu_builder, "NAADF prefer GPU builder");
                    ui.checkbox(&mut config.gpu.debug_readback, "NAADF GPU debug readback");
                    ui.checkbox(&mut config.debug.compare_cpu_gpu, "NAADF compare CPU/GPU");
                    ui.checkbox(&mut config.debug.force_cpu_builder, "NAADF force CPU builder");
                    ui.checkbox(&mut config.debug.force_gpu_builder, "NAADF force GPU builder");
                    ui.checkbox(
                        &mut config.use_for_sun_visibility,
                        "Use NAADF sun visibility",
                    );
                    ui.checkbox(&mut config.use_for_terrain_ao, "Use NAADF terrain AO");
                    ui.checkbox(
                        &mut config.use_for_contact_shadows,
                        "Use NAADF contact shadows",
                    );
                    ui.checkbox(
                        &mut config.preview.accumulation_enabled,
                        "NAADF preview accumulation",
                    );
                    ui.add(
                        egui::Slider::new(&mut config.preview.temporal_blend_factor, 0.0..=0.99)
                            .text("NAADF temporal blend"),
                    );
                    ui.add(
                        egui::Slider::new(&mut config.preview.max_ray_steps, 1..=1024)
                            .text("NAADF preview ray steps"),
                    );
                    ui.add(
                        egui::Slider::new(&mut config.preview.bounce_count, 0..=8)
                            .text("NAADF preview bounces"),
                    );
                    ui.add(
                        egui::Slider::new(&mut config.preview.gi_sky_strength, 0.0..=2.0)
                            .text("NAADF GI sky strength"),
                    );
                    ui.add(
                        egui::Slider::new(&mut config.preview.gi_bounce_strength, 0.0..=2.0)
                            .text("NAADF GI bounce strength"),
                    );
                    ui.checkbox(&mut config.preview.denoise_enabled, "NAADF preview denoise");
                    egui::ComboBox::from_label("NAADF denoise quality")
                        .selected_text(match config.preview.denoise_quality {
                            NaadfDenoiseQuality::Low => "Low",
                            NaadfDenoiseQuality::Medium => "Medium",
                            NaadfDenoiseQuality::High => "High",
                        })
                        .show_ui(ui, |ui| {
                            ui.selectable_value(
                                &mut config.preview.denoise_quality,
                                NaadfDenoiseQuality::Low,
                                "Low",
                            );
                            ui.selectable_value(
                                &mut config.preview.denoise_quality,
                                NaadfDenoiseQuality::Medium,
                                "Medium",
                            );
                            ui.selectable_value(
                                &mut config.preview.denoise_quality,
                                NaadfDenoiseQuality::High,
                                "High",
                            );
                        });
                    ui.add(
                        egui::Slider::new(&mut config.preview.spatial_radius, 0..=4)
                            .text("NAADF spatial radius"),
                    );
                    ui.add(
                        egui::Slider::new(&mut config.preview.spatial_depth_sigma, 0.001..=1.0)
                            .text("NAADF spatial depth sigma"),
                    );
                    ui.add(
                        egui::Slider::new(&mut config.preview.spatial_normal_sigma, 0.001..=1.0)
                            .text("NAADF spatial normal sigma"),
                    );
                    ui.checkbox(
                        &mut config.preview.reference_path_tracing_enabled,
                        "NAADF reference path trace",
                    );
                    ui.add(
                        egui::Slider::new(&mut config.preview.reference_sample_count, 1..=32)
                            .text("NAADF reference samples"),
                    );
                    ui.add(
                        egui::Slider::new(&mut config.preview.reference_sky_strength, 0.0..=2.0)
                            .text("NAADF reference sky"),
                    );
                    ui.add(
                        egui::Slider::new(
                            &mut config.preview.reference_indirect_strength,
                            0.0..=2.0,
                        )
                        .text("NAADF reference indirect"),
                    );
                    ui.checkbox(&mut config.preview.show_miss_sky, "NAADF preview miss sky");
                    egui::ComboBox::from_label("NAADF preview composite")
                        .selected_text(match config.preview.composite_mode {
                            NaadfPreviewCompositeModeConfig::Fullscreen => "Fullscreen",
                            NaadfPreviewCompositeModeConfig::SplitView => "Split",
                            NaadfPreviewCompositeModeConfig::PictureInPicture => "PIP",
                        })
                        .show_ui(ui, |ui| {
                            ui.selectable_value(
                                &mut config.preview.composite_mode,
                                NaadfPreviewCompositeModeConfig::Fullscreen,
                                "Fullscreen",
                            );
                            ui.selectable_value(
                                &mut config.preview.composite_mode,
                                NaadfPreviewCompositeModeConfig::SplitView,
                                "Split",
                            );
                            ui.selectable_value(
                                &mut config.preview.composite_mode,
                                NaadfPreviewCompositeModeConfig::PictureInPicture,
                                "PIP",
                            );
                        });
                    ui.add(
                        egui::Slider::new(&mut config.preview.history_resolution_scale, 0.25..=1.0)
                            .text("NAADF history scale"),
                    );
                }
                #[cfg(not(feature = "naadf"))]
                ui.label("NAADF feature: not compiled. Rebuild without --no-default-features.");
                #[cfg(feature = "naadf")]
                if let Some(cache_state) = naadf_cache_state.as_deref() {
                    ui.label(format!(
                        "NAADF cache state: {}",
                        if cache_state.ready {
                            "ready"
                        } else if cache_state.warming {
                            "warming"
                        } else {
                            "not ready"
                        }
                    ));
                    if let Some(reason) = cache_state.fallback_reason.as_deref() {
                        ui.label(format!("NAADF cache reason: {reason}"));
                    }
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
                        "NAADF residency mips: L0={} L1={} L2={} L3={} L4={}",
                        stats.streaming_mip0_chunks,
                        stats.streaming_mip1_chunks,
                        stats.streaming_mip2_chunks,
                        stats.streaming_mip3_chunks,
                        stats.streaming_mip4_chunks
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
                        "NAADF GPU ray steps: {:.1} avg / {} max / {} samples",
                        stats.gpu_avg_ray_steps_last_frame,
                        stats.gpu_max_ray_steps_last_frame,
                        stats.gpu_ray_samples_last_frame,
                    ));
                    ui.label(format!(
                        "NAADF first-hit misses: {} clean, {} voxel budget, {} chunk budget, {} distance",
                        stats.first_hit_clean_misses_last_frame,
                        stats.first_hit_voxel_budget_misses_last_frame,
                        stats.first_hit_chunk_budget_misses_last_frame,
                        stats.first_hit_distance_clamps_last_frame,
                    ));
                    ui.label(format!(
                        "NAADF GPU build queue: {} pending, oldest {} frames",
                        stats.gpu_build_queue_pending, stats.gpu_build_queue_oldest_age_frames
                    ));
                    ui.label(format!(
                        "NAADF chunk bounds: {} updates, {} unknown stops, {} saturated fields, {} passes",
                        stats.chunk_bound_updates_last_frame,
                        stats.chunk_bound_skipped_unknown_neighbors_last_frame,
                        stats.chunk_bound_saturated_fields_last_frame,
                        stats.chunk_bound_propagation_passes_last_frame,
                    ));
                    ui.label(format!(
                        "NAADF preview: {} pixels, passes FH/GI/S/T/D/R = {}/{}/{}/{}/{}/{}",
                        stats.preview_pixels_last_frame,
                        stats.preview_first_hit_dispatches_last_frame,
                        stats.preview_gi_dispatches_last_frame,
                        stats.preview_spatial_dispatches_last_frame,
                        stats.preview_temporal_dispatches_last_frame,
                        stats.preview_denoise_dispatches_last_frame,
                        stats.preview_reference_dispatches_last_frame,
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
            ui.label("Press Shift+F4 to toggle this window");
            ui.label("Press Ctrl+Shift+F4 to toggle the World Inspector");
            ui.label("Press F8 to toggle AO style (V0.3 <-> Full)");
            ui.label("Press F9 to toggle SSAO/GTAO");
            ui.label("Press Alt+F10 to dump terrain hole probe JSON");
            ui.label("Press Alt+Shift+F9 to cycle water reflection debug view");
            ui.label("Press Shift+F10 to dump water visual probe JSON");
            ui.label("Press F10 to toggle Sun Shadows");
            #[cfg(feature = "naadf")]
            ui.label("Press Shift+N to toggle NAADF split view");
            ui.label("Press F11 to toggle NAADF fullscreen preview");
            ui.label("Press Shift+F11 to toggle enclosure culling");
    });
}

fn toggle_naadf_split_view_key(
    keys: Res<ButtonInput<KeyCode>>,
    time: Res<Time>,
    mut settings: ResMut<RayTracingSettings>,
    mut notice: ResMut<VoxelRayBackendNotice>,
    #[cfg(feature = "naadf")] capabilities: Option<Res<GraphicsCapabilities>>,
    #[cfg(feature = "naadf")] mut naadf_config: Option<ResMut<NaadfConfig>>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    let alt_held = keys.pressed(KeyCode::AltLeft) || keys.pressed(KeyCode::AltRight);
    let control_held = keys.pressed(KeyCode::ControlLeft) || keys.pressed(KeyCode::ControlRight);
    if !shift_held || alt_held || control_held || !keys.just_pressed(KeyCode::KeyN) {
        return;
    }

    #[cfg(not(feature = "naadf"))]
    {
        settings.fallback_reason = Some(NAADF_NOT_COMPILED_REASON.into());
        notice.show_for(time.elapsed_secs_f64(), VOXEL_RAY_NOTICE_SECONDS);
        warn!("NAADF split view unchanged: {}", NAADF_NOT_COMPILED_REASON);
        audio_events.write(GameAudioEvent::ui(AudioEventId::UiError));
        return;
    }

    #[cfg(feature = "naadf")]
    {
        let Some(mut config) = naadf_config.take() else {
            settings.fallback_reason = Some("NAADF config resource is unavailable".into());
            notice.show_for(time.elapsed_secs_f64(), VOXEL_RAY_NOTICE_SECONDS);
            warn!("NAADF split view unchanged: NAADF config resource is unavailable");
            audio_events.write(GameAudioEvent::ui(AudioEventId::UiError));
            return;
        };

        let split_active = settings.experimental_mode == ExperimentalRenderMode::NaadfPreview
            && config.preview.composite_mode == NaadfPreviewCompositeModeConfig::SplitView;
        if split_active {
            settings.experimental_mode = ExperimentalRenderMode::Current;
            config.preview.composite_mode = NaadfPreviewCompositeModeConfig::Fullscreen;
            settings.fallback_reason = None;
            notice.show_for(time.elapsed_secs_f64(), VOXEL_RAY_NOTICE_SECONDS);
            info!("NAADF split view: OFF (Shift+N to toggle)");
            audio_events.write(GameAudioEvent::ui(AudioEventId::NaadfToggle));
            return;
        }

        settings.set_voxel_backend(VoxelRayBackendMode::Naadf, capabilities.as_deref());
        if settings.voxel_backend != VoxelRayBackendMode::Naadf {
            notice.show_for(time.elapsed_secs_f64(), VOXEL_RAY_NOTICE_SECONDS);
            if let Some(reason) = settings.fallback_reason.as_deref() {
                warn!("NAADF split view unchanged: {reason}");
            } else {
                warn!("NAADF split view unchanged: NAADF backend request was rejected");
            }
            audio_events.write(GameAudioEvent::ui(AudioEventId::UiError));
            return;
        }

        activate_naadf_preview(
            &mut config,
            &mut settings,
            NaadfPreviewCompositeModeConfig::SplitView,
        );
        notice.show_for(time.elapsed_secs_f64(), VOXEL_RAY_NOTICE_SECONDS);
        info!("NAADF split view: ON (Shift+N to toggle)");
        audio_events.write(GameAudioEvent::ui(AudioEventId::NaadfToggle));
    }
}

/// Toggle Sun shadows with F10
fn toggle_sun_shadows(
    mut sun_query: Query<&mut DirectionalLight>,
    keys: Res<ButtonInput<KeyCode>>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    let alt_held = keys.pressed(KeyCode::AltLeft) || keys.pressed(KeyCode::AltRight);
    // Alt+F10 is the terrain hole-probe dump; don't also toggle sun shadows.
    if !shift_held && !alt_held && keys.just_pressed(KeyCode::F10) {
        for mut light in sun_query.iter_mut() {
            light.shadows_enabled = !light.shadows_enabled;
            info!(
                "Sun Shadows: {} (F10 to toggle)",
                if light.shadows_enabled { "ON" } else { "OFF" }
            );
            if light.shadows_enabled {
                audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOn));
            } else {
                audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOff));
            }
        }
    }
}
fn toggle_ao_style(
    keys: Res<ButtonInput<KeyCode>>,
    mut terrain_style: ResMut<TerrainStyleSettings>,
    mut audio_events: MessageWriter<GameAudioEvent>,
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
        if terrain_style.ao_strength >= 0.5 {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOn));
        } else {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOff));
        }
    }
}

/// Toggle SSAO with F9 key to identify if dark shadows come from screen-space AO
/// Toggle SSAO/GTAO with F9 key to identify if dark shadows come from screen-space AO
fn toggle_ssao_key(
    mut commands: Commands,
    keys: Res<ButtonInput<KeyCode>>,
    ao_config: Option<Res<AmbientOcclusionConfig>>,
    cameras: Query<
        (
            Entity,
            Option<&bevy::pbr::ScreenSpaceAmbientOcclusion>,
            Option<&crate::rendering::gtao::GtaoSettings>,
        ),
        With<Camera3d>,
    >,
    mut ssao_enabled: Local<bool>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    if !shift_held && keys.just_pressed(KeyCode::F9) {
        *ssao_enabled = !*ssao_enabled;
        if *ssao_enabled {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOn));
        } else {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOff));
        }
        for (entity, existing_ssao, existing_gtao) in cameras.iter() {
            if *ssao_enabled {
                let use_gtao = ao_config
                    .as_ref()
                    .and_then(|config| config.gtao.as_ref())
                    .is_some_and(|gtao| gtao.enabled);
                if use_gtao {
                    if existing_ssao.is_some() {
                        commands
                            .entity(entity)
                            .remove::<bevy::pbr::ScreenSpaceAmbientOcclusion>();
                    }
                    if existing_gtao.is_none() {
                        let gtao = ao_config
                            .as_ref()
                            .map(|config| gtao_settings_from_config(config))
                            .unwrap_or_default();
                        commands.entity(entity).insert((
                            gtao,
                            bevy::core_pipeline::prepass::DepthPrepass,
                            bevy::core_pipeline::prepass::NormalPrepass,
                        ));
                    }
                    info!("GTAO: ON (F9 to toggle)");
                } else {
                    if existing_gtao.is_some() {
                        commands
                            .entity(entity)
                            .remove::<crate::rendering::gtao::GtaoSettings>();
                    }
                    if existing_ssao.is_none() {
                        commands
                            .entity(entity)
                            .insert(bevy::pbr::ScreenSpaceAmbientOcclusion::default());
                    }
                    info!("SSAO: ON (F9 to toggle)");
                }
            } else {
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
                info!("Screen-space AO: OFF (F9 to toggle)");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_window_claims_cursor() {
        let state = DebugUiState {
            show_settings: true,
            show_inspector: false,
        };

        assert!(state.needs_cursor());
    }

    #[test]
    fn shift_f4_shortcut_toggles_settings_without_world_inspector() {
        let mut state = DebugUiState::default();

        state.toggle_shortcut(false);

        assert!(state.show_settings);
        assert!(!state.show_inspector);
    }

    #[test]
    fn closing_settings_closes_world_inspector_too() {
        let mut state = DebugUiState {
            show_settings: true,
            show_inspector: true,
        };

        state.toggle_shortcut(false);

        assert!(!state.show_settings);
        assert!(!state.show_inspector);
        assert!(!state.needs_cursor());
    }

    #[test]
    fn control_shift_f4_shortcut_toggles_world_inspector() {
        let mut state = DebugUiState {
            show_settings: true,
            show_inspector: false,
        };

        state.toggle_shortcut(true);

        assert!(state.show_settings);
        assert!(state.show_inspector);
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
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    let mut water_changed = false;
    let mut grass_changed = false;

    // Ignore these while Alt is held: Alt+F6 is the LOD-freeze toggle and Alt+F7 is the
    // terrain wireframe overlay. Without this guard, those debug combos also flip
    // water/grass visibility (the reported Alt+F6 = water-toggle collision).
    let alt_held = keys.pressed(KeyCode::AltLeft) || keys.pressed(KeyCode::AltRight);

    if !alt_held && keys.just_pressed(KeyCode::F6) {
        toggles.show_water = !toggles.show_water;
        water_changed = true;
    }

    if !alt_held && keys.just_pressed(KeyCode::F7) {
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
        if toggles.show_water {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOn));
        } else {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOff));
        }
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
        if toggles.show_grass {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOn));
        } else {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOff));
        }
    }
}
