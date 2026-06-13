//! Phase 5 Step 5: binary live-chunk/page terrain ownership.
//!
//! CLOD pages and live chunks are mutually exclusive owners of a terrain footprint.
//! Fresh LOD0 pages are built from the same main-surface chunk meshes as the live
//! chunks, so drawing both causes coplanar z-fighting. Binary ownership switch per
//! chunk footprint; complementary dither fade ONLY for stale (post-edit) geometry.

use std::collections::HashSet;

use bevy::prelude::*;

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::render::{ClodPageMeshTag, ClodPagesShow, ClodPagesShowMode};
use super::runtime::ClodPagesRuntime;
#[cfg(test)]
use super::selection::NearFieldBubble;
use super::selection::{clod_near_field_bubble, near_field_intersects_footprint, ClodPageNodeKey};
use super::types::PageFootprint;
use crate::constants::CHUNK_SIZE_F32;
use crate::gameplay::camera::controller::PlayerCamera;
use crate::gameplay::player::Player;
use crate::voxel::chunk::MeshDirtyReason;
use crate::voxel::meshing::{ChunkMesh, WaterMesh};
use crate::voxel::world::VoxelWorld;

#[cfg(test)]
const FOOTPRINT_EPSILON: f32 = 0.001;

#[derive(Component, Clone, Copy, Debug, Default)]
pub(crate) struct ClodPageOwnedChunk;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct NearFieldChunkKey {
    camera: IVec2,
    player: Option<IVec2>,
}

#[derive(Resource, Debug)]
pub(crate) struct ClodPageMeshGate {
    pub(crate) enabled: bool,
    pub(crate) pages_ready: bool,
    pub(crate) pages_failed: bool,
    pub(crate) pages_pending: bool,
    tree_revision: Option<u64>,
    world_chunk_count: usize,
    bubble_key: Option<NearFieldChunkKey>,
    owned_columns: HashSet<IVec2>,
    pending_restore_columns: HashSet<IVec2>,
}

impl Default for ClodPageMeshGate {
    fn default() -> Self {
        Self {
            enabled: env_truthy("CLOD_PAGES_MESH_GATE"),
            pages_ready: false,
            pages_failed: false,
            pages_pending: false,
            tree_revision: None,
            world_chunk_count: 0,
            bubble_key: None,
            owned_columns: HashSet::new(),
            pending_restore_columns: HashSet::new(),
        }
    }
}

impl ClodPageMeshGate {
    pub(crate) fn owns_chunk(&self, chunk_pos: IVec3) -> bool {
        self.enabled && self.pages_ready && self.owned_columns.contains(&chunk_column(chunk_pos))
    }

    pub(crate) fn should_hold_pages_visible(&self) -> bool {
        self.enabled && !self.pending_restore_columns.is_empty()
    }

    pub(crate) fn node_has_pending_restore(
        &self,
        key: ClodPageNodeKey,
        chunks_per_page: i32,
    ) -> bool {
        if !self.should_hold_pages_visible() {
            return false;
        }
        let level_scale = 1i32 << key.level.min(30);
        let chunks_per_node = chunks_per_page * level_scale;
        let min_x = key.coord.0 * chunks_per_node;
        let min_z = key.coord.1 * chunks_per_node;
        let max_x = min_x + chunks_per_node;
        let max_z = min_z + chunks_per_node;
        self.pending_restore_columns.iter().any(|column| {
            column.x >= min_x && column.x < max_x && column.y >= min_z && column.y < max_z
        })
    }
}

fn env_truthy(key: &str) -> bool {
    matches!(
        std::env::var(key).ok().as_deref().map(str::trim),
        Some("1") | Some("true") | Some("on") | Some("yes")
    )
}

fn chunk_column(chunk_pos: IVec3) -> IVec2 {
    IVec2::new(chunk_pos.x, chunk_pos.z)
}

fn world_chunk_column(world_pos: Vec3) -> IVec2 {
    let chunk = VoxelWorld::world_to_chunk(world_pos.floor().as_ivec3());
    chunk_column(chunk)
}

