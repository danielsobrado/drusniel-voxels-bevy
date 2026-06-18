//! Procedural rock mesh generator — welded icosphere displaced by a layered field:
//! ellipsoid squash → macro warp → tilted strata ledges → ridged creases → planar fracture
//! cuts → micro grain. Rust port of the CLOD-PoC `rock_builder.ts` (itself from the LAAS
//! reference). The same field evaluated at lower subdivision gives consistent-silhouette LODs.
//!
//! Deterministic: same preset + seed + detail ⇒ identical buffers.
//!
//! `vdata` (vec4 per vertex): x hue (per-instance later), y strataT (albedo banding),
//! z moss/lichen openness (upness before squash), w cavity AO.

use std::collections::HashMap;

use bevy::asset::RenderAssetUsages;
use bevy::math::Vec3;
use bevy::prelude::Mesh;
use bevy_mesh::{Indices, MeshVertexAttribute, PrimitiveTopology, VertexFormat};

use super::hash::{StoneRng, fbm3, ridged3};

/// Per-vertex `vec4` placement data consumed by the rock material.
pub const ATTRIBUTE_VDATA: MeshVertexAttribute =
    MeshVertexAttribute::new("Vdata", 0x570e_da7a, VertexFormat::Float32x4);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RockPreset {
    Boulder,
    Cobble,
    Talus,
    Slab,
    Angular,
}

#[derive(Clone, Copy, Debug)]
pub struct RockParams {
    pub radius: f32,
    pub squash: [f32; 3],
    pub macro_amp: f32,
    pub strata: f32,
    pub strata_freq: f32,
    pub strata_tilt: f32,
    pub ridged: f32,
    pub cuts: u32,
    pub cut_bite: f32,
    pub micro: f32,
}

impl RockPreset {
    pub fn params(self) -> RockParams {
        match self {
            RockPreset::Boulder => RockParams {
                radius: 1.1,
                squash: [1.0, 0.74, 0.92],
                macro_amp: 0.24,
                strata: 0.045,
                strata_freq: 3.2,
                strata_tilt: 0.2,
                ridged: 0.05,
                cuts: 2,
                cut_bite: 0.1,
                micro: 0.012,
            },
            RockPreset::Cobble => RockParams {
                radius: 0.16,
                squash: [1.0, 0.72, 0.88],
                macro_amp: 0.14,
                strata: 0.0,
                strata_freq: 1.0,
                strata_tilt: 0.0,
                ridged: 0.02,
                cuts: 0,
                cut_bite: 0.0,
                micro: 0.01,
            },
            RockPreset::Talus => RockParams {
                radius: 0.95,
                squash: [1.0, 0.8, 0.9],
                macro_amp: 0.2,
                strata: 0.05,
                strata_freq: 4.2,
                strata_tilt: 0.4,
                ridged: 0.14,
                cuts: 7,
                cut_bite: 0.36,
                micro: 0.02,
            },
            RockPreset::Slab => RockParams {
                radius: 1.7,
                squash: [1.0, 0.42, 0.78],
                macro_amp: 0.16,
                strata: 0.08,
                strata_freq: 5.0,
                strata_tilt: 0.12,
                ridged: 0.05,
                cuts: 5,
                cut_bite: 0.28,
                micro: 0.012,
            },
            RockPreset::Angular => RockParams {
                radius: 0.85,
                squash: [1.0, 0.85, 0.95],
                macro_amp: 0.22,
                strata: 0.04,
                strata_freq: 4.0,
                strata_tilt: 0.5,
                ridged: 0.12,
                cuts: 10,
                cut_bite: 0.5,
                micro: 0.016,
            },
        }
    }
}

/// CPU-side rock geometry buffers (before normals).
pub struct RockBuffers {
    pub positions: Vec<[f32; 3]>,
    pub vdata: Vec<[f32; 4]>,
    pub indices: Vec<u32>,
}

impl RockBuffers {
    pub fn triangles(&self) -> usize {
        self.indices.len() / 3
    }
}

struct CutPlane {
    n: Vec3,
    off: f32,
}

