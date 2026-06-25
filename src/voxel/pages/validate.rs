//! Builder validation — errors, never warnings. Ported from tools/clod-poc/src/validate.ts.
//! Border detection is topological (open edges), not by footprint plane (Surface Nets
//! vertices sit inside cells → non-planar borders). A sandbox finding.

use super::types::{BorderTolerances, ClodBuildError, PageFootprint, PageMesh};
use std::collections::HashMap;

fn edge_key(a: u32, b: u32) -> u64 {
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    ((lo as u64) << 32) | hi as u64
}

/// Topological border edges = edges used by exactly one triangle.
pub fn border_edges(mesh: &PageMesh) -> Vec<(u32, u32)> {
    let mut count: HashMap<u64, u32> = HashMap::new();
    let idx = &mesh.indices;
    let mut t = 0;
    while t < idx.len() {
        let (a, b, c) = (idx[t], idx[t + 1], idx[t + 2]);
        for (u, v) in [(a, b), (b, c), (c, a)] {
            *count.entry(edge_key(u, v)).or_insert(0) += 1;
        }
        t += 3;
    }
    count
        .iter()
        .filter(|(_, n)| **n == 1)
        .map(|(k, _)| ((*k >> 32) as u32, (*k & 0xffff_ffff) as u32))
        .collect()
}

/// Per-vertex flag: 1 if the vertex lies on the mesh's open (topological) boundary.
/// After internal welding this IS the page's outer border.
pub fn open_boundary_vertex_flags(mesh: &PageMesh) -> Vec<bool> {
    let mut flags = vec![false; mesh.vertex_count()];
    for (a, b) in border_edges(mesh) {
        flags[a as usize] = true;
        flags[b as usize] = true;
    }
    flags
}

const PERIMETER_BAND: f32 = 1.0;

fn dist_to_perimeter(x: f32, z: f32, fp: &PageFootprint) -> f32 {
    (x - fp.min_x)
        .abs()
        .min((x - fp.max_x).abs())
        .min((z - fp.min_z).abs())
        .min((z - fp.max_z).abs())
}

/// Assert every open-boundary vertex hugs the footprint perimeter (no internal seam).
pub fn assert_no_internal_borders(
    mesh: &PageMesh,
    fp: &PageFootprint,
) -> Result<(), ClodBuildError> {
    for (i, &open) in open_boundary_vertex_flags(mesh).iter().enumerate() {
        if !open {
            continue;
        }
        let p = mesh.positions[i];
        let d = dist_to_perimeter(p[0], p[2], fp);
        if d > PERIMETER_BAND {
            return Err(ClodBuildError::InternalBorderNotWelded {
                message: format!(
                    "open-boundary vertex ({:.2},{:.2},{:.2}) is {:.2} units from the footprint perimeter",
                    p[0], p[1], p[2], d
                ),
            });
        }
    }
    Ok(())
}

/// Strip exactly-degenerate (repeated-index or zero-area) triangles. Returns count removed.
pub fn strip_degenerate_triangles(
    mesh: &mut PageMesh,
    zero_area_epsilon: f32,
) -> Result<usize, ClodBuildError> {
    let mut kept = Vec::with_capacity(mesh.indices.len());
    let mut removed = 0;
    let eps_sq = zero_area_epsilon * zero_area_epsilon;
    let mut t = 0;
    while t < mesh.indices.len() {
        let (a, b, c) = (mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]);
        if a == b || b == c || a == c {
            removed += 1;
        } else {
            // zero-area check via cross product
            let pa = mesh.positions[a as usize];
            let pb = mesh.positions[b as usize];
            let pc = mesh.positions[c as usize];
            let abx = pb[0] - pa[0];
            let aby = pb[1] - pa[1];
            let abz = pb[2] - pa[2];
            let acx = pc[0] - pa[0];
            let acy = pc[1] - pa[1];
            let acz = pc[2] - pa[2];
            let nx = aby * acz - abz * acy;
            let ny = abz * acx - abx * acz;
            let nz = abx * acy - aby * acx;
            let area_sq = (nx * nx + ny * ny + nz * nz) * 0.25;
            if area_sq <= eps_sq {
                removed += 1;
            } else {
                kept.extend_from_slice(&[a, b, c]);
            }
        }
        t += 3;
    }
    mesh.indices = kept;
    if mesh.indices.is_empty() && mesh.vertex_count() > 0 {
        return Err(ClodBuildError::DegenerateGeometry {
            message: "all triangles degenerate, mesh is empty".into(),
        });
    }
    Ok(removed)
}

/// Border chain collected along one footprint edge, sorted for deterministic matching.
pub struct BorderChain {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    /// Per-vertex paint slots.
    pub paint_slots: Vec<f32>,
    /// Per-vertex material weights (flat, stride = 4).
    pub material_weights: Vec<f32>,
    pub material_weight_stride: usize,
}

