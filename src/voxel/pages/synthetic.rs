//! Test-only synthetic terrain stand-in for the engine's Surface Nets mesher.
//! Ported from the (now-removed) `tools/clod-rs` sandbox so the end-to-end quadtree gate
//! tests (watertight / monotone / A2 border match) survive inside the engine crate.
//! Global field, meshed per chunk with a halo, so chunk borders weld watertight by
//! construction. Includes the §4.4 stress features (cliff at x=128, overhang at 128,128).

use super::config::ClodPagesConfig;
use super::source_mesh::{PageSource, concat};
use super::types::{ClodBuildError, PageFootprint, PageMesh};
use super::weld::weld_vertices;
use std::collections::HashMap;

const Y_CELLS: i32 = 56;

#[derive(Clone, Copy)]
pub struct WorldBounds {
    pub cells_x: i32,
    pub cells_z: i32,
}

// ---- global field ----

fn hash2(x: i32, z: i32) -> f32 {
    let mut h: i32 = x.wrapping_mul(374761393) ^ z.wrapping_mul(668265263);
    h = (h ^ ((h as u32 >> 13) as i32)).wrapping_mul(1274126177);
    let u = (h ^ ((h as u32 >> 16) as i32)) as u32;
    u as f32 / 4294967295.0
}

fn smooth(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

fn value_noise2(x: f32, z: f32) -> f32 {
    let xi = x.floor();
    let zi = z.floor();
    let xf = smooth(x - xi);
    let zf = smooth(z - zi);
    let (xi, zi) = (xi as i32, zi as i32);
    let a = hash2(xi, zi);
    let b = hash2(xi + 1, zi);
    let c = hash2(xi, zi + 1);
    let d = hash2(xi + 1, zi + 1);
    a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf
}

fn fbm2(x: f32, z: f32) -> f32 {
    let mut sum = 0.0;
    let mut amp = 1.0;
    let mut freq = 1.0;
    let mut norm = 0.0;
    for _ in 0..4 {
        sum += amp * value_noise2(x * freq, z * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    sum / norm
}

fn surface_height(x: f32, z: f32) -> f32 {
    let f = fbm2(x * 0.035, z * 0.035);
    let ridge = ((x * 0.04).sin() + (z * 0.05).cos()).abs() * 4.0;
    let cliff = 9.0 * smooth(((x - 124.0) / 8.0).clamp(0.0, 1.0));
    16.0 + f * 18.0 + ridge + cliff
}

/// density > 0 = solid, < 0 = air. Isosurface at 0.
pub fn density(x: f32, y: f32, z: f32) -> f32 {
    let base = surface_height(x, z) - y;
    let dx = x - 128.0;
    let dz = z - 128.0;
    let bulge =
        6.0 * (-(dx * dx + dz * dz) / 900.0).exp() * (-((y - 30.0) * (y - 30.0)) / 120.0).exp();
    base + bulge
}

fn gradient(x: f32, y: f32, z: f32) -> [f32; 3] {
    let e = 0.5;
    let gx = density(x + e, y, z) - density(x - e, y, z);
    let gy = density(x, y + e, z) - density(x, y - e, z);
    let gz = density(x, y, z + e) - density(x, y, z - e);
    let (nx, ny, nz) = (-gx, -gy, -gz);
    let len = (nx * nx + ny * ny + nz * nz).sqrt().max(1e-20);
    [nx / len, ny / len, nz / len]
}

fn materials(y: f32, ny: f32) -> [f32; 4] {
    let slope = 1.0 - ny.max(0.0);
    let sand = (1.0 - (y - 12.0).abs() / 6.0).max(0.0);
    let snow = ((y - 30.0) / 10.0).max(0.0);
    let rock = slope;
    let grass = (1.0 - sand - snow - rock).max(0.0);
    let sum = (sand + snow + rock + grass).max(1e-20);
    [grass / sum, rock / sum, sand / sum, snow / sum]
}

// ---- per-chunk surface nets ----

// CCW cell-corner loops around each axis edge (offsets to the cell min-corner).
const QUAD_X: [[i32; 3]; 4] = [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]];
const QUAD_Y: [[i32; 3]; 4] = [[-1, 0, -1], [-1, 0, 0], [0, 0, 0], [0, 0, -1]];
const QUAD_Z: [[i32; 3]; 4] = [[-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0]];

fn cell_key(ci: i32, cj: i32, ck: i32) -> i64 {
    (((ci + 512) as i64 * 2048 + (cj + 512) as i64) * 2048) + (ck + 512) as i64
}

struct VertBuf {
    pos: Vec<[f32; 3]>,
    nrm: Vec<[f32; 3]>,
    mat: Vec<[f32; 4]>,
    index: HashMap<i64, u32>,
}

/// Surface-nets vertex for a cell, at the average edge crossing. Pure fn of the field.
fn cell_vertex(ci: i32, cj: i32, ck: i32) -> Option<[f32; 3]> {
    let mut d = [0.0f32; 8];
    let mut neg = 0;
    for c in 0..8 {
        let x = (ci + (c & 1)) as f32;
        let y = (cj + ((c >> 1) & 1)) as f32;
        let z = (ck + ((c >> 2) & 1)) as f32;
        let v = density(x, y, z);
        d[c as usize] = v;
        if v < 0.0 {
            neg += 1;
        }
    }
    if neg == 0 || neg == 8 {
        return None;
    }
    const EDGES: [[usize; 2]; 12] = [
        [0, 1],
        [2, 3],
        [4, 5],
        [6, 7],
        [0, 2],
        [1, 3],
        [4, 6],
        [5, 7],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
    ];
    let (mut sx, mut sy, mut sz, mut n) = (0.0, 0.0, 0.0, 0.0);
    for [a, b] in EDGES {
        let (da, db) = (d[a], d[b]);
        if (da < 0.0) == (db < 0.0) {
            continue;
        }
        let t = da / (da - db);
        let ax = (ci + (a as i32 & 1)) as f32;
        let ay = (cj + ((a as i32 >> 1) & 1)) as f32;
        let az = (ck + ((a as i32 >> 2) & 1)) as f32;
        let bx = (ci + (b as i32 & 1)) as f32;
        let by = (cj + ((b as i32 >> 1) & 1)) as f32;
        let bz = (ck + ((b as i32 >> 2) & 1)) as f32;
        sx += ax + (bx - ax) * t;
        sy += ay + (by - ay) * t;
        sz += az + (bz - az) * t;
        n += 1.0;
    }
    Some([sx / n, sy / n, sz / n])
}

fn get_or_add_vertex(buf: &mut VertBuf, ci: i32, cj: i32, ck: i32) -> Option<u32> {
    let key = cell_key(ci, cj, ck);
    if let Some(&i) = buf.index.get(&key) {
        return Some(i);
    }
    let [px, py, pz] = cell_vertex(ci, cj, ck)?;
    let idx = buf.pos.len() as u32;
    buf.pos.push([px, py, pz]);
    buf.nrm.push(gradient(px, py, pz));
    let n = buf.nrm[idx as usize];
    buf.mat.push(materials(py, n[1]));
    buf.index.insert(key, idx);
    Some(idx)
}

#[derive(Clone, Copy)]
enum Axis {
    X,
    Y,
    Z,
}

fn emit_axis(
    axis: Axis,
    i: i32,
    j: i32,
    k: i32,
    buf: &mut VertBuf,
    indices: &mut Vec<u32>,
    world: WorldBounds,
) {
    let d_base = density(i as f32, j as f32, k as f32);
    let (tx, ty, tz) = match axis {
        Axis::X => (i + 1, j, k),
        Axis::Y => (i, j + 1, k),
        Axis::Z => (i, j, k + 1),
    };
    let d_tip = density(tx as f32, ty as f32, tz as f32);
    if (d_base < 0.0) == (d_tip < 0.0) {
        return;
    }
    let loop_cells = match axis {
        Axis::X => &QUAD_X,
        Axis::Y => &QUAD_Y,
        Axis::Z => &QUAD_Z,
    };
    // Clip at the world perimeter (X/Z) so outer pages get a clean open boundary.
    for c in loop_cells {
        let ci = i + c[0];
        let ck = k + c[2];
        if ci < 0 || ci >= world.cells_x || ck < 0 || ck >= world.cells_z {
            return;
        }
    }
    let mut v = [0u32; 4];
    for (n, c) in loop_cells.iter().enumerate() {
        match get_or_add_vertex(buf, i + c[0], j + c[1], k + c[2]) {
            Some(idx) => v[n] = idx,
            None => return,
        }
    }
    // Wind so the front face looks toward air.
    if d_base >= d_tip {
        indices.extend_from_slice(&[v[0], v[1], v[2], v[0], v[2], v[3]]);
    } else {
        indices.extend_from_slice(&[v[0], v[2], v[1], v[0], v[3], v[2]]);
    }
}

/// Mesh one chunk (owns cell columns [cx*S,(cx+1)*S) x [cz*S,(cz+1)*S), full Y).
fn mesh_chunk(cx: i32, cz: i32, cfg: &ClodPagesConfig, world: WorldBounds) -> PageMesh {
    let s = cfg.page.chunk_size as i32;
    let mut buf = VertBuf {
        pos: Vec::new(),
        nrm: Vec::new(),
        mat: Vec::new(),
        index: HashMap::new(),
    };
    let mut indices: Vec<u32> = Vec::new();
    for i in (cx * s)..((cx + 1) * s) {
        for k in (cz * s)..((cz + 1) * s) {
            for j in 0..Y_CELLS {
                emit_axis(Axis::X, i, j, k, &mut buf, &mut indices, world);
                emit_axis(Axis::Y, i, j, k, &mut buf, &mut indices, world);
                emit_axis(Axis::Z, i, j, k, &mut buf, &mut indices, world);
            }
        }
    }
    let n = buf.mat.len();
    PageMesh {
        positions: buf.pos,
        normals: buf.nrm,
        materials: buf.mat,
        paint_slots: vec![0.0; n],
        material_weight_stride: 4,
        indices,
    }
}

/// Build a synthetic LOD0 page source from its PxP chunks (page coords).
fn build_lod0_page_source(
    page_x: i32,
    page_z: i32,
    cfg: &ClodPagesConfig,
    world: WorldBounds,
) -> Result<PageSource, ClodBuildError> {
    let p = cfg.page.chunks_per_page as i32;
    let s = cfg.page.chunk_size as i32;

    let mut chunks: Vec<PageMesh> = Vec::with_capacity((p * p) as usize);
    for dz in 0..p {
        for dx in 0..p {
            chunks.push(mesh_chunk(page_x * p + dx, page_z * p + dz, cfg, world));
        }
    }

    let merged = concat(&chunks);
    let tol = super::types::BorderTolerances {
        position: cfg.simplify.weld_epsilon_cells,
        normal_dot: 0.9999,
        material: 1e-4,
    };
    let (mesh, weld) = weld_vertices(&merged, cfg.simplify.weld_epsilon_cells, tol)?;
    let footprint = PageFootprint {
        min_x: (page_x * p * s) as f32,
        min_z: (page_z * p * s) as f32,
        max_x: ((page_x + 1) * p * s) as f32,
        max_z: ((page_z + 1) * p * s) as f32,
    };
    Ok(PageSource {
        mesh,
        footprint,
        weld,
    })
}

/// Build the LOD0 page-source layer for a `pages_x` x `pages_z` synthetic world, keyed by
/// page coord — the input `build_quadtree` consumes.
pub fn build_lod0_world(
    pages_x: i32,
    pages_z: i32,
    cfg: &ClodPagesConfig,
) -> Result<Vec<((i32, i32), PageSource)>, ClodBuildError> {
    let world = WorldBounds {
        cells_x: pages_x * cfg.page.chunks_per_page as i32 * cfg.page.chunk_size as i32,
        cells_z: pages_z * cfg.page.chunks_per_page as i32 * cfg.page.chunk_size as i32,
    };
    let mut out = Vec::new();
    for pz in 0..pages_z {
        for px in 0..pages_x {
            out.push(((px, pz), build_lod0_page_source(px, pz, cfg, world)?));
        }
    }
    Ok(out)
}
