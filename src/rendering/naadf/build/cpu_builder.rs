use bevy::prelude::*;

use crate::constants::CHUNK_VOLUME;
use crate::rendering::naadf::layout::{
    BLOCKS_PER_CHUNK, BLOCKS_PER_CHUNK_AXIS, BOUND_FIELD_MAX, BOUND_OFFSET_NEG_X,
    BOUND_OFFSET_NEG_Y, BOUND_OFFSET_NEG_Z, BOUND_OFFSET_POS_X, BOUND_OFFSET_POS_Y,
    BOUND_OFFSET_POS_Z, DirectionalBounds, MIP_CELLS_PER_CHUNK, MIP_LEVEL_COUNT, NaadfBlock,
    NaadfChunk, NaadfMipBoundsRecord, NaadfNodeState, NaadfPayloadRecord, NaadfTraversalRecord,
    PackedDirectionalBounds2Bit, PackedNaadfNode, VOXELS_PER_BLOCK, VOXELS_PER_BLOCK_AXIS,
    block_coord_for_voxel, block_index_in_chunk, local_coord_in_block, mip_cell_index,
    mip_level_axis, voxel_index_in_block, voxel_index_in_chunk,
};
use crate::voxel::chunk::Chunk;
use crate::voxel::materials::MaterialId;
use crate::voxel::types::{Voxel, VoxelType};

#[derive(Clone, Copy, Debug)]
pub struct NaadfBuildOptions {
    pub water_is_opaque: bool,
}

impl Default for NaadfBuildOptions {
    fn default() -> Self {
        Self {
            water_is_opaque: false,
        }
    }
}

pub fn build_naadf_chunk(chunk: &Chunk, options: NaadfBuildOptions) -> NaadfChunk {
    let mut occupancy = [false; CHUNK_VOLUME];
    let mut material_ids = [0; CHUNK_VOLUME];
    let mut occupied_count = 0usize;
    let mut first_material = 0u16;
    let mut uniform_material = true;

    for (local, voxel) in chunk.iter() {
        let index = voxel_index_in_chunk(local);
        let occupied = voxel_occupies_naadf(voxel, options);
        let material_id = if occupied {
            material_id_for_chunk_voxel(chunk, local, voxel)
        } else {
            0
        };
        occupancy[index] = occupied;
        material_ids[index] = material_id;
        if occupied {
            occupied_count += 1;
            if first_material == 0 {
                first_material = material_id;
            } else if first_material != material_id {
                uniform_material = false;
            }
        }
    }

    let node = if occupied_count == 0 {
        PackedNaadfNode::new(NaadfNodeState::UniformEmpty, 0)
    } else if occupied_count == CHUNK_VOLUME && uniform_material {
        PackedNaadfNode::new(NaadfNodeState::UniformFull, first_material as u32)
    } else {
        PackedNaadfNode::new(NaadfNodeState::Children, 0)
    };

    let mut blocks = vec![NaadfBlock::default(); BLOCKS_PER_CHUNK as usize];
    let mut voxel_skip = vec![PackedDirectionalBounds2Bit::zero(); CHUNK_VOLUME];
    for block_z in 0..4 {
        for block_y in 0..4 {
            for block_x in 0..4 {
                let block_coord = UVec3::new(block_x, block_y, block_z);
                let block_index = block_index_in_chunk(block_coord);
                let block = build_block(block_coord, &occupancy, &material_ids);
                let per_voxel = propagate_voxel_skip_in_block(block.occupancy_mask);
                scatter_voxel_skip_into_chunk(block_coord, &per_voxel, &mut voxel_skip);
                blocks[block_index] = block;
            }
        }
    }
    propagate_block_skip_in_chunk(&mut blocks);

    NaadfChunk {
        position: chunk.position(),
        node,
        chunk_skip: Default::default(),
        blocks,
        occupancy,
        material_ids,
        voxel_skip,
    }
}

