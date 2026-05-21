use crate::constants::{CHUNK_SIZE_I32, CHUNK_VOLUME};
use crate::terrain::generation::config::terrain_config_fingerprint;
use crate::voxel::chunk::{Chunk, ChunkData};
use crate::voxel::persistence::WorldData;
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;
use std::collections::HashMap;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoxelModelFormat {
    Vox,
    Vl32,
}

impl VoxelModelFormat {
    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension
            .trim_start_matches('.')
            .to_ascii_lowercase()
            .as_str()
        {
            "vox" => Some(Self::Vox),
            "vl32" => Some(Self::Vl32),
            _ => None,
        }
    }

    pub fn content_type(self) -> &'static str {
        match self {
            Self::Vox => "model/x-vox",
            Self::Vl32 => "model/x-vl32",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Vox => "vox",
            Self::Vl32 => "vl32",
        }
    }
}

#[derive(Debug, Error)]
pub enum VoxelModelIoError {
    #[error("Unsupported voxel model format.")]
    UnsupportedFormat,
    #[error("VL32 data length must be a multiple of 16 bytes.")]
    InvalidVl32Length,
    #[error("VOX file is missing the VOX magic header.")]
    InvalidVoxMagic,
    #[error("VOX file is truncated.")]
    TruncatedVox,
    #[error("VOX model coordinates exceed the 0..255 MagicaVoxel XYZI range.")]
    VoxModelTooLarge,
    #[error("Voxel model contains no solid voxels.")]
    EmptyModel,
}

#[derive(Clone, Copy, Debug)]
struct ModelVoxel {
    position: IVec3,
    color: [u8; 4],
}

pub fn import_world_data(
    format: VoxelModelFormat,
    bytes: &[u8],
) -> Result<WorldData, VoxelModelIoError> {
    let voxels = match format {
        VoxelModelFormat::Vox => read_vox(bytes)?,
        VoxelModelFormat::Vl32 => read_vl32(bytes)?,
    };

    model_voxels_to_world_data(&voxels)
}

pub fn export_world(
    format: VoxelModelFormat,
    world: &VoxelWorld,
) -> Result<Vec<u8>, VoxelModelIoError> {
    let voxels = world_model_voxels(world)?;
    match format {
        VoxelModelFormat::Vox => write_vox(&voxels),
        VoxelModelFormat::Vl32 => Ok(write_vl32(&voxels)),
    }
}

fn read_vl32(bytes: &[u8]) -> Result<Vec<ModelVoxel>, VoxelModelIoError> {
    if bytes.len() % 16 != 0 {
        return Err(VoxelModelIoError::InvalidVl32Length);
    }

    Ok(bytes
        .chunks_exact(16)
        .filter_map(|record| {
            let x = i32::from_be_bytes(record[0..4].try_into().ok()?);
            let y = i32::from_be_bytes(record[4..8].try_into().ok()?);
            let z = i32::from_be_bytes(record[8..12].try_into().ok()?);
            let color = [record[13], record[14], record[15], record[12]];
            (color[3] != 0).then_some(ModelVoxel {
                position: IVec3::new(x, y, z),
                color,
            })
        })
        .collect())
}

fn write_vl32(voxels: &[ModelVoxel]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(voxels.len() * 16);
    for voxel in voxels {
        bytes.extend_from_slice(&voxel.position.x.to_be_bytes());
        bytes.extend_from_slice(&voxel.position.y.to_be_bytes());
        bytes.extend_from_slice(&voxel.position.z.to_be_bytes());
        bytes.extend_from_slice(&[
            voxel.color[3],
            voxel.color[0],
            voxel.color[1],
            voxel.color[2],
        ]);
    }
    bytes
}

fn read_vox(bytes: &[u8]) -> Result<Vec<ModelVoxel>, VoxelModelIoError> {
    if bytes.len() < 8 || &bytes[0..4] != b"VOX " {
        return Err(VoxelModelIoError::InvalidVoxMagic);
    }

    let mut cursor = 8;
    let mut palette = default_palette();
    let mut voxels = Vec::new();

    while cursor < bytes.len() {
        read_vox_chunk(bytes, &mut cursor, &mut palette, &mut voxels)?;
    }

    Ok(voxels)
}

