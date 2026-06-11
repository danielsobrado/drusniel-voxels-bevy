//! Runtime occlusion culling using chunk face connectivity.
//!
//! Performs BFS traversal from the camera's chunk through the face visibility
//! graph to determine which chunks are potentially visible. Chunks that cannot
//! be reached through connected faces are occluded and can be culled.

use crate::camera::controller::PlayerCamera;
use crate::config::loader::{ConfigError, load_config};
use crate::constants::CHUNK_SIZE_F32;
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::voxel::chunk::FaceVisibility;
use crate::voxel::enclosure::{EnclosureMode, EnclosureState};
use crate::voxel::lod::LodSettings;
use crate::voxel::octree::{OctreeAabb, ViewFrustum};
use crate::voxel::skirt::ChunkFace;
use crate::voxel::world::VoxelWorld;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use serde::Deserialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Instant;

pub const OCCLUSION_CONFIG_PATH: &str = "assets/config/occlusion.yaml";

/// Resource storing the set of potentially visible chunks from the camera.
#[derive(Resource, Default)]
pub struct VisibleChunks {
    /// Chunks that passed BFS visibility check.
    pub chunks: HashSet<IVec3>,
    /// Treat every chunk as visible (BFS overflow or missing camera/frustum).
    pub fail_open: bool,
    /// Number of BFS states visited by the last update.
    pub last_visited_count: usize,
    /// Whether the last BFS hit the configured cap and failed open.
    pub last_overflow: bool,
    /// Duration of the last BFS in microseconds.
    pub last_bfs_duration_micros: u64,
    /// Depth budget used by the last BFS.
    pub last_depth_budget: u32,
}

impl VisibleChunks {
    /// Check if a chunk is potentially visible.
    #[inline]
    pub fn is_visible(&self, chunk_pos: IVec3) -> bool {
        self.fail_open || self.chunks.contains(&chunk_pos)
    }
}

/// Configuration for occlusion culling.
#[derive(Resource)]
pub struct OcclusionConfig {
    /// Master enable/disable switch loaded from config or runtime UI.
    pub enabled: bool,
    /// Keep occlusion restricted to detected enclosed spaces.
    pub enclosure_gating_enabled: bool,
    /// Force-disable enclosure culling for debug comparisons.
    pub force_disabled: bool,
    /// Extra depth beyond the active terrain render distance.
    pub depth_margin_chunks: u32,
    /// Maximum BFS states to visit before failing open.
    pub max_visited_chunks: usize,
    /// Chunk dilation used by the frustum traversal gate.
    pub frustum_dilation_chunks: u32,
    /// Number of chunks to probe upward for sky access in the enclosure heuristic.
    pub sky_probe_chunks: u32,
    /// Seconds a candidate enclosure mode must hold before switching.
    pub enclosure_hysteresis_secs: f32,
    /// How often to update visibility (in seconds).
    pub update_interval: f32,
}

impl Default for OcclusionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            enclosure_gating_enabled: true,
            force_disabled: false,
            depth_margin_chunks: 2,
            max_visited_chunks: 8000,
            frustum_dilation_chunks: 1,
            sky_probe_chunks: 8,
            enclosure_hysteresis_secs: 0.5,
            update_interval: 0.1, // 10Hz update
        }
    }
}

impl OcclusionConfig {
    pub fn load_or_default() -> Self {
        load_occlusion_config().unwrap_or_else(|err| {
            warn!("Failed to load {OCCLUSION_CONFIG_PATH}: {err}; using occlusion defaults");
            Self::default()
        })
    }

    /// Whether enclosure detection (and thus occlusion culling) may run at all.
    pub fn gating_allowed(&self) -> bool {
        self.enabled && self.enclosure_gating_enabled && !self.force_disabled
    }

    /// Whether occlusion culling should run right now, given the detected enclosure mode.
    pub fn is_active(&self, mode: EnclosureMode) -> bool {
        self.gating_allowed() && mode == EnclosureMode::Enclosed
    }
}

#[derive(Deserialize)]
struct OcclusionConfigFile {
    occlusion: OcclusionConfigYaml,
}

#[derive(Deserialize)]
#[serde(default)]
struct OcclusionConfigYaml {
    enabled: bool,
    update_interval_secs: f32,
    depth_margin_chunks: u32,
    max_visited_chunks: usize,
    frustum_dilation_chunks: u32,
    enclosure: OcclusionEnclosureConfigYaml,
}

