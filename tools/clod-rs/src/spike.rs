// Phase 0 (Rust) — meshopt crate API verification spike. Plan §2 / §6.
//
// Confirms the `meshopt` crate (0.6.x) exposes attribute-aware simplification with
// per-vertex locks and a world-error scale — so the Phase 4 builder needs NO raw
// meshopt-sys FFI. Mirrors tools/clod-poc/src/spike.ts. Run from tools/clod-rs:
//   RUSTC_WRAPPER="" cargo run --bin clod_spike --release

use meshopt::{simplify_scale, simplify_with_attributes_and_locks, SimplifyOptions, VertexDataAdapter};
use std::collections::HashSet;

const N: usize = 33; // 33x33 grid -> 32x32 quads
const CELL: f32 = 1.0;

fn main() {
    let mut positions: Vec<[f32; 3]> = Vec::new();
    let mut normals: Vec<[f32; 3]> = Vec::new();
    let mut materials: Vec<[f32; 4]> = Vec::new();
    for z in 0..N {
        for x in 0..N {
            let wx = x as f32 * CELL;
            let wz = z as f32 * CELL;
            let wy = (wx * 0.4).sin() * 1.5 + (wz * 0.3).cos() * 1.2;
            positions.push([wx, wy, wz]);
            normals.push([0.0, 1.0, 0.0]);
            materials.push([1.0, 0.0, 0.0, 0.0]);
        }
    }
    let mut indices: Vec<u32> = Vec::new();
    for z in 0..N - 1 {
        for x in 0..N - 1 {
            let a = (z * N + x) as u32;
            let b = a + 1;
            let c = a + N as u32;
            let d = c + 1;
            indices.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    let vc = positions.len();

    // Lock the 4 outer borders.
    let max = (N - 1) as f32 * CELL;
    let locks: Vec<bool> = positions
        .iter()
        .map(|p| p[0] == 0.0 || p[0] == max || p[2] == 0.0 || p[2] == max)
        .collect();
    let locked_total = locks.iter().filter(|&&l| l).count();

    // Interleave attributes: normal(3) + material(4), stride 7.
    const STRIDE: usize = 7;
    let mut attrs = vec![0f32; vc * STRIDE];
    for i in 0..vc {
        attrs[i * STRIDE..i * STRIDE + 3].copy_from_slice(&normals[i]);
        attrs[i * STRIDE + 3..i * STRIDE + 7].copy_from_slice(&materials[i]);
    }
    let weights = [0.5f32, 0.5, 0.5, 1.0, 1.0, 1.0, 1.0];
    // meshopt's C/Rust API wants the attribute stride in BYTES (unlike the JS npm wrapper,
    // which takes floats). Passing 7 here reads garbage and blocks all collapses.
    const ATTR_STRIDE_BYTES: usize = STRIDE * std::mem::size_of::<f32>();

    let vbytes: &[u8] = bytemuck::cast_slice(&positions);
    let adapter = VertexDataAdapter::new(vbytes, std::mem::size_of::<[f32; 3]>(), 0)
        .expect("vertex adapter");
    let scale = simplify_scale(&adapter);
    let target = indices.len() / 2;

    let mut result_error = 0f32;
    let out = simplify_with_attributes_and_locks(
        &indices,
        &adapter,
        &attrs,
        &weights,
        ATTR_STRIDE_BYTES,
        &locks,
        target,
        0.01,
        SimplifyOptions::LockBorder,
        Some(&mut result_error),
    );
    let error_world = result_error * scale;

    let used: HashSet<u32> = out.iter().copied().collect();
    let survived = (0..vc).filter(|&i| locks[i] && used.contains(&(i as u32))).count();

    println!("=== Phase 0 (Rust) meshopt spike ===");
    println!("crate : meshopt 0.6.x, simplify_with_attributes_and_locks + simplify_scale");
    println!("input : {} tris, {vc} verts, {locked_total} locked", indices.len() / 3);
    println!("output: {} tris", out.len() / 3);
    println!("error : result_error = {result_error:.3e}");
    println!("scale : simplify_scale = {scale:.4}");
    println!("error_world = result_error * scale = {error_world:.3e}");
    println!("locked border survived verbatim: {survived}/{locked_total}");

    assert_eq!(survived, locked_total, "FAIL: locked border vertices removed");
    println!("PASS: locks honoured, attributes carried, world error computed.");
}
