use std::collections::BTreeMap;
use std::fmt;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VisualManifestFile {
    pub visual_regression: VisualManifest,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceManifestFile {
    pub performance_regression: PerformanceManifest,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LegacyMapFile {
    pub legacy_id_map: Vec<LegacyMapEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LegacyMapEntry {
    pub legacy: String,
    pub canonical: String,
    pub kind: LegacyIdKind,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LegacyIdKind {
    Scene,
    Probe,
    Timing,
    Counter,
    Informational,
}

impl fmt::Display for LegacyIdKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Scene => "scene",
            Self::Probe => "probe",
            Self::Timing => "timing",
            Self::Counter => "counter",
            Self::Informational => "informational",
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VisualManifest {
    pub schema_version: u32,
    pub baseline_version: u32,
    pub default_target: Target,
    pub output_root: PathBuf,
    pub scenes: Vec<Scene>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceManifest {
    pub schema_version: u32,
    pub default_target: Target,
    pub output_root: PathBuf,
    pub scenes: Vec<Scene>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Target {
    ClodPoc,
    Bevy,
}

impl Target {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ClodPoc => "clod-poc",
            Self::Bevy => "bevy",
        }
    }
}

impl fmt::Display for Target {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Lane {
    Static,
    Gpu,
    Full,
}

impl Lane {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Static => "static",
            Self::Gpu => "gpu",
            Self::Full => "full",
        }
    }
}

impl fmt::Display for Lane {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Scene {
    pub id: String,
    pub target: Target,
    pub lane: Lane,
    pub enabled: bool,
    pub tags: Vec<String>,
    pub launch: Launch,
    pub settle: Settle,
    pub capture: Capture,
    pub baseline: Baseline,
    pub image_gates: ImageGates,
    #[serde(default)]
    pub region_probes: Vec<RegionProbe>,
    #[serde(default)]
    pub timing_gates: Vec<TimingGate>,
    #[serde(default)]
    pub counter_gates: Vec<CounterGate>,
    #[serde(default)]
    pub informational_metrics: Vec<InformationalMetric>,
    #[serde(default)]
    pub specialized_commands: Vec<String>,
}

impl Scene {
    pub fn reproduction_command(&self) -> String {
        match self.target {
            Target::Bevy => format!(
                "cargo run --bin qa -- --scene {} --run-bench",
                self.id
            ),
            Target::ClodPoc => format!(
                "npm --prefix tools/clod-poc run visual:regression -- --scene {}",
                self.id
            ),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Launch {
    pub world_seed: i64,
    pub world_mode: String,
    pub scene: String,
    pub quality: String,
    pub render_resolution_preset: String,
    pub viewport: [u32; 2],
    pub device_pixel_ratio: f64,
    pub camera: Camera,
    pub lighting: Lighting,
    pub weather: Weather,
    pub flags: BTreeMap<String, serde_yaml::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Camera {
    pub position: [f64; 3],
    pub yaw_deg: f64,
    pub pitch_deg: f64,
    pub fov_y_deg: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Lighting {
    pub time_of_day_hours: f64,
    pub sun_elevation_deg: f64,
    pub sun_azimuth_deg: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Weather {
    pub wind_time_s: f64,
    pub cloud_time_s: f64,
    pub particle_time_s: f64,
    pub precipitation: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Settle {
    pub ready_timeout_ms: u64,
    pub warmup_frames: u32,
    pub settle_frames: u32,
    pub freeze_after_settle: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Capture {
    pub checkpoint: String,
    pub image: String,
    pub include_hud: bool,
    pub include_debug_overlays: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Baseline {
    pub image: PathBuf,
    pub stats: PathBuf,
    pub metrics: PathBuf,
    pub mask: Option<PathBuf>,
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ImageGates {
    pub required: bool,
    pub changed_pixel_threshold: f64,
    pub mean_absolute_error_max: f64,
    pub p95_absolute_error_max: f64,
    pub changed_pixel_fraction_max: f64,
    pub edge_error_mean_max: f64,
    pub luminance_mean_delta_max: f64,
    pub luminance_stddev_delta_max: f64,
    pub chroma_mean_delta_max: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RegionProbe {
    pub id: String,
    pub rect_normalized: [f64; 4],
    pub gates: BTreeMap<String, NumericRange>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NumericRange {
    pub min: Option<f64>,
    pub max: Option<f64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Enforcement {
    Required,
    Advisory,
}

impl Enforcement {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Required => "required",
            Self::Advisory => "advisory",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TimingGate {
    pub id: String,
    pub metric: String,
    pub max: f64,
    pub enforcement: Enforcement,
    pub required: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CounterOperator {
    Equals,
    Min,
    Max,
    Between,
}

impl CounterOperator {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Equals => "equals",
            Self::Min => "min",
            Self::Max => "max",
            Self::Between => "between",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CounterGate {
    pub id: String,
    pub key: String,
    pub operator: CounterOperator,
    pub value: Option<f64>,
    pub range: Option<[f64; 2]>,
    pub required: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InformationalMetric {
    pub id: String,
    pub key: String,
    pub required: bool,
}
