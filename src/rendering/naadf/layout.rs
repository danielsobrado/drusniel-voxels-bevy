use bevy::prelude::*;

use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_U32, CHUNK_VOLUME};

pub const VOXELS_PER_BLOCK_AXIS: u32 = 4;
pub const BLOCKS_PER_CHUNK_AXIS: u32 = 4;
pub const VOXELS_PER_CHUNK_AXIS: u32 = CHUNK_SIZE_U32;
pub const VOXELS_PER_BLOCK: u32 = 64;
pub const BLOCKS_PER_CHUNK: u32 = 64;
pub const VOXELS_PER_CHUNK: u32 = CHUNK_VOLUME as u32;

const NODE_STATE_SHIFT: u32 = 30;
const NODE_PAYLOAD_MASK: u32 = (1 << NODE_STATE_SHIFT) - 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum NaadfNodeState {
    UniformEmpty = 0,
    UniformFull = 1,
    Children = 2,
    Reserved = 3,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PackedNaadfNode(pub u32);

impl PackedNaadfNode {
    pub fn new(state: NaadfNodeState, payload: u32) -> Self {
        Self(((state as u32) << NODE_STATE_SHIFT) | (payload & NODE_PAYLOAD_MASK))
    }

    pub fn state(self) -> NaadfNodeState {
        match self.0 >> NODE_STATE_SHIFT {
            0 => NaadfNodeState::UniformEmpty,
            1 => NaadfNodeState::UniformFull,
            2 => NaadfNodeState::Children,
            _ => NaadfNodeState::Reserved,
        }
    }

    pub fn payload(self) -> u32 {
        self.0 & NODE_PAYLOAD_MASK
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NaadfAxisDirection {
    NegX,
    PosX,
    NegY,
    PosY,
    NegZ,
    PosZ,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DirectionalBounds {
    pub neg_x: u8,
    pub pos_x: u8,
    pub neg_y: u8,
    pub pos_y: u8,
    pub neg_z: u8,
    pub pos_z: u8,
}

impl DirectionalBounds {
    pub const fn empty_block() -> Self {
        Self {
            neg_x: VOXELS_PER_BLOCK_AXIS as u8,
            pos_x: VOXELS_PER_BLOCK_AXIS as u8,
            neg_y: VOXELS_PER_BLOCK_AXIS as u8,
            pos_y: VOXELS_PER_BLOCK_AXIS as u8,
            neg_z: VOXELS_PER_BLOCK_AXIS as u8,
            pos_z: VOXELS_PER_BLOCK_AXIS as u8,
        }
    }

    pub const fn full_block() -> Self {
        Self {
            neg_x: 0,
            pos_x: 0,
            neg_y: 0,
            pos_y: 0,
            neg_z: 0,
            pos_z: 0,
        }
    }

    pub fn get(self, direction: NaadfAxisDirection) -> u8 {
        match direction {
            NaadfAxisDirection::NegX => self.neg_x,
            NaadfAxisDirection::PosX => self.pos_x,
            NaadfAxisDirection::NegY => self.neg_y,
            NaadfAxisDirection::PosY => self.pos_y,
            NaadfAxisDirection::NegZ => self.neg_z,
            NaadfAxisDirection::PosZ => self.pos_z,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfBlock {
    pub node: PackedNaadfNode,
    pub bounds: DirectionalBounds,
    pub occupancy_mask: u64,
    pub material_ids: [u16; VOXELS_PER_BLOCK as usize],
}

impl Default for NaadfBlock {
    fn default() -> Self {
        Self {
            node: PackedNaadfNode::new(NaadfNodeState::UniformEmpty, 0),
            bounds: DirectionalBounds::empty_block(),
            occupancy_mask: 0,
            material_ids: [0; VOXELS_PER_BLOCK as usize],
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfChunk {
    pub position: IVec3,
    pub node: PackedNaadfNode,
    pub blocks: Vec<NaadfBlock>,
    pub occupancy: [bool; CHUNK_VOLUME],
    pub material_ids: [u16; CHUNK_VOLUME],
}

impl NaadfChunk {
    pub fn is_occupied(&self, local: UVec3) -> bool {
        self.occupancy[voxel_index_in_chunk(local)]
    }

    pub fn material_id(&self, local: UVec3) -> u16 {
        self.material_ids[voxel_index_in_chunk(local)]
    }
}

pub fn voxel_index_in_chunk(local: UVec3) -> usize {
    debug_assert!(
        local.x < VOXELS_PER_CHUNK_AXIS
            && local.y < VOXELS_PER_CHUNK_AXIS
            && local.z < VOXELS_PER_CHUNK_AXIS
    );
    (local.x + local.y * VOXELS_PER_CHUNK_AXIS + local.z * VOXELS_PER_CHUNK_AXIS.pow(2)) as usize
}

pub fn block_index_in_chunk(block: UVec3) -> usize {
    debug_assert!(
        block.x < BLOCKS_PER_CHUNK_AXIS
            && block.y < BLOCKS_PER_CHUNK_AXIS
            && block.z < BLOCKS_PER_CHUNK_AXIS
    );
    (block.x + block.y * BLOCKS_PER_CHUNK_AXIS + block.z * BLOCKS_PER_CHUNK_AXIS.pow(2)) as usize
}

pub fn voxel_index_in_block(local: UVec3) -> usize {
    debug_assert!(
        local.x < VOXELS_PER_BLOCK_AXIS
            && local.y < VOXELS_PER_BLOCK_AXIS
            && local.z < VOXELS_PER_BLOCK_AXIS
    );
    (local.x + local.y * VOXELS_PER_BLOCK_AXIS + local.z * VOXELS_PER_BLOCK_AXIS.pow(2)) as usize
}

pub fn block_coord_for_voxel(local: UVec3) -> UVec3 {
    local / VOXELS_PER_BLOCK_AXIS
}

pub fn local_coord_in_block(local: UVec3) -> UVec3 {
    UVec3::new(
        local.x % VOXELS_PER_BLOCK_AXIS,
        local.y % VOXELS_PER_BLOCK_AXIS,
        local.z % VOXELS_PER_BLOCK_AXIS,
    )
}

pub fn chunk_world_origin(chunk_pos: IVec3) -> IVec3 {
    chunk_pos * CHUNK_SIZE as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;

    #[test]
    fn indexing_matches_chunk_layout() {
        for z in [0, 1, 15] {
            for y in [0, 1, 15] {
                for x in [0, 1, 15] {
                    let local = UVec3::new(x, y, z);
                    assert_eq!(
                        voxel_index_in_chunk(local),
                        Chunk::index(x as usize, y as usize, z as usize)
                    );
                }
            }
        }
    }

    #[test]
    fn packed_node_round_trips_state_and_payload() {
        for state in [
            NaadfNodeState::UniformEmpty,
            NaadfNodeState::UniformFull,
            NaadfNodeState::Children,
        ] {
            let node = PackedNaadfNode::new(state, 0x12345);
            assert_eq!(node.state(), state);
            assert_eq!(node.payload(), 0x12345);
        }
    }

    #[test]
    fn wgsl_constants_match_rust_layout() {
        let common = include_str!("../../../assets/shaders/naadf/common.wgsl");

        assert_eq!(
            wgsl_u32_const(common, "NAADF_VOXELS_PER_BLOCK_AXIS"),
            VOXELS_PER_BLOCK_AXIS
        );
        assert_eq!(
            wgsl_u32_const(common, "NAADF_BLOCKS_PER_CHUNK_AXIS"),
            BLOCKS_PER_CHUNK_AXIS
        );
        assert_eq!(
            wgsl_u32_const(common, "NAADF_VOXELS_PER_CHUNK_AXIS"),
            VOXELS_PER_CHUNK_AXIS
        );
        assert_eq!(
            wgsl_u32_const(common, "NAADF_VOXELS_PER_BLOCK"),
            VOXELS_PER_BLOCK
        );
        assert_eq!(
            wgsl_u32_const(common, "NAADF_BLOCKS_PER_CHUNK"),
            BLOCKS_PER_CHUNK
        );
        assert_eq!(
            wgsl_u32_const(common, "NAADF_VOXELS_PER_CHUNK"),
            VOXELS_PER_CHUNK
        );
        assert_eq!(wgsl_u32_const(common, "NAADF_RAW_VOXEL_RECORD_BYTES"), 4);
        assert_eq!(wgsl_u32_const(common, "NAADF_NODE_STATE_SHIFT"), 30);
    }

    #[test]
    fn wgsl_layout_imports_common_shader() {
        let layout = include_str!("../../../assets/shaders/naadf/layout.wgsl");
        let shader = bevy_shader::Shader::from_wgsl(layout, "shaders/naadf/layout.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/common.wgsl"
            )
        }));
    }

    #[test]
    fn wgsl_ray_trace_imports_layout_and_declares_dense_traversal() {
        let ray_trace = include_str!("../../../assets/shaders/naadf/ray_trace.wgsl");
        let shader = bevy_shader::Shader::from_wgsl(ray_trace, "shaders/naadf/ray_trace.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/layout.wgsl"
            )
        }));
        assert!(ray_trace.contains("fn trace_naadf_dense_debug"));
        assert!(ray_trace.contains("naadf_voxel_records"));
        assert!(ray_trace.contains("naadf_material_records"));
        assert!(ray_trace.contains("fn naadf_step_axis"));
        assert!(ray_trace.contains("fn naadf_ray_chunk_entry"));
    }

    #[test]
    fn wgsl_block_builder_imports_layout_and_uses_raw_voxels() {
        let build_blocks = include_str!("../../../assets/shaders/naadf/build_blocks.wgsl");
        let shader =
            bevy_shader::Shader::from_wgsl(build_blocks, "shaders/naadf/build_blocks.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/layout.wgsl"
            )
        }));
        assert!(build_blocks.contains("@compute"));
        assert!(build_blocks.contains("naadf_raw_voxel_records"));
        assert!(build_blocks.contains("naadf_block_records"));
        assert!(build_blocks.contains("NAADF_NODE_UNIFORM_FULL"));
        assert!(build_blocks.contains("uniform_material"));
    }

    #[test]
    fn wgsl_bounds_builder_writes_directional_bounds() {
        let build_bounds = include_str!("../../../assets/shaders/naadf/build_bounds.wgsl");
        let shader =
            bevy_shader::Shader::from_wgsl(build_bounds, "shaders/naadf/build_bounds.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/common.wgsl"
            )
        }));
        assert!(build_bounds.contains("@compute"));
        assert!(build_bounds.contains("naadf_mask_bit_is_set"));
        assert!(build_bounds.contains("naadf_pack_bounds_xy"));
        assert!(build_bounds.contains("naadf_pack_bounds_z"));
    }

    #[test]
    fn wgsl_lighting_queries_import_ray_trace_for_sun_visibility() {
        let lighting = include_str!("../../../assets/shaders/naadf/lighting_queries.wgsl");
        let shader =
            bevy_shader::Shader::from_wgsl(lighting, "shaders/naadf/lighting_queries.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/ray_trace.wgsl"
            )
        }));
        assert!(lighting.contains("fn naadf_sun_visibility"));
        assert!(lighting.contains("fn naadf_terrain_ao_visibility"));
        assert!(lighting.contains("fn naadf_contact_shadow_visibility"));
        assert!(lighting.contains("trace_naadf_dense_debug"));
    }

    #[test]
    fn wgsl_radiance_shader_routes_probe_rays_through_backend_abstraction() {
        let radiance = include_str!("../../../assets/shaders/radiance_cascades.wgsl");

        assert!(radiance.contains("voxel_backend: u32"));
        assert!(radiance.contains("const GI_BACKEND_NAADF"));
        assert!(radiance.contains("fn trace_gi_backend"));
        assert!(!radiance.contains("trace_naadf_gi_fallback"));
        assert!(radiance.contains("let hit = trace_gi_backend"));
    }

    #[test]
    fn wgsl_debug_trace_rays_has_ray_count_guard() {
        let debug_trace = include_str!("../../../assets/shaders/naadf/debug_trace_rays.wgsl");

        assert!(debug_trace.contains("ray_count"));
        assert!(debug_trace.contains("if index >= naadf_debug_trace_params.ray_count"));
    }

    #[test]
    fn wgsl_debug_visualize_declares_ray_step_heatmap() {
        let debug_visualize = include_str!("../../../assets/shaders/naadf/debug_visualize.wgsl");

        assert!(debug_visualize.contains("@compute"));
        assert!(debug_visualize.contains("naadf_ray_step_heatmap_inputs"));
        assert!(debug_visualize.contains("naadf_ray_step_heatmap_output"));
        assert!(debug_visualize.contains("fn naadf_ray_step_heatmap"));
    }

    #[test]
    fn wgsl_first_hit_declares_preview_material_path() {
        let first_hit = include_str!("../../../assets/shaders/naadf/first_hit.wgsl");
        let shader = bevy_shader::Shader::from_wgsl(first_hit, "shaders/naadf/first_hit.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/ray_trace.wgsl"
            )
        }));
        assert!(first_hit.contains("fn preview_naadf_first_hit"));
        assert!(first_hit.contains("fn naadf_preview_material_color"));
    }

    #[test]
    fn wgsl_preview_composite_declares_modes() {
        let composite = include_str!("../../../assets/shaders/naadf/preview_composite.wgsl");

        assert!(composite.contains("NAADF_PREVIEW_FULLSCREEN"));
        assert!(composite.contains("NAADF_PREVIEW_SPLIT_VIEW"));
        assert!(composite.contains("NAADF_PREVIEW_PICTURE_IN_PICTURE"));
        assert!(composite.contains("fn naadf_preview_composite_color"));
    }

    #[test]
    fn wgsl_temporal_accumulation_declares_blend_and_reset() {
        let temporal = include_str!("../../../assets/shaders/naadf/temporal_accumulation.wgsl");

        assert!(temporal.contains("NaadfTemporalAccumulationParams"));
        assert!(temporal.contains("reset_history"));
        assert!(temporal.contains("fn naadf_temporal_accumulate"));
        assert!(temporal.contains("motion_valid"));
    }

    #[test]
    fn wgsl_spatial_resampling_declares_edge_aware_helpers() {
        let spatial = include_str!("../../../assets/shaders/naadf/spatial_resampling.wgsl");

        assert!(spatial.contains("NaadfSpatialResamplingParams"));
        assert!(spatial.contains("fn naadf_spatial_weight"));
        assert!(spatial.contains("fn naadf_spatial_accumulate"));
        assert!(spatial.contains("depth_sigma"));
        assert!(spatial.contains("normal_sigma"));
    }

    fn wgsl_u32_const(source: &str, name: &str) -> u32 {
        let prefix = format!("const {name}: u32 = ");
        let line = source
            .lines()
            .find(|line| line.trim_start().starts_with(&prefix))
            .unwrap_or_else(|| panic!("missing WGSL const {name}"));
        let value = line
            .trim_start()
            .trim_start_matches(&prefix)
            .trim_end_matches(';')
            .trim_end_matches('u');
        u32::from_str_radix(
            value.trim_start_matches("0x"),
            if value.starts_with("0x") { 16 } else { 10 },
        )
        .unwrap_or_else(|err| panic!("invalid WGSL const {name}: {err}"))
    }
}