#[derive(Deserialize)]
#[serde(default)]
struct OcclusionEnclosureConfigYaml {
    sky_probe_chunks: u32,
    hysteresis_secs: f32,
}

impl Default for OcclusionConfigYaml {
    fn default() -> Self {
        let defaults = OcclusionConfig::default();
        Self {
            enabled: defaults.enabled,
            update_interval_secs: defaults.update_interval,
            depth_margin_chunks: defaults.depth_margin_chunks,
            max_visited_chunks: defaults.max_visited_chunks,
            frustum_dilation_chunks: defaults.frustum_dilation_chunks,
            enclosure: OcclusionEnclosureConfigYaml::default(),
        }
    }
}

impl Default for OcclusionEnclosureConfigYaml {
    fn default() -> Self {
        let defaults = OcclusionConfig::default();
        Self {
            sky_probe_chunks: defaults.sky_probe_chunks,
            hysteresis_secs: defaults.enclosure_hysteresis_secs,
        }
    }
}

impl OcclusionConfigYaml {
    fn into_config(self) -> OcclusionConfig {
        OcclusionConfig {
            enabled: self.enabled,
            update_interval: self.update_interval_secs.max(0.0),
            depth_margin_chunks: self.depth_margin_chunks,
            max_visited_chunks: self.max_visited_chunks.max(1),
            frustum_dilation_chunks: self.frustum_dilation_chunks,
            sky_probe_chunks: self.enclosure.sky_probe_chunks.max(1),
            enclosure_hysteresis_secs: self.enclosure.hysteresis_secs.max(0.0),
            ..OcclusionConfig::default()
        }
    }
}

pub fn load_occlusion_config() -> Result<OcclusionConfig, ConfigError> {
    let config_file: OcclusionConfigFile = load_config(OCCLUSION_CONFIG_PATH)?;
    Ok(config_file.occlusion.into_config())
}

/// Entry in the BFS queue.
struct BfsEntry {
    chunk_pos: IVec3,
    /// Face we entered through (None for camera chunk).
    entry_face: Option<ChunkFace>,
    depth: u32,
    directions_used: u8,
}

/// Timer for throttling visibility updates.
#[derive(Resource, Default)]
pub struct OcclusionUpdateTimer {
    pub elapsed: f32,
}

/// Perform BFS from camera chunk to find all potentially visible chunks.
///
/// The BFS result depends on the camera frustum (and thus rotation), so it is
/// recomputed every `update_interval` tick while active rather than cached.
pub fn update_visible_chunks_system(
    world: Res<VoxelWorld>,
    camera_query: Query<(&GlobalTransform, &Projection), With<PlayerCamera>>,
    mut visible: ResMut<VisibleChunks>,
    config: Res<OcclusionConfig>,
    enclosure: Res<EnclosureState>,
    lod_settings: Res<LodSettings>,
    time: Res<Time>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut timer: ResMut<OcclusionUpdateTimer>,
    mut was_active: Local<bool>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Visible Chunks");
    if !config.is_active(enclosure.mode) {
        *was_active = false;
        return;
    }

    // Recompute immediately on activation so the culler never applies a result
    // from a previous activation (or an empty first-run set); otherwise throttle.
    let just_activated = !*was_active;
    *was_active = true;
    timer.elapsed += time.delta_secs();
    if !just_activated && timer.elapsed < config.update_interval {
        return;
    }
    timer.elapsed = 0.0;

    let Ok((camera_transform, projection)) = camera_query.single() else {
        visible_fail_open(&mut visible);
        return;
    };

    let camera_pos = camera_transform.translation();
    let camera_chunk = VoxelWorld::world_to_chunk(camera_pos.floor().as_ivec3());

    let Some(frustum) = camera_frustum(camera_transform, projection) else {
        visible_fail_open(&mut visible);
        return;
    };
    let max_depth =
        depth_from_render_distance(lod_settings.cull_distance, config.depth_margin_chunks);
    let started = Instant::now();
    let result = bfs_visible_chunks(
        &world,
        camera_chunk,
        max_depth,
        &frustum,
        config.frustum_dilation_chunks,
        config.max_visited_chunks,
    );
    visible.last_bfs_duration_micros = started.elapsed().as_micros() as u64;
    visible.last_visited_count = result.visited_count;
    visible.last_overflow = result.overflow;
    visible.last_depth_budget = max_depth;
    visible.fail_open = result.overflow;
    if result.overflow {
        trace!(
            "Occlusion BFS overflow at {} chunks / {} states; failing open",
            result.chunks.len(),
            result.visited_count
        );
        visible.chunks.clear();
    } else {
        visible.chunks = result.chunks;
    }
}

