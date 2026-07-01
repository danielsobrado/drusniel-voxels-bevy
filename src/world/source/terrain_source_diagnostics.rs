use serde::{Deserialize, Serialize};

use super::terrain_source_config::{TerrainSourceConfig, TerrainSourceMode};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerrainSourceRuntimePath {
    GpuWorldSource,
    CpuWorldSourceReference,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerrainSourceSelectionReason {
    DefaultGpu,
    ExplicitCpuReference,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerrainSourceStartupReport {
    pub configured_mode: TerrainSourceMode,
    pub runtime_path: TerrainSourceRuntimePath,
    pub selection_reason: TerrainSourceSelectionReason,
    pub gpu_default_runtime: bool,
    pub opt_in_non_gpu: bool,
}

impl TerrainSourceStartupReport {
    pub fn from_config(config: &TerrainSourceConfig) -> Self {
        match config.mode {
            TerrainSourceMode::GpuWorldSource => Self {
                configured_mode: TerrainSourceMode::GpuWorldSource,
                runtime_path: TerrainSourceRuntimePath::GpuWorldSource,
                selection_reason: TerrainSourceSelectionReason::DefaultGpu,
                gpu_default_runtime: true,
                opt_in_non_gpu: false,
            },
            TerrainSourceMode::CpuWorldSourceReference => Self {
                configured_mode: TerrainSourceMode::CpuWorldSourceReference,
                runtime_path: TerrainSourceRuntimePath::CpuWorldSourceReference,
                selection_reason: TerrainSourceSelectionReason::ExplicitCpuReference,
                gpu_default_runtime: false,
                opt_in_non_gpu: true,
            },
        }
    }

    pub fn acceptance_label(&self) -> &'static str {
        match self.runtime_path {
            TerrainSourceRuntimePath::GpuWorldSource => "gpu_world_source",
            TerrainSourceRuntimePath::CpuWorldSourceReference => "cpu_world_source_reference",
        }
    }
}

pub fn terrain_source_startup_report(config: &TerrainSourceConfig) -> TerrainSourceStartupReport {
    TerrainSourceStartupReport::from_config(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpu_world_source_is_the_default_runtime_path() {
        let report = TerrainSourceStartupReport::from_config(&TerrainSourceConfig::default());

        assert_eq!(
            report.runtime_path,
            TerrainSourceRuntimePath::GpuWorldSource
        );
        assert_eq!(
            report.selection_reason,
            TerrainSourceSelectionReason::DefaultGpu
        );
        assert!(report.gpu_default_runtime);
        assert!(!report.opt_in_non_gpu);
        assert_eq!(report.acceptance_label(), "gpu_world_source");
    }

    #[test]
    fn cpu_reference_is_explicit_opt_in() {
        let report = TerrainSourceStartupReport::from_config(&TerrainSourceConfig {
            mode: TerrainSourceMode::CpuWorldSourceReference,
        });

        assert_eq!(
            report.runtime_path,
            TerrainSourceRuntimePath::CpuWorldSourceReference
        );
        assert_eq!(
            report.selection_reason,
            TerrainSourceSelectionReason::ExplicitCpuReference
        );
        assert!(!report.gpu_default_runtime);
        assert!(report.opt_in_non_gpu);
        assert_eq!(report.acceptance_label(), "cpu_world_source_reference");
    }
}