/// Horizontal chunk footprint in world X/Z. Ownership is per loaded chunk column,
/// so Y is intentionally ignored.
pub(crate) fn chunk_footprint(chunk_pos: IVec3) -> PageFootprint {
    let min_x = chunk_pos.x as f32 * CHUNK_SIZE_F32;
    let min_z = chunk_pos.z as f32 * CHUNK_SIZE_F32;
    PageFootprint {
        min_x,
        min_z,
        max_x: min_x + CHUNK_SIZE_F32,
        max_z: min_z + CHUNK_SIZE_F32,
    }
}

#[cfg(test)]
fn page_covers_chunk(page: PageFootprint, chunk: PageFootprint) -> bool {
    page.min_x <= chunk.min_x + FOOTPRINT_EPSILON
        && page.min_z <= chunk.min_z + FOOTPRINT_EPSILON
        && page.max_x + FOOTPRINT_EPSILON >= chunk.max_x
        && page.max_z + FOOTPRINT_EPSILON >= chunk.max_z
}

#[cfg(test)]
fn visible_page_covers_chunk(page_footprints: &[PageFootprint], chunk: PageFootprint) -> bool {
    page_footprints
        .iter()
        .any(|page| page_covers_chunk(*page, chunk))
}

#[cfg(test)]
fn chunk_owned_by_page(
    chunk: PageFootprint,
    bubble: NearFieldBubble,
    ready_visible_pages: &[PageFootprint],
) -> bool {
    !near_field_intersects_footprint(chunk, bubble)
        && visible_page_covers_chunk(ready_visible_pages, chunk)
}

fn ready_visible_page_keys(
    runtime: &ClodPagesRuntime,
    show: &ClodPagesShow,
    tree: &ClodPageTree,
    page_query: &Query<(&ClodPageMeshTag, &Visibility), Without<ChunkMesh>>,
) -> HashSet<ClodPageNodeKey> {
    if !runtime.enabled
        || show.0 == ClodPagesShowMode::Off
        || !matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready))
    {
        return HashSet::new();
    }

    page_query
        .iter()
        .filter_map(|(tag, visibility)| {
            (*visibility == Visibility::Visible).then(|| ClodPageNodeKey::from(tag))
        })
        .collect()
}

pub(crate) fn chunk_page_coord(chunk_pos: IVec3, chunks_per_page: i32, level: usize) -> (i32, i32) {
    let level_scale = 1i32 << level.min(30);
    let chunks_per_node = chunks_per_page * level_scale;
    (
        chunk_pos.x.div_euclid(chunks_per_node),
        chunk_pos.z.div_euclid(chunks_per_node),
    )
}

fn chunk_covered_by_visible_page(
    chunk_pos: IVec3,
    chunks_per_page: i32,
    levels: usize,
    ready_visible_pages: &HashSet<ClodPageNodeKey>,
) -> bool {
    (0..levels).any(|level| {
        ready_visible_pages.contains(&ClodPageNodeKey::new(
            level,
            chunk_page_coord(chunk_pos, chunks_per_page, level),
        ))
    })
}

fn built_page_keys(tree: &ClodPageTree) -> HashSet<ClodPageNodeKey> {
    tree.nodes_by_level
        .iter()
        .enumerate()
        .flat_map(|(level, nodes)| {
            nodes
                .iter()
                .map(move |node| ClodPageNodeKey::new(level, node.coord))
        })
        .collect()
}

fn refresh_pending_restore_columns(gate: &mut ClodPageMeshGate, world: &VoxelWorld) {
    if gate.pending_restore_columns.is_empty() {
        return;
    }

    let mut pending = HashSet::new();
    for (pos, chunk) in world.chunk_entries() {
        let column = chunk_column(*pos);
        if !gate.pending_restore_columns.contains(&column) {
            continue;
        }
        if chunk.is_dirty() || chunk.mesh_entity().is_none() {
            pending.insert(column);
        }
    }
    gate.pending_restore_columns = pending;
}

