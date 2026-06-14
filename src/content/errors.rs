use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug, Clone, Serialize, Deserialize)]
pub enum ContentLoadError {
    #[error("Failed to read content file {path}: {error}")]
    IoError { path: String, error: String },
    #[error("Failed to parse YAML file {path}: {error}")]
    YamlError { path: String, error: String },
}

#[derive(Error, Debug, Clone, Serialize, Deserialize)]
#[error("Content validation failed: {code} at {path}: {message}")]
pub struct ContentValidationError {
    pub code: String,
    pub path: String,
    pub message: String,
}

impl ContentValidationError {
    pub fn new(code: &str, path: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            path: path.to_string(),
            message: message.to_string(),
        }
    }
}
