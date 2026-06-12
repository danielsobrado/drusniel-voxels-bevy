//! Phase 5 Step 5: binary live-chunk/page terrain ownership.
//!
//! CLOD pages and live chunks are mutually exclusive owners of a terrain footprint.
//! Fresh LOD0 pages are built from the same main-surface chunk meshes as the live
//! chunks, so drawing both causes coplanar z-fighting. Binary ownership switch per
//! chunk footprint; complementary dither fade ONLY for stale (post-edit) geometry.

use bevy::prelude::*;

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::render::{ClodPageMeshTag, ClodPagesShow, ClodPagesShowMode};
use super::runtime::ClodPagesRuntime;
use super::selection::{
    ClodPageNodeKey, ClodPageSelectionIndex, NearFieldBubble, clod_near_field_bubble,
    near_field_intersects_footprint,
};
use super::types::PageFootprint;
use crate::constants::CHUNK_SIZE_F32;
use crate::gameplay::camera::controller::PlayerCamera;
use crate::gameplay::player::Player;
use crate::voxel::meshing::{ChunkMesh, WaterMesh};

const FOOTPRINT_EPSILON: f32 = 0.001;

#[derive(Component, Clone, Copy, Debug, Default)]
pub(crate) struct ClodPageOwnedChunk;

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

fn page_covers_chunk(page: PageFootprint, chunk: PageFootprint) -> bool {
    page.min_x <= chunk.min_x + FOOTPRINT_EPSILON
        && page.min_z <= chunk.min_z + FOOTPRINT_EPSILON
        && page.max_x + FOOTPRINT_EPSILON >= chunk.max_x
        && page.max_z + FOOTPRINT_EPSILON >= chunk.max_z
}

fn visible_page_covers_chunk(page_footprints: &[PageFootprint], chunk: PageFootprint) -> bool {
    page_footprints
        .iter()
        .any(|page| page_covers_chunk(*page, chunk))
}

fn chunk_owned_by_page(
    chunk: PageFootprint,
    bubble: NearFieldBubble,
    ready_visible_pages: &[PageFootprint],
) -> bool {
    !near_field_intersects_footprint(chunk, bubble)
        && visible_page_covers_chunk(ready_visible_pages, chunk)
}

fn ready_visible_page_footprints(
    runtime: &ClodPagesRuntime,
    show: &ClodPagesShow,
    tree: &ClodPageTree,
    index: &ClodPageSelectionIndex,
    page_query: &Query<(&ClodPageMeshTag, &Visibility)>,
) -> Vec<PageFootprint> {
    if !runtime.enabled
        || show.0 == ClodPagesShowMode::Off
        || !matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready))
    {
        return Vec::new();
    }

    page_query
        .iter()
        .filter_map(|(tag, visibility)| {
            (*visibility == Visibility::Visible)
                .then(|| {
                    index
                        .node(ClodPageNodeKey::from(tag))
                        .map(|node| node.footprint)
                })
                .flatten()
        })
        .collect()
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
    index: Res<ClodPageSelectionIndex>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    player_query: Query<&Transform, (With<Player>, Without<PlayerCamera>)>,
    page_query: Query<(&ClodPageMeshTag, &Visibility)>,
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
    let ready_pages = ready_visible_page_footprints(&runtime, &show, &tree, &index, &page_query);
    if ready_pages.is_empty() && !*had_owned_chunks {
        return;
    }

    let mut any_owned_chunks = false;
    for (entity, chunk_mesh, mut visibility, marker) in &mut chunk_query {
        let chunk_footprint = chunk_footprint(chunk_mesh.chunk_position);
        if chunk_owned_by_page(chunk_footprint, bubble, &ready_pages) {
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
