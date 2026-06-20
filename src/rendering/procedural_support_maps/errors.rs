use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProceduralSupportMapError {
    #[error("failed to read procedural support map config {path}: {source}")]
    ReadConfig {
        path: String,
        source: std::io::Error,
    },
    #[error("failed to parse procedural support map config {path}: {source}")]
    ParseConfig {
        path: String,
        source: serde_yaml::Error,
    },
    #[error("failed to read procedural support map manifest {path}: {source}")]
    ReadManifest {
        path: String,
        source: std::io::Error,
    },
    #[error("failed to parse procedural support map manifest {path}: {source}")]
    ParseManifest {
        path: String,
        source: serde_json::Error,
    },
    #[error("failed to serialize procedural support map manifest: {0}")]
    SerializeManifest(serde_json::Error),
    #[error("failed to write procedural support map cache {path}: {source}")]
    WriteCache {
        path: String,
        source: std::io::Error,
    },
    #[error("failed to write procedural support map image {path}: {source}")]
    WriteImage {
        path: String,
        source: image::ImageError,
    },
    #[error("procedural support map cache is missing or stale in cache_only mode")]
    CacheOnlyMissing,
}