fn mark_lost_owned_columns_dirty(
    gate: &mut ClodPageMeshGate,
    world: &mut VoxelWorld,
    lost_columns: HashSet<IVec2>,
) {
    if lost_columns.is_empty() {
        return;
    }

    let positions = world
        .chunk_entries()
        .filter_map(|(pos, _)| lost_columns.contains(&chunk_column(*pos)).then_some(*pos))
        .collect::<Vec<_>>();
    for pos in positions {
        world.mark_chunk_dirty_with_reason(pos, MeshDirtyReason::Generation);
    }
    gate.pending_restore_columns.extend(lost_columns);
}

pub(crate) fn refresh_clod_page_mesh_gate_system(
    runtime: Res<ClodPagesRuntime>,
    show: Res<ClodPagesShow>,
    tree: Res<ClodPageTree>,
    mut world: ResMut<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    player_query: Query<&Transform, (With<Player>, Without<PlayerCamera>)>,
    mut gate: ResMut<ClodPageMeshGate>,
) {
    gate.enabled = env_truthy("CLOD_PAGES_MESH_GATE");
    if !gate.enabled {
        gate.pages_ready = false;
        gate.pages_failed = false;
        gate.pages_pending = false;
        gate.tree_revision = None;
        gate.world_chunk_count = world.chunk_count();
        gate.bubble_key = None;
        gate.owned_columns.clear();
        gate.pending_restore_columns.clear();
        return;
    }

    refresh_pending_restore_columns(&mut gate, &world);

    let pages_ready = runtime.enabled
        && show.0 != ClodPagesShowMode::Off
        && matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready));
    gate.pages_ready = pages_ready;
    gate.pages_failed = runtime.enabled
        && show.0 != ClodPagesShowMode::Off
        && matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Failed(_)));
    gate.pages_pending = runtime.enabled
        && show.0 != ClodPagesShowMode::Off
        && matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Building));

    let bubble_key = camera_query.single().ok().map(|camera_transform| {
        let player_transform = player_query.single().ok();
        NearFieldChunkKey {
            camera: world_chunk_column(camera_transform.translation),
            player: player_transform.map(|transform| world_chunk_column(transform.translation)),
        }
    });
    let world_chunk_count = world.chunk_count();
    let needs_refresh = gate.tree_revision != Some(tree.revision)
        || gate.world_chunk_count != world_chunk_count
        || gate.bubble_key != bubble_key
        || !pages_ready;
    if !needs_refresh {
        return;
    }

    let previous_owned = std::mem::take(&mut gate.owned_columns);
    gate.tree_revision = Some(tree.revision);
    gate.world_chunk_count = world_chunk_count;
    gate.bubble_key = bubble_key;

    if !pages_ready {
        mark_lost_owned_columns_dirty(&mut gate, &mut world, previous_owned);
        return;
    }

    let Some(camera_transform) = camera_query.single().ok() else {
        mark_lost_owned_columns_dirty(&mut gate, &mut world, previous_owned);
        return;
    };
    let player_transform = player_query.single().ok();
    let bubble = clod_near_field_bubble(&runtime, camera_transform, player_transform);
    let page_keys = built_page_keys(&tree);
    let chunks_per_page = runtime.cfg.page.chunks_per_page as i32;
    let level_count = tree.nodes_by_level.len();

    let mut owned_columns = HashSet::new();
    for (pos, _) in world.chunk_entries() {
        let column = chunk_column(*pos);
        if owned_columns.contains(&column) {
            continue;
        }
        if !near_field_intersects_footprint(chunk_footprint(*pos), bubble)
            && chunk_covered_by_visible_page(*pos, chunks_per_page, level_count, &page_keys)
        {
            owned_columns.insert(column);
        }
    }

    let lost_columns = previous_owned
        .difference(&owned_columns)
        .copied()
        .collect::<HashSet<_>>();
    gate.owned_columns = owned_columns;
    mark_lost_owned_columns_dirty(&mut gate, &mut world, lost_columns);
}

fn restore_clod_hidden_chunk(
    commands: &mut Commands,
    entity: Entity,
    visibility: &mut Visibility,
    marker: Option<&ClodPageOwnedChunk>,
) {
    if marker.is_none() {
        return;
    }
    if *visibility == Visibility::Hidden {
        *visibility = Visibility::Visible;
    }
    commands.entity(entity).remove::<ClodPageOwnedChunk>();
}

