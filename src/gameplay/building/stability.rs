//! Event-driven structural stability propagation for placed building pieces.

use bevy::diagnostic::FrameCount;
use bevy::math::{Isometry3d, primitives::Cuboid};
use bevy::prelude::*;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet, VecDeque};
use std::time::Instant;

use crate::gameplay::entity::{ItemDrop, ItemType};
use crate::performance::AreaTimingRecorder;
use crate::rendering::building_material::BuildingMaterialType;
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;

use super::grid::BuildingGrid;
use super::types::{BuildingPiece, BuildingPieceRegistry, BuildingState, PieceDefinition};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum SupportClass {
    #[default]
    Wood,
    Stone,
    Ground,
}

impl SupportClass {
    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "wood" => Some(Self::Wood),
            "stone" => Some(Self::Stone),
            "ground" => Some(Self::Ground),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SupportProfile {
    pub max_support: f32,
    pub decay_per_hop: f32,
    pub class: SupportClass,
}

impl SupportProfile {
    pub fn for_material(material: BuildingMaterialType) -> Self {
        match material {
            BuildingMaterialType::MetalPlate => Self {
                max_support: 1.0,
                decay_per_hop: 0.05,
                class: SupportClass::Ground,
            },
            BuildingMaterialType::StoneBrick => Self {
                max_support: 1.0,
                decay_per_hop: 0.125,
                class: SupportClass::Stone,
            },
            BuildingMaterialType::WoodPlank => Self {
                max_support: 1.0,
                decay_per_hop: 0.08,
                class: SupportClass::Wood,
            },
            BuildingMaterialType::Thatch => Self {
                max_support: 1.0,
                decay_per_hop: 1.0,
                class: SupportClass::Wood,
            },
        }
    }
}

#[derive(Component, Clone, Copy, Debug, Default, PartialEq)]
pub struct Stability {
    pub value: f32,
    pub grounded: bool,
}

#[derive(Resource, Clone, Copy, Debug)]
pub struct StabilityConfig {
    pub collapse_threshold: f32,
    pub epsilon: f32,
    pub max_island_size: usize,
}

impl Default for StabilityConfig {
    fn default() -> Self {
        Self {
            collapse_threshold: 0.20,
            epsilon: 0.0001,
            max_island_size: 4096,
        }
    }
}

#[derive(Resource, Default)]
pub struct DirtyStabilityIslands {
    entities: HashSet<Entity>,
}

impl DirtyStabilityIslands {
    pub fn mark(&mut self, entity: Entity) {
        self.entities.insert(entity);
    }
}

#[derive(Resource, Default)]
pub struct PendingStabilityCollapses {
    entities: HashSet<Entity>,
}

#[derive(Clone, Copy)]
struct StabilityNode {
    profile: SupportProfile,
    grounded: bool,
}

#[derive(Clone, Copy)]
struct QueueEntry {
    entity: Entity,
    support: f32,
}

impl PartialEq for QueueEntry {
    fn eq(&self, other: &Self) -> bool {
        self.entity == other.entity && self.support.to_bits() == other.support.to_bits()
    }
}

impl Eq for QueueEntry {}

impl PartialOrd for QueueEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for QueueEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        self.support
            .total_cmp(&other.support)
            .then_with(|| self.entity.to_bits().cmp(&other.entity.to_bits()))
    }
}

pub fn cleanup_removed_building_pieces(
    mut removed: RemovedComponents<BuildingPiece>,
    mut grid: ResMut<BuildingGrid>,
    mut dirty: ResMut<DirtyStabilityIslands>,
) {
    for entity in removed.read() {
        for neighbor in grid.remove_entity(entity) {
            dirty.mark(neighbor);
        }
    }
}

