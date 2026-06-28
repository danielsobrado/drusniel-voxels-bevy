//! CLOD cut crossfade helpers ported from `tools/clod-poc`.
//!
//! The TypeScript PoC fades between active CLOD cuts with a stable/fade-in/fade-out
//! role per node and a small Bayer screen-door dither pattern. This Rust module
//! keeps the same state model in a renderer-agnostic form so Bevy rendering can
//! consume it in a later PR without mixing transition policy with material setup.

use std::collections::{BTreeMap, BTreeSet};

/// Stable identifier for a CLOD runtime node.
///
/// The renderer can map this string to the concrete page entity/material handle.
/// Keeping the transition core string-based makes it usable from tests, bench
/// tools and debug exports without depending on Bevy ECS types.
pub type ClodNodeId = String;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClodCutSnapshot {
    pub nodes: BTreeSet<ClodNodeId>,
}

impl ClodCutSnapshot {
    pub fn from_ids<I, S>(ids: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<ClodNodeId>,
    {
        Self {
            nodes: ids.into_iter().map(Into::into).collect(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClodDitherRole {
    Stable,
    FadeIn,
    FadeOut,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClodFadeState {
    pub node_id: ClodNodeId,
    pub visible: bool,
    /// 0.0 means fully hidden by the dither mask, 1.0 means fully visible.
    pub fade_alpha: f32,
    pub dither_role: ClodDitherRole,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClodTransition {
    pub id: String,
    pub from_node_ids: Vec<ClodNodeId>,
    pub to_node_ids: Vec<ClodNodeId>,
    pub start_frame: u64,
    pub duration_frames: u64,
}

#[derive(Debug, Default)]
pub struct ClodCrossfadeSequencer {
    next_transition_id: u64,
}

impl ClodCrossfadeSequencer {
    pub fn create_transition(
        &mut self,
        previous_cut: Option<&ClodCutSnapshot>,
        next_cut: &ClodCutSnapshot,
        frame: u64,
        duration_frames: u64,
    ) -> Option<ClodTransition> {
        let transition_id = format!("xfade-{}", self.next_transition_id);
        let transition = create_transition_with_id(
            transition_id,
            previous_cut,
            next_cut,
            frame,
            duration_frames,
        )?;
        self.next_transition_id = self.next_transition_id.saturating_add(1);
        Some(transition)
    }
}

pub fn create_transition_with_id(
    id: String,
    previous_cut: Option<&ClodCutSnapshot>,
    next_cut: &ClodCutSnapshot,
    frame: u64,
    duration_frames: u64,
) -> Option<ClodTransition> {
    let previous_cut = previous_cut?;
    if duration_frames == 0 {
        return None;
    }

    let removed: Vec<_> = previous_cut
        .nodes
        .difference(&next_cut.nodes)
        .cloned()
        .collect();
    let added: Vec<_> = next_cut
        .nodes
        .difference(&previous_cut.nodes)
        .cloned()
        .collect();

    if removed.is_empty() && added.is_empty() {
        return None;
    }

    Some(ClodTransition {
        id,
        from_node_ids: removed,
        to_node_ids: added,
        start_frame: frame,
        duration_frames,
    })
}

pub fn compute_fade_states(
    active_transition: Option<&ClodTransition>,
    stable_cut: &ClodCutSnapshot,
    frame: u64,
) -> BTreeMap<ClodNodeId, ClodFadeState> {
    let mut fade_states = BTreeMap::new();
    let progress = active_transition.and_then(|transition| transition_progress(transition, frame));

    for node_id in &stable_cut.nodes {
        let (fade_alpha, dither_role) = match (active_transition, progress) {
            (Some(transition), Some(progress)) if transition.to_node_ids.contains(node_id) => {
                (progress, ClodDitherRole::FadeIn)
            }
            _ => (1.0, ClodDitherRole::Stable),
        };

        fade_states.insert(
            node_id.clone(),
            ClodFadeState {
                node_id: node_id.clone(),
                visible: true,
                fade_alpha,
                dither_role,
            },
        );
    }

    if let (Some(transition), Some(progress)) = (active_transition, progress) {
        for node_id in &transition.from_node_ids {
            fade_states.entry(node_id.clone()).or_insert_with(|| ClodFadeState {
                node_id: node_id.clone(),
                visible: true,
                fade_alpha: 1.0 - progress,
                dither_role: ClodDitherRole::FadeOut,
            });
        }
    }

    fade_states
}

pub fn is_transition_complete(transition: &ClodTransition, frame: u64) -> bool {
    frame >= transition
        .start_frame
        .saturating_add(transition.duration_frames)
}

pub fn transition_progress(transition: &ClodTransition, frame: u64) -> Option<f32> {
    if frame < transition.start_frame || is_transition_complete(transition, frame) {
        return None;
    }
    let elapsed = frame.saturating_sub(transition.start_frame) as f32;
    let duration = transition.duration_frames.max(1) as f32;
    Some((elapsed / duration).clamp(0.0, 1.0))
}

/// Generate a repeated Bayer dither pattern matching the PoC's 4x4 base matrix.
///
/// Returned values are in the range 0..=15. A shader can normalize them with
/// `threshold = value / 16.0` and compare against the node fade alpha.
pub fn generate_dither_pattern(size: usize) -> Vec<u8> {
    assert!(size > 0, "dither pattern size must be positive");
    let bayer = generate_bayer_matrix(4);
    let mut pattern = vec![0u8; size * size];
    for y in 0..size {
        for x in 0..size {
            pattern[y * size + x] = bayer[y % 4][x % 4];
        }
    }
    pattern
}

fn generate_bayer_matrix(n: usize) -> Vec<Vec<u8>> {
    assert!(n.is_power_of_two(), "Bayer matrix size must be a power of two");
    if n == 1 {
        return vec![vec![0]];
    }

    let smaller = generate_bayer_matrix(n / 2);
    let half = n / 2;
    let mut result = vec![vec![0u8; n]; n];

    for y in 0..half {
        for x in 0..half {
            let v = smaller[y][x] * 4;
            result[y][x] = v;
            result[y][x + half] = v + 2;
            result[y + half][x] = v + 3;
            result[y + half][x + half] = v + 1;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transition_tracks_added_and_removed_nodes() {
        let previous = ClodCutSnapshot::from_ids(["0/0/0", "1/0/0", "1/1/0"]);
        let next = ClodCutSnapshot::from_ids(["0/0/0", "2/0/0", "2/1/0"]);

        let transition = create_transition_with_id(
            "xfade-test".to_string(),
            Some(&previous),
            &next,
            10,
            8,
        )
        .expect("changed cut should create a transition");

        assert_eq!(transition.from_node_ids, vec!["1/0/0", "1/1/0"]);
        assert_eq!(transition.to_node_ids, vec!["2/0/0", "2/1/0"]);
    }

    #[test]
    fn no_transition_for_first_or_unchanged_cut() {
        let cut = ClodCutSnapshot::from_ids(["0/0/0"]);
        assert!(create_transition_with_id("a".into(), None, &cut, 0, 8).is_none());
        assert!(create_transition_with_id("b".into(), Some(&cut), &cut, 0, 8).is_none());
        assert!(create_transition_with_id("c".into(), Some(&cut), &cut, 0, 0).is_none());
    }

    #[test]
    fn fade_states_include_fade_out_nodes_not_in_stable_cut() {
        let stable = ClodCutSnapshot::from_ids(["new"]);
        let transition = ClodTransition {
            id: "xfade".into(),
            from_node_ids: vec!["old".into()],
            to_node_ids: vec!["new".into()],
            start_frame: 100,
            duration_frames: 10,
        };

        let states = compute_fade_states(Some(&transition), &stable, 105);
        let new = states.get("new").expect("new node state");
        let old = states.get("old").expect("old node state");

        assert_eq!(new.dither_role, ClodDitherRole::FadeIn);
        assert_eq!(old.dither_role, ClodDitherRole::FadeOut);
        assert!((new.fade_alpha - 0.5).abs() < f32::EPSILON);
        assert!((old.fade_alpha - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn fade_states_return_to_stable_after_transition() {
        let stable = ClodCutSnapshot::from_ids(["new"]);
        let transition = ClodTransition {
            id: "xfade".into(),
            from_node_ids: vec!["old".into()],
            to_node_ids: vec!["new".into()],
            start_frame: 100,
            duration_frames: 10,
        };

        let states = compute_fade_states(Some(&transition), &stable, 110);
        assert_eq!(states.len(), 1);
        assert_eq!(states["new"].dither_role, ClodDitherRole::Stable);
        assert_eq!(states["new"].fade_alpha, 1.0);
    }

    #[test]
    fn bayer_pattern_matches_the_poc_base_matrix() {
        let pattern = generate_dither_pattern(4);
        assert_eq!(
            pattern,
            vec![
                0, 8, 2, 10,
                12, 4, 14, 6,
                3, 11, 1, 9,
                15, 7, 13, 5,
            ]
        );
    }

    #[test]
    fn larger_dither_pattern_tiles_the_bayer_matrix() {
        let pattern = generate_dither_pattern(8);
        assert_eq!(pattern[0], pattern[4]);
        assert_eq!(pattern[1], pattern[5]);
        assert_eq!(pattern[8], pattern[12]);
        assert_eq!(pattern[8 * 4], pattern[0]);
    }
}
