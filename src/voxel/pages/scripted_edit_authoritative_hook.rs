//! Authoritative terrain-edit hook contract for scripted CLOD edit QA.
//!
//! CLOD pages are derived caches. This module deliberately models the handoff
//! from the scripted CLOD edit pipeline to the authoritative world/terrain edit
//! system without mutating page meshes directly. The real mutator should live in
//! the terrain/VoxelWorld layer and report back through this contract.

use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq)]
pub struct AuthoritativeEditRequest {
    pub request_id: String,
    pub frame: u64,
    pub checkpoint: String,
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub radius: f32,
    pub strength: f32,
    pub target_height: Option<f32>,
    pub dirty_lod0_pages: u32,
    pub dirty_nodes: u32,
}

impl AuthoritativeEditRequest {
    pub fn is_valid(&self) -> bool {
        !self.request_id.trim().is_empty()
            && matches!(self.kind.as_str(), "dig" | "raise" | "level" | "smooth")
            && self.x.is_finite()
            && self.y.is_finite()
            && self.z.is_finite()
            && self.radius.is_finite()
            && self.radius > 0.0
            && self.strength.is_finite()
            && self.strength > 0.0
            && self.strength <= 1.0
            && (self.kind != "level" || self.target_height.is_some())
            && self.dirty_lod0_pages > 0
            && self.dirty_nodes >= self.dirty_lod0_pages
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthoritativeEditHookMode {
    DryRunOnly,
    ApplyRequestedWithoutHook,
    ApplyWithHook,
}

impl AuthoritativeEditHookMode {
    pub fn from_flags(apply_requested: bool, hook_available: bool) -> Self {
        match (apply_requested, hook_available) {
            (false, _) => Self::DryRunOnly,
            (true, false) => Self::ApplyRequestedWithoutHook,
            (true, true) => Self::ApplyWithHook,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthoritativeEditDecision {
    DryRun,
    HookUnavailable,
    RejectedInvalidRequest,
    AcceptedForAuthoritativeMutation,
}

impl AuthoritativeEditDecision {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DryRun => "dry_run",
            Self::HookUnavailable => "hook_unavailable",
            Self::RejectedInvalidRequest => "rejected_invalid_request",
            Self::AcceptedForAuthoritativeMutation => "accepted_for_authoritative_mutation",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthoritativeEditAuditRow {
    pub request_id: String,
    pub frame: u64,
    pub checkpoint: String,
    pub decision: AuthoritativeEditDecision,
    pub requires_authoritative_world_mutation: bool,
    pub hook_available: bool,
    pub apply_requested: bool,
    pub dirty_lod0_pages: u32,
    pub dirty_nodes: u32,
    pub note: String,
}

pub trait AuthoritativeTerrainEditHook {
    fn apply_scripted_edit(
        &mut self,
        request: &AuthoritativeEditRequest,
    ) -> AuthoritativeEditDecision;
}

#[derive(Default)]
pub struct NoopAuthoritativeTerrainEditHook;

impl AuthoritativeTerrainEditHook for NoopAuthoritativeTerrainEditHook {
    fn apply_scripted_edit(
        &mut self,
        request: &AuthoritativeEditRequest,
    ) -> AuthoritativeEditDecision {
        if request.is_valid() {
            AuthoritativeEditDecision::AcceptedForAuthoritativeMutation
        } else {
            AuthoritativeEditDecision::RejectedInvalidRequest
        }
    }
}

pub fn audit_authoritative_edit_requests<I>(
    requests: I,
    mode: AuthoritativeEditHookMode,
) -> Vec<AuthoritativeEditAuditRow>
where
    I: IntoIterator<Item = AuthoritativeEditRequest>,
{
    let mut seen = HashSet::new();
    let mut hook = NoopAuthoritativeTerrainEditHook;
    requests
        .into_iter()
        .map(|request| {
            let duplicate = !seen.insert(request.request_id.clone());
            let valid = request.is_valid() && !duplicate;
            let decision = match mode {
                AuthoritativeEditHookMode::DryRunOnly => AuthoritativeEditDecision::DryRun,
                AuthoritativeEditHookMode::ApplyRequestedWithoutHook => {
                    AuthoritativeEditDecision::HookUnavailable
                }
                AuthoritativeEditHookMode::ApplyWithHook => {
                    if valid {
                        hook.apply_scripted_edit(&request)
                    } else {
                        AuthoritativeEditDecision::RejectedInvalidRequest
                    }
                }
            };
            let note = if duplicate {
                "duplicate_request_id"
            } else if !request.is_valid() {
                "invalid_request"
            } else {
                match mode {
                    AuthoritativeEditHookMode::DryRunOnly => "dry_run_only",
                    AuthoritativeEditHookMode::ApplyRequestedWithoutHook => "authoritative_hook_missing",
                    AuthoritativeEditHookMode::ApplyWithHook => "accepted_by_contract_hook",
                }
            };
            AuthoritativeEditAuditRow {
                request_id: request.request_id,
                frame: request.frame,
                checkpoint: request.checkpoint,
                decision,
                requires_authoritative_world_mutation: true,
                hook_available: matches!(mode, AuthoritativeEditHookMode::ApplyWithHook),
                apply_requested: !matches!(mode, AuthoritativeEditHookMode::DryRunOnly),
                dirty_lod0_pages: request.dirty_lod0_pages,
                dirty_nodes: request.dirty_nodes,
                note: note.to_string(),
            }
        })
        .collect()
}

pub fn audit_rows_to_csv(rows: &[AuthoritativeEditAuditRow]) -> String {
    let mut out = String::from("request_id,frame,checkpoint,decision,requires_authoritative_world_mutation,hook_available,apply_requested,dirty_lod0_pages,dirty_nodes,note\n");
    for row in rows {
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{}\n",
            csv_escape(&row.request_id),
            row.frame,
            csv_escape(&row.checkpoint),
            row.decision.as_str(),
            row.requires_authoritative_world_mutation,
            row.hook_available,
            row.apply_requested,
            row.dirty_lod0_pages,
            row.dirty_nodes,
            csv_escape(&row.note)
        ));
    }
    out
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: &str) -> AuthoritativeEditRequest {
        AuthoritativeEditRequest {
            request_id: id.to_string(),
            frame: 10,
            checkpoint: "dig-a".to_string(),
            kind: "dig".to_string(),
            x: 1.0,
            y: 2.0,
            z: 3.0,
            radius: 4.0,
            strength: 0.5,
            target_height: None,
            dirty_lod0_pages: 1,
            dirty_nodes: 4,
        }
    }

    #[test]
    fn dry_run_never_accepts_for_mutation() {
        let rows = audit_authoritative_edit_requests(
            [request("r0")],
            AuthoritativeEditHookMode::DryRunOnly,
        );
        assert_eq!(rows[0].decision, AuthoritativeEditDecision::DryRun);
        assert!(!rows[0].hook_available);
        assert!(!rows[0].apply_requested);
    }

    #[test]
    fn apply_without_hook_is_explicitly_blocked() {
        let rows = audit_authoritative_edit_requests(
            [request("r0")],
            AuthoritativeEditHookMode::ApplyRequestedWithoutHook,
        );
        assert_eq!(rows[0].decision, AuthoritativeEditDecision::HookUnavailable);
    }

    #[test]
    fn apply_with_hook_accepts_valid_request() {
        let rows = audit_authoritative_edit_requests(
            [request("r0")],
            AuthoritativeEditHookMode::ApplyWithHook,
        );
        assert_eq!(
            rows[0].decision,
            AuthoritativeEditDecision::AcceptedForAuthoritativeMutation
        );
    }

    #[test]
    fn duplicate_request_is_rejected_in_hook_mode() {
        let rows = audit_authoritative_edit_requests(
            [request("r0"), request("r0")],
            AuthoritativeEditHookMode::ApplyWithHook,
        );
        assert_eq!(
            rows[1].decision,
            AuthoritativeEditDecision::RejectedInvalidRequest
        );
    }
}