fn read_vox_chunk(
    bytes: &[u8],
    cursor: &mut usize,
    palette: &mut [[u8; 4]; 256],
    voxels: &mut Vec<ModelVoxel>,
) -> Result<(), VoxelModelIoError> {
    if bytes.len().saturating_sub(*cursor) < 12 {
        return Err(VoxelModelIoError::TruncatedVox);
    }

    let id = &bytes[*cursor..*cursor + 4];
    let content_size = read_u32_le(bytes, *cursor + 4)? as usize;
    let children_size = read_u32_le(bytes, *cursor + 8)? as usize;
    *cursor += 12;

    let content_start = *cursor;
    let content_end = content_start
        .checked_add(content_size)
        .ok_or(VoxelModelIoError::TruncatedVox)?;
    let children_end = content_end
        .checked_add(children_size)
        .ok_or(VoxelModelIoError::TruncatedVox)?;
    if children_end > bytes.len() {
        return Err(VoxelModelIoError::TruncatedVox);
    }

    if id == b"XYZI" {
        let count = read_u32_le(bytes, content_start)? as usize;
        let records_start = content_start + 4;
        let records_end = records_start
            .checked_add(count * 4)
            .ok_or(VoxelModelIoError::TruncatedVox)?;
        if records_end > content_end {
            return Err(VoxelModelIoError::TruncatedVox);
        }

        for record in bytes[records_start..records_end].chunks_exact(4) {
            let color_index = record[3] as usize;
            if color_index == 0 {
                continue;
            }
            let color = palette[color_index];
            if color[3] == 0 {
                continue;
            }
            voxels.push(ModelVoxel {
                position: IVec3::new(record[0] as i32, record[2] as i32, record[1] as i32),
                color,
            });
        }
    } else if id == b"RGBA" {
        if content_size < 256 * 4 {
            return Err(VoxelModelIoError::TruncatedVox);
        }
        for index in 0..256 {
            let offset = content_start + index * 4;
            let palette_index = index + 1;
            if palette_index < 256 {
                palette[palette_index] = [
                    bytes[offset],
                    bytes[offset + 1],
                    bytes[offset + 2],
                    bytes[offset + 3],
                ];
            }
        }
    }

    *cursor = content_end;
    while *cursor < children_end {
        read_vox_chunk(bytes, cursor, palette, voxels)?;
    }
    *cursor = children_end;
    Ok(())
}

fn write_vox(voxels: &[ModelVoxel]) -> Result<Vec<u8>, VoxelModelIoError> {
    let (min, max) = model_bounds(voxels)?;
    let size = max - min + IVec3::ONE;
    if size.x > 256 || size.y > 256 || size.z > 256 {
        return Err(VoxelModelIoError::VoxModelTooLarge);
    }

    let mut size_content = Vec::with_capacity(12);
    size_content.extend_from_slice(&size.x.to_le_bytes());
    size_content.extend_from_slice(&size.z.to_le_bytes());
    size_content.extend_from_slice(&size.y.to_le_bytes());

    let mut xyzi_content = Vec::with_capacity(4 + voxels.len() * 4);
    xyzi_content.extend_from_slice(&(voxels.len() as u32).to_le_bytes());
    for voxel in voxels {
        let position = voxel.position - min;
        xyzi_content.push(position.x as u8);
        xyzi_content.push(position.z as u8);
        xyzi_content.push(position.y as u8);
        xyzi_content.push(nearest_palette_index(voxel.color));
    }

    let mut rgba_content = Vec::with_capacity(256 * 4);
    let palette = default_palette();
    for index in 0..256 {
        let color = if index + 1 < 256 {
            palette[index + 1]
        } else {
            [0, 0, 0, 255]
        };
        rgba_content.extend_from_slice(&color);
    }

    let size_chunk = vox_chunk(*b"SIZE", &size_content, &[]);
    let xyzi_chunk = vox_chunk(*b"XYZI", &xyzi_content, &[]);
    let rgba_chunk = vox_chunk(*b"RGBA", &rgba_content, &[]);
    let mut children = Vec::new();
    children.extend_from_slice(&size_chunk);
    children.extend_from_slice(&xyzi_chunk);
    children.extend_from_slice(&rgba_chunk);

    let main_chunk = vox_chunk(*b"MAIN", &[], &children);
    let mut bytes = Vec::with_capacity(8 + main_chunk.len());
    bytes.extend_from_slice(b"VOX ");
    bytes.extend_from_slice(&150_u32.to_le_bytes());
    bytes.extend_from_slice(&main_chunk);
    Ok(bytes)
}

