use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use std::collections::HashMap;

use crate::performance::{AreaTimingRecorder, area_timer};
use crate::rendering::naadf::stats::NaadfStats;
use crate::rendering::voxel_ray_backend::VoxelRayHit;

#[derive(Component, Clone, Debug, PartialEq)]
pub struct NaadfEntityVoxelVolume {
    pub dimensions: UVec3,
    pub voxel_size: Vec3,
    pub local_origin: Vec3,
    pub material_ids: Vec<u16>,
    pub revision: u64,
}

#[derive(Component, Clone, Copy, Debug, PartialEq, Eq)]
pub struct NaadfStaticVoxelProxy {
    pub class: NaadfStaticProxyClass,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NaadfStaticProxyClass {
    Building,
    RockFormation,
    LargeTree,
}

#[derive(Resource, Clone, Copy, Debug, PartialEq)]
pub struct NaadfStaticProxyPolicy {
    pub min_occupied_voxels: u32,
    pub min_extent: f32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NaadfEntityVolumeError {
    ZeroDimension,
    InvalidMaterialCount { expected: usize, actual: usize },
}

#[derive(Clone, Debug, PartialEq)]
pub struct NaadfEntityVolumeRecord {
    pub entity: Entity,
    pub dimensions: UVec3,
    pub voxel_size: Vec3,
    pub local_origin: Vec3,
    pub world_from_local: GlobalTransform,
    pub previous_world_from_local: GlobalTransform,
    pub world_aabb_min: Vec3,
    pub world_aabb_max: Vec3,
    pub material_ids: Vec<u16>,
    pub occupied_voxels: u32,
    pub revision: u64,
}

#[derive(Resource, Default, Clone, Debug, PartialEq)]
pub struct NaadfEntityVolumeRegistry {
    records: HashMap<Entity, NaadfEntityVolumeRecord>,
}

impl NaadfEntityVoxelVolume {
    pub fn new(
        dimensions: UVec3,
        voxel_size: Vec3,
        material_ids: Vec<u16>,
    ) -> Result<Self, NaadfEntityVolumeError> {
        Self::with_origin(dimensions, voxel_size, Vec3::ZERO, material_ids)
    }

    pub fn with_origin(
        dimensions: UVec3,
        voxel_size: Vec3,
        local_origin: Vec3,
        material_ids: Vec<u16>,
    ) -> Result<Self, NaadfEntityVolumeError> {
        if dimensions.x == 0 || dimensions.y == 0 || dimensions.z == 0 {
            return Err(NaadfEntityVolumeError::ZeroDimension);
        }
        let expected = volume_len(dimensions);
        if material_ids.len() != expected {
            return Err(NaadfEntityVolumeError::InvalidMaterialCount {
                expected,
                actual: material_ids.len(),
            });
        }
        Ok(Self {
            dimensions,
            voxel_size,
            local_origin,
            material_ids,
            revision: 0,
        })
    }

    pub fn voxel_count(&self) -> usize {
        volume_len(self.dimensions)
    }

    pub fn occupied_voxels(&self) -> u32 {
        self.material_ids
            .iter()
            .filter(|material_id| **material_id != 0)
            .count() as u32
    }

    pub fn material_at(&self, local: UVec3) -> Option<u16> {
        if local.x >= self.dimensions.x
            || local.y >= self.dimensions.y
            || local.z >= self.dimensions.z
        {
            return None;
        }
        self.material_ids
            .get(entity_voxel_index(local, self.dimensions))
            .copied()
    }

    pub fn mark_dirty(&mut self) {
        self.revision = self.revision.saturating_add(1);
    }

