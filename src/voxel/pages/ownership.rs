//! Phase 5 Step 5: binary live-chunk/page terrain ownership.
//!
//! CLOD pages own far-field rendering while live chunks remain visible only in the
//! near-field bubble. Fresh pages are built from the same LOD0 chunk meshes, so the
//! far live render entities stay hidden even while page replacements are unavailable.
//! Complementary dither fade is used only for stale post-edit page geometry.

use std::collections::HashSet;

use bevy::prelude::*;

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::render::ClodPageMeshTag;
use super::runtime::ClodPagesRuntime;
use super::selection::NearFieldBubble;
use super::selection::{ClodPageNodeKey, clod_near_field_bubble, near_field_intersects_footprint};
use super::types::PageFootprint;
use crate::constants::CHUNK_SIZE_F32;
use crate::gameplay::camera::controller::PlayerCamera;
use crate::gameplay::player::Player;
use crate::voxel::chunk::{LodLevel, MeshDirtyReason};
use crate::voxel::meshing::{ChunkMesh, WaterMesh};
use crate::voxel::runtime::mark_surface_nets_halo_dirty;
use crate::voxel::world::VoxelWorld;

#[derive(Component, Clone, Copy, Debug, Default)]
pub(crate) struct ClodPageOwnedChunk;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct NearFieldChunkKey {
    camera: IVec2,
    player: Option<IVec2>,
}

#[derive(Resource, Debug)]
pub(crate) struct ClodPageMeshGate {
    pub(crate) pages_ready: bool,
    pub(crate) pages_failed: bool,
    pub(crate) pages_pending: bool,
    tree_revision: Option<u64>,
    world_chunk_count: usize,
    bubble_key: Option<NearFieldChunkKey>,
    visible_page_count: usize,
    owned_columns: HashSet<IVec2>,
    pending_restore_columns: HashSet<IVec2>,
}

impl Default for ClodPageMeshGate {
    fn default() -> Self {
        Self {
            pages_ready: false,
            pages_failed: false,
            pages_pending: false,
            tree_revision: None,
            world_chunk_count: 0,
            bubble_key: None,
            visible_page_count: 0,
            owned_columns: HashSet::new(),
            pending_restore_columns: HashSet::new(),
        }
    }
}

impl ClodPageMeshGate {
    pub(crate) fn owns_chunk(&self, chunk_pos: IVec3) -> bool {
        self.pages_ready && self.owned_columns.contains(&chunk_column(chunk_pos))
    }

    pub(crate) fn chunk_pending_restore(&self, chunk_pos: IVec3) -> bool {
        self.pending_restore_columns
            .contains(&chunk_column(chunk_pos))
    }

    pub(crate) fn should_hold_pages_visible(&self) -> bool {
        !self.pending_restore_columns.is_empty()
    }

