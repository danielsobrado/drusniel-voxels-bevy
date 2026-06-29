//! Safe terrain mutation consumer for construction foundation conform requests.

use bevy::prelude::*;

use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelEditResult, VoxelWorld};
use crate::world_rules::{ProtectedAreaRegistry, ProtectedEditIntent};

use super::persistence::ConstructionTerrainConformRequest;

const MAX_FOOTPRINT_SIDE_M: f32 = 32.0;
const MAX_FILL_DEPTH_M: f32 = 8.0;
const MAX_TRIM_HEIGHT_M: f32 = 4.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct TerrainConformEditStats {
    applied: u32,
    no_change: u32,
    rejected: u32,
}

impl TerrainConformEditStats {
    fn record(&mut self, result: VoxelEditResult) {
        match result {
            VoxelEditResult::Applied => self.applied += 1,
            VoxelEditResult::NoChange => self.no_change += 1,
            _ => self.rejected += 1,
        }
    }

    fn touched(self) -> bool {
        self.applied > 0 || self.no_change > 0 || self.rejected > 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct TerrainConformFootprint {
    center_xz: Vec2,
    core_half_xz: Vec2,
    falloff_m: f32,
    min_x: i32,
    max_x: i32,
    min_z: i32,
    max_z: i32,
}

impl TerrainConformFootprint {
    fn from_request(request: &ConstructionTerrainConformRequest) -> Option<Self> {
        let position = Vec3::from(request.position);
        let dimensions = rotated_dimensions(
            Vec3::from(request.dimensions_m),
            request.rotation_quarter_turns,
        );
        if !position.is_finite() || !dimensions.is_finite() {
            return None;
        }

        let half_xz = Vec2::new(dimensions.x.abs(), dimensions.z.abs()) * 0.5;
        if half_xz.x <= 0.0 || half_xz.y <= 0.0 {
            return None;
        }

        let core_half_xz = half_xz + Vec2::splat(request.pad_margin_m.max(0.0));
        let falloff_m = request.falloff_m.max(0.0);
        let outer_half_xz = core_half_xz + Vec2::splat(falloff_m);
        if outer_half_xz.x * 2.0 > MAX_FOOTPRINT_SIDE_M
            || outer_half_xz.y * 2.0 > MAX_FOOTPRINT_SIDE_M
        {
            return None;
        }

        let center_xz = Vec2::new(position.x, position.z);
        Some(Self {
            center_xz,
            core_half_xz,
            falloff_m,
            min_x: (center_xz.x - outer_half_xz.x).floor() as i32,
            max_x: (center_xz.x + outer_half_xz.x).ceil() as i32 - 1,
            min_z: (center_xz.y - outer_half_xz.y).floor() as i32,
            max_z: (center_xz.y + outer_half_xz.y).ceil() as i32 - 1,
        })
    }

    fn contains_column(self, x: i32, z: i32) -> bool {
        let column_center = Vec2::new(x as f32 + 0.5, z as f32 + 0.5);
        let delta = (column_center - self.center_xz).abs();
        if delta.x <= self.core_half_xz.x && delta.y <= self.core_half_xz.y {
            return true;
        }

        if self.falloff_m <= f32::EPSILON {
            return false;
        }

        let outside = Vec2::new(
            (delta.x - self.core_half_xz.x).max(0.0),
            (delta.y - self.core_half_xz.y).max(0.0),
        );
        outside.length_squared() <= self.falloff_m * self.falloff_m
    }
}

pub fn apply_construction_terrain_conform_requests(
    mut requests: MessageReader<ConstructionTerrainConformRequest>,
    mut world: ResMut<VoxelWorld>,
    protected_areas: Option<Res<ProtectedAreaRegistry>>,
) {
    for request in requests.read() {
        let stats = conform_construction_terrain(&mut world, request, protected_areas.as_deref());
        if stats.applied > 0 {
            info!(
                "Applied construction terrain conform for {}: {} edits, {} unchanged, {} rejected",
                request.piece_id, stats.applied, stats.no_change, stats.rejected
            );
        } else if stats.touched() {
            warn!(
                "Construction terrain conform for {} made no terrain edits: {} unchanged, {} rejected",
                request.piece_id, stats.no_change, stats.rejected
            );
        } else {
            warn!(
                "Construction terrain conform for {} was skipped: invalid or empty footprint",
                request.piece_id
            );
        }
    }
}

fn conform_construction_terrain(
    world: &mut VoxelWorld,
    request: &ConstructionTerrainConformRequest,
    protected_areas: Option<&ProtectedAreaRegistry>,
) -> TerrainConformEditStats {
    let Some(footprint) = TerrainConformFootprint::from_request(request) else {
        return TerrainConformEditStats::default();
    };

    let fill_voxel = terrain_material_for_slot(request.material_slot);
    let target_solid_y = target_solid_top_y(request);
    let fill_depth = request.fill_depth_m.clamp(0.0, MAX_FILL_DEPTH_M).ceil() as i32;
    let trim_height = request.trim_height_m.clamp(0.0, MAX_TRIM_HEIGHT_M).ceil() as i32;
    let fill_min_y = target_solid_y - fill_depth.saturating_sub(1);
    let trim_max_y = target_solid_y + trim_height;
    let mut stats = TerrainConformEditStats::default();

    for x in footprint.min_x..=footprint.max_x {
        for z in footprint.min_z..=footprint.max_z {
            if !footprint.contains_column(x, z) {
                continue;
            }

            for y in fill_min_y..=target_solid_y {
                let pos = IVec3::new(x, y, z);
                if matches!(world.get_voxel(pos), Some(VoxelType::Air | VoxelType::Water)) {
                    let result = world.set_voxel_with_rules(
                        pos,
                        fill_voxel,
                        ProtectedEditIntent::Place,
                        protected_areas,
                    );
                    stats.record(result);
                }
            }

            for y in (target_solid_y + 1)..=trim_max_y {
                let pos = IVec3::new(x, y, z);
                if matches!(
                    world.get_voxel(pos),
                    Some(voxel) if voxel.is_solid() && voxel != VoxelType::Bedrock
                ) {
                    let result = world.set_voxel_with_rules(
                        pos,
                        VoxelType::Air,
                        ProtectedEditIntent::Mine,
                        protected_areas,
                    );
                    stats.record(result);
                }
            }
        }
    }

    stats
}

fn target_solid_top_y(request: &ConstructionTerrainConformRequest) -> i32 {
    let position_y = request.position[1];
    let height = request.dimensions_m[1].abs();
    let bottom_y = position_y - height * 0.5;
    (bottom_y - 1.0).floor() as i32
}

fn rotated_dimensions(size: Vec3, rotation: u8) -> Vec3 {
    if rotation % 2 == 0 {
        size
    } else {
        Vec3::new(size.z, size.y, size.x)
    }
}

fn terrain_material_for_slot(material_slot: u8) -> VoxelType {
    match material_slot {
        1 => VoxelType::SubSoil,
        2 => VoxelType::Rock,
        4 => VoxelType::Sand,
        5 => VoxelType::Clay,
        _ => VoxelType::TopSoil,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;

    fn request() -> ConstructionTerrainConformRequest {
        ConstructionTerrainConformRequest {
            piece_id: "piece-1".to_string(),
            position: [4.5, 4.5, 4.5],
            dimensions_m: [2.0, 0.2, 2.0],
            rotation_quarter_turns: 0,
            material_slot: 0,
            pad_margin_m: 0.0,
            fill_depth_m: 1.5,
            trim_height_m: 0.45,
            falloff_m: 0.0,
        }
    }

    #[test]
    fn footprint_rejects_oversized_requests() {
        let mut request = request();
        request.dimensions_m = [64.0, 0.2, 2.0];

        assert!(TerrainConformFootprint::from_request(&request).is_none());
    }

    #[test]
    fn material_slot_maps_to_safe_terrain_voxel() {
        assert_eq!(terrain_material_for_slot(0), VoxelType::TopSoil);
        assert_eq!(terrain_material_for_slot(2), VoxelType::Rock);
        assert_eq!(terrain_material_for_slot(255), VoxelType::TopSoil);
    }

    #[test]
    fn conform_fills_below_and_trims_above_foundation() {
        let mut world = VoxelWorld::new(IVec3::ONE);
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        let request = request();

        assert_eq!(
            world.set_voxel(IVec3::new(4, 4, 4), VoxelType::Rock),
            VoxelEditResult::Applied
        );
        let stats = conform_construction_terrain(&mut world, &request, None);

        assert!(stats.applied > 0);
        assert_eq!(
            world.get_voxel(IVec3::new(4, 3, 4)),
            Some(VoxelType::TopSoil)
        );
        assert_eq!(world.get_voxel(IVec3::new(4, 4, 4)), Some(VoxelType::Air));
    }
}
