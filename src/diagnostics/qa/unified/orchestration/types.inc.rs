#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum CommandTarget {
    ClodPoc,
    Bevy,
    All,
}

impl CommandTarget {
    fn accepts(self, target: Target) -> bool {
        matches!(self, Self::All)
            || matches!((self, target), (Self::ClodPoc, Target::ClodPoc) | (Self::Bevy, Target::Bevy))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    File,
    Directory,
    Json,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandArtifact {
    pub path: String,
    pub required: bool,
    pub deterministic: bool,
    pub kind: ArtifactKind,
    #[serde(default)]
    pub ignore_json_keys: Vec<String>,
    #[serde(default)]
    pub numeric_tolerance: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandDefinition {
    pub id: String,
    pub target: CommandTarget,
    pub lane: Lane,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub timeout_ms: u64,
    pub continue_on_failure: bool,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
    #[serde(default)]
    pub placeholders: Vec<String>,
    #[serde(default)]
    pub artifacts: Vec<CommandArtifact>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CommandManifestFile {
    command_allowlist: CommandManifest,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CommandManifest {
    schema_version: u32,
    commands: Vec<CommandDefinition>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BatteryLane {
    pub id: String,
    pub target: CommandTarget,
    pub authoritative: bool,
    pub commands: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BatteryDefinition {
    pub id: String,
    pub description: String,
    pub targets: Vec<Target>,
    pub lanes: Vec<String>,
    #[serde(default)]
    pub scenes: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BatteryManifestFile {
    qa_batteries: BatteryManifest,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BatteryManifest {
    schema_version: u32,
    lanes: Vec<BatteryLane>,
    batteries: Vec<BatteryDefinition>,
}

#[derive(Clone, Debug)]
pub struct OrchestrationRegistry {
    pub commands: BTreeMap<String, CommandDefinition>,
    pub lanes: BTreeMap<String, BatteryLane>,
    pub batteries: BTreeMap<String, BatteryDefinition>,
}

#[derive(Debug, Error)]
pub enum OrchestrationError {
    #[error("failed to read orchestration manifest {path}: {source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("failed to parse orchestration manifest {path}: {source}")]
    Parse { path: PathBuf, source: serde_yaml::Error },
    #[error("orchestration manifest {path} has unsupported schema version {version}")]
    Schema { path: PathBuf, version: u32 },
    #[error("invalid orchestration contract: {0}")]
    Invalid(String),
    #[error("failed to create QA output {path}: {source}")]
    CreateDir { path: PathBuf, source: std::io::Error },
    #[error("failed to create command log {path}: {source}")]
    CreateLog { path: PathBuf, source: std::io::Error },
    #[error("failed to spawn command '{command}': {source}")]
    Spawn { command: String, source: std::io::Error },
    #[error("failed while waiting for command '{command}': {source}")]
    Wait { command: String, source: std::io::Error },
    #[error("failed to terminate timed-out command '{command}': {source}")]
    Kill { command: String, source: std::io::Error },
    #[error("failed to serialize QA battery report: {0}")]
    Serialize(serde_json::Error),
    #[error("failed to write QA battery report {path}: {source}")]
    WriteReport { path: PathBuf, source: std::io::Error },
}

#[derive(Clone, Debug)]
pub struct BatteryRunOptions {
    pub repository_root: PathBuf,
    pub output_dir: PathBuf,
    pub run_index: u32,
    pub battery_id: String,
    pub target: Option<Target>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CommandResult {
    pub command_id: String,
    pub scene_id: String,
    pub target: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub stdout_log: String,
    pub stderr_log: String,
    pub missing_artifacts: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BatteryReport {
    pub schema_version: u32,
    pub battery_id: String,
    pub run_index: u32,
    pub status: String,
    pub generated_unix_ms: u128,
    pub targets: Vec<String>,
    pub scenes: Vec<String>,
    pub commands: Vec<CommandResult>,
    pub failures: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ArtifactPath {
    pub path: PathBuf,
    pub kind: ArtifactKind,
    pub ignore_json_keys: Vec<String>,
    pub numeric_tolerance: f64,
}

#[derive(Clone, Debug)]
struct PlanItem {
    command_id: String,
    scene_id: String,
    target: Target,
}

#[derive(Clone, Debug)]
struct TemplateContext {
    repository_root: PathBuf,
    output_dir: PathBuf,
    run_index: u32,
    scene_id: String,
    target: Target,
}