/// Run the upstream `boundsCommon::ComputeBounds4` propagation rule across the
/// 64 voxels of a single block, returning per-voxel directional skip distances
/// (each axis 0..=3, packed into a `PackedDirectionalBounds2Bit`).
///
/// The values reflect the "safe envelope" semantics from the NAADF paper: a
/// voxel's `+X` field is the number of *additional* empty voxels you can
/// step into in `+X` from this voxel before the safe-region claim ends. Bounds
/// are clamped to 3 because the field is 2 bits wide; the trace transitions to
/// the per-block level when the safe envelope would extend past a block edge.
pub fn propagate_voxel_skip_in_block(
    occupancy_mask: u64,
) -> [PackedDirectionalBounds2Bit; VOXELS_PER_BLOCK as usize] {
    let mut bounds = [PackedDirectionalBounds2Bit::zero(); VOXELS_PER_BLOCK as usize];
    let occupied = |idx: usize| occupancy_mask & (1u64 << idx) != 0;
    propagate_bounds_4cubed(VOXELS_PER_BLOCK_AXIS, &occupied, &mut bounds);
    bounds
}

/// Run the same propagation rule across the 64 blocks of a chunk, writing per
/// block directional skip distances (in *block* units) into each block.
pub fn propagate_block_skip_in_chunk(blocks: &mut [NaadfBlock]) {
    debug_assert_eq!(blocks.len(), BLOCKS_PER_CHUNK as usize);
    let mut bounds = [PackedDirectionalBounds2Bit::zero(); BLOCKS_PER_CHUNK as usize];
    let occupied = |idx: usize| blocks[idx].node.state() != NaadfNodeState::UniformEmpty;
    propagate_bounds_4cubed(BLOCKS_PER_CHUNK_AXIS, &occupied, &mut bounds);
    for (block, skip) in blocks.iter_mut().zip(bounds.iter()) {
        block.directional_skip_blocks = *skip;
    }
}

/// Generic 4³ propagation matching `boundsCommon::ComputeBounds4`. `axis_size`
/// must be 4. `is_occupied(i)` reports whether the cell at flat index `i` is
/// occupied (rays terminate there). `bounds` is the writable per-cell output.
fn propagate_bounds_4cubed(
    axis_size: u32,
    is_occupied: &dyn Fn(usize) -> bool,
    bounds: &mut [PackedDirectionalBounds2Bit],
) {
    debug_assert_eq!(axis_size, 4);
    let stride = axis_size as i32;
    let total = (axis_size * axis_size * axis_size) as usize;
    debug_assert_eq!(bounds.len(), total);

    // Upstream ComputeBounds4 synchronizes after X, then Y, then Z inside each
    // of the three passes. Later axis phases in a pass can see earlier growth.
    for _ in 0..3 {
        propagate_axis_phase(
            stride,
            total,
            is_occupied,
            bounds,
            [
                AxisExtension {
                    neighbour_offset: -1,
                    bound_offset: BOUND_OFFSET_NEG_X,
                    check_offsets: CHECK_AXES_FOR_NEG_X,
                    can_extend: |pos, _stride| pos.x > 0,
                },
                AxisExtension {
                    neighbour_offset: 1,
                    bound_offset: BOUND_OFFSET_POS_X,
                    check_offsets: CHECK_AXES_FOR_POS_X,
                    can_extend: |pos, stride| pos.x + 1 < stride,
                },
            ],
        );
        propagate_axis_phase(
            stride,
            total,
            is_occupied,
            bounds,
            [
                AxisExtension {
                    neighbour_offset: -stride,
                    bound_offset: BOUND_OFFSET_NEG_Y,
                    check_offsets: CHECK_AXES_FOR_NEG_Y,
                    can_extend: |pos, _stride| pos.y > 0,
                },
                AxisExtension {
                    neighbour_offset: stride,
                    bound_offset: BOUND_OFFSET_POS_Y,
                    check_offsets: CHECK_AXES_FOR_POS_Y,
                    can_extend: |pos, stride| pos.y + 1 < stride,
                },
            ],
        );
        propagate_axis_phase(
            stride,
            total,
            is_occupied,
            bounds,
            [
                AxisExtension {
                    neighbour_offset: -stride * stride,
                    bound_offset: BOUND_OFFSET_NEG_Z,
                    check_offsets: CHECK_AXES_FOR_NEG_Z,
                    can_extend: |pos, _stride| pos.z > 0,
                },
                AxisExtension {
                    neighbour_offset: stride * stride,
                    bound_offset: BOUND_OFFSET_POS_Z,
                    check_offsets: CHECK_AXES_FOR_POS_Z,
                    can_extend: |pos, stride| pos.z + 1 < stride,
                },
            ],
        );
    }
}

