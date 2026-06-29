//! Runtime-neutral scripted CLOD edit events.
//!
//! These types are the bridge between bench TOML fixtures and the eventual
//! terrain-edit runtime adapter. They intentionally do not mutate `VoxelWorld`
//! and do not rebuild CLOD pages directly; they only normalize and expand edit
//! intent into deterministic per-frame events.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClodScriptedEditKind {
    Dig,
    Raise,
    Level,
    Smooth,
}

impl ClodScriptedEditKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dig => "dig",
            Self::Raise => "raise",
            Self::Level => "level",
            Self::Smooth => "smooth",
        }
    }

    pub fn requires_target_height(self) -> bool {
        matches!(self, Self::Level)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ClodScriptedEditDefaults {
    pub radius: Option<f32>,
    pub strength: Option<f32>,
    pub expected_dirty_pages_min: Option<u32>,
    pub expected_rebuild_publish_max_frames: Option<u32>,
    pub expected_collider_refresh_max_frames: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClodScriptedEditSpec {
    pub name: String,
    pub frame: u32,
    pub kind: ClodScriptedEditKind,
    pub position: [f32; 3],

    #[serde(default)]
    pub radius: Option<f32>,

    #[serde(default)]
    pub strength: Option<f32>,

    #[serde(default)]
    pub target_height: Option<f32>,

    #[serde(default)]
    pub repeat_every_frames: Option<u32>,

    #[serde(default)]
    pub repeat_count: Option<u32>,

    #[serde(default)]
    pub expected_dirty_pages_min: Option<u32>,

    #[serde(default)]
    pub expected_dirty_pages_max: Option<u32>,

    #[serde(default)]
    pub expected_rebuild_publish_max_frames: Option<u32>,

    #[serde(default)]
    pub expected_collider_refresh_max_frames: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClodScriptedEditEvent {
    pub name: String,
    pub occurrence: u32,
    pub frame: u32,
    pub kind: ClodScriptedEditKind,
    pub position: [f32; 3],
    pub radius: f32,
    pub strength: f32,
    pub target_height: Option<f32>,
    pub expected_dirty_pages_min: Option<u32>,
    pub expected_dirty_pages_max: Option<u32>,
    pub expected_rebuild_publish_max_frames: Option<u32>,
    pub expected_collider_refresh_max_frames: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClodScriptedEditStatus {
    Pending,
    Emitted,
    Applied,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClodScriptedEditOutcome {
    pub name: String,
    pub occurrence: u32,
    pub frame: u32,
    pub status: String,
    pub dirty_lod0_pages: u32,
    pub dirty_parent_nodes: u32,
    pub published_revision: Option<u64>,
    pub collider_refresh_frame: Option<u32>,
    pub message: String,
}

impl ClodScriptedEditStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Emitted => "emitted",
            Self::Applied => "applied",
            Self::Failed => "failed",
        }
    }
}

pub fn expand_scripted_edits(
    spec: &ClodScriptedEditSpec,
    defaults: &ClodScriptedEditDefaults,
) -> Result<Vec<ClodScriptedEditEvent>, String> {
    let radius = resolve_positive_f32("radius", spec.radius, defaults.radius)?;
    let strength = resolve_positive_f32("strength", spec.strength, defaults.strength)?;
    validate_position(spec.position)?;
    validate_target_height(spec.kind, spec.target_height)?;

    let repeat_count = spec.repeat_count.unwrap_or(1).max(1);
    let repeat_every = spec.repeat_every_frames.unwrap_or(0);
    if repeat_count > 1 && repeat_every == 0 {
        return Err(format!(
            "edit '{}' has repeat_count={repeat_count} but repeat_every_frames is missing or zero",
            spec.name
        ));
    }
    if repeat_count > 256 {
        return Err(format!(
            "edit '{}' repeat_count={repeat_count} is too high; cap fixtures to 256 events",
            spec.name
        ));
    }

    let expected_dirty_pages_min = spec
        .expected_dirty_pages_min
        .or(defaults.expected_dirty_pages_min);
    let expected_rebuild_publish_max_frames = spec
        .expected_rebuild_publish_max_frames
        .or(defaults.expected_rebuild_publish_max_frames);
    let expected_collider_refresh_max_frames = spec
        .expected_collider_refresh_max_frames
        .or(defaults.expected_collider_refresh_max_frames);

    let mut events = Vec::with_capacity(repeat_count as usize);
    for occurrence in 0..repeat_count {
        let offset = repeat_every
            .checked_mul(occurrence)
            .ok_or_else(|| format!("edit '{}' repeat frame overflow", spec.name))?;
        let frame = spec
            .frame
            .checked_add(offset)
            .ok_or_else(|| format!("edit '{}' frame overflow", spec.name))?;
        events.push(ClodScriptedEditEvent {
            name: spec.name.clone(),
            occurrence,
            frame,
            kind: spec.kind,
            position: spec.position,
            radius,
            strength,
            target_height: spec.target_height,
            expected_dirty_pages_min,
            expected_dirty_pages_max: spec.expected_dirty_pages_max,
            expected_rebuild_publish_max_frames,
            expected_collider_refresh_max_frames,
        });
    }

    Ok(events)
}

pub fn due_scripted_edits(
    events: &[ClodScriptedEditEvent],
    frame: u32,
) -> impl Iterator<Item = &ClodScriptedEditEvent> {
    events.iter().filter(move |event| event.frame == frame)
}

fn resolve_positive_f32(
    field: &str,
    explicit: Option<f32>,
    default: Option<f32>,
) -> Result<f32, String> {
    let value = explicit.or(default).ok_or_else(|| {
        format!("{field} is missing and no clod_edit_defaults.{field} value was provided")
    })?;
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("{field} must be finite and > 0, got {value}"));
    }
    Ok(value)
}