    fn world_aabb(&self, transform: &GlobalTransform) -> (Vec3, Vec3) {
        let local_min = self.local_origin;
        let local_max = self.local_origin + self.voxel_size * self.dimensions.as_vec3();
        let corners = [
            Vec3::new(local_min.x, local_min.y, local_min.z),
            Vec3::new(local_max.x, local_min.y, local_min.z),
            Vec3::new(local_min.x, local_max.y, local_min.z),
            Vec3::new(local_max.x, local_max.y, local_min.z),
            Vec3::new(local_min.x, local_min.y, local_max.z),
            Vec3::new(local_max.x, local_min.y, local_max.z),
            Vec3::new(local_min.x, local_max.y, local_max.z),
            Vec3::new(local_max.x, local_max.y, local_max.z),
        ];

        let mut min = Vec3::splat(f32::INFINITY);
        let mut max = Vec3::splat(f32::NEG_INFINITY);
        for corner in corners {
            let world = transform.transform_point(corner);
            min = min.min(world);
            max = max.max(world);
        }
        (min, max)
    }
}

impl Default for NaadfStaticVoxelProxy {
    fn default() -> Self {
        Self {
            class: NaadfStaticProxyClass::Building,
        }
    }
}

impl Default for NaadfStaticProxyPolicy {
    fn default() -> Self {
        Self {
            min_occupied_voxels: 64,
            min_extent: 4.0,
        }
    }
}

impl NaadfStaticProxyPolicy {
    pub fn allows(&self, volume: &NaadfEntityVoxelVolume) -> bool {
        volume.occupied_voxels() >= self.min_occupied_voxels
            && (volume.voxel_size * volume.dimensions.as_vec3()).max_element() >= self.min_extent
    }
}

impl NaadfEntityVolumeRegistry {
    pub fn sync<'a>(
        &mut self,
        volumes: impl IntoIterator<Item = (Entity, &'a GlobalTransform, &'a NaadfEntityVoxelVolume)>,
    ) {
        let previous_records = std::mem::take(&mut self.records);
        for (entity, transform, volume) in volumes {
            let (world_aabb_min, world_aabb_max) = volume.world_aabb(transform);
            let previous_world_from_local = previous_records
                .get(&entity)
                .filter(|previous| previous.matches_volume_shape(volume))
                .map(|previous| previous.world_from_local)
                .unwrap_or(*transform);
            self.records.insert(
                entity,
                NaadfEntityVolumeRecord {
                    entity,
                    dimensions: volume.dimensions,
                    voxel_size: volume.voxel_size,
                    local_origin: volume.local_origin,
                    world_from_local: *transform,
                    previous_world_from_local,
                    world_aabb_min,
                    world_aabb_max,
                    material_ids: volume.material_ids.clone(),
                    occupied_voxels: volume.occupied_voxels(),
                    revision: volume.revision,
                },
            );
        }
    }

    pub fn get(&self, entity: Entity) -> Option<&NaadfEntityVolumeRecord> {
        self.records.get(&entity)
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    pub fn total_occupied_voxels(&self) -> u32 {
        self.records
            .values()
            .map(|record| record.occupied_voxels)
            .sum()
    }

    pub fn iter(&self) -> impl Iterator<Item = &NaadfEntityVolumeRecord> {
        self.records.values()
    }

    pub fn trace(&self, origin: Vec3, direction: Vec3, max_distance: f32) -> Option<VoxelRayHit> {
        let direction = direction.try_normalize()?;
        self.records
            .values()
            .filter_map(|record| record.trace(origin, direction, max_distance))
            .min_by(|a, b| a.distance.total_cmp(&b.distance))
    }
}

impl NaadfEntityVolumeRecord {
    fn matches_volume_shape(&self, volume: &NaadfEntityVoxelVolume) -> bool {
        // Revision changes reset motion history because content-animated volumes
        // need conservative reprojection until their voxel data is stable again.
        self.dimensions == volume.dimensions
            && self.voxel_size == volume.voxel_size
            && self.local_origin == volume.local_origin
            && self.revision == volume.revision
            && self.material_ids.len() == volume.material_ids.len()
    }

    pub fn material_at(&self, local: UVec3) -> Option<u16> {
        if local.x >= self.dimensions.x
            || local.y >= self.dimensions.y
            || local.z >= self.dimensions.z
        {
            return None;
        }
        self.material_ids
            .get(entity_voxel_index(local, self.dimensions))
            .copied()
    }

