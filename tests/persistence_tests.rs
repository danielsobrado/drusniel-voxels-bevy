//! Tests for world persistence error types.

use bevy::math::{IVec3, UVec3};
use std::fs::File;
use std::io;
use tempfile::tempdir;
use voxel_builder::voxel::chunk::{Chunk, FaceVisibility};
use voxel_builder::voxel::persistence::{
    PersistenceError, WorldData, editor_export_world_metadata_from_path,
    editor_get_chunk_summaries_from_path, editor_load_world_from_path, load_world_from_path,
    read_world_data_from_path, save_world_to_path,
};
use voxel_builder::voxel::types::VoxelType;
use voxel_builder::voxel::world::VoxelWorld;

fn sample_world() -> VoxelWorld {
    let mut world = VoxelWorld::new(IVec3::new(2, 1, 1));

    let mut origin = Chunk::new(IVec3::ZERO);
    origin.set(UVec3::new(1, 2, 3), VoxelType::Rock);
    origin.set(UVec3::new(4, 5, 6), VoxelType::Water);
    origin.set_face_visibility(FaceVisibility::all_connected());
    world.insert_chunk(origin);

    let mut neighbor = Chunk::new(IVec3::X);
    neighbor.set(UVec3::new(7, 8, 9), VoxelType::Sand);
    neighbor.set_face_visibility(FaceVisibility::none_connected());
    world.insert_chunk(neighbor);

    world
}

#[test]
fn file_access_error_displays_path_and_source() {
    let source = io::Error::new(io::ErrorKind::NotFound, "file not found");
    let error = PersistenceError::FileAccess {
        path: "/test/path.bin".to_string(),
        source,
    };

    let msg = error.to_string();
    assert!(msg.contains("/test/path.bin"));
    assert!(msg.contains("file not found") || msg.contains("access"));
}

#[test]
fn not_found_error_displays_path() {
    let error = PersistenceError::NotFound("/missing/world.bin".to_string());

    let msg = error.to_string();
    assert!(msg.contains("/missing/world.bin"));
    assert!(msg.contains("No saved world") || msg.contains("not found"));
}

#[test]
fn delete_failed_error_displays_path() {
    let source = io::Error::new(io::ErrorKind::PermissionDenied, "access denied");
    let error = PersistenceError::DeleteFailed {
        path: "/locked/file.bin".to_string(),
        source,
    };

    let msg = error.to_string();
    assert!(msg.contains("/locked/file.bin"));
}

#[test]
fn persistence_error_is_send_and_sync() {
    fn assert_send<T: Send>() {}
    fn assert_sync<T: Sync>() {}

    assert_send::<PersistenceError>();
    assert_sync::<PersistenceError>();
}

#[test]
fn persistence_error_implements_error_trait() {
    fn assert_error<T: std::error::Error>() {}

    assert_error::<PersistenceError>();
}

#[test]
fn file_access_error_has_source() {
    use std::error::Error;

    let io_error = io::Error::new(io::ErrorKind::NotFound, "test");
    let error = PersistenceError::FileAccess {
        path: "test.bin".to_string(),
        source: io_error,
    };

    assert!(error.source().is_some());
}

#[test]
fn bincode_error_converts_to_serialization_error() {
    // Create a bincode error by trying to deserialize invalid data
    let bad_data = vec![0xFF, 0xFF, 0xFF];
    let result: Result<String, bincode::Error> = bincode::deserialize(&bad_data);

    if let Err(bincode_err) = result {
        let persistence_err: PersistenceError = bincode_err.into();

        match persistence_err {
            PersistenceError::Serialization(_) => {}
            _ => panic!("Expected Serialization variant"),
        }
    }
}

#[test]
fn world_saves_to_path() {
    let dir = tempdir().expect("tempdir should be created");
    let path = dir.path().join("world_data.bin");
    let world = sample_world();

    save_world_to_path(&world, &path).expect("world should save");

    assert!(path.exists());
    let data = read_world_data_from_path(&path).expect("saved world data should deserialize");
    assert_eq!(data.world_size_chunks, IVec3::new(2, 1, 1));
    assert_eq!(data.chunks.len(), 2);
}