fn validate_position(position: [f32; 3]) -> Result<(), String> {
    if position.iter().any(|v| !v.is_finite()) {
        return Err(format!("position must be finite, got {position:?}"));
    }
    Ok(())
}

fn validate_target_height(
    kind: ClodScriptedEditKind,
    target_height: Option<f32>,
) -> Result<(), String> {
    if kind.requires_target_height() {
        let Some(height) = target_height else {
            return Err("level edits require target_height".to_string());
        };
        if !height.is_finite() {
            return Err(format!("target_height must be finite, got {height}"));
        }
        return Ok(());
    }
    if target_height.is_some() {
        return Err(format!(
            "{} edits must not set target_height; only level uses it",
            kind.as_str()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults() -> ClodScriptedEditDefaults {
        ClodScriptedEditDefaults {
            radius: Some(4.0),
            strength: Some(0.5),
            expected_dirty_pages_min: Some(1),
            expected_rebuild_publish_max_frames: Some(90),
            expected_collider_refresh_max_frames: Some(120),
        }
    }

    #[test]
    fn expands_repeated_edits_into_concrete_frames() {
        let spec = ClodScriptedEditSpec {
            name: "dig-loop".to_string(),
            frame: 10,
            kind: ClodScriptedEditKind::Dig,
            position: [1.0, 2.0, 3.0],
            radius: None,
            strength: None,
            target_height: None,
            repeat_every_frames: Some(5),
            repeat_count: Some(3),
            expected_dirty_pages_min: None,
            expected_dirty_pages_max: Some(8),
            expected_rebuild_publish_max_frames: None,
            expected_collider_refresh_max_frames: None,
        };
        let events = expand_scripted_edits(&spec, &defaults()).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].frame, 10);
        assert_eq!(events[1].frame, 15);
        assert_eq!(events[2].frame, 20);
        assert_eq!(events[2].occurrence, 2);
        assert_eq!(events[0].radius, 4.0);
        assert_eq!(events[0].expected_dirty_pages_min, Some(1));
    }

    #[test]
    fn level_requires_target_height() {
        let spec = ClodScriptedEditSpec {
            name: "bad-level".to_string(),
            frame: 0,
            kind: ClodScriptedEditKind::Level,
            position: [0.0, 0.0, 0.0],
            radius: Some(2.0),
            strength: Some(0.2),
            target_height: None,
            repeat_every_frames: None,
            repeat_count: None,
            expected_dirty_pages_min: None,
            expected_dirty_pages_max: None,
            expected_rebuild_publish_max_frames: None,
            expected_collider_refresh_max_frames: None,
        };
        assert!(expand_scripted_edits(&spec, &defaults()).is_err());
    }

    #[test]
    fn due_events_match_exact_frame() {
        let events = vec![ClodScriptedEditEvent {
            name: "a".into(),
            occurrence: 0,
            frame: 7,
            kind: ClodScriptedEditKind::Smooth,
            position: [0.0, 0.0, 0.0],
            radius: 1.0,
            strength: 1.0,
            target_height: None,
            expected_dirty_pages_min: None,
            expected_dirty_pages_max: None,
            expected_rebuild_publish_max_frames: None,
            expected_collider_refresh_max_frames: None,
        }];
        assert_eq!(due_scripted_edits(&events, 7).count(), 1);
        assert_eq!(due_scripted_edits(&events, 8).count(), 0);
    }
}
