//! Tests for world persistence error types.

use voxel_builder::voxel::persistence::PersistenceError;
use std::io;

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