#[derive(Clone, Copy)]
struct AxisExtension {
    neighbour_offset: i32,
    bound_offset: u32,
    check_offsets: [u32; 5],
    can_extend: fn(IVec3, i32) -> bool,
}

fn propagate_axis_phase(
    stride: i32,
    total: usize,
    is_occupied: &dyn Fn(usize) -> bool,
    bounds: &mut [PackedDirectionalBounds2Bit],
    extensions: [AxisExtension; 2],
) {
    let snapshot = bounds.to_vec();
    for index in 0..total {
        if is_occupied(index) {
            continue;
        }
        let pos = unflatten(index as i32, stride);
        let mut updated = snapshot[index];
        for extension in extensions {
            if !(extension.can_extend)(pos, stride) {
                continue;
            }
            try_extend(
                &snapshot,
                is_occupied,
                index,
                extension.neighbour_offset,
                extension.bound_offset,
                extension.check_offsets,
                &mut updated,
            );
        }
        bounds[index] = updated;
    }
}

/// The 5 direction offsets whose bounds must match for an extension in the
/// indexed direction. Mirrors `MASK_M*` / `MASK_P*` in upstream
/// `boundsCommon.fxh`: for each extension direction D, only the *opposite*
/// direction (-D) is excluded — the neighbour's -D bound points back into the
/// known-empty current cell and carries no new safety information.
const CHECK_AXES_FOR_NEG_X: [u32; 5] = [
    BOUND_OFFSET_NEG_X,
    BOUND_OFFSET_NEG_Y,
    BOUND_OFFSET_POS_Y,
    BOUND_OFFSET_NEG_Z,
    BOUND_OFFSET_POS_Z,
];
const CHECK_AXES_FOR_POS_X: [u32; 5] = [
    BOUND_OFFSET_POS_X,
    BOUND_OFFSET_NEG_Y,
    BOUND_OFFSET_POS_Y,
    BOUND_OFFSET_NEG_Z,
    BOUND_OFFSET_POS_Z,
];
const CHECK_AXES_FOR_NEG_Y: [u32; 5] = [
    BOUND_OFFSET_NEG_X,
    BOUND_OFFSET_POS_X,
    BOUND_OFFSET_NEG_Y,
    BOUND_OFFSET_NEG_Z,
    BOUND_OFFSET_POS_Z,
];
const CHECK_AXES_FOR_POS_Y: [u32; 5] = [
    BOUND_OFFSET_NEG_X,
    BOUND_OFFSET_POS_X,
    BOUND_OFFSET_POS_Y,
    BOUND_OFFSET_NEG_Z,
    BOUND_OFFSET_POS_Z,
];
const CHECK_AXES_FOR_NEG_Z: [u32; 5] = [
    BOUND_OFFSET_NEG_X,
    BOUND_OFFSET_POS_X,
    BOUND_OFFSET_NEG_Y,
    BOUND_OFFSET_POS_Y,
    BOUND_OFFSET_NEG_Z,
];
const CHECK_AXES_FOR_POS_Z: [u32; 5] = [
    BOUND_OFFSET_NEG_X,
    BOUND_OFFSET_POS_X,
    BOUND_OFFSET_NEG_Y,
    BOUND_OFFSET_POS_Y,
    BOUND_OFFSET_POS_Z,
];

fn try_extend(
    snapshot: &[PackedDirectionalBounds2Bit],
    is_occupied: &dyn Fn(usize) -> bool,
    index: usize,
    neighbour_offset: i32,
    bound_offset: u32,
    perpendicular_offsets: [u32; 5],
    updated: &mut PackedDirectionalBounds2Bit,
) {
    let neighbour_index = index as i32 + neighbour_offset;
    if neighbour_index < 0 || neighbour_index as usize >= snapshot.len() {
        return;
    }
    let neighbour_index = neighbour_index as usize;
    if is_occupied(neighbour_index) {
        return;
    }
    let neighbour = snapshot[neighbour_index];
    for offset in perpendicular_offsets {
        if neighbour.get_at_offset(offset) < updated.get_at_offset(offset) {
            return;
        }
    }
    if updated.get_at_offset(bound_offset) < BOUND_FIELD_MAX {
        updated.add_one(bound_offset);
    }
}

