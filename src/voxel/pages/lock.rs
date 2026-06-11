//! Outer-border lock detection (§11.4). Topological open boundary, not footprint planes —
//! a sandbox finding (Surface Nets vertices sit inside cells, so the border is non-planar).

use super::types::PageMesh;
use super::validate::open_boundary_vertex_flags;

pub fn build_outer_border_locks(mesh: &PageMesh) -> Vec<bool> {
    open_boundary_vertex_flags(mesh)
}

pub fn count_locks(locks: &[bool]) -> usize {
    locks.iter().filter(|&&l| l).count()
}