#[test]
fn world_loads_from_path() {
    let dir = tempdir().expect("tempdir should be created");
    let path = dir.path().join("world_data.bin");
    let world = sample_world();
    save_world_to_path(&world, &path).expect("world should save");

    let loaded = load_world_from_path(&path).expect("world should load");

    assert_eq!(loaded.world_size_chunks(), IVec3::new(2, 1, 1));
    assert_eq!(loaded.chunk_count(), 2);
    assert_eq!(
        loaded.sample_voxel_raw(IVec3::new(1, 2, 3)),
        Some(VoxelType::Rock)
    );
    assert_eq!(
        loaded.sample_voxel_raw(IVec3::new(4, 5, 6)),
        Some(VoxelType::Water)
    );
    assert_eq!(
        loaded.sample_voxel_raw(IVec3::new(16 + 7, 8, 9)),
        Some(VoxelType::Sand)
    );
}

#[test]
fn terrain_fingerprint_mismatch_is_handled() {
    let dir = tempdir().expect("tempdir should be created");
    let path = dir.path().join("world_data.bin");
    let mut data = sample_world().to_data();
    data.terrain_config_fingerprint ^= 1;

    let file = File::create(&path).expect("test save file should be created");
    bincode::serialize_into(file, &data).expect("mismatched world data should serialize");

    let Err(error) = load_world_from_path(&path) else {
        panic!("load should reject a mismatched terrain fingerprint");
    };

    match error {
        PersistenceError::TerrainFingerprintMismatch { saved, current } => {
            assert_eq!(saved, data.terrain_config_fingerprint);
            assert_ne!(saved, current);
        }
        other => panic!("expected terrain fingerprint mismatch, got {other:?}"),
    }

    let editor_result = editor_load_world_from_path(&path);
    assert!(!editor_result.loaded);
    assert_eq!(
        editor_result.error_kind.as_deref(),
        Some("TerrainFingerprintMismatch")
    );
}

#[test]
fn chunk_data_roundtrips_in_world_save_format() {
    let original = sample_world();
    let bytes = bincode::serialize(&original.to_data()).expect("world data should serialize");
    let restored_data: WorldData =
        bincode::deserialize(&bytes).expect("world data should deserialize");
    let restored = VoxelWorld::from_data(restored_data);

    assert_eq!(restored.world_size_chunks(), IVec3::new(2, 1, 1));
    assert_eq!(restored.chunk_count(), 2);
    assert_eq!(
        restored.sample_voxel_raw(IVec3::new(1, 2, 3)),
        Some(VoxelType::Rock)
    );
    assert_eq!(
        restored
            .get_chunk(IVec3::X)
            .expect("neighbor chunk should exist")
            .face_visibility(),
        FaceVisibility::none_connected()
    );
}

#[test]
fn missing_save_returns_not_found() {
    let dir = tempdir().expect("tempdir should be created");
    let path = dir.path().join("missing-world.bin");

    let Err(error) = load_world_from_path(&path) else {
        panic!("missing save should not load");
    };

    match error {
        PersistenceError::NotFound(missing_path) => {
            assert!(missing_path.ends_with("missing-world.bin"));
        }
        other => panic!("expected NotFound, got {other:?}"),
    }
}

#[test]
fn editor_metadata_and_chunk_summaries_describe_existing_format() {
    let dir = tempdir().expect("tempdir should be created");
    let path = dir.path().join("world_data.bin");
    let world = sample_world();
    save_world_to_path(&world, &path).expect("world should save");

    let metadata =
        editor_export_world_metadata_from_path(&path).expect("metadata should deserialize");
    assert_eq!(metadata.world_size_chunks, [2, 1, 1]);
    assert_eq!(metadata.chunk_count, 2);
    assert!(metadata.includes_voxels);
    assert!(metadata.includes_chunk_positions);
    assert!(metadata.includes_face_visibility);
    assert!(!metadata.includes_props);
    assert!(!metadata.includes_water_overrides);
    assert!(!metadata.includes_protected_areas);
    assert!(metadata.on_disk_format_version.is_none());

    let summaries =
        editor_get_chunk_summaries_from_path(&path).expect("chunk summaries should load");
    assert_eq!(summaries.len(), 2);
    assert!(summaries.iter().any(|summary| {
        summary.position == [0, 0, 0]
            && summary.non_air_voxels == 2
            && summary.water_voxels == 1
            && summary.face_visibility_mask == FaceVisibility::all_connected().0
    }));
    assert!(summaries.iter().any(|summary| {
        summary.position == [1, 0, 0]
            && summary.non_air_voxels == 1
            && summary.face_visibility_mask == FaceVisibility::none_connected().0
    }));
}
