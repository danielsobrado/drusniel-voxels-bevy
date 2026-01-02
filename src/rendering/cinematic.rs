use bevy::{
    prelude::*,
    post_process::{
        dof::DepthOfField,
        motion_blur::MotionBlur,
    },
};
use crate::rendering::cinematic_config::CinematicConfig;

pub struct CinematicPlugin;

impl Plugin for CinematicPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<CinematicConfig>()
            .init_resource::<CinematicState>()
            .add_message::<CinematicEvent>()
            .add_systems(Update, (
                handle_cinematic_events,
                update_auto_focus,
                update_cinematic_transitions,
                crate::rendering::cutscene::update_cutscenes,
            ).chain());
    }
}

/// Current state of cinematic effects
#[derive(Resource, Default)]
pub struct CinematicState {
    pub active: bool,
    pub transition_timer: Option<Timer>,
    pub target_focal_distance: f32,
    pub current_focal_distance: f32,
}

/// Events to trigger cinematic mode
#[derive(Message, Debug, Clone)]
pub enum CinematicEvent {
    /// Enter cinematic mode with optional focus target
    Enter { focus_entity: Option<Entity> },
    /// Exit cinematic mode
    Exit,
    /// Set focus to specific distance
    SetFocus { distance: f32 },
    /// Focus on entity
    FocusOn { entity: Entity },
}

/// Marker for cinematic-enabled cameras
#[derive(Component)]
pub struct CinematicCamera;

/// Returns DoF component if enabled
pub fn dof_component(config: &CinematicConfig) -> Option<DepthOfField> {
    if !config.depth_of_field.enabled {
        return None;
    }
    
    Some(DepthOfField {
        mode: config.depth_of_field.mode(),
        focal_distance: config.depth_of_field.focal_distance,
        aperture_f_stops: config.depth_of_field.aperture_f_stops,
        ..default()
    })
}

/// Returns motion blur component if enabled
pub fn motion_blur_component(config: &CinematicConfig) -> Option<MotionBlur> {
    if !config.motion_blur.enabled {
        return None;
    }
    
    Some(MotionBlur {
        shutter_angle: config.motion_blur.shutter_angle,
        samples: config.motion_blur.samples,
    })
}

fn handle_cinematic_events(
    mut commands: Commands,
    mut events: MessageReader<CinematicEvent>,
    mut state: ResMut<CinematicState>,
    config: Res<CinematicConfig>,
    cameras: Query<Entity, With<CinematicCamera>>,
    transforms: Query<&GlobalTransform>,
) {
    for event in events.read() {
        match event {
            CinematicEvent::Enter { focus_entity } => {
                state.active = true;
                state.transition_timer = Some(Timer::from_seconds(0.5, TimerMode::Once));
                
                // Calculate initial focus distance
                let camera_entity = cameras.iter().next();
                if let (Some(target), Some(camera_entity)) = (focus_entity, camera_entity) {
                    if let (Ok(camera_tf), Ok(target_tf)) = (
                        transforms.get(camera_entity),
                        transforms.get(*target),
                    ) {
                        state.target_focal_distance =
                            camera_tf.translation().distance(target_tf.translation());
                    }
                } else {
                    state.target_focal_distance = config.depth_of_field.focal_distance;
                }
                
                // Add effects to camera
                for entity in cameras.iter() {
                    if let Some(dof) = dof_component(&config) {
                        commands.entity(entity).insert(dof);
                    }
                    if let Some(mb) = motion_blur_component(&config) {
                        commands.entity(entity).insert(mb);
                    }
                }
                
                info!("Cinematic mode entered");
            }
            
            CinematicEvent::Exit => {
                state.active = false;
                state.transition_timer = Some(Timer::from_seconds(0.3, TimerMode::Once));
                
                // Remove effects from camera
                for entity in cameras.iter() {
                    commands.entity(entity)
                        .remove::<DepthOfField>()
                        .remove::<MotionBlur>();
                }
                
                info!("Cinematic mode exited");
            }
            
            CinematicEvent::SetFocus { distance } => {
                state.target_focal_distance = *distance;
            }
            
            CinematicEvent::FocusOn { entity } => {
                if let Ok(target_tf) = transforms.get(*entity) {
                    if let Some(camera_entity) = cameras.iter().next() {
                        if let Ok(camera_tf) = transforms.get(camera_entity) {
                            state.target_focal_distance =
                                camera_tf.translation().distance(target_tf.translation());
                        }
                    }
                }
            }
        }
    }
}

fn update_auto_focus(
    config: Res<CinematicConfig>,
    state: ResMut<CinematicState>,
    _cameras: Query<&GlobalTransform, With<CinematicCamera>>,
    // Note: Project seems to use custom voxel collision or rapier, 
    // but the guide mentions rapier. I will comment it out if it fails.
) {
    if !state.active || !config.auto_focus.enabled {
        return;
    }
    
    // Auto-focus logic would go here if specialized raycasting is available
}

fn update_cinematic_transitions(
    time: Res<Time>,
    config: Res<CinematicConfig>,
    mut state: ResMut<CinematicState>,
    mut dof_query: Query<&mut DepthOfField, With<CinematicCamera>>,
) {
    if !state.active {
        return;
    }
    
    // Smooth focus transition
    let lerp_speed = config.auto_focus.lerp_speed;
    state.current_focal_distance = state.current_focal_distance
        + (state.target_focal_distance - state.current_focal_distance) 
        * lerp_speed * time.delta_secs();
    
    // Update DoF focal distance
    for mut dof in dof_query.iter_mut() {
        dof.focal_distance = state.current_focal_distance;
    }
    
    // Handle transition timer
    if let Some(ref mut timer) = state.transition_timer {
        timer.tick(time.delta());
        if timer.is_finished() {
            state.transition_timer = None;
        }
    }
}
