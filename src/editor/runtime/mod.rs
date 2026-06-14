pub mod handlers;
pub mod plugin;
pub mod protocol;
pub mod queue;
pub mod snapshot;
pub mod validation;

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use bevy::camera::ScalingMode;
use bevy::core_pipeline::prepass::{DepthPrepass, NormalPrepass};
use bevy::light::VolumetricLight;
use bevy::pbr::ScreenSpaceAmbientOcclusion;
use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::atmosphere::{FogConfig, FogPreset, FogQuality, FogQualityTier};
use crate::camera::controller::{
    CameraMode, EditorCameraInteractionMode, EditorCameraKind, EditorCameraPose,
    EditorCameraProjection, EditorCameraState, EditorSavedCamera, PlayerCamera,
};
use crate::constants::CHUNK_SIZE_I32;
use crate::editor_diagnostics::{
    EditorDiagnosticsCategory, EditorDiagnosticsState, normalize_editor_diagnostics_categories,
};
use crate::environment::{
    AtmosphereSettings, DEFAULT_SUN_ILLUMINANCE, light_angles_from_direction,
};
use crate::interaction::{
    DebugDetailToggles, DebugOverlayState, SelectedBlock, SelectedProp, TargetedBlock,
};
use crate::props::billboard::{BillboardLod, BillboardStats};
use crate::props::instanced_render::PropBoundsDebugSettings;
use crate::props::lod_material::PropLodState;
use crate::props::{Prop, PropAssets, PropChunkOwner, PropType};
use crate::rendering::ao_config::AmbientOcclusionConfig;
use crate::rendering::array_loader::{AtlasMapping, BlockAtlasMap};
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::cinematic::{
    CinematicCamera, CinematicState, dof_component, motion_blur_component,
};
use crate::rendering::cinematic_config::CinematicConfig;
use crate::rendering::god_rays::GodRayConfig;
use crate::rendering::gtao::{GtaoSettings, gtao_settings_from_config};
use crate::rendering::photo_mode::PhotoModeState;
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::ray_tracing::RayTracingSettings;
use crate::rendering::shadow_budget::ShadowBudgetConfig;
use crate::rendering::ssao::SsaoSupported;
use crate::rendering::terrain_hex_tiling::{
    TerrainTexturingConfig, terrain_texturing_editor_payload,
};
use crate::rendering::triplanar_material::{
    TerrainMaterialQuality, TriplanarMaterial, TriplanarMaterialHandle,
};
use crate::rendering::water_reflection::{
    WaterPresence, WaterReflectionConfig, WaterReflectionDebugViewMode, WaterReflectionStatus,
};
use crate::rendering::water_visual_probe::WaterVisualDebugState;
use crate::terrain::generation::config::{
    AquiferConfig, BasinConfig, MountainConfig, NoiseLayer, RiverConfig, TerrainConfig,
    terrain_config_fingerprint,
};
use crate::voxel::chunk::{LodLevel, MeshDirtyReason};
use crate::voxel::materials::{
    MaterialCatalog, MaterialId, MaterialReplaceSummary, VoxelMaterialDefinition,
};
use crate::voxel::meshing::{
    ChunkMesh, TerrainMeshDebug, WaterBodyId, WaterBodyKind, WaterBodyMaterialMode,
};
use crate::voxel::persistence;
use crate::voxel::plugin::WaterBodyRegistry;
use crate::voxel::terrain::{
    Biome, BiomeTable, GeneratedWaterBodyKind, TerrainGenerator, ValueNoise,
};
use crate::voxel::types::VoxelType;
use crate::voxel::world::{VoxelEditResult, VoxelWorld};
use crate::world_rules::{
    ProtectedArea, ProtectedAreaPatch, ProtectedAreaRegistry, ProtectedEditIntent,
    WORLD_RULES_PATH, validate_protected_area,
};

const ATLAS_TILE_COUNT: u32 = 64;
const EDITOR_PLACED_PROPS_SAVE_PATH: &str = "saves/editor_placed_props.json";
const EDITOR_LIGHTS_SAVE_PATH: &str = "saves/editor_lights.json";
const EDITOR_CAMERA_TEMPLATE_SCHEMA: &str = "drusniel.camera-template.v1";
const LIGHT_ATMOSPHERE_TEMPLATE_SCHEMA: &str = "drusniel.light-atmosphere-template.v1";
const TERRAIN_PREVIEW_MIN_RESOLUTION: u32 = 4;
const TERRAIN_PREVIEW_MAX_RESOLUTION: u32 = 128;
const TERRAIN_PREVIEW_MAX_SIZE_VOXELS: u32 = 2048;
const TERRAIN_PREVIEW_MAX_CELLS: u32 = 16_384;
const TERRAIN_PREVIEW_MAX_OCTAVES: u32 = 16;
const MATERIAL_REPLACE_SYNC_CHUNK_LIMIT: usize = 256;
const MATERIAL_REPLACE_CHUNKS_PER_FRAME: usize = 32;

pub struct RuntimeWriteCommandPlugin;

#[derive(Resource, Clone, Debug, PartialEq, Eq)]
pub struct EditorWorldSavePath(pub String);

impl Default for EditorWorldSavePath {
    fn default() -> Self {
        Self(persistence::WORLD_SAVE_PATH.to_string())
    }
}

#[derive(Component, Clone, Debug, PartialEq, Eq)]
pub struct EditorPropInstanceId(pub String);

#[derive(Component, Clone, Debug, PartialEq, Eq)]
pub struct EditorLightInstanceId(pub String);

#[derive(Resource, Default)]
struct EditorPlacedProps {
    props: Vec<Value>,
    loaded_from_disk: bool,
}

#[derive(Resource, Default)]
struct EditorPlacedLights {
    lights: Vec<EditorLightInstance>,
    loaded_from_disk: bool,
}

#[derive(Resource, Default)]
struct RuntimeMaterialReplaceJobs {
    next_id: u64,
    active: VecDeque<RuntimeMaterialReplaceJob>,
    completed: HashMap<String, RuntimeMaterialReplaceJobSnapshot>,
}

struct RuntimeMaterialReplaceJob {
    job_id: String,
    from: MaterialId,
    to: MaterialId,
    to_material: Value,
    chunk_positions: Vec<IVec3>,
    next_chunk_index: usize,
    summary: MaterialReplaceSummary,
    dirty_chunks_since_poll: Vec<IVec3>,
}

#[derive(Clone, Debug)]
struct RuntimeMaterialReplaceJobSnapshot {
    job_id: String,
    from: MaterialId,
    to: MaterialId,
    to_material: Value,
    changed: u64,
    no_change: u64,
    skipped: u64,
    processed_chunks: usize,
    total_chunks: usize,
    completed: bool,
    dirty_chunks: Vec<IVec3>,
}

impl RuntimeMaterialReplaceJobs {
    fn push(
        &mut self,
        from: MaterialId,
        to: MaterialId,
        to_material: Value,
        chunk_positions: Vec<IVec3>,
    ) -> RuntimeMaterialReplaceJobSnapshot {
        self.next_id += 1;
        let job_id = format!("material-replace-{}", self.next_id);
        let snapshot = RuntimeMaterialReplaceJobSnapshot {
            job_id: job_id.clone(),
            from,
            to,
            to_material: to_material.clone(),
            changed: 0,
            no_change: 0,
            skipped: 0,
            processed_chunks: 0,
            total_chunks: chunk_positions.len(),
            completed: false,
            dirty_chunks: Vec::new(),
        };
        self.active.push_back(RuntimeMaterialReplaceJob {
            job_id,
            from,
            to,
            to_material,
            chunk_positions,
            next_chunk_index: 0,
            summary: MaterialReplaceSummary::default(),
            dirty_chunks_since_poll: Vec::new(),
        });
        snapshot
    }