/// welded icosphere (edge-midpoint cache subdivision); returns unit-sphere positions + indices.
fn icosphere(detail: u32) -> (Vec<Vec3>, Vec<u32>) {
    let t = (1.0 + 5.0_f32.sqrt()) / 2.0;
    let mut verts: Vec<Vec3> = [
        [-1.0, t, 0.0],
        [1.0, t, 0.0],
        [-1.0, -t, 0.0],
        [1.0, -t, 0.0],
        [0.0, -1.0, t],
        [0.0, 1.0, t],
        [0.0, -1.0, -t],
        [0.0, 1.0, -t],
        [t, 0.0, -1.0],
        [t, 0.0, 1.0],
        [-t, 0.0, -1.0],
        [-t, 0.0, 1.0],
    ]
    .into_iter()
    .map(|v| Vec3::from_array(v).normalize())
    .collect();

    let mut faces: Vec<[u32; 3]> = vec![
        [0, 11, 5],
        [0, 5, 1],
        [0, 1, 7],
        [0, 7, 10],
        [0, 10, 11],
        [1, 5, 9],
        [5, 11, 4],
        [11, 10, 2],
        [10, 7, 6],
        [7, 1, 8],
        [3, 9, 4],
        [3, 4, 2],
        [3, 2, 6],
        [3, 6, 8],
        [3, 8, 9],
        [4, 9, 5],
        [2, 4, 11],
        [6, 2, 10],
        [8, 6, 7],
        [9, 8, 1],
    ];

    let mut mid_cache: HashMap<u64, u32> = HashMap::new();
    let mut midpoint = |a: u32, b: u32, verts: &mut Vec<Vec3>| -> u32 {
        let key = if a < b {
            (a as u64) << 32 | b as u64
        } else {
            (b as u64) << 32 | a as u64
        };
        if let Some(&hit) = mid_cache.get(&key) {
            return hit;
        }
        let m = ((verts[a as usize] + verts[b as usize]) * 0.5).normalize();
        verts.push(m);
        let id = (verts.len() - 1) as u32;
        mid_cache.insert(key, id);
        id
    };

    for _ in 0..detail {
        let mut next: Vec<[u32; 3]> = Vec::with_capacity(faces.len() * 4);
        for f in &faces {
            let [a, b, c] = *f;
            let ab = midpoint(a, b, &mut verts);
            let bc = midpoint(b, c, &mut verts);
            let ca = midpoint(c, a, &mut verts);
            next.push([a, ab, ca]);
            next.push([b, bc, ab]);
            next.push([c, ca, bc]);
            next.push([ab, bc, ca]);
        }
        faces = next;
    }

    let indices = faces.into_iter().flatten().collect();
    (verts, indices)
}

