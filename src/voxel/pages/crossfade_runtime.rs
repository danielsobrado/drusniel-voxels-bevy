//! Bevy runtime bridge for CLOD cut crossfades.
//!
//! The pure transition logic lives in `crossfade.rs`.  This module maps the
//! current selected CLOD cut onto page mesh entities through a tiny component so
//! debug overlays, guards, and later material code can all consume the same
//! state model.

use bevy::prelude::*;

use super::crossfade::{
    ClodCrossfadeSequencer, ClodCutSnapshot, ClodDitherRole, ClodTransition, compute_fade_states,
    is_transition_complete,
};
use super::render::ClodPageMeshTag;
use super::selection::{ClodPageNodeKey, ClodPageSelectionState};

#[derive(Component, Clone, Copy, Debug, PartialEq)]
pub(crate) struct ClodPageFade {
    /// 0.0 means fully hidden by the dither mask; 1.0 means fully visible.
    pub alpha: f32,
    pub role: ClodDitherRole,
}

impl Default for ClodPageFade {
    fn default() -> Self {
        Self {
            alpha: 1.0,
            role: ClodDitherRole::Stable,
        }
    }
}

#[derive(Resource, Clone, Debug)]
pub(crate) struct ClodCrossfadeRuntimeSettings {
    pub enabled: bool,
    pub duration_frames: u64,
}

impl Default for ClodCrossfadeRuntimeSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag("VOXEL_CLOD_CROSSFADE_BRIDGE"),
            duration_frames: std::env::var("VOXEL_CLOD_CROSSFADE_BRIDGE_FRAMES")
                .ok()
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or(12),
        }
    }
}

#[derive(Resource, Debug, Default)]
pub(crate) struct ClodCrossfadeFrameClock {
    pub frame: u64,
}

#[derive(Resource, Debug, Default)]
pub(crate) struct ClodCrossfadeRuntimeState {
    sequencer: ClodCrossfadeSequencer,
    previous_cut: Option<ClodCutSnapshot>,
    active_transition: Option<ClodTransition>,
    pub active_transition_id: Option<String>,
    pub fade_in_pages: usize,
    pub fade_out_pages: usize,
    pub stable_pages: usize,
}

impl ClodCrossfadeRuntimeState {
    fn reset_counts(&mut self) {
        self.active_transition_id = self.active_transition.as_ref().map(|t| t.id.clone());
        self.fade_in_pages = 0;
        self.fade_out_pages = 0;
        self.stable_pages = 0;
    }

    fn clear(&mut self) {
        self.previous_cut = None;
        self.active_transition = None;
        self.active_transition_id = None;
        self.fade_in_pages = 0;
        self.fade_out_pages = 0;
        self.stable_pages = 0;
    }
}

pub(crate) fn clod_crossfade_runtime_bridge_system(
    mut commands: Commands,
    settings: Res<ClodCrossfadeRuntimeSettings>,
    mut clock: ResMut<ClodCrossfadeFrameClock>,
    mut state: ResMut<ClodCrossfadeRuntimeState>,
    selection_state: Res<ClodPageSelectionState>,
    mut pages: Query<(
        Entity,
        &ClodPageMeshTag,
        &mut Visibility,
        Option<&mut ClodPageFade>,
    )>,
) {
    let frame = clock.frame;
    clock.frame = clock.frame.saturating_add(1);

    if !settings.enabled {
        state.clear();
        for (entity, _, _, fade) in pages.iter_mut() {
            if fade.is_some() {
                commands.entity(entity).remove::<ClodPageFade>();
            }
        }
        return;
    }

    let stable_cut = ClodCutSnapshot::from_ids(selection_state.rendered_keys().map(node_key_to_id));

    if stable_cut.is_empty() {
        state.clear();
        for (entity, _, mut visibility, fade) in pages.iter_mut() {
            *visibility = Visibility::Hidden;
            if fade.is_some() {
                commands.entity(entity).remove::<ClodPageFade>();
            }
        }
        return;
    }

    if state.previous_cut.as_ref() != Some(&stable_cut) {
        let previous_cut = state.previous_cut.clone();
        state.active_transition = state.sequencer.create_transition(
            previous_cut.as_ref(),
            &stable_cut,
            frame,
            settings.duration_frames,
        );
        state.previous_cut = Some(stable_cut.clone());
    }

    if state
        .active_transition
        .as_ref()
        .is_some_and(|transition| is_transition_complete(transition, frame))
    {
        state.active_transition = None;
    }

    state.reset_counts();
    let fade_states = compute_fade_states(state.active_transition.as_ref(), &stable_cut, frame);

    for (entity, tag, mut visibility, fade) in pages.iter_mut() {
        let node_id = node_tag_to_id(tag);
        let Some(fade_state) = fade_states.get(&node_id) else {
            *visibility = Visibility::Hidden;
            if fade.is_some() {
                commands.entity(entity).remove::<ClodPageFade>();
            }
            continue;
        };

        *visibility = if fade_state.visible {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };

        let component = ClodPageFade {
            alpha: fade_state.fade_alpha,
            role: fade_state.dither_role,
        };

        match component.role {
            ClodDitherRole::FadeIn => state.fade_in_pages += 1,
            ClodDitherRole::FadeOut => state.fade_out_pages += 1,
            ClodDitherRole::Stable => state.stable_pages += 1,
        }

        match fade {
            Some(mut current) => *current = component,
            None => {
                commands.entity(entity).insert(component);
            }
        }
    }
}

fn node_key_to_id(key: ClodPageNodeKey) -> String {
    format!("{}:{}:{}", key.level, key.coord.0, key.coord.1)
}

fn node_tag_to_id(tag: &ClodPageMeshTag) -> String {
    format!("{}:{}:{}", tag.level, tag.coord.0, tag.coord.1)
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).ok().is_some_and(|value| {
        matches!(
            value.trim(),
            "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_ids_are_stable_and_parse_free() {
        let key = ClodPageNodeKey::new(2, (-3, 7));
        assert_eq!(node_key_to_id(key), "2:-3:7");

        let tag = ClodPageMeshTag {
            level: 2,
            coord: (-3, 7),
        };
        assert_eq!(node_tag_to_id(&tag), "2:-3:7");
    }

    #[test]
    fn default_fade_component_is_stable_visible() {
        let fade = ClodPageFade::default();
        assert_eq!(fade.alpha, 1.0);
        assert_eq!(fade.role, ClodDitherRole::Stable);
    }
}
