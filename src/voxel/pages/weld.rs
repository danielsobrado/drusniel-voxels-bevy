//! Spatial-hash vertex weld; attribute conflict = hard fail. Ported from clod-rs (§11.3).

use super::types::{ClodBuildError, PageMesh, DEFAULT_TOLERANCES};
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

/// Welds vertices within `epsilon` by quantized position. A position match with a normal or
/// material mismatch is DirtyInput — fail with the offending pair, never count-and-continue.
pub fn weld_vertices(mesh: &PageMesh, epsilon: f32) -> Result<(PageMesh, WeldReport), ClodBuildError> {
    let n = mesh.vertex_count();
    let inv = 1.0 / epsilon;
    let tol = &DEFAULT_TOLERANCES;

    let mut canonical: HashMap<(i64, i64, i64), u32> = HashMap::new();
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
            let mut mat_delta = 0.0f32;
            for c in 0..4 {
                mat_delta = mat_delta.max((mesh.materials[i][c] - out.materials[f][c]).abs());
            }
            if dot < tol.normal_dot || mat_delta > tol.material {
                return Err(ClodBuildError::DirtyInput(format!(
                    "weld conflict at ({:.3},{:.3},{:.3}): normal dot {:.5} (need >= {}), material delta {:.2e} (need <= {})",
                    p[0], p[1], p[2], dot, tol.normal_dot, mat_delta, tol.material
                )));
            }
            remap[i] = found;
        } else {
            let ni = out.positions.len() as u32;
            canonical.insert(key, ni);
            remap[i] = ni;
            out.positions.push(p);
            out.normals.push(mesh.normals[i]);
            out.materials.push(mesh.materials[i]);
        }
    }

    out.indices = mesh.indices.iter().map(|&idx| remap[idx as usize]).collect();
    let report = WeldReport {
        input_vertices: n,
        output_vertices: out.positions.len(),
        merged_vertices: n - out.positions.len(),
    };
    Ok((out, report))
}
