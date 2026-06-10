//! Regression guard for the Rust CLOD builder. `build_world` runs the watertightness
//! asserts internally (returns Err on any weld/internal-border failure), so a clean build
//! already proves A1; here we also pin monotone error, reduction, and A2 border matching.

use clod_rs::config::ClodPagesConfig;
use clod_rs::quadtree::build_world;
use clod_rs::validate::{assert_border_match, border_chain, Axis};
use std::collections::HashMap;

#[test]
fn builds_2x2_watertight_monotone_and_reduced() {
    let cfg = ClodPagesConfig::load();
    let result = build_world(2, 2, &cfg).expect("2x2 build must be watertight");

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
        assert!(w[1] >= w[0], "error must be monotone up the tree: {max_per_level:?}");
    }

    // top level decimates vs LOD0
    let lod0: usize = result.nodes_by_level[0].iter().map(|n| n.mesh.triangle_count()).sum();
    let top: usize = result.nodes_by_level.last().unwrap().iter().map(|n| n.mesh.triangle_count()).sum();
    assert!(top * 2 <= lod0, "top level should roughly halve per level: {top} vs {lod0}");
}

#[test]
fn adjacent_pages_share_matching_borders() {
    let cfg = ClodPagesConfig::load();
    let result = build_world(4, 4, &cfg).expect("4x4 build");
    let mut checks = 0;
    for (lvl, nodes) in result.nodes_by_level.iter().enumerate() {
        let span = ((1usize << lvl) * cfg.page.chunks_per_page * cfg.page.chunk_size) as f32;
        let mut idx: HashMap<(i32, i32), usize> = HashMap::new();
        for (i, n) in nodes.iter().enumerate() {
            idx.insert(((n.footprint.min_x / span) as i32, (n.footprint.min_z / span) as i32), i);
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