/// Build the rock geometry buffers for a preset/seed/detail. Deterministic.
pub fn build_rock_buffers(preset: RockPreset, seed: u32, detail: u32) -> RockBuffers {
    let p = preset.params();
    let mut rng = StoneRng::new(seed);
    let seed_a = rng.next_u32() & 0x7fff_ffff;
    let seed_b = rng.next_u32() & 0x7fff_ffff;
    let seed_c = rng.next_u32() & 0x7fff_ffff;

    let mut cuts: Vec<CutPlane> = Vec::with_capacity(p.cuts as usize);
    for _ in 0..p.cuts {
        let n = Vec3::new(rng.gauss(), rng.gauss() * 0.7, rng.gauss()).normalize();
        cuts.push(CutPlane {
            n,
            off: 1.0 - p.cut_bite * (0.4 + rng.next_f32() * 0.6),
        });
    }
    let strata_axis = Vec3::new(
        p.strata_tilt.sin() * (rng.next_f32() * 6.28).cos(),
        p.strata_tilt.cos(),
        p.strata_tilt.sin() * (rng.next_f32() * 6.28).sin(),
    )
    .normalize();
    let strata_phase = rng.next_f32() * 10.0;
    let band_amp: Vec<f32> = (0..24).map(|_| 0.55 + rng.next_f32() * 0.9).collect();

    let (dirs, indices) = icosphere(detail);
    let mut positions = Vec::with_capacity(dirs.len());
    let mut vdata = Vec::with_capacity(dirs.len());

    for d in &dirs {
        let d = *d;
        let macro_warp = fbm3(d.x * 1.4, d.y * 1.4, d.z * 1.4, seed_a, 3) * p.macro_amp;
        let s = d.dot(strata_axis) * p.strata_freq
            + strata_phase
            + fbm3(d.x * 2.3, d.y * 2.3, d.z * 2.3, seed_b, 2) * 0.5;
        let band = s.floor();
        let f = s - band;
        let amp = band_amp[(((band as i32) % 24 + 24) % 24) as usize];
        let ledge = ((f * 4.2).min(1.0) - f * 0.62) * p.strata * amp;
        let rid = ridged3(d.x * 3.1, d.y * 3.1, d.z * 3.1, seed_c, 3) * p.ridged;
        let micro = fbm3(d.x * 14.0, d.y * 14.0, d.z * 14.0, seed_b ^ 0x55aa, 2) * p.micro;
        let mut r = 1.0 + macro_warp + ledge + rid + micro;

        let mut cav = 0.0_f32;
        for c in &cuts {
            let dn = d.dot(c.n);
            if dn > 0.001 {
                let r_cut = c.off / dn;
                if r_cut < r {
                    let depth = ((r - r_cut) * 3.0).min(1.0);
                    r = r_cut + (r - r_cut) * 0.035;
                    cav = cav.max(depth * 0.4);
                }
            }
        }
        let cav = (cav + (-macro_warp - ledge).max(0.0) * 2.2).min(1.0);

        let rr = r * p.radius;
        positions.push([
            d.x * rr * p.squash[0],
            d.y * rr * p.squash[1],
            d.z * rr * p.squash[2],
        ]);
        vdata.push([0.0, f, d.y.max(0.0), 1.0 - cav * 0.85]);
    }

    RockBuffers {
        positions,
        vdata,
        indices,
    }
}

/// Build a renderable rock mesh (with computed smooth normals). Returns the mesh and tri count.
pub fn build_rock(preset: RockPreset, seed: u32, detail: u32) -> (Mesh, usize) {
    let buffers = build_rock_buffers(preset, seed, detail);
    let tris = buffers.triangles();
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, buffers.positions);
    mesh.insert_attribute(ATTRIBUTE_VDATA, buffers.vdata);
    mesh.insert_indices(Indices::U32(buffers.indices));
    mesh.compute_normals();
    (mesh, tris)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffers_are_deterministic() {
        let a = build_rock_buffers(RockPreset::Boulder, 42, 2);
        let b = build_rock_buffers(RockPreset::Boulder, 42, 2);
        assert_eq!(a.positions, b.positions);
        assert_eq!(a.vdata, b.vdata);
        assert_eq!(a.indices, b.indices);
    }

    #[test]
    fn differs_for_different_seeds() {
        let a = build_rock_buffers(RockPreset::Boulder, 1, 2);
        let b = build_rock_buffers(RockPreset::Boulder, 2, 2);
        assert_ne!(a.positions, b.positions);
    }

    #[test]
    fn triangle_count_is_20_times_4_pow_detail() {
        assert_eq!(build_rock_buffers(RockPreset::Cobble, 7, 1).triangles(), 80);
        assert_eq!(
            build_rock_buffers(RockPreset::Cobble, 7, 2).triangles(),
            320
        );
        assert_eq!(
            build_rock_buffers(RockPreset::Talus, 7, 3).triangles(),
            1280
        );
    }

    #[test]
    fn vdata_matches_vertex_count_and_mesh_builds() {
        let buffers = build_rock_buffers(RockPreset::Talus, 99, 2);
        assert_eq!(buffers.vdata.len(), buffers.positions.len());
        let (mesh, tris) = build_rock(RockPreset::Talus, 99, 2);
        assert_eq!(tris, 320);
        assert!(mesh.attribute(Mesh::ATTRIBUTE_NORMAL).is_some());
        assert!(mesh.attribute(ATTRIBUTE_VDATA).is_some());
    }
}
