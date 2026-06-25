//! Spatial-hash vertex weld. Ported from tools/clod-poc/src/weld.ts.
//!
//! Welds vertices within `epsilon` by quantized position. A position match with a normal,
//! paint-slot, or material-weight conflict is DirtyInput -> hard fail. On valid match,
//! normals and material weights are averaged incrementally.

use super::types::{BorderTolerances, ClodBuildError, PageMesh};
use std::collections::HashMap;

pub struct WeldReport {
    pub input_vertices: usize,
    pub output_vertices: usize,
    pub merged_vertices: usize,
}

fn quant_key(p: [f32; 3], inv: f32) -> (i64, i64, i64) {
    (
        (p[0] * inv).round() as i64,
        (p[1] * inv).round() as i64,
        (p[2] * inv).round() as i64,
    )
}

fn normalize(v: [f32; 3]) -> [f32; 3] {
    let len_sq = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if len_sq <= f32::EPSILON {
        return v;
    }
    let inv = len_sq.sqrt().recip();
    [v[0] * inv, v[1] * inv, v[2] * inv]
}

/// Weld vertices within `epsilon` by quantized position hash. Takes explicit tolerances.
/// Paint slots are checked for conflict; material weights are averaged on valid merge.
pub fn weld_vertices(
    mesh: &PageMesh,
    epsilon: f32,
    tolerances: BorderTolerances,
) -> Result<(PageMesh, WeldReport), ClodBuildError> {
    let n = mesh.vertex_count();
    let inv = 1.0 / epsilon;
    let stride = mesh.material_weight_stride();

    let mut canonical: HashMap<(i64, i64, i64), u32> = HashMap::new();
    let mut canonical_counts: Vec<u32> = Vec::new();
    let mut remap = vec![0u32; n];
    let mut out = PageMesh::default();
    let weights = mesh.material_weights();

    for i in 0..n {
        let p = mesh.positions[i];
        let key = quant_key(p, inv);
        if let Some(&found) = canonical.get(&key) {
            let f = found as usize;

            // Normal conflict check
            let dot = mesh.normals[i][0] * out.normals[f][0]
                + mesh.normals[i][1] * out.normals[f][1]
                + mesh.normals[i][2] * out.normals[f][2];
            if dot < tolerances.normal_dot {
                return Err(ClodBuildError::DirtyInput {
                    message: format!(
                        "weld conflict at ({:.3},{:.3},{:.3}): normal dot {:.5} (need >= {})",
                        p[0], p[1], p[2], dot, tolerances.normal_dot
                    ),
                });
            }

            // Paint-slot conflict check
            let paint_delta = (mesh.paint_slots.get(i).copied().unwrap_or(0.0)
                - out.paint_slots.get(f).copied().unwrap_or(0.0))
            .abs();
            if paint_delta > tolerances.material {
                return Err(ClodBuildError::DirtyInput {
                    message: format!(
                        "weld conflict at ({:.3},{:.3},{:.3}): paint delta {:.2e} (need <= {})",
                        p[0], p[1], p[2], paint_delta, tolerances.material
                    ),
                });
            }

            // Material-weight conflict check (for each channel)
            let mut max_weight_delta = 0.0;
            for j in 0..stride {
                let wd = (weights[i * stride + j]
                    - out.material_weights()[f * stride + j])
                .abs();
                if wd > max_weight_delta {
                    max_weight_delta = wd;
                }
            }
            if max_weight_delta > tolerances.material {
                return Err(ClodBuildError::DirtyInput {
                    message: format!(
                        "weld conflict at ({:.3},{:.3},{:.3}): max weight delta {:.2e} (need <= {})",
                        p[0], p[1], p[2], max_weight_delta, tolerances.material
                    ),
                });
            }

            // Average normals
            let count = canonical_counts[f] as f32;
            let next_count = count + 1.0;
            out.normals[f] = normalize([
                (out.normals[f][0] * count + mesh.normals[i][0]) / next_count,
                (out.normals[f][1] * count + mesh.normals[i][1]) / next_count,
                (out.normals[f][2] * count + mesh.normals[i][2]) / next_count,
            ]);

            // Average material weights
            let out_w = out.material_weights_mut();
            for j in 0..stride {
                let idx = f * stride + j;
                out_w[idx] = (out_w[idx] * count + weights[i * stride + j]) / next_count;
            }

            canonical_counts[f] += 1;
            remap[i] = found;
        } else {
            let ni = out.positions.len() as u32;
            canonical.insert(key, ni);
            remap[i] = ni;
            out.positions.push(p);
            out.normals.push(mesh.normals[i]);
            // Copy material weights as [f32; 4] via materials
            if i < mesh.materials.len() {
                out.materials.push(mesh.materials[i]);
            } else {
                out.materials.push([0.0; 4]);
            }
            out.paint_slots.push(mesh.paint_slots.get(i).copied().unwrap_or(0.0));
            canonical_counts.push(1);
        }
    }

    out.indices = mesh
        .indices
        .iter()
        .map(|&idx| remap[idx as usize])
        .collect();
    out.material_weight_stride = stride;

    let report = WeldReport {
        input_vertices: n,
        output_vertices: out.positions.len(),
        merged_vertices: n - out.positions.len(),
    };
    Ok((out, report))
}
