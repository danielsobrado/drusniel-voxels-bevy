use crate::rendering::cinematic::CinematicEvent;
use bevy::prelude::*;

/// Simple cutscene controller
#[derive(Component)]
pub struct Cutscene {
    pub focus_targets: Vec<Entity>,
    pub current_target: usize,
    pub auto_advance: bool,
    pub advance_timer: Timer,
}

impl Cutscene {
    pub fn new(focus_targets: Vec<Entity>, duration_per_target: f32) -> Self {
        Self {
            focus_targets,
            current_target: 0,
            auto_advance: true,
            advance_timer: Timer::from_seconds(duration_per_target, TimerMode::Repeating),
        }
    }
}

/// Marker for cutscene focus targets
#[derive(Component)]
pub struct CutsceneFocusTarget {
    #[allow(dead_code)]
    pub priority: u32,
}

pub fn start_cutscene(
    commands: &mut Commands,
    events: &mut MessageWriter<CinematicEvent>,
    focus_targets: Vec<Entity>,
) -> Entity {
    // Enter cinematic mode
    events.write(CinematicEvent::Enter {
        focus_entity: focus_targets.first().copied(),
    });

    // Spawn cutscene controller
    commands.spawn(Cutscene::new(focus_targets, 3.0)).id()
}

pub fn end_cutscene(
    commands: &mut Commands,
    events: &mut MessageWriter<CinematicEvent>,
    cutscene_entity: Entity,
) {
    events.write(CinematicEvent::Exit);
    commands.entity(cutscene_entity).despawn();
}

pub fn update_cutscenes(
    time: Res<Time>,
    mut events: MessageWriter<CinematicEvent>,
    mut cutscenes: Query<&mut Cutscene>,
) {
    for mut cutscene in cutscenes.iter_mut() {
        if !cutscene.auto_advance {
            continue;
        }

        cutscene.advance_timer.tick(time.delta());

        if cutscene.advance_timer.just_finished() {
            cutscene.current_target = (cutscene.current_target + 1) % cutscene.focus_targets.len();

            if let Some(&target) = cutscene.focus_targets.get(cutscene.current_target) {
                events.write(CinematicEvent::FocusOn { entity: target });
            }
        }
    }
}