/// Applies binary ownership to solid live terrain chunks only. Water meshes, water masks,
/// props, and grass remain outside the CLOD page ownership path.
pub(crate) fn clod_page_chunk_ownership_system(
    mut commands: Commands,
    runtime: Res<ClodPagesRuntime>,
    show: Res<ClodPagesShow>,
    tree: Res<ClodPageTree>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    player_query: Query<&Transform, (With<Player>, Without<PlayerCamera>)>,
    page_query: Query<(&ClodPageMeshTag, &Visibility), Without<ChunkMesh>>,
    mut chunk_query: Query<
        (
            Entity,
            &ChunkMesh,
            &mut Visibility,
            Option<&ClodPageOwnedChunk>,
        ),
        Without<WaterMesh>,
    >,
    mut had_owned_chunks: Local<bool>,
) {
    let pages_can_own = runtime.enabled
        && show.0 != ClodPagesShowMode::Off
        && matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready));
    if !pages_can_own && !*had_owned_chunks {
        return;
    }

    let Ok(camera_transform) = camera_query.single() else {
        if !*had_owned_chunks {
            return;
        }
        for (entity, _, mut visibility, marker) in &mut chunk_query {
            restore_clod_hidden_chunk(&mut commands, entity, &mut visibility, marker);
        }
        *had_owned_chunks = false;
        return;
    };

    let player_transform = player_query.single().ok();
    let bubble = clod_near_field_bubble(&runtime, camera_transform, player_transform);
    let ready_pages = ready_visible_page_keys(&runtime, &show, &tree, &page_query);
    if ready_pages.is_empty() && !*had_owned_chunks {
        return;
    }

    let chunks_per_page = runtime.cfg.page.chunks_per_page as i32;
    let level_count = tree.nodes_by_level.len();
    let mut any_owned_chunks = false;
    for (entity, chunk_mesh, mut visibility, marker) in &mut chunk_query {
        let chunk_footprint = chunk_footprint(chunk_mesh.chunk_position);
        if !near_field_intersects_footprint(chunk_footprint, bubble)
            && chunk_covered_by_visible_page(
                chunk_mesh.chunk_position,
                chunks_per_page,
                level_count,
                &ready_pages,
            )
        {
            any_owned_chunks = true;
            if *visibility != Visibility::Hidden {
                *visibility = Visibility::Hidden;
            }
            if marker.is_none() {
                commands.entity(entity).insert(ClodPageOwnedChunk);
            }
        } else {
            restore_clod_hidden_chunk(&mut commands, entity, &mut visibility, marker);
        }
    }
    *had_owned_chunks = any_owned_chunks;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn footprint(min_x: f32, min_z: f32, max_x: f32, max_z: f32) -> PageFootprint {
        PageFootprint {
            min_x,
            min_z,
            max_x,
            max_z,
        }
    }

    fn far_bubble() -> NearFieldBubble {
        NearFieldBubble {
            player_center: None,
            camera_center: Vec2::new(1000.0, 1000.0),
            radius: 96.0,
            boundary_padding: 16.0,
        }
    }

    #[test]
    fn chunk_footprint_ignores_y_and_uses_world_xz() {
        let chunk = chunk_footprint(IVec3::new(-2, 7, 3));
        assert_eq!(chunk.min_x, -32.0);
        assert_eq!(chunk.min_z, 48.0);
        assert_eq!(chunk.max_x, -16.0);
        assert_eq!(chunk.max_z, 64.0);
    }

    #[test]
    fn page_owner_requires_ready_visible_cover_and_outside_bubble() {
        let chunk = footprint(16.0, 16.0, 32.0, 32.0);
        let page = footprint(0.0, 0.0, 64.0, 64.0);

        assert!(chunk_owned_by_page(chunk, far_bubble(), &[page]));
        assert!(!chunk_owned_by_page(chunk, far_bubble(), &[]));

        let near_bubble = NearFieldBubble {
            player_center: Some(Vec2::new(24.0, 24.0)),
            camera_center: Vec2::new(1000.0, 1000.0),
            radius: 96.0,
            boundary_padding: 16.0,
        };
        assert!(!chunk_owned_by_page(chunk, near_bubble, &[page]));
    }
}
