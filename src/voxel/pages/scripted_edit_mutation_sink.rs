//! Scripted CLOD edit mutation sink.
//!
//! This module is intentionally conservative. It consumes mutation-request rows
//! produced by the scripted edit QA pipeline and decides what the runtime would
//! do with each request. It does **not** mutate `VoxelWorld`; the authoritative
//! terrain edit hook is represented as an explicit capability flag so benches can
//! prove that real mutation is only possible when both the apply flag and the
//! authoritative hook are present.

use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MutationSinkMode {
    DryRun,
    ApplyRequestedWithoutHook,
    ApplyWithAuthoritativeHook,
}

impl MutationSinkMode {
    pub fn from_flags(apply_requested: bool, authoritative_hook_available: bool) -> Self {
        match (apply_requested, authoritative_hook_available) {
            (false, _) => Self::DryRun,
            (true, false) => Self::ApplyRequestedWithoutHook,
            (true, true) => Self::ApplyWithAuthoritativeHook,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MutationRequestRow {
    pub request_id: String,
    pub frame: u64,
    pub event_id: String,
    pub kind: String,
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
    pub radius: f32,
    pub strength: f32,
    pub target_height: Option<f32>,
    pub dirty_lod0_pages: u32,
    pub dirty_parent_nodes: u32,
    pub mutation_status: String,
    pub requires_authoritative_world_mutation: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MutationSinkDecisionKind {
    DryRun,
    Blocked,
    Ready,
    AppliedPlaceholder,
}

impl MutationSinkDecisionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DryRun => "dry_run",
            Self::Blocked => "blocked",
            Self::Ready => "ready",
            Self::AppliedPlaceholder => "applied_placeholder",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MutationSinkDecision {
    pub request_id: String,
    pub frame: u64,
    pub event_id: String,
    pub decision: MutationSinkDecisionKind,
    pub reason: String,
    pub dirty_lod0_pages: u32,
    pub dirty_parent_nodes: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MutationSinkSummary {
    pub total: usize,
    pub dry_run: usize,
    pub blocked: usize,
    pub ready: usize,
    pub applied_placeholder: usize,
    pub duplicate_ids: usize,
}

pub fn decide_mutation_requests(
    rows: &[MutationRequestRow],
    mode: MutationSinkMode,
) -> (Vec<MutationSinkDecision>, MutationSinkSummary) {
    let mut seen = HashSet::new();
    let mut summary = MutationSinkSummary::default();
    let mut decisions = Vec::with_capacity(rows.len());

    for row in rows {
        summary.total += 1;
        let duplicate = !seen.insert(row.request_id.clone());
        if duplicate {
            summary.duplicate_ids += 1;
        }

        let (decision, reason) = if duplicate {
            (
                MutationSinkDecisionKind::Blocked,
                "duplicate_request_id".to_string(),
            )
        } else if !row.requires_authoritative_world_mutation {
            (
                MutationSinkDecisionKind::Blocked,
                "request_does_not_require_authoritative_world_mutation".to_string(),
            )
        } else if row.dirty_lod0_pages == 0 {
            (
                MutationSinkDecisionKind::Blocked,
                "no_dirty_lod0_pages".to_string(),
            )
        } else if row.mutation_status.contains("blocked") {
            (
                MutationSinkDecisionKind::Blocked,
                "upstream_request_blocked".to_string(),
            )
        } else {
            match mode {
                MutationSinkMode::DryRun => (
                    MutationSinkDecisionKind::DryRun,
                    "apply_flag_disabled".to_string(),
                ),
                MutationSinkMode::ApplyRequestedWithoutHook => (
                    MutationSinkDecisionKind::Ready,
                    "apply_requested_but_authoritative_hook_missing".to_string(),
                ),
                MutationSinkMode::ApplyWithAuthoritativeHook => (
                    MutationSinkDecisionKind::AppliedPlaceholder,
                    "authoritative_hook_placeholder_not_invoked_by_clod_layer".to_string(),
                ),
            }
        };

        match decision {
            MutationSinkDecisionKind::DryRun => summary.dry_run += 1,
            MutationSinkDecisionKind::Blocked => summary.blocked += 1,
            MutationSinkDecisionKind::Ready => summary.ready += 1,
            MutationSinkDecisionKind::AppliedPlaceholder => summary.applied_placeholder += 1,
        }

        decisions.push(MutationSinkDecision {
            request_id: row.request_id.clone(),
            frame: row.frame,
            event_id: row.event_id.clone(),
            decision,
            reason,
            dirty_lod0_pages: row.dirty_lod0_pages,
            dirty_parent_nodes: row.dirty_parent_nodes,
        });
    }

    (decisions, summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str) -> MutationRequestRow {
        MutationRequestRow {
            request_id: id.to_string(),
            frame: 12,
            event_id: "edit-0".to_string(),
            kind: "dig".to_string(),
            position_x: 1.0,
            position_y: 2.0,
            position_z: 3.0,
            radius: 4.0,
            strength: 0.5,
            target_height: None,
            dirty_lod0_pages: 2,
            dirty_parent_nodes: 3,
            mutation_status: "dry_run_only".to_string(),
            requires_authoritative_world_mutation: true,
        }
    }

    #[test]
    fn dry_run_mode_never_applies() {
        let (decisions, summary) = decide_mutation_requests(&[row("a")], MutationSinkMode::DryRun);
        assert_eq!(decisions[0].decision, MutationSinkDecisionKind::DryRun);
        assert_eq!(summary.dry_run, 1);
        assert_eq!(summary.applied_placeholder, 0);
    }

    #[test]
    fn apply_without_hook_is_ready_not_applied() {
        let (decisions, summary) = decide_mutation_requests(
            &[row("a")],
            MutationSinkMode::ApplyRequestedWithoutHook,
        );
        assert_eq!(decisions[0].decision, MutationSinkDecisionKind::Ready);
        assert_eq!(summary.ready, 1);
        assert_eq!(summary.applied_placeholder, 0);
    }

    #[test]
    fn duplicates_are_blocked() {
        let (decisions, summary) = decide_mutation_requests(&[row("a"), row("a")], MutationSinkMode::DryRun);
        assert_eq!(decisions[1].decision, MutationSinkDecisionKind::Blocked);
        assert_eq!(summary.duplicate_ids, 1);
    }
}