fn unflatten(index: i32, stride: i32) -> IVec3 {
    IVec3::new(
        index % stride,
        (index / stride) % stride,
        index / (stride * stride),
    )
}

fn scatter_voxel_skip_into_chunk(
    block_coord: UVec3,
    per_voxel: &[PackedDirectionalBounds2Bit; VOXELS_PER_BLOCK as usize],
    chunk_skip: &mut [PackedDirectionalBounds2Bit],
) {
    for z in 0..VOXELS_PER_BLOCK_AXIS {
        for y in 0..VOXELS_PER_BLOCK_AXIS {
            for x in 0..VOXELS_PER_BLOCK_AXIS {
                let block_local = UVec3::new(x, y, z);
                let chunk_local = block_coord * VOXELS_PER_BLOCK_AXIS + block_local;
                chunk_skip[voxel_index_in_chunk(chunk_local)] =
                    per_voxel[voxel_index_in_block(block_local)];
            }
        }
    }
}

pub fn material_id_for_voxel(voxel: VoxelType, options: NaadfBuildOptions) -> u16 {
    if !voxel_occupies_naadf(voxel, options) {
        return 0;
    }
    MaterialId::from_voxel(voxel).0
}

fn voxel_occupies_naadf(voxel: VoxelType, options: NaadfBuildOptions) -> bool {
    voxel.is_solid() || (voxel == VoxelType::Water && options.water_is_opaque)
}

fn material_id_for_chunk_voxel(chunk: &Chunk, local: UVec3, voxel: VoxelType) -> u16 {
    let material_id = chunk.get_material_id(local).0;
    if material_id == MaterialId::AIR.0 {
        MaterialId::from_voxel(voxel).0
    } else {
        material_id
    }
}

fn build_block(
    block_coord: UVec3,
    chunk_occupancy: &[bool; CHUNK_VOLUME],
    chunk_material_ids: &[u16; CHUNK_VOLUME],
) -> NaadfBlock {
    let mut block = NaadfBlock::default();
    let mut occupied = 0usize;
    let mut first_material = 0u16;
    let mut uniform_material = true;

    for z in 0..VOXELS_PER_BLOCK_AXIS {
        for y in 0..VOXELS_PER_BLOCK_AXIS {
            for x in 0..VOXELS_PER_BLOCK_AXIS {
                let block_local = UVec3::new(x, y, z);
                let chunk_local = block_coord * VOXELS_PER_BLOCK_AXIS + block_local;
                let chunk_index = voxel_index_in_chunk(chunk_local);
                let block_index = voxel_index_in_block(block_local);
                let material_id = chunk_material_ids[chunk_index];
                block.material_ids[block_index] = material_id;
                if chunk_occupancy[chunk_index] {
                    block.occupancy_mask |= 1u64 << block_index;
                    occupied += 1;
                    if first_material == 0 {
                        first_material = material_id;
                    } else if first_material != material_id {
                        uniform_material = false;
                    }
                }
            }
        }
    }

    block.node = if occupied == 0 {
        PackedNaadfNode::new(NaadfNodeState::UniformEmpty, 0)
    } else if occupied == VOXELS_PER_BLOCK as usize && uniform_material {
        PackedNaadfNode::new(NaadfNodeState::UniformFull, first_material as u32)
    } else {
        PackedNaadfNode::new(NaadfNodeState::Children, 0)
    };
    block.bounds = compute_directional_bounds(block.occupancy_mask);
    block
}

pub fn compute_directional_bounds(occupancy_mask: u64) -> DirectionalBounds {
    if occupancy_mask == 0 {
        return DirectionalBounds::empty_block();
    }
    if occupancy_mask == u64::MAX >> (64 - VOXELS_PER_BLOCK) {
        return DirectionalBounds::full_block();
    }

    let mut min = UVec3::splat(VOXELS_PER_BLOCK_AXIS);
    let mut max = UVec3::ZERO;
    for z in 0..VOXELS_PER_BLOCK_AXIS {
        for y in 0..VOXELS_PER_BLOCK_AXIS {
            for x in 0..VOXELS_PER_BLOCK_AXIS {
                let local = UVec3::new(x, y, z);
                let index = voxel_index_in_block(local);
                if occupancy_mask & (1u64 << index) == 0 {
                    continue;
                }
                min = min.min(local);
                max = max.max(local);
            }
        }
    }

    DirectionalBounds {
        neg_x: min.x as u8,
        pos_x: (VOXELS_PER_BLOCK_AXIS - 1 - max.x) as u8,
        neg_y: min.y as u8,
        pos_y: (VOXELS_PER_BLOCK_AXIS - 1 - max.y) as u8,
        neg_z: min.z as u8,
        pos_z: (VOXELS_PER_BLOCK_AXIS - 1 - max.z) as u8,
    }
}