fn visible_fail_open(visible: &mut VisibleChunks) {
    visible.chunks.clear();
    visible.fail_open = true;
    visible.last_overflow = false;
    visible.last_visited_count = 0;
    visible.last_bfs_duration_micros = 0;
    visible.last_depth_budget = 0;
}

/// BFS traversal through chunk face connectivity graph.
fn bfs_visible_chunks(
    world: &VoxelWorld,
    start: IVec3,
    max_depth: u32,
    frustum: &ViewFrustum,
    frustum_dilation_chunks: u32,
    max_visited_chunks: usize,
) -> BfsVisibleChunksResult {
    let mut chunks = HashSet::new();
    // Dominance dedup per (chunk, entry face): a state is redundant when an
    // already-expanded state at the same chunk/face used a subset of its travel
    // directions (it could reach everything the new state can). The directional
    // guard keeps masks to one bit per axis, so these lists stay tiny.
    let mut expanded_masks: HashMap<(IVec3, u8), Vec<u8>> = HashMap::new();
    let mut frustum_verdicts: HashMap<IVec3, bool> = HashMap::new();
    let mut queue = VecDeque::new();
    let mut visited_count = 0usize;
    // Cost ceiling on states so a pathological connectivity graph cannot stall
    // the frame even when the distinct-chunk cap is not yet exceeded.
    let max_visited_states = max_visited_chunks.saturating_mul(8);

    queue.push_back(BfsEntry {
        chunk_pos: start,
        entry_face: None,
        depth: 0,
        directions_used: 0,
    });

    while let Some(entry) = queue.pop_front() {
        let face_key = entry.entry_face.map(|face| face as u8).unwrap_or(6);
        let masks = expanded_masks
            .entry((entry.chunk_pos, face_key))
            .or_default();
        if masks
            .iter()
            .any(|&mask| mask & entry.directions_used == mask)
        {
            continue;
        }
        masks.push(entry.directions_used);
        visited_count += 1;

        chunks.insert(entry.chunk_pos);
        if chunks.len() > max_visited_chunks || visited_count > max_visited_states {
            return BfsVisibleChunksResult {
                chunks,
                visited_count,
                overflow: true,
            };
        }

        if entry.depth >= max_depth {
            continue;
        }

        // Get chunk's face visibility
        let face_vis = match world.get_chunk(entry.chunk_pos) {
            Some(chunk) => chunk.face_visibility(),
            None => {
                // Non-existent chunks are treated as fully transparent
                // (allows seeing through unloaded areas)
                FaceVisibility::all_connected()
            }
        };

        // Try to propagate to neighbors through connected faces
        for (dir, exit_face, neighbor_entry_face) in NEIGHBOR_DIRECTIONS {
            if entry.directions_used & direction_mask(exit_face.opposite()) != 0 {
                continue;
            }

            // Check if we can see through from entry face to exit face
            let can_propagate = match entry.entry_face {
                None => true, // Camera chunk - can exit through any face
                Some(entry_face) => face_vis.can_see_through(entry_face, exit_face),
            };
            if !can_propagate {
                continue;
            }

            let neighbor_pos = entry.chunk_pos + dir;
            let outside = *frustum_verdicts.entry(neighbor_pos).or_insert_with(|| {
                chunk_outside_frustum(neighbor_pos, frustum, frustum_dilation_chunks)
            });
            if outside {
                continue;
            }

            let directions_used = entry.directions_used | direction_mask(exit_face);
            let dominated = expanded_masks
                .get(&(neighbor_pos, neighbor_entry_face as u8))
                .is_some_and(|masks| masks.iter().any(|&mask| mask & directions_used == mask));
            if dominated {
                continue;
            }

            queue.push_back(BfsEntry {
                chunk_pos: neighbor_pos,
                entry_face: Some(neighbor_entry_face),
                depth: entry.depth + 1,
                directions_used,
            });
        }
    }

    BfsVisibleChunksResult {
        chunks,
        visited_count,
        overflow: false,
    }
}

