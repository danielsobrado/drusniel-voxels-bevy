//! Spatial-hash vertex weld. Ported from clod-rs (§11.3).

use super::types::{ClodBuildError, DEFAULT_TOLERANCES, PageMesh};
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

/// Welds vertices within `epsilon` by quantized position. Normal conflicts remain dirty input;
/// material weights from independently meshed chunk borders are reconciled onto the canonical
/// vertex with an incremental average.
pub fn weld_vertices(
    mesh: &PageMesh,
    epsilon: f32,
) -> Result<(PageMesh, WeldReport), ClodBuildError> {
    let n = mesh.vertex_count();
    let inv = 1.0 / epsilon;
    let tol = &DEFAULT_TOLERANCES;

    let mut canonical: HashMap<(i64, i64, i64), u32> = HashMap::new();
    let mut canonical_counts: Vec<u32> = Vec::new();
    let mut remap = vec![0u32; n];
    let mut out = PageMesh::default();

    for i in 0..n {
        let p = mesh.positions[i];
        let key = quant_key(p, inv);
        if let Some(&found) = canonical.get(&key) {
            let f = found as usize;
            let a = mesh.normals[i];
            let b = out.normals[f];
            let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            if dot < tol.normal_dot {
                return Err(ClodBuildError::DirtyInput(format!(
                    "weld conflict at ({:.3},{:.3},{:.3}): normal dot {:.5} (need >= {})",
                    p[0], p[1], p[2], dot, tol.normal_dot
                )));
            }
            let count = canonical_counts[f] as f32;
            let next_count = count + 1.0;
            out.normals[f] = normalize([
                (out.normals[f][0] * count + a[0]) / next_count,
                (out.normals[f][1] * count + a[1]) / next_count,
                (out.normals[f][2] * count + a[2]) / next_count,
            ]);
            for c in 0..4 {
                out.materials[f][c] =
                    (out.materials[f][c] * count + mesh.materials[i][c]) / next_count;
            }
            canonical_counts[f] += 1;
            remap[i] = found;
        } else {
            let ni = out.positions.len() as u32;
            canonical.insert(key, ni);
            remap[i] = ni;
            out.positions.push(p);
            out.normals.push(mesh.normals[i]);
            out.materials.push(mesh.materials[i]);
            canonical_counts.push(1);
        }
    }

    out.indices = mesh
        .indices
        .iter()
        .map(|&idx| remap[idx as usize])
        .collect();
    let report = WeldReport {
        input_vertices: n,
        output_vertices: out.positions.len(),
        merged_vertices: n - out.positions.len(),
    };
    Ok((out, report))
}