pub fn recompute_dirty_stability(
    mut dirty: ResMut<DirtyStabilityIslands>,
    mut pending_collapses: ResMut<PendingStabilityCollapses>,
    grid: Res<BuildingGrid>,
    registry: Res<BuildingPieceRegistry>,
    world: Res<VoxelWorld>,
    config: Res<StabilityConfig>,
    mut pieces: ParamSet<(
        Query<(&BuildingPiece, &Transform, &Stability)>,
        Query<&mut Stability>,
    )>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Option<Res<FrameCount>>,
) {
    if dirty.entities.is_empty() {
        return;
    }

    let started = Instant::now();
    let pending = std::mem::take(&mut dirty.entities);
    let mut visited = HashSet::new();
    let mut island_count = 0usize;
    let mut largest_island = 0usize;
    let mut relaxation_count = 0usize;
    let mut cap_hits = 0usize;

    for start in pending {
        if visited.contains(&start) || pieces.p0().get(start).is_err() {
            continue;
        }

        let island = collect_island(start, &grid, config.max_island_size);
        visited.extend(island.iter().copied());
        if island.len() > config.max_island_size {
            cap_hits += 1;
            warn!(
                "Building stability island exceeded cap of {} pieces; keeping prior values",
                config.max_island_size
            );
            continue;
        }

        let nodes = {
            let piece_query = pieces.p0();
            island
                .iter()
                .filter_map(|entity| {
                    let (piece, transform, _) = piece_query.get(*entity).ok()?;
                    let definition = registry.get(piece.piece_type)?;
                    Some((
                        *entity,
                        StabilityNode {
                            profile: definition.support_profile,
                            grounded: is_piece_grounded(
                                definition,
                                transform.translation,
                                transform.rotation,
                                &world,
                            ),
                        },
                    ))
                })
                .collect::<HashMap<_, _>>()
        };

        let (values, relaxations) = solve_stability(&nodes, &grid, config.epsilon);
        relaxation_count += relaxations;
        largest_island = largest_island.max(nodes.len());
        island_count += 1;

        let mut stability_query = pieces.p1();
        for (entity, node) in nodes {
            if let Ok(mut stability) = stability_query.get_mut(entity) {
                stability.value = values.get(&entity).copied().unwrap_or(0.0);
                stability.grounded = node.grounded;
                if should_collapse(*stability, &config) {
                    pending_collapses.entities.insert(entity);
                }
            }
        }
    }

    if let Some(recorder) = timing.as_deref_mut() {
        let frame = frame.as_deref().map(|frame| frame.0).unwrap_or_default();
        recorder.record_area(
            frame,
            "Building Stability Recompute",
            started.elapsed().as_micros() as u64,
        );
        recorder.record_count(frame, "Building Stability Islands", island_count as f64);
        recorder.record_count(
            frame,
            "Building Stability Largest Island",
            largest_island as f64,
        );
        recorder.record_count(
            frame,
            "Building Stability Relaxations",
            relaxation_count as f64,
        );
        recorder.record_count(frame, "Building Stability Cap Hits", cap_hits as f64);
    }
}

pub fn collapse_unstable_building_pieces(
    mut commands: Commands,
    mut pending: ResMut<PendingStabilityCollapses>,
    config: Res<StabilityConfig>,
    mut grid: ResMut<BuildingGrid>,
    mut dirty: ResMut<DirtyStabilityIslands>,
    pieces: Query<(Entity, &BuildingPiece, &Transform, &Stability)>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Option<Res<FrameCount>>,
) {
    if pending.entities.is_empty() {
        return;
    }

    let started = Instant::now();
    let candidates = std::mem::take(&mut pending.entities);
    let mut collapsed = 0usize;

    for entity in candidates {
        let Ok((entity, piece, transform, stability)) = pieces.get(entity) else {
            continue;
        };
        if !should_collapse(*stability, &config) {
            continue;
        }

        for neighbor in grid.remove_entity(entity) {
            dirty.mark(neighbor);
        }
        commands.spawn(ItemDrop {
            item_type: collapse_drop_for_material(piece.material),
            position: transform.translation,
        });
        commands.entity(entity).despawn();
        collapsed += 1;
    }

    if collapsed == 0 {
        return;
    }

    info!("Collapsed {collapsed} unsupported building piece(s)");
    if let Some(recorder) = timing.as_deref_mut() {
        let frame = frame.as_deref().map(|frame| frame.0).unwrap_or_default();
        recorder.record_area(
            frame,
            "Building Stability Collapse",
            started.elapsed().as_micros() as u64,
        );
        recorder.record_count(frame, "Building Stability Collapses", collapsed as f64);
        recorder.record_count(frame, "Building Stability Drops", collapsed as f64);
    }
}

