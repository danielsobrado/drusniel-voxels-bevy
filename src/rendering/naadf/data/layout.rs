use bevy::prelude::*;

use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_U32, CHUNK_VOLUME};

/// Bit offset for the -X directional skip distance inside a packed bounds word.
/// Layout matches cg-tuwien/NAADF `boundsCommon.fxh`: `-X|+X|-Y|+Y|-Z|+Z`, 2 bits each.
pub const BOUND_OFFSET_NEG_X: u32 = 0;
pub const BOUND_OFFSET_POS_X: u32 = 2;
pub const BOUND_OFFSET_NEG_Y: u32 = 4;
pub const BOUND_OFFSET_POS_Y: u32 = 6;
pub const BOUND_OFFSET_NEG_Z: u32 = 8;
pub const BOUND_OFFSET_POS_Z: u32 = 10;
pub const BOUND_FIELD_MASK: u32 = 0b11;
pub const BOUND_FIELD_MAX: u8 = 3;

pub const CHUNK_BOUND_OFFSET_NEG_X: u32 = 0;
pub const CHUNK_BOUND_OFFSET_POS_X: u32 = 5;
pub const CHUNK_BOUND_OFFSET_NEG_Y: u32 = 10;
pub const CHUNK_BOUND_OFFSET_POS_Y: u32 = 15;
pub const CHUNK_BOUND_OFFSET_NEG_Z: u32 = 20;
pub const CHUNK_BOUND_OFFSET_POS_Z: u32 = 25;
pub const CHUNK_BOUND_FIELD_MASK: u32 = 0b1_1111;
pub const CHUNK_BOUND_FIELD_MAX: u8 = 31;

/// 6 directional skip distances packed as 2-bit fields (range 0..=3 per axis).
/// `0` means "the cell itself blocks the ray in this direction"; `3` means
/// "you can advance 3 cells in this direction before the safe envelope ends."
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct PackedDirectionalBounds2Bit(pub u16);

impl PackedDirectionalBounds2Bit {
    pub const fn new(neg_x: u8, pos_x: u8, neg_y: u8, pos_y: u8, neg_z: u8, pos_z: u8) -> Self {
        let raw = ((neg_x & 0b11) as u16) << BOUND_OFFSET_NEG_X
            | ((pos_x & 0b11) as u16) << BOUND_OFFSET_POS_X
            | ((neg_y & 0b11) as u16) << BOUND_OFFSET_NEG_Y
            | ((pos_y & 0b11) as u16) << BOUND_OFFSET_POS_Y
            | ((neg_z & 0b11) as u16) << BOUND_OFFSET_NEG_Z
            | ((pos_z & 0b11) as u16) << BOUND_OFFSET_POS_Z;
        Self(raw)
    }

    pub const fn zero() -> Self {
        Self(0)
    }

    pub const fn saturated() -> Self {
        Self::new(
            BOUND_FIELD_MAX,
            BOUND_FIELD_MAX,
            BOUND_FIELD_MAX,
            BOUND_FIELD_MAX,
            BOUND_FIELD_MAX,
            BOUND_FIELD_MAX,
        )
    }

    pub fn get(self, direction: NaadfAxisDirection) -> u8 {
        self.get_at_offset(bound_offset_for(direction))
    }

    pub const fn get_at_offset(self, offset: u32) -> u8 {
        ((self.0 >> offset) & BOUND_FIELD_MASK as u16) as u8
    }

    pub fn add_one(&mut self, offset: u32) {
        let cur = self.get_at_offset(offset);
        if cur < BOUND_FIELD_MAX {
            self.0 += 1u16 << offset;
        }
    }
}

/// 6 directional chunk-skip distances packed as 5-bit fields (range 0..=31).
/// This mirrors upstream's chunk-level field width while keeping the chunk
/// record explicit rather than overloading the node payload.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct PackedDirectionalBounds5Bit(pub u32);

impl PackedDirectionalBounds5Bit {
    pub const fn new(neg_x: u8, pos_x: u8, neg_y: u8, pos_y: u8, neg_z: u8, pos_z: u8) -> Self {
        let raw = ((neg_x & CHUNK_BOUND_FIELD_MASK as u8) as u32) << CHUNK_BOUND_OFFSET_NEG_X
            | ((pos_x & CHUNK_BOUND_FIELD_MASK as u8) as u32) << CHUNK_BOUND_OFFSET_POS_X
            | ((neg_y & CHUNK_BOUND_FIELD_MASK as u8) as u32) << CHUNK_BOUND_OFFSET_NEG_Y
            | ((pos_y & CHUNK_BOUND_FIELD_MASK as u8) as u32) << CHUNK_BOUND_OFFSET_POS_Y
            | ((neg_z & CHUNK_BOUND_FIELD_MASK as u8) as u32) << CHUNK_BOUND_OFFSET_NEG_Z
            | ((pos_z & CHUNK_BOUND_FIELD_MASK as u8) as u32) << CHUNK_BOUND_OFFSET_POS_Z;
        Self(raw)
    }

    pub const fn zero() -> Self {
        Self(0)
    }

    pub fn get_at_offset(self, offset: u32) -> u8 {
        ((self.0 >> offset) & CHUNK_BOUND_FIELD_MASK) as u8
    }

    pub fn add_one(&mut self, offset: u32) {
        let cur = self.get_at_offset(offset);
        if cur < CHUNK_BOUND_FIELD_MAX {
            self.0 += 1u32 << offset;
        }
    }
}

