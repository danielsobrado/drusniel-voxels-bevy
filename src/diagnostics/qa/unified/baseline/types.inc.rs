#[derive(Clone, Debug)]
pub struct BaselineOptions {
    pub repository_root: PathBuf,
    pub run_root: PathBuf,
    pub visual_manifest: PathBuf,
    pub performance_manifest: PathBuf,
    pub scene_ids: Vec<String>,
    pub approve: bool,
    pub allow_ci: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct BaselineAuthority {
    pub schema_version: u32,
    pub scene_id: String,
    pub target: String,
    pub repository_commit_sha: String,
    pub branch: String,
    pub working_tree_dirty: bool,
    pub baseline_version: u32,
    pub image_sha256: String,
    pub manifest_sha256: String,
    pub environment: Value,
    pub promoted_unix_ms: u128,
}

#[derive(Debug, Error)]
pub enum BaselineError {
    #[error("baseline update requires --approve")]
    ApprovalRequired,
    #[error("baseline updates are forbidden in CI without --allow-ci")]
    CiForbidden,
    #[error("baseline authority check failed: {0}")]
    Authority(String),
    #[error("failed to read baseline input {path}: {source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("failed to parse baseline input {path}: {source}")]
    Parse { path: PathBuf, source: serde_json::Error },
    #[error("failed to parse baseline manifest {path}: {source}")]
    YamlParse { path: PathBuf, source: serde_yaml::Error },
    #[error("failed to serialize baseline manifest: {0}")]
    YamlSerialize(serde_yaml::Error),
    #[error("failed to create baseline directory {path}: {source}")]
    CreateDir { path: PathBuf, source: std::io::Error },
    #[error("failed to copy baseline artifact {source_path} -> {destination}: {source}")]
    Copy {
        source_path: PathBuf,
        destination: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to replace baseline artifact {path}: {source}")]
    Rename { path: PathBuf, source: std::io::Error },
    #[error("failed to write baseline metadata {path}: {source}")]
    Write { path: PathBuf, source: std::io::Error },
    #[error("failed to serialize baseline metadata: {0}")]
    Serialize(serde_json::Error),
    #[error(transparent)]
    Sha256(#[from] Sha256Error),
}

#[derive(Clone, Debug)]
struct GitAuthority {
    branch: String,
    head: String,
}

#[derive(Clone, Debug)]
struct Promotion {
    scene: Scene,
    source_image: PathBuf,
    source_stats: PathBuf,
    source_metrics: PathBuf,
    image_target: PathBuf,
    stats_target: PathBuf,
    metrics_target: PathBuf,
    image_hash: String,
}
