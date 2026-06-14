use bevy::prelude::Vec2;

pub const MOVE_ENTER_SPEED: f32 = 0.4;
pub const MOVE_HOLD_TIME: f32 = 0.22;
pub const SPEED_SMOOTH_RATE: f32 = 12.0;
pub const TELEPORT_SPEED: f32 = 25.0;
pub const BACKPEDAL_DOT_THRESHOLD: f32 = -0.3;
pub const MIN_DIRECTION_DISTANCE: f32 = 1.0e-6;
pub const MIN_DT: f32 = 1.0e-4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LocomotionTrack {
    pub move_hold: f32,
    pub smooth_speed: f32,
    pub moving_backwards: bool,
}

impl Default for LocomotionTrack {
    fn default() -> Self {
        Self {
            move_hold: 0.0,
            smooth_speed: 0.0,
            moving_backwards: false,
        }
    }
}

impl LocomotionTrack {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LocomotionState {
    pub speed: f32,
    pub moving: bool,
    pub backwards: bool,
}

impl LocomotionState {
    pub const fn idle() -> Self {
        Self {
            speed: 0.0,
            moving: false,
            backwards: false,
        }
    }
}

pub fn update_locomotion(
    track: &mut LocomotionTrack,
    displacement_xz: Vec2,
    facing_radians: f32,
    dt_seconds: f32,
) -> LocomotionState {
    let dt = if dt_seconds.is_finite() && dt_seconds > 0.0 {
        dt_seconds
    } else {
        MIN_DT
    };
    let distance = displacement_xz.length();
    let speed = distance / dt;
    if speed > TELEPORT_SPEED {
        track.reset();
        return LocomotionState::idle();
    }

    if speed > MOVE_ENTER_SPEED {
        track.move_hold = MOVE_HOLD_TIME;
    } else {
        track.move_hold = (track.move_hold - dt).max(0.0);
    }
    let moving = track.move_hold > 0.0;

    // Preserve cadence through transient stalls while the moving state is latched.
    if speed > MOVE_ENTER_SPEED || !moving {
        let alpha = (dt * SPEED_SMOOTH_RATE).min(1.0);
        track.smooth_speed += (speed - track.smooth_speed) * alpha;
    }

    // Re-evaluate travel direction only from meaningful horizontal movement.
    if speed > MOVE_ENTER_SPEED && distance > MIN_DIRECTION_DISTANCE {
        let forward = Vec2::new(facing_radians.sin(), facing_radians.cos());
        track.moving_backwards = displacement_xz.normalize().dot(forward) < BACKPEDAL_DOT_THRESHOLD;
    } else if !moving {
        track.moving_backwards = false;
    }

    LocomotionState {
        speed: track.smooth_speed,
        moving,
        backwards: moving && track.moving_backwards,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAME_DT: f32 = 1.0 / 60.0;
    const WALK_SPEED: f32 = 2.2;

    fn walk_step(track: &mut LocomotionTrack) -> LocomotionState {
        update_locomotion(track, Vec2::new(0.0, WALK_SPEED * FRAME_DT), 0.0, FRAME_DT)
    }

    #[test]
    fn steady_walk_reports_moving() {
        let mut track = LocomotionTrack::default();
        let mut state = LocomotionState::idle();

        for _ in 0..30 {
            state = walk_step(&mut track);
        }

        assert!(state.moving);
        assert!(!state.backwards);
        assert!(state.speed > 1.5);
    }

    #[test]
    fn single_stalled_frame_does_not_drop_moving() {
        let mut track = LocomotionTrack::default();
        for _ in 0..20 {
            walk_step(&mut track);
        }

        let state = update_locomotion(&mut track, Vec2::ZERO, 0.0, FRAME_DT);

        assert!(state.moving);
    }

    #[test]
    fn several_stalled_frames_inside_grace_window_stay_moving() {
        let mut track = LocomotionTrack::default();
        for _ in 0..20 {
            walk_step(&mut track);
        }

        let stalled_frames = 9;
        assert!((stalled_frames as f32 * FRAME_DT) < MOVE_HOLD_TIME);
        let mut state = LocomotionState::idle();
        for _ in 0..stalled_frames {
            state = update_locomotion(&mut track, Vec2::ZERO, 0.0, FRAME_DT);
        }

        assert!(state.moving);
    }

    #[test]
    fn genuine_stop_eventually_becomes_idle() {
        let mut track = LocomotionTrack::default();
        for _ in 0..20 {
            walk_step(&mut track);
        }

        let mut state = LocomotionState::idle();
        for _ in 0..30 {
            state = update_locomotion(&mut track, Vec2::ZERO, 0.0, FRAME_DT);
        }

        assert!(!state.moving);
    }

    #[test]
    fn backpedal_direction_survives_stalled_frame() {
        let mut track = LocomotionTrack::default();
        let backwards_displacement = Vec2::new(0.0, -WALK_SPEED * FRAME_DT);
        for _ in 0..10 {
            update_locomotion(&mut track, backwards_displacement, 0.0, FRAME_DT);
        }

        let moving = update_locomotion(&mut track, backwards_displacement, 0.0, FRAME_DT);
        assert!(moving.backwards);

        let stalled = update_locomotion(&mut track, Vec2::ZERO, 0.0, FRAME_DT);
        assert!(stalled.moving);
        assert!(stalled.backwards);
    }

    #[test]
    fn teleport_snap_is_not_locomotion() {
        let mut track = LocomotionTrack::default();

        let state = update_locomotion(&mut track, Vec2::new(50.0, 0.0), 0.0, FRAME_DT);

        assert!(!state.moving);
    }

    #[test]
    fn teleport_while_latched_clears_locomotion() {
        let mut track = LocomotionTrack::default();
        walk_step(&mut track);

        let state = update_locomotion(&mut track, Vec2::new(50.0, 0.0), 0.0, FRAME_DT);

        assert_eq!(state, LocomotionState::idle());
        assert_eq!(track, LocomotionTrack::default());
    }

    #[test]
    fn teleport_clears_backpedal_direction() {
        let mut track = LocomotionTrack::default();
        update_locomotion(
            &mut track,
            Vec2::new(0.0, -WALK_SPEED * FRAME_DT),
            0.0,
            FRAME_DT,
        );
        assert!(track.moving_backwards);

        let state = update_locomotion(&mut track, Vec2::new(50.0, 0.0), 0.0, FRAME_DT);

        assert_eq!(state, LocomotionState::idle());
        assert!(!track.moving_backwards);
    }

    #[test]
    fn alternating_walk_stall_frames_do_not_lose_moving() {
        let mut track = LocomotionTrack::default();
        walk_step(&mut track);

        for frame in 0..60 {
            let state = if frame % 2 == 0 {
                update_locomotion(&mut track, Vec2::ZERO, 0.0, FRAME_DT)
            } else {
                walk_step(&mut track)
            };
            assert!(state.moving, "stopped on frame {frame}");
        }
    }

    #[test]
    fn reset_clears_latched_state() {
        let mut track = LocomotionTrack::default();
        walk_step(&mut track);

        track.reset();

        assert_eq!(track, LocomotionTrack::default());
        assert_eq!(
            update_locomotion(&mut track, Vec2::ZERO, 0.0, FRAME_DT),
            LocomotionState::idle()
        );
    }

    #[test]
    fn invalid_or_tiny_dt_does_not_panic() {
        let mut track = LocomotionTrack::default();

        let state = update_locomotion(&mut track, Vec2::ZERO, 0.0, 0.0);

        assert!(state.speed.is_finite());
    }

    #[test]
    fn negative_dt_does_not_increase_move_hold() {
        let mut track = LocomotionTrack::default();
        walk_step(&mut track);
        let move_hold_before = track.move_hold;

        update_locomotion(&mut track, Vec2::ZERO, 0.0, -FRAME_DT);

        assert!(track.move_hold <= move_hold_before);
    }

    #[test]
    fn nan_dt_does_not_make_state_non_finite() {
        let mut track = LocomotionTrack::default();

        let state = update_locomotion(&mut track, Vec2::ZERO, 0.0, f32::NAN);

        assert!(state.speed.is_finite());
        assert!(track.move_hold.is_finite());
        assert!(track.smooth_speed.is_finite());
    }
}
