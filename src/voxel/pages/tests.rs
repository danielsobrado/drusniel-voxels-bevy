//! In-engine guards for the ported builder. These cover the full pipeline end-to-end —
//! weld, lock, simplify, quadtree, and validate — on a synthetic terrain field (the golden
//! gate tests originally lived in the now-removed `tools/clod-rs` sandbox). Notably this
//! also proves the meshopt FFI links and behaves correctly inside the engine binary (the
//! BYTES attribute stride), plus weld conflict rules.

use super::config::ClodPagesConfig;
use super::lock::build_outer_border_locks;
use super::quadtree::build_quadtree;
use super::simplify::simplify_page;
use super::synthetic::build_lod0_world;
use super::types::PageMesh;
use super::validate::{Axis, assert_border_match, border_chain};
use super::weld::weld_vertices;
use std::collections::HashMap;

/// Flat-ish grid with a relief, mirroring the spike: simplify must roughly halve it and
/// keep the locked open border. Proves meshopt works in-engine with the byte attribute stride.
fn grid(n: usize) -> PageMesh {
    let mut m = PageMesh::default();
    for z in 0..n {
        for x in 0..n {
            let (fx, fz) = (x as f32, z as f32);
            m.positions
                .push([fx, (fx * 0.4).sin() * 1.5 + (fz * 0.3).cos() * 1.2, fz]);
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
    m.positions = vec![
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, 0.0],
    ];
    m.normals = vec![[0.0, 1.0, 0.0]; 4];
    m.materials = vec![[1.0, 0.0, 0.0, 0.0]; 4];
    m.indices = vec![0, 1, 2, 3, 1, 2];
    let (welded, report) = weld_vertices(&m, 0.001).expect("clean weld");
    assert_eq!(report.merged_vertices, 1, "the duplicate vertex merges");
    assert_eq!(welded.vertex_count(), 3);

    // coincident but conflicting normals -> hard fail
    let mut bad = m.clone();
    bad.normals[3] = [1.0, 0.0, 0.0];
    assert!(
        weld_vertices(&bad, 0.001).is_err(),
        "attribute conflict must hard-fail"
    );
}

/// Golden gate (ported from clod-rs): the full quadtree build over a synthetic 2x2 world is
/// watertight (build_quadtree asserts internal-border welding internally, so a clean build
/// proves A1), has monotone error up the tree, and decimates vs LOD0.
#[test]
fn builds_2x2_watertight_monotone_and_reduced() {
    let cfg = ClodPagesConfig::load();
    let lod0 = build_lod0_world(2, 2, &cfg).expect("2x2 source build");
    let result = build_quadtree(lod0, &cfg).expect("2x2 build must be watertight");

    assert_eq!(result.nodes_by_level[0].len(), 4, "2x2 has 4 LOD0 pages");
    for n in &result.nodes_by_level[0] {
        assert_eq!(n.error_world, 0.0, "LOD0 is the reference, error 0");
    }

    // error_world monotone up the tree (required for a stable DAG cut)
    let max_per_level: Vec<f32> = result
        .nodes_by_level
        .iter()
        .map(|ns| ns.iter().map(|n| n.error_world).fold(0.0, f32::max))
        .collect();
    for w in max_per_level.windows(2) {
        assert!(
            w[1] >= w[0],
            "error must be monotone up the tree: {max_per_level:?}"
        );
    }

    // top level decimates vs LOD0
    let lod0_tris: usize = result.nodes_by_level[0]
        .iter()
        .map(|n| n.mesh.triangle_count())
        .sum();
    let top: usize = result
        .nodes_by_level
        .last()
        .unwrap()
        .iter()
        .map(|n| n.mesh.triangle_count())
        .sum();
    assert!(
        top * 2 <= lod0_tris,
        "top level should roughly halve per level: {top} vs {lod0_tris}"
    );
}

/// Golden gate (ported from clod-rs): adjacent same-level pages share a matching border
/// chain (gate A2). Exercises the topological-border `validate` path end-to-end.
#[test]
fn adjacent_pages_share_matching_borders() {
    let cfg = ClodPagesConfig::load();
    let lod0 = build_lod0_world(4, 4, &cfg).expect("4x4 source build");
    let result = build_quadtree(lod0, &cfg).expect("4x4 build");
    let mut checks = 0;
    for (lvl, nodes) in result.nodes_by_level.iter().enumerate() {
        let span = ((1usize << lvl) * cfg.page.chunks_per_page * cfg.page.chunk_size) as f32;
        let mut idx: HashMap<(i32, i32), usize> = HashMap::new();
        for (i, n) in nodes.iter().enumerate() {
            idx.insert(
                (
                    (n.footprint.min_x / span) as i32,
                    (n.footprint.min_z / span) as i32,
                ),
                i,
            );
        }
        for (&(nx, nz), &ai) in &idx {
            let a = &nodes[ai];
            if let Some(&ri) = idx.get(&(nx + 1, nz)) {
                let r = &nodes[ri];
                assert_border_match(
                    &border_chain(&a.mesh, Axis::X, a.footprint.max_x, &a.footprint),
                    &border_chain(&r.mesh, Axis::X, r.footprint.min_x, &r.footprint),
                )
                .expect("x border match");
                checks += 1;
            }
        }
    }
    assert!(checks > 0, "expected adjacent page pairs to check");
}