struct BfsVisibleChunksResult {
    chunks: HashSet<IVec3>,
    visited_count: usize,
    overflow: bool,
}

fn camera_frustum(transform: &GlobalTransform, projection: &Projection) -> Option<ViewFrustum> {
    match projection {
        Projection::Custom(_) => None,
        _ => {
            let view_from_world = transform.to_matrix().inverse();
            let clip_from_view = projection.get_clip_from_view();
            Some(ViewFrustum::from_view_projection(
                &(clip_from_view * view_from_world),
            ))
        }
    }
}

fn chunk_outside_frustum(
    chunk_pos: IVec3,
    frustum: &ViewFrustum,
    frustum_dilation_chunks: u32,
) -> bool {
    let dilation = frustum_dilation_chunks as f32 * CHUNK_SIZE_F32;
    let min = chunk_pos.as_vec3() * CHUNK_SIZE_F32 - Vec3::splat(dilation);
    let max = min + Vec3::splat(CHUNK_SIZE_F32 + dilation * 2.0);
    OctreeAabb::new(min, max).outside_frustum(frustum)
}

pub(crate) fn depth_from_render_distance(render_distance: f32, margin_chunks: u32) -> u32 {
    (render_distance.max(0.0) / CHUNK_SIZE_F32).ceil() as u32 + margin_chunks
}

fn direction_mask(face: ChunkFace) -> u8 {
    1 << (face as u8)
}

/// Direction vector, exit face from current chunk, entry face into neighbor chunk.
const NEIGHBOR_DIRECTIONS: [(IVec3, ChunkFace, ChunkFace); 6] = [
    (IVec3::NEG_X, ChunkFace::NegX, ChunkFace::PosX),
    (IVec3::X, ChunkFace::PosX, ChunkFace::NegX),
    (IVec3::NEG_Y, ChunkFace::NegY, ChunkFace::PosY),
    (IVec3::Y, ChunkFace::PosY, ChunkFace::NegY),
    (IVec3::NEG_Z, ChunkFace::NegZ, ChunkFace::PosZ),
    (IVec3::Z, ChunkFace::PosZ, ChunkFace::NegZ),
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;

    #[test]
    fn directional_mask_rejects_reverse_axis() {
        let used = direction_mask(ChunkFace::PosX);
        assert_ne!(used & direction_mask(ChunkFace::NegX.opposite()), 0);
        assert_eq!(used & direction_mask(ChunkFace::PosY.opposite()), 0);
    }

    #[test]
    fn depth_budget_comes_from_render_distance_and_margin() {
        assert_eq!(depth_from_render_distance(320.0, 2), 22);
        assert_eq!(depth_from_render_distance(0.0, 2), 2);
        assert_eq!(depth_from_render_distance(16.1, 1), 3);
    }

    #[test]
    fn bfs_chunk_cap_counts_distinct_chunks_not_states() {
        // All chunks missing -> fully connected; depth 2 reaches at most 25
        // distinct chunks while visiting more states than that. The cap must
        // bound distinct chunks, so this run may not overflow.
        let world = VoxelWorld::new(IVec3::new(8, 8, 8));
        let frustum = ViewFrustum {
            planes: [Vec4::new(0.0, 0.0, 0.0, 1.0); 6],
        };
        let result = bfs_visible_chunks(&world, IVec3::splat(4), 2, &frustum, 1, 25);
        assert!(!result.overflow);
        assert!(result.chunks.len() <= 25);
        assert!(result.visited_count >= result.chunks.len());
    }

    #[test]
    fn bfs_overflow_fails_open_signal() {
        let mut world = VoxelWorld::new(IVec3::new(3, 3, 3));
        world.insert_chunk(Chunk::new(IVec3::ONE));
        let frustum = ViewFrustum {
            planes: [Vec4::new(0.0, 0.0, 0.0, 1.0); 6],
        };
        let result = bfs_visible_chunks(&world, IVec3::ONE, 4, &frustum, 1, 1);
        assert!(result.overflow);
    }
}
