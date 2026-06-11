//! In-engine guards for the ported builder. The full pipeline (watertight/monotone/gate)
//! is validated in tools/clod-rs; here we prove the meshopt FFI links and behaves correctly
//! inside the engine binary (notably the BYTES attribute stride), plus weld conflict rules.

use super::config::ClodPagesConfig;
use super::lock::build_outer_border_locks;
use super::simplify::simplify_page;
use super::types::PageMesh;
use super::weld::weld_vertices;

/// Flat-ish grid with a relief, mirroring the spike: simplify must roughly halve it and
/// keep the locked open border. Proves meshopt works in-engine with the byte attribute stride.
fn grid(n: usize) -> PageMesh {
    let mut m = PageMesh::default();
    for z in 0..n {
        for x in 0..n {
            let (fx, fz) = (x as f32, z as f32);
            m.positions.push([fx, (fx * 0.4).sin() * 1.5 + (fz * 0.3).cos() * 1.2, fz]);
            m.normals.push([0.0, 1.0, 0.0]);
            m.materials.push([1.0, 0.0, 0.0, 0.0]);
        }
    }
    for z in 0..n - 1 {
        for x in 0..n - 1 {
            let a = (z * n + x) as u32;
            let (b, c, d) = (a + 1, a + n as u32, a + n as u32 + 1);
            m.indices.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    m
}

#[test]
fn meshopt_reduces_in_engine_with_byte_stride() {
    let cfg = ClodPagesConfig::load();
    let mesh = grid(33);
    let input_tris = mesh.triangle_count();
    let locks = build_outer_border_locks(&mesh);
    let out = simplify_page(&mesh, &locks, &cfg);
    assert!(
        out.mesh.triangle_count() < input_tris,
        "meshopt must reduce (byte stride!): {} -> {}",
        input_tris,
        out.mesh.triangle_count()
    );
    assert!(out.error_world >= 0.0);
}

#[test]
fn weld_merges_coincident_and_rejects_conflicts() {
    // two coincident verts, identical attrs -> merge
    let mut m = PageMesh::default();
    m.positions = vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, 0.0]];
    m.normals = vec![[0.0, 1.0, 0.0]; 4];
    m.materials = vec![[1.0, 0.0, 0.0, 0.0]; 4];
    m.indices = vec![0, 1, 2, 3, 1, 2];
    let (welded, report) = weld_vertices(&m, 0.001).expect("clean weld");
    assert_eq!(report.merged_vertices, 1, "the duplicate vertex merges");
    assert_eq!(welded.vertex_count(), 3);

    // coincident but conflicting normals -> hard fail
    let mut bad = m.clone();
    bad.normals[3] = [1.0, 0.0, 0.0];
    assert!(weld_vertices(&bad, 0.001).is_err(), "attribute conflict must hard-fail");
}