fn vox_chunk(id: [u8; 4], content: &[u8], children: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(12 + content.len() + children.len());
    bytes.extend_from_slice(&id);
    bytes.extend_from_slice(&(content.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&(children.len() as u32).to_le_bytes());
    bytes.extend_from_slice(content);
    bytes.extend_from_slice(children);
    bytes
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, VoxelModelIoError> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or(VoxelModelIoError::TruncatedVox)?;
    Ok(u32::from_le_bytes(
        slice
            .try_into()
            .map_err(|_| VoxelModelIoError::TruncatedVox)?,
    ))
}

fn model_voxels_to_world_data(voxels: &[ModelVoxel]) -> Result<WorldData, VoxelModelIoError> {
    let (min, max) = model_bounds(voxels)?;
    let size_voxels = max - min + IVec3::ONE;
    let size_chunks = IVec3::new(
        ceil_div_i32(size_voxels.x, CHUNK_SIZE_I32).max(1),
        ceil_div_i32(size_voxels.y, CHUNK_SIZE_I32).max(1),
        ceil_div_i32(size_voxels.z, CHUNK_SIZE_I32).max(1),
    );

    let mut chunk_voxels: HashMap<IVec3, [VoxelType; CHUNK_VOLUME]> = HashMap::new();
    for voxel in voxels {
        if voxel.color[3] == 0 {
            continue;
        }
        let position = voxel.position - min;
        let chunk_pos = VoxelWorld::world_to_chunk(position);
        let local = VoxelWorld::world_to_local(position);
        let entry = chunk_voxels
            .entry(chunk_pos)
            .or_insert([VoxelType::Air; CHUNK_VOLUME]);
        entry[Chunk::index(local.x as usize, local.y as usize, local.z as usize)] =
            nearest_voxel_type(voxel.color);
    }

    let mut chunks = Vec::new();
    for z in 0..size_chunks.z {
        for y in 0..size_chunks.y {
            for x in 0..size_chunks.x {
                let position = IVec3::new(x, y, z);
                let voxels = chunk_voxels
                    .remove(&position)
                    .unwrap_or([VoxelType::Air; CHUNK_VOLUME]);
                chunks.push(ChunkData {
                    voxels: voxels.to_vec(),
                    material_overrides: Vec::new(),
                    position,
                    face_visibility: Default::default(),
                });
            }
        }
    }

    Ok(WorldData {
        world_size_chunks: size_chunks,
        terrain_config_fingerprint: terrain_config_fingerprint(),
        chunks,
    })
}

fn world_model_voxels(world: &VoxelWorld) -> Result<Vec<ModelVoxel>, VoxelModelIoError> {
    let mut voxels = Vec::new();
    for (_, chunk) in world.chunk_entries() {
        let origin = VoxelWorld::chunk_to_world(chunk.position());
        for (local, voxel) in chunk.iter_solid() {
            if voxel == VoxelType::Air {
                continue;
            }
            voxels.push(ModelVoxel {
                position: origin + local.as_ivec3(),
                color: voxel_color(voxel),
            });
        }
    }

    if voxels.is_empty() {
        return Err(VoxelModelIoError::EmptyModel);
    }

    Ok(voxels)
}

fn model_bounds(voxels: &[ModelVoxel]) -> Result<(IVec3, IVec3), VoxelModelIoError> {
    let mut iter = voxels.iter().filter(|voxel| voxel.color[3] != 0);
    let first = iter.next().ok_or(VoxelModelIoError::EmptyModel)?.position;
    let mut min = first;
    let mut max = first;
    for voxel in iter {
        min = min.min(voxel.position);
        max = max.max(voxel.position);
    }
    Ok((min, max))
}

fn ceil_div_i32(value: i32, divisor: i32) -> i32 {
    (value + divisor - 1) / divisor
}

fn voxel_color(voxel: VoxelType) -> [u8; 4] {
    match voxel {
        VoxelType::Air => [0, 0, 0, 0],
        VoxelType::TopSoil => [78, 132, 54, 255],
        VoxelType::SubSoil => [98, 72, 48, 255],
        VoxelType::Rock => [118, 122, 128, 255],
        VoxelType::Bedrock => [52, 52, 60, 255],
        VoxelType::Sand => [196, 180, 126, 255],
        VoxelType::Clay => [154, 108, 88, 255],
        VoxelType::Water => [66, 154, 220, 180],
        VoxelType::Wood => [124, 78, 42, 255],
        VoxelType::Leaves => [68, 142, 62, 220],
        VoxelType::DungeonWall => [88, 84, 96, 255],
        VoxelType::DungeonFloor => [112, 96, 78, 255],
    }
}

fn nearest_voxel_type(color: [u8; 4]) -> VoxelType {
    const TYPES: [VoxelType; 11] = [
        VoxelType::TopSoil,
        VoxelType::SubSoil,
        VoxelType::Rock,
        VoxelType::Bedrock,
        VoxelType::Sand,
        VoxelType::Clay,
        VoxelType::Water,
        VoxelType::Wood,
        VoxelType::Leaves,
        VoxelType::DungeonWall,
        VoxelType::DungeonFloor,
    ];

    TYPES
        .into_iter()
        .min_by_key(|voxel| color_distance_sq(color, voxel_color(*voxel)))
        .unwrap_or(VoxelType::TopSoil)
}

fn nearest_palette_index(color: [u8; 4]) -> u8 {
    let voxel = nearest_voxel_type(color);
    voxel as u8
}

fn color_distance_sq(a: [u8; 4], b: [u8; 4]) -> u32 {
    let dr = a[0] as i32 - b[0] as i32;
    let dg = a[1] as i32 - b[1] as i32;
    let db = a[2] as i32 - b[2] as i32;
    (dr * dr + dg * dg + db * db) as u32
}

fn default_palette() -> [[u8; 4]; 256] {
    let mut palette = [[0, 0, 0, 255]; 256];
    for voxel in [
        VoxelType::TopSoil,
        VoxelType::SubSoil,
        VoxelType::Rock,
        VoxelType::Bedrock,
        VoxelType::Sand,
        VoxelType::Clay,
        VoxelType::Water,
        VoxelType::Wood,
        VoxelType::Leaves,
        VoxelType::DungeonWall,
        VoxelType::DungeonFloor,
    ] {
        palette[voxel as usize] = voxel_color(voxel);
    }
    palette
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vl32_round_trips_signed_coordinates_and_argb() {
        let input = vec![
            ModelVoxel {
                position: IVec3::new(-2, 5, 9),
                color: [124, 78, 42, 255],
            },
            ModelVoxel {
                position: IVec3::new(3, -4, 7),
                color: [66, 154, 220, 180],
            },
        ];

        let bytes = write_vl32(&input);
        let output = read_vl32(&bytes).unwrap();

        assert_eq!(output.len(), 2);
        assert_eq!(output[0].position, input[0].position);
        assert_eq!(output[0].color, input[0].color);
        assert_eq!(output[1].position, input[1].position);
        assert_eq!(output[1].color, input[1].color);
    }

    #[test]
    fn vox_round_trip_preserves_shape_and_material() {
        let input = vec![ModelVoxel {
            position: IVec3::new(1, 7, 2),
            color: voxel_color(VoxelType::Rock),
        }];

        let bytes = write_vox(&input).unwrap();
        let output = read_vox(&bytes).unwrap();

        assert_eq!(output.len(), 1);
        assert_eq!(output[0].position, IVec3::ZERO);
        assert_eq!(nearest_voxel_type(output[0].color), VoxelType::Rock);
    }

    #[test]
    fn import_normalizes_negative_coordinates_to_origin_chunks() {
        let input = vec![ModelVoxel {
            position: IVec3::new(-3, -1, 4),
            color: voxel_color(VoxelType::Wood),
        }];

        let data = model_voxels_to_world_data(&input).unwrap();
        assert_eq!(data.world_size_chunks, IVec3::ONE);
        assert_eq!(
            data.chunks[0].voxels[Chunk::index(0, 0, 0)],
            VoxelType::Wood
        );
    }
}
