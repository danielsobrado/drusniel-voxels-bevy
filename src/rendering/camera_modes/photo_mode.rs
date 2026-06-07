use crate::rendering::cinematic::{CinematicCamera, CinematicEvent};
use crate::rendering::cinematic_config::CinematicConfig;
use bevy::prelude::*;

pub struct PhotoModePlugin;

impl Plugin for PhotoModePlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PhotoModeState>()
            .add_systems(Update, (toggle_photo_mode, photo_mode_controls));
    }
}

#[derive(Resource, Default)]
pub struct PhotoModeState {
    pub active: bool,
    #[allow(dead_code)]
    pub focal_distance: f32,
    #[allow(dead_code)]
    pub aperture: f32,
    #[allow(dead_code)]
    pub blur_enabled: bool,
}

fn toggle_photo_mode(
    input: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<PhotoModeState>,
    mut events: MessageWriter<CinematicEvent>,
    config: Res<CinematicConfig>,
) {
    // F12 to toggle photo mode
    if input.just_pressed(KeyCode::F12) {
        state.active = !state.active;

        if state.active {
            state.focal_distance = config.depth_of_field.focal_distance;
            state.aperture = config.depth_of_field.aperture_f_stops;
            state.blur_enabled = true;
            events.write(CinematicEvent::Enter { focus_entity: None });
            info!("Photo mode enabled - Use scroll to adjust focus, Q/E for aperture");
        } else {
            events.write(CinematicEvent::Exit);
            info!("Photo mode disabled");
        }
    }
}

fn photo_mode_controls(
    state: Res<PhotoModeState>,
    input: Res<ButtonInput<KeyCode>>,
    mut scroll: MessageReader<bevy::input::mouse::MouseWheel>,
    mut events: MessageWriter<CinematicEvent>,
    mut dof_query: Query<&mut bevy::post_process::dof::DepthOfField, With<CinematicCamera>>,
) {
    if !state.active {
        return;
    }

    let mut focal_delta = 0.0;
    let mut aperture_delta = 0.0;

    // Scroll to adjust focus
    for ev in scroll.read() {
        focal_delta += ev.y * 2.0;
    }

    // Q/E to adjust aperture
    if input.pressed(KeyCode::KeyQ) {
        aperture_delta -= 0.1;
    }
    if input.pressed(KeyCode::KeyE) {
        aperture_delta += 0.1;
    }

    // Apply changes
    for mut dof in dof_query.iter_mut() {
        dof.focal_distance = (dof.focal_distance + focal_delta).max(0.5);
        dof.aperture_f_stops = (dof.aperture_f_stops + aperture_delta).clamp(0.5, 16.0);
    }

    if focal_delta != 0.0 {
        if let Ok(dof) = dof_query.single() {
            events.write(CinematicEvent::SetFocus {
                distance: dof.focal_distance,
            });
        }
    }
}
