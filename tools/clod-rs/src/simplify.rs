//! SOLE meshoptimizer boundary (§11.5). Port of simplify.ts. Never simplify_sloppy.
//!
//! Carries normals + material weights and honours per-vertex locks. The attribute stride
//! passed to meshopt is in BYTES (PoC/Rust finding — the JS npm wrapper uses floats).

use crate::config::ClodPagesConfig;
use crate::types::PageMesh;
use meshopt::{simplify_scale, simplify_with_attributes_and_locks, SimplifyOptions, VertexDataAdapter};
use std::collections::HashMap;

const ATTR_STRIDE: usize = 7; // normal(3) + material(4)

pub struct SimplifyOutput {
    pub mesh: PageMesh,
    pub result_error: f32,
    pub error_world: f32,
    pub low_benefit: bool,
}

fn adapter(positions: &[[f32; 3]]) -> VertexDataAdapter<'_> {
    let bytes: &[u8] = bytemuck::cast_slice(positions);
    VertexDataAdapter::new(bytes, std::mem::size_of::<[f32; 3]>(), 0).expect("vertex adapter")
}

/// World-space simplification error scale for a mesh (meshopt_simplifyScale).
pub fn simplify_scale_of(mesh: &PageMesh) -> f32 {
    simplify_scale(&adapter(&mesh.positions))
}

pub fn simplify_page(mesh: &PageMesh, locks: &[bool], cfg: &ClodPagesConfig) -> SimplifyOutput {
    let vc = mesh.vertex_count();
    let input_indices = mesh.indices.len();
    let target = ((input_indices as f32 * cfg.simplify.target_ratio_per_level) as usize).max(3);

    let mut attrs = vec![0f32; vc * ATTR_STRIDE];
    for i in 0..vc {
        attrs[i * ATTR_STRIDE..i * ATTR_STRIDE + 3].copy_from_slice(&mesh.normals[i]);
        attrs[i * ATTR_STRIDE + 3..i * ATTR_STRIDE + 7].copy_from_slice(&mesh.materials[i]);
    }
    let wn = cfg.simplify.attribute_weights.normal;
    let wm = cfg.simplify.attribute_weights.material;
    let weights = [wn, wn, wn, wm, wm, wm, wm];

    let scale = simplify_scale_of(mesh);
    let mut result_error = 0f32;
    let new_indices = simplify_with_attributes_and_locks(
        &mesh.indices,
        &adapter(&mesh.positions),
        &attrs,
        &weights,
        ATTR_STRIDE * std::mem::size_of::<f32>(), // BYTES, not floats
        locks,
        target,
        cfg.simplify.target_error,
        SimplifyOptions::LockBorder,
        Some(&mut result_error),
    );

    let mesh = compact(mesh, &new_indices);
    let error_world = result_error * scale;
    let low_benefit = new_indices.len() as f32 > cfg.simplify.abandon_ratio * input_indices as f32;
    SimplifyOutput {
        mesh,
        result_error,
        error_world,
        low_benefit,
    }
}

/// Drop unreferenced vertices and remap indices.
fn compact(mesh: &PageMesh, indices: &[u32]) -> PageMesh {
    let mut remap: HashMap<u32, u32> = HashMap::new();
    let mut out = PageMesh::default();
    out.indices.reserve(indices.len());
    for &old in indices {
        let ni = *remap.entry(old).or_insert_with(|| {
            let ni = out.positions.len() as u32;
            out.positions.push(mesh.positions[old as usize]);
            out.normals.push(mesh.normals[old as usize]);
            out.materials.push(mesh.materials[old as usize]);
            ni
        });
        out.indices.push(ni);
    }
    out
}
