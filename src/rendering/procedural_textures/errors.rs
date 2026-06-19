use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProceduralTextureError {
    #[error("failed to read procedural texture config {path}: {source}")]
    ReadConfig {
        path: String,
        source: std::io::Error,
    },
    #[error("failed to parse procedural texture config {path}: {source}")]
    ParseConfig {
        path: String,
        source: serde_yaml::Error,
    },
    #[error("failed to read procedural texture manifest {path}: {source}")]
    ReadManifest {
        path: String,
        source: std::io::Error,
    },
    #[error("failed to parse procedural texture manifest {path}: {source}")]
    ParseManifest {
        path: String,
        source: serde_json::Error,
    },
    #[error("failed to serialize procedural texture manifest: {0}")]
    SerializeManifest(serde_json::Error),
    #[error("failed to write procedural texture cache {path}: {source}")]
    WriteCache {
        path: String,
        source: std::io::Error,
    },
    #[error("failed to write procedural texture image {path}: {source}")]
    WriteImage {
        path: String,
        source: image::ImageError,
    },
    #[error("procedural texture cache is missing or stale in cache_only mode")]
    CacheOnlyMissing,
}