#[derive(Clone, Copy)]
pub enum Axis {
    X,
    Z,
}

/// Collect OPEN-boundary vertices near one footprint plane, sorted, trimming the
/// perpendicular corner zones (adjacent pages turn corners via different diagonal cells).
pub fn border_chain(
    mesh: &PageMesh,
    axis: Axis,
    plane: f32,
    fp: &PageFootprint,
) -> Result<BorderChain, ClodBuildError> {
    let open = open_boundary_vertex_flags(mesh);
    let stride = mesh.material_weight_stride();
    let weights = mesh.material_weights();
    let mut rows: Vec<([f32; 3], [f32; 3], f32, Vec<f32>)> = Vec::new();
    for i in 0..mesh.vertex_count() {
        if !open[i] {
            continue;
        }
        let p = mesh.positions[i];
        let val = match axis {
            Axis::X => p[0],
            Axis::Z => p[2],
        };
        if (val - plane).abs() > PERIMETER_BAND {
            continue;
        }
        match axis {
            Axis::X => {
                if (p[2] - fp.min_z).abs() <= PERIMETER_BAND
                    || (p[2] - fp.max_z).abs() <= PERIMETER_BAND
                {
                    continue;
                }
            }
            Axis::Z => {
                if (p[0] - fp.min_x).abs() <= PERIMETER_BAND
                    || (p[0] - fp.max_x).abs() <= PERIMETER_BAND
                {
                    continue;
                }
            }
        }
        let mut w = vec![0.0f32; stride];
        for j in 0..stride {
            w[j] = weights[i * stride + j];
        }
        let paint = mesh.paint_slots.get(i).copied().unwrap_or(0.0);
        rows.push((p, mesh.normals[i], paint, w));
    }
    let free = match axis {
        Axis::X => 2,
        Axis::Z => 0,
    };
    rows.sort_by(|a, b| {
        a.0[free]
            .partial_cmp(&b.0[free])
            .unwrap()
            .then(a.0[1].partial_cmp(&b.0[1]).unwrap())
    });
    Ok(BorderChain {
        positions: rows.iter().map(|r| r.0).collect(),
        normals: rows.iter().map(|r| r.1).collect(),
        paint_slots: rows.iter().map(|r| r.2).collect(),
        material_weights: rows.iter().flat_map(|r| r.3.clone()).collect(),
        material_weight_stride: stride,
    })
}

/// Assert two adjacent same-level pages share a matching border chain (gate A2).
pub fn assert_border_match(
    a: &BorderChain,
    b: &BorderChain,
    tolerances: BorderTolerances,
) -> Result<(), ClodBuildError> {
    if a.positions.len() != b.positions.len() {
        return Err(ClodBuildError::BorderPositionMismatch {
            message: format!(
                "border vertex counts differ: {} vs {}",
                a.positions.len(),
                b.positions.len()
            ),
        });
    }
    if a.material_weight_stride != b.material_weight_stride {
        return Err(ClodBuildError::BorderMaterialMismatch {
            message: format!(
                "material weight stride mismatch: {} vs {}",
                a.material_weight_stride, b.material_weight_stride
            ),
        });
    }

    let stride = a.material_weight_stride;
    for i in 0..a.positions.len() {
        // Position
        let (pa, pb) = (a.positions[i], b.positions[i]);
        let dp =
            ((pa[0] - pb[0]).powi(2) + (pa[1] - pb[1]).powi(2) + (pa[2] - pb[2]).powi(2)).sqrt();
        if dp > tolerances.position {
            return Err(ClodBuildError::BorderPositionMismatch {
                message: format!("pos delta {dp:.2e} at border vertex {i}"),
            });
        }
        // Normal
        let (na, nb) = (a.normals[i], b.normals[i]);
        let dot = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
        if dot < tolerances.normal_dot {
            return Err(ClodBuildError::BorderNormalMismatch {
                message: format!("normal dot {dot:.5} at border vertex {i}"),
            });
        }
        // Paint slot
        let pd = (a.paint_slots[i] - b.paint_slots[i]).abs();
        if pd > tolerances.material {
            return Err(ClodBuildError::BorderMaterialMismatch {
                message: format!("paint delta {pd:.2e} at border vertex {i}"),
            });
        }
        // Material weight channels
        for j in 0..stride {
            let wd = (a.material_weights[i * stride + j] - b.material_weights[i * stride + j]).abs();
            if wd > tolerances.material {
                return Err(ClodBuildError::BorderMaterialMismatch {
                    message: format!(
                        "material weight channel {j} delta {wd:.2e} at border vertex {i}"
                    ),
                });
            }
        }
    }
    Ok(())
}
