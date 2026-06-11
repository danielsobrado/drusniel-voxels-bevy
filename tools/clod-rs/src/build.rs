//! Phase 4 headless builder + Phase 3 gate verdict (Rust). Mirrors tools/clod-poc/src/build.ts.
//! Run from tools/clod-rs:  RUSTC_WRAPPER="" cargo run --bin clod_build --release [worldPages]

use clod_rs::config::ClodPagesConfig;
use clod_rs::quadtree::build_world;
use clod_rs::validate::{assert_border_match, border_chain, Axis};
use std::collections::HashMap;

fn main() {
    let cfg = ClodPagesConfig::load();
    let world: i32 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(4);

    let t0 = std::time::Instant::now();
    let result = build_world(world, world, &cfg).unwrap_or_else(|e| {
        eprintln!("\nBUILD FAILED: {e}");
        std::process::exit(1);
    });
    let total_ms = t0.elapsed().as_secs_f64() * 1000.0;

    println!(
        "\n=== CLOD page build (Rust): {world}x{world} LOD0 pages, {} levels ===",
        cfg.page.quadtree_levels
    );
    println!(
        "page = {}x{} chunks of {} cells\n",
        cfg.page.chunks_per_page, cfg.page.chunks_per_page, cfg.page.chunk_size
    );

    println!("level   nodes      tris   avg_err_world  low_benefit   build_ms");
    let mut lod0_tris = 0usize;
    let mut top_tris = 0usize;
    for (lvl, nodes) in result.nodes_by_level.iter().enumerate() {
        let lvl_stats: Vec<_> = result.stats.iter().filter(|s| s.level == lvl).collect();
        let tris: usize = nodes.iter().map(|n| n.mesh.triangle_count()).sum();
        let avg_err = lvl_stats.iter().map(|s| s.error_world).sum::<f32>() / lvl_stats.len().max(1) as f32;
        let low = lvl_stats.iter().filter(|s| s.low_benefit).count();
        let ms: f64 = lvl_stats.iter().map(|s| s.build_ms).sum();
        println!(
            "  {lvl}   {:>5}  {:>8}   {:>11.3e}   {:>4}/{:<4}  {:>8.1}",
            nodes.len(),
            tris,
            avg_err,
            low,
            lvl_stats.len(),
            ms
        );
        if lvl == 0 {
            lod0_tris = tris;
        }
        top_tris = tris;
    }
    println!("\ntotal build: {total_ms:.1} ms");

    let low_stats: Vec<_> = result.stats.iter().filter(|s| s.level >= 1 && s.level <= 2).collect();
    let low_rate = if low_stats.is_empty() {
        0.0
    } else {
        low_stats.iter().filter(|s| s.low_benefit).count() as f32 / low_stats.len() as f32
    };
    let per_area = top_tris as f32 / lod0_tris.max(1) as f32;

    // A2 border match: adjacent same-level page pairs.
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
                .expect("A2 border match (x)");
                checks += 1;
            }
            if let Some(&di) = idx.get(&(nx, nz + 1)) {
                let d = &nodes[di];
                assert_border_match(
                    &border_chain(&a.mesh, Axis::Z, a.footprint.max_z, &a.footprint),
                    &border_chain(&d.mesh, Axis::Z, d.footprint.min_z, &d.footprint),
                )
                .expect("A2 border match (z)");
                checks += 1;
            }
        }
    }

    let max_node_ms = result.stats.iter().map(|s| s.build_ms).fold(0.0, f64::max);
    let v = |ok: bool| if ok { "PASS" } else { "FAIL" };
    let a1 = true;
    let a2 = checks > 0;
    let a4 = per_area <= 0.15;
    let a5 = total_ms < 30_000.0 && max_node_ms < 250.0;
    let a6 = low_rate < 0.1;
    println!("\n=== Phase 3 acceptance gate (§5) — Rust ===");
    println!("A1 watertight (weld + no-internal-border asserts):    {}", v(a1));
    println!("A2 no dark seams (matched border attrs):              {}  ({checks} pairs)", v(a2));
    println!("A3 density scars acceptable:                          VISUAL — see tools/clod-poc viewer");
    println!("A4 triangle reduction (LOD top <= ~15% of LOD0):      {}  ({:.1}%)", v(a4), per_area * 100.0);
    println!(
        "A5 build cost (seconds total, tens of ms / node):     {}  (total {:.1}s, max node {:.0}ms)",
        v(a5),
        total_ms / 1000.0,
        max_node_ms
    );
    println!("A6 low-benefit rate (< 10% at levels 1-2):           {}  ({:.1}%)", v(a6), low_rate * 100.0);
    println!("\nMEASURED CRITERIA: {}  (A3 remains a visual judgement)", v(a1 && a2 && a4 && a5 && a6));
}