    pub fn trace(&self, origin: Vec3, direction: Vec3, max_distance: f32) -> Option<VoxelRayHit> {
        if max_distance <= 0.0 || self.occupied_voxels == 0 {
            return None;
        }
        let world_from_local = self.world_from_local.to_matrix();
        let local_from_world = world_from_local.inverse();
        let local_origin = local_from_world.transform_point3(origin);
        let local_end = local_from_world.transform_point3(origin + direction * max_distance);
        let local_direction = local_end - local_origin;
        let grid_origin = (local_origin - self.local_origin) / self.voxel_size;
        let grid_direction = local_direction / self.voxel_size;
        let (entry_t, exit_t) = ray_box_intersection(
            grid_origin,
            grid_direction,
            Vec3::ZERO,
            self.dimensions.as_vec3(),
        )?;
        if exit_t < 0.0 || entry_t > 1.0 {
            return None;
        }

        let mut t = entry_t.max(0.0);
        let step = IVec3::new(
            if grid_direction.x >= 0.0 { 1 } else { -1 },
            if grid_direction.y >= 0.0 { 1 } else { -1 },
            if grid_direction.z >= 0.0 { 1 } else { -1 },
        );
        let mut voxel = (grid_origin + grid_direction * t)
            .floor()
            .as_ivec3()
            .clamp(IVec3::ZERO, self.dimensions.as_ivec3() - IVec3::ONE);
        let inv_dir = Vec3::new(
            reciprocal_or_infinity(grid_direction.x),
            reciprocal_or_infinity(grid_direction.y),
            reciprocal_or_infinity(grid_direction.z),
        );
        let mut t_max = next_grid_boundary_t(grid_origin, voxel, step, inv_dir);
        let t_delta = Vec3::new(inv_dir.x.abs(), inv_dir.y.abs(), inv_dir.z.abs());
        let mut normal = Vec3::ZERO;

        for steps in 0..4096u32 {
            if t > exit_t || t > 1.0 {
                break;
            }
            if voxel.cmplt(IVec3::ZERO).any() || voxel.cmpge(self.dimensions.as_ivec3()).any() {
                break;
            }
            let local_voxel = voxel.as_uvec3();
            let material_id = self.material_at(local_voxel).unwrap_or_default();
            if material_id != 0 {
                let local_hit = local_origin + local_direction * t;
                let world_hit = world_from_local.transform_point3(local_hit);
                let world_distance = origin.distance(world_hit);
                if world_distance <= max_distance {
                    let world_normal = world_from_local
                        .transform_vector3(if normal == Vec3::ZERO {
                            -grid_direction.normalize_or_zero()
                        } else {
                            normal
                        })
                        .normalize_or_zero();
                    return Some(VoxelRayHit {
                        position: world_hit,
                        normal: world_normal,
                        distance: world_distance,
                        material_id,
                        chunk: IVec3::ZERO,
                        local: local_voxel,
                        world_voxel: world_hit.floor().as_ivec3(),
                        steps,
                    });
                }
            }

            if t_max.x <= t_max.y && t_max.x <= t_max.z {
                t = t_max.x;
                t_max.x += t_delta.x;
                voxel.x += step.x;
                normal = Vec3::new(if step.x > 0 { -1.0 } else { 1.0 }, 0.0, 0.0);
            } else if t_max.y <= t_max.z {
                t = t_max.y;
                t_max.y += t_delta.y;
                voxel.y += step.y;
                normal = Vec3::new(0.0, if step.y > 0 { -1.0 } else { 1.0 }, 0.0);
            } else {
                t = t_max.z;
                t_max.z += t_delta.z;
                voxel.z += step.z;
                normal = Vec3::new(0.0, 0.0, if step.z > 0 { -1.0 } else { 1.0 });
            }
        }
        None
    }
}

pub fn sync_naadf_entity_volume_registry(
    query: Query<(
        Entity,
        &GlobalTransform,
        &NaadfEntityVoxelVolume,
        Option<&NaadfStaticVoxelProxy>,
    )>,
    policy: Res<NaadfStaticProxyPolicy>,
    mut registry: ResMut<NaadfEntityVolumeRegistry>,
    mut stats: ResMut<NaadfStats>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Option<Res<FrameCount>>,
) {
    let _timer = timing.as_deref_mut().map(|timing| {
        area_timer(
            timing,
            frame.as_deref().map_or(0, |frame| frame.0),
            "NAADF Entity Sync",
        )
    });

    let mut static_proxy_volumes = 0u32;
    let mut static_proxy_skipped = 0u32;
    registry.sync(
        query
            .iter()
            .filter_map(|(entity, transform, volume, static_proxy)| {
                if static_proxy.is_some() {
                    if !policy.allows(volume) {
                        static_proxy_skipped = static_proxy_skipped.saturating_add(1);
                        return None;
                    }
                    static_proxy_volumes = static_proxy_volumes.saturating_add(1);
                }
                Some((entity, transform, volume))
            }),
    );
    stats.entity_volumes = registry.len() as u32;
    stats.entity_volume_voxels = registry.total_occupied_voxels();
    stats.static_proxy_volumes = static_proxy_volumes;
    stats.static_proxy_skipped = static_proxy_skipped;
}

pub fn entity_voxel_index(local: UVec3, dimensions: UVec3) -> usize {
    (local.x + local.y * dimensions.x + local.z * dimensions.x * dimensions.y) as usize
}

fn volume_len(dimensions: UVec3) -> usize {
    dimensions.x as usize * dimensions.y as usize * dimensions.z as usize
}

fn ray_box_intersection(origin: Vec3, direction: Vec3, min: Vec3, max: Vec3) -> Option<(f32, f32)> {
    let (near_x, far_x) = ray_box_axis(origin.x, direction.x, min.x, max.x)?;
    let (near_y, far_y) = ray_box_axis(origin.y, direction.y, min.y, max.y)?;
    let (near_z, far_z) = ray_box_axis(origin.z, direction.z, min.z, max.z)?;
    let entry = near_x.max(near_y).max(near_z);
    let exit = far_x.min(far_y).min(far_z);
    (entry <= exit).then_some((entry, exit))
}

fn ray_box_axis(origin: f32, direction: f32, min: f32, max: f32) -> Option<(f32, f32)> {
    if direction.abs() <= f32::EPSILON {
        return (origin >= min && origin <= max).then_some((f32::NEG_INFINITY, f32::INFINITY));
    }
    let t0 = (min - origin) / direction;
    let t1 = (max - origin) / direction;
    Some((t0.min(t1), t0.max(t1)))
}

fn next_grid_boundary_t(origin: Vec3, voxel: IVec3, step: IVec3, inv_dir: Vec3) -> Vec3 {
    let next = Vec3::new(
        if step.x > 0 {
            voxel.x as f32 + 1.0
        } else {
            voxel.x as f32
        },
        if step.y > 0 {
            voxel.y as f32 + 1.0
        } else {
            voxel.y as f32
        },
        if step.z > 0 {
            voxel.z as f32 + 1.0
        } else {
            voxel.z as f32
        },
    );
    (next - origin) * inv_dir
}

fn reciprocal_or_infinity(value: f32) -> f32 {
    if value.abs() <= f32::EPSILON {
        f32::INFINITY
    } else {
        1.0 / value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_volume_rejects_wrong_material_count() {
        let err =
            NaadfEntityVoxelVolume::new(UVec3::new(2, 2, 2), Vec3::ONE, vec![1; 7]).unwrap_err();

        assert_eq!(
            err,
            NaadfEntityVolumeError::InvalidMaterialCount {
                expected: 8,
                actual: 7,
            }
        );
    }

    #[test]
    fn entity_volume_indexes_materials_in_xyz_order() {
        let volume = NaadfEntityVoxelVolume::new(
            UVec3::new(2, 2, 2),
            Vec3::ONE,
            vec![1, 2, 3, 4, 5, 6, 7, 8],
        )
        .unwrap();

        assert_eq!(volume.material_at(UVec3::new(0, 0, 0)), Some(1));
        assert_eq!(volume.material_at(UVec3::new(1, 0, 0)), Some(2));
        assert_eq!(volume.material_at(UVec3::new(0, 1, 0)), Some(3));
        assert_eq!(volume.material_at(UVec3::new(0, 0, 1)), Some(5));
        assert_eq!(volume.material_at(UVec3::new(2, 0, 0)), None);
    }

    #[test]
    fn entity_registry_tracks_world_bounds_and_occupied_count() {
        let entity = Entity::from_raw_u32(7).unwrap();
        let transform = GlobalTransform::from(Transform::from_xyz(10.0, 2.0, -3.0));
        let volume = NaadfEntityVoxelVolume::with_origin(
            UVec3::new(2, 1, 1),
            Vec3::splat(0.5),
            Vec3::new(-0.5, 0.0, -0.5),
            vec![0, 4],
        )
        .unwrap();
        let mut registry = NaadfEntityVolumeRegistry::default();

        registry.sync([(entity, &transform, &volume)]);

        let record = registry.get(entity).unwrap();
        assert_eq!(record.occupied_voxels, 1);
        assert_eq!(record.world_aabb_min, Vec3::new(9.5, 2.0, -3.5));
        assert_eq!(record.world_aabb_max, Vec3::new(10.5, 2.5, -3.0));
    }

    #[test]
    fn entity_registry_preserves_previous_transform_for_stable_volume() {
        let entity = Entity::from_raw_u32(8).unwrap();
        let previous_transform = GlobalTransform::from(Transform::from_xyz(1.0, 0.0, 0.0));
        let current_transform = GlobalTransform::from(Transform::from_xyz(4.0, 0.0, 0.0));
        let volume = NaadfEntityVoxelVolume::new(UVec3::ONE, Vec3::ONE, vec![3]).unwrap();
        let mut registry = NaadfEntityVolumeRegistry::default();

        registry.sync([(entity, &previous_transform, &volume)]);
        registry.sync([(entity, &current_transform, &volume)]);

        let record = registry.get(entity).unwrap();
        assert_eq!(record.world_from_local, current_transform);
        assert_eq!(record.previous_world_from_local, previous_transform);
    }

    #[test]
    fn entity_registry_resets_previous_transform_when_volume_revision_changes() {
        let entity = Entity::from_raw_u32(9).unwrap();
        let previous_transform = GlobalTransform::from(Transform::from_xyz(1.0, 0.0, 0.0));
        let current_transform = GlobalTransform::from(Transform::from_xyz(4.0, 0.0, 0.0));
        let mut volume = NaadfEntityVoxelVolume::new(UVec3::ONE, Vec3::ONE, vec![3]).unwrap();
        let mut registry = NaadfEntityVolumeRegistry::default();

        registry.sync([(entity, &previous_transform, &volume)]);
        volume.mark_dirty();
        registry.sync([(entity, &current_transform, &volume)]);

        let record = registry.get(entity).unwrap();
        assert_eq!(record.world_from_local, current_transform);
        assert_eq!(record.previous_world_from_local, current_transform);
    }

    #[test]
    fn static_proxy_policy_rejects_small_props() {
        let volume =
            NaadfEntityVoxelVolume::new(UVec3::new(2, 2, 2), Vec3::ONE, vec![1; 8]).unwrap();
        let policy = NaadfStaticProxyPolicy::default();

        assert!(!policy.allows(&volume));
    }

    #[test]
    fn static_proxy_policy_accepts_large_static_actor() {
        let volume =
            NaadfEntityVoxelVolume::new(UVec3::new(4, 4, 4), Vec3::ONE, vec![1; 64]).unwrap();
        let policy = NaadfStaticProxyPolicy::default();

        assert!(policy.allows(&volume));
    }

    #[test]
    fn entity_registry_traces_nearest_dynamic_volume_hit() {
        let near_entity = Entity::from_raw_u32(1).unwrap();
        let far_entity = Entity::from_raw_u32(2).unwrap();
        let near_transform = GlobalTransform::from(Transform::from_xyz(4.0, 0.0, 0.0));
        let far_transform = GlobalTransform::from(Transform::from_xyz(8.0, 0.0, 0.0));
        let volume = NaadfEntityVoxelVolume::new(UVec3::ONE, Vec3::ONE, vec![9]).unwrap();
        let mut registry = NaadfEntityVolumeRegistry::default();
        registry.sync([
            (far_entity, &far_transform, &volume),
            (near_entity, &near_transform, &volume),
        ]);

        let hit = registry
            .trace(Vec3::ZERO, Vec3::X, 16.0)
            .expect("expected dynamic volume hit");

        assert_eq!(hit.material_id, 9);
        assert_eq!(hit.local, UVec3::ZERO);
        assert!((hit.distance - 4.0).abs() <= 0.001);
    }

    #[test]
    fn entity_record_trace_respects_rotation() {
        let entity = Entity::from_raw_u32(3).unwrap();
        let transform = GlobalTransform::from(
            Transform::from_xyz(4.0, 0.0, 0.0)
                .with_rotation(Quat::from_rotation_z(std::f32::consts::FRAC_PI_2)),
        );
        let volume = NaadfEntityVoxelVolume::with_origin(
            UVec3::new(1, 2, 1),
            Vec3::ONE,
            Vec3::ZERO,
            vec![0, 5],
        )
        .unwrap();
        let mut registry = NaadfEntityVolumeRegistry::default();
        registry.sync([(entity, &transform, &volume)]);

        let hit = registry
            .trace(Vec3::new(2.5, -2.0, 0.5), Vec3::Y, 8.0)
            .expect("expected rotated dynamic volume hit");

        assert_eq!(hit.material_id, 5);
        assert_eq!(hit.local, UVec3::new(0, 1, 0));
    }
}