pub const fn bound_offset_for(direction: NaadfAxisDirection) -> u32 {
    match direction {
        NaadfAxisDirection::NegX => BOUND_OFFSET_NEG_X,
        NaadfAxisDirection::PosX => BOUND_OFFSET_POS_X,
        NaadfAxisDirection::NegY => BOUND_OFFSET_NEG_Y,
        NaadfAxisDirection::PosY => BOUND_OFFSET_POS_Y,
        NaadfAxisDirection::NegZ => BOUND_OFFSET_NEG_Z,
        NaadfAxisDirection::PosZ => BOUND_OFFSET_POS_Z,
    }
}

pub const VOXELS_PER_BLOCK_AXIS: u32 = 4;
pub const BLOCKS_PER_CHUNK_AXIS: u32 = 4;
pub const VOXELS_PER_CHUNK_AXIS: u32 = CHUNK_SIZE_U32;
pub const VOXELS_PER_BLOCK: u32 = 64;
pub const BLOCKS_PER_CHUNK: u32 = 64;
pub const VOXELS_PER_CHUNK: u32 = CHUNK_VOLUME as u32;
pub const MIP_LEVEL_COUNT: u32 = 5;
pub const MIP_LEVEL_AXES: [u32; MIP_LEVEL_COUNT as usize] = [16, 8, 4, 2, 1];
pub const MIP_LEVEL_CELL_COUNTS: [u32; MIP_LEVEL_COUNT as usize] = [4096, 512, 64, 8, 1];
pub const MIP_LEVEL_OFFSETS: [u32; MIP_LEVEL_COUNT as usize] = [0, 4096, 4608, 4672, 4680];
pub const MIP_CELLS_PER_CHUNK: u32 = 4681;