fn should_collapse(stability: Stability, config: &StabilityConfig) -> bool {
    !stability.grounded && stability.value + config.epsilon < config.collapse_threshold
}

fn collapse_drop_for_material(material: BuildingMaterialType) -> ItemType {
    match material {
        BuildingMaterialType::WoodPlank | BuildingMaterialType::Thatch => ItemType::Wood,
        BuildingMaterialType::StoneBrick => ItemType::Stone,
        BuildingMaterialType::MetalPlate => ItemType::Iron,
    }
}

fn collect_island(start: Entity, grid: &BuildingGrid, max_size: usize) -> Vec<Entity> {
    let mut island = Vec::new();
    let mut visited = HashSet::from([start]);
    let mut queue = VecDeque::from([start]);
    while let Some(entity) = queue.pop_front() {
        island.push(entity);
        if island.len() > max_size {
            break;
        }
        for neighbor in grid.neighbors(entity) {
            if visited.insert(neighbor) {
                queue.push_back(neighbor);
            }
        }
    }
    island
}

fn solve_stability(
    nodes: &HashMap<Entity, StabilityNode>,
    grid: &BuildingGrid,
    epsilon: f32,
) -> (HashMap<Entity, f32>, usize) {
    let mut values = nodes
        .keys()
        .copied()
        .map(|entity| (entity, 0.0))
        .collect::<HashMap<_, _>>();
    let mut queue = BinaryHeap::new();

    for (entity, node) in nodes {
        if node.grounded {
            values.insert(*entity, node.profile.max_support);
            queue.push(QueueEntry {
                entity: *entity,
                support: node.profile.max_support,
            });
        }
    }

    let mut relaxations = 0usize;
    while let Some(QueueEntry { entity, support }) = queue.pop() {
        if support + epsilon < values.get(&entity).copied().unwrap_or_default() {
            continue;
        }
        let Some(source) = nodes.get(&entity) else {
            continue;
        };
        for neighbor in grid.neighbors(entity) {
            let Some(target) = nodes.get(&neighbor) else {
                continue;
            };
            let candidate = propagated_support(support, source.profile, target.profile);
            let current = values.get(&neighbor).copied().unwrap_or_default();
            if candidate > current + epsilon {
                values.insert(neighbor, candidate);
                queue.push(QueueEntry {
                    entity: neighbor,
                    support: candidate,
                });
                relaxations += 1;
            }
        }
    }

    (values, relaxations)
}

pub fn propagated_support(
    source_value: f32,
    source: SupportProfile,
    target: SupportProfile,
) -> f32 {
    if source_value <= 0.0 || source.class < target.class {
        return 0.0;
    }
    if source.class > target.class {
        return target.max_support;
    }
    (source_value - source.decay_per_hop)
        .max(0.0)
        .min(target.max_support)
}

pub fn predict_stability(
    grounded: bool,
    target: SupportProfile,
    source: Option<(Stability, SupportProfile)>,
) -> Stability {
    if grounded {
        return Stability {
            value: target.max_support,
            grounded: true,
        };
    }
    Stability {
        value: source
            .map(|(stability, profile)| propagated_support(stability.value, profile, target))
            .unwrap_or_default(),
        grounded: false,
    }
}

pub fn is_piece_grounded(
    definition: &PieceDefinition,
    position: Vec3,
    rotation: Quat,
    world: &VoxelWorld,
) -> bool {
    if !definition.can_ground {
        return false;
    }

    ground_sample_offsets(definition.dimensions)
        .into_iter()
        .any(|offset| {
            let block = (position + rotation * offset).floor().as_ivec3();
            world.get_voxel(block).is_some_and(|voxel| voxel.is_solid())
        })
}

