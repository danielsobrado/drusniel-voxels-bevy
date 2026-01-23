//! Terrain analysis for precise prop placement.
//!
//! Provides multi-sample surface detection, normal calculation,
//! and slope analysis for accurate prop positioning.

use bevy::prelude::*;

use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;

/// Maximum height to scan when searching for surface
const MAX_SCAN_HEIGHT: i32 = 128;

/// Result of terrain analysis at a point
#[derive(Clone, Debug)]
pub struct TerrainAnalysis {
    /// Precise height of the terrain surface
    pub height: f32,
    /// Surface normal at this point
    pub normal: Vec3,
    /// Slope angle in degrees
    pub slope_angle: f32,
    /// Type of voxel at the surface
    pub voxel_type: VoxelType,
    /// Whether a valid surface was found
    pub valid: bool,
}

impl Default for TerrainAnalysis {
    fn default() -> Self {
        Self {
            height: 0.0,
            normal: Vec3::Y,
            slope_angle: 0.0,
            voxel_type: VoxelType::Air,
            valid: false,
        }
    }
}

/// Terrain analyzer for precise surface detection
pub struct TerrainAnalyzer<'a> {
    world: &'a VoxelWorld,
}

impl<'a> TerrainAnalyzer<'a> {
    /// Create a new terrain analyzer
    pub fn new(world: &'a VoxelWorld) -> Self {
        Self { world }
    }

    /// Analyze terrain at a world position
    pub fn analyze(&self, world_x: f32, world_z: f32) -> TerrainAnalysis {
        // Find the surface height using column scan
        let ix = world_x.floor() as i32;
        let iz = world_z.floor() as i32;

        let Some((surface_y, voxel_type)) = self.find_surface(ix, iz) else {
            return TerrainAnalysis::default();
        };

        // Get smooth interpolated height
        let height = self
            .sample_smooth_height(world_x, world_z)
            .unwrap_or(surface_y as f32 + 0.5);

        // Calculate surface normal using height gradient
        let normal = self.calculate_normal(world_x, world_z);

        // Calculate slope angle from normal
        let slope_angle = normal.y.acos().to_degrees();

        TerrainAnalysis {
            height,
            normal,
            slope_angle,
            voxel_type,
            valid: true,
        }
    }

    /// Find the surface voxel at a column
    fn find_surface(&self, x: i32, z: i32) -> Option<(i32, VoxelType)> {
        for y in (0..MAX_SCAN_HEIGHT).rev() {
            let pos = IVec3::new(x, y, z);
            if let Some(voxel) = self.world.get_voxel(pos) {
                if voxel.is_solid() && !voxel.is_liquid() {
                    // Verify this isn't a floating 1-voxel layer (noise artifact)
                    // We require the voxel below to be solid or water
                    let below = IVec3::new(x, y - 1, z);
                    if let Some(below_voxel) = self.world.get_voxel(below) {
                         // Treating water as "foundation" allows props on shorelines
                         // Air below means it's floating -> skip it
                        if !below_voxel.is_solid() && !below_voxel.is_liquid() {
                            continue;
                        }
                    }

                    // Check that the voxel above is not liquid
                    let above = IVec3::new(x, y + 1, z);
                    if let Some(above_voxel) = self.world.get_voxel(above) {
                        if above_voxel.is_liquid() {
                            continue;
                        }
                    }
                    return Some((y, voxel));
                }
            }
        }
        None
    }

    /// Find column height (Y of topmost solid non-liquid voxel)
    pub fn find_column_height(&self, x: i32, z: i32) -> Option<i32> {
        for y in (0..MAX_SCAN_HEIGHT).rev() {
            if let Some(v) = self.world.get_voxel(IVec3::new(x, y, z)) {
                if v.is_solid() && !v.is_liquid() {
                    return Some(y);
                }
            }
        }
        None
    }

    /// Sample terrain height with bilinear interpolation
    pub fn sample_smooth_height(&self, world_x: f32, world_z: f32) -> Option<f32> {
        let x0 = world_x.floor() as i32;
        let z0 = world_z.floor() as i32;
        let x1 = x0 + 1;
        let z1 = z0 + 1;

        let fx = world_x - x0 as f32;
        let fz = world_z - z0 as f32;

        let h00 = self.find_column_height(x0, z0)? as f32 + 0.5;
        let h10 = self.find_column_height(x1, z0)? as f32 + 0.5;
        let h01 = self.find_column_height(x0, z1)? as f32 + 0.5;
        let h11 = self.find_column_height(x1, z1)? as f32 + 0.5;

        let h0 = lerp(h00, h10, fx);
        let h1 = lerp(h01, h11, fx);
        Some(lerp(h0, h1, fz))
    }

    /// Calculate surface normal using central differences
    pub fn calculate_normal(&self, world_x: f32, world_z: f32) -> Vec3 {
        let step = 0.5;

        let h_xp = self
            .sample_smooth_height(world_x + step, world_z)
            .unwrap_or(0.0);
        let h_xn = self
            .sample_smooth_height(world_x - step, world_z)
            .unwrap_or(0.0);
        let h_zp = self
            .sample_smooth_height(world_x, world_z + step)
            .unwrap_or(0.0);
        let h_zn = self
            .sample_smooth_height(world_x, world_z - step)
            .unwrap_or(0.0);

        // Gradient
        let dx = (h_xp - h_xn) / (2.0 * step);
        let dz = (h_zp - h_zn) / (2.0 * step);

        // Normal from gradient
        Vec3::new(-dx, 1.0, -dz).normalize()
    }

