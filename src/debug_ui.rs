use bevy::prelude::*;
use bevy_egui::{egui, EguiContexts, EguiPlugin};
use bevy_inspector_egui::quick::WorldInspectorPlugin;
use crate::voxel::plugin::LodSettings;
use crate::vegetation::VegetationConfig;

#[derive(Resource, Default)]
pub struct DebugUiState {
    pub show_inspector: bool,
    pub show_settings: bool,
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
           .add_systems(Update, (toggle_debug_ui, debug_settings_ui));
    }
}

fn should_show_inspector(state: Res<DebugUiState>) -> bool {
    state.show_inspector
}

fn toggle_debug_ui(
    mut state: ResMut<DebugUiState>,
    keys: Res<ButtonInput<KeyCode>>,
) {
    if keys.just_pressed(KeyCode::F4) {
        state.show_inspector = !state.show_inspector;
        state.show_settings = !state.show_settings;
    }
}

fn debug_settings_ui(
    mut contexts: EguiContexts,
    state: Res<DebugUiState>,
    mut lod_settings: ResMut<LodSettings>,
    veg_config: Option<ResMut<VegetationConfig>>,
) {
    if !state.show_settings {
        return;
    }

    egui::Window::new("Game Tweaks").show(contexts.ctx_mut().ok().expect("Failed to get Egui context"), |ui| {
        ui.heading("LOD Settings");
        ui.add(egui::Slider::new(&mut lod_settings.high_detail_distance, 32.0..=512.0).text("High Detail Dist"));
        ui.add(egui::Slider::new(&mut lod_settings.cull_distance, 64.0..=1024.0).text("Cull Dist"));
        
        ui.separator();
        if let Some(mut veg) = veg_config {
            ui.heading("Vegetation");
            ui.add(egui::Slider::new(&mut veg.grass_density, 1..=100).text("Grass Density"));
            ui.label("Note: density changes affect new chunks only");
        }
        
        ui.separator();
        ui.label("Press F4 to toggle this window and Inspector");
    });
}
