//! SOLE meshoptimizer boundary (§11.5). Ported from tools/clod-poc/src/simplify.ts.
//! The attribute stride passed to meshopt is in BYTES (a sandbox finding).

use super::config::ClodPagesConfig;
use super::types::{ClodBuildError, PageMesh};
use meshopt::{
    SimplifyOptions, VertexDataAdapter, simplify_scale, simplify_with_attributes_and_locks,
};
use std::collections::HashMap;

const ATTR_STRIDE: usize = 7; // normal(3) + material(4)

pub struct SimplifyOutput {
    pub mesh: PageMesh,
    pub result_error: f32,
    pub error_world: f32,
    pub low_benefit: bool,
}

/// Trait abstracting page simplification (enables testing with mock simplifier).
pub trait PageSimplifier {
    fn simplify_page(
        &self,
        mesh: &PageMesh,
        locks: &[bool],
        cfg: &ClodPagesConfig,
    ) -> Result<SimplifyOutput, ClodBuildError>;
}

/// Real meshoptimizer-based simplifier.
pub struct MeshoptSimplifier;

impl PageSimplifier for MeshoptSimplifier {
    fn simplify_page(
        &self,
        mesh: &PageMesh,
        locks: &[bool],
        cfg: &ClodPagesConfig,
    ) -> Result<SimplifyOutput, ClodBuildError> {
        Ok(simplify_page(mesh, locks, cfg))
    }
}

/// Convenience wrapper: call simplify_page_inner and expect success (panics on error).
pub fn simplify_page(
    mesh: &PageMesh,
    locks: &[bool],
    cfg: &ClodPagesConfig,
) -> SimplifyOutput {
    simplify_page_inner(mesh, locks, cfg).expect("simplify_page failed")
}

fn adapter(positions: &[[f32; 3]]) -> VertexDataAdapter<'_> {
    let bytes: &[u8] = bytemuck::cast_slice(positions);
    VertexDataAdapter::new(bytes, std::mem::size_of::<[f32; 3]>(), 0).expect("vertex adapter")
}

pub fn simplify_scale_of(mesh: &PageMesh) -> f32 {
    simplify_scale(&adapter(&mesh.positions))
}

fn simplify_page_inner(
    mesh: &PageMesh,
    locks: &[bool],
    cfg: &ClodPagesConfig,
) -> Result<SimplifyOutput, ClodBuildError> {
    let vc = mesh.vertex_count();
    let input_indices = mesh.indices.len();
    let target = ((input_indices as f32 * cfg.simplify.target_ratio_per_level) as usize).max(3);

    let mut attrs = vec![0f32; vc * ATTR_STRIDE];
    for i in 0..vc {
        attrs[i * ATTR_STRIDE..i * ATTR_STRIDE + 3].copy_from_slice(&mesh.normals[i]);
        // Flatten material weights from [f32; 4] into attrs
        let m = if i < mesh.materials.len() {
            mesh.materials[i]
        } else {
            [0.0; 4]
        };
        attrs[i * ATTR_STRIDE + 3..i * ATTR_STRIDE + 7].copy_from_slice(&m);
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
    Ok(SimplifyOutput {
        mesh,
        result_error,
        error_world,
        low_benefit,
    })
}

/// Drop unreferenced vertices and remap indices. Preserves all attributes verbatim.
fn compact(mesh: &PageMesh, indices: &[u32]) -> PageMesh {
    let mut remap: HashMap<u32, u32> = HashMap::new();
    let mut out = PageMesh::default();
    out.material_weight_stride = mesh.material_weight_stride();
    out.indices.reserve(indices.len());
    for &old in indices {
        let ni = *remap.entry(old).or_insert_with(|| {
            let ni = out.positions.len() as u32;
            out.positions.push(mesh.positions[old as usize]);
            out.normals.push(mesh.normals[old as usize]);
            out.materials.push(mesh.materials[old as usize]);
            out.paint_slots
                .push(mesh.paint_slots.get(old as usize).copied().unwrap_or(0.0));
            ni
        });
        out.indices.push(ni);
    }
    out
}