    pub(crate) fn node_has_pending_restore(
        &self,
        key: ClodPageNodeKey,
        tree: &ClodPageTree,
    ) -> bool {
        if !self.should_hold_pages_visible() {
            return false;
        }
        let Some(footprint) = node_footprint(tree, key) else {
            return false;
        };
        self.pending_restore_columns.iter().any(|column| {
            footprint_covers_chunk(
                footprint,
                chunk_footprint(IVec3::new(column.x, 0, column.y)),
            )
        })
    }
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

fn live_chunk_hidden_by_clod(
    chunk: PageFootprint,
    bubble: Option<NearFieldBubble>,
    page_covers: bool,
) -> bool {
    // Only hand a live chunk over to the pages when a ready, visible page actually
    // covers it AND it sits outside the near-field bubble. Without the coverage
    // requirement, far live terrain is hidden even where no page renders, which drops
    // the far-field silhouette and leaves bare horizon/water bands.
    page_covers
        && bubble
            .map(|bubble| !near_field_intersects_footprint(chunk, bubble))
            .unwrap_or(true)
}

/// True when `outer` fully contains `inner` in world X/Z.
pub(crate) fn footprint_covers_chunk(outer: PageFootprint, inner: PageFootprint) -> bool {
    outer.contains_footprint(inner)
}

pub(crate) fn node_footprint(tree: &ClodPageTree, key: ClodPageNodeKey) -> Option<PageFootprint> {
    tree.nodes_by_level
        .get(key.level)
        .and_then(|nodes| nodes.iter().find(|node| node.coord == key.coord))
        .map(|node| node.footprint)
}

pub(crate) fn chunk_covered_by_page(
    chunk_pos: IVec3,
    page_keys: &HashSet<ClodPageNodeKey>,
    tree: &ClodPageTree,
) -> bool {
    let chunk = chunk_footprint(chunk_pos);
    page_keys.iter().any(|key| {
        node_footprint(tree, *key).is_some_and(|page| footprint_covers_chunk(page, chunk))
    })
}

/// Keys of pages that are currently committed, visible, and from a Ready tree.
pub(crate) fn ready_visible_page_keys(
    tree: &ClodPageTree,
    page_query: &Query<(&ClodPageMeshTag, &Visibility), Without<ChunkMesh>>,
) -> HashSet<ClodPageNodeKey> {
    if !matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready)) {
        return HashSet::new();
    }
    page_query
        .iter()
        .filter_map(|(tag, visibility)| {
            (*visibility == Visibility::Visible).then(|| ClodPageNodeKey::from(tag))
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

fn refresh_terrain_mutation_restore_columns(gate: &mut ClodPageMeshGate, world: &mut VoxelWorld) {
    if gate.owned_columns.is_empty() {
        return;
    }

    let mutation_columns = world
        .chunk_entries()
        .filter_map(|(pos, chunk)| {
            chunk
                .has_dirty_reason(MeshDirtyReason::TerrainMutation)
                .then_some(chunk_column(*pos))
        })
        .filter(|column| gate.owned_columns.contains(column))
        .collect::<HashSet<_>>();
    if mutation_columns.is_empty() {
        return;
    }

    let positions = world
        .chunk_entries()
        .filter_map(|(pos, _)| {
            mutation_columns
                .contains(&chunk_column(*pos))
                .then_some(*pos)
        })
        .collect::<Vec<_>>();
    let mut lod_changed = Vec::new();
    for pos in positions {
        if let Some(mut chunk) = world.get_chunk_mut(pos) {
            if chunk.set_lod_level(LodLevel::Lod0) {
                lod_changed.push(pos);
            }
            chunk.mark_dirty_with_reason(MeshDirtyReason::TerrainMutation);
        }
    }
    for pos in lod_changed {
        mark_surface_nets_halo_dirty(world, pos);
    }

    for column in &mutation_columns {
        gate.owned_columns.remove(column);
    }
    gate.pending_restore_columns.extend(mutation_columns);
}

pub(crate) fn refresh_clod_page_mesh_gate_system(
    runtime: Res<ClodPagesRuntime>,
    tree: Res<ClodPageTree>,
    mut world: ResMut<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    player_query: Query<&Transform, (With<Player>, Without<PlayerCamera>)>,
    page_query: Query<(&ClodPageMeshTag, &Visibility), Without<ChunkMesh>>,
    mut gate: ResMut<ClodPageMeshGate>,
) {
    refresh_pending_restore_columns(&mut gate, &world);
    refresh_terrain_mutation_restore_columns(&mut gate, &mut world);

    let pages_ready = matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready));
    gate.pages_ready = pages_ready;
    gate.pages_failed = matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Failed(_)));
    gate.pages_pending = matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Building));

    let visible_pages = ready_visible_page_keys(&tree, &page_query);
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
        || gate.visible_page_count != visible_pages.len()
        || !pages_ready;
    if !needs_refresh {
        return;
    }

    gate.tree_revision = Some(tree.revision);
    gate.world_chunk_count = world_chunk_count;
    gate.bubble_key = bubble_key;
    gate.visible_page_count = visible_pages.len();

    if !pages_ready {
        gate.owned_columns.clear();
        return;
    }

    let Some(camera_transform) = camera_query.single().ok() else {
        gate.owned_columns.clear();
        return;
    };
    let player_transform = player_query.single().ok();
    let bubble = clod_near_field_bubble(&runtime, camera_transform, player_transform);

    let mut owned_columns = HashSet::new();
    for (pos, _) in world.chunk_entries() {
        let column = chunk_column(*pos);
        if owned_columns.contains(&column) {
            continue;
        }
        if !near_field_intersects_footprint(chunk_footprint(*pos), bubble)
            && chunk_covered_by_page(*pos, &visible_pages, &tree)
        {
            owned_columns.insert(column);
        }
    }

    gate.owned_columns = owned_columns;
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
    tree: Res<ClodPageTree>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    player_query: Query<&Transform, (With<Player>, Without<PlayerCamera>)>,
    mut chunk_query: Query<
        (
            Entity,
            &ChunkMesh,
            &mut Visibility,
            Option<&ClodPageOwnedChunk>,
        ),
        Without<WaterMesh>,
    >,
    page_query: Query<(&ClodPageMeshTag, &Visibility), Without<ChunkMesh>>,
    page_mesh_gate: Option<Res<ClodPageMeshGate>>,
    world: Res<VoxelWorld>,
) {
    let bubble = camera_query.single().ok().map(|camera_transform| {
        clod_near_field_bubble(&runtime, camera_transform, player_query.single().ok())
    });
    let ready_pages = ready_visible_page_keys(&tree, &page_query);
    for (entity, chunk_mesh, mut visibility, marker) in &mut chunk_query {
        let page_covers =
            chunk_covered_by_page(chunk_mesh.chunk_position, &ready_pages, &tree);
        if live_chunk_hidden_by_clod(
            chunk_footprint(chunk_mesh.chunk_position),
            bubble,
            page_covers,
        ) {
            if *visibility != Visibility::Hidden {
                *visibility = Visibility::Hidden;
            }
            if marker.is_none() {
                commands.entity(entity).insert(ClodPageOwnedChunk);
            }
            continue;
        }
        // Not owned by a page. Keep the live LOD0 terrain visible. While a recently
        // edited owned chunk re-meshes, hold its current (hidden) state so the page
        // stays up until the fresh LOD0 mesh lands (avoids a one-frame hole).
        let pending_restore = page_mesh_gate
            .as_deref()
            .is_some_and(|gate| gate.chunk_pending_restore(chunk_mesh.chunk_position))
            && world
                .get_chunk(chunk_mesh.chunk_position)
                .is_some_and(|chunk| chunk.is_dirty() || chunk.mesh_entity().is_none());
        if pending_restore {
            continue;
        }
        restore_clod_hidden_chunk(&mut commands, entity, &mut visibility, marker);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::build_queue::{ClodPageBuildStatus, ClodPageTree};
    use super::super::diagonal_polish::DiagonalPolishStats;
    use std::collections::HashSet;

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

    fn near_bubble() -> NearFieldBubble {
        NearFieldBubble {
            player_center: Some(Vec2::new(24.0, 24.0)),
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
    fn footprint_coverage_requires_full_chunk_containment() {
        let partial_parent = footprint(0.0, 0.0, 32.0, 32.0);
        let chunk = footprint(32.0, 32.0, 48.0, 48.0);
        assert!(!footprint_covers_chunk(partial_parent, chunk));
        let full_parent = footprint(0.0, 0.0, 64.0, 64.0);
        assert!(footprint_covers_chunk(full_parent, chunk));
    }

    #[test]
    fn clod_hides_live_chunks_only_when_a_page_covers_them_outside_the_near_field() {
        let chunk = footprint(16.0, 16.0, 32.0, 32.0);
        // Outside the near-field bubble AND covered by a ready, visible page -> page owns it.
        assert!(live_chunk_hidden_by_clod(chunk, Some(far_bubble()), true));
        // Outside the bubble but no page covers it -> keep live terrain visible (no hole).
        assert!(!live_chunk_hidden_by_clod(chunk, Some(far_bubble()), false));
        // Inside the near-field bubble -> always visible, even if a page exists.
        assert!(!live_chunk_hidden_by_clod(chunk, Some(near_bubble()), true));
    }

    #[test]
    fn clod_hides_covered_chunks_even_without_a_camera() {
        let chunk = footprint(16.0, 16.0, 32.0, 32.0);
        // No camera/bubble: a covering page still owns the chunk.
        assert!(live_chunk_hidden_by_clod(chunk, None, true));
        // No camera and no covering page: keep live terrain visible.
        assert!(!live_chunk_hidden_by_clod(chunk, None, false));
    }

    #[test]
    fn chunk_not_covered_by_partial_page_footprint() {
        let mut tree = ClodPageTree::default();
        tree.status = Some(ClodPageBuildStatus::Ready);
        tree.nodes_by_level = vec![vec![super::super::quadtree::ClodPageNode {
            level: 0,
            coord: (0, 0),
            footprint: footprint(0.0, 0.0, 32.0, 32.0),
            mesh: Default::default(),
            error_world: 0.0,
            low_benefit: false,
            polish: DiagonalPolishStats::default(),
        }]];
        let mut keys = HashSet::new();
        keys.insert(ClodPageNodeKey::new(0, (0, 0)));
        let chunk_pos = IVec3::new(2, 0, 2);
        assert!(!chunk_covered_by_page(chunk_pos, &keys, &tree));
        tree.nodes_by_level[0][0].footprint = footprint(0.0, 0.0, 64.0, 64.0);
        assert!(chunk_covered_by_page(chunk_pos, &keys, &tree));
    }

    #[test]
    fn mesh_gate_requires_ready_pages() {
        let chunk_pos = IVec3::new(3, 7, -2);
        let mut gate = ClodPageMeshGate::default();
        gate.owned_columns.insert(chunk_column(chunk_pos));

        gate.pages_ready = false;
        assert!(!gate.owns_chunk(chunk_pos));

        gate.pages_ready = true;
        assert!(gate.owns_chunk(chunk_pos));
    }
}