    /// Multi-sample placement: sample at multiple points and find best placement
    pub fn multi_sample_placement(
        &self,
        center_x: f32,
        center_z: f32,
        footprint_width: f32,
        footprint_depth: f32,
    ) -> Option<MultiSampleResult> {
        let half_w = footprint_width * 0.5;
        let half_d = footprint_depth * 0.5;

        // Sample 5 points: 4 corners + center
        let samples = [
            (center_x - half_w, center_z - half_d), // corner 1
            (center_x + half_w, center_z - half_d), // corner 2
            (center_x - half_w, center_z + half_d), // corner 3
            (center_x + half_w, center_z + half_d), // corner 4
            (center_x, center_z),                   // center
        ];

        let mut heights: Vec<(f32, f32, f32)> = Vec::with_capacity(5);
        let mut voxel_type = VoxelType::Air;

        for (sx, sz) in samples {
            let analysis = self.analyze(sx, sz);
            if !analysis.valid {
                return None;
            }
            heights.push((sx, sz, analysis.height));
            if analysis.voxel_type != VoxelType::Air {
                voxel_type = analysis.voxel_type;
            }
        }

        if heights.len() < 3 {
            return None;
        }

        // Use the CENTER sample height for placement (last sample in our array)
        // This ensures props are placed at the actual terrain height where they render
        let center_height = heights.last().map(|(_, _, h)| *h)?;

        // Calculate height variance from min/max to detect unsuitable terrain
        let min_height = heights
            .iter()
            .map(|(_, _, h)| *h)
            .min_by(|a, b| a.partial_cmp(b).unwrap())?;
        let max_height = heights
            .iter()
            .map(|(_, _, h)| *h)
            .max_by(|a, b| a.partial_cmp(b).unwrap())?;
        let height_variance = max_height - min_height;

        // Fit a plane to the contact points for normal calculation
        let normal = fit_plane_normal(&heights);

        Some(MultiSampleResult {
            position: Vec3::new(center_x, center_height, center_z),
            normal,
            height_variance,
            contact_count: heights.len(),
            voxel_type,
        })
    }
}

/// Result of multi-sample placement analysis
#[derive(Clone, Debug)]
pub struct MultiSampleResult {
    /// Best position for the prop (at minimum contact height)
    pub position: Vec3,
    /// Fitted surface normal from contact points
    pub normal: Vec3,
    /// Height difference between lowest and highest samples
    pub height_variance: f32,
    /// Number of valid contact points found
    pub contact_count: usize,
    /// Terrain type at the placement
    pub voxel_type: VoxelType,
}

/// Fit a plane normal to a set of 3D points using least squares
fn fit_plane_normal(points: &[(f32, f32, f32)]) -> Vec3 {
    if points.len() < 3 {
        return Vec3::Y;
    }

    // Calculate centroid
    let n = points.len() as f32;
    let cx: f32 = points.iter().map(|(x, _, _)| x).sum::<f32>() / n;
    let cy: f32 = points.iter().map(|(_, _, h)| h).sum::<f32>() / n;
    let cz: f32 = points.iter().map(|(_, z, _)| z).sum::<f32>() / n;

    // Use simple cross-product method with 3 points
    if points.len() >= 3 {
        let p0 = Vec3::new(points[0].0, points[0].2, points[0].1);
        let p1 = Vec3::new(points[1].0, points[1].2, points[1].1);
        let p2 = Vec3::new(points[2].0, points[2].2, points[2].1);

        let v1 = p1 - p0;
        let v2 = p2 - p0;
        let normal = v1.cross(v2).normalize();

        // Ensure normal points upward
        if normal.y < 0.0 {
            return -normal;
        }
        return normal;
    }

    // Fallback: use gradient method
    let mut dx = 0.0f32;
    let mut dz = 0.0f32;

    for (x, z, h) in points {
        dx += (x - cx) * (h - cy);
        dz += (z - cz) * (h - cy);
    }

    Vec3::new(-dx, 1.0, -dz).normalize()
}

/// Linear interpolation
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fit_plane_normal_flat() {
        // Flat surface should have normal pointing up
        let points = vec![
            (0.0, 0.0, 5.0),
            (1.0, 0.0, 5.0),
            (0.0, 1.0, 5.0),
            (1.0, 1.0, 5.0),
        ];

        let normal = fit_plane_normal(&points);
        assert!((normal.y - 1.0).abs() < 0.01, "Expected upward normal for flat surface");
    }

    #[test]
    fn test_lerp() {
        assert_eq!(lerp(0.0, 10.0, 0.5), 5.0);
        assert_eq!(lerp(0.0, 10.0, 0.0), 0.0);
        assert_eq!(lerp(0.0, 10.0, 1.0), 10.0);
    }
}
