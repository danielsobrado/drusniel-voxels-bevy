use bevy::prelude::*;

use crate::rendering::ao_config::BakedAoConfig;

/// AO values for a single face's four corners.
/// Order: bottom-left, bottom-right, top-left, top-right.
#[derive(Clone, Copy, Debug, Default)]
pub struct FaceAo {
    pub corners: [f32; 4],
}

impl FaceAo {
    /// Compute AO for a face at given position and normal direction.
    /// `get_solid` returns true if voxel at position is solid/opaque.
    pub fn compute<F>(pos: IVec3, normal: IVec3, get_solid: F, config: &BakedAoConfig) -> Self
    where
        F: Fn(IVec3) -> bool,
    {
        let (tangent1, tangent2) = tangent_axes(normal);
        let mut corners = [1.0f32; 4];

        let offsets = [
            (-tangent1, -tangent2),
            (tangent1, -tangent2),
            (-tangent1, tangent2),
            (tangent1, tangent2),
        ];

        for (i, (t1_dir, t2_dir)) in offsets.iter().enumerate() {
            let face_offset = pos + normal;
            let side1 = get_solid(face_offset + *t1_dir);
            let side2 = get_solid(face_offset + *t2_dir);
            let corner = get_solid(face_offset + *t1_dir + *t2_dir);

            let ao_value = if side1 && side2 {
                0.0
            } else {
                let count = side1 as u8 + side2 as u8 + corner as u8;
                1.0 - (count as f32 * config.corner_darkness / 3.0)
            };

            corners[i] = ao_value * config.strength + (1.0 - config.strength);
        }

        Self { corners }
    }

    /// Check if quad diagonal should be flipped to reduce anisotropy.
    pub fn should_flip_diagonal(&self) -> bool {
        self.corners[0] + self.corners[3] < self.corners[1] + self.corners[2]
    }

    /// Get interpolated AO at UV coordinates (for smooth shading).
    pub fn sample(&self, u: f32, v: f32) -> f32 {
        let bl = self.corners[0];
        let br = self.corners[1];
        let tl = self.corners[2];
        let tr = self.corners[3];

        let bottom = bl + (br - bl) * u;
        let top = tl + (tr - tl) * u;
        bottom + (top - bottom) * v
    }
}

fn tangent_axes(normal: IVec3) -> (IVec3, IVec3) {
    match (normal.x, normal.y, normal.z) {
        (1, 0, 0) | (-1, 0, 0) => (IVec3::Y, IVec3::Z),
        (0, 1, 0) | (0, -1, 0) => (IVec3::X, IVec3::Z),
        (0, 0, 1) | (0, 0, -1) => (IVec3::X, IVec3::Y),
        _ => (IVec3::X, IVec3::Y),
    }
}

/// Encode AO into vertex color (use alpha or dedicated channel).
pub fn ao_to_vertex_color(ao: f32) -> [f32; 4] {
    [1.0, 1.0, 1.0, ao]
}

/// For Surface Nets: compute AO based on local density gradient.
pub fn compute_surface_nets_ao<F>(
    vertex_pos: Vec3,
    normal: Vec3,
    sample_radius: f32,
    get_density: F,
    config: &BakedAoConfig,
) -> f32
where
    F: Fn(Vec3) -> f32,
{
    let samples = 8;
    let mut occlusion = 0.0;
    let (tangent, bitangent) = arbitrary_tangent_basis(normal);

    for i in 0..samples {
        let angle = (i as f32 / samples as f32) * std::f32::consts::TAU;
        let sample_dir = (normal + tangent * angle.cos() * 0.7 + bitangent * angle.sin() * 0.7)
            .normalize_or_zero();

        let sample_pos = vertex_pos + sample_dir * sample_radius;
        let density = get_density(sample_pos);

        if density < 0.0 {
            occlusion += 1.0;
        }
    }

    let ao_raw = 1.0 - (occlusion / samples as f32);
    ao_raw * config.strength + (1.0 - config.strength)
}

fn arbitrary_tangent_basis(normal: Vec3) -> (Vec3, Vec3) {
    let up = if normal.y.abs() < 0.9 {
        Vec3::Y
    } else {
        Vec3::X
    };
    let tangent = normal.cross(up).normalize_or_zero();
    let bitangent = normal.cross(tangent);
    (tangent, bitangent)
}