pub fn occupancy_mask_for_chunk_voxel(local: UVec3) -> (usize, u64) {
    let block_coord = block_coord_for_voxel(local);
    let block_local = local_coord_in_block(local);
    (
        block_index_in_chunk(block_coord),
        1u64 << voxel_index_in_block(block_local),
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfMipPyramid {
    pub traversal_records: Vec<NaadfTraversalRecord>,
    pub payload_records: Vec<NaadfPayloadRecord>,
    pub bounds_records: Vec<NaadfMipBoundsRecord>,
}

pub fn build_mip_pyramid_from_chunk(chunk: &NaadfChunk) -> NaadfMipPyramid {
    let mut pyramid = NaadfMipPyramid {
        traversal_records: vec![NaadfTraversalRecord::default(); MIP_CELLS_PER_CHUNK as usize],
        payload_records: vec![NaadfPayloadRecord::default(); MIP_CELLS_PER_CHUNK as usize],
        bounds_records: vec![NaadfMipBoundsRecord::default(); MIP_CELLS_PER_CHUNK as usize],
    };

    for z in 0..16 {
        for y in 0..16 {
            for x in 0..16 {
                let local = UVec3::new(x, y, z);
                let source_index = voxel_index_in_chunk(local);
                let occupied = chunk.occupancy[source_index];
                let mip_index = mip_cell_index(0, local);
                pyramid.traversal_records[mip_index] = NaadfTraversalRecord::new(
                    if occupied {
                        NaadfNodeState::UniformFull
                    } else {
                        NaadfNodeState::UniformEmpty
                    },
                    u8::from(occupied),
                    false,
                );
                pyramid.payload_records[mip_index] =
                    NaadfPayloadRecord::material(chunk.material_ids[source_index]);
            }
        }
    }

    for parent_level in 1..MIP_LEVEL_COUNT {
        build_mip_level(&mut pyramid, parent_level);
    }
    for level in 0..MIP_LEVEL_COUNT {
        build_mip_bounds_level(&mut pyramid, level);
    }

    pyramid
}

fn build_mip_level(pyramid: &mut NaadfMipPyramid, parent_level: u32) {
    let child_level = parent_level - 1;
    let parent_axis = mip_level_axis(parent_level);
    for z in 0..parent_axis {
        for y in 0..parent_axis {
            for x in 0..parent_axis {
                let local = UVec3::new(x, y, z);
                let summary = summarize_mip_children(pyramid, child_level, local * 2);
                let index = mip_cell_index(parent_level, local);
                pyramid.traversal_records[index] = NaadfTraversalRecord::new(
                    summary.state,
                    summary.child_mask,
                    summary.thin_or_hole,
                );
                pyramid.payload_records[index] = NaadfPayloadRecord::material(summary.material_id);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MipSummary {
    state: NaadfNodeState,
    child_mask: u8,
    thin_or_hole: bool,
    material_id: u16,
}

fn summarize_mip_children(
    pyramid: &NaadfMipPyramid,
    child_level: u32,
    child_origin: UVec3,
) -> MipSummary {
    let mut occupied_count = 0u8;
    let mut child_mask = 0u8;
    let mut first_material = 0u16;
    let mut uniform_material = true;
    let mut all_full = true;
    let mut bit = 0u8;

    for z in 0..2 {
        for y in 0..2 {
            for x in 0..2 {
                let child = child_origin + UVec3::new(x, y, z);
                let child_index = mip_cell_index(child_level, child);
                let child_record = pyramid.traversal_records[child_index];
                let child_state = child_record.state();
                let occupied = child_state != NaadfNodeState::UniformEmpty;
                if occupied {
                    occupied_count += 1;
                    child_mask |= 1 << bit;
                    let material = pyramid.payload_records[child_index].material_id();
                    if first_material == 0 {
                        first_material = material;
                    } else if material != 0 && material != first_material {
                        uniform_material = false;
                    }
                }
                all_full = all_full && child_state == NaadfNodeState::UniformFull;
                bit += 1;
            }
        }
    }

    let state = if occupied_count == 0 {
        NaadfNodeState::UniformEmpty
    } else if occupied_count == 8 && all_full && uniform_material {
        NaadfNodeState::UniformFull
    } else {
        NaadfNodeState::Children
    };

    MipSummary {
        state,
        child_mask,
        thin_or_hole: state == NaadfNodeState::Children
            && (occupied_count <= 2 || occupied_count >= 6 || !all_full),
        material_id: first_material,
    }
}

fn build_mip_bounds_level(pyramid: &mut NaadfMipPyramid, level: u32) {
    let axis = mip_level_axis(level);
    for z in 0..axis {
        for y in 0..axis {
            for x in 0..axis {
                let local = UVec3::new(x, y, z);
                let index = mip_cell_index(level, local);
                pyramid.bounds_records[index] =
                    if pyramid.traversal_records[index].state() == NaadfNodeState::UniformEmpty {
                        NaadfMipBoundsRecord::new(
                            count_empty_mip_cells(pyramid, level, local, IVec3::NEG_X),
                            count_empty_mip_cells(pyramid, level, local, IVec3::X),
                            count_empty_mip_cells(pyramid, level, local, IVec3::NEG_Y),
                            count_empty_mip_cells(pyramid, level, local, IVec3::Y),
                            count_empty_mip_cells(pyramid, level, local, IVec3::NEG_Z),
                            count_empty_mip_cells(pyramid, level, local, IVec3::Z),
                        )
                    } else {
                        NaadfMipBoundsRecord::default()
                    };
            }
        }
    }
}

fn count_empty_mip_cells(pyramid: &NaadfMipPyramid, level: u32, local: UVec3, step: IVec3) -> u8 {
    let axis = mip_level_axis(level) as i32;
    let mut cursor = local.as_ivec3() + step;
    let mut count = 0u8;
    while count < 31 && cursor.cmpge(IVec3::ZERO).all() && cursor.cmplt(IVec3::splat(axis)).all() {
        let index = mip_cell_index(level, cursor.as_uvec3());
        if pyramid.traversal_records[index].state() != NaadfNodeState::UniformEmpty {
            break;
        }
        count += 1;
        cursor += step;
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::naadf::layout::MIP_BOUND_OFFSET_POS_X;

    #[test]
    fn empty_chunk_builds_uniform_empty() {
        let chunk = Chunk::new(IVec3::ZERO);
        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        assert_eq!(naadf.node.state(), NaadfNodeState::UniformEmpty);
        assert!(naadf.occupancy.iter().all(|occupied| !occupied));
    }

    #[test]
    fn water_is_not_opaque_by_default() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(1, 1, 1), VoxelType::Water);
        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        assert_eq!(naadf.node.state(), NaadfNodeState::UniformEmpty);
    }

    #[test]
    fn solid_voxel_uses_assigned_material_id() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        let local = UVec3::new(1, 2, 3);
        chunk.set(local, VoxelType::Rock);
        chunk.set_material_id(local, MaterialId(6));

        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());

        assert_eq!(naadf.material_ids[voxel_index_in_chunk(local)], 6);
    }

    #[test]
    fn single_origin_voxel_bounds_match_directional_distances() {
        let mask = 1u64 << voxel_index_in_block(UVec3::ZERO);
        assert_eq!(
            compute_directional_bounds(mask),
            DirectionalBounds {
                neg_x: 0,
                pos_x: 3,
                neg_y: 0,
                pos_y: 3,
                neg_z: 0,
                pos_z: 3,
            }
        );
    }

    #[test]
    fn mip_pyramid_reduces_sparse_chunk_to_thin_mixed_root() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(0, 0, 0), VoxelType::Rock);
        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());

        let pyramid = build_mip_pyramid_from_chunk(&naadf);
        let root = pyramid.traversal_records[mip_cell_index(4, UVec3::ZERO)];

        assert_eq!(
            pyramid.traversal_records.len(),
            MIP_CELLS_PER_CHUNK as usize
        );
        assert_eq!(root.state(), NaadfNodeState::Children);
        assert!(root.thin_or_hole());
        assert_eq!(
            pyramid.payload_records[mip_cell_index(4, UVec3::ZERO)].material_id(),
            VoxelType::Rock as u16
        );
        assert_eq!(
            pyramid.bounds_records[mip_cell_index(4, UVec3::ZERO)].0,
            0,
            "mixed root is not an empty-run skip source"
        );
    }

    #[test]
    fn mip_bounds_count_empty_run_until_occupied_cell() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(3, 0, 0), VoxelType::Rock);
        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());

        let pyramid = build_mip_pyramid_from_chunk(&naadf);
        let origin_empty = pyramid.bounds_records[mip_cell_index(0, UVec3::ZERO)];

        assert_eq!(origin_empty.get_at_offset(MIP_BOUND_OFFSET_POS_X), 2);
    }

    fn voxel_skip_at(chunk: &NaadfChunk, x: u32, y: u32, z: u32) -> PackedDirectionalBounds2Bit {
        chunk.voxel_skip[voxel_index_in_chunk(UVec3::new(x, y, z))]
    }

    /// Block-corner occupied at (0,0,0). The empty voxel at (3,0,0) should see
    /// 2 empty steps back toward the wall along -X; the voxel directly adjacent
    /// at (1,0,0) should see 0 (its -X neighbour is the wall itself).
    #[test]
    fn voxel_skip_propagates_back_toward_corner_occupant() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(0, 0, 0), VoxelType::Rock);

        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());

        assert_eq!(
            voxel_skip_at(&naadf, 1, 0, 0).get_at_offset(BOUND_OFFSET_NEG_X),
            0
        );
        assert_eq!(
            voxel_skip_at(&naadf, 2, 0, 0).get_at_offset(BOUND_OFFSET_NEG_X),
            1
        );
        assert_eq!(
            voxel_skip_at(&naadf, 3, 0, 0).get_at_offset(BOUND_OFFSET_NEG_X),
            2
        );
    }

    /// All-empty block ⇒ every voxel's `+X` and `+Y` bounds should saturate to
    /// the block-local max-distance, which is `3 - local.{x,y}`. Beyond that the
    /// trace transitions to the per-block skip.
    #[test]
    fn voxel_skip_saturates_inside_empty_block() {
        let chunk = Chunk::new(IVec3::ZERO);
        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());

        for x in 0..4 {
            for y in 0..4 {
                let bounds = voxel_skip_at(&naadf, x, y, 0);
                let expected_pos_x = 3 - x as u8;
                let expected_pos_y = 3 - y as u8;
                assert_eq!(
                    bounds.get_at_offset(BOUND_OFFSET_POS_X),
                    expected_pos_x,
                    "pos_x at ({x},{y},0)"
                );
                assert_eq!(
                    bounds.get_at_offset(BOUND_OFFSET_POS_Y),
                    expected_pos_y,
                    "pos_y at ({x},{y},0)"
                );
            }
        }
    }

    /// Wall at x=8 ⇒ the empty block (0,0,0) (covering x∈[0,3]) can extend its
    /// `+X` skip by exactly 1 block (covering [4,7]); block (1,0,0)'s `+X`
    /// neighbour is the wall block and so cannot extend.
    #[test]
    fn block_skip_extends_to_the_block_before_a_wall() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        for y in 0..16 {
            for z in 0..16 {
                chunk.set(UVec3::new(8, y, z), VoxelType::Rock);
            }
        }

        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        let block_corner = &naadf.blocks[block_index_in_chunk(UVec3::new(0, 0, 0))];
        let block_adjacent = &naadf.blocks[block_index_in_chunk(UVec3::new(1, 0, 0))];

        assert_eq!(
            block_corner
                .directional_skip_blocks
                .get_at_offset(BOUND_OFFSET_POS_X),
            1,
            "block (0,0,0) should extend +X by exactly 1 block before reaching the wall block"
        );
        assert_eq!(
            block_adjacent
                .directional_skip_blocks
                .get_at_offset(BOUND_OFFSET_POS_X),
            0,
            "block (1,0,0)'s +X neighbour is the wall block, so no extension"
        );
    }
}
