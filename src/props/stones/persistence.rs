use std::fs;
use std::path::PathBuf;

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

use super::config::{StoneClassId, StoneConfig};
use super::constants::STONES_SCHEMA_VERSION;
use super::rock_mesh::RockPreset;
use super::scatter::StoneInstance;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct StoneChunkFile {
    schema_version: u32,
    config_hash: u64,
    terrain_fingerprint: u64,
    chunk: [i32; 2],
    instances: Vec<StoneInstanceFile>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
struct StoneInstanceFile {
    position: [f32; 3],
    scale: f32,
    yaw: f32,
    lean: [f32; 2],
    class_id: StoneClassId,
    preset: RockPreset,
    variant: u8,
    seed: u64,
}

pub fn load_chunk(
    config: &StoneConfig,
    chunk: IVec2,
    config_hash: u64,
    terrain_fingerprint: u64,
) -> Option<Vec<StoneInstance>> {
    let path = chunk_path(config, chunk);
    let bytes = fs::read(path).ok()?;
    let file: StoneChunkFile = serde_yaml::from_slice(&bytes).ok()?;
    if file.schema_version != STONES_SCHEMA_VERSION
        || file.config_hash != config_hash
        || file.terrain_fingerprint != terrain_fingerprint
        || file.chunk != [chunk.x, chunk.y]
    {
        return None;
    }
    Some(
        file.instances
            .into_iter()
            .map(StoneInstance::from)
            .collect(),
    )
}

pub fn save_chunk(
    config: &StoneConfig,
    chunk: IVec2,
    config_hash: u64,
    terrain_fingerprint: u64,
    instances: &[StoneInstance],
) -> Result<(), std::io::Error> {
    let path = chunk_path(config, chunk);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = StoneChunkFile {
        schema_version: STONES_SCHEMA_VERSION,
        config_hash,
        terrain_fingerprint,
        chunk: [chunk.x, chunk.y],
        instances: instances
            .iter()
            .copied()
            .map(StoneInstanceFile::from)
            .collect(),
    };
    let yaml = serde_yaml::to_string(&file).map_err(std::io::Error::other)?;
    fs::write(path, yaml)
}

pub fn delete_chunk(config: &StoneConfig, chunk: IVec2) {
    let _ = fs::remove_file(chunk_path(config, chunk));
}

fn chunk_path(config: &StoneConfig, chunk: IVec2) -> PathBuf {
    let mut path = PathBuf::from("saves");
    path.push("props");
    path.push(config.save_directory.trim_matches(['/', '\\']));
    path.push(format!("chunk-{}-{}.yaml", chunk.x, chunk.y));
    path
}

impl From<StoneInstanceFile> for StoneInstance {
    fn from(value: StoneInstanceFile) -> Self {
        Self {
            position: Vec3::from_array(value.position),
            scale: value.scale,
            yaw: value.yaw,
            lean: Vec2::from_array(value.lean),
            class_id: value.class_id,
            preset: value.preset,
            variant: value.variant,
            seed: value.seed,
        }
    }
}

impl From<StoneInstance> for StoneInstanceFile {
    fn from(value: StoneInstance) -> Self {
        Self {
            position: value.position.to_array(),
            scale: value.scale,
            yaw: value.yaw,
            lean: value.lean.to_array(),
            class_id: value.class_id,
            preset: value.preset,
            variant: value.variant,
            seed: value.seed,
        }
    }
}