pub const TRAVERSAL_RECORD_STATE_SHIFT: u32 = 30;
pub const TRAVERSAL_RECORD_THIN_OR_HOLE_BIT: u32 = 1 << 29;
pub const TRAVERSAL_RECORD_CHILD_MASK_MASK: u32 = 0xff;
pub const PAYLOAD_RECORD_MATERIAL_MASK: u32 = 0x0000_ffff;
pub const MIP_BOUND_OFFSET_NEG_X: u32 = 0;
pub const MIP_BOUND_OFFSET_POS_X: u32 = 5;
pub const MIP_BOUND_OFFSET_NEG_Y: u32 = 10;
pub const MIP_BOUND_OFFSET_POS_Y: u32 = 15;
pub const MIP_BOUND_OFFSET_NEG_Z: u32 = 20;
pub const MIP_BOUND_OFFSET_POS_Z: u32 = 25;
pub const MIP_BOUND_FIELD_MASK: u32 = 0x1f;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NaadfBindEntryKind {
    StorageRead,
    StorageReadWrite,
    Uniform,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NaadfBindEntrySpec {
    pub binding: u32,
    pub kind: NaadfBindEntryKind,
}

pub const fn naadf_storage_read(binding: u32) -> NaadfBindEntrySpec {
    NaadfBindEntrySpec {
        binding,
        kind: NaadfBindEntryKind::StorageRead,
    }
}

pub const fn naadf_storage_read_write(binding: u32) -> NaadfBindEntrySpec {
    NaadfBindEntrySpec {
        binding,
        kind: NaadfBindEntryKind::StorageReadWrite,
    }
}

pub const fn naadf_uniform(binding: u32) -> NaadfBindEntrySpec {
    NaadfBindEntrySpec {
        binding,
        kind: NaadfBindEntryKind::Uniform,
    }
}

pub const NAADF_BUILD_BLOCKS_LAYOUT: &[NaadfBindEntrySpec] = &[
    naadf_storage_read_write(0),
    naadf_storage_read_write(1),
    naadf_storage_read(4),
    naadf_storage_read_write(5),
    naadf_storage_read_write(6),
    naadf_storage_read_write(7),
    naadf_storage_read(30),
];

pub const NAADF_BUILD_MIPS_LAYOUT: &[NaadfBindEntrySpec] = &[
    naadf_storage_read_write(6),
    naadf_storage_read_write(7),
    naadf_storage_read_write(8),
    naadf_storage_read(30),
];

pub const NAADF_BUILD_BOUNDS_LAYOUT: &[NaadfBindEntrySpec] =
    &[naadf_storage_read_write(5), naadf_storage_read(30)];

pub const NAADF_BUILD_CHUNKS_LAYOUT: &[NaadfBindEntrySpec] = &[
    naadf_storage_read(5),
    naadf_storage_read_write(11),
    naadf_storage_read(30),
];

pub const NAADF_BUILD_CHUNK_BOUNDS_LAYOUT: &[NaadfBindEntrySpec] = &[
    naadf_storage_read_write(11),
    naadf_uniform(12),
    naadf_storage_read(20),
    naadf_storage_read(30),
];

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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfTraversalRecord(pub u32);

impl NaadfTraversalRecord {
    pub fn new(state: NaadfNodeState, child_mask: u8, thin_or_hole: bool) -> Self {
        let mut raw = (state as u32) << TRAVERSAL_RECORD_STATE_SHIFT;
        raw |= child_mask as u32 & TRAVERSAL_RECORD_CHILD_MASK_MASK;
        if thin_or_hole {
            raw |= TRAVERSAL_RECORD_THIN_OR_HOLE_BIT;
        }
        Self(raw)
    }

    pub fn state(self) -> NaadfNodeState {
        match self.0 >> TRAVERSAL_RECORD_STATE_SHIFT {
            0 => NaadfNodeState::UniformEmpty,
            1 => NaadfNodeState::UniformFull,
            2 => NaadfNodeState::Children,
            _ => NaadfNodeState::Reserved,
        }
    }

    pub fn child_mask(self) -> u8 {
        (self.0 & TRAVERSAL_RECORD_CHILD_MASK_MASK) as u8
    }

    pub fn thin_or_hole(self) -> bool {
        self.0 & TRAVERSAL_RECORD_THIN_OR_HOLE_BIT != 0
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfPayloadRecord(pub u32);

impl NaadfPayloadRecord {
    pub fn material(material_id: u16) -> Self {
        Self(material_id as u32 & PAYLOAD_RECORD_MATERIAL_MASK)
    }

    pub fn material_id(self) -> u16 {
        (self.0 & PAYLOAD_RECORD_MATERIAL_MASK) as u16
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfMipBoundsRecord(pub u32);

impl NaadfMipBoundsRecord {
    pub const fn new(neg_x: u8, pos_x: u8, neg_y: u8, pos_y: u8, neg_z: u8, pos_z: u8) -> Self {
        Self(
            ((neg_x as u32) & MIP_BOUND_FIELD_MASK) << MIP_BOUND_OFFSET_NEG_X
                | (((pos_x as u32) & MIP_BOUND_FIELD_MASK) << MIP_BOUND_OFFSET_POS_X)
                | (((neg_y as u32) & MIP_BOUND_FIELD_MASK) << MIP_BOUND_OFFSET_NEG_Y)
                | (((pos_y as u32) & MIP_BOUND_FIELD_MASK) << MIP_BOUND_OFFSET_POS_Y)
                | (((neg_z as u32) & MIP_BOUND_FIELD_MASK) << MIP_BOUND_OFFSET_NEG_Z)
                | (((pos_z as u32) & MIP_BOUND_FIELD_MASK) << MIP_BOUND_OFFSET_POS_Z),
        )
    }

    pub fn get_at_offset(self, offset: u32) -> u8 {
        ((self.0 >> offset) & MIP_BOUND_FIELD_MASK) as u8
    }
}

pub fn mip_level_axis(level: u32) -> u32 {
    MIP_LEVEL_AXES[level as usize]
}

pub fn mip_level_cell_count(level: u32) -> u32 {
    MIP_LEVEL_CELL_COUNTS[level as usize]
}

pub fn mip_level_offset(level: u32) -> u32 {
    MIP_LEVEL_OFFSETS[level as usize]
}

pub fn mip_cell_index(level: u32, local: UVec3) -> usize {
    let axis = mip_level_axis(level);
    debug_assert!(local.x < axis && local.y < axis && local.z < axis);
    (mip_level_offset(level) + local.x + local.y * axis + local.z * axis * axis) as usize
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
    /// Per-block directional skip distances, in *block* units within the
    /// containing chunk. Encoded with [`PackedDirectionalBounds2Bit`] (range 0..=3).
    /// Built by [`crate::rendering::naadf::cpu_builder`] using the upstream
    /// `boundsCommon::ComputeBounds4` propagation rule.
    pub directional_skip_blocks: PackedDirectionalBounds2Bit,
    pub occupancy_mask: u64,
    pub material_ids: [u16; VOXELS_PER_BLOCK as usize],
}

impl Default for NaadfBlock {
    fn default() -> Self {
        Self {
            node: PackedNaadfNode::new(NaadfNodeState::UniformEmpty, 0),
            bounds: DirectionalBounds::empty_block(),
            directional_skip_blocks: PackedDirectionalBounds2Bit::zero(),
            occupancy_mask: 0,
            material_ids: [0; VOXELS_PER_BLOCK as usize],
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfChunk {
    pub position: IVec3,
    pub node: PackedNaadfNode,
    /// Per-chunk directional skip distances, in *chunk* units across loaded,
    /// known-empty chunks. Missing or unloaded neighbors terminate propagation.
    pub chunk_skip: PackedDirectionalBounds5Bit,
    pub blocks: Vec<NaadfBlock>,
    pub occupancy: [bool; CHUNK_VOLUME],
    pub material_ids: [u16; CHUNK_VOLUME],
    /// Per-voxel directional skip distances, in *voxel* units within the
    /// containing block. Length [`CHUNK_VOLUME`], indexed via
    /// [`voxel_index_in_chunk`]. Encoded with [`PackedDirectionalBounds2Bit`]
    /// (range 0..=3). Built using the upstream `ComputeBounds4` rule.
    pub voxel_skip: Vec<PackedDirectionalBounds2Bit>,
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
        let common = include_str!("../../../../assets/shaders/naadf/common.wgsl");

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
        assert_eq!(
            wgsl_u32_const(common, "NAADF_CHUNK_BOUND_OFFSET_POS_X"),
            CHUNK_BOUND_OFFSET_POS_X
        );
        assert_eq!(
            wgsl_u32_const(common, "NAADF_CHUNK_BOUND_FIELD_MASK"),
            CHUNK_BOUND_FIELD_MASK
        );
        assert_eq!(
            wgsl_u32_const(common, "NAADF_MIP_LEVEL_COUNT"),
            MIP_LEVEL_COUNT
        );
        assert_eq!(
            wgsl_u32_const(common, "NAADF_MIP_CELLS_PER_CHUNK"),
            MIP_CELLS_PER_CHUNK
        );
        assert_eq!(
            wgsl_u32_const(common, "NAADF_TRAVERSAL_RECORD_THIN_OR_HOLE_BIT"),
            TRAVERSAL_RECORD_THIN_OR_HOLE_BIT
        );
        assert_eq!(
            wgsl_u32_const(common, "NAADF_MIP_BOUND_OFFSET_POS_Z"),
            MIP_BOUND_OFFSET_POS_Z
        );
    }

    #[test]
    fn traversal_and_payload_records_keep_hot_and_cold_data_split() {
        let traversal = NaadfTraversalRecord::new(NaadfNodeState::Children, 0b1010_0101, true);
        let payload = NaadfPayloadRecord::material(42);

        assert_eq!(traversal.state(), NaadfNodeState::Children);
        assert_eq!(traversal.child_mask(), 0b1010_0101);
        assert!(traversal.thin_or_hole());
        assert_eq!(payload.material_id(), 42);
        assert_eq!(
            mip_cell_index(4, UVec3::ZERO),
            (MIP_CELLS_PER_CHUNK - 1) as usize
        );
        assert_eq!(
            NaadfMipBoundsRecord::new(1, 2, 3, 4, 5, 6).get_at_offset(MIP_BOUND_OFFSET_POS_Z),
            6
        );
    }

    #[test]
    fn packed_chunk_bounds_round_trip_extremes() {
        let packed = PackedDirectionalBounds5Bit::new(0, 1, 7, 15, 30, 31);
        assert_eq!(packed.get_at_offset(CHUNK_BOUND_OFFSET_NEG_X), 0);
        assert_eq!(packed.get_at_offset(CHUNK_BOUND_OFFSET_POS_X), 1);
        assert_eq!(packed.get_at_offset(CHUNK_BOUND_OFFSET_NEG_Y), 7);
        assert_eq!(packed.get_at_offset(CHUNK_BOUND_OFFSET_POS_Y), 15);
        assert_eq!(packed.get_at_offset(CHUNK_BOUND_OFFSET_NEG_Z), 30);
        assert_eq!(packed.get_at_offset(CHUNK_BOUND_OFFSET_POS_Z), 31);
    }

    #[test]
    fn wgsl_layout_imports_common_shader() {
        let layout = include_str!("../../../../assets/shaders/naadf/layout.wgsl");
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
    fn wgsl_ray_trace_imports_layout_and_uses_aadf_skip_records() {
        let ray_trace = include_str!("../../../../assets/shaders/naadf/ray_trace.wgsl");
        let shader = bevy_shader::Shader::from_wgsl(ray_trace, "shaders/naadf/ray_trace.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/common.wgsl"
            )
        }));
        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/layout.wgsl"
            )
        }));
        assert!(ray_trace.contains("fn trace_naadf"));
        assert!(ray_trace.contains("naadf_voxel_records"));
        assert!(ray_trace.contains("naadf_material_records"));
        assert!(ray_trace.contains("naadf_block_records"));
        assert!(ray_trace.contains("naadf_chunk_records"));
        assert!(ray_trace.contains("fn naadf_chunk_skip_for_step"));
        assert!(ray_trace.contains("fn naadf_directional_skip_for_step"));
        assert!(ray_trace.contains("fn naadf_mip_bounds_for_step"));
        assert!(ray_trace.contains("naadf_mip_bounds_records"));
        assert!(ray_trace.contains("fn trace_naadf_lod"));
        assert!(ray_trace.contains("fn naadf_select_mip_level"));
        assert!(ray_trace.contains("fn naadf_step_axis"));
        assert!(ray_trace.contains("fn naadf_ray_chunk_entry"));
        assert!(ray_trace.contains("fn naadf_ray_box_axis"));
        assert!(!ray_trace.contains("safe_direction"));
    }

    #[test]
    fn wgsl_world_trace_declares_chunk_lookup_and_boundary_helpers() {
        let world_trace = include_str!("../../../../assets/shaders/naadf/world_trace.wgsl");
        let shader = bevy_shader::Shader::from_wgsl(world_trace, "shaders/naadf/world_trace.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/ray_trace.wgsl"
            )
        }));
        assert!(world_trace.contains("fn trace_naadf_world"));
        assert!(world_trace.contains("fn trace_naadf_world_lod"));
        assert!(world_trace.contains("naadf_lookup_chunk_slot"));
        assert!(world_trace.contains("naadf_world_chunk_for_position"));
        assert!(world_trace.contains("naadf_world_next_chunk_boundary"));
    }

    #[test]
    fn wgsl_block_builder_imports_layout_and_uses_raw_voxels() {
        let build_blocks = include_str!("../../../../assets/shaders/naadf/build_blocks.wgsl");
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
        assert!(build_blocks.contains("naadf_voxel_records"));
        assert!(build_blocks.contains("naadf_raw_voxel_records"));
        assert!(build_blocks.contains("naadf_block_records"));
        assert!(build_blocks.contains("naadf_build_slots"));
        assert!(build_blocks.contains("naadf_mip_traversal_records"));
        assert!(build_blocks.contains("naadf_mip_payload_records"));
        assert!(build_blocks.contains("NAADF_NODE_UNIFORM_FULL"));
        assert!(build_blocks.contains("cached_skip"));
        assert!(build_blocks.contains("naadf_pack_voxel_record"));
        assert!(build_blocks.contains("uniform_material"));
    }

    #[test]
    fn gpu_builder_layout_specs_match_shader_bindings() {
        assert_eq!(
            NAADF_BUILD_BLOCKS_LAYOUT,
            &[
                naadf_storage_read_write(0),
                naadf_storage_read_write(1),
                naadf_storage_read(4),
                naadf_storage_read_write(5),
                naadf_storage_read_write(6),
                naadf_storage_read_write(7),
                naadf_storage_read(30),
            ]
        );
        assert_eq!(
            NAADF_BUILD_MIPS_LAYOUT,
            &[
                naadf_storage_read_write(6),
                naadf_storage_read_write(7),
                naadf_storage_read_write(8),
                naadf_storage_read(30),
            ]
        );
        assert_eq!(
            NAADF_BUILD_BOUNDS_LAYOUT,
            &[naadf_storage_read_write(5), naadf_storage_read(30)]
        );
        assert_eq!(
            NAADF_BUILD_CHUNKS_LAYOUT,
            &[
                naadf_storage_read(5),
                naadf_storage_read_write(11),
                naadf_storage_read(30),
            ]
        );
        assert_eq!(
            NAADF_BUILD_CHUNK_BOUNDS_LAYOUT,
            &[
                naadf_storage_read_write(11),
                naadf_uniform(12),
                naadf_storage_read(20),
                naadf_storage_read(30),
            ]
        );
    }

    #[test]
    fn wgsl_bounds_builder_writes_directional_bounds() {
        let build_bounds = include_str!("../../../../assets/shaders/naadf/build_bounds.wgsl");
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
        assert!(build_bounds.contains("naadf_build_slots"));
        assert!(build_bounds.contains("cached_skip"));
        assert!(build_bounds.contains("cached_next_skip"));
        assert!(build_bounds.contains("naadf_try_extend"));
        assert!(build_bounds.contains("naadf_matching_bounds_mask"));
        assert!(build_bounds.contains("naadf_block_records[base + 5u]"));
    }

    #[test]
    fn wgsl_mip_builder_reduces_base_level_to_root() {
        let build_mips = include_str!("../../../../assets/shaders/naadf/build_mips.wgsl");
        let shader = bevy_shader::Shader::from_wgsl(build_mips, "shaders/naadf/build_mips.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/common.wgsl"
            )
        }));
        assert!(build_mips.contains("@compute"));
        assert!(build_mips.contains("fn build_naadf_mips"));
        assert!(build_mips.contains("naadf_build_slots"));
        assert!(build_mips.contains("naadf_summarize_mip_children"));
        assert!(build_mips.contains("naadf_build_mip_bounds_level"));
        assert!(build_mips.contains("thin_or_hole"));
        assert!(build_mips.contains("NAADF_MIP_CELLS_PER_CHUNK"));
    }

    #[test]
    fn wgsl_chunk_builder_writes_chunk_nodes_from_block_records() {
        let build_chunks = include_str!("../../../../assets/shaders/naadf/build_chunks.wgsl");
        let shader =
            bevy_shader::Shader::from_wgsl(build_chunks, "shaders/naadf/build_chunks.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/common.wgsl"
            )
        }));
        assert!(build_chunks.contains("@compute"));
        assert!(build_chunks.contains("naadf_block_records"));
        assert!(build_chunks.contains("naadf_chunk_records"));
        assert!(build_chunks.contains("naadf_build_slots"));
        assert!(build_chunks.contains("NAADF_VOXELS_PER_CHUNK"));
        assert!(build_chunks.contains("all_empty"));
        assert!(build_chunks.contains("all_full_same_material"));
        assert!(build_chunks.contains("naadf_chunk_records[chunk_base + 0u]"));
    }

    #[test]
    fn wgsl_chunk_bounds_builder_writes_chunk_skip_word() {
        let build_chunk_bounds =
            include_str!("../../../../assets/shaders/naadf/build_chunk_bounds.wgsl");
        let _shader = bevy_shader::Shader::from_wgsl(
            build_chunk_bounds,
            "shaders/naadf/build_chunk_bounds.wgsl",
        );

        assert!(_shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/common.wgsl"
            )
        }));
        assert!(build_chunk_bounds.contains("fn build_naadf_chunk_bounds"));
        assert!(build_chunk_bounds.contains("naadf_lookup_chunk_slot"));
        assert!(build_chunk_bounds.contains("naadf_build_slots"));
        assert!(build_chunk_bounds.contains("naadf_count_axis_empty_chunks"));
        assert!(build_chunk_bounds.contains("naadf_chunk_lookup_records"));
        assert!(!build_chunk_bounds.contains("naadf_loaded_empty_perpendicular_slab"));
        assert!(build_chunk_bounds.contains("naadf_chunk_records[base + 6u]"));
    }

    #[test]
    fn wgsl_lighting_queries_import_ray_trace_for_sun_visibility() {
        let lighting = include_str!("../../../../assets/shaders/naadf/lighting_queries.wgsl");
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
        assert!(lighting.contains("trace_naadf_world"));
        assert!(lighting.contains("fn naadf_sun_visibility_world"));
        let lighting_lf = lighting.replace("\r\n", "\n");
        assert!(lighting_lf.contains("max_distance,\n        1u"));
        assert!(lighting.contains("fn naadf_terrain_ao_visibility"));
        assert!(lighting.contains("fn naadf_terrain_ao_visibility_world"));
        assert!(lighting.contains("fn naadf_contact_shadow_visibility"));
        assert!(lighting.contains("fn naadf_contact_shadow_visibility_world"));
        assert!(lighting.contains("trace_naadf"));
    }

    #[test]
    fn wgsl_radiance_shader_routes_probe_rays_through_backend_abstraction() {
        let radiance = include_str!("../../../../assets/shaders/radiance_cascades.wgsl");

        assert!(radiance.contains("voxel_backend: u32"));
        assert!(radiance.contains("voxel_backend_query_mask: u32"));
        assert!(radiance.contains("const GI_BACKEND_NAADF"));
        assert!(radiance.contains("const NAADF_QUERY_GI_SECONDARY"));
        assert!(radiance.contains("const NAADF_QUERY_SUN_VISIBILITY"));
        assert!(radiance.contains("const NAADF_QUERY_TERRAIN_AO"));
        assert!(radiance.contains("#import \"shaders/naadf/world_trace.wgsl\""));
        assert!(radiance.contains("#import \"shaders/naadf/lighting_queries.wgsl\""));
        assert!(radiance.contains("trace_naadf_world"));
        assert!(radiance.contains("naadf_sun_visibility_world"));
        assert!(radiance.contains("fn use_naadf_for_query"));
        assert!(radiance.contains("fn trace_gi_backend"));
        assert!(radiance.contains("fn soft_shadow_backend"));
        assert!(radiance.contains("fn terrain_ao_backend"));
        assert!(!radiance.contains("trace_naadf_gi_fallback"));
        assert!(radiance.contains("return trace_current_sdf_gi(origin, direction, max_dist);"));
        assert!(radiance.contains("let hit = trace_gi_backend"));
    }

    #[test]
    fn naadf_bench_counters_publish_radiance_backend_state() {
        let systems = include_str!("../render/systems.rs");

        assert!(systems.contains("naadf.radiance_backend_available"));
        assert!(systems.contains("naadf.radiance_query_mask"));
        assert!(systems.contains("naadf_gi_shader_backend_available(Some(&config)"));
    }

    #[test]
    fn wgsl_froxel_sun_mask_traces_one_visibility_ray_per_froxel() {
        let froxel = include_str!("../../../../assets/shaders/naadf/froxel_sun_mask.wgsl");
        let shader = bevy_shader::Shader::from_wgsl(froxel, "shaders/naadf/froxel_sun_mask.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/lighting_queries.wgsl"
            )
        }));
        assert!(froxel.contains("fn build_naadf_froxel_sun_mask"));
        assert!(froxel.contains("@compute @workgroup_size(64, 1, 1)"));
        assert!(froxel.contains("let index = id.x + naadf_froxel_sun_mask_params.config.w"));
        assert!(froxel.contains("let view_ray = normalize("));
        assert!(froxel.contains("naadf_sun_visibility_world("));
        assert!(froxel.contains("naadf_froxel_sun_mask[index]"));
    }

    #[test]
    fn wgsl_debug_trace_rays_has_ray_count_guard() {
        let debug_trace = include_str!("../../../../assets/shaders/naadf/debug_trace_rays.wgsl");

        assert!(debug_trace.contains("ray_count"));
        assert!(debug_trace.contains("if index >= naadf_debug_trace_params.ray_count"));
    }

    #[test]
    fn wgsl_debug_visualize_declares_ray_step_heatmap() {
        let debug_visualize = include_str!("../../../../assets/shaders/naadf/debug_visualize.wgsl");

        assert!(debug_visualize.contains("@compute"));
        assert!(debug_visualize.contains("naadf_ray_step_heatmap_inputs"));
        assert!(debug_visualize.contains("naadf_ray_step_heatmap_output"));
        assert!(debug_visualize.contains("fn naadf_ray_step_heatmap"));
    }

    #[test]
    fn wgsl_first_hit_declares_preview_material_path() {
        let first_hit = include_str!("../../../../assets/shaders/naadf/first_hit.wgsl");

        assert!(first_hit.contains("#import \"shaders/naadf/ray_trace.wgsl\""));
        assert!(first_hit.contains("#import \"shaders/naadf/world_trace.wgsl\""));
        assert!(!first_hit.contains("fn trace_naadf("));
        assert!(first_hit.contains("@compute"));
        assert!(first_hit.contains("fn naadf_first_hit_preview"));
        assert!(first_hit.contains("fn preview_naadf_first_hit_world"));
        assert!(first_hit.contains("trace_naadf_world"));
        assert!(first_hit.contains("trace_naadf_world_lod"));
        assert!(first_hit.contains("naadf_lod_threshold_jitter"));
        assert!(first_hit.contains("naadf_first_hit_output"));
        assert!(first_hit.contains("fn preview_naadf_first_hit_from_hit"));
        assert!(first_hit.contains("fn naadf_preview_shaded_color"));
        assert!(first_hit.contains("fn naadf_preview_material_color"));
        assert!(first_hit.contains("textureSampleLevel"));
        assert!(first_hit.contains("naadf_preview_textured_albedo"));
        assert!(first_hit.contains("naadf_blocky_material_base"));
        assert!(first_hit.contains("fog_color_start"));
        assert!(first_hit.contains("fog_end_strength"));
        assert!(first_hit.contains("fn naadf_apply_preview_fog"));
        assert!(first_hit.contains("fn naadf_preview_miss_sky"));
        assert!(first_hit.contains("sun_direction_pad"));
        assert!(first_hit.contains("fn naadf_preview_sun_direction"));
        assert!(first_hit.contains("linear_view_depth"));
        assert!(first_hit.contains("ray_distance"));
        assert!(!first_hit.contains("preview.distance / max(ray.max_distance"));
        assert!(first_hit.contains("naadf_first_hit_scene_depth"));
        assert!(first_hit.contains("fn naadf_path_b_first_hit_max_distance"));
        assert!(first_hit.contains("struct NaadfEntityVolumeRecord"));
        assert!(first_hit.contains("naadf_entity_volume_records"));
        assert!(first_hit.contains("naadf_entity_material_records"));
        assert!(first_hit.contains("fn preview_naadf_first_hit_entities"));
        assert!(first_hit.contains("previous_world_from_local_x"));
        assert!(first_hit.contains("previous_world_position"));
        assert!(first_hit.contains("fn naadf_entity_previous_world_position"));
        assert!(first_hit.contains("struct NaadfFirstHitStats"));
        assert!(first_hit.contains("fn naadf_record_first_hit_telemetry"));
    }

    #[test]
    fn wgsl_path_b_first_hit_is_terrain_only() {
        let first_hit =
            include_str!("../../../../assets/shaders/naadf/first_hit_path_b_terrain.wgsl");

        assert!(first_hit.contains("trace_naadf_world_lod"));
        assert!(first_hit.contains("textureSampleLevel"));
        assert!(first_hit.contains("naadf_first_hit_depth_output"));
        assert!(first_hit.contains("diagnostic_reason"));
        assert!(first_hit.contains("fn naadf_path_b_first_hit_max_distance"));
        assert!(!first_hit.contains("naadf_entity_volume_records"));
        assert!(!first_hit.contains("naadf_entity_material_records"));
        assert!(!first_hit.contains("naadf_first_hit_stats"));
        assert!(!first_hit.contains("naadf_local_light_records"));
    }

    #[test]
    fn wgsl_entity_volume_record_matches_rust_pack_order() {
        let first_hit = include_str!("../../../../assets/shaders/naadf/first_hit.wgsl");
        let fields = wgsl_struct_fields(first_hit, "NaadfEntityVolumeRecord");

        assert_eq!(
            fields,
            [
                "world_aabb_min_material_base",
                "world_aabb_max_material_count",
                "local_from_world_x",
                "local_from_world_y",
                "local_from_world_z",
                "local_from_world_w",
                "world_from_local_x",
                "world_from_local_y",
                "world_from_local_z",
                "world_from_local_w",
                "previous_world_from_local_x",
                "previous_world_from_local_y",
                "previous_world_from_local_z",
                "previous_world_from_local_w",
                "dimensions_occupied",
                "voxel_size_local_origin_x",
                "local_origin_yz_pad",
            ],
            "WGSL NaadfEntityVolumeRecord order must match pack_entity_volume_record"
        );
        assert_eq!(
            fields.len(),
            crate::rendering::naadf::gpu_buffers::NAADF_ENTITY_VOLUME_RECORD_VEC4S
        );
    }

    #[test]
    fn wgsl_preview_lighting_uses_first_hit_shading() {
        let preview_lighting =
            include_str!("../../../../assets/shaders/naadf/preview_lighting.wgsl");

        assert!(preview_lighting.contains("shade_naadf_preview"));
        assert!(preview_lighting.contains("naadf_preview_shaded_color"));
        assert!(!preview_lighting.contains("vec3<f32>(0.8)"));
    }

    #[test]
    fn wgsl_preview_composite_declares_modes() {
        let composite = include_str!("../../../../assets/shaders/naadf/preview_composite.wgsl");

        assert!(composite.contains("NAADF_PREVIEW_FULLSCREEN"));
        assert!(composite.contains("NAADF_PREVIEW_SPLIT_VIEW"));
        assert!(composite.contains("NAADF_PREVIEW_PICTURE_IN_PICTURE"));
        assert!(composite.contains("fn naadf_preview_composite_color"));
        assert!(composite.contains("naadf_composite_current_color"));
        assert!(composite.contains("textureStore"));
    }

    #[test]
    fn wgsl_preview_fullscreen_composite_declares_fragment_modes() {
        let composite =
            include_str!("../../../../assets/shaders/naadf/preview_fullscreen_composite.wgsl");

        assert!(composite.contains("@fragment"));
        assert!(composite.contains("naadf_scene_color"));
        assert!(composite.contains("naadf_preview_color"));
        assert!(composite.contains("mode_split"));
        assert!(composite.contains("show_miss_sky"));
        assert!(composite.contains("textureDimensions(naadf_scene_color)"));
        assert!(composite.contains("preview_coord"));
        assert!(composite.contains("blended_preview"));
        assert!(composite.contains("divider_width"));
        assert!(composite.contains("1.0, 0.92, 0.12"));
        assert!(composite.contains("textureLoad"));
    }

    #[test]
    fn wgsl_denoise_declares_edge_aware_compute_pass() {
        let denoise = include_str!("../../../../assets/shaders/naadf/denoise.wgsl");

        assert!(denoise.contains("@compute"));
        assert!(denoise.contains("fn naadf_denoise"));
        assert!(denoise.contains("naadf_denoise_source_depth"));
        assert!(denoise.contains("naadf_denoise_source_normal"));
        assert!(denoise.contains("fn naadf_denoise_weight"));
        assert!(denoise.contains("textureStore"));
    }

    #[test]
    fn wgsl_temporal_accumulation_declares_blend_and_reset() {
        let temporal = include_str!("../../../../assets/shaders/naadf/temporal_accumulation.wgsl");

        assert!(temporal.contains("NaadfTemporalAccumulationParams"));
        assert!(temporal.contains("reset_history"));
        assert!(temporal.contains("fn naadf_temporal_accumulate"));
        assert!(temporal.contains("fn naadf_temporal_accumulate_moments"));
        assert!(temporal.contains("fn naadf_history_luminance_matches_current"));
        assert!(temporal.contains("fn naadf_reproject_history_coord"));
        assert!(temporal.contains("naadf_temporal_motion"));
        assert!(temporal.contains("naadf_temporal_current_depth"));
        assert!(temporal.contains("motion_valid"));
        assert!(temporal.contains("motion.z <= 0.0"));
        assert!(temporal.contains("naadf_temporal_history_color"));
        assert!(temporal.contains("naadf_temporal_history_moments"));
        assert!(temporal.contains("naadf_temporal_output_moments"));
        assert!(temporal.contains("naadf_temporal_current_owner"));
        assert!(temporal.contains("naadf_temporal_history_owner"));
        assert!(temporal.contains("naadf_temporal_output_owner"));
        assert!(temporal.contains("history_owner == current_owner"));
        assert!(temporal.contains("textureStore"));
    }

    #[test]
    fn wgsl_path_b_ownership_declares_decision_counters() {
        let ownership = include_str!("../../../../assets/shaders/naadf/path_b_ownership.wgsl");

        assert!(ownership.contains("fn naadf_path_b_ownership"));
        assert!(ownership.contains("path_b_depth_rejects"));
        assert!(ownership.contains("path_b_coverage_rejects"));
        assert!(ownership.contains("path_b_naadf_accepts"));
        assert!(ownership.contains("path_b_refine_requests"));
        assert!(ownership.contains("path_b_stale_or_unresident"));
        assert!(ownership.contains("path_b_ownership_changes"));
        assert!(ownership.contains("textureStore(naadf_path_b_current_owner"));
        assert!(ownership.contains("naadf_path_b_count_stale_or_unresident"));
    }

    #[test]
    fn wgsl_spatial_resampling_declares_edge_aware_helpers() {
        let spatial = include_str!("../../../../assets/shaders/naadf/spatial_resampling.wgsl");

        assert!(spatial.contains("NaadfSpatialResamplingParams"));
        assert!(spatial.contains("fn naadf_spatial_weight"));
        assert!(spatial.contains("fn naadf_spatial_accumulate"));
        assert!(spatial.contains("depth_sigma"));
        assert!(spatial.contains("normal_sigma"));
        assert!(spatial.contains("naadf_spatial_source_depth"));
        assert!(spatial.contains("center_sample.a"));
        assert!(spatial.contains("textureStore"));
    }

    #[test]
    fn wgsl_gi_trace_declares_preview_compute_pass() {
        let gi = include_str!("../../../../assets/shaders/naadf/gi_trace.wgsl");

        assert!(gi.contains("@compute"));
        assert!(gi.contains("fn naadf_gi_trace"));
        assert!(gi.contains("naadf_gi_source_depth"));
        assert!(gi.contains("naadf_gi_source_normal"));
        assert!(gi.contains("#import \"shaders/naadf/world_trace.wgsl\""));
        assert!(gi.contains("trace_naadf_world"));
        assert!(!gi.contains("fn naadf_gi_trace_world"));
        assert!(gi.contains("fn naadf_gi_sun_visibility"));
        assert!(gi.contains("sample_count"));
        assert!(gi.contains("frame_index"));
        assert!(gi.contains("sun_direction_pad"));
        assert!(gi.contains("fn naadf_gi_sky_term"));
    }

    #[test]
    fn wgsl_path_trace_declares_reference_compute_pass() {
        let path_trace = include_str!("../../../../assets/shaders/naadf/path_trace.wgsl");

        assert!(path_trace.contains("@compute"));
        assert!(path_trace.contains("fn naadf_path_trace_reference"));
        assert!(path_trace.contains("naadf_path_trace_first_hit_color"));
        assert!(path_trace.contains("naadf_path_trace_first_hit_depth"));
        assert!(path_trace.contains("naadf_reference_indirect"));
        assert!(path_trace.contains("naadf_reference_sample_offset"));
        assert!(path_trace.contains("naadf_reference_hash"));
        assert!(path_trace.contains("sample_count, 1u), 32u"));
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

    fn wgsl_struct_fields(source: &str, name: &str) -> Vec<String> {
        let prefix = format!("struct {name} {{");
        let mut lines = source
            .lines()
            .skip_while(|line| line.trim() != prefix)
            .skip(1);
        let mut fields = Vec::new();
        for line in &mut lines {
            let trimmed = line.trim();
            if trimmed == "}" {
                return fields;
            }
            if trimmed.is_empty() || trimmed.starts_with("//") {
                continue;
            }
            let Some((field, _ty)) = trimmed.trim_end_matches(',').split_once(':') else {
                panic!("invalid WGSL field in struct {name}: {trimmed}");
            };
            fields.push(field.trim().to_string());
        }
        panic!("missing WGSL struct {name}");
    }
}