    fn snapshot_for(&mut self, job_id: &str) -> Option<RuntimeMaterialReplaceJobSnapshot> {
        if let Some(job) = self.active.iter_mut().find(|job| job.job_id == job_id) {
            let dirty_chunks = job.dirty_chunks_since_poll.clone();
            job.dirty_chunks_since_poll.clear();
            return Some(RuntimeMaterialReplaceJobSnapshot {
                job_id: job.job_id.clone(),
                from: job.from,
                to: job.to,
                to_material: job.to_material.clone(),
                changed: job.summary.changed,
                no_change: job.summary.no_change,
                skipped: job.summary.skipped,
                processed_chunks: job.next_chunk_index,
                total_chunks: job.chunk_positions.len(),
                completed: false,
                dirty_chunks,
            });
        }

        self.completed.get(job_id).cloned()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorLightInstance {
    pub id: String,
    pub name: String,
    pub kind: EditorLightKind,
    pub enabled: bool,
    pub visible: bool,
    pub locked: bool,
    pub position: [f32; 3],
    pub rotation: [f32; 3],
    pub color: String,
    pub intensity: f32,
    pub range: f32,
    pub radius: f32,
    pub inner_cone_angle: f32,
    pub outer_cone_angle: f32,
    pub shadows_enabled: bool,
    pub volumetric: bool,
    pub source: EditorLightSource,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EditorLightKind {
    Directional,
    Point,
    Spot,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EditorLightSource {
    Editor,
    Runtime,
    Sun,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorLightPatch {
    pub name: Option<String>,
    pub kind: Option<EditorLightKind>,
    pub enabled: Option<bool>,
    pub visible: Option<bool>,
    pub locked: Option<bool>,
    pub position: Option<[f32; 3]>,
    pub rotation: Option<[f32; 3]>,
    pub color: Option<String>,
    pub intensity: Option<f32>,
    pub range: Option<f32>,
    pub radius: Option<f32>,
    pub inner_cone_angle: Option<f32>,
    pub outer_cone_angle: Option<f32>,
    pub shadows_enabled: Option<bool>,
    pub volumetric: Option<bool>,
    pub source: Option<EditorLightSource>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LightPreset {
    Sun,
    Moon,
    NoneEmissivesOnly,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AtmospherePreset {
    Void,
    Clear,
    Hazy,
    Fog,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GlobalLightAtmospherePreset {
    Default,
    Neutral,
}

#[derive(Resource, Clone, Copy, Debug, PartialEq, Eq)]
pub struct LightAtmospherePresetState {
    pub light_preset: LightPreset,
    pub atmosphere_preset: AtmospherePreset,
    pub global_preset: GlobalLightAtmospherePreset,
}

impl Default for LightAtmospherePresetState {
    fn default() -> Self {
        Self {
            light_preset: LightPreset::Sun,
            atmosphere_preset: AtmospherePreset::Hazy,
            global_preset: GlobalLightAtmospherePreset::Default,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightAtmosphereSettingsPayload {
    #[serde(default)]
    pub cycle_enabled: bool,
    pub light_enabled: bool,
    pub light_preset: LightPreset,
    pub atmosphere_preset: AtmospherePreset,
    pub global_preset: GlobalLightAtmospherePreset,
    pub light_color: String,
    pub light_illuminance: f32,
    pub light_azimuth_degrees: f32,
    pub light_elevation_degrees: f32,
    pub light_direction: [f32; 3],
    pub atmosphere_amount: f32,
    pub atmosphere_half_length: f32,
    pub fog_active: bool,
    pub god_rays_enabled: bool,
    pub ambient_color: String,
    pub ambient_brightness: f32,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HexTilingPatch {
    pub enabled: Option<bool>,
    pub normal_enabled: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainTexturingPatch {
    pub hex_tiling: Option<HexTilingPatch>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightAtmospherePatch {
    pub cycle_enabled: Option<bool>,
    pub light_enabled: Option<bool>,
    pub light_preset: Option<LightPreset>,
    pub atmosphere_preset: Option<AtmospherePreset>,
    pub global_preset: Option<GlobalLightAtmospherePreset>,
    pub light_color: Option<String>,
    pub light_illuminance: Option<f32>,
    pub light_azimuth_degrees: Option<f32>,
    pub light_elevation_degrees: Option<f32>,
    pub light_direction: Option<[f32; 3]>,
    pub atmosphere_amount: Option<f32>,
    pub atmosphere_half_length: Option<f32>,
    pub ambient_color: Option<String>,
    pub ambient_brightness: Option<f32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightAtmosphereTemplate {
    pub schema: String,
    pub settings: LightAtmosphereSettingsPayload,
}

impl From<LightAtmosphereSettingsPayload> for LightAtmospherePatch {
    fn from(settings: LightAtmosphereSettingsPayload) -> Self {
        Self {
            cycle_enabled: Some(settings.cycle_enabled),
            light_enabled: Some(settings.light_enabled),
            light_preset: Some(settings.light_preset),
            atmosphere_preset: Some(settings.atmosphere_preset),
            global_preset: Some(settings.global_preset),
            light_color: Some(settings.light_color),
            light_illuminance: Some(settings.light_illuminance),
            light_azimuth_degrees: Some(settings.light_azimuth_degrees),
            light_elevation_degrees: Some(settings.light_elevation_degrees),
            light_direction: Some(settings.light_direction),
            atmosphere_amount: Some(settings.atmosphere_amount),
            atmosphere_half_length: Some(settings.atmosphere_half_length),
            ambient_color: Some(settings.ambient_color),
            ambient_brightness: Some(settings.ambient_brightness),
        }
    }
}

impl Plugin for RuntimeWriteCommandPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<RuntimeCommandQueue>()
            .init_resource::<RuntimeCommandResults>()
            .init_resource::<RuntimeViewportDebugState>()
            .init_resource::<EditorDiagnosticsState>()
            .init_resource::<EditorCameraState>()
            .init_resource::<EditorWorldSavePath>()
            .init_resource::<EditorPlacedProps>()
            .init_resource::<EditorPlacedLights>()
            .init_resource::<RuntimeMaterialReplaceJobs>()
            .init_resource::<MaterialCatalog>()
            .init_resource::<LightAtmospherePresetState>()
            .add_systems(
                Update,
                (
                    load_saved_editor_placed_props,
                    load_saved_editor_lights,
                    process_runtime_material_replace_jobs,
                    process_runtime_command_queue,
                )
                    .chain(),
            );
    }
}

#[derive(Resource, Default)]
pub struct RuntimeCommandQueue {
    pending: VecDeque<RuntimeCommandEnvelope>,
}

impl RuntimeCommandQueue {
    pub fn push(&mut self, command: RuntimeCommandEnvelope) {
        self.pending.push_back(command);
    }
}

#[derive(Resource, Default)]
pub struct RuntimeCommandResults {
    completed: VecDeque<RuntimeCommandResponse>,
}

impl RuntimeCommandResults {
    pub fn pop_front(&mut self) -> Option<RuntimeCommandResponse> {
        self.completed.pop_front()
    }
}

#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeViewportDebugState {
    #[serde(skip)]
    pub editor_controlled: bool,
    pub chunk_bounds: bool,
    pub voxel_grid: bool,
    pub water_debug: bool,
    pub protected_areas: bool,
    pub prop_bounds: bool,
    pub prop_billboards: bool,
    pub agent_targets: bool,
    pub atlas_preview: bool,
    pub wireframe: bool,
}

impl Default for RuntimeViewportDebugState {
    fn default() -> Self {
        Self {
            editor_controlled: false,
            chunk_bounds: true,
            voxel_grid: true,
            water_debug: false,
            protected_areas: true,
            prop_bounds: true,
            prop_billboards: true,
            agent_targets: true,
            atlas_preview: false,
            wireframe: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct RuntimeCommandEnvelope {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(flatten)]
    pub command: RuntimeWriteCommand,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum RuntimeWriteCommand {
    #[serde(rename = "runtime.selectEntity")]
    SelectEntity { selection: Value },
    #[serde(rename = "runtime.focusCamera")]
    FocusCamera { target: Value },
    #[serde(rename = "runtime.setEditorCameraMode")]
    SetEditorCameraMode {
        #[serde(rename = "interactionMode")]
        interaction_mode: Option<EditorCameraInteractionMode>,
        #[serde(rename = "cameraKind")]
        camera_kind: Option<EditorCameraKind>,
    },
    #[serde(rename = "runtime.setEditorCameraProjection")]
    SetEditorCameraProjection {
        projection: EditorCameraProjection,
        #[serde(rename = "fovDegrees")]
        fov_degrees: Option<f32>,
        #[serde(rename = "orthographicScale")]
        orthographic_scale: Option<f32>,
    },
    #[serde(rename = "runtime.setEditorCameraPose")]
    SetEditorCameraPose { pose: EditorCameraPose },
    #[serde(rename = "runtime.alignEditorCameraToAxes")]
    AlignEditorCameraToAxes {
        axis: Option<String>,
        #[serde(default)]
        automatic: bool,
    },
    #[serde(rename = "runtime.addSavedEditorCamera")]
    AddSavedEditorCamera {
        name: Option<String>,
        description: Option<String>,
    },
    #[serde(rename = "runtime.updateSavedEditorCamera")]
    UpdateSavedEditorCamera {
        #[serde(rename = "cameraId")]
        camera_id: String,
        name: Option<String>,
        description: Option<String>,
    },
    #[serde(rename = "runtime.deleteSavedEditorCamera")]
    DeleteSavedEditorCamera {
        #[serde(rename = "cameraId")]
        camera_id: String,
    },
    #[serde(rename = "runtime.recallSavedEditorCamera")]
    RecallSavedEditorCamera {
        #[serde(rename = "cameraId")]
        camera_id: String,
    },
    #[serde(rename = "runtime.stepSavedEditorCamera")]
    StepSavedEditorCamera { direction: i32 },
    #[serde(rename = "runtime.importEditorCameraTemplate")]
    ImportEditorCameraTemplate { template: Value },
    #[serde(rename = "runtime.exportEditorCameraTemplate")]
    ExportEditorCameraTemplate {},
    #[serde(rename = "runtime.setRenderQuality")]
    SetRenderQuality { preset: FrontendRenderQualityPreset },
    #[serde(rename = "runtime.setRenderFeatureFlag")]
    SetRenderFeatureFlag {
        feature: FrontendRenderFeatureFlag,
        enabled: bool,
        value: Option<f32>,
    },
    #[serde(rename = "runtime.setShaderFeature")]
    SetShaderFeature {
        feature: FrontendRenderFeatureFlag,
        enabled: bool,
        value: Option<f32>,
    },
    #[serde(rename = "runtime.updateAmbientLight")]
    UpdateAmbientLight { color: String, brightness: f32 },
    #[serde(rename = "runtime.getLightAtmosphere")]
    GetLightAtmosphere {},
    #[serde(rename = "runtime.updateLightAtmosphere")]
    UpdateLightAtmosphere { patch: LightAtmospherePatch },
    #[serde(rename = "runtime.updateTerrainTexturing")]
    UpdateTerrainTexturing { patch: TerrainTexturingPatch },
    #[serde(rename = "runtime.importLightAtmosphereTemplate")]
    ImportLightAtmosphereTemplate { template: Value },
    #[serde(rename = "runtime.exportLightAtmosphereTemplate")]
    ExportLightAtmosphereTemplate {},
    #[serde(rename = "runtime.setWaterReflectionDebugMode")]
    SetWaterReflectionDebugMode {
        #[serde(rename = "waterBodyId")]
        water_body_id: String,
        mode: FrontendWaterReflectionDebugViewMode,
    },
    #[serde(rename = "runtime.updateWaterBody")]
    UpdateWaterBody {
        #[serde(rename = "waterBodyId")]
        water_body_id: String,
        patch: FrontendWaterBodyPatch,
    },
    #[serde(rename = "runtime.runWaterVisualProbe")]
    RunWaterVisualProbe {},
    #[serde(rename = "runtime.getDefaultTerrainRecipe")]
    GetDefaultTerrainRecipe {},
    #[serde(rename = "runtime.previewTerrainRecipe")]
    PreviewTerrainRecipe { request: TerrainPreviewRequest },
    #[serde(rename = "runtime.setVoxel")]
    SetVoxel {
        position: [i32; 3],
        block: FrontendVoxelBlock,
    },
    #[serde(rename = "runtime.paintVoxelMaterial")]
    PaintVoxelMaterial {
        position: [i32; 3],
        #[serde(rename = "materialId")]
        material_id: String,
    },
    #[serde(rename = "runtime.pickVoxelMaterial")]
    PickVoxelMaterial { position: [i32; 3] },
    #[serde(rename = "runtime.replaceMaterial")]
    ReplaceMaterial {
        #[serde(rename = "fromMaterialId")]
        from_material_id: String,
        #[serde(rename = "toMaterialId")]
        to_material_id: String,
    },
    #[serde(rename = "runtime.getMaterialReplaceJob")]
    GetMaterialReplaceJob {
        #[serde(rename = "jobId")]
        job_id: String,
    },
    #[serde(rename = "runtime.updateMaterial")]
    UpdateMaterial {
        #[serde(rename = "materialId")]
        material_id: String,
        patch: FrontendMaterialPatch,
    },
    #[serde(rename = "runtime.setActiveMaterial")]
    SetActiveMaterial {
        #[serde(rename = "materialId")]
        material_id: String,
    },
    #[serde(rename = "runtime.applyVoxelBrush")]
    ApplyVoxelBrush { brush: FrontendVoxelBrush },
    #[serde(rename = "runtime.setViewportDebugOverlay")]
    SetViewportDebugOverlay {
        overlay: FrontendViewportDebugOverlay,
        enabled: bool,
    },
    #[serde(rename = "runtime.setEditorDiagnostics")]
    SetEditorDiagnostics {
        enabled: bool,
        #[serde(default)]
        categories: Vec<EditorDiagnosticsCategory>,
    },
    #[serde(rename = "runtime.rebuildSelectedChunk")]
    RebuildSelectedChunk {
        #[serde(rename = "chunkId")]
        chunk_id: String,
    },
    #[serde(rename = "runtime.rebuildDirtyChunks")]
    RebuildDirtyChunks {
        #[serde(rename = "chunkIds")]
        chunk_ids: Vec<String>,
    },
    #[serde(rename = "runtime.compareNaadfChunkOccupancy")]
    CompareNaadfChunkOccupancy {
        #[serde(rename = "chunkId")]
        chunk_id: String,
        #[serde(rename = "maxMismatches", default = "default_naadf_max_mismatches")]
        max_mismatches: usize,
    },
    #[serde(rename = "runtime.compareNaadfRay")]
    CompareNaadfRay {
        origin: [f32; 3],
        direction: [f32; 3],
        #[serde(rename = "maxDistance", default = "default_naadf_ray_max_distance")]
        max_distance: f32,
        #[serde(default = "default_naadf_ray_purpose")]
        purpose: String,
    },
    #[serde(rename = "runtime.setAtlasMapping")]
    SetAtlasMapping { mapping: FrontendAtlasMapping },
    #[serde(rename = "runtime.saveAtlasMapping")]
    SaveAtlasMapping { mapping: FrontendAtlasMapping },
    #[serde(rename = "runtime.scatterProps")]
    ScatterProps { props: Vec<Value> },
    #[serde(rename = "runtime.removeProps")]
    RemoveProps {
        #[serde(rename = "propIds", default)]
        prop_ids: Vec<String>,
        #[serde(rename = "chunkId")]
        chunk_id: Option<String>,
    },
    #[serde(rename = "runtime.createLight")]
    CreateLight { light: EditorLightInstance },
    #[serde(rename = "runtime.updateLight")]
    UpdateLight {
        #[serde(rename = "lightId")]
        light_id: String,
        patch: EditorLightPatch,
    },
    #[serde(rename = "runtime.deleteLight")]
    DeleteLight {
        #[serde(rename = "lightId")]
        light_id: String,
    },
    #[serde(rename = "runtime.saveLights")]
    SaveLights {},
    #[serde(rename = "runtime.loadLights")]
    LoadLights {},
    #[serde(rename = "runtime.createProtectedArea")]
    CreateProtectedArea { area: ProtectedArea },
    #[serde(rename = "runtime.updateProtectedArea")]
    UpdateProtectedArea {
        #[serde(rename = "areaId")]
        area_id: String,
        patch: ProtectedAreaPatch,
    },
    #[serde(rename = "runtime.deleteProtectedArea")]
    DeleteProtectedArea {
        #[serde(rename = "areaId")]
        area_id: String,
    },
    #[serde(rename = "runtime.queryProtectedRulesAtVoxel")]
    QueryProtectedRulesAtVoxel { voxel: [i32; 3] },
    #[serde(rename = "runtime.validateProtectedAreaConflicts")]
    ValidateProtectedAreaConflicts { area: Option<ProtectedArea> },
    #[serde(rename = "runtime.saveProtectedAreas")]
    SaveProtectedAreas {},
    #[serde(rename = "runtime.loadProtectedAreas")]
    LoadProtectedAreas {},
    #[serde(rename = "runtime.saveWorldSnapshot")]
    SaveWorldSnapshot { reason: Option<String> },
}

fn default_naadf_max_mismatches() -> usize {
    16
}

fn default_naadf_ray_max_distance() -> f32 {
    256.0
}

fn default_naadf_ray_purpose() -> String {
    "debug".to_string()
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrontendVoxelBlock {
    Grass,
    TopSoil,
    Dirt,
    SubSoil,
    Rock,
    Sand,
    Clay,
    Water,
    Wood,
    Leaves,
    DungeonWall,
    DungeonFloor,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrontendVoxelBrushAction {
    Set,
    Delete,
    Paint,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrontendVoxelBrushShape {
    Single,
    Box,
    Sphere,
    Cylinder,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrontendVoxelBrushMask {
    Any,
    Empty,
    Occupied,
    Material,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FrontendVoxelBrush {
    pub position: [i32; 3],
    pub action: FrontendVoxelBrushAction,
    pub shape: FrontendVoxelBrushShape,
    pub block: FrontendVoxelBlock,
    #[serde(default = "default_voxel_brush_radius")]
    pub radius: u32,
    #[serde(default = "default_voxel_brush_size")]
    pub size: [u32; 3],
    #[serde(default = "default_voxel_brush_mask")]
    pub mask: FrontendVoxelBrushMask,
    #[serde(rename = "maskBlock")]
    pub mask_block: Option<FrontendVoxelBlock>,
    #[serde(default, rename = "includeResults")]
    pub include_results: bool,
}

fn default_voxel_brush_radius() -> u32 {
    1
}

fn default_voxel_brush_size() -> [u32; 3] {
    [1, 1, 1]
}

fn default_voxel_brush_mask() -> FrontendVoxelBrushMask {
    FrontendVoxelBrushMask::Any
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainRecipe {
    pub version: u32,
    pub seed: i32,
    pub config: TerrainConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainPreviewRequest {
    pub recipe: TerrainRecipe,
    pub origin: [i32; 2],
    pub size: [u32; 2],
    pub resolution: u32,
}

impl FrontendVoxelBlock {
    fn as_runtime(self) -> VoxelType {
        match self {
            Self::Grass | Self::TopSoil => VoxelType::TopSoil,
            Self::Dirt | Self::SubSoil => VoxelType::SubSoil,
            Self::Rock => VoxelType::Rock,
            Self::Sand => VoxelType::Sand,
            Self::Clay => VoxelType::Clay,
            Self::Water => VoxelType::Water,
            Self::Wood => VoxelType::Wood,
            Self::Leaves => VoxelType::Leaves,
            Self::DungeonWall => VoxelType::DungeonWall,
            Self::DungeonFloor => VoxelType::DungeonFloor,
        }
    }

    fn as_frontend_str(self) -> &'static str {
        match self {
            Self::Grass => "grass",
            Self::TopSoil => "topSoil",
            Self::Dirt => "dirt",
            Self::SubSoil => "subSoil",
            Self::Rock => "rock",
            Self::Sand => "sand",
            Self::Clay => "clay",
            Self::Water => "water",
            Self::Wood => "wood",
            Self::Leaves => "leaves",
            Self::DungeonWall => "dungeonWall",
            Self::DungeonFloor => "dungeonFloor",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrontendViewportDebugOverlay {
    ChunkBounds,
    VoxelGrid,
    WaterDebug,
    ProtectedAreas,
    PropBounds,
    PropBillboards,
    AgentTargets,
    AtlasPreview,
    Wireframe,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub enum FrontendRenderQualityPreset {
    Low,
    Medium,
    High,
    Performance100,
}

impl FrontendRenderQualityPreset {
    fn as_runtime(self) -> RenderQualityPreset {
        match self {
            Self::Low => RenderQualityPreset::Low,
            Self::Medium => RenderQualityPreset::Medium,
            Self::High => RenderQualityPreset::High,
            Self::Performance100 => RenderQualityPreset::Performance100,
        }
    }

    fn as_frontend_str(self) -> &'static str {
        match self {
            Self::Low => "Low",
            Self::Medium => "Medium",
            Self::High => "High",
            Self::Performance100 => "Performance100",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrontendRenderFeatureFlag {
    Gtao,
    Ssao,
    BakedAo,
    ShadowBudget,
    RayTracing,
    PhotoMode,
    CinematicMode,
    Fog,
    GodRays,
}

impl FrontendRenderFeatureFlag {
    pub(crate) fn as_frontend_str(self) -> &'static str {
        match self {
            Self::Gtao => "gtao",
            Self::Ssao => "ssao",
            Self::BakedAo => "bakedAo",
            Self::ShadowBudget => "shadowBudget",
            Self::RayTracing => "rayTracing",
            Self::PhotoMode => "photoMode",
            Self::CinematicMode => "cinematicMode",
            Self::Fog => "fog",
            Self::GodRays => "godRays",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub enum FrontendWaterReflectionDebugViewMode {
    Off,
    Mask,
    ReflectionOnly,
    BlendFactor,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub enum FrontendWaterBodyKind {
    Ocean,
    Lake,
    River,
    Pond,
    Unknown,
}

impl FrontendWaterBodyKind {
    fn as_runtime(self) -> WaterBodyKind {
        match self {
            Self::Ocean => WaterBodyKind::Ocean,
            Self::Lake => WaterBodyKind::Lake,
            Self::River => WaterBodyKind::River,
            Self::Pond => WaterBodyKind::Pond,
            Self::Unknown => WaterBodyKind::Unknown,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendWaterBodyPatch {
    pub kind: Option<FrontendWaterBodyKind>,
    pub reflection_strength: Option<f32>,
    pub fresnel_power: Option<f32>,
    pub distortion_strength: Option<f32>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendMaterialPatch {
    pub name: Option<String>,
    pub color_rgb: Option<[u8; 3]>,
    pub metallic: Option<f32>,
    pub smooth: Option<f32>,
    pub emissive: Option<f32>,
    pub surface_transmission: Option<f32>,
    pub absorption_length: Option<f32>,
    pub scatter_length: Option<f32>,
    pub index_of_refraction: Option<f32>,
    pub phase: Option<f32>,
}

impl FrontendWaterReflectionDebugViewMode {
    fn as_runtime(self) -> WaterReflectionDebugViewMode {
        match self {
            Self::Off => WaterReflectionDebugViewMode::Off,
            Self::Mask => WaterReflectionDebugViewMode::Mask,
            Self::ReflectionOnly => WaterReflectionDebugViewMode::ReflectionOnly,
            Self::BlendFactor => WaterReflectionDebugViewMode::BlendFactor,
        }
    }

    fn as_frontend_str(self) -> &'static str {
        match self {
            Self::Off => "Off",
            Self::Mask => "Mask",
            Self::ReflectionOnly => "ReflectionOnly",
            Self::BlendFactor => "BlendFactor",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct FrontendAtlasFaceMapping {
    pub top: String,
    pub side: String,
    pub bottom: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct FrontendAtlasMapping {
    pub grass: FrontendAtlasFaceMapping,
    pub dirt: FrontendAtlasFaceMapping,
    pub rock: FrontendAtlasFaceMapping,
    pub sand: FrontendAtlasFaceMapping,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeCommandResponse {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(flatten)]
    pub result: RuntimeCommandResult<Value>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCommandStatus {
    Success,
    Failure,
    ValidationError,
    Unsupported,
}

#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum RuntimeCommandResult<T> {
    Success {
        status: RuntimeCommandStatus,
        ok: bool,
        data: T,
    },
    Failure {
        status: RuntimeCommandStatus,
        ok: bool,
        message: String,
        #[serde(rename = "validationErrors", skip_serializing_if = "Vec::is_empty")]
        validation_errors: Vec<String>,
    },
}

impl<T> RuntimeCommandResult<T> {
    fn success(data: T) -> Self {
        Self::Success {
            status: RuntimeCommandStatus::Success,
            ok: true,
            data,
        }
    }

    fn failure(status: RuntimeCommandStatus, message: impl Into<String>) -> Self {
        Self::Failure {
            status,
            ok: false,
            message: message.into(),
            validation_errors: Vec::new(),
        }
    }

    fn validation(message: impl Into<String>, validation_errors: Vec<String>) -> Self {
        Self::Failure {
            status: RuntimeCommandStatus::ValidationError,
            ok: false,
            message: message.into(),
            validation_errors,
        }
    }
}

fn process_runtime_command_queue(world: &mut World) {
    let envelopes: Vec<_> = {
        let mut queue = world.resource_mut::<RuntimeCommandQueue>();
        queue.pending.drain(..).collect()
    };

    for envelope in envelopes {
        let request_id = envelope.request_id.clone();
        let result = execute_runtime_write_command(world, envelope.command);
        world
            .resource_mut::<RuntimeCommandResults>()
            .completed
            .push_back(RuntimeCommandResponse { request_id, result });
    }
}

fn process_runtime_material_replace_jobs(world: &mut World) {
    let registry = world.get_resource::<ProtectedAreaRegistry>().cloned();

    world.resource_scope(|world, mut jobs: Mut<RuntimeMaterialReplaceJobs>| {
        let Some(mut voxel_world) = world.get_resource_mut::<VoxelWorld>() else {
            return;
        };

        let mut completed_jobs = Vec::new();
        for job in jobs.active.iter_mut() {
            let remaining = job
                .chunk_positions
                .len()
                .saturating_sub(job.next_chunk_index);
            let chunk_budget = remaining.min(MATERIAL_REPLACE_CHUNKS_PER_FRAME);

            for _ in 0..chunk_budget {
                let chunk_pos = job.chunk_positions[job.next_chunk_index];
                job.next_chunk_index += 1;
                let chunk_summary = voxel_world.replace_material_id_in_chunk(
                    chunk_pos,
                    job.from,
                    job.to,
                    registry.as_ref(),
                );
                for dirty_chunk in &chunk_summary.dirty_chunks {
                    if !job.dirty_chunks_since_poll.contains(dirty_chunk) {
                        job.dirty_chunks_since_poll.push(*dirty_chunk);
                    }
                }
                job.summary.merge(chunk_summary);
            }

            if job.next_chunk_index >= job.chunk_positions.len() {
                completed_jobs.push(job.job_id.clone());
            }
        }

        for job_id in completed_jobs {
            if let Some(index) = jobs.active.iter().position(|job| job.job_id == job_id) {
                let job = jobs
                    .active
                    .remove(index)
                    .expect("active job index was found");
                let mut dirty_chunks = job
                    .dirty_chunks_since_poll
                    .iter()
                    .copied()
                    .collect::<Vec<_>>();
                for chunk_pos in job.summary.dirty_chunks.iter().copied() {
                    if !dirty_chunks.contains(&chunk_pos) {
                        dirty_chunks.push(chunk_pos);
                    }
                }
                jobs.completed.insert(
                    job.job_id.clone(),
                    RuntimeMaterialReplaceJobSnapshot {
                        job_id: job.job_id,
                        from: job.from,
                        to: job.to,
                        to_material: job.to_material,
                        changed: job.summary.changed,
                        no_change: job.summary.no_change,
                        skipped: job.summary.skipped,
                        processed_chunks: job.chunk_positions.len(),
                        total_chunks: job.chunk_positions.len(),
                        completed: true,
                        dirty_chunks,
                    },
                );
            }
        }
    });
}

fn load_saved_editor_placed_props(world: &mut World) {
    let already_loaded = world
        .get_resource::<EditorPlacedProps>()
        .is_some_and(|placed| placed.loaded_from_disk);
    if already_loaded {
        return;
    }

    let Some(prop_assets) = world.get_resource::<PropAssets>() else {
        return;
    };
    if !prop_assets.loaded {
        return;
    }

    if !world.contains_resource::<EditorPlacedProps>() {
        world.insert_resource(EditorPlacedProps::default());
    }
    world.resource_mut::<EditorPlacedProps>().loaded_from_disk = true;

    let path = Path::new(EDITOR_PLACED_PROPS_SAVE_PATH);
    if !path.exists() {
        return;
    }

    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) => {
            warn!(
                "Failed to open editor placed prop save '{}': {}",
                path.display(),
                error
            );
            return;
        }
    };
    let props = match serde_json::from_reader::<_, Vec<Value>>(file) {
        Ok(props) => props,
        Err(error) => {
            warn!(
                "Failed to read editor placed prop save '{}': {}",
                path.display(),
                error
            );
            return;
        }
    };
    if props.is_empty() {
        return;
    }

    match scatter_runtime_props(world, props) {
        Ok(data) => {
            info!(
                "Loaded {} editor placed props from {}",
                data["props"].as_array().map(Vec::len).unwrap_or_default(),
                path.display()
            );
        }
        Err(message) => warn!("Failed to load editor placed props: {}", message),
    }
}

pub fn handle_runtime_command_json(world: &mut World, request: Value) -> RuntimeCommandResponse {
    match serde_json::from_value::<RuntimeCommandEnvelope>(request) {
        Ok(envelope) => {
            let request_id = envelope.request_id.clone();
            let result = execute_runtime_write_command(world, envelope.command);
            RuntimeCommandResponse { request_id, result }
        }
        Err(err) => RuntimeCommandResponse {
            request_id: "invalid".to_string(),
            result: RuntimeCommandResult::validation(
                "Runtime command payload is invalid.",
                vec![err.to_string()],
            ),
        },
    }
}

pub fn runtime_snapshot_json(world: &mut World) -> RuntimeCommandResult<Value> {
    load_saved_editor_cameras(world);
    let preset = world
        .get_resource::<RenderQualityPreset>()
        .copied()
        .unwrap_or_default();
    let atlas_mapping = world
        .get_resource::<AtlasMapping>()
        .cloned()
        .unwrap_or_default();
    let water_visual_probe = water_visual_probe_payload(world);
    let viewport_debug = viewport_debug_payload(world);
    let editor_diagnostics = editor_diagnostics_payload(world);
    let editor_camera = editor_camera_payload(world);
    let protected_area_count = world
        .get_resource::<ProtectedAreaRegistry>()
        .map(|registry| registry.area_count())
        .unwrap_or_default();
    let (selection, targeted_voxel) = runtime_selection_payload(world);

    RuntimeCommandResult::success(json!({
        "connectionState": "connected",
        "capabilities": {
            "canSelectEntity": true,
            "canFocusCamera": true,
            "canRebuildChunks": true,
            "canSetRenderQuality": true,
            "canDebugWaterReflections": true,
            "canRunWaterVisualProbe": true,
            "canEditAtlasMapping": true,
            "canEditMaterials": true,
            "canEditProtectedAreas": true,
            "canEditLights": true,
            "canSaveWorldSnapshot": false,
        },
        "metrics": runtime_metrics_payload(world, preset, &water_visual_probe),
        "renderQuality": {
            "preset": render_quality_preset_to_frontend(preset),
            "metrics": render_quality_metrics(preset),
        },
        "selection": selection,
        "targetedVoxel": targeted_voxel,
        "chunks": [],
        "dirtyChunkIds": [],
        "waterReflection": {
            "waterBodyId": null,
            "status": water_visual_probe["reflectionStatus"].clone(),
        },
        "waterVisualProbe": water_visual_probe,
        "atlasMapping": {
            "mapping": frontend_atlas_mapping_payload(&atlas_mapping),
            "dirty": atlas_mapping.needs_rebuild,
        },
        "materialCatalog": material_catalog_payload(world),
        "viewportDebug": viewport_debug,
        "editorDiagnostics": editor_diagnostics,
        "editorCamera": editor_camera,
        "propStats": runtime_prop_stats_payload(world),
        "lights": editor_lights_payload(world),
        "timingSamples": [
            { "label": "frame.total", "ms": 16.7, "category": "frame" },
            { "label": "water.reflection_probe", "ms": 0.0, "category": "water" },
        ],
        "consoleEvents": [
            {
                "id": format!("runtime-bridge-{}", timestamp_string()),
                "level": "info",
                "message": format!("Runtime bridge snapshot captured; {} protected areas registered.", protected_area_count),
                "time": timestamp_string(),
                "source": "runtime",
            }
        ],
        "capturedAt": timestamp_string(),
    }))
}

fn viewport_debug_payload(world: &World) -> Value {
    let mut state = world
        .get_resource::<RuntimeViewportDebugState>()
        .cloned()
        .unwrap_or_default();

    if let Some(prop_bounds_debug) = world.get_resource::<PropBoundsDebugSettings>() {
        state.prop_bounds = prop_bounds_debug.enabled;
    }

    json!(state)
}

fn editor_diagnostics_payload(world: &World) -> Value {
    json!(
        world
            .get_resource::<EditorDiagnosticsState>()
            .cloned()
            .unwrap_or_default()
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditorCameraTemplate {
    schema: String,
    cameras: Vec<EditorSavedCamera>,
}

fn editor_camera_payload(world: &World) -> Value {
    json!(
        world
            .get_resource::<EditorCameraState>()
            .cloned()
            .unwrap_or_default()
    )
}

fn editor_world_save_path(world: &World) -> String {
    world
        .get_resource::<EditorWorldSavePath>()
        .map(|path| path.0.clone())
        .unwrap_or_else(|| persistence::WORLD_SAVE_PATH.to_string())
}

fn editor_camera_sidecar_path(save_path: &str) -> PathBuf {
    let mut sidecar_path = PathBuf::from(save_path);
    sidecar_path.set_extension("cameras.json");
    sidecar_path
}

fn editor_camera_save_path(world: &World) -> PathBuf {
    editor_camera_sidecar_path(&editor_world_save_path(world))
}

fn editor_camera_save_path_label(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn load_saved_editor_cameras(world: &mut World) {
    let save_path = editor_camera_save_path(world);
    let save_path_label = editor_camera_save_path_label(&save_path);
    let already_loaded = world
        .get_resource::<EditorCameraState>()
        .map(|state| {
            state.loaded_from_disk
                && state.loaded_save_path.as_deref() == Some(save_path_label.as_str())
        })
        .unwrap_or_default();
    if already_loaded {
        return;
    }

    let mut state = world
        .get_resource::<EditorCameraState>()
        .cloned()
        .unwrap_or_default();
    state.loaded_from_disk = true;
    state.loaded_save_path = Some(save_path_label.clone());
    state.saved_cameras.clear();
    state.active_saved_camera_id = None;

    match fs::read_to_string(&save_path) {
        Ok(contents) => match serde_json::from_str::<EditorCameraTemplate>(&contents) {
            Ok(template) if template.schema == EDITOR_CAMERA_TEMPLATE_SCHEMA => {
                state.saved_cameras = template.cameras;
                state.active_saved_camera_id =
                    state.saved_cameras.first().map(|saved| saved.id.clone());
            }
            Ok(_) => warn!(
                "Ignored editor camera file {}; schema did not match {}",
                save_path_label, EDITOR_CAMERA_TEMPLATE_SCHEMA
            ),
            Err(err) => warn!(
                "Failed to parse editor camera file {}: {}",
                save_path_label, err
            ),
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => warn!(
            "Failed to read editor camera file {}: {}",
            save_path_label, err
        ),
    }

    world.insert_resource(state);
}

fn save_editor_cameras_to_disk(world: &World) -> Result<(), String> {
    let state = world
        .get_resource::<EditorCameraState>()
        .ok_or_else(|| "EditorCameraState resource is not available.".to_string())?;
    let template = EditorCameraTemplate {
        schema: EDITOR_CAMERA_TEMPLATE_SCHEMA.to_string(),
        cameras: state.saved_cameras.clone(),
    };
    let json = serde_json::to_string_pretty(&template).map_err(|err| err.to_string())?;
    let save_path = editor_camera_save_path(world);
    if let Some(parent) = save_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    fs::write(save_path, json).map_err(|err| err.to_string())
}

fn apply_editor_camera_to_runtime(world: &mut World) -> Result<(), String> {
    let state = world
        .get_resource::<EditorCameraState>()
        .cloned()
        .unwrap_or_default();
    let mut query = world
        .query_filtered::<(&mut Transform, &mut PlayerCamera, &mut Projection), With<PlayerCamera>>(
        );
    let Ok((mut transform, mut camera, mut projection)) = query.single_mut(world) else {
        return Err("PlayerCamera is not available in this runtime.".to_string());
    };

    *transform = editor_camera_transform(&state);
    camera.mode = CameraMode::Fly;
    camera.yaw = state.pose.yaw;
    camera.pitch = state.pose.pitch;
    apply_editor_camera_projection(&mut projection, &state);
    Ok(())
}

fn editor_camera_transform(state: &EditorCameraState) -> Transform {
    match state.camera_kind {
        EditorCameraKind::FirstPerson => Transform {
            translation: Vec3::from_array(state.pose.position),
            rotation: Quat::from_euler(
                EulerRot::YXZ,
                state.pose.yaw,
                state.pose.pitch,
                state.pose.roll,
            ),
            ..default()
        },
        EditorCameraKind::Arcball => {
            let target = Vec3::from_array(state.pose.target);
            let rotation = Quat::from_euler(
                EulerRot::YXZ,
                state.pose.yaw,
                state.pose.pitch,
                state.pose.roll,
            );
            Transform {
                translation: target - rotation.mul_vec3(Vec3::NEG_Z) * state.pose.radius,
                rotation,
                ..default()
            }
        }
    }
}

fn apply_editor_camera_projection(projection: &mut Projection, state: &EditorCameraState) {
    match state.projection {
        EditorCameraProjection::Perspective => {
            let fov = state.pose.fov_degrees.to_radians().clamp(0.1, 3.0);
            *projection = Projection::Perspective(PerspectiveProjection {
                fov,
                near: 0.02,
                ..default()
            });
        }
        EditorCameraProjection::Orthographic => {
            *projection = Projection::from(OrthographicProjection {
                scaling_mode: ScalingMode::FixedVertical {
                    viewport_height: state.pose.orthographic_scale.clamp(1.0, 4096.0),
                },
                near: -4096.0,
                far: 8192.0,
                ..OrthographicProjection::default_3d()
            });
        }
    }
}

fn align_editor_camera_pose(state: &mut EditorCameraState, axis: Option<String>, automatic: bool) {
    state.align_to_axes = true;
    state.automatic_axis = automatic;
    let normalized = axis
        .as_deref()
        .unwrap_or("nearest")
        .trim()
        .to_ascii_lowercase();
    match normalized.as_str() {
        "x" | "posx" | "+x" => {
            state.pose.yaw = std::f32::consts::FRAC_PI_2;
            state.pose.pitch = 0.0;
        }
        "negx" | "-x" => {
            state.pose.yaw = -std::f32::consts::FRAC_PI_2;
            state.pose.pitch = 0.0;
        }
        "y" | "posy" | "+y" => {
            state.pose.yaw = 0.0;
            state.pose.pitch = -std::f32::consts::FRAC_PI_2;
        }
        "negy" | "-y" => {
            state.pose.yaw = 0.0;
            state.pose.pitch = std::f32::consts::FRAC_PI_2;
        }
        "z" | "posz" | "+z" => {
            state.pose.yaw = std::f32::consts::PI;
            state.pose.pitch = 0.0;
        }
        "negz" | "-z" => {
            state.pose.yaw = 0.0;
            state.pose.pitch = 0.0;
        }
        "isometric" => {
            state.pose.yaw = std::f32::consts::FRAC_PI_4;
            state.pose.pitch = -35.264_f32.to_radians();
        }
        "dimetric" => {
            state.pose.yaw = std::f32::consts::FRAC_PI_4;
            state.pose.pitch = -30.0_f32.to_radians();
        }
        _ => {
            let yaw_step = std::f32::consts::FRAC_PI_4;
            state.pose.yaw = (state.pose.yaw / yaw_step).round() * yaw_step;
            let pitch_step = 15.0_f32.to_radians();
            state.pose.pitch = (state.pose.pitch / pitch_step).round() * pitch_step;
        }
    }
}

fn current_editor_saved_camera(
    state: &EditorCameraState,
    name: Option<String>,
    description: Option<String>,
) -> EditorSavedCamera {
    let now = timestamp_string();
    let next_index = state.saved_cameras.len() + 1;
    EditorSavedCamera {
        id: format!("camera-{}-{}", unix_timestamp_millis(), next_index),
        name: name.unwrap_or_else(|| format!("Camera {next_index}")),
        description,
        camera_kind: state.camera_kind,
        projection: state.projection,
        pose: state.pose.clone(),
        align_to_axes: state.align_to_axes,
        automatic_axis: state.automatic_axis,
        created_at: now.clone(),
        updated_at: now,
    }
}

fn unix_timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn runtime_selection_payload(world: &World) -> (Value, Value) {
    if let Some(selected_prop) = world.get_resource::<SelectedProp>() {
        if let (Some(id), Some(label)) = (&selected_prop.id, &selected_prop.label) {
            return (
                json!({
                    "kind": "prop",
                    "id": id,
                    "label": label,
                }),
                selected_prop
                    .position
                    .map(|position| json!([position.x, position.y, position.z]))
                    .unwrap_or(Value::Null),
            );
        }
    }

    if let Some(selected_block) = world.get_resource::<SelectedBlock>() {
        if let Some(position) = selected_block.position {
            return voxel_selection_payload(
                position,
                selected_block.voxel_type.unwrap_or_default(),
            );
        }
    }

    let Some(targeted_block) = world.get_resource::<TargetedBlock>() else {
        return (Value::Null, Value::Null);
    };
    let Some(position) = targeted_block.position else {
        return (Value::Null, Value::Null);
    };

    voxel_selection_payload(position, targeted_block.voxel_type.unwrap_or_default())
}

fn voxel_selection_payload(position: IVec3, voxel: VoxelType) -> (Value, Value) {
    let material = voxel_material_name(voxel);
    let chunk = position.div_euclid(IVec3::splat(CHUNK_SIZE_I32));

    (
        json!({
            "kind": "voxel",
            "chunkId": format!("chunk-{}-{}-{}", chunk.x, chunk.y, chunk.z),
            "position": [position.x, position.y, position.z],
            "label": format!("{material} ({}, {}, {})", position.x, position.y, position.z),
        }),
        json!([position.x, position.y, position.z]),
    )
}

fn voxel_material_name(voxel: VoxelType) -> &'static str {
    match voxel {
        VoxelType::Air => "Air",
        VoxelType::TopSoil => "TopSoil",
        VoxelType::SubSoil => "SubSoil",
        VoxelType::Rock => "Rock",
        VoxelType::Bedrock => "Bedrock",
        VoxelType::Sand => "Sand",
        VoxelType::Clay => "Clay",
        VoxelType::Water => "Water",
        VoxelType::Wood => "Wood",
        VoxelType::Leaves => "Leaves",
        VoxelType::DungeonWall => "DungeonWall",
        VoxelType::DungeonFloor => "DungeonFloor",
    }
}

fn validate_selection_payload(selection: &Value, errors: &mut Vec<String>) {
    let Some(kind) = selection.get("kind").and_then(Value::as_str) else {
        errors.push("selection.kind is required.".to_string());
        return;
    };

    match kind {
        "voxel" => {
            if value_position(selection.get("position")).is_none() {
                errors.push("voxel selection requires position [x, y, z].".to_string());
            }
        }
        "chunk" | "area" | "prop" | "water" | "light" | "material" | "debug_resource" => {
            if selection.get("id").and_then(Value::as_str).is_none() {
                errors.push(format!("{kind} selection requires id."));
            }
        }
        _ => errors.push(format!("selection kind '{kind}' is not supported.")),
    }
}

fn resolve_focus_target_preview(target: &Value) -> Option<()> {
    if value_position(Some(target)).is_some() {
        return Some(());
    }

    let kind = target.get("kind").and_then(Value::as_str)?;
    match kind {
        "voxel" => value_position(target.get("position")).map(|_| ()),
        "chunk" | "area" | "light" => target.get("id").and_then(Value::as_str).map(|_| ()),
        _ => None,
    }
}

fn focus_runtime_camera(world: &mut World, target: &Value) -> Result<Value, String> {
    let target_position = resolve_focus_target(world, target)?;
    let camera_position = target_position + Vec3::new(32.0, 24.0, 32.0);
    let next_transform =
        Transform::from_translation(camera_position).looking_at(target_position, Vec3::Y);

    let mut query =
        world.query_filtered::<(&mut Transform, &mut PlayerCamera), With<PlayerCamera>>();
    let Ok((mut transform, mut camera)) = query.single_mut(world) else {
        return Err("PlayerCamera is not available in this runtime.".to_string());
    };

    let (yaw, pitch, _) = next_transform.rotation.to_euler(EulerRot::YXZ);
    camera.mode = CameraMode::Fly;
    camera.yaw = yaw;
    camera.pitch = pitch;
    *transform = next_transform;
    drop(query);

    if let Some(mut editor_camera) = world.get_resource_mut::<EditorCameraState>() {
        editor_camera.camera_kind = EditorCameraKind::FirstPerson;
        editor_camera.projection = EditorCameraProjection::Perspective;
        editor_camera.pose.position = camera_position.to_array();
        editor_camera.pose.target = target_position.to_array();
        editor_camera.pose.yaw = yaw;
        editor_camera.pose.pitch = pitch;
        editor_camera.pose.radius = camera_position.distance(target_position).max(1.0);
    }

    Ok(json!({
        "target": [target_position.x, target_position.y, target_position.z],
        "camera": [camera_position.x, camera_position.y, camera_position.z],
        "mode": "Fly",
    }))
}

fn resolve_focus_target(world: &World, target: &Value) -> Result<Vec3, String> {
    if let Some(position) = value_position(Some(target)) {
        return Ok(position);
    }

    let kind = target
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| "Focus target requires kind.".to_string())?;

    match kind {
        "voxel" => value_position(target.get("position"))
            .map(|position| position + Vec3::splat(0.5))
            .ok_or_else(|| "Voxel focus target requires position [x, y, z].".to_string()),
        "chunk" => {
            let chunk_id = target
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Chunk focus target requires id.".to_string())?;
            let chunk = parse_chunk_id(chunk_id).ok_or_else(|| {
                format!("Chunk id '{chunk_id}' must look like chunk-x-z or chunk-x-y-z.")
            })?;
            Ok(chunk.as_vec3() * CHUNK_SIZE_I32 as f32 + Vec3::splat(CHUNK_SIZE_I32 as f32 * 0.5))
        }
        "area" => {
            let area_id = target
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Area focus target requires id.".to_string())?;
            let registry = world
                .get_resource::<ProtectedAreaRegistry>()
                .ok_or_else(|| "ProtectedAreaRegistry resource is not available.".to_string())?;
            let area = registry.get(area_id).ok_or_else(|| {
                format!("Protected area '{area_id}' does not exist in the runtime.")
            })?;
            Ok(Vec3::new(area.center[0], area.center[1], area.center[2]))
        }
        "light" => {
            let light_id = target
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Light focus target requires id.".to_string())?;
            let light = editor_lights_payload(world)
                .into_iter()
                .find(|candidate| candidate.id == light_id)
                .ok_or_else(|| format!("Light '{light_id}' does not exist in the runtime."))?;
            Ok(Vec3::new(
                light.position[0],
                light.position[1],
                light.position[2],
            ))
        }
        _ => Err(format!("Focus target kind '{kind}' is not supported.")),
    }
}

fn value_position(value: Option<&Value>) -> Option<Vec3> {
    let parts = value?.as_array()?;
    let [x, y, z] = parts.as_slice() else {
        return None;
    };
    Some(Vec3::new(
        x.as_f64()? as f32,
        y.as_f64()? as f32,
        z.as_f64()? as f32,
    ))
}

fn prop_asset_id(prop: &Value) -> Option<&str> {
    prop.get("assetId")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
}

fn prop_position(prop: &Value) -> Option<Vec3> {
    value_position(
        prop.get("transform")
            .and_then(|transform| transform.get("position")),
    )
    .or_else(|| value_position(prop.get("position")))
}

fn prop_rotation(prop: &Value) -> Option<Vec3> {
    value_position(
        prop.get("transform")
            .and_then(|transform| transform.get("rotation")),
    )
}

fn prop_scale(prop: &Value) -> Option<Vec3> {
    value_position(
        prop.get("transform")
            .and_then(|transform| transform.get("scale")),
    )
}

fn prop_type_from_value(prop: &Value) -> PropType {
    match prop.get("type").and_then(Value::as_str) {
        Some("tree") => PropType::Tree,
        Some("bush") => PropType::Bush,
        Some("flower") => PropType::Flower,
        Some("rock") | Some("building") | _ => PropType::Rock,
    }
}

fn validate_editor_light(light: &EditorLightInstance, errors: &mut Vec<String>) {
    if light.id.trim().is_empty() {
        errors.push("light.id is required.".to_string());
    }
    if light.name.trim().is_empty() {
        errors.push("light.name is required.".to_string());
    }
    validate_finite_vec3("light.position", &light.position, errors);
    validate_finite_vec3("light.rotation", &light.rotation, errors);
    if !light.intensity.is_finite() || light.intensity < 0.0 {
        errors.push("light.intensity must be a finite non-negative number.".to_string());
    }
    if !light.range.is_finite() || light.range < 0.0 {
        errors.push("light.range must be a finite non-negative number.".to_string());
    }
    if !light.radius.is_finite() || light.radius < 0.0 {
        errors.push("light.radius must be a finite non-negative number.".to_string());
    }
    if parse_hex_color(&light.color).is_none() {
        errors.push("light.color must be a #RRGGBB color.".to_string());
    }
}

fn validate_editor_light_patch(patch: &EditorLightPatch, errors: &mut Vec<String>) {
    if let Some(position) = &patch.position {
        validate_finite_vec3("light.position", position, errors);
    }
    if let Some(rotation) = &patch.rotation {
        validate_finite_vec3("light.rotation", rotation, errors);
    }
    if patch
        .intensity
        .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        errors.push("light.intensity must be a finite non-negative number.".to_string());
    }
    if patch
        .range
        .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        errors.push("light.range must be a finite non-negative number.".to_string());
    }
    if patch
        .radius
        .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        errors.push("light.radius must be a finite non-negative number.".to_string());
    }
    if patch
        .color
        .as_ref()
        .is_some_and(|color| parse_hex_color(color).is_none())
    {
        errors.push("light.color must be a #RRGGBB color.".to_string());
    }
}

fn validate_light_atmosphere_patch(patch: &LightAtmospherePatch, errors: &mut Vec<String>) {
    if patch
        .light_color
        .as_ref()
        .is_some_and(|color| parse_hex_color(color).is_none())
    {
        errors.push("lightColor must be a #RRGGBB color.".to_string());
    }
    if patch
        .ambient_color
        .as_ref()
        .is_some_and(|color| parse_hex_color(color).is_none())
    {
        errors.push("ambientColor must be a #RRGGBB color.".to_string());
    }
    if patch
        .light_illuminance
        .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        errors.push("lightIlluminance must be a finite non-negative number.".to_string());
    }
    if patch
        .light_azimuth_degrees
        .is_some_and(|value| !value.is_finite() || !(-360.0..=360.0).contains(&value))
    {
        errors.push("lightAzimuthDegrees must be finite and between -360 and 360.".to_string());
    }
    if patch
        .light_elevation_degrees
        .is_some_and(|value| !value.is_finite() || !(-90.0..=90.0).contains(&value))
    {
        errors.push("lightElevationDegrees must be finite and between -90 and 90.".to_string());
    }
    if let Some(direction) = &patch.light_direction {
        validate_finite_vec3("lightDirection", direction, errors);
        if direction
            .iter()
            .all(|component| component.abs() <= f32::EPSILON)
        {
            errors.push("lightDirection must not be the zero vector.".to_string());
        }
    }
    if patch
        .atmosphere_amount
        .is_some_and(|value| !value.is_finite() || !(0.0..=8.0).contains(&value))
    {
        errors.push("atmosphereAmount must be finite and between 0 and 8.".to_string());
    }
    if patch
        .atmosphere_half_length
        .is_some_and(|value| !value.is_finite() || !(1.0..=100_000.0).contains(&value))
    {
        errors.push("atmosphereHalfLength must be finite and between 1 and 100000.".to_string());
    }
    if patch
        .ambient_brightness
        .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        errors.push("ambientBrightness must be a finite non-negative number.".to_string());
    }
}

pub fn validate_runtime_write_command(command: &RuntimeWriteCommand) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    match command {
        RuntimeWriteCommand::SelectEntity { selection } => {
            validate_selection_payload(selection, &mut errors);
        }
        RuntimeWriteCommand::FocusCamera { target } => {
            if resolve_focus_target_preview(target).is_none() {
                errors.push(
                    "target must be a voxel/chunk/area selection or a [x, y, z] position."
                        .to_string(),
                );
            }
        }
        RuntimeWriteCommand::SetEditorCameraProjection {
            fov_degrees,
            orthographic_scale,
            ..
        } => {
            if fov_degrees
                .is_some_and(|value| !value.is_finite() || !(5.0..=170.0).contains(&value))
            {
                errors.push("fovDegrees must be finite and between 5 and 170.".to_string());
            }
            if orthographic_scale
                .is_some_and(|value| !value.is_finite() || !(1.0..=4096.0).contains(&value))
            {
                errors.push("orthographicScale must be finite and between 1 and 4096.".to_string());
            }
        }
        RuntimeWriteCommand::SetEditorCameraPose { pose } => {
            validate_finite_vec3("pose.position", &pose.position, &mut errors);
            validate_finite_vec3("pose.target", &pose.target, &mut errors);
            for (field, value) in [
                ("pose.yaw", pose.yaw),
                ("pose.pitch", pose.pitch),
                ("pose.roll", pose.roll),
                ("pose.radius", pose.radius),
                ("pose.fovDegrees", pose.fov_degrees),
                ("pose.orthographicScale", pose.orthographic_scale),
            ] {
                if !value.is_finite() {
                    errors.push(format!("{field} must be finite."));
                }
            }
            if pose.radius <= 0.0 {
                errors.push("pose.radius must be greater than zero.".to_string());
            }
        }
        RuntimeWriteCommand::UpdateSavedEditorCamera { camera_id, .. }
        | RuntimeWriteCommand::DeleteSavedEditorCamera { camera_id }
        | RuntimeWriteCommand::RecallSavedEditorCamera { camera_id } => {
            if camera_id.trim().is_empty() {
                errors.push("cameraId is required.".to_string());
            }
        }
        RuntimeWriteCommand::StepSavedEditorCamera { direction } => {
            if *direction == 0 {
                errors.push("direction must be non-zero.".to_string());
            }
        }
        RuntimeWriteCommand::ImportEditorCameraTemplate { template } => {
            if !template.is_object() {
                errors.push("template must be an object.".to_string());
            }
        }
        RuntimeWriteCommand::SetWaterReflectionDebugMode { water_body_id, .. } => {
            if water_body_id.trim().is_empty() {
                errors.push("waterBodyId is required.".to_string());
            }
        }
        RuntimeWriteCommand::SetRenderFeatureFlag { value, .. }
        | RuntimeWriteCommand::SetShaderFeature { value, .. } => {
            if value.is_some_and(|value| !value.is_finite() || value < 0.0) {
                errors.push("value must be a finite non-negative number.".to_string());
            }
        }
        RuntimeWriteCommand::UpdateAmbientLight { color, brightness } => {
            if parse_hex_color(color).is_none() {
                errors.push("color must be a #RRGGBB color.".to_string());
            }
            if !brightness.is_finite() || *brightness < 0.0 {
                errors.push("brightness must be a finite non-negative number.".to_string());
            }
        }
        RuntimeWriteCommand::UpdateLightAtmosphere { patch } => {
            validate_light_atmosphere_patch(patch, &mut errors);
        }
        RuntimeWriteCommand::ImportLightAtmosphereTemplate { template } => {
            if !template.is_object() {
                errors.push("template must be an object.".to_string());
            }
        }
        RuntimeWriteCommand::UpdateWaterBody {
            water_body_id,
            patch,
        } => {
            if parse_water_body_id(water_body_id).is_none() {
                errors.push(format!(
                    "waterBodyId '{water_body_id}' must look like water-body-n or a numeric id."
                ));
            }
            validate_water_body_patch(patch, &mut errors);
        }
        RuntimeWriteCommand::RebuildSelectedChunk { chunk_id } => {
            if parse_chunk_id(chunk_id).is_none() {
                errors.push(format!(
                    "chunkId '{chunk_id}' must look like chunk-x-z or chunk-x-y-z."
                ));
            }
        }
        RuntimeWriteCommand::RebuildDirtyChunks { chunk_ids } => {
            for chunk_id in chunk_ids {
                if parse_chunk_id(chunk_id).is_none() {
                    errors.push(format!(
                        "chunkId '{chunk_id}' must look like chunk-x-z or chunk-x-y-z."
                    ));
                }
            }
        }
        RuntimeWriteCommand::CompareNaadfChunkOccupancy {
            chunk_id,
            max_mismatches,
        } => {
            if parse_chunk_id(chunk_id).is_none() {
                errors.push(format!(
                    "chunkId '{chunk_id}' must look like chunk-x-z or chunk-x-y-z."
                ));
            }
            if *max_mismatches > 256 {
                errors.push("maxMismatches must be 256 or less.".to_string());
            }
        }
        RuntimeWriteCommand::CompareNaadfRay {
            origin,
            direction,
            max_distance,
            purpose,
        } => {
            validate_finite_vec3("origin", origin, &mut errors);
            validate_finite_vec3("direction", direction, &mut errors);
            if direction
                .iter()
                .all(|component| component.abs() <= f32::EPSILON)
            {
                errors.push("direction must not be the zero vector.".to_string());
            }
            if !max_distance.is_finite() || *max_distance <= 0.0 || *max_distance > 4096.0 {
                errors.push("maxDistance must be finite and in the range (0, 4096].".to_string());
            }
            if crate::rendering::voxel_ray_backend::VoxelRayPurpose::parse(purpose).is_none() {
                errors.push(format!(
                    "purpose '{purpose}' must be debug, sun_visibility, gi_secondary, terrain_ao, contact_shadow, or preview_primary."
                ));
            }
        }
        RuntimeWriteCommand::SetAtlasMapping { mapping }
        | RuntimeWriteCommand::SaveAtlasMapping { mapping } => {
            validate_atlas_mapping(mapping, &mut errors);
        }
        RuntimeWriteCommand::PaintVoxelMaterial { material_id, .. }
        | RuntimeWriteCommand::SetActiveMaterial { material_id }
        | RuntimeWriteCommand::UpdateMaterial { material_id, .. } => {
            if parse_material_id(material_id).is_none() {
                errors.push(format!(
                    "materialId '{material_id}' must look like mat-N or one of: grass/topSoil, dirt/subSoil, rock, bedrock, sand, clay, water, wood, leaves, dungeonWall, dungeonFloor."
                ));
            }
        }
        RuntimeWriteCommand::PickVoxelMaterial { .. } => {}
        RuntimeWriteCommand::ReplaceMaterial {
            from_material_id,
            to_material_id,
        } => {
            if parse_material_id(from_material_id).is_none() {
                errors.push(format!(
                    "fromMaterialId '{from_material_id}' must look like mat-N or one of: grass/topSoil, dirt/subSoil, rock, bedrock, sand, clay, water, wood, leaves, dungeonWall, dungeonFloor."
                ));
            }
            if parse_material_id(to_material_id).is_none() {
                errors.push(format!(
                    "toMaterialId '{to_material_id}' must look like mat-N or one of: grass/topSoil, dirt/subSoil, rock, bedrock, sand, clay, water, wood, leaves, dungeonWall, dungeonFloor."
                ));
            }
        }
        RuntimeWriteCommand::GetMaterialReplaceJob { job_id } => {
            if job_id.trim().is_empty() {
                errors.push("jobId is required.".to_string());
            }
        }
        RuntimeWriteCommand::ScatterProps { props } => {
            if props.is_empty() {
                errors.push("props must include at least one prop instance.".to_string());
            }
            for prop in props {
                if prop.get("id").and_then(Value::as_str).is_none() {
                    errors.push("prop.id is required.".to_string());
                }
                if prop_asset_id(prop).is_none() {
                    errors.push("prop.assetId is required.".to_string());
                }
                if prop_position(prop).is_none() {
                    errors.push(
                        "prop.position or prop.transform.position must be [x, y, z].".to_string(),
                    );
                }
            }
        }
        RuntimeWriteCommand::RemoveProps { prop_ids, chunk_id } => {
            if prop_ids.is_empty() && chunk_id.is_none() {
                errors.push("removeProps requires propIds or chunkId.".to_string());
            }
            if let Some(chunk_id) = chunk_id {
                if parse_chunk_id(chunk_id).is_none() {
                    errors.push(format!(
                        "chunkId '{chunk_id}' must look like chunk-x-z or chunk-x-y-z."
                    ));
                }
            }
        }
        RuntimeWriteCommand::CreateLight { light } => {
            validate_editor_light(light, &mut errors);
        }
        RuntimeWriteCommand::UpdateLight { light_id, patch } => {
            if light_id.trim().is_empty() {
                errors.push("lightId is required.".to_string());
            }
            validate_editor_light_patch(patch, &mut errors);
        }
        RuntimeWriteCommand::DeleteLight { light_id } => {
            if light_id.trim().is_empty() {
                errors.push("lightId is required.".to_string());
            }
        }
        RuntimeWriteCommand::CreateProtectedArea { area } => {
            if let Err(message) = validate_protected_area(area) {
                errors.push(message);
            }
        }
        RuntimeWriteCommand::UpdateProtectedArea { area_id, .. }
        | RuntimeWriteCommand::DeleteProtectedArea { area_id } => {
            if area_id.trim().is_empty() {
                errors.push("areaId is required.".to_string());
            }
        }
        RuntimeWriteCommand::QueryProtectedRulesAtVoxel { .. } => {}
        RuntimeWriteCommand::ValidateProtectedAreaConflicts { area } => {
            if let Some(area) = area {
                if let Err(message) = validate_protected_area(area) {
                    errors.push(message);
                }
            }
        }
        RuntimeWriteCommand::PreviewTerrainRecipe { request } => {
            if let Err(request_errors) = validate_terrain_preview_request(request) {
                errors.extend(request_errors);
            }
        }
        RuntimeWriteCommand::SetRenderQuality { .. }
        | RuntimeWriteCommand::SetEditorCameraMode { .. }
        | RuntimeWriteCommand::AlignEditorCameraToAxes { .. }
        | RuntimeWriteCommand::AddSavedEditorCamera { .. }
        | RuntimeWriteCommand::ExportEditorCameraTemplate {}
        | RuntimeWriteCommand::GetLightAtmosphere {}
        | RuntimeWriteCommand::UpdateTerrainTexturing { .. }
        | RuntimeWriteCommand::ExportLightAtmosphereTemplate {}
        | RuntimeWriteCommand::SetViewportDebugOverlay { .. }
        | RuntimeWriteCommand::SetEditorDiagnostics { .. }
        | RuntimeWriteCommand::RunWaterVisualProbe {}
        | RuntimeWriteCommand::GetDefaultTerrainRecipe {}
        | RuntimeWriteCommand::SaveLights {}
        | RuntimeWriteCommand::LoadLights {}
        | RuntimeWriteCommand::SaveProtectedAreas {}
        | RuntimeWriteCommand::LoadProtectedAreas {}
        | RuntimeWriteCommand::SaveWorldSnapshot { .. } => {}
        RuntimeWriteCommand::SetVoxel { .. } => {}
        RuntimeWriteCommand::ApplyVoxelBrush { brush } => {
            validate_voxel_brush(brush, &mut errors);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn validate_finite_vec3(field: &str, value: &[f32; 3], errors: &mut Vec<String>) {
    if value.iter().any(|component| !component.is_finite()) {
        errors.push(format!("{field} must contain only finite numbers."));
    }
}

fn validate_terrain_preview_request(request: &TerrainPreviewRequest) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    if request.recipe.version != 1 {
        errors.push("recipe.version must be 1.".to_string());
    }
    if request.size[0] == 0 || request.size[1] == 0 {
        errors.push("size dimensions must be greater than zero.".to_string());
    }
    if request.size[0] > TERRAIN_PREVIEW_MAX_SIZE_VOXELS
        || request.size[1] > TERRAIN_PREVIEW_MAX_SIZE_VOXELS
    {
        errors.push(format!(
            "size dimensions must be {} voxels or less.",
            TERRAIN_PREVIEW_MAX_SIZE_VOXELS
        ));
    }
    if !(TERRAIN_PREVIEW_MIN_RESOLUTION..=TERRAIN_PREVIEW_MAX_RESOLUTION)
        .contains(&request.resolution)
    {
        errors.push(format!(
            "resolution must be between {} and {}.",
            TERRAIN_PREVIEW_MIN_RESOLUTION, TERRAIN_PREVIEW_MAX_RESOLUTION
        ));
    }
    if request.resolution.saturating_mul(request.resolution) > TERRAIN_PREVIEW_MAX_CELLS {
        errors.push(format!(
            "preview requests must contain {} cells or fewer.",
            TERRAIN_PREVIEW_MAX_CELLS
        ));
    }
    if !request.recipe.config.height.min.is_finite()
        || !request.recipe.config.height.max.is_finite()
        || request.recipe.config.height.min >= request.recipe.config.height.max
    {
        errors.push("config.height.min must be lower than config.height.max.".to_string());
    }
    validate_terrain_preview_config(&request.recipe.config, &mut errors);

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn validate_terrain_preview_config(config: &TerrainConfig, errors: &mut Vec<String>) {
    validate_finite_range(
        "config.height.min",
        config.height.min,
        -1024.0,
        4096.0,
        errors,
    );
    validate_finite_range(
        "config.height.max",
        config.height.max,
        -1024.0,
        4096.0,
        errors,
    );
    validate_finite_range(
        "config.height.sea_level",
        config.height.sea_level,
        -1024.0,
        4096.0,
        errors,
    );
    validate_noise_layer("config.continent", &config.continent, errors);
    validate_mountain_config(&config.mountains, errors);
    validate_noise_layer("config.hills", &config.hills, errors);
    validate_noise_layer("config.detail", &config.detail, errors);
    validate_river_config(&config.rivers, errors);
    validate_basin_config(
        "config.water_bodies.lakes",
        &config.water_bodies.lakes,
        errors,
    );
    validate_basin_config(
        "config.water_bodies.ponds",
        &config.water_bodies.ponds,
        errors,
    );
    validate_aquifer_config(&config.water_bodies.aquifers, errors);

    for (name, modifier) in &config.biome_modifiers {
        if name.trim().is_empty() {
            errors.push("config.biome_modifiers keys must not be empty.".to_string());
        }
        validate_finite_range(
            &format!("config.biome_modifiers.{name}"),
            *modifier,
            -8.0,
            8.0,
            errors,
        );
    }
}

fn validate_noise_layer(field: &str, layer: &NoiseLayer, errors: &mut Vec<String>) {
    validate_finite_range(
        &format!("{field}.scale"),
        layer.scale,
        0.000001,
        1.0,
        errors,
    );
    validate_finite_range(
        &format!("{field}.amplitude"),
        layer.amplitude,
        0.0,
        512.0,
        errors,
    );
    validate_octaves(&format!("{field}.octaves"), layer.octaves, errors);
    validate_finite_range(
        &format!("{field}.persistence"),
        layer.persistence,
        0.0,
        1.0,
        errors,
    );
    validate_finite_range(
        &format!("{field}.lacunarity"),
        layer.lacunarity,
        1.0,
        8.0,
        errors,
    );
}

fn validate_mountain_config(config: &MountainConfig, errors: &mut Vec<String>) {
    let layer = NoiseLayer {
        scale: config.scale,
        amplitude: config.amplitude,
        octaves: config.octaves,
        persistence: config.persistence,
        lacunarity: config.lacunarity,
    };
    validate_noise_layer("config.mountains", &layer, errors);
    validate_finite_range(
        "config.mountains.ridge_power",
        config.ridge_power,
        0.25,
        8.0,
        errors,
    );
    validate_finite_range(
        "config.mountains.massif_scale",
        config.massif_scale,
        0.000001,
        1.0,
        errors,
    );
    validate_finite_range(
        "config.mountains.massif_amplitude",
        config.massif_amplitude,
        0.0,
        512.0,
        errors,
    );
    validate_finite_range(
        "config.mountains.massif_threshold",
        config.massif_threshold,
        0.0,
        1.0,
        errors,
    );
    validate_finite_range(
        "config.mountains.massif_power",
        config.massif_power,
        0.25,
        8.0,
        errors,
    );
}

fn validate_river_config(config: &RiverConfig, errors: &mut Vec<String>) {
    validate_finite_range("config.rivers.scale", config.scale, 0.000001, 1.0, errors);
    validate_finite_range("config.rivers.width", config.width, 0.0, 128.0, errors);
    validate_finite_range("config.rivers.depth", config.depth, 0.0, 128.0, errors);
    validate_octaves("config.rivers.octaves", config.octaves, errors);
    validate_finite_range(
        "config.rivers.tributary_scale",
        config.tributary_scale,
        0.000001,
        1.0,
        errors,
    );
    validate_finite_range(
        "config.rivers.tributary_width",
        config.tributary_width,
        0.0,
        128.0,
        errors,
    );
}

fn validate_basin_config(field: &str, config: &BasinConfig, errors: &mut Vec<String>) {
    validate_finite_range(
        &format!("{field}.spacing"),
        config.spacing,
        1.0,
        2048.0,
        errors,
    );
    validate_finite_range(
        &format!("{field}.density"),
        config.density,
        0.0,
        1.0,
        errors,
    );
    validate_finite_range(
        &format!("{field}.min_radius"),
        config.min_radius,
        0.0,
        512.0,
        errors,
    );
    validate_finite_range(
        &format!("{field}.max_radius"),
        config.max_radius,
        0.0,
        512.0,
        errors,
    );
    if config.min_radius > config.max_radius {
        errors.push(format!(
            "{field}.min_radius must be less than or equal to max_radius."
        ));
    }
    validate_finite_range(
        &format!("{field}.min_depth"),
        config.min_depth,
        0.0,
        128.0,
        errors,
    );
    validate_finite_range(
        &format!("{field}.max_depth"),
        config.max_depth,
        0.0,
        128.0,
        errors,
    );
    if config.min_depth > config.max_depth {
        errors.push(format!(
            "{field}.min_depth must be less than or equal to max_depth."
        ));
    }
    validate_finite_range(
        &format!("{field}.shore_power"),
        config.shore_power,
        0.25,
        8.0,
        errors,
    );
}

fn validate_aquifer_config(config: &AquiferConfig, errors: &mut Vec<String>) {
    if !(-1024..=4096).contains(&config.max_y) {
        errors
            .push("config.water_bodies.aquifers.max_y must be between -1024 and 4096.".to_string());
    }
    validate_finite_range(
        "config.water_bodies.aquifers.noise_scale",
        config.noise_scale,
        0.000001,
        1.0,
        errors,
    );
    validate_finite_range(
        "config.water_bodies.aquifers.threshold",
        config.threshold,
        0.0,
        1.0,
        errors,
    );
}

fn validate_octaves(field: &str, value: u32, errors: &mut Vec<String>) {
    if value > TERRAIN_PREVIEW_MAX_OCTAVES {
        errors.push(format!(
            "{field} must be {} or less.",
            TERRAIN_PREVIEW_MAX_OCTAVES
        ));
    }
}

fn validate_finite_range(field: &str, value: f32, min: f32, max: f32, errors: &mut Vec<String>) {
    if !value.is_finite() || value < min || value > max {
        errors.push(format!(
            "{field} must be a finite number between {min} and {max}."
        ));
    }
}

fn default_terrain_recipe_payload() -> Value {
    json!({
        "recipe": TerrainRecipe {
            version: 1,
            seed: 0,
            config: TerrainConfig::load_or_default(),
        },
        "fingerprint": format!("{:#018x}", terrain_config_fingerprint()),
    })
}

fn terrain_preview_payload(request: &TerrainPreviewRequest, biome_table: BiomeTable) -> Value {
    let started = Instant::now();
    let generator = TerrainGenerator::with_config_seed_and_biome_table(
        ValueNoise::new(request.recipe.seed),
        request.recipe.config.clone(),
        request.recipe.seed,
        biome_table,
    );
    let resolution = request.resolution;
    let denominator = (resolution - 1).max(1) as f32;
    let mut samples = Vec::with_capacity((resolution * resolution) as usize);
    let mut min_height = i32::MAX;
    let mut max_height = i32::MIN;
    let mut sum_height = 0_i64;
    let mut water_cells = 0_u32;
    let mut tree_cells = 0_u32;

    for row in 0..resolution {
        for col in 0..resolution {
            let x = request.origin[0]
                + ((col as f32 / denominator) * request.size[0] as f32).round() as i32;
            let z = request.origin[1]
                + ((row as f32 / denominator) * request.size[1] as f32).round() as i32;
            let (height, water) = generator.get_height_and_water_generation_metadata(x, z);
            let biome = generator.get_biome(x, z);
            let material = if water.is_surface_water() {
                VoxelType::Water
            } else {
                generator.get_voxel(x, height, z)
            };
            let tree = generator.should_spawn_tree(x, z, height);

            min_height = min_height.min(height);
            max_height = max_height.max(height);
            sum_height += height as i64;
            if water.is_surface_water() {
                water_cells += 1;
            }
            if tree {
                tree_cells += 1;
            }

            samples.push(json!({
                "x": x,
                "z": z,
                "height": height,
                "biome": biome_label(biome),
                "material": voxel_label(material),
                "water": water.is_surface_water(),
                "waterKind": water_kind_label(water.kind),
                "waterDepth": water.local_depth,
                "surfaceY": water.surface_y,
                "tree": tree,
            }));
        }
    }

    let sample_count = samples.len().max(1);
    json!({
        "recipe": request.recipe,
        "origin": request.origin,
        "size": request.size,
        "resolution": resolution,
        "samples": samples,
        "stats": {
            "minHeight": min_height,
            "maxHeight": max_height,
            "avgHeight": sum_height as f64 / sample_count as f64,
            "waterCells": water_cells,
            "treeCells": tree_cells,
        },
        "fingerprint": format!("{:#018x}", terrain_config_fingerprint()),
        "timingMs": started.elapsed().as_secs_f64() * 1000.0,
    })
}

fn biome_label(biome: Biome) -> &'static str {
    match biome {
        Biome::Grassland => "Grassland",
        Biome::Sandy => "Sandy",
        Biome::Rocky => "Rocky",
        Biome::Clay => "Clay",
    }
}

fn water_kind_label(kind: GeneratedWaterBodyKind) -> &'static str {
    match kind {
        GeneratedWaterBodyKind::Ocean => "Ocean",
        GeneratedWaterBodyKind::LakeBasin => "LakeBasin",
        GeneratedWaterBodyKind::RiverChannel => "RiverChannel",
        GeneratedWaterBodyKind::Pond => "Pond",
        GeneratedWaterBodyKind::CaveWaterAquifer => "CaveWaterAquifer",
        GeneratedWaterBodyKind::None => "None",
    }
}

fn voxel_label(voxel: VoxelType) -> &'static str {
    match voxel {
        VoxelType::Air => "Air",
        VoxelType::TopSoil => "TopSoil",
        VoxelType::SubSoil => "SubSoil",
        VoxelType::Rock => "Rock",
        VoxelType::Bedrock => "Bedrock",
        VoxelType::Sand => "Sand",
        VoxelType::Clay => "Clay",
        VoxelType::Water => "Water",
        VoxelType::Wood => "Wood",
        VoxelType::Leaves => "Leaves",
        VoxelType::DungeonWall => "DungeonWall",
        VoxelType::DungeonFloor => "DungeonFloor",
    }
}

fn execute_runtime_write_command(
    world: &mut World,
    command: RuntimeWriteCommand,
) -> RuntimeCommandResult<Value> {
    if let Err(errors) = validate_runtime_write_command(&command) {
        return RuntimeCommandResult::validation("Runtime command validation failed.", errors);
    }

    match command {
        RuntimeWriteCommand::SelectEntity { selection } => {
            RuntimeCommandResult::success(json!({ "selection": selection }))
        }
        RuntimeWriteCommand::FocusCamera { target } => match focus_runtime_camera(world, &target) {
            Ok(data) => RuntimeCommandResult::success(data),
            Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
        },
        RuntimeWriteCommand::SetEditorCameraMode {
            interaction_mode,
            camera_kind,
        } => {
            {
                let mut state = world
                    .get_resource_mut::<EditorCameraState>()
                    .expect("EditorCameraState should be initialized");
                if let Some(interaction_mode) = interaction_mode {
                    state.interaction_mode = interaction_mode;
                    state.movement_latched =
                        interaction_mode == EditorCameraInteractionMode::Movement;
                }
                if let Some(camera_kind) = camera_kind {
                    state.camera_kind = camera_kind;
                }
            }
            match apply_editor_camera_to_runtime(world) {
                Ok(()) => RuntimeCommandResult::success(editor_camera_payload(world)),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::SetEditorCameraProjection {
            projection,
            fov_degrees,
            orthographic_scale,
        } => {
            {
                let mut state = world
                    .get_resource_mut::<EditorCameraState>()
                    .expect("EditorCameraState should be initialized");
                state.projection = projection;
                if let Some(fov_degrees) = fov_degrees {
                    state.pose.fov_degrees = fov_degrees.clamp(5.0, 170.0);
                }
                if let Some(orthographic_scale) = orthographic_scale {
                    state.pose.orthographic_scale = orthographic_scale.clamp(1.0, 4096.0);
                }
            }
            match apply_editor_camera_to_runtime(world) {
                Ok(()) => RuntimeCommandResult::success(editor_camera_payload(world)),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::SetEditorCameraPose { pose } => {
            {
                let mut state = world
                    .get_resource_mut::<EditorCameraState>()
                    .expect("EditorCameraState should be initialized");
                state.pose = pose;
            }
            match apply_editor_camera_to_runtime(world) {
                Ok(()) => RuntimeCommandResult::success(editor_camera_payload(world)),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::AlignEditorCameraToAxes { axis, automatic } => {
            {
                let mut state = world
                    .get_resource_mut::<EditorCameraState>()
                    .expect("EditorCameraState should be initialized");
                align_editor_camera_pose(&mut state, axis, automatic);
            }
            match apply_editor_camera_to_runtime(world) {
                Ok(()) => RuntimeCommandResult::success(editor_camera_payload(world)),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::AddSavedEditorCamera { name, description } => {
            let saved = {
                let mut state = world
                    .get_resource_mut::<EditorCameraState>()
                    .expect("EditorCameraState should be initialized");
                let saved = current_editor_saved_camera(&state, name, description);
                state.active_saved_camera_id = Some(saved.id.clone());
                state.saved_cameras.push(saved.clone());
                saved
            };
            match save_editor_cameras_to_disk(world) {
                Ok(()) => RuntimeCommandResult::success(json!({
                    "camera": saved,
                    "editorCamera": editor_camera_payload(world),
                })),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::UpdateSavedEditorCamera {
            camera_id,
            name,
            description,
        } => {
            let updated = {
                let mut state = world
                    .get_resource_mut::<EditorCameraState>()
                    .expect("EditorCameraState should be initialized");
                let camera_kind = state.camera_kind;
                let projection = state.projection;
                let pose = state.pose.clone();
                let align_to_axes = state.align_to_axes;
                let automatic_axis = state.automatic_axis;
                let Some(saved) = state
                    .saved_cameras
                    .iter_mut()
                    .find(|saved| saved.id == camera_id)
                else {
                    return RuntimeCommandResult::validation(
                        "Runtime command validation failed.",
                        vec![format!("Saved camera '{camera_id}' does not exist.")],
                    );
                };
                if let Some(name) = name {
                    saved.name = name;
                }
                saved.description = description.or_else(|| saved.description.clone());
                saved.camera_kind = camera_kind;
                saved.projection = projection;
                saved.pose = pose;
                saved.align_to_axes = align_to_axes;
                saved.automatic_axis = automatic_axis;
                saved.updated_at = timestamp_string();
                saved.clone()
            };
            match save_editor_cameras_to_disk(world) {
                Ok(()) => RuntimeCommandResult::success(json!({
                    "camera": updated,
                    "editorCamera": editor_camera_payload(world),
                })),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::DeleteSavedEditorCamera { camera_id } => {
            let deleted = {
                let mut state = world
                    .get_resource_mut::<EditorCameraState>()
                    .expect("EditorCameraState should be initialized");
                let before = state.saved_cameras.len();
                state.saved_cameras.retain(|saved| saved.id != camera_id);
                if state.active_saved_camera_id.as_deref() == Some(camera_id.as_str()) {
                    state.active_saved_camera_id = None;
                }
                before != state.saved_cameras.len()
            };
            match save_editor_cameras_to_disk(world) {
                Ok(()) => RuntimeCommandResult::success(json!({
                    "cameraId": camera_id,
                    "deleted": deleted,
                    "editorCamera": editor_camera_payload(world),
                })),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::RecallSavedEditorCamera { camera_id } => {
            {
                let mut state = world
                    .get_resource_mut::<EditorCameraState>()
                    .expect("EditorCameraState should be initialized");
                let Some(saved) = state
                    .saved_cameras
                    .iter()
                    .find(|saved| saved.id == camera_id)
                    .cloned()
                else {
                    return RuntimeCommandResult::validation(
                        "Runtime command validation failed.",
                        vec![format!("Saved camera '{camera_id}' does not exist.")],
                    );
                };
                state.apply_saved_camera(&saved);
            }
            match apply_editor_camera_to_runtime(world) {
                Ok(()) => RuntimeCommandResult::success(editor_camera_payload(world)),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::StepSavedEditorCamera { direction } => {
            {
                let mut state = world
                    .get_resource_mut::<EditorCameraState>()
                    .expect("EditorCameraState should be initialized");
                if state.saved_cameras.is_empty() {
                    return RuntimeCommandResult::validation(
                        "Runtime command validation failed.",
                        vec!["No saved cameras exist.".to_string()],
                    );
                }
                let current_index = state
                    .active_saved_camera_id
                    .as_ref()
                    .and_then(|id| state.saved_cameras.iter().position(|saved| &saved.id == id))
                    .unwrap_or(0);
                let len = state.saved_cameras.len() as i32;
                let next_index = (current_index as i32 + direction).rem_euclid(len) as usize;
                let saved = state.saved_cameras[next_index].clone();
                state.apply_saved_camera(&saved);
            }
            match apply_editor_camera_to_runtime(world) {
                Ok(()) => RuntimeCommandResult::success(editor_camera_payload(world)),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::ImportEditorCameraTemplate { template } => {
            let template = match serde_json::from_value::<EditorCameraTemplate>(template) {
                Ok(template) if template.schema == EDITOR_CAMERA_TEMPLATE_SCHEMA => template,
                Ok(_) => {
                    return RuntimeCommandResult::validation(
                        "Runtime command validation failed.",
                        vec![format!(
                            "Camera template schema must be {EDITOR_CAMERA_TEMPLATE_SCHEMA}."
                        )],
                    );
                }
                Err(err) => {
                    return RuntimeCommandResult::validation(
                        "Runtime command validation failed.",
                        vec![err.to_string()],
                    );
                }
            };
            {
                let mut state = world
                    .get_resource_mut::<EditorCameraState>()
                    .expect("EditorCameraState should be initialized");
                state.saved_cameras = template.cameras;
                state.active_saved_camera_id =
                    state.saved_cameras.first().map(|saved| saved.id.clone());
            }
            match save_editor_cameras_to_disk(world) {
                Ok(()) => RuntimeCommandResult::success(editor_camera_payload(world)),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::ExportEditorCameraTemplate {} => {
            let state = world
                .get_resource::<EditorCameraState>()
                .cloned()
                .unwrap_or_default();
            RuntimeCommandResult::success(json!({
                "schema": EDITOR_CAMERA_TEMPLATE_SCHEMA,
                "cameras": state.saved_cameras,
            }))
        }
        RuntimeWriteCommand::SetRenderQuality { preset } => {
            let runtime_preset = preset.as_runtime();
            if let Some(mut quality) = world.get_resource_mut::<RenderQualityPreset>() {
                *quality = runtime_preset;
            } else {
                world.insert_resource(runtime_preset);
            }

            RuntimeCommandResult::success(json!({
                "preset": preset.as_frontend_str(),
                "metrics": render_quality_metrics(runtime_preset),
            }))
        }
        RuntimeWriteCommand::SetRenderFeatureFlag {
            feature,
            enabled,
            value,
        }
        | RuntimeWriteCommand::SetShaderFeature {
            feature,
            enabled,
            value,
        } => match set_render_feature_flag(world, feature, enabled, value) {
            Ok(data) => RuntimeCommandResult::success(data),
            Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
        },
        RuntimeWriteCommand::UpdateAmbientLight { color, brightness } => {
            match update_runtime_ambient_light(world, &color, brightness) {
                Ok(data) => RuntimeCommandResult::success(data),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::GetLightAtmosphere {} => {
            RuntimeCommandResult::success(light_atmosphere_payload(world))
        }
        RuntimeWriteCommand::UpdateLightAtmosphere { patch } => {
            match update_light_atmosphere(world, patch) {
                Ok(data) => RuntimeCommandResult::success(data),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::UpdateTerrainTexturing { patch } => {
            match update_terrain_texturing(world, patch) {
                Ok(data) => RuntimeCommandResult::success(data),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::ImportLightAtmosphereTemplate { template } => {
            let template = match serde_json::from_value::<LightAtmosphereTemplate>(template) {
                Ok(template) if template.schema == LIGHT_ATMOSPHERE_TEMPLATE_SCHEMA => template,
                Ok(_) => {
                    return RuntimeCommandResult::validation(
                        "Runtime command validation failed.",
                        vec![format!(
                            "Light and atmosphere template schema must be {LIGHT_ATMOSPHERE_TEMPLATE_SCHEMA}."
                        )],
                    );
                }
                Err(err) => {
                    return RuntimeCommandResult::validation(
                        "Runtime command validation failed.",
                        vec![err.to_string()],
                    );
                }
            };
            match update_light_atmosphere(world, LightAtmospherePatch::from(template.settings)) {
                Ok(data) => RuntimeCommandResult::success(data),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::ExportLightAtmosphereTemplate {} => {
            RuntimeCommandResult::success(json!({
                "schema": LIGHT_ATMOSPHERE_TEMPLATE_SCHEMA,
                "settings": light_atmosphere_payload(world),
            }))
        }
        RuntimeWriteCommand::SetWaterReflectionDebugMode {
            water_body_id,
            mode,
        } => {
            let runtime_mode = mode.as_runtime();
            if let Some(mut debug_mode) = world.get_resource_mut::<WaterReflectionDebugViewMode>() {
                *debug_mode = runtime_mode;
            } else {
                world.insert_resource(runtime_mode);
            }

            RuntimeCommandResult::success(json!({
                "waterBodyId": water_body_id,
                "mode": mode.as_frontend_str(),
            }))
        }
        RuntimeWriteCommand::UpdateWaterBody {
            water_body_id,
            patch,
        } => match update_runtime_water_body(world, &water_body_id, patch) {
            Ok(data) => RuntimeCommandResult::success(data),
            Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
        },
        RuntimeWriteCommand::RunWaterVisualProbe {} => {
            RuntimeCommandResult::success(water_visual_probe_payload(world))
        }
        RuntimeWriteCommand::GetDefaultTerrainRecipe {} => {
            RuntimeCommandResult::success(default_terrain_recipe_payload())
        }
        RuntimeWriteCommand::PreviewTerrainRecipe { request } => {
            let biome_table = *world.resource::<BiomeTable>();
            RuntimeCommandResult::success(terrain_preview_payload(&request, biome_table))
        }
        RuntimeWriteCommand::SetVoxel { position, block } => {
            match set_runtime_voxel(
                world,
                IVec3::new(position[0], position[1], position[2]),
                block,
            ) {
                Ok(data) => RuntimeCommandResult::success(data),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::PaintVoxelMaterial {
            position,
            material_id,
        } => match paint_runtime_voxel_material(
            world,
            IVec3::new(position[0], position[1], position[2]),
            &material_id,
        ) {
            Ok(data) => RuntimeCommandResult::success(data),
            Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
        },
        RuntimeWriteCommand::PickVoxelMaterial { position } => match pick_runtime_voxel_material(
            world,
            IVec3::new(position[0], position[1], position[2]),
        ) {
            Ok(data) => RuntimeCommandResult::success(data),
            Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
        },
        RuntimeWriteCommand::ReplaceMaterial {
            from_material_id,
            to_material_id,
        } => match replace_runtime_material(world, &from_material_id, &to_material_id) {
            Ok(data) => RuntimeCommandResult::success(data),
            Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
        },
        RuntimeWriteCommand::GetMaterialReplaceJob { job_id } => {
            match poll_runtime_material_replace_job(world, &job_id) {
                Ok(data) => RuntimeCommandResult::success(data),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::UpdateMaterial { material_id, patch } => {
            match update_runtime_material(world, &material_id, patch) {
                Ok(data) => RuntimeCommandResult::success(data),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::SetActiveMaterial { material_id } => {
            match set_active_runtime_material(world, &material_id) {
                Ok(data) => RuntimeCommandResult::success(data),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::ApplyVoxelBrush { brush } => {
            match apply_runtime_voxel_brush(world, &brush) {
                Ok(data) => RuntimeCommandResult::success(data),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::SetViewportDebugOverlay { overlay, enabled } => {
            set_viewport_debug_overlay(world, overlay, enabled);
            RuntimeCommandResult::success(viewport_debug_payload(world))
        }
        RuntimeWriteCommand::SetEditorDiagnostics {
            enabled,
            categories,
        } => {
            set_editor_diagnostics(world, enabled, categories);
            RuntimeCommandResult::success(editor_diagnostics_payload(world))
        }
        RuntimeWriteCommand::RebuildSelectedChunk { chunk_id } => {
            let Some(chunk_pos) = parse_chunk_id(&chunk_id) else {
                return RuntimeCommandResult::validation(
                    "Runtime command validation failed.",
                    vec![format!(
                        "chunkId '{chunk_id}' must look like chunk-x-z or chunk-x-y-z."
                    )],
                );
            };

            match mark_chunk_dirty(world, chunk_pos) {
                Ok(()) => RuntimeCommandResult::success(json!({ "queuedChunkIds": [chunk_id] })),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::RebuildDirtyChunks { chunk_ids } => {
            let mut queued = Vec::new();
            for chunk_id in chunk_ids {
                let Some(chunk_pos) = parse_chunk_id(&chunk_id) else {
                    return RuntimeCommandResult::validation(
                        "Runtime command validation failed.",
                        vec![format!(
                            "chunkId '{chunk_id}' must look like chunk-x-z or chunk-x-y-z."
                        )],
                    );
                };
                match mark_chunk_dirty(world, chunk_pos) {
                    Ok(()) => queued.push(chunk_id),
                    Err(message) => {
                        return RuntimeCommandResult::failure(
                            RuntimeCommandStatus::Failure,
                            message,
                        );
                    }
                }
            }
            RuntimeCommandResult::success(json!({ "queuedChunkIds": queued }))
        }
        RuntimeWriteCommand::CompareNaadfChunkOccupancy {
            chunk_id,
            max_mismatches,
        } => compare_naadf_chunk_occupancy(world, &chunk_id, max_mismatches),
        RuntimeWriteCommand::CompareNaadfRay {
            origin,
            direction,
            max_distance,
            purpose,
        } => compare_naadf_ray(world, origin, direction, max_distance, &purpose),
        RuntimeWriteCommand::SetAtlasMapping { mapping } => {
            match to_runtime_atlas_mapping(&mapping) {
                Ok(next_mapping) => {
                    set_atlas_mapping(world, next_mapping.clone());
                    RuntimeCommandResult::success(json!({
                        "mapping": frontend_atlas_mapping_payload(&next_mapping),
                        "dirty": true,
                    }))
                }
                Err(errors) => {
                    RuntimeCommandResult::validation("Runtime command validation failed.", errors)
                }
            }
        }
        RuntimeWriteCommand::SaveAtlasMapping { mapping } => {
            match to_runtime_atlas_mapping(&mapping) {
                Ok(next_mapping) => {
                    set_atlas_mapping(world, next_mapping.clone());
                    match next_mapping.save_to_yaml() {
                        Ok(()) => RuntimeCommandResult::success(json!({
                            "worldId": "bevy-runtime",
                            "savedAt": timestamp_string(),
                            "snapshotId": "atlas-mapping",
                        })),
                        Err(message) => {
                            RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                        }
                    }
                }
                Err(errors) => {
                    RuntimeCommandResult::validation("Runtime command validation failed.", errors)
                }
            }
        }
        RuntimeWriteCommand::ScatterProps { props } => match scatter_runtime_props(world, props) {
            Ok(data) => RuntimeCommandResult::success(data),
            Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
        },
        RuntimeWriteCommand::RemoveProps { prop_ids, chunk_id } => {
            match remove_runtime_props(world, prop_ids, chunk_id) {
                Ok(data) => RuntimeCommandResult::success(data),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::CreateLight { light } => match upsert_runtime_light(world, light) {
            Ok(light) => RuntimeCommandResult::success(json!({ "light": light })),
            Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
        },
        RuntimeWriteCommand::UpdateLight { light_id, patch } => {
            match update_runtime_light(world, &light_id, patch) {
                Ok(light) => RuntimeCommandResult::success(json!({ "light": light })),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::DeleteLight { light_id } => {
            match delete_runtime_light(world, &light_id) {
                Ok(deleted) => RuntimeCommandResult::success(
                    json!({ "lightId": light_id, "deleted": deleted }),
                ),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::SaveLights {} => match save_editor_lights(world) {
            Ok((count, path)) => RuntimeCommandResult::success(json!({
                "worldId": "bevy-runtime",
                "savedAt": timestamp_string(),
                "snapshotId": "editor-lights",
                "editorLightCount": count,
                "editorLightSavePath": path,
            })),
            Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
        },
        RuntimeWriteCommand::LoadLights {} => {
            load_editor_lights_from_disk(world);
            let lights = editor_lights_payload(world);
            RuntimeCommandResult::success(json!({
                "lights": lights,
                "lightCount": lights.len(),
            }))
        }
        RuntimeWriteCommand::CreateProtectedArea { area } => {
            let Some(mut registry) = world.get_resource_mut::<ProtectedAreaRegistry>() else {
                return RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    "ProtectedAreaRegistry resource is not available.",
                );
            };

            match registry.upsert(area) {
                Ok(area) => RuntimeCommandResult::success(json!({ "area": area })),
                Err(message) => RuntimeCommandResult::validation(
                    "Runtime command validation failed.",
                    vec![message],
                ),
            }
        }
        RuntimeWriteCommand::UpdateProtectedArea { area_id, patch } => {
            let Some(mut registry) = world.get_resource_mut::<ProtectedAreaRegistry>() else {
                return RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    "ProtectedAreaRegistry resource is not available.",
                );
            };

            match registry.update(&area_id, patch, false) {
                Ok(area) => RuntimeCommandResult::success(json!({ "area": area })),
                Err(message) if message.contains("locked") => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
                Err(message) => RuntimeCommandResult::validation(
                    "Runtime command validation failed.",
                    vec![message],
                ),
            }
        }
        RuntimeWriteCommand::DeleteProtectedArea { area_id } => {
            let Some(mut registry) = world.get_resource_mut::<ProtectedAreaRegistry>() else {
                return RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    "ProtectedAreaRegistry resource is not available.",
                );
            };

            match registry.delete(&area_id, false) {
                Ok(deleted) => {
                    RuntimeCommandResult::success(json!({ "areaId": area_id, "deleted": deleted }))
                }
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::QueryProtectedRulesAtVoxel { voxel } => {
            let Some(registry) = world.get_resource::<ProtectedAreaRegistry>() else {
                return RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    "ProtectedAreaRegistry resource is not available.",
                );
            };
            RuntimeCommandResult::success(json!(
                registry.query_rules_at_voxel(IVec3::new(voxel[0], voxel[1], voxel[2],))
            ))
        }
        RuntimeWriteCommand::ValidateProtectedAreaConflicts { area } => {
            let Some(registry) = world.get_resource::<ProtectedAreaRegistry>() else {
                return RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    "ProtectedAreaRegistry resource is not available.",
                );
            };
            let conflicts = match area {
                Some(candidate) => registry.conflicts_for_candidate(&candidate),
                None => registry.conflict_detection(),
            };
            RuntimeCommandResult::success(json!({
                "conflicts": conflicts,
                "clear": conflicts.is_empty(),
            }))
        }
        RuntimeWriteCommand::SaveProtectedAreas {} => {
            let Some(registry) = world.get_resource::<ProtectedAreaRegistry>() else {
                return RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    "ProtectedAreaRegistry resource is not available.",
                );
            };
            match registry.save_to_path(WORLD_RULES_PATH) {
                Ok(()) => RuntimeCommandResult::success(json!({
                    "worldId": "bevy-runtime",
                    "savedAt": timestamp_string(),
                    "snapshotId": "world-rules",
                    "areaCount": registry.area_count(),
                })),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::LoadProtectedAreas {} => {
            let Some(mut registry) = world.get_resource_mut::<ProtectedAreaRegistry>() else {
                return RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    "ProtectedAreaRegistry resource is not available.",
                );
            };
            match registry.load_from_path(WORLD_RULES_PATH) {
                Ok(()) => RuntimeCommandResult::success(json!({
                    "areas": registry.areas().collect::<Vec<_>>(),
                    "areaCount": registry.area_count(),
                })),
                Err(message) => {
                    RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message)
                }
            }
        }
        RuntimeWriteCommand::SaveWorldSnapshot { reason } => {
            let Some(voxel_world) = world.get_resource::<VoxelWorld>() else {
                return RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    "VoxelWorld resource is not available.",
                );
            };

            let result = persistence::editor_save_default_world(voxel_world);
            if result.saved {
                world.insert_resource(EditorWorldSavePath(result.save_path.clone()));
                let (editor_prop_count, editor_prop_save_path) =
                    match save_editor_placed_props(world) {
                        Ok(summary) => summary,
                        Err(message) => {
                            return RuntimeCommandResult::failure(
                                RuntimeCommandStatus::Failure,
                                message,
                            );
                        }
                    };
                let (editor_light_count, editor_light_save_path) = match save_editor_lights(world) {
                    Ok(summary) => summary,
                    Err(message) => {
                        return RuntimeCommandResult::failure(
                            RuntimeCommandStatus::Failure,
                            message,
                        );
                    }
                };
                RuntimeCommandResult::success(json!({
                    "worldId": "bevy-runtime",
                    "savedAt": timestamp_string(),
                    "snapshotId": "world_data.bin",
                    "savePath": result.save_path,
                    "editorPropCount": editor_prop_count,
                    "editorPropSavePath": editor_prop_save_path,
                    "editorLightCount": editor_light_count,
                    "editorLightSavePath": editor_light_save_path,
                    "reason": reason,
                    "metadata": result.metadata,
                }))
            } else {
                RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    result
                        .error_message
                        .unwrap_or_else(|| "Runtime world snapshot save failed.".to_string()),
                )
            }
        }
    }
}

fn mark_chunk_dirty(world: &mut World, chunk_pos: IVec3) -> Result<(), String> {
    let Some(mut voxel_world) = world.get_resource_mut::<VoxelWorld>() else {
        return Err("VoxelWorld resource is not available.".to_string());
    };
    if !voxel_world.mark_chunk_dirty_with_reason(chunk_pos, MeshDirtyReason::Generation) {
        return Err(format!("Chunk {chunk_pos:?} does not exist."));
    }
    Ok(())
}

#[cfg(feature = "naadf")]
fn compare_naadf_chunk_occupancy(
    world: &World,
    chunk_id: &str,
    max_mismatches: usize,
) -> RuntimeCommandResult<Value> {
    let Some(chunk_pos) = parse_chunk_id(chunk_id) else {
        return RuntimeCommandResult::validation(
            "Runtime command validation failed.",
            vec![format!(
                "chunkId '{chunk_id}' must look like chunk-x-z or chunk-x-y-z."
            )],
        );
    };

    let Some(voxel_world) = world.get_resource::<VoxelWorld>() else {
        return RuntimeCommandResult::failure(
            RuntimeCommandStatus::Failure,
            "VoxelWorld resource is not available.".to_string(),
        );
    };
    let Some(cache) = world.get_resource::<crate::rendering::naadf::NaadfCache>() else {
        return RuntimeCommandResult::failure(
            RuntimeCommandStatus::Failure,
            "NaadfCache resource is not available.".to_string(),
        );
    };

    let world_chunk_present = voxel_world.get_chunk(chunk_pos).is_some();
    let Some(naadf_chunk) = cache.get(chunk_pos) else {
        return RuntimeCommandResult::success(json!({
            "chunkId": chunk_id,
            "chunk": [chunk_pos.x, chunk_pos.y, chunk_pos.z],
            "worldChunkPresent": world_chunk_present,
            "naadfChunkPresent": false,
            "mismatchCount": null,
            "mismatches": [],
        }));
    };

    let mismatches = crate::rendering::naadf::debug::compare_chunk_occupancy(
        voxel_world,
        naadf_chunk,
        max_mismatches,
    );

    RuntimeCommandResult::success(json!({
        "chunkId": chunk_id,
        "chunk": [chunk_pos.x, chunk_pos.y, chunk_pos.z],
        "worldChunkPresent": world_chunk_present,
        "naadfChunkPresent": true,
        "mismatchCount": mismatches.len(),
        "truncatedAt": max_mismatches,
        "mismatches": mismatches
            .iter()
            .map(|mismatch| json!({
                "local": [mismatch.local.x, mismatch.local.y, mismatch.local.z],
                "worldOccupied": mismatch.world_occupied,
                "naadfOccupied": mismatch.naadf_occupied,
            }))
            .collect::<Vec<_>>(),
    }))
}

#[cfg(not(feature = "naadf"))]
fn compare_naadf_chunk_occupancy(
    _world: &World,
    _chunk_id: &str,
    _max_mismatches: usize,
) -> RuntimeCommandResult<Value> {
    RuntimeCommandResult::failure(
        RuntimeCommandStatus::Unsupported,
        "NAADF diagnostics require the naadf feature.".to_string(),
    )
}

#[cfg(feature = "naadf")]
fn compare_naadf_ray(
    world: &World,
    origin: [f32; 3],
    direction: [f32; 3],
    max_distance: f32,
    purpose: &str,
) -> RuntimeCommandResult<Value> {
    let Some(voxel_world) = world.get_resource::<VoxelWorld>() else {
        return RuntimeCommandResult::failure(
            RuntimeCommandStatus::Failure,
            "VoxelWorld resource is not available.".to_string(),
        );
    };
    let Some(cache) = world.get_resource::<crate::rendering::naadf::NaadfCache>() else {
        return RuntimeCommandResult::failure(
            RuntimeCommandStatus::Failure,
            "NaadfCache resource is not available.".to_string(),
        );
    };
    let Some(purpose) = crate::rendering::voxel_ray_backend::VoxelRayPurpose::parse(purpose) else {
        return RuntimeCommandResult::validation(
            "Runtime command validation failed.",
            vec!["purpose is not a known voxel ray purpose.".to_string()],
        );
    };

    let comparison = crate::rendering::naadf::debug::compare_backend_ray(
        voxel_world,
        cache,
        Vec3::from_array(origin),
        Vec3::from_array(direction),
        max_distance,
        purpose,
    );

    RuntimeCommandResult::success(json!({
        "origin": origin,
        "direction": direction,
        "maxDistance": max_distance,
        "purpose": purpose.as_str(),
        "matches": comparison.matches,
        "current": {
            "steps": comparison.current_steps,
            "hit": comparison.current_hit.as_ref().map(voxel_ray_hit_payload),
        },
        "naadf": {
            "steps": comparison.naadf_steps,
            "hit": comparison.naadf_hit.as_ref().map(voxel_ray_hit_payload),
        },
    }))
}

#[cfg(not(feature = "naadf"))]
fn compare_naadf_ray(
    _world: &World,
    _origin: [f32; 3],
    _direction: [f32; 3],
    _max_distance: f32,
    _purpose: &str,
) -> RuntimeCommandResult<Value> {
    RuntimeCommandResult::failure(
        RuntimeCommandStatus::Unsupported,
        "NAADF diagnostics require the naadf feature.".to_string(),
    )
}

#[cfg(feature = "naadf")]
fn voxel_ray_hit_payload(hit: &crate::rendering::voxel_ray_backend::VoxelRayHit) -> Value {
    json!({
        "chunk": [hit.chunk.x, hit.chunk.y, hit.chunk.z],
        "local": [hit.local.x, hit.local.y, hit.local.z],
        "worldVoxel": [hit.world_voxel.x, hit.world_voxel.y, hit.world_voxel.z],
        "position": [hit.position.x, hit.position.y, hit.position.z],
        "normal": [hit.normal.x, hit.normal.y, hit.normal.z],
        "distance": hit.distance,
        "materialId": hit.material_id,
        "steps": hit.steps,
    })
}

fn validate_voxel_brush(brush: &FrontendVoxelBrush, errors: &mut Vec<String>) {
    if brush.radius == 0 || brush.radius > 32 {
        errors.push("brush.radius must be between 1 and 32.".to_string());
    }
    if brush
        .size
        .iter()
        .any(|component| *component == 0 || *component > 64)
    {
        errors.push("brush.size dimensions must be between 1 and 64.".to_string());
    }
    if brush.mask == FrontendVoxelBrushMask::Material && brush.mask_block.is_none() {
        errors.push("brush.maskBlock is required when mask is material.".to_string());
    }
}

fn apply_runtime_voxel_brush(
    world: &mut World,
    brush: &FrontendVoxelBrush,
) -> Result<Value, String> {
    let registry = world.get_resource::<ProtectedAreaRegistry>().cloned();
    let Some(mut voxel_world) = world.get_resource_mut::<VoxelWorld>() else {
        return Err("VoxelWorld resource is not available.".to_string());
    };

    let target_voxel = match brush.action {
        FrontendVoxelBrushAction::Delete => VoxelType::Air,
        FrontendVoxelBrushAction::Set | FrontendVoxelBrushAction::Paint => brush.block.as_runtime(),
    };
    let intent = match brush.action {
        FrontendVoxelBrushAction::Set => ProtectedEditIntent::Place,
        FrontendVoxelBrushAction::Paint => ProtectedEditIntent::Paint,
        FrontendVoxelBrushAction::Delete => ProtectedEditIntent::Mine,
    };

    let positions = expand_voxel_brush_positions(brush);
    let mut applied = 0u32;
    let mut no_change = 0u32;
    let mut rejected = 0u32;
    let mut skipped = 0u32;
    let mut dirty_chunk_ids = BTreeSet::new();
    let affected_count = positions.len();
    let mut results = if brush.include_results {
        Vec::with_capacity(positions.len())
    } else {
        Vec::new()
    };
    let mut sampled_result: Option<Value> = None;

    for position in positions {
        let previous = voxel_world.get_voxel(position);
        if !voxel_brush_mask_allows(previous, brush)
            || !voxel_brush_action_allows(previous, brush.action)
        {
            skipped += 1;
            let payload = voxel_brush_result_payload(
                position,
                brush.block,
                previous,
                previous,
                "skippedMask",
            );
            if sampled_result.is_none() {
                sampled_result = Some(payload.clone());
            }
            if brush.include_results {
                results.push(payload);
            }
            continue;
        }

        let result =
            voxel_world.set_voxel_with_rules(position, target_voxel, intent, registry.as_ref());
        let current = voxel_world.get_voxel(position);
        match result {
            VoxelEditResult::Applied => {
                applied += 1;
                let chunk = VoxelWorld::world_to_chunk(position);
                dirty_chunk_ids.insert(chunk_id_string(chunk));
            }
            VoxelEditResult::NoChange => no_change += 1,
            _ => rejected += 1,
        }
        let payload = voxel_brush_result_payload(
            position,
            brush.block,
            previous,
            current,
            voxel_edit_result_to_frontend(result),
        );
        if sampled_result.is_none()
            || matches!(result, VoxelEditResult::Applied | VoxelEditResult::NoChange)
        {
            sampled_result = Some(payload.clone());
        }
        if brush.include_results {
            results.push(payload);
        }
    }

    dirty_chunk_ids.extend(voxel_world.derived_dirty_chunks().map(chunk_id_string));

    Ok(json!({
        "origin": brush.position,
        "action": voxel_brush_action_to_frontend(brush.action),
        "shape": voxel_brush_shape_to_frontend(brush.shape),
        "block": brush.block.as_frontend_str(),
        "changedCount": applied,
        "noChangeCount": no_change,
        "rejectedCount": rejected,
        "skippedCount": skipped,
        "affectedCount": affected_count,
        "dirtyChunkIds": dirty_chunk_ids.into_iter().collect::<Vec<_>>(),
        "sampledResult": sampled_result,
        "results": results,
    }))
}

fn set_runtime_voxel(
    world: &mut World,
    position: IVec3,
    block: FrontendVoxelBlock,
) -> Result<Value, String> {
    let brush = FrontendVoxelBrush {
        position: [position.x, position.y, position.z],
        action: FrontendVoxelBrushAction::Set,
        shape: FrontendVoxelBrushShape::Single,
        block,
        radius: 1,
        size: [1, 1, 1],
        mask: FrontendVoxelBrushMask::Any,
        mask_block: None,
        include_results: false,
    };
    let data = apply_runtime_voxel_brush(world, &brush)?;
    let first = data
        .get("sampledResult")
        .ok_or_else(|| "Voxel edit did not return a result.".to_string())?;
    if first
        .get("editResult")
        .and_then(Value::as_str)
        .is_some_and(|result| result.starts_with("rejected"))
    {
        return Err(format!(
            "Voxel edit at ({}, {}, {}) was rejected: {}.",
            position.x,
            position.y,
            position.z,
            first
                .get("editResult")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
        ));
    }

    Ok(json!({
        "position": first["position"].clone(),
        "chunkId": first["chunkId"].clone(),
        "block": block.as_frontend_str(),
        "voxel": first["voxel"].clone(),
        "previousVoxel": first["previousVoxel"].clone(),
        "currentVoxel": first["currentVoxel"].clone(),
        "editResult": first["editResult"].clone(),
    }))
}

fn paint_runtime_voxel_material(
    world: &mut World,
    position: IVec3,
    material_id: &str,
) -> Result<Value, String> {
    let material_id = parse_material_id(material_id)
        .ok_or_else(|| format!("Unknown material id '{material_id}'."))?;
    let material = material_from_world(world, material_id)?;
    let registry = world.get_resource::<ProtectedAreaRegistry>().cloned();
    let Some(mut voxel_world) = world.get_resource_mut::<VoxelWorld>() else {
        return Err("VoxelWorld resource is not available.".to_string());
    };

    let previous_material = voxel_world.get_material_id(position);
    let previous_voxel = voxel_world.get_voxel(position);
    let result = voxel_world.set_material_id_with_rules(position, material_id, registry.as_ref());
    let current_material = voxel_world.get_material_id(position);
    let chunk = VoxelWorld::world_to_chunk(position);

    Ok(json!({
        "position": [position.x, position.y, position.z],
        "chunkId": chunk_id_string(chunk),
        "material": material_payload(&material),
        "previousMaterialId": previous_material.map(material_id_string),
        "currentMaterialId": current_material.map(material_id_string),
        "previousVoxel": previous_voxel.map(voxel_material_name),
        "editResult": voxel_edit_result_to_frontend(result),
        "dirtyChunkIds": voxel_world.derived_dirty_chunks().map(chunk_id_string).collect::<Vec<_>>(),
    }))
}

fn pick_runtime_voxel_material(world: &World, position: IVec3) -> Result<Value, String> {
    let Some(voxel_world) = world.get_resource::<VoxelWorld>() else {
        return Err("VoxelWorld resource is not available.".to_string());
    };
    let voxel = voxel_world.get_voxel(position).ok_or_else(|| {
        format!(
            "No voxel exists at ({}, {}, {}).",
            position.x, position.y, position.z
        )
    })?;
    let material_id = voxel_world
        .get_material_id(position)
        .unwrap_or_else(|| MaterialId::from_voxel(voxel));
    let material = material_from_world(world, material_id)?;

    Ok(json!({
        "position": [position.x, position.y, position.z],
        "voxel": voxel_material_name(voxel),
        "material": material_payload(&material),
    }))
}

fn replace_runtime_material(
    world: &mut World,
    from_material_id: &str,
    to_material_id: &str,
) -> Result<Value, String> {
    let from = parse_material_id(from_material_id)
        .ok_or_else(|| format!("Unknown material id '{from_material_id}'."))?;
    let to = parse_material_id(to_material_id)
        .ok_or_else(|| format!("Unknown material id '{to_material_id}'."))?;
    ensure_material_exists(world, from)?;
    let to_material = material_from_world(world, to)?;
    let to_material_payload = material_payload(&to_material);
    let registry = world.get_resource::<ProtectedAreaRegistry>().cloned();
    let Some(mut voxel_world) = world.get_resource_mut::<VoxelWorld>() else {
        return Err("VoxelWorld resource is not available.".to_string());
    };
    let chunk_positions = voxel_world.chunk_positions().collect::<Vec<_>>();
    if chunk_positions.len() > MATERIAL_REPLACE_SYNC_CHUNK_LIMIT {
        drop(voxel_world);
        if !world.contains_resource::<RuntimeMaterialReplaceJobs>() {
            world.insert_resource(RuntimeMaterialReplaceJobs::default());
        }
        let snapshot = world.resource_mut::<RuntimeMaterialReplaceJobs>().push(
            from,
            to,
            to_material_payload,
            chunk_positions,
        );
        return Ok(material_replace_job_payload(&snapshot, "queued"));
    }

    let summary = voxel_world.replace_material_id(from, to, registry.as_ref());
    let snapshot = RuntimeMaterialReplaceJobSnapshot {
        job_id: String::new(),
        from,
        to,
        to_material: to_material_payload,
        changed: summary.changed,
        no_change: summary.no_change,
        skipped: summary.skipped,
        processed_chunks: chunk_positions.len(),
        total_chunks: chunk_positions.len(),
        completed: true,
        dirty_chunks: summary.dirty_chunks,
    };

    Ok(material_replace_job_payload(&snapshot, "completed"))
}

fn poll_runtime_material_replace_job(world: &mut World, job_id: &str) -> Result<Value, String> {
    if !world.contains_resource::<RuntimeMaterialReplaceJobs>() {
        return Err(format!("Material replace job '{job_id}' was not found."));
    }
    let snapshot = world
        .resource_mut::<RuntimeMaterialReplaceJobs>()
        .snapshot_for(job_id)
        .ok_or_else(|| format!("Material replace job '{job_id}' was not found."))?;
    let mode = if snapshot.completed {
        "completed"
    } else {
        "running"
    };
    Ok(material_replace_job_payload(&snapshot, mode))
}

fn material_replace_job_payload(snapshot: &RuntimeMaterialReplaceJobSnapshot, mode: &str) -> Value {
    let mut payload = json!({
        "fromMaterialId": material_id_string(snapshot.from),
        "toMaterialId": material_id_string(snapshot.to),
        "toMaterial": snapshot.to_material.clone(),
        "changedCount": snapshot.changed,
        "noChangeCount": snapshot.no_change,
        "skippedCount": snapshot.skipped,
        "dirtyChunkIds": snapshot.dirty_chunks.iter().copied().map(chunk_id_string).collect::<Vec<_>>(),
        "mode": mode,
        "completed": snapshot.completed,
        "processedChunks": snapshot.processed_chunks,
        "totalChunks": snapshot.total_chunks,
    });
    if !snapshot.job_id.is_empty() {
        payload["jobId"] = json!(snapshot.job_id);
    }
    payload
}

fn update_runtime_material(
    world: &mut World,
    material_id: &str,
    patch: FrontendMaterialPatch,
) -> Result<Value, String> {
    let material_id = parse_material_id(material_id)
        .ok_or_else(|| format!("Unknown material id '{material_id}'."))?;
    let material = {
        let mut catalog = world
            .get_resource_mut::<MaterialCatalog>()
            .ok_or_else(|| "MaterialCatalog resource is not available.".to_string())?;
        let Some(material) = catalog.material_mut(material_id) else {
            return Err(format!(
                "Material '{}' does not exist.",
                material_id_string(material_id)
            ));
        };
        apply_material_patch(material, patch)?;
        material.clone()
    };

    let dirty_chunk_ids = if let Some(mut voxel_world) = world.get_resource_mut::<VoxelWorld>() {
        voxel_world
            .mark_chunks_containing_material_dirty_with_reason(
                material_id,
                MeshDirtyReason::TerrainMutation,
            )
            .into_iter()
            .map(chunk_id_string)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    Ok(json!({
        "material": material_payload(&material),
        "catalog": material_catalog_payload(world),
        "dirtyChunkIds": dirty_chunk_ids,
    }))
}

fn set_active_runtime_material(world: &mut World, material_id: &str) -> Result<Value, String> {
    let material_id = parse_material_id(material_id)
        .ok_or_else(|| format!("Unknown material id '{material_id}'."))?;
    let mut catalog = world
        .get_resource_mut::<MaterialCatalog>()
        .ok_or_else(|| "MaterialCatalog resource is not available.".to_string())?;
    if !catalog.set_active_material(material_id) {
        return Err(format!(
            "Material '{}' does not exist.",
            material_id_string(material_id)
        ));
    }
    let material = catalog
        .material(material_id)
        .cloned()
        .expect("active material was just validated");
    drop(catalog);

    Ok(json!({
        "activeMaterialId": material_id_string(material_id),
        "material": material_payload(&material),
        "catalog": material_catalog_payload(world),
    }))
}

fn ensure_material_exists(world: &World, id: MaterialId) -> Result<(), String> {
    let catalog = world
        .get_resource::<MaterialCatalog>()
        .cloned()
        .unwrap_or_default();
    if catalog.contains_material(id) {
        Ok(())
    } else {
        Err(format!(
            "Material '{}' does not exist.",
            material_id_string(id)
        ))
    }
}

fn material_from_world(world: &World, id: MaterialId) -> Result<VoxelMaterialDefinition, String> {
    let catalog = world
        .get_resource::<MaterialCatalog>()
        .cloned()
        .unwrap_or_default();
    catalog
        .material(id)
        .cloned()
        .ok_or_else(|| format!("Material '{}' does not exist.", material_id_string(id)))
}

fn apply_material_patch(
    material: &mut VoxelMaterialDefinition,
    patch: FrontendMaterialPatch,
) -> Result<(), String> {
    if let Some(name) = patch.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Material name cannot be empty.".to_string());
        }
        material.name = trimmed.to_string();
    }
    if let Some(color_rgb) = patch.color_rgb {
        material.color_rgb = color_rgb;
    }
    if let Some(value) = patch.metallic {
        material.metallic = value.clamp(0.0, 1.0);
    }
    if let Some(value) = patch.smooth {
        material.smooth = value.clamp(0.0, 1.0);
    }
    if let Some(value) = patch.emissive {
        material.emissive = value.max(0.0);
    }
    if let Some(value) = patch.surface_transmission {
        material.surface_transmission = value.clamp(0.0, 1.0);
    }
    if let Some(value) = patch.absorption_length {
        material.absorption_length = value.max(0.0);
    }
    if let Some(value) = patch.scatter_length {
        material.scatter_length = value.max(0.0);
    }
    if let Some(value) = patch.index_of_refraction {
        material.index_of_refraction = value.clamp(1.0, 3.0);
    }
    if let Some(value) = patch.phase {
        material.phase = value.clamp(-1.0, 1.0);
    }
    Ok(())
}

fn expand_voxel_brush_positions(brush: &FrontendVoxelBrush) -> Vec<IVec3> {
    let origin = IVec3::new(brush.position[0], brush.position[1], brush.position[2]);
    match brush.shape {
        FrontendVoxelBrushShape::Single => vec![origin],
        FrontendVoxelBrushShape::Box => {
            let half = IVec3::new(
                (brush.size[0].saturating_sub(1) / 2) as i32,
                (brush.size[1].saturating_sub(1) / 2) as i32,
                (brush.size[2].saturating_sub(1) / 2) as i32,
            );
            let max = IVec3::new(
                (brush.size[0] / 2) as i32,
                (brush.size[1] / 2) as i32,
                (brush.size[2] / 2) as i32,
            );
            let mut positions = Vec::new();
            for y in -half.y..=max.y {
                for z in -half.z..=max.z {
                    for x in -half.x..=max.x {
                        positions.push(origin + IVec3::new(x, y, z));
                    }
                }
            }
            positions
        }
        FrontendVoxelBrushShape::Sphere => {
            let radius = brush.radius.max(1) as i32;
            let radius_sq = radius * radius;
            let mut positions = Vec::new();
            for y in -radius..=radius {
                for z in -radius..=radius {
                    for x in -radius..=radius {
                        if x * x + y * y + z * z <= radius_sq {
                            positions.push(origin + IVec3::new(x, y, z));
                        }
                    }
                }
            }
            positions
        }
        FrontendVoxelBrushShape::Cylinder => {
            let radius = brush.radius.max(1) as i32;
            let height = brush.size[1].max(1) as i32;
            let y_min = -((height - 1) / 2);
            let y_max = height / 2;
            let radius_sq = radius * radius;
            let mut positions = Vec::new();
            for y in y_min..=y_max {
                for z in -radius..=radius {
                    for x in -radius..=radius {
                        if x * x + z * z <= radius_sq {
                            positions.push(origin + IVec3::new(x, y, z));
                        }
                    }
                }
            }
            positions
        }
    }
}

fn voxel_brush_mask_allows(previous: Option<VoxelType>, brush: &FrontendVoxelBrush) -> bool {
    match brush.mask {
        FrontendVoxelBrushMask::Any => true,
        FrontendVoxelBrushMask::Empty => previous.is_none_or(|voxel| voxel == VoxelType::Air),
        FrontendVoxelBrushMask::Occupied => previous.is_some_and(|voxel| voxel != VoxelType::Air),
        FrontendVoxelBrushMask::Material => {
            let Some(mask_block) = brush.mask_block else {
                return false;
            };
            previous.is_some_and(|voxel| voxel == mask_block.as_runtime())
        }
    }
}

fn voxel_brush_action_allows(
    previous: Option<VoxelType>,
    action: FrontendVoxelBrushAction,
) -> bool {
    match action {
        FrontendVoxelBrushAction::Paint => previous.is_some_and(|voxel| voxel != VoxelType::Air),
        FrontendVoxelBrushAction::Set | FrontendVoxelBrushAction::Delete => true,
    }
}

fn voxel_brush_result_payload(
    position: IVec3,
    block: FrontendVoxelBlock,
    previous: Option<VoxelType>,
    current: Option<VoxelType>,
    edit_result: &'static str,
) -> Value {
    let chunk = VoxelWorld::world_to_chunk(position);
    let voxel = block.as_runtime();
    json!({
        "position": [position.x, position.y, position.z],
        "chunkId": chunk_id_string(chunk),
        "block": block.as_frontend_str(),
        "voxel": voxel_material_name(voxel),
        "previousVoxel": previous.map(voxel_material_name),
        "currentVoxel": current.map(voxel_material_name),
        "editResult": edit_result,
    })
}

fn chunk_id_string(chunk: IVec3) -> String {
    format!("chunk-{}-{}-{}", chunk.x, chunk.y, chunk.z)
}

fn voxel_brush_action_to_frontend(action: FrontendVoxelBrushAction) -> &'static str {
    match action {
        FrontendVoxelBrushAction::Set => "set",
        FrontendVoxelBrushAction::Delete => "delete",
        FrontendVoxelBrushAction::Paint => "paint",
    }
}

fn voxel_brush_shape_to_frontend(shape: FrontendVoxelBrushShape) -> &'static str {
    match shape {
        FrontendVoxelBrushShape::Single => "single",
        FrontendVoxelBrushShape::Box => "box",
        FrontendVoxelBrushShape::Sphere => "sphere",
        FrontendVoxelBrushShape::Cylinder => "cylinder",
    }
}

fn scatter_runtime_props(world: &mut World, props: Vec<Value>) -> Result<Value, String> {
    let prop_assets = world
        .get_resource::<PropAssets>()
        .ok_or_else(|| "PropAssets resource is not available.".to_string())?;

    let spawn_specs = props
        .iter()
        .map(|prop| {
            let instance_id = prop
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "prop.id is required.".to_string())?;
            let asset_id = prop_asset_id(prop)
                .ok_or_else(|| format!("prop '{instance_id}' is missing assetId."))?;
            let handle =
                prop_assets.scenes.get(asset_id).cloned().ok_or_else(|| {
                    format!("Prop asset '{asset_id}' is not loaded in the runtime.")
                })?;
            let position = prop_position(prop)
                .ok_or_else(|| format!("prop '{instance_id}' is missing a valid position."))?;
            let rotation = prop_rotation(prop).unwrap_or(Vec3::ZERO);
            let scale = prop_scale(prop).unwrap_or(Vec3::ONE);
            let prop_type = prop_type_from_value(prop);
            let transform = Transform::from_translation(position)
                .with_rotation(Quat::from_euler(
                    EulerRot::XYZ,
                    rotation.x.to_radians(),
                    rotation.y.to_radians(),
                    rotation.z.to_radians(),
                ))
                .with_scale(scale);

            Ok((
                prop.clone(),
                handle,
                transform,
                Prop {
                    id: asset_id.to_string(),
                    prop_type,
                },
                EditorPropInstanceId(instance_id.to_string()),
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let replacement_ids = spawn_specs
        .iter()
        .map(|(_, _, _, _, instance_id)| instance_id.0.clone())
        .collect::<HashSet<_>>();
    if !replacement_ids.is_empty() {
        let mut query = world.query::<(Entity, &EditorPropInstanceId)>();
        let existing = query
            .iter(world)
            .filter_map(|(entity, instance_id)| {
                replacement_ids.contains(&instance_id.0).then_some(entity)
            })
            .collect::<Vec<_>>();
        for entity in existing {
            let _ = world.despawn(entity);
        }
    }

    let mut accepted = Vec::with_capacity(spawn_specs.len());
    for (prop, handle, transform, marker, instance_id) in spawn_specs {
        let owner = PropChunkOwner(VoxelWorld::world_to_chunk(
            transform.translation.floor().as_ivec3(),
        ));
        world.spawn((SceneRoot(handle), transform, marker, owner, instance_id));
        accepted.push(prop);
    }

    if !world.contains_resource::<EditorPlacedProps>() {
        world.insert_resource(EditorPlacedProps::default());
    }
    let mut placed_props = world.resource_mut::<EditorPlacedProps>();
    for prop in &accepted {
        if let Some(id) = prop.get("id").and_then(Value::as_str) {
            placed_props
                .props
                .retain(|existing| existing.get("id").and_then(Value::as_str) != Some(id));
        }
        placed_props.props.push(prop.clone());
    }

    Ok(json!({
        "props": accepted,
        "propStats": runtime_prop_stats_payload(world),
    }))
}

fn remove_runtime_props(
    world: &mut World,
    prop_ids: Vec<String>,
    chunk_id: Option<String>,
) -> Result<Value, String> {
    let prop_ids = prop_ids.into_iter().collect::<HashSet<_>>();
    let chunk = chunk_id
        .as_deref()
        .map(|chunk_id| {
            parse_chunk_id(chunk_id).ok_or_else(|| {
                format!("Chunk id '{chunk_id}' must look like chunk-x-z or chunk-x-y-z.")
            })
        })
        .transpose()?;

    let mut query = world.query::<(
        Entity,
        Option<&EditorPropInstanceId>,
        Option<&PropChunkOwner>,
    )>();
    let targets = query
        .iter(world)
        .filter_map(|(entity, instance_id, owner)| {
            let runtime_entity_id = format!("runtime-prop-{}", entity.index());
            let id_match = instance_id.is_some_and(|id| prop_ids.contains(&id.0))
                || prop_ids.contains(&runtime_entity_id);
            let chunk_match =
                chunk.is_some_and(|chunk| owner.is_some_and(|owner| owner.0 == chunk));
            (id_match || chunk_match).then(|| {
                (
                    entity,
                    instance_id
                        .map(|id| id.0.clone())
                        .unwrap_or(runtime_entity_id),
                )
            })
        })
        .collect::<Vec<_>>();

    for (entity, _) in &targets {
        let _ = world.despawn(*entity);
    }

    let removed_id_list = targets.iter().map(|(_, id)| id.clone()).collect::<Vec<_>>();
    let removed_ids = removed_id_list.iter().cloned().collect::<HashSet<_>>();
    if !removed_ids.is_empty() || chunk.is_some() {
        if let Some(mut selected_prop) = world.get_resource_mut::<SelectedProp>() {
            if selected_prop
                .id
                .as_ref()
                .is_some_and(|id| removed_ids.contains(id))
            {
                selected_prop.entity = None;
                selected_prop.id = None;
                selected_prop.label = None;
                selected_prop.position = None;
            }
        }

        if !world.contains_resource::<EditorPlacedProps>() {
            world.insert_resource(EditorPlacedProps::default());
        }
        let mut placed_props = world.resource_mut::<EditorPlacedProps>();
        placed_props.props.retain(|prop| {
            let id_removed = prop
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| removed_ids.contains(id));
            let chunk_removed = chunk.is_some_and(|chunk| {
                prop.get("chunkId")
                    .and_then(Value::as_str)
                    .and_then(parse_chunk_id)
                    .is_some_and(|prop_chunk| prop_chunk == chunk)
            });
            !(id_removed || chunk_removed)
        });
    }

    Ok(json!({
        "removedPropIds": removed_id_list,
        "propStats": runtime_prop_stats_payload(world),
    }))
}

pub fn save_editor_placed_props(world: &World) -> Result<(usize, &'static str), String> {
    let props = world
        .get_resource::<EditorPlacedProps>()
        .map(|placed| placed.props.as_slice())
        .unwrap_or(&[]);

    let path = Path::new(EDITOR_PLACED_PROPS_SAVE_PATH);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create editor prop save directory '{}': {error}",
                parent.display()
            )
        })?;
    }

    let file = File::create(path).map_err(|error| {
        format!(
            "Failed to create editor prop save file '{}': {error}",
            path.display()
        )
    })?;
    serde_json::to_writer_pretty(file, props).map_err(|error| {
        format!(
            "Failed to serialize editor prop save file '{}': {error}",
            path.display()
        )
    })?;

    Ok((props.len(), EDITOR_PLACED_PROPS_SAVE_PATH))
}

pub fn editor_placed_props_payload(world: &World) -> Vec<Value> {
    world
        .get_resource::<EditorPlacedProps>()
        .map(|placed| placed.props.clone())
        .unwrap_or_default()
}

fn load_saved_editor_lights(world: &mut World) {
    let already_loaded = world
        .get_resource::<EditorPlacedLights>()
        .is_some_and(|placed| placed.loaded_from_disk);
    if already_loaded {
        return;
    }

    if !world.contains_resource::<EditorPlacedLights>() {
        world.insert_resource(EditorPlacedLights::default());
    }
    world.resource_mut::<EditorPlacedLights>().loaded_from_disk = true;
    load_editor_lights_from_disk(world);
}

fn load_editor_lights_from_disk(world: &mut World) {
    let path = Path::new(EDITOR_LIGHTS_SAVE_PATH);
    if !path.exists() {
        return;
    }

    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) => {
            warn!(
                "Failed to open editor light save '{}': {}",
                path.display(),
                error
            );
            return;
        }
    };
    let lights = match serde_json::from_reader::<_, Vec<EditorLightInstance>>(file) {
        Ok(lights) => lights,
        Err(error) => {
            warn!(
                "Failed to read editor light save '{}': {}",
                path.display(),
                error
            );
            return;
        }
    };

    for light in lights {
        if let Err(message) = upsert_runtime_light(world, light) {
            warn!("Failed to load editor light: {}", message);
        }
    }
}

fn upsert_runtime_light(
    world: &mut World,
    mut light: EditorLightInstance,
) -> Result<EditorLightInstance, String> {
    if light.source == EditorLightSource::Sun {
        return update_sun_light(world, light);
    }

    light.source = EditorLightSource::Editor;
    despawn_editor_light_entity(world, &light.id);

    let color =
        parse_hex_color(&light.color).ok_or_else(|| "Light color must be #RRGGBB.".to_string())?;
    let transform = light_transform(&light);
    let marker = EditorLightInstanceId(light.id.clone());
    let visibility = if light.enabled && light.visible {
        Visibility::Inherited
    } else {
        Visibility::Hidden
    };
    let name = Name::new(light.name.clone());

    match light.kind {
        EditorLightKind::Directional => {
            let mut entity = world.spawn((
                DirectionalLight {
                    color,
                    illuminance: light.intensity,
                    shadows_enabled: light.shadows_enabled,
                    ..default()
                },
                transform,
                visibility,
                marker,
                name,
            ));
            if light.volumetric {
                entity.insert(VolumetricLight);
            }
        }
        EditorLightKind::Point => {
            world.spawn((
                PointLight {
                    color,
                    intensity: light.intensity,
                    range: light.range.max(0.0),
                    radius: light.radius.max(0.0),
                    shadows_enabled: light.shadows_enabled,
                    ..default()
                },
                transform,
                visibility,
                marker,
                name,
            ));
        }
        EditorLightKind::Spot => {
            world.spawn((
                SpotLight {
                    color,
                    intensity: light.intensity,
                    range: light.range.max(0.0),
                    radius: light.radius.max(0.0),
                    inner_angle: light.inner_cone_angle.to_radians(),
                    outer_angle: light
                        .outer_cone_angle
                        .max(light.inner_cone_angle + 1.0)
                        .to_radians(),
                    shadows_enabled: light.shadows_enabled,
                    ..default()
                },
                transform,
                visibility,
                marker,
                name,
            ));
        }
    }

    if !world.contains_resource::<EditorPlacedLights>() {
        world.insert_resource(EditorPlacedLights::default());
    }
    let mut placed = world.resource_mut::<EditorPlacedLights>();
    placed.lights.retain(|candidate| candidate.id != light.id);
    placed.lights.push(light.clone());
    Ok(light)
}

fn update_runtime_light(
    world: &mut World,
    light_id: &str,
    patch: EditorLightPatch,
) -> Result<EditorLightInstance, String> {
    let existing = editor_lights_payload(world)
        .into_iter()
        .find(|light| light.id == light_id)
        .ok_or_else(|| format!("Light '{light_id}' does not exist in the runtime."))?;
    if existing.locked && patch.locked != Some(false) {
        return Err(format!("Light '{}' is locked.", existing.name));
    }

    let mut next = existing;
    if let Some(name) = patch.name {
        next.name = name;
    }
    if let Some(kind) = patch.kind {
        next.kind = kind;
    }
    if let Some(enabled) = patch.enabled {
        next.enabled = enabled;
    }
    if let Some(visible) = patch.visible {
        next.visible = visible;
    }
    if let Some(locked) = patch.locked {
        next.locked = locked;
    }
    if let Some(position) = patch.position {
        next.position = position;
    }
    if let Some(rotation) = patch.rotation {
        next.rotation = rotation;
    }
    if let Some(color) = patch.color {
        next.color = color;
    }
    if let Some(intensity) = patch.intensity {
        next.intensity = intensity;
    }
    if let Some(range) = patch.range {
        next.range = range;
    }
    if let Some(radius) = patch.radius {
        next.radius = radius;
    }
    if let Some(inner_cone_angle) = patch.inner_cone_angle {
        next.inner_cone_angle = inner_cone_angle;
    }
    if let Some(outer_cone_angle) = patch.outer_cone_angle {
        next.outer_cone_angle = outer_cone_angle;
    }
    if let Some(shadows_enabled) = patch.shadows_enabled {
        next.shadows_enabled = shadows_enabled;
    }
    if let Some(volumetric) = patch.volumetric {
        next.volumetric = volumetric;
    }

    upsert_runtime_light(world, next)
}

fn delete_runtime_light(world: &mut World, light_id: &str) -> Result<bool, String> {
    if light_id == "sun" {
        return Err("The built-in sun cannot be deleted.".to_string());
    }
    let deleted = despawn_editor_light_entity(world, light_id);
    if let Some(mut placed) = world.get_resource_mut::<EditorPlacedLights>() {
        placed.lights.retain(|light| light.id != light_id);
    }
    Ok(deleted)
}

pub fn save_editor_lights(world: &World) -> Result<(usize, &'static str), String> {
    let lights = world
        .get_resource::<EditorPlacedLights>()
        .map(|placed| placed.lights.as_slice())
        .unwrap_or(&[]);
    let path = Path::new(EDITOR_LIGHTS_SAVE_PATH);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create editor light save directory '{}': {error}",
                parent.display()
            )
        })?;
    }
    let file = File::create(path).map_err(|error| {
        format!(
            "Failed to create editor light save file '{}': {error}",
            path.display()
        )
    })?;
    serde_json::to_writer_pretty(file, lights).map_err(|error| {
        format!(
            "Failed to serialize editor light save file '{}': {error}",
            path.display()
        )
    })?;
    Ok((lights.len(), EDITOR_LIGHTS_SAVE_PATH))
}

pub fn editor_lights_payload(world: &World) -> Vec<EditorLightInstance> {
    let mut lights = vec![default_sun_light_payload()];
    if let Some(placed) = world.get_resource::<EditorPlacedLights>() {
        lights.extend(placed.lights.clone());
    }
    lights
}

fn despawn_editor_light_entity(world: &mut World, light_id: &str) -> bool {
    let mut query = world.query::<(Entity, &EditorLightInstanceId)>();
    let entities = query
        .iter(world)
        .filter_map(|(entity, id)| (id.0 == light_id).then_some(entity))
        .collect::<Vec<_>>();
    for entity in &entities {
        let _ = world.despawn(*entity);
    }
    !entities.is_empty()
}

fn light_transform(light: &EditorLightInstance) -> Transform {
    let rotation = Quat::from_euler(
        EulerRot::XYZ,
        light.rotation[0].to_radians(),
        light.rotation[1].to_radians(),
        light.rotation[2].to_radians(),
    );
    Transform::from_translation(Vec3::new(
        light.position[0],
        light.position[1],
        light.position[2],
    ))
    .with_rotation(rotation)
}

fn parse_hex_color(color: &str) -> Option<Color> {
    let trimmed = color.strip_prefix('#')?;
    if trimmed.len() != 6 {
        return None;
    }
    let red = u8::from_str_radix(&trimmed[0..2], 16).ok()? as f32 / 255.0;
    let green = u8::from_str_radix(&trimmed[2..4], 16).ok()? as f32 / 255.0;
    let blue = u8::from_str_radix(&trimmed[4..6], 16).ok()? as f32 / 255.0;
    Some(Color::srgb(red, green, blue))
}

fn parse_hex_rgb(color: &str) -> Option<Vec3> {
    let trimmed = color.strip_prefix('#')?;
    if trimmed.len() != 6 {
        return None;
    }
    let red = u8::from_str_radix(&trimmed[0..2], 16).ok()? as f32 / 255.0;
    let green = u8::from_str_radix(&trimmed[2..4], 16).ok()? as f32 / 255.0;
    let blue = u8::from_str_radix(&trimmed[4..6], 16).ok()? as f32 / 255.0;
    Some(Vec3::new(red, green, blue))
}

fn rgb_to_hex(rgb: Vec3) -> String {
    let red = (rgb.x.clamp(0.0, 1.0) * 255.0).round() as u8;
    let green = (rgb.y.clamp(0.0, 1.0) * 255.0).round() as u8;
    let blue = (rgb.z.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{red:02x}{green:02x}{blue:02x}")
}

fn color_to_hex(color: Color) -> String {
    let srgb = color.to_srgba();
    rgb_to_hex(Vec3::new(srgb.red, srgb.green, srgb.blue))
}

fn update_sun_light(
    world: &mut World,
    light: EditorLightInstance,
) -> Result<EditorLightInstance, String> {
    let color =
        parse_hex_color(&light.color).ok_or_else(|| "Light color must be #RRGGBB.".to_string())?;
    let mut query = world
        .query_filtered::<(&mut Transform, &mut DirectionalLight), With<crate::environment::Sun>>();
    if let Ok((mut transform, mut directional)) = query.single_mut(world) {
        *transform = light_transform(&light);
        directional.color = color;
        directional.illuminance = light.intensity;
        directional.shadows_enabled = light.shadows_enabled;
    }
    Ok(EditorLightInstance {
        source: EditorLightSource::Sun,
        locked: true,
        ..light
    })
}

fn default_sun_light_payload() -> EditorLightInstance {
    EditorLightInstance {
        id: "sun".to_string(),
        name: "Sun".to_string(),
        kind: EditorLightKind::Directional,
        enabled: true,
        visible: true,
        locked: true,
        position: [0.0, 0.0, 0.0],
        rotation: [-45.0, -35.0, 0.0],
        color: "#fff8f0".to_string(),
        intensity: 5000.0,
        range: 0.0,
        radius: 0.0,
        inner_cone_angle: 0.0,
        outer_cone_angle: 0.0,
        shadows_enabled: true,
        volumetric: true,
        source: EditorLightSource::Sun,
    }
}

fn runtime_prop_stats_payload(world: &mut World) -> Value {
    let missing_generated_assets = world
        .get_resource::<BillboardStats>()
        .map(|stats| stats.missing_generated_assets)
        .unwrap_or_default();
    let mut query = world.query::<(
        &Prop,
        Option<&Visibility>,
        Option<&BillboardLod>,
        Option<&PropLodState>,
    )>();
    let mut total = 0_usize;
    let mut visible = 0_usize;
    let mut hidden = 0_usize;
    let mut billboarded = 0_usize;
    let mut lod_switches = 0_usize;
    let mut shadow_cast = 0_usize;
    let mut groups = BTreeSet::new();

    for (prop, visibility, billboard_lod, lod_state) in query.iter(world) {
        total += 1;
        groups.insert(prop.id.as_str());
        if visibility.is_some_and(|visibility| *visibility == Visibility::Hidden) {
            hidden += 1;
        } else {
            visible += 1;
        }
        if billboard_lod.is_some_and(|lod| lod.is_billboard) {
            billboarded += 1;
        }
        if billboard_lod.is_some_and(|lod| lod.is_billboard) || lod_state.is_some() {
            lod_switches += 1;
        }
        if lod_state.is_none_or(|state| !state.shadows_disabled) {
            shadow_cast += 1;
        }
    }

    json!({
        "totalInstances": total,
        "visibleInstances": visible,
        "hiddenInstances": hidden,
        "billboardedCount": billboarded,
        "threeDCount": total.saturating_sub(billboarded),
        "lodSwitches": lod_switches,
        "missingGeneratedAssets": missing_generated_assets,
        "boundsWarnings": 0,
        "instancedGroups": groups.len(),
        "shadowCastCount": shadow_cast,
    })
}

fn update_runtime_water_body(
    world: &mut World,
    water_body_id: &str,
    patch: FrontendWaterBodyPatch,
) -> Result<Value, String> {
    let Some(id) = parse_water_body_id(water_body_id) else {
        return Err(format!(
            "Water body id '{water_body_id}' must look like water-body-n or a numeric id."
        ));
    };
    let Some(mut registry) = world.get_resource_mut::<WaterBodyRegistry>() else {
        return Err("WaterBodyRegistry resource is not available.".to_string());
    };

    let Some(body) = registry.bodies.get_mut(&id) else {
        return Err(format!(
            "Water body '{water_body_id}' does not exist in the runtime."
        ));
    };

    if let Some(kind) = patch.kind {
        body.kind = kind.as_runtime();
    }
    if let Some(reflection_strength) = patch.reflection_strength {
        body.reflection_strength = reflection_strength;
    }
    if let Some(fresnel_power) = patch.fresnel_power {
        body.fresnel_power = fresnel_power;
    }
    if let Some(distortion_strength) = patch.distortion_strength {
        body.distortion_strength = distortion_strength;
    }

    let payload = json!({
        "waterBody": {
            "id": format!("water-body-{}", body.id.0),
            "kind": water_kind_to_frontend(body.kind),
            "reflectionStrength": body.reflection_strength,
            "fresnelPower": body.fresnel_power,
            "distortionStrength": body.distortion_strength,
        },
    });
    registry.recount();

    Ok(payload)
}

fn voxel_edit_result_to_frontend(result: crate::voxel::world::VoxelEditResult) -> &'static str {
    match result {
        crate::voxel::world::VoxelEditResult::Applied => "applied",
        crate::voxel::world::VoxelEditResult::NoChange => "noChange",
        crate::voxel::world::VoxelEditResult::RejectedOutOfBounds => "rejectedOutOfBounds",
        crate::voxel::world::VoxelEditResult::RejectedBelowWorldFloor => "rejectedBelowWorldFloor",
        crate::voxel::world::VoxelEditResult::RejectedUnbreakable => "rejectedUnbreakable",
        crate::voxel::world::VoxelEditResult::RejectedMissingChunk => "rejectedMissingChunk",
        crate::voxel::world::VoxelEditResult::RejectedProtectedArea => "rejectedProtectedArea",
    }
}

fn set_atlas_mapping(world: &mut World, mut mapping: AtlasMapping) {
    mapping.needs_rebuild = true;
    if let Some(mut atlas_mapping) = world.get_resource_mut::<AtlasMapping>() {
        *atlas_mapping = mapping;
    } else {
        world.insert_resource(mapping);
    }
}

pub(crate) fn set_render_feature_flag(
    world: &mut World,
    feature: FrontendRenderFeatureFlag,
    enabled: bool,
    value: Option<f32>,
) -> Result<Value, String> {
    match feature {
        FrontendRenderFeatureFlag::Gtao => set_gtao_enabled(world, enabled)?,
        FrontendRenderFeatureFlag::Ssao => set_ssao_enabled(world, enabled)?,
        FrontendRenderFeatureFlag::BakedAo => {
            set_baked_ao_strength(world, if enabled { value.unwrap_or(0.35) } else { 0.0 });
        }
        FrontendRenderFeatureFlag::ShadowBudget => set_shadow_budget_enabled(world, enabled),
        FrontendRenderFeatureFlag::RayTracing => set_ray_tracing_enabled(world, enabled),
        FrontendRenderFeatureFlag::PhotoMode => set_photo_mode_enabled(world, enabled),
        FrontendRenderFeatureFlag::CinematicMode => set_cinematic_mode_enabled(world, enabled),
        FrontendRenderFeatureFlag::Fog => set_fog_enabled(world, enabled),
        FrontendRenderFeatureFlag::GodRays => set_god_rays_enabled(world, enabled, value),
    }

    Ok(json!({
        "feature": feature.as_frontend_str(),
        "enabled": render_feature_enabled(world, feature),
        "value": render_feature_value(world, feature),
        "metrics": render_feature_metrics_payload(world),
    }))
}

fn terrain_texturing_metrics_payload(world: &World) -> Value {
    let preset = world
        .get_resource::<RenderQualityPreset>()
        .copied()
        .unwrap_or_default();
    let config = world
        .get_resource::<TerrainTexturingConfig>()
        .cloned()
        .unwrap_or_default();
    let capabilities = world.get_resource::<GraphicsCapabilities>();

    serde_json::to_value(terrain_texturing_editor_payload(
        &config,
        capabilities.as_deref(),
        preset,
    ))
    .unwrap_or_else(|_| json!({}))
}

fn update_terrain_texturing(
    world: &mut World,
    patch: TerrainTexturingPatch,
) -> Result<Value, String> {
    let mut config = world
        .get_resource_mut::<TerrainTexturingConfig>()
        .ok_or_else(|| "TerrainTexturingConfig resource is not available.".to_string())?;

    if let Some(hex_tiling) = patch.hex_tiling {
        if let Some(enabled) = hex_tiling.enabled {
            config.hex_tiling.enabled = enabled;
        }
        if let Some(normal_enabled) = hex_tiling.normal_enabled {
            config.hex_tiling.normal_enabled = normal_enabled;
        }
    }

    Ok(json!({
        "settings": terrain_texturing_metrics_payload(world),
        "metrics": {
            "terrainTexturing": terrain_texturing_metrics_payload(world),
        },
    }))
}

fn update_runtime_ambient_light(
    world: &mut World,
    color: &str,
    brightness: f32,
) -> Result<Value, String> {
    let color_value =
        parse_hex_color(color).ok_or_else(|| "Ambient color must be #RRGGBB.".to_string())?;
    if let Some(mut ambient) = world.get_resource_mut::<GlobalAmbientLight>() {
        ambient.color = color_value;
        ambient.brightness = brightness;
    } else {
        world.insert_resource(GlobalAmbientLight {
            color: color_value,
            brightness,
            ..default()
        });
    }

    Ok(json!({
        "color": color,
        "brightness": brightness,
        "metrics": {
            "lightingAtmosphere": render_feature_metrics_payload(world)["lightingAtmosphere"].clone(),
        },
    }))
}

fn light_atmosphere_payload(world: &World) -> Value {
    let settings = world
        .get_resource::<AtmosphereSettings>()
        .cloned()
        .unwrap_or_default();
    let fog = world.get_resource::<FogConfig>();
    let ambient = world.get_resource::<GlobalAmbientLight>();
    let presets = world
        .get_resource::<LightAtmospherePresetState>()
        .copied()
        .unwrap_or_default();
    let direction = settings.manual_light_direction();

    json!(LightAtmosphereSettingsPayload {
        cycle_enabled: settings.cycle_enabled,
        light_enabled: settings.light_enabled,
        light_preset: presets.light_preset,
        atmosphere_preset: presets.atmosphere_preset,
        global_preset: presets.global_preset,
        light_color: rgb_to_hex(settings.light_color),
        light_illuminance: settings.light_illuminance,
        light_azimuth_degrees: settings.light_azimuth_degrees,
        light_elevation_degrees: settings.light_elevation_degrees,
        light_direction: [direction.x, direction.y, direction.z],
        atmosphere_amount: settings.atmosphere_amount,
        atmosphere_half_length: settings.atmosphere_half_length,
        fog_active: fog.is_some_and(|config| config.distance.enabled || config.volumetric.enabled),
        god_rays_enabled: fog
            .map(|config| config.screen_god_rays.enabled)
            .unwrap_or(false),
        ambient_color: ambient
            .map(|ambient| color_to_hex(ambient.color))
            .unwrap_or_else(|| "#ffffff".to_string()),
        ambient_brightness: ambient.map(|ambient| ambient.brightness).unwrap_or(0.0),
    })
}

fn update_light_atmosphere(
    world: &mut World,
    patch: LightAtmospherePatch,
) -> Result<Value, String> {
    let mut ambient_patch: Option<(String, f32)> = None;
    let current_ambient = world
        .get_resource::<GlobalAmbientLight>()
        .map(|ambient| (color_to_hex(ambient.color), ambient.brightness));
    {
        let mut settings = world
            .get_resource_mut::<AtmosphereSettings>()
            .ok_or_else(|| "AtmosphereSettings resource is not available.".to_string())?;

        if let Some(global_preset) = patch.global_preset {
            apply_global_light_atmosphere_preset(&mut settings, global_preset);
            if matches!(
                global_preset,
                GlobalLightAtmospherePreset::Default | GlobalLightAtmospherePreset::Neutral
            ) {
                ambient_patch = Some(("#ffffff".to_string(), 2000.0));
            }
        }
        if let Some(cycle_enabled) = patch.cycle_enabled {
            settings.cycle_enabled = cycle_enabled;
        }
        if let Some(enabled) = patch.light_enabled {
            settings.light_enabled = enabled;
        }
        if let Some(color) = patch.light_color.as_deref() {
            settings.light_color =
                parse_hex_rgb(color).ok_or_else(|| "lightColor must be #RRGGBB.".to_string())?;
        }
        if let Some(illuminance) = patch.light_illuminance {
            settings.light_illuminance = illuminance;
        }
        if let Some(direction) = patch.light_direction {
            let direction = Vec3::new(direction[0], direction[1], direction[2]).normalize();
            let (azimuth, elevation) = light_angles_from_direction(direction);
            settings.light_azimuth_degrees = azimuth;
            settings.light_elevation_degrees = elevation;
        } else {
            if let Some(azimuth) = patch.light_azimuth_degrees {
                settings.light_azimuth_degrees = azimuth;
            }
            if let Some(elevation) = patch.light_elevation_degrees {
                settings.light_elevation_degrees = elevation;
            }
        }
        if patch.cycle_enabled.is_none() {
            if patch.light_preset.is_some()
                || patch.light_enabled.is_some()
                || patch.light_color.is_some()
                || patch.light_illuminance.is_some()
                || patch.light_azimuth_degrees.is_some()
                || patch.light_elevation_degrees.is_some()
                || patch.light_direction.is_some()
            {
                settings.cycle_enabled = false;
            }
        }
        if let Some(amount) = patch.atmosphere_amount {
            settings.atmosphere_amount = amount;
        }
        if let Some(half_length) = patch.atmosphere_half_length {
            settings.atmosphere_half_length = half_length;
        }
        if patch.ambient_color.is_some() || patch.ambient_brightness.is_some() {
            ambient_patch = Some((
                patch.ambient_color.clone().unwrap_or_else(|| {
                    current_ambient
                        .as_ref()
                        .map(|ambient| ambient.0.clone())
                        .unwrap_or_else(|| "#ffffff".to_string())
                }),
                patch
                    .ambient_brightness
                    .unwrap_or_else(|| current_ambient.map(|ambient| ambient.1).unwrap_or(0.0)),
            ));
        }
        if let Some(light_preset) = patch.light_preset {
            apply_light_preset(&mut settings, light_preset);
        }
        if let Some(atmosphere_preset) = patch.atmosphere_preset {
            apply_atmosphere_preset(&mut settings, atmosphere_preset);
        }
    }

    {
        let mut presets = world
            .get_resource_mut::<LightAtmospherePresetState>()
            .ok_or_else(|| "LightAtmospherePresetState resource is not available.".to_string())?;
        if let Some(global_preset) = patch.global_preset {
            presets.global_preset = global_preset;
        }
        if let Some(light_preset) = patch.light_preset {
            presets.light_preset = light_preset;
        }
        if let Some(atmosphere_preset) = patch.atmosphere_preset {
            presets.atmosphere_preset = atmosphere_preset;
        }
    }

    sync_light_atmosphere_fog(world);
    apply_light_atmosphere_to_sun(world);
    if let Some((ambient_color, ambient_brightness)) = ambient_patch {
        update_runtime_ambient_light(world, &ambient_color, ambient_brightness)?;
    }

    Ok(json!({
        "settings": light_atmosphere_payload(world),
        "metrics": {
            "lightingAtmosphere": render_feature_metrics_payload(world)["lightingAtmosphere"].clone(),
        },
    }))
}

fn apply_light_preset(settings: &mut AtmosphereSettings, preset: LightPreset) {
    match preset {
        LightPreset::Sun => {
            settings.light_enabled = true;
            settings.light_color = Vec3::new(1.0, 0.98, 0.95);
            settings.light_illuminance = DEFAULT_SUN_ILLUMINANCE;
            settings.light_azimuth_degrees = 0.0;
            settings.light_elevation_degrees = 70.0;
        }
        LightPreset::Moon => {
            settings.light_enabled = true;
            settings.light_color = Vec3::new(0.73, 0.80, 1.0);
            settings.light_illuminance = 1200.0;
            settings.light_azimuth_degrees = 180.0;
            settings.light_elevation_degrees = 35.0;
        }
        LightPreset::NoneEmissivesOnly => {
            settings.light_enabled = false;
            settings.light_illuminance = 0.0;
        }
    }
}

fn apply_atmosphere_preset(settings: &mut AtmosphereSettings, preset: AtmospherePreset) {
    match preset {
        AtmospherePreset::Void => {
            settings.atmosphere_amount = 0.0;
            settings.atmosphere_half_length = 100_000.0;
            settings.rayleigh = Vec3::ZERO;
            settings.mie = Vec3::ZERO;
        }
        AtmospherePreset::Clear => {
            settings.atmosphere_amount = 0.25;
            settings.atmosphere_half_length = 800.0;
        }
        AtmospherePreset::Hazy => {
            settings.atmosphere_amount = 1.0;
            settings.atmosphere_half_length = 220.0;
        }
        AtmospherePreset::Fog => {
            settings.atmosphere_amount = 1.8;
            settings.atmosphere_half_length = 80.0;
        }
    }
}

fn apply_global_light_atmosphere_preset(
    settings: &mut AtmosphereSettings,
    preset: GlobalLightAtmospherePreset,
) {
    match preset {
        GlobalLightAtmospherePreset::Default => {
            let defaults = AtmosphereSettings::default();
            settings.light_enabled = defaults.light_enabled;
            settings.light_color = defaults.light_color;
            settings.light_illuminance = defaults.light_illuminance;
            settings.light_azimuth_degrees = defaults.light_azimuth_degrees;
            settings.light_elevation_degrees = defaults.light_elevation_degrees;
            settings.rayleigh = defaults.rayleigh;
            settings.mie = defaults.mie;
            settings.atmosphere_amount = defaults.atmosphere_amount;
            settings.atmosphere_half_length = defaults.atmosphere_half_length;
        }
        GlobalLightAtmospherePreset::Neutral => {
            settings.light_enabled = true;
            settings.light_color = Vec3::ONE;
            settings.light_illuminance = DEFAULT_SUN_ILLUMINANCE;
            settings.rayleigh = Vec3::ZERO;
            settings.mie = Vec3::ZERO;
            settings.atmosphere_amount = 0.0;
            settings.atmosphere_half_length = 100_000.0;
        }
    }
}

fn sync_light_atmosphere_fog(world: &mut World) {
    let settings = world
        .get_resource::<AtmosphereSettings>()
        .cloned()
        .unwrap_or_default();
    let amount = settings.atmosphere_amount.clamp(0.0, 8.0);
    let half_length = settings.atmosphere_half_length.clamp(1.0, 100_000.0);
    let extinction = if amount <= f32::EPSILON {
        0.0
    } else {
        std::f32::consts::LN_2 / half_length * amount
    };

    if let Some(mut fog) = world.get_resource_mut::<FogConfig>() {
        fog.distance.enabled = amount > f32::EPSILON;
        fog.distance.start = 0.0;
        fog.distance.end = if amount <= f32::EPSILON {
            100_000.0
        } else {
            half_length / amount.max(0.05)
        };
        fog.distance.falloff = crate::atmosphere::FogFalloffMode::Atmospheric;
        fog.volumetric.enabled = amount > 0.1 && !matches!(fog.current_preset, FogPreset::Clear);
        fog.volume.density = extinction;
        fog.color_modifiers.aerial_strength = amount.clamp(0.0, 2.0);
        fog.current_preset = if amount <= f32::EPSILON {
            FogPreset::Clear
        } else if half_length <= 120.0 || amount >= 1.5 {
            FogPreset::Misty
        } else if amount <= 0.35 {
            FogPreset::Clear
        } else {
            FogPreset::Balanced
        };
    }

    if let Some(mut settings) = world.get_resource_mut::<AtmosphereSettings>() {
        settings.fog_density = Vec2::splat((0.0009 * amount.max(0.05)).max(0.0001));
    }
}

fn apply_light_atmosphere_to_sun(world: &mut World) {
    let Some(settings) = world.get_resource::<AtmosphereSettings>().cloned() else {
        return;
    };
    let direction = settings.manual_light_direction();
    let color = Color::srgb(
        settings.light_color.x,
        settings.light_color.y,
        settings.light_color.z,
    );
    let mut query = world
        .query_filtered::<(&mut Transform, &mut DirectionalLight), With<crate::environment::Sun>>();
    if let Ok((mut transform, mut light)) = query.single_mut(world) {
        transform.look_to(-direction, Vec3::Y);
        light.color = color;
        light.illuminance = if settings.light_enabled {
            settings.light_illuminance
        } else {
            0.0
        };
    }
}

fn set_photo_mode_enabled(world: &mut World, enabled: bool) {
    let config = world
        .get_resource::<CinematicConfig>()
        .cloned()
        .unwrap_or_default();

    if let Some(mut state) = world.get_resource_mut::<PhotoModeState>() {
        state.active = enabled;
        if enabled {
            state.focal_distance = config.depth_of_field.focal_distance;
            state.aperture = config.depth_of_field.aperture_f_stops;
            state.blur_enabled = config.depth_of_field.enabled;
        }
    } else {
        world.insert_resource(PhotoModeState {
            active: enabled,
            focal_distance: if enabled {
                config.depth_of_field.focal_distance
            } else {
                0.0
            },
            aperture: if enabled {
                config.depth_of_field.aperture_f_stops
            } else {
                0.0
            },
            blur_enabled: enabled && config.depth_of_field.enabled,
        });
    }

    let cinematic_active = render_feature_enabled(world, FrontendRenderFeatureFlag::CinematicMode);
    if enabled || !cinematic_active {
        apply_cinematic_camera_effects(world, &config, enabled);
    }
}

fn set_cinematic_mode_enabled(world: &mut World, enabled: bool) {
    let config = world
        .get_resource::<CinematicConfig>()
        .cloned()
        .unwrap_or_default();

    if let Some(mut state) = world.get_resource_mut::<CinematicState>() {
        state.active = enabled;
        state.target_focal_distance = config.depth_of_field.focal_distance;
        state.current_focal_distance = config.depth_of_field.focal_distance;
        state.transition_timer = None;
    } else {
        world.insert_resource(CinematicState {
            active: enabled,
            transition_timer: None,
            target_focal_distance: config.depth_of_field.focal_distance,
            current_focal_distance: config.depth_of_field.focal_distance,
        });
    }

    apply_cinematic_camera_effects(world, &config, enabled);
}

fn apply_cinematic_camera_effects(world: &mut World, config: &CinematicConfig, enabled: bool) {
    let dof = dof_component(config);
    let motion_blur = motion_blur_component(config);
    let mut cameras = world.query_filtered::<Entity, With<CinematicCamera>>();
    let camera_entities = cameras.iter(world).collect::<Vec<_>>();
    for entity in camera_entities {
        let mut entity_mut = world.entity_mut(entity);
        if enabled {
            if let Some(dof) = dof.clone() {
                entity_mut.insert(dof);
            }
            if let Some(motion_blur) = motion_blur.clone() {
                entity_mut.insert(motion_blur);
            }
        } else {
            entity_mut
                .remove::<bevy::post_process::dof::DepthOfField>()
                .remove::<bevy::post_process::motion_blur::MotionBlur>();
        }
    }
}

fn set_ray_tracing_enabled(world: &mut World, enabled: bool) {
    if let Some(mut settings) = world.get_resource_mut::<RayTracingSettings>() {
        settings.enabled = enabled;
    } else {
        world.insert_resource(RayTracingSettings {
            enabled,
            ..default()
        });
    }
}

fn set_shadow_budget_enabled(world: &mut World, enabled: bool) {
    if let Some(mut config) = world.get_resource_mut::<ShadowBudgetConfig>() {
        config.enabled = enabled;
    } else {
        world.insert_resource(ShadowBudgetConfig {
            enabled,
            ..default()
        });
    }
}

fn set_gtao_enabled(world: &mut World, enabled: bool) -> Result<(), String> {
    if enabled && integrated_gpu_gtao_disabled(world) {
        return Err(
            "GTAO cannot be enabled on an integrated GPU with the current AO config.".to_string(),
        );
    }

    let settings = world
        .get_resource::<AmbientOcclusionConfig>()
        .map(gtao_settings_from_config)
        .unwrap_or_default();

    if let Some(mut config) = world.get_resource_mut::<AmbientOcclusionConfig>() {
        if let Some(gtao) = config.gtao.as_mut() {
            gtao.enabled = enabled;
        }
    }

    let mut query = world.query_filtered::<(Entity, Option<&GtaoSettings>), With<Camera3d>>();
    let cameras = query
        .iter(world)
        .map(|(entity, existing)| (entity, existing.is_some()))
        .collect::<Vec<_>>();

    for (entity, has_gtao) in cameras {
        let mut entity_mut = world.entity_mut(entity);
        if enabled && !has_gtao {
            entity_mut.insert((settings.clone(), DepthPrepass, NormalPrepass));
        } else if !enabled && has_gtao {
            entity_mut.remove::<GtaoSettings>();
        }
    }

    Ok(())
}

fn set_ssao_enabled(world: &mut World, enabled: bool) -> Result<(), String> {
    if enabled && integrated_gpu_ssao_disabled(world) {
        return Err(
            "SSAO cannot be enabled on an integrated GPU with the current AO config.".to_string(),
        );
    }

    let ssao = world
        .get_resource::<AmbientOcclusionConfig>()
        .map(|config| ScreenSpaceAmbientOcclusion {
            quality_level: config.ssao.quality_level(),
            constant_object_thickness: config.ssao.constant_object_thickness,
            ..default()
        })
        .unwrap_or_default();

    if let Some(mut config) = world.get_resource_mut::<AmbientOcclusionConfig>() {
        config.ssao.enabled = enabled;
    }

    let mut query =
        world.query_filtered::<(Entity, Option<&ScreenSpaceAmbientOcclusion>), With<Camera3d>>();
    let cameras = query
        .iter(world)
        .map(|(entity, existing)| (entity, existing.is_some()))
        .collect::<Vec<_>>();

    for (entity, has_ssao) in cameras {
        let mut entity_mut = world.entity_mut(entity);
        if enabled && !has_ssao {
            entity_mut.insert(ssao.clone());
        } else if !enabled && has_ssao {
            entity_mut.remove::<ScreenSpaceAmbientOcclusion>();
        }
    }

    Ok(())
}

fn integrated_gpu_gtao_disabled(world: &World) -> bool {
    let integrated = world
        .get_resource::<GraphicsCapabilities>()
        .is_some_and(|capabilities| capabilities.integrated_gpu);
    let disable_on_integrated =
        world
            .get_resource::<AmbientOcclusionConfig>()
            .is_some_and(|config| {
                config
                    .gtao
                    .as_ref()
                    .map(|gtao| gtao.disable_on_integrated_gpu)
                    .unwrap_or(config.ssao.disable_on_integrated_gpu)
            });

    integrated && disable_on_integrated
}

fn integrated_gpu_ssao_disabled(world: &World) -> bool {
    let integrated = world
        .get_resource::<GraphicsCapabilities>()
        .is_some_and(|capabilities| capabilities.integrated_gpu);
    let disable_on_integrated = world
        .get_resource::<AmbientOcclusionConfig>()
        .is_some_and(|config| config.ssao.disable_on_integrated_gpu);

    integrated && disable_on_integrated
}

fn set_baked_ao_strength(world: &mut World, strength: f32) {
    let strength = strength.clamp(0.0, 1.0);

    if let Some(mut config) = world.get_resource_mut::<AmbientOcclusionConfig>() {
        config.baked.enabled = strength > 0.0;
        config.baked.strength = strength;
    }

    if let Some(mut terrain_style) =
        world.get_resource_mut::<crate::debug_ui::TerrainStyleSettings>()
    {
        terrain_style.ao_strength = strength;
    }

    let handles = world
        .get_resource::<TriplanarMaterialHandle>()
        .map(|handles| {
            [
                handles.handle.clone(),
                handles.cheap_handle.clone(),
                handles.single_projection_far_handle.clone(),
                handles.atlas_only_debug_handle.clone(),
                handles.wireframe_debug_handle.clone(),
                handles.normals_debug_handle.clone(),
                handles.wireframe_normals_debug_handle.clone(),
                handles.flat_unlit_debug_handle.clone(),
                handles.wireframe_flat_unlit_debug_handle.clone(),
            ]
        })
        .unwrap_or_default();

    if let Some(mut materials) = world.get_resource_mut::<Assets<TriplanarMaterial>>() {
        for handle in handles {
            if let Some(material) = materials.get_mut(&handle) {
                material.uniforms.ao_strength = strength;
            }
        }
    }
}

fn set_fog_enabled(world: &mut World, enabled: bool) {
    if let Some(mut config) = world.get_resource_mut::<FogConfig>() {
        config.distance.enabled = enabled;
        config.volumetric.enabled = enabled;
    }

    if let Some(mut quality) = world.get_resource_mut::<FogQuality>() {
        quality.user_override = true;
        quality.tier = if enabled && !quality.tier.is_enabled() {
            FogQualityTier::Medium
        } else if enabled {
            quality.tier
        } else {
            FogQualityTier::Off
        };
    }

    if let Some(mut toggles) = world.get_resource_mut::<DebugDetailToggles>() {
        toggles.volumetric_fog_enabled = enabled;
    }
}

fn set_god_rays_enabled(world: &mut World, enabled: bool, intensity: Option<f32>) {
    let mut config = world
        .get_resource::<GodRayConfig>()
        .cloned()
        .unwrap_or_default();
    config.enabled = enabled;
    if let Some(intensity) = intensity {
        config.intensity = intensity.clamp(0.0, 2.0);
    }
    world.insert_resource(config.clone());

    if let Some(mut fog_config) = world.get_resource_mut::<FogConfig>() {
        fog_config.screen_god_rays.enabled = enabled;
        fog_config.screen_god_rays.intensity = config.intensity;
    }
}

fn set_viewport_debug_overlay(
    world: &mut World,
    overlay: FrontendViewportDebugOverlay,
    enabled: bool,
) {
    let mut state = world
        .get_resource::<RuntimeViewportDebugState>()
        .cloned()
        .unwrap_or_default();

    match overlay {
        FrontendViewportDebugOverlay::ChunkBounds => state.chunk_bounds = enabled,
        FrontendViewportDebugOverlay::VoxelGrid => state.voxel_grid = enabled,
        FrontendViewportDebugOverlay::WaterDebug => state.water_debug = enabled,
        FrontendViewportDebugOverlay::ProtectedAreas => state.protected_areas = enabled,
        FrontendViewportDebugOverlay::PropBounds => state.prop_bounds = enabled,
        FrontendViewportDebugOverlay::PropBillboards => state.prop_billboards = enabled,
        FrontendViewportDebugOverlay::AgentTargets => state.agent_targets = enabled,
        FrontendViewportDebugOverlay::AtlasPreview => state.atlas_preview = enabled,
        FrontendViewportDebugOverlay::Wireframe => state.wireframe = enabled,
    }
    state.editor_controlled = true;

    if let FrontendViewportDebugOverlay::PropBounds = overlay {
        if let Some(mut prop_bounds_debug) = world.get_resource_mut::<PropBoundsDebugSettings>() {
            prop_bounds_debug.enabled = enabled;
        } else {
            world.insert_resource(PropBoundsDebugSettings { enabled });
        }
    }

    if let Some(mut toggles) = world.get_resource_mut::<DebugDetailToggles>() {
        match overlay {
            FrontendViewportDebugOverlay::ChunkBounds => toggles.show_chunk_stats = enabled,
            FrontendViewportDebugOverlay::PropBounds => toggles.show_prop_details = enabled,
            _ => {}
        }
    }

    if let FrontendViewportDebugOverlay::Wireframe = overlay {
        if let Some(mut overlay_state) = world.get_resource_mut::<DebugOverlayState>() {
            overlay_state.visible = enabled;
        }
        set_terrain_wireframe_debug_material(world, enabled);
    }

    world.insert_resource(state);
}

fn set_terrain_wireframe_debug_material(world: &mut World, enabled: bool) {
    let Some(debug_handles) = world
        .get_resource::<crate::voxel::terrain_debug::TerrainDebugMaterialHandles>()
        .cloned()
    else {
        return;
    };
    let restore_handles = (!enabled)
        .then(|| {
            world
                .get_resource::<TriplanarMaterialHandle>()
                .map(|handles| {
                    (
                        handles.handle.clone(),
                        handles.cheap_handle.clone(),
                        handles.single_projection_far_handle.clone(),
                        handles.horizon_proxy_handle.clone(),
                        handles.atlas_only_debug_handle.clone(),
                        handles.wireframe_debug_handle.clone(),
                        handles.normals_debug_handle.clone(),
                        handles.wireframe_normals_debug_handle.clone(),
                        handles.flat_unlit_debug_handle.clone(),
                        handles.wireframe_flat_unlit_debug_handle.clone(),
                    )
                })
        })
        .flatten();
    let wireframe_fallback = world
        .get_resource::<TriplanarMaterialHandle>()
        .map(|handles| handles.wireframe_debug_handle.clone());

    let mut query = world.query::<(
        &mut MeshMaterial3d<TriplanarMaterial>,
        &ChunkMesh,
        Option<&TerrainMeshDebug>,
    )>();
    for (mut material, chunk_mesh, mesh_debug) in query.iter_mut(world) {
        **material = if enabled {
            let lod = mesh_debug
                .map(|debug| debug.logical_lod_at_mesh)
                .unwrap_or(LodLevel::Lod0);
            debug_handles
                .handle_for(
                    crate::voxel::terrain_debug::TerrainDebugMaterialMode::Wireframe,
                    lod,
                )
                .or(wireframe_fallback.clone())
                .unwrap()
        } else if let Some((
            full,
            cheap,
            single_projection_far,
            horizon_proxy,
            atlas_only_debug,
            wireframe_debug,
            normals_debug,
            wireframe_normals_debug,
            flat_unlit_debug,
            wireframe_flat_unlit_debug,
        )) = restore_handles.as_ref()
        {
            match chunk_mesh.material_quality {
                TerrainMaterialQuality::FullTriplanar => full.clone(),
                TerrainMaterialQuality::CheapTriplanar => cheap.clone(),
                TerrainMaterialQuality::SingleProjectionFar => single_projection_far.clone(),
                TerrainMaterialQuality::HorizonProxy => horizon_proxy.clone(),
                TerrainMaterialQuality::AtlasOnlyDebug => atlas_only_debug.clone(),
                TerrainMaterialQuality::WireframeDebug => wireframe_debug.clone(),
                TerrainMaterialQuality::NormalsDebug => normals_debug.clone(),
                TerrainMaterialQuality::WireframeNormalsDebug => wireframe_normals_debug.clone(),
                TerrainMaterialQuality::FlatUnlitDebug => flat_unlit_debug.clone(),
                TerrainMaterialQuality::WireframeFlatUnlitDebug => {
                    wireframe_flat_unlit_debug.clone()
                }
            }
        } else {
            debug_handles
                .handle_for(
                    crate::voxel::terrain_debug::TerrainDebugMaterialMode::Wireframe,
                    LodLevel::Lod0,
                )
                .or(wireframe_fallback.clone())
                .unwrap()
        };
    }
}

fn set_editor_diagnostics(
    world: &mut World,
    enabled: bool,
    categories: Vec<EditorDiagnosticsCategory>,
) {
    let mut state = world
        .get_resource::<EditorDiagnosticsState>()
        .cloned()
        .unwrap_or_default();
    state.enabled = enabled;
    state.categories = normalize_editor_diagnostics_categories(categories);

    let category_labels: Vec<_> = state
        .categories
        .iter()
        .map(|category| category.label())
        .collect();
    let line = format!(
        "[editor-diagnostics][runtime] mode={} categories={}",
        if state.enabled { "enabled" } else { "disabled" },
        category_labels.join(",")
    );
    eprintln!("{line}");
    info!("{line}");

    world.insert_resource(state);
}

fn render_quality_metrics(preset: RenderQualityPreset) -> Value {
    json!({
        "propLodDistanceScale": preset.prop_lod_distance_scale(),
        "propShadowDistanceScale": preset.prop_shadow_distance_scale(),
        "terrainMaterialLodDistance": preset.terrain_material_lod_distance(96.0),
        "waterReflectionResolutionScale": preset.water_reflection_resolution_scale(),
        "waterReflectionUpdateInterval": preset.water_reflection_update_interval(),
        "waterReflectionDistance": preset.water_reflection_distance(),
        "waterReflectionQualityCode": preset.water_reflection_quality_code(),
        "shadowQualityCode": preset.shadow_quality_code(),
    })
}

fn render_quality_preset_to_frontend(preset: RenderQualityPreset) -> &'static str {
    match preset {
        RenderQualityPreset::Low => "Low",
        RenderQualityPreset::Medium => "Medium",
        RenderQualityPreset::High => "High",
        RenderQualityPreset::Performance100 => "Performance100",
    }
}

fn runtime_metrics_payload(
    world: &World,
    preset: RenderQualityPreset,
    water_visual_probe: &Value,
) -> Value {
    let reflection_status = &water_visual_probe["reflectionStatus"];
    let water_presence = &water_visual_probe["waterPresence"];
    let render_features = render_feature_metrics_payload(world);
    let ray_tracing = world
        .get_resource::<RayTracingSettings>()
        .cloned()
        .unwrap_or_default();

    json!({
        "fps": 60,
        "frameMs": 16.7,
        "renderQualityPreset": render_quality_preset_to_frontend(preset),
        "renderQualityReadouts": render_quality_metrics(preset),
        "chunkMeshMs": 0.0,
        "waterReflectionMs": 0.0,
        "propBillboardMs": 0.0,
        "shadowBudget": render_features["shadowBudget"].clone(),
        "ambientOcclusion": render_features["ambientOcclusion"].clone(),
        "adaptiveGI": {
            "adaptiveGiQuality": 2,
            "stochasticProbeSelection": true,
            "probeSelectionCount": 6,
            "sdfShadows": true,
            "contactShadows": true,
            "voxelRayBackend": ray_tracing.voxel_backend.as_str(),
            "effectiveVoxelRayBackend": ray_tracing.effective_backend().as_str(),
            "experimentalRenderMode": ray_tracing.experimental_mode.as_str(),
            "backendSwitchGeneration": ray_tracing.backend_switch_generation,
            "voxelRayFallbackReason": ray_tracing.fallback_reason,
        },
        "waterRenderDebug": {
            "reflectionActive": reflection_status["active"].as_bool().unwrap_or(false),
            "waterMaskPixels": water_presence["visibleMeshes"].as_u64().unwrap_or(0),
            "displacementEnabled": true,
            "visualProbeStatus": "runtime",
        },
        "lightingAtmosphere": render_features["lightingAtmosphere"].clone(),
        "volumetricClouds": {
            "coverage": 0.4,
            "renderScale": 0.6,
            "primarySteps": 12,
            "lightSteps": 8,
        },
        "cinematicPhotoMode": render_features["cinematicPhotoMode"].clone(),
        "graphicsCapabilities": graphics_capabilities_payload(world),
        "terrainTexturing": terrain_texturing_metrics_payload(world),
        "timingSamples": [
            { "label": "frame.total", "ms": 16.7, "category": "frame" },
            { "label": "water.reflection_probe", "ms": 0.0, "category": "water" },
        ],
    })
}

fn render_feature_metrics_payload(world: &World) -> Value {
    let ao = world.get_resource::<AmbientOcclusionConfig>();
    let gtao = ao.and_then(|config| config.gtao.as_ref());
    let fog = world.get_resource::<FogConfig>();
    let god_rays = world.get_resource::<GodRayConfig>();
    let ambient = world.get_resource::<GlobalAmbientLight>();
    let light_atmosphere = light_atmosphere_payload(world);

    json!({
        "shadowBudget": {
            "enabled": render_feature_enabled(world, FrontendRenderFeatureFlag::ShadowBudget),
        },
        "graphicsCapabilities": graphics_capabilities_payload(world),
        "cinematicPhotoMode": cinematic_photo_payload(world),
        "ambientOcclusion": {
            "gtaoEnabled": gtao.is_some_and(|config| config.enabled),
            "gtaoQuality": gtao
                .map(|config| config.quality.to_lowercase())
                .unwrap_or_else(|| "medium".to_string()),
            "gtaoSliceCount": gtao.map(|config| config.slice_count).unwrap_or(0),
            "gtaoStepsPerSlice": gtao.map(|config| config.steps_per_slice).unwrap_or(0),
            "gtaoRadius": gtao.map(|config| config.radius).unwrap_or(0.0),
            "gtaoTemporalDenoise": false,
            "ssaoSupported": ssao_supported(world),
            "ssaoEnabled": ao.is_some_and(|config| config.ssao.enabled),
            "bakedAoStrength": baked_ao_strength(world),
        },
        "lightingAtmosphere": {
            "sunTimeOfDay": "runtime",
            "fogPreset": fog
                .map(|config| fog_preset_to_frontend(config.current_preset))
                .unwrap_or("Runtime"),
            "settings": light_atmosphere,
            "fogActive": render_feature_enabled(world, FrontendRenderFeatureFlag::Fog),
            "godRaysEnabled": god_rays
                .map(|config| config.enabled)
                .or_else(|| fog.map(|config| config.screen_god_rays.enabled))
                .unwrap_or(false),
            "godRayIntensity": god_rays
                .map(|config| config.intensity)
                .or_else(|| fog.map(|config| config.screen_god_rays.intensity))
                .unwrap_or(0.0),
            "ambientColor": ambient
                .map(|ambient| color_to_hex(ambient.color))
                .unwrap_or_else(|| "#ffffff".to_string()),
            "ambientBrightness": ambient.map(|ambient| ambient.brightness).unwrap_or(0.0),
        },
    })
}

fn render_feature_enabled(world: &World, feature: FrontendRenderFeatureFlag) -> bool {
    match feature {
        FrontendRenderFeatureFlag::Gtao => world
            .get_resource::<AmbientOcclusionConfig>()
            .and_then(|config| config.gtao.as_ref())
            .is_some_and(|config| config.enabled),
        FrontendRenderFeatureFlag::Ssao => world
            .get_resource::<AmbientOcclusionConfig>()
            .is_some_and(|config| config.ssao.enabled),
        FrontendRenderFeatureFlag::BakedAo => baked_ao_strength(world) > 0.0,
        FrontendRenderFeatureFlag::ShadowBudget => world
            .get_resource::<ShadowBudgetConfig>()
            .map(|config| config.enabled)
            .unwrap_or(true),
        FrontendRenderFeatureFlag::RayTracing => world
            .get_resource::<RayTracingSettings>()
            .map(|settings| settings.enabled)
            .unwrap_or(false),
        FrontendRenderFeatureFlag::PhotoMode => world
            .get_resource::<PhotoModeState>()
            .map(|state| state.active)
            .unwrap_or(false),
        FrontendRenderFeatureFlag::CinematicMode => world
            .get_resource::<CinematicState>()
            .map(|state| state.active)
            .unwrap_or(false),
        FrontendRenderFeatureFlag::Fog => world
            .get_resource::<FogConfig>()
            .is_some_and(|config| config.distance.enabled || config.volumetric.enabled),
        FrontendRenderFeatureFlag::GodRays => world
            .get_resource::<GodRayConfig>()
            .map(|config| config.enabled)
            .or_else(|| {
                world
                    .get_resource::<FogConfig>()
                    .map(|config| config.screen_god_rays.enabled)
            })
            .unwrap_or(false),
    }
}

fn render_feature_value(world: &World, feature: FrontendRenderFeatureFlag) -> Value {
    match feature {
        FrontendRenderFeatureFlag::BakedAo => json!(baked_ao_strength(world)),
        FrontendRenderFeatureFlag::ShadowBudget => {
            json!(render_feature_enabled(world, feature))
        }
        FrontendRenderFeatureFlag::RayTracing => json!(render_feature_enabled(world, feature)),
        FrontendRenderFeatureFlag::PhotoMode | FrontendRenderFeatureFlag::CinematicMode => {
            json!(render_feature_enabled(world, feature))
        }
        FrontendRenderFeatureFlag::GodRays => json!(
            world
                .get_resource::<GodRayConfig>()
                .map(|config| config.intensity)
                .or_else(|| {
                    world
                        .get_resource::<FogConfig>()
                        .map(|config| config.screen_god_rays.intensity)
                })
                .unwrap_or(0.0)
        ),
        _ => json!(render_feature_enabled(world, feature)),
    }
}

fn baked_ao_strength(world: &World) -> f32 {
    let material_strength = world
        .get_resource::<TriplanarMaterialHandle>()
        .and_then(|handle| {
            world
                .get_resource::<Assets<TriplanarMaterial>>()
                .and_then(|materials| materials.get(&handle.handle))
        })
        .map(|material| material.uniforms.ao_strength);

    material_strength.unwrap_or_else(|| {
        world
            .get_resource::<AmbientOcclusionConfig>()
            .map(|config| {
                if config.baked.enabled {
                    config.baked.strength
                } else {
                    0.0
                }
            })
            .unwrap_or(0.0)
    })
}

fn cinematic_photo_payload(world: &World) -> Value {
    let photo = world.get_resource::<PhotoModeState>();
    let cinematic = world.get_resource::<CinematicState>();
    let config = world
        .get_resource::<CinematicConfig>()
        .cloned()
        .unwrap_or_default();

    json!({
        "photoModeActive": photo.map(|state| state.active).unwrap_or(false),
        "focalDistance": photo
            .map(|state| state.focal_distance)
            .filter(|distance| *distance > 0.0)
            .unwrap_or(config.depth_of_field.focal_distance),
        "aperture": photo
            .map(|state| state.aperture)
            .filter(|aperture| *aperture > 0.0)
            .unwrap_or(config.depth_of_field.aperture_f_stops),
        "blurEnabled": photo
            .map(|state| state.blur_enabled)
            .unwrap_or(config.depth_of_field.enabled),
        "depthOfFieldMode": config.depth_of_field.mode,
        "motionBlurSamples": config.motion_blur.samples,
        "cinematicModeActive": cinematic.map(|state| state.active).unwrap_or(false),
    })
}

fn ssao_supported(world: &World) -> bool {
    if let Some(capabilities) = world.get_resource::<GraphicsCapabilities>() {
        return !capabilities.integrated_gpu;
    }

    world
        .get_resource::<SsaoSupported>()
        .map(|supported| supported.0)
        .unwrap_or(true)
}

fn graphics_capabilities_payload(world: &World) -> Value {
    let capabilities = world.get_resource::<GraphicsCapabilities>();
    let ray_tracing_enabled = render_feature_enabled(world, FrontendRenderFeatureFlag::RayTracing);
    json!({
        "adapterName": capabilities
            .and_then(|capabilities| capabilities.adapter_name.as_deref())
            .unwrap_or("Bevy runtime"),
        "integratedGPU": capabilities.is_some_and(|capabilities| capabilities.integrated_gpu),
        "taaSupported": capabilities.map(|capabilities| capabilities.taa_supported).unwrap_or(true),
        "rayTracingSupported": capabilities
            .map(|capabilities| capabilities.ray_tracing_supported)
            .unwrap_or(false),
        "rayTracingEnabled": ray_tracing_enabled,
    })
}

fn fog_preset_to_frontend(preset: FogPreset) -> &'static str {
    match preset {
        FogPreset::Clear => "Clear",
        FogPreset::Balanced => "Balanced",
        FogPreset::Misty => "Misty",
        FogPreset::GodRays => "GodRays",
    }
}

fn water_visual_probe_payload(world: &World) -> Value {
    let config = world
        .get_resource::<WaterReflectionConfig>()
        .cloned()
        .unwrap_or_default();
    let status = world
        .get_resource::<WaterReflectionStatus>()
        .copied()
        .unwrap_or_default();
    let debug_mode = world
        .get_resource::<WaterReflectionDebugViewMode>()
        .copied()
        .unwrap_or_default();
    let presence = world
        .get_resource::<WaterPresence>()
        .copied()
        .unwrap_or_default();
    let probe = world
        .get_resource::<WaterVisualDebugState>()
        .cloned()
        .unwrap_or_default();

    json!({
        "reflectionStatus": {
            "active": status.active,
            "sampleReflection": status.sample_reflection,
            "reason": status.reason.as_str(),
            "resolutionScale": status.resolution_scale,
            "effectiveHz": status.effective_hz,
            "enabled": config.enabled,
            "debugViewMode": debug_mode_to_frontend(debug_mode),
            "probeValid": true,
            "lastProbeUpdateMs": 0.0,
        },
        "waterPresence": {
            "nearestWaterDistance": presence.nearest_visible_distance,
            "visibleMeshes": presence.visible_meshes,
            "eligibleMeshes": presence.eligible_meshes,
            "viewVisibleMeshes": presence.view_visible_meshes,
            "totalWaterMeshes": presence.water_meshes,
        },
        "probe": {
            "nearestBodyKind": water_kind_to_frontend(probe.nearest_body_kind),
            "materialMode": material_mode_to_frontend(probe.nearest_material_mode),
            "maxDepth": probe.nearest_max_depth,
            "triangles": probe.nearest_triangles,
            "reflectionEligible": probe.reflection_eligible,
            "reflectionActive": probe.reflection_active,
            "compositorPixelMatched": probe.compositor_pixel_matched,
        },
        "capturedAt": timestamp_string(),
    })
}

fn validate_atlas_mapping(mapping: &FrontendAtlasMapping, errors: &mut Vec<String>) {
    for (block, face, tile_id) in atlas_tile_entries(mapping) {
        if parse_tile_id(tile_id).is_none() {
            errors.push(format!(
                "{block}.{face} tile id '{tile_id}' must look like tile-0 through tile-63."
            ));
        }
    }
}

fn to_runtime_atlas_mapping(mapping: &FrontendAtlasMapping) -> Result<AtlasMapping, Vec<String>> {
    let mut errors = Vec::new();
    validate_atlas_mapping(mapping, &mut errors);
    if !errors.is_empty() {
        return Err(errors);
    }

    Ok(AtlasMapping {
        grass: face_mapping_to_runtime(&mapping.grass),
        dirt: face_mapping_to_runtime(&mapping.dirt),
        rock: face_mapping_to_runtime(&mapping.rock),
        sand: face_mapping_to_runtime(&mapping.sand),
        needs_rebuild: true,
    })
}

fn face_mapping_to_runtime(mapping: &FrontendAtlasFaceMapping) -> BlockAtlasMap {
    BlockAtlasMap {
        top: parse_tile_id(&mapping.top).unwrap_or_default(),
        side: parse_tile_id(&mapping.side).unwrap_or_default(),
        bottom: parse_tile_id(&mapping.bottom).unwrap_or_default(),
    }
}

fn frontend_atlas_mapping_payload(mapping: &AtlasMapping) -> Value {
    json!({
        "grass": block_map_payload(mapping.grass),
        "dirt": block_map_payload(mapping.dirt),
        "rock": block_map_payload(mapping.rock),
        "sand": block_map_payload(mapping.sand),
    })
}

fn block_map_payload(mapping: BlockAtlasMap) -> Value {
    json!({
        "top": format!("tile-{}", mapping.top),
        "side": format!("tile-{}", mapping.side),
        "bottom": format!("tile-{}", mapping.bottom),
    })
}

fn atlas_tile_entries(mapping: &FrontendAtlasMapping) -> [(&'static str, &'static str, &str); 12] {
    [
        ("grass", "top", mapping.grass.top.as_str()),
        ("grass", "side", mapping.grass.side.as_str()),
        ("grass", "bottom", mapping.grass.bottom.as_str()),
        ("dirt", "top", mapping.dirt.top.as_str()),
        ("dirt", "side", mapping.dirt.side.as_str()),
        ("dirt", "bottom", mapping.dirt.bottom.as_str()),
        ("rock", "top", mapping.rock.top.as_str()),
        ("rock", "side", mapping.rock.side.as_str()),
        ("rock", "bottom", mapping.rock.bottom.as_str()),
        ("sand", "top", mapping.sand.top.as_str()),
        ("sand", "side", mapping.sand.side.as_str()),
        ("sand", "bottom", mapping.sand.bottom.as_str()),
    ]
}

fn parse_tile_id(tile_id: &str) -> Option<u32> {
    let index = tile_id.strip_prefix("tile-")?.parse::<u32>().ok()?;
    (index < ATLAS_TILE_COUNT).then_some(index)
}

fn material_catalog_payload(world: &World) -> Value {
    let catalog = world
        .get_resource::<MaterialCatalog>()
        .cloned()
        .unwrap_or_default();

    json!({
        "materialTypes": catalog.material_types.iter().map(|material_type| {
            json!({
                "id": material_type.id,
                "name": material_type.name,
                "materialIds": material_type.material_ids.iter().copied().map(material_id_string).collect::<Vec<_>>(),
            })
        }).collect::<Vec<_>>(),
        "materials": catalog.materials.iter().map(material_payload).collect::<Vec<_>>(),
        "palettes": catalog.palettes.iter().map(|palette| {
            json!({
                "id": palette.id,
                "name": palette.name,
                "materialIds": palette.material_ids.iter().copied().map(material_id_string).collect::<Vec<_>>(),
            })
        }).collect::<Vec<_>>(),
        "activeMaterialId": material_id_string(catalog.active_material_id),
    })
}

fn material_payload(material: &VoxelMaterialDefinition) -> Value {
    json!({
        "id": material_id_string(material.id),
        "numericId": material.id.0,
        "name": material.name,
        "kind": if material.material_type_id == "water" { "water" } else { "blocky" },
        "sourcePath": format!("runtime/materials/{}", material.id.0),
        "materialTypeId": material.material_type_id,
        "colorRgb": material.color_rgb,
        "metallic": material.metallic,
        "smooth": material.smooth,
        "emissive": material.emissive,
        "surfaceTransmission": material.surface_transmission,
        "absorptionLength": material.absorption_length,
        "scatterLength": material.scatter_length,
        "indexOfRefraction": material.index_of_refraction,
        "phase": material.phase,
        "strength": material.strength,
        "defaultVoxel": voxel_material_name(material.default_voxel),
    })
}

fn material_id_string(id: MaterialId) -> String {
    format!("mat-{}", id.0)
}

fn parse_material_id(raw: &str) -> Option<MaterialId> {
    if let Some(value) = raw
        .strip_prefix("mat-")
        .and_then(|id| id.parse::<u16>().ok())
    {
        return Some(MaterialId(value));
    }

    match raw {
        "mat-air" | "mat-air-block" => Some(MaterialId(0)),
        "mat-grass-block" | "grass" | "topSoil" => Some(MaterialId(1)),
        "mat-dirt-block" | "dirt" | "subSoil" => Some(MaterialId(2)),
        "mat-rock-block" | "rock" => Some(MaterialId(3)),
        "mat-bedrock-block" | "bedrock" => Some(MaterialId(4)),
        "mat-sand-block" | "sand" => Some(MaterialId(5)),
        "mat-clay-block" | "clay" => Some(MaterialId(6)),
        "mat-water-surface" | "water" => Some(MaterialId(7)),
        "mat-wood-block" | "wood" => Some(MaterialId(8)),
        "mat-leaves-block" | "leaves" => Some(MaterialId(9)),
        "mat-dungeon-wall" | "dungeonWall" => Some(MaterialId(10)),
        "mat-dungeon-floor" | "dungeonFloor" => Some(MaterialId(11)),
        _ => None,
    }
}

fn parse_chunk_id(chunk_id: &str) -> Option<IVec3> {
    let rest = chunk_id.strip_prefix("chunk-")?;
    let parts: Vec<_> = rest.split('-').collect();
    match parts.as_slice() {
        [x, z] => Some(IVec3::new(x.parse().ok()?, 0, z.parse().ok()?)),
        [x, y, z] => Some(IVec3::new(
            x.parse().ok()?,
            y.parse().ok()?,
            z.parse().ok()?,
        )),
        _ => None,
    }
}

fn parse_water_body_id(water_body_id: &str) -> Option<WaterBodyId> {
    let raw = water_body_id
        .strip_prefix("water-body-")
        .unwrap_or(water_body_id);
    let id = raw.parse::<u32>().ok()?;
    Some(WaterBodyId(id))
}

fn validate_water_body_patch(patch: &FrontendWaterBodyPatch, errors: &mut Vec<String>) {
    for (field, value) in [
        ("reflectionStrength", patch.reflection_strength),
        ("fresnelPower", patch.fresnel_power),
        ("distortionStrength", patch.distortion_strength),
    ] {
        if let Some(value) = value {
            if !value.is_finite() || value < 0.0 {
                errors.push(format!("{field} must be a finite non-negative number."));
            }
        }
    }
}

fn debug_mode_to_frontend(mode: WaterReflectionDebugViewMode) -> &'static str {
    match mode {
        WaterReflectionDebugViewMode::Off => "Off",
        WaterReflectionDebugViewMode::Mask => "Mask",
        WaterReflectionDebugViewMode::ReflectionOnly => "ReflectionOnly",
        WaterReflectionDebugViewMode::BlendFactor => "BlendFactor",
    }
}

fn water_kind_to_frontend(kind: WaterBodyKind) -> &'static str {
    match kind {
        WaterBodyKind::Ocean => "Ocean",
        WaterBodyKind::Lake => "Lake",
        WaterBodyKind::River => "River",
        WaterBodyKind::Pond => "Pond",
        WaterBodyKind::ShallowFlood | WaterBodyKind::Unknown => "Unknown",
    }
}

fn material_mode_to_frontend(mode: WaterBodyMaterialMode) -> &'static str {
    match mode {
        WaterBodyMaterialMode::Fancy => "Fancy",
        WaterBodyMaterialMode::Cheap => "Cheap",
        WaterBodyMaterialMode::Hidden => "Hidden",
        WaterBodyMaterialMode::Unknown => "Unknown",
    }
}

fn timestamp_string() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("unix-ms-{millis}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::MIN_BREAKABLE_Y;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::plugin::WaterBodyInfo;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn valid_mapping() -> FrontendAtlasMapping {
        FrontendAtlasMapping {
            grass: FrontendAtlasFaceMapping {
                top: "tile-3".to_string(),
                side: "tile-7".to_string(),
                bottom: "tile-0".to_string(),
            },
            dirt: FrontendAtlasFaceMapping {
                top: "tile-0".to_string(),
                side: "tile-0".to_string(),
                bottom: "tile-0".to_string(),
            },
            rock: FrontendAtlasFaceMapping {
                top: "tile-1".to_string(),
                side: "tile-1".to_string(),
                bottom: "tile-1".to_string(),
            },
            sand: FrontendAtlasFaceMapping {
                top: "tile-4".to_string(),
                side: "tile-4".to_string(),
                bottom: "tile-4".to_string(),
            },
        }
    }

    #[test]
    fn validates_atlas_tile_bounds() {
        let mut mapping = valid_mapping();
        mapping.grass.top = "tile-64".to_string();

        let result =
            validate_runtime_write_command(&RuntimeWriteCommand::SetAtlasMapping { mapping });

        assert!(result.is_err());
        assert!(result.unwrap_err()[0].contains("grass.top"));
    }

    #[test]
    fn parses_chunk_ids_for_frontend_forms() {
        assert_eq!(parse_chunk_id("chunk-1-2"), Some(IVec3::new(1, 0, 2)));
        assert_eq!(parse_chunk_id("chunk-1-2-3"), Some(IVec3::new(1, 2, 3)));
        assert_eq!(parse_chunk_id("bad-1-2"), None);
    }

    #[test]
    fn decodes_runtime_command_envelope() {
        let value = json!({
            "type": "runtime.setRenderQuality",
            "requestId": "request-1",
            "payload": { "preset": "Performance100" }
        });

        let envelope: RuntimeCommandEnvelope = serde_json::from_value(value).unwrap();
        assert_eq!(envelope.request_id, "request-1");
        assert!(matches!(
            envelope.command,
            RuntimeWriteCommand::SetRenderQuality {
                preset: FrontendRenderQualityPreset::Performance100
            }
        ));
    }

    #[test]
    fn decodes_runtime_render_feature_flag_command() {
        let value = json!({
            "type": "runtime.setRenderFeatureFlag",
            "requestId": "request-feature",
            "payload": { "feature": "bakedAo", "enabled": true, "value": 0.35 }
        });

        let envelope: RuntimeCommandEnvelope = serde_json::from_value(value).unwrap();
        assert_eq!(envelope.request_id, "request-feature");
        assert!(matches!(
            envelope.command,
            RuntimeWriteCommand::SetRenderFeatureFlag {
                feature: FrontendRenderFeatureFlag::BakedAo,
                enabled: true,
                value: Some(value)
            } if (value - 0.35).abs() < f32::EPSILON
        ));
    }

    #[test]
    fn terrain_texturing_command_updates_runtime_metrics() {
        let mut world = World::new();
        world.insert_resource(TerrainTexturingConfig::default());
        world.insert_resource(RenderQualityPreset::High);
        world.insert_resource(GraphicsCapabilities {
            integrated_gpu: false,
            ..default()
        });

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::UpdateTerrainTexturing {
                patch: TerrainTexturingPatch {
                    hex_tiling: Some(HexTilingPatch {
                        enabled: Some(true),
                        normal_enabled: Some(true),
                    }),
                },
            },
        );

        assert!(matches!(result, RuntimeCommandResult::Success { .. }));
        let config = world.resource::<TerrainTexturingConfig>();
        assert!(config.hex_tiling.enabled);
        assert!(config.hex_tiling.normal_enabled);
    }

    #[test]
    fn light_preset_wins_over_conflicting_explicit_fields() {
        let mut world = World::new();
        world.insert_resource(AtmosphereSettings::default());
        world.insert_resource(LightAtmospherePresetState::default());

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::UpdateLightAtmosphere {
                patch: LightAtmospherePatch {
                    light_preset: Some(LightPreset::NoneEmissivesOnly),
                    light_illuminance: Some(5000.0),
                    ..default()
                },
            },
        );

        assert!(matches!(result, RuntimeCommandResult::Success { .. }));
        let settings = world.resource::<AtmosphereSettings>();
        assert!(!settings.light_enabled);
        assert_eq!(settings.light_illuminance, 0.0);
        assert_eq!(
            world.resource::<LightAtmospherePresetState>().light_preset,
            LightPreset::NoneEmissivesOnly
        );
    }

    #[test]
    fn sun_light_preset_uses_shared_editor_illuminance_default() {
        let mut settings = AtmosphereSettings {
            light_illuminance: 100_000.0,
            ..default()
        };

        apply_light_preset(&mut settings, LightPreset::Sun);

        assert_eq!(settings.light_illuminance, DEFAULT_SUN_ILLUMINANCE);
    }

    #[test]
    fn neutral_global_preset_does_not_force_naadf_bright_sun() {
        let mut settings = AtmosphereSettings::default();

        apply_global_light_atmosphere_preset(&mut settings, GlobalLightAtmospherePreset::Neutral);

        assert_eq!(settings.light_illuminance, DEFAULT_SUN_ILLUMINANCE);
        assert_eq!(settings.atmosphere_amount, 0.0);
    }

    #[test]
    fn global_default_preserves_cycle_timing_fields() {
        let mut world = World::new();
        world.insert_resource(AtmosphereSettings {
            cycle_enabled: true,
            day_length: 42.0,
            time: 17.0,
            time_scale: 3.0,
            twilight_band: 0.22,
            ..default()
        });
        world.insert_resource(LightAtmospherePresetState::default());

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::UpdateLightAtmosphere {
                patch: LightAtmospherePatch {
                    global_preset: Some(GlobalLightAtmospherePreset::Default),
                    ..default()
                },
            },
        );

        assert!(matches!(result, RuntimeCommandResult::Success { .. }));
        let settings = world.resource::<AtmosphereSettings>();
        assert!(settings.cycle_enabled);
        assert_eq!(settings.day_length, 42.0);
        assert_eq!(settings.time, 17.0);
        assert_eq!(settings.time_scale, 3.0);
        assert_eq!(settings.twilight_band, 0.22);
    }

    #[test]
    fn render_feature_command_updates_runtime_metrics() {
        let mut world = World::new();
        world.insert_resource(crate::rendering::ao_config::AmbientOcclusionConfig::default());

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::SetRenderFeatureFlag {
                feature: FrontendRenderFeatureFlag::BakedAo,
                enabled: true,
                value: Some(0.35),
            },
        );

        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("render feature command should succeed");
        };
        assert_eq!(data["feature"], json!("bakedAo"));
        assert_eq!(data["enabled"], json!(true));
        let strength = data["metrics"]["ambientOcclusion"]["bakedAoStrength"]
            .as_f64()
            .unwrap();
        assert!((strength - 0.35).abs() < 0.0001);

        let RuntimeCommandResult::Success { data, .. } = runtime_snapshot_json(&mut world) else {
            panic!("runtime snapshot should succeed");
        };
        let strength = data["metrics"]["ambientOcclusion"]["bakedAoStrength"]
            .as_f64()
            .unwrap();
        assert!((strength - 0.35).abs() < 0.0001);
    }

    #[test]
    fn shadow_budget_command_updates_runtime_metrics() {
        let mut world = World::new();
        world.insert_resource(crate::rendering::shadow_budget::ShadowBudgetConfig::default());

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::SetRenderFeatureFlag {
                feature: FrontendRenderFeatureFlag::ShadowBudget,
                enabled: false,
                value: None,
            },
        );

        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("shadow budget command should succeed");
        };
        assert_eq!(data["feature"], json!("shadowBudget"));
        assert_eq!(data["enabled"], json!(false));
        assert_eq!(data["metrics"]["shadowBudget"]["enabled"], json!(false));

        let RuntimeCommandResult::Success { data, .. } = runtime_snapshot_json(&mut world) else {
            panic!("runtime snapshot should succeed");
        };
        assert_eq!(data["metrics"]["shadowBudget"]["enabled"], json!(false));
    }

    #[test]
    fn ray_tracing_command_updates_runtime_metrics() {
        let mut world = World::new();
        world.insert_resource(crate::rendering::ray_tracing::RayTracingSettings::default());

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::SetRenderFeatureFlag {
                feature: FrontendRenderFeatureFlag::RayTracing,
                enabled: true,
                value: None,
            },
        );

        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("ray tracing command should succeed");
        };
        assert_eq!(data["feature"], json!("rayTracing"));
        assert_eq!(data["enabled"], json!(true));
        assert_eq!(
            data["metrics"]["graphicsCapabilities"]["rayTracingEnabled"],
            json!(true)
        );

        let RuntimeCommandResult::Success { data, .. } = runtime_snapshot_json(&mut world) else {
            panic!("runtime snapshot should succeed");
        };
        assert_eq!(
            data["metrics"]["graphicsCapabilities"]["rayTracingEnabled"],
            json!(true)
        );
    }

    #[test]
    fn cinematic_photo_commands_update_runtime_metrics() {
        let mut world = World::new();
        world.insert_resource(crate::rendering::photo_mode::PhotoModeState::default());
        world.insert_resource(crate::rendering::cinematic::CinematicState::default());
        world.insert_resource(crate::rendering::cinematic_config::CinematicConfig::default());

        let photo_result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::SetRenderFeatureFlag {
                feature: FrontendRenderFeatureFlag::PhotoMode,
                enabled: true,
                value: None,
            },
        );
        let RuntimeCommandResult::Success { data, .. } = photo_result else {
            panic!("photo mode command should succeed");
        };
        assert_eq!(
            data["metrics"]["cinematicPhotoMode"]["photoModeActive"],
            json!(true)
        );

        let cinematic_result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::SetRenderFeatureFlag {
                feature: FrontendRenderFeatureFlag::CinematicMode,
                enabled: true,
                value: None,
            },
        );
        let RuntimeCommandResult::Success { data, .. } = cinematic_result else {
            panic!("cinematic command should succeed");
        };
        assert_eq!(
            data["metrics"]["cinematicPhotoMode"]["cinematicModeActive"],
            json!(true)
        );

        let RuntimeCommandResult::Success { data, .. } = runtime_snapshot_json(&mut world) else {
            panic!("runtime snapshot should succeed");
        };
        assert_eq!(
            data["metrics"]["cinematicPhotoMode"]["photoModeActive"],
            json!(true)
        );
        assert_eq!(
            data["metrics"]["cinematicPhotoMode"]["cinematicModeActive"],
            json!(true)
        );
    }

    #[test]
    fn runtime_snapshot_includes_targeted_voxel_selection() {
        let mut world = World::new();
        world.insert_resource(TargetedBlock {
            position: Some(IVec3::new(17, 18, 33)),
            normal: Some(IVec3::Y),
            voxel_type: Some(VoxelType::Rock),
        });

        let RuntimeCommandResult::Success { data, .. } = runtime_snapshot_json(&mut world) else {
            panic!("runtime snapshot should succeed");
        };

        assert_eq!(data["targetedVoxel"], json!([17, 18, 33]));
        assert_eq!(data["selection"]["kind"], "voxel");
        assert_eq!(data["selection"]["chunkId"], "chunk-1-1-2");
        assert_eq!(data["selection"]["label"], "Rock (17, 18, 33)");
    }

    #[test]
    fn validates_focus_camera_targets() {
        assert!(
            validate_runtime_write_command(&RuntimeWriteCommand::FocusCamera {
                target: json!({ "kind": "chunk", "id": "chunk-1-2-3", "label": "Chunk 1,2,3" })
            })
            .is_ok()
        );

        assert!(
            validate_runtime_write_command(&RuntimeWriteCommand::FocusCamera {
                target: json!({ "kind": "prop", "id": "prop-1", "label": "Prop 1" })
            })
            .is_err()
        );
    }

    #[test]
    fn editor_camera_sidecar_path_stays_beside_world_file() {
        assert_eq!(
            editor_camera_sidecar_path("world_data.bin"),
            PathBuf::from("world_data.cameras.json")
        );
        assert_eq!(
            editor_camera_sidecar_path("saves/custom-world.bin"),
            PathBuf::from("saves/custom-world.cameras.json")
        );
        assert_eq!(
            editor_camera_sidecar_path("uploaded-world"),
            PathBuf::from("uploaded-world.cameras.json")
        );
    }

    #[test]
    fn decodes_runtime_save_world_snapshot_command() {
        let value = json!({
            "type": "runtime.saveWorldSnapshot",
            "requestId": "request-save",
            "payload": { "reason": "manual" }
        });

        let envelope: RuntimeCommandEnvelope = serde_json::from_value(value).unwrap();
        assert_eq!(envelope.request_id, "request-save");
        assert!(matches!(
            envelope.command,
            RuntimeWriteCommand::SaveWorldSnapshot {
                reason: Some(reason)
            } if reason == "manual"
        ));
    }

    #[test]
    fn viewport_debug_overlay_command_updates_snapshot() {
        let mut world = World::new();
        world.insert_resource(RuntimeViewportDebugState::default());

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::SetViewportDebugOverlay {
                overlay: FrontendViewportDebugOverlay::Wireframe,
                enabled: true,
            },
        );

        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("viewport debug overlay command should succeed");
        };
        assert_eq!(data["wireframe"], json!(true));

        let RuntimeCommandResult::Success { data, .. } = runtime_snapshot_json(&mut world) else {
            panic!("runtime snapshot should succeed");
        };
        assert_eq!(data["viewportDebug"]["wireframe"], json!(true));
    }

    #[test]
    fn set_voxel_runtime_command_mutates_voxel_world() {
        let mut world = World::new();
        let mut voxel_world = VoxelWorld::new(IVec3::new(1, 1, 1));
        voxel_world.insert_chunk(Chunk::new(IVec3::ZERO));
        world.insert_resource(voxel_world);

        let position = IVec3::new(3, MIN_BREAKABLE_Y, 4);
        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::SetVoxel {
                position: [position.x, position.y, position.z],
                block: FrontendVoxelBlock::Rock,
            },
        );

        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("set voxel command should succeed");
        };
        assert_eq!(
            data["position"],
            json!([position.x, position.y, position.z])
        );
        assert_eq!(data["chunkId"], json!("chunk-0-0-0"));
        assert_eq!(data["block"], json!("rock"));
        assert_eq!(data["currentVoxel"], json!("Rock"));
        assert_eq!(data["editResult"], json!("applied"));
        assert_eq!(
            world.resource::<VoxelWorld>().get_voxel(position),
            Some(VoxelType::Rock)
        );
    }

    #[test]
    fn apply_voxel_brush_expands_box_and_reports_dirty_chunks() {
        let mut world = World::new();
        let mut voxel_world = VoxelWorld::new(IVec3::new(1, 1, 1));
        voxel_world.insert_chunk(Chunk::new(IVec3::ZERO));
        world.insert_resource(voxel_world);

        let position = [4, MIN_BREAKABLE_Y, 4];
        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::ApplyVoxelBrush {
                brush: FrontendVoxelBrush {
                    position,
                    action: FrontendVoxelBrushAction::Set,
                    shape: FrontendVoxelBrushShape::Box,
                    block: FrontendVoxelBlock::Wood,
                    radius: 1,
                    size: [3, 1, 3],
                    mask: FrontendVoxelBrushMask::Any,
                    mask_block: None,
                    include_results: false,
                },
            },
        );

        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("brush command should succeed");
        };
        assert_eq!(data["changedCount"], json!(9));
        assert_eq!(data["rejectedCount"], json!(0));
        assert_eq!(data["results"], json!([]));
        assert_eq!(data["sampledResult"]["editResult"], json!("applied"));
        assert_eq!(data["dirtyChunkIds"], json!(["chunk-0-0-0"]));
        assert_eq!(
            world.resource::<VoxelWorld>().get_voxel(IVec3::new(
                position[0],
                position[1],
                position[2]
            )),
            Some(VoxelType::Wood)
        );
    }

    #[test]
    fn apply_voxel_brush_filters_by_mask_material() {
        let mut world = World::new();
        let mut voxel_world = VoxelWorld::new(IVec3::new(1, 1, 1));
        voxel_world.insert_chunk(Chunk::new(IVec3::ZERO));
        let center = IVec3::new(6, MIN_BREAKABLE_Y, 6);
        voxel_world.set_voxel(center, VoxelType::Sand);
        voxel_world.set_voxel(center + IVec3::X, VoxelType::Rock);
        world.insert_resource(voxel_world);

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::ApplyVoxelBrush {
                brush: FrontendVoxelBrush {
                    position: [center.x, center.y, center.z],
                    action: FrontendVoxelBrushAction::Paint,
                    shape: FrontendVoxelBrushShape::Box,
                    block: FrontendVoxelBlock::Clay,
                    radius: 1,
                    size: [3, 1, 1],
                    mask: FrontendVoxelBrushMask::Material,
                    mask_block: Some(FrontendVoxelBlock::Sand),
                    include_results: false,
                },
            },
        );

        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("brush command should succeed");
        };
        assert_eq!(data["changedCount"], json!(1));
        assert_eq!(data["skippedCount"], json!(2));
        assert_eq!(data["results"], json!([]));
        assert_eq!(data["sampledResult"]["editResult"], json!("applied"));
        let voxel_world = world.resource::<VoxelWorld>();
        assert_eq!(voxel_world.get_voxel(center), Some(VoxelType::Clay));
        assert_eq!(
            voxel_world.get_voxel(center + IVec3::X),
            Some(VoxelType::Rock)
        );
    }

    #[test]
    fn apply_voxel_brush_rejects_bedrock_and_protected_area() {
        let mut world = World::new();
        let mut voxel_world = VoxelWorld::new(IVec3::new(1, 1, 1));
        voxel_world.insert_chunk(Chunk::new(IVec3::ZERO));
        world.insert_resource(voxel_world);

        let protected_position = IVec3::new(8, MIN_BREAKABLE_Y, 8);
        let mut registry = ProtectedAreaRegistry::default();
        registry
            .upsert(ProtectedArea {
                id: crate::world_rules::ProtectedAreaId("brush-test-area".to_string()),
                name: "Brush Test Area".to_string(),
                kind: crate::world_rules::ProtectedAreaKind::NoBuild,
                shape: crate::world_rules::ProtectedAreaShape::Box,
                priority: 10,
                locked: false,
                color: "#ff0000".to_string(),
                center: [
                    protected_position.x as f32 + 0.5,
                    protected_position.y as f32 + 0.5,
                    protected_position.z as f32 + 0.5,
                ],
                size: [3.0, 3.0, 3.0],
                bounds: crate::world_rules::ProtectedAreaBounds {
                    min: [
                        protected_position.x as f32 - 1.0,
                        protected_position.y as f32 - 1.0,
                        protected_position.z as f32 - 1.0,
                    ],
                    max: [
                        protected_position.x as f32 + 2.0,
                        protected_position.y as f32 + 2.0,
                        protected_position.z as f32 + 2.0,
                    ],
                },
                rules: crate::world_rules::ProtectedAreaRuleMatrix::ALLOW_ALL,
                chunks: Vec::new(),
                schema_version: crate::world_rules::WORLD_RULES_SCHEMA_VERSION,
                debug_label: None,
            })
            .unwrap();
        world.insert_resource(registry);

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::ApplyVoxelBrush {
                brush: FrontendVoxelBrush {
                    position: [
                        protected_position.x,
                        protected_position.y,
                        protected_position.z,
                    ],
                    action: FrontendVoxelBrushAction::Set,
                    shape: FrontendVoxelBrushShape::Single,
                    block: FrontendVoxelBlock::Rock,
                    radius: 1,
                    size: [1, 1, 1],
                    mask: FrontendVoxelBrushMask::Any,
                    mask_block: None,
                    include_results: true,
                },
            },
        );
        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("protected brush command should return aggregate result");
        };
        assert_eq!(data["rejectedCount"], json!(1));
        assert_eq!(
            data["results"][0]["editResult"],
            json!("rejectedProtectedArea")
        );

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::ApplyVoxelBrush {
                brush: FrontendVoxelBrush {
                    position: [2, crate::constants::BEDROCK_DEPTH, 2],
                    action: FrontendVoxelBrushAction::Delete,
                    shape: FrontendVoxelBrushShape::Single,
                    block: FrontendVoxelBlock::Rock,
                    radius: 1,
                    size: [1, 1, 1],
                    mask: FrontendVoxelBrushMask::Any,
                    mask_block: None,
                    include_results: true,
                },
            },
        );
        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("bedrock brush command should return aggregate result");
        };
        assert_eq!(data["rejectedCount"], json!(1));
        assert_eq!(
            data["results"][0]["editResult"],
            json!("rejectedUnbreakable")
        );
    }

    #[test]
    fn prop_scatter_and_remove_commands_mutate_runtime_entities() {
        let mut world = World::new();
        let mut scenes = HashMap::new();
        scenes.insert("oak_tree".to_string(), Handle::<Scene>::default());
        world.insert_resource(PropAssets {
            scenes,
            loaded: true,
        });

        let prop = json!({
            "id": "prop-editor-1",
            "assetId": "oak_tree",
            "name": "Oak Tree 001",
            "type": "tree",
            "category": "tree",
            "position": [4.0, 8.0, 12.0],
            "transform": {
                "position": [4.0, 8.0, 12.0],
                "rotation": [0.0, 45.0, 0.0],
                "scale": [1.0, 1.0, 1.0]
            }
        });

        let scatter = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::ScatterProps { props: vec![prop] },
        );
        let RuntimeCommandResult::Success { data, .. } = scatter else {
            panic!("prop scatter should succeed");
        };
        assert_eq!(data["props"].as_array().unwrap().len(), 1);
        assert_eq!(data["propStats"]["totalInstances"], json!(1));

        let remove = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::RemoveProps {
                prop_ids: vec!["prop-editor-1".to_string()],
                chunk_id: None,
            },
        );
        let RuntimeCommandResult::Success { data, .. } = remove else {
            panic!("prop remove should succeed");
        };
        assert_eq!(data["removedPropIds"], json!(["prop-editor-1"]));
        assert_eq!(data["propStats"]["totalInstances"], json!(0));
    }

    #[test]
    fn update_water_body_runtime_command_mutates_registry() {
        let mut world = World::new();
        let mut registry = WaterBodyRegistry::default();
        registry.bodies.insert(
            WaterBodyId(42),
            WaterBodyInfo {
                id: WaterBodyId(42),
                kind: WaterBodyKind::Lake,
                aabb_min: Vec3::ZERO,
                aabb_max: Vec3::new(16.0, 2.0, 16.0),
                surface_y: 4.0,
                surface_area: 256.0,
                max_depth: 3,
                average_depth: 1.5,
                nearest_distance: 10.0,
                visible_chunks: 1,
                chunk_count: 1,
                material_mode: WaterBodyMaterialMode::Fancy,
                reflection_strength: 0.76,
                fresnel_power: 4.5,
                distortion_strength: 0.0045,
            },
        );
        registry.recount();
        world.insert_resource(registry);

        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::UpdateWaterBody {
                water_body_id: "water-body-42".to_string(),
                patch: FrontendWaterBodyPatch {
                    kind: Some(FrontendWaterBodyKind::River),
                    reflection_strength: Some(0.81),
                    fresnel_power: Some(3.7),
                    distortion_strength: Some(0.16),
                },
            },
        );

        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("update water body command should succeed");
        };
        assert_eq!(data["waterBody"]["id"], json!("water-body-42"));
        assert_eq!(data["waterBody"]["kind"], json!("River"));
        let reflection_strength = data["waterBody"]["reflectionStrength"].as_f64().unwrap();
        assert!((reflection_strength - 0.81).abs() < 0.0001);

        let registry = world.resource::<WaterBodyRegistry>();
        let body = registry.bodies.get(&WaterBodyId(42)).unwrap();
        assert_eq!(body.kind, WaterBodyKind::River);
        assert_eq!(registry.river, 1);
        assert_eq!(registry.lake, 0);
    }

    #[test]
    fn validates_protected_area_command_payloads() {
        let area = ProtectedArea {
            id: crate::world_rules::ProtectedAreaId("area-1".to_string()),
            name: "Area 1".to_string(),
            kind: crate::world_rules::ProtectedAreaKind::NoBuild,
            shape: crate::world_rules::ProtectedAreaShape::Box,
            priority: 1,
            locked: false,
            color: "#22d3ee".to_string(),
            center: [4.0, 4.0, 4.0],
            size: [8.0, 8.0, 8.0],
            bounds: crate::world_rules::ProtectedAreaBounds {
                min: [0.0, 0.0, 0.0],
                max: [8.0, 8.0, 8.0],
            },
            rules: crate::world_rules::ProtectedAreaRuleMatrix::ALLOW_ALL,
            chunks: Vec::new(),
            schema_version: crate::world_rules::WORLD_RULES_SCHEMA_VERSION,
            debug_label: None,
        };

        assert!(
            validate_runtime_write_command(&RuntimeWriteCommand::CreateProtectedArea { area })
                .is_ok()
        );
        assert!(
            validate_runtime_write_command(&RuntimeWriteCommand::DeleteProtectedArea {
                area_id: String::new()
            })
            .is_err()
        );
    }

    fn terrain_preview_request(seed: i32, resolution: u32) -> TerrainPreviewRequest {
        TerrainPreviewRequest {
            recipe: TerrainRecipe {
                version: 1,
                seed,
                config: TerrainConfig::default(),
            },
            origin: [0, 0],
            size: [128, 128],
            resolution,
        }
    }

    #[test]
    fn terrain_recipe_preview_is_deterministic_for_same_seed() {
        let request = terrain_preview_request(17, 16);
        let first = terrain_preview_payload(&request, BiomeTable::default());
        let second = terrain_preview_payload(&request, BiomeTable::default());

        assert_eq!(first["samples"], second["samples"]);
        assert_eq!(first["stats"], second["stats"]);
    }

    #[test]
    fn terrain_recipe_preview_changes_with_seed() {
        let first =
            terrain_preview_payload(&terrain_preview_request(17, 16), BiomeTable::default());
        let second =
            terrain_preview_payload(&terrain_preview_request(23, 16), BiomeTable::default());

        assert_ne!(first["samples"], second["samples"]);
    }

    #[test]
    fn terrain_recipe_seed_zero_preserves_default_height_samples() {
        let config = TerrainConfig::default();
        let default_generator =
            TerrainGenerator::with_config(ValueNoise::default(), config.clone());
        let seeded_generator =
            TerrainGenerator::with_config_and_seed(ValueNoise::new(0), config, 0);

        for (x, z) in [(0, 0), (32, 64), (128, 96), (255, 17)] {
            assert_eq!(
                default_generator.get_height(x, z),
                seeded_generator.get_height(x, z)
            );
        }
    }

    #[test]
    fn validates_terrain_preview_request_limits() {
        assert!(
            validate_runtime_write_command(&RuntimeWriteCommand::PreviewTerrainRecipe {
                request: terrain_preview_request(0, TERRAIN_PREVIEW_MAX_RESOLUTION + 1)
            })
            .is_err()
        );

        assert!(
            validate_runtime_write_command(&RuntimeWriteCommand::PreviewTerrainRecipe {
                request: terrain_preview_request(0, 16)
            })
            .is_ok()
        );
    }

    #[test]
    fn validates_terrain_preview_recipe_octave_limits() {
        let mut request = terrain_preview_request(0, 16);
        request.recipe.config.detail.octaves = TERRAIN_PREVIEW_MAX_OCTAVES + 1;

        let errors =
            validate_runtime_write_command(&RuntimeWriteCommand::PreviewTerrainRecipe { request })
                .unwrap_err();

        assert!(
            errors
                .iter()
                .any(|error| error.contains("config.detail.octaves"))
        );
    }

    #[test]
    fn validates_terrain_preview_recipe_basin_limits() {
        let mut request = terrain_preview_request(0, 16);
        request.recipe.config.water_bodies.lakes.density = 2.0;
        request.recipe.config.water_bodies.ponds.min_radius = 20.0;
        request.recipe.config.water_bodies.ponds.max_radius = 4.0;

        let errors =
            validate_runtime_write_command(&RuntimeWriteCommand::PreviewTerrainRecipe { request })
                .unwrap_err();

        assert!(errors.iter().any(|error| error.contains("lakes.density")));
        assert!(
            errors
                .iter()
                .any(|error| error.contains("ponds.min_radius"))
        );
    }

    #[test]
    fn default_terrain_recipe_command_returns_rust_config() {
        let mut world = World::new();
        let result = execute_runtime_write_command(
            &mut world,
            RuntimeWriteCommand::GetDefaultTerrainRecipe {},
        );

        let RuntimeCommandResult::Success { data, .. } = result else {
            panic!("default terrain recipe should succeed");
        };
        assert_eq!(data["recipe"]["version"], json!(1));
        assert_eq!(data["recipe"]["seed"], json!(0));
        assert!(data["recipe"]["config"]["height"]["min"].is_number());
        assert!(data["fingerprint"].is_string());
    }
}