fn ground_sample_offsets(dimensions: Vec3) -> [Vec3; 5] {
    let half = dimensions * 0.5;
    let x = (half.x * 0.8).max(0.02);
    let z = (half.z * 0.8).max(0.02);
    let y = -half.y - 0.1;
    [
        Vec3::new(0.0, y, 0.0),
        Vec3::new(-x, y, -z),
        Vec3::new(x, y, -z),
        Vec3::new(-x, y, z),
        Vec3::new(x, y, z),
    ]
}

pub fn stability_color(stability: Stability, max_support: f32, collapse_threshold: f32) -> Color {
    if stability.grounded {
        return Color::srgba(0.2, 0.5, 1.0, 0.9);
    }
    let ratio = if max_support > 0.0 {
        stability.value / max_support
    } else {
        0.0
    };
    if ratio >= 0.67 {
        Color::srgba(0.2, 0.9, 0.2, 0.9)
    } else if ratio >= 0.40 {
        Color::srgba(1.0, 0.9, 0.15, 0.9)
    } else if ratio >= collapse_threshold {
        Color::srgba(1.0, 0.5, 0.1, 0.9)
    } else {
        Color::srgba(0.95, 0.1, 0.1, 0.9)
    }
}

pub fn draw_stability_outlines(
    state: Res<BuildingState>,
    registry: Res<BuildingPieceRegistry>,
    config: Res<StabilityConfig>,
    pieces: Query<(&Transform, &BuildingPiece, &Stability)>,
    mut gizmos: Gizmos,
) {
    if !state.active {
        return;
    }
    for (transform, piece, stability) in &pieces {
        let Some(definition) = registry.get(piece.piece_type) else {
            continue;
        };
        let cuboid = Cuboid::new(
            definition.dimensions.x,
            definition.dimensions.y,
            definition.dimensions.z,
        );
        gizmos.primitive_3d(
            &cuboid,
            Isometry3d::new(transform.translation, transform.rotation),
            stability_color(
                *stability,
                definition.support_profile.max_support,
                config.collapse_threshold,
            ),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::building::types::PieceTypeId;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;

    fn profile(class: SupportClass, decay: f32) -> SupportProfile {
        SupportProfile {
            max_support: 1.0,
            decay_per_hop: decay,
            class,
        }
    }

    fn entities(count: usize) -> Vec<Entity> {
        let mut world = World::new();
        (0..count).map(|_| world.spawn_empty().id()).collect()
    }

    #[test]
    fn wood_support_decays_per_hop() {
        let ids = entities(3);
        let mut grid = BuildingGrid::default();
        for (index, entity) in ids.iter().copied().enumerate() {
            grid.insert(IVec3::new(index as i32, 0, 0), entity);
        }
        grid.connect(ids[0], ids[1]);
        grid.connect(ids[1], ids[2]);
        let nodes = HashMap::from([
            (
                ids[0],
                StabilityNode {
                    profile: profile(SupportClass::Wood, 0.08),
                    grounded: true,
                },
            ),
            (
                ids[1],
                StabilityNode {
                    profile: profile(SupportClass::Wood, 0.08),
                    grounded: false,
                },
            ),
            (
                ids[2],
                StabilityNode {
                    profile: profile(SupportClass::Wood, 0.08),
                    grounded: false,
                },
            ),
        ]);
        let (values, _) = solve_stability(&nodes, &grid, 0.0001);
        assert!((values[&ids[1]] - 0.92).abs() < 0.0001);
        assert!((values[&ids[2]] - 0.84).abs() < 0.0001);
    }

    #[test]
    fn stronger_support_resets_weaker_target() {
        let stone = profile(SupportClass::Stone, 0.125);
        let wood = profile(SupportClass::Wood, 0.08);
        assert_eq!(propagated_support(0.25, stone, wood), 1.0);
        assert_eq!(propagated_support(1.0, wood, stone), 0.0);
        assert_eq!(
            propagated_support(0.1, profile(SupportClass::Ground, 0.05), stone),
            1.0
        );
    }

    #[test]
    fn thatch_accepts_support_but_does_not_relay_it() {
        let wood = profile(SupportClass::Wood, 0.08);
        let thatch = profile(SupportClass::Wood, 1.0);
        assert_eq!(propagated_support(1.0, wood, thatch), 0.92);
        assert_eq!(propagated_support(1.0, thatch, wood), 0.0);
    }

    #[test]
    fn cyclic_graph_converges_to_best_support() {
        let ids = entities(3);
        let mut grid = BuildingGrid::default();
        for (index, entity) in ids.iter().copied().enumerate() {
            grid.insert(IVec3::new(index as i32, 0, 0), entity);
        }
        grid.connect(ids[0], ids[1]);
        grid.connect(ids[1], ids[2]);
        grid.connect(ids[2], ids[0]);
        let nodes = ids
            .iter()
            .enumerate()
            .map(|(index, entity)| {
                (
                    *entity,
                    StabilityNode {
                        profile: profile(SupportClass::Wood, 0.08),
                        grounded: index == 0,
                    },
                )
            })
            .collect();
        let (values, relaxations) = solve_stability(&nodes, &grid, 0.0001);
        assert_eq!(values[&ids[0]], 1.0);
        assert!((values[&ids[1]] - 0.92).abs() < 0.0001);
        assert!((values[&ids[2]] - 0.92).abs() < 0.0001);
        assert!(relaxations <= 3);
    }

    #[test]
    fn removing_bridge_splits_graph() {
        let ids = entities(3);
        let mut grid = BuildingGrid::default();
        for (index, entity) in ids.iter().copied().enumerate() {
            grid.insert(IVec3::new(index as i32, 0, 0), entity);
        }
        grid.connect(ids[0], ids[1]);
        grid.connect(ids[1], ids[2]);
        let neighbors = grid.remove_entity(ids[1]);
        assert_eq!(neighbors.len(), 2);
        assert!(grid.neighbors(ids[0]).is_empty());
        assert!(grid.neighbors(ids[2]).is_empty());
    }

    #[test]
    fn disconnected_island_does_not_receive_support() {
        let ids = entities(2);
        let mut grid = BuildingGrid::default();
        grid.insert(IVec3::ZERO, ids[0]);
        grid.insert(IVec3::X, ids[1]);
        let nodes = HashMap::from([
            (
                ids[0],
                StabilityNode {
                    profile: profile(SupportClass::Wood, 0.08),
                    grounded: true,
                },
            ),
            (
                ids[1],
                StabilityNode {
                    profile: profile(SupportClass::Wood, 0.08),
                    grounded: false,
                },
            ),
        ]);
        let (values, _) = solve_stability(&nodes, &grid, 0.0001);
        assert_eq!(values[&ids[0]], 1.0);
        assert_eq!(values[&ids[1]], 0.0);
    }

    #[test]
    fn island_collection_stops_when_cap_is_exceeded() {
        let ids = entities(4);
        let mut grid = BuildingGrid::default();
        for (index, entity) in ids.iter().copied().enumerate() {
            grid.insert(IVec3::new(index as i32, 0, 0), entity);
            if index > 0 {
                grid.connect(ids[index - 1], entity);
            }
        }
        let island = collect_island(ids[0], &grid, 2);
        assert_eq!(island.len(), 3);
    }

    #[test]
    fn prediction_keeps_grounding_separate() {
        let wood = profile(SupportClass::Wood, 0.08);
        let grounded = predict_stability(true, wood, None);
        assert_eq!(grounded.value, 1.0);
        assert!(grounded.grounded);
        let unsupported = predict_stability(false, wood, None);
        assert_eq!(unsupported.value, 0.0);
        assert!(!unsupported.grounded);
    }

    #[test]
    fn collapse_threshold_ignores_grounded_and_epsilon_close_pieces() {
        let config = StabilityConfig::default();
        assert!(should_collapse(
            Stability {
                value: 0.0,
                grounded: false,
            },
            &config,
        ));
        assert!(!should_collapse(
            Stability {
                value: config.collapse_threshold - config.epsilon,
                grounded: false,
            },
            &config,
        ));
        assert!(!should_collapse(
            Stability {
                value: 0.0,
                grounded: true,
            },
            &config,
        ));
    }

    #[test]
    fn collapse_drop_uses_the_piece_material() {
        assert_eq!(
            collapse_drop_for_material(BuildingMaterialType::WoodPlank),
            ItemType::Wood
        );
        assert_eq!(
            collapse_drop_for_material(BuildingMaterialType::Thatch),
            ItemType::Wood
        );
        assert_eq!(
            collapse_drop_for_material(BuildingMaterialType::StoneBrick),
            ItemType::Stone
        );
        assert_eq!(
            collapse_drop_for_material(BuildingMaterialType::MetalPlate),
            ItemType::Iron
        );
    }

    #[test]
    fn collapse_removes_grid_edges_marks_neighbors_and_spawns_drop() {
        let mut app = App::new();
        app.init_resource::<BuildingGrid>()
            .init_resource::<DirtyStabilityIslands>()
            .init_resource::<PendingStabilityCollapses>()
            .init_resource::<StabilityConfig>()
            .add_systems(Update, collapse_unstable_building_pieces);

        let piece = app
            .world_mut()
            .spawn((
                BuildingPiece {
                    piece_type: PieceTypeId(1),
                    grid_position: IVec3::ZERO,
                    rotation: 0,
                    material: BuildingMaterialType::StoneBrick,
                },
                Transform::from_xyz(1.0, 2.0, 3.0),
                Stability {
                    value: 0.0,
                    grounded: false,
                },
            ))
            .id();
        let neighbor = app.world_mut().spawn_empty().id();
        {
            let mut grid = app.world_mut().resource_mut::<BuildingGrid>();
            grid.insert(IVec3::ZERO, piece);
            grid.insert(IVec3::X, neighbor);
            grid.connect(piece, neighbor);
        }
        app.world_mut()
            .resource_mut::<PendingStabilityCollapses>()
            .entities
            .insert(piece);

        app.update();

        assert!(app.world().get::<BuildingPiece>(piece).is_none());
        assert!(
            app.world()
                .resource::<DirtyStabilityIslands>()
                .entities
                .contains(&neighbor)
        );
        assert!(
            app.world()
                .resource::<BuildingGrid>()
                .neighbors(neighbor)
                .is_empty()
        );
        let mut drops = app.world_mut().query::<&ItemDrop>();
        let drops = drops.iter(app.world()).collect::<Vec<_>>();
        assert_eq!(drops.len(), 1);
        assert_eq!(drops[0].item_type, ItemType::Stone);
        assert_eq!(drops[0].position, Vec3::new(1.0, 2.0, 3.0));
    }

    #[test]
    fn ground_samples_include_center_and_four_corners() {
        let offsets = ground_sample_offsets(Vec3::new(2.0, 0.2, 2.0));
        assert_eq!(offsets.len(), 5);
        assert_eq!(offsets[0].x, 0.0);
        assert!(offsets[1].x < 0.0 && offsets[1].z < 0.0);
        assert!(offsets[4].x > 0.0 && offsets[4].z > 0.0);
    }

    #[test]
    fn terrain_contact_seeds_grounded_piece() {
        let mut world = VoxelWorld::new(IVec3::ONE);
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        let ground_y = world.bounds().min_breakable_y;
        world.set_voxel(IVec3::new(1, ground_y, 1), VoxelType::Rock);
        let definition = PieceDefinition::floor(1, "Wood Floor", BuildingMaterialType::WoodPlank);

        assert!(is_piece_grounded(
            &definition,
            Vec3::new(1.5, ground_y as f32 + 0.5, 1.5),
            Quat::IDENTITY,
            &world,
        ));
        assert!(!is_piece_grounded(
            &definition,
            Vec3::new(5.5, ground_y as f32 + 0.5, 5.5),
            Quat::IDENTITY,
            &world,
        ));
    }
}
