use std::collections::{BTreeSet, HashSet, VecDeque};
use std::fs::{self, File};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use bevy::core_pipeline::prepass::{DepthPrepass, NormalPrepass};
use bevy::pbr::ScreenSpaceAmbientOcclusion;
use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::atmosphere::{FogConfig, FogPreset, FogQuality, FogQualityTier};
use crate::camera::controller::{CameraMode, PlayerCamera};
use crate::constants::CHUNK_SIZE_I32;
use crate::editor_diagnostics::{
    EditorDiagnosticsCategory, EditorDiagnosticsState, normalize_editor_diagnostics_categories,
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
use crate::rendering::gtao::GtaoSettings;
use crate::rendering::photo_mode::PhotoModeState;
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::ray_tracing::RayTracingSettings;
use crate::rendering::shadow_budget::ShadowBudgetConfig;
use crate::rendering::ssao::SsaoSupported;
use crate::rendering::triplanar_material::{
    TerrainMaterialQuality, TriplanarMaterial, TriplanarMaterialHandle,
};
use crate::rendering::water_reflection::{
    WaterPresence, WaterReflectionConfig, WaterReflectionDebugViewMode, WaterReflectionStatus,
};
use crate::rendering::water_visual_probe::WaterVisualDebugState;
use crate::voxel::chunk::MeshDirtyReason;
use crate::voxel::meshing::{ChunkMesh, WaterBodyId, WaterBodyKind, WaterBodyMaterialMode};
use crate::voxel::persistence;
use crate::voxel::plugin::WaterBodyRegistry;
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;
use crate::world_rules::{
    ProtectedArea, ProtectedAreaPatch, ProtectedAreaRegistry, ProtectedEditIntent,
    WORLD_RULES_PATH, validate_protected_area,
};

const ATLAS_TILE_COUNT: u32 = 64;
const EDITOR_PLACED_PROPS_SAVE_PATH: &str = "saves/editor_placed_props.json";

pub struct RuntimeWriteCommandPlugin;

#[derive(Component, Clone, Debug, PartialEq, Eq)]
pub struct EditorPropInstanceId(pub String);

#[derive(Resource, Default)]
struct EditorPlacedProps {
    props: Vec<Value>,
    loaded_from_disk: bool,
}

impl Plugin for RuntimeWriteCommandPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<RuntimeCommandQueue>()
            .init_resource::<RuntimeCommandResults>()
            .init_resource::<RuntimeViewportDebugState>()
            .init_resource::<EditorDiagnosticsState>()
            .init_resource::<EditorPlacedProps>()
            .add_systems(
                Update,
                (
                    load_saved_editor_placed_props,
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
    #[serde(rename = "runtime.setVoxel")]
    SetVoxel {
        position: [i32; 3],
        block: FrontendVoxelBlock,
    },
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrontendVoxelBlock {
    Grass,
    Dirt,
    Rock,
    Sand,
}

impl FrontendVoxelBlock {
    fn as_runtime(self) -> VoxelType {
        match self {
            Self::Grass => VoxelType::TopSoil,
            Self::Dirt => VoxelType::SubSoil,
            Self::Rock => VoxelType::Rock,
            Self::Sand => VoxelType::Sand,
        }
    }

    fn as_frontend_str(self) -> &'static str {
        match self {
            Self::Grass => "grass",
            Self::Dirt => "dirt",
            Self::Rock => "rock",
            Self::Sand => "sand",
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
            "canEditProtectedAreas": true,
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
        "viewportDebug": viewport_debug,
        "editorDiagnostics": editor_diagnostics,
        "propStats": runtime_prop_stats_payload(world),
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
        "chunk" | "area" | "prop" | "water" | "material" | "debug_resource" => {
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
        "chunk" | "area" => target.get("id").and_then(Value::as_str).map(|_| ()),
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
        RuntimeWriteCommand::SetAtlasMapping { mapping }
        | RuntimeWriteCommand::SaveAtlasMapping { mapping } => {
            validate_atlas_mapping(mapping, &mut errors);
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
        RuntimeWriteCommand::SetRenderQuality { .. }
        | RuntimeWriteCommand::SetVoxel { .. }
        | RuntimeWriteCommand::SetViewportDebugOverlay { .. }
        | RuntimeWriteCommand::SetEditorDiagnostics { .. }
        | RuntimeWriteCommand::RunWaterVisualProbe {}
        | RuntimeWriteCommand::SaveProtectedAreas {}
        | RuntimeWriteCommand::LoadProtectedAreas {}
        | RuntimeWriteCommand::SaveWorldSnapshot { .. } => {}
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
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
                RuntimeCommandResult::success(json!({
                    "worldId": "bevy-runtime",
                    "savedAt": timestamp_string(),
                    "snapshotId": "world_data.bin",
                    "savePath": result.save_path,
                    "editorPropCount": editor_prop_count,
                    "editorPropSavePath": editor_prop_save_path,
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

fn set_runtime_voxel(
    world: &mut World,
    position: IVec3,
    block: FrontendVoxelBlock,
) -> Result<Value, String> {
    let voxel = block.as_runtime();
    let registry = world.get_resource::<ProtectedAreaRegistry>().cloned();
    let Some(mut voxel_world) = world.get_resource_mut::<VoxelWorld>() else {
        return Err("VoxelWorld resource is not available.".to_string());
    };

    let previous = voxel_world.get_voxel(position);
    let result = voxel_world.set_voxel_with_rules(
        position,
        voxel,
        ProtectedEditIntent::Paint,
        registry.as_ref(),
    );
    let current = voxel_world.get_voxel(position);

    if result.rejected() {
        return Err(format!(
            "Voxel edit at ({}, {}, {}) was rejected: {}.",
            position.x,
            position.y,
            position.z,
            voxel_edit_result_to_frontend(result)
        ));
    }

    let chunk = VoxelWorld::world_to_chunk(position);
    Ok(json!({
        "position": [position.x, position.y, position.z],
        "chunkId": format!("chunk-{}-{}-{}", chunk.x, chunk.y, chunk.z),
        "block": block.as_frontend_str(),
        "voxel": voxel_material_name(voxel),
        "previousVoxel": previous.map(voxel_material_name),
        "currentVoxel": current.map(voxel_material_name),
        "editResult": voxel_edit_result_to_frontend(result),
    }))
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
        world.insert_resource(RayTracingSettings { enabled });
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
    if enabled && integrated_gpu_ao_disabled(world) {
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

fn gtao_settings_from_config(config: &AmbientOcclusionConfig) -> GtaoSettings {
    let Some(gtao) = config.gtao.as_ref() else {
        return GtaoSettings::default();
    };

    GtaoSettings {
        slice_count: gtao.slice_count,
        steps_per_slice: gtao.steps_per_slice,
        radius: gtao.radius,
        falloff_range: gtao.falloff_range,
        final_value_power: gtao.final_value_power,
        sample_distribution_power: gtao.sample_distribution_power,
        thin_occluder_compensation: gtao.thin_occluder_compensation,
        depth_mip_sampling_offset: gtao.depth_mip_sampling_offset,
        enable_denoise: gtao.denoise.enabled,
        denoise_spatial_radius: gtao.denoise.spatial_radius,
        denoise_temporal_blend: gtao.denoise.temporal_blend,
    }
}

fn set_ssao_enabled(world: &mut World, enabled: bool) -> Result<(), String> {
    if enabled && integrated_gpu_ao_disabled(world) {
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

fn integrated_gpu_ao_disabled(world: &World) -> bool {
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
    let Some((wireframe_handle, restore_handles)) = world
        .get_resource::<TriplanarMaterialHandle>()
        .map(|handles| {
            (
                handles.wireframe_debug_handle.clone(),
                (!enabled).then(|| {
                    (
                        handles.handle.clone(),
                        handles.cheap_handle.clone(),
                        handles.single_projection_far_handle.clone(),
                        handles.atlas_only_debug_handle.clone(),
                    )
                }),
            )
        })
    else {
        return;
    };

    let mut query = world.query::<(&mut MeshMaterial3d<TriplanarMaterial>, &ChunkMesh)>();
    for (mut material, chunk_mesh) in query.iter_mut(world) {
        **material = if enabled {
            wireframe_handle.clone()
        } else if let Some((full, cheap, single_projection_far, atlas_only_debug)) =
            restore_handles.as_ref()
        {
            match chunk_mesh.material_quality {
                TerrainMaterialQuality::FullTriplanar => full.clone(),
                TerrainMaterialQuality::CheapTriplanar => cheap.clone(),
                TerrainMaterialQuality::SingleProjectionFar => single_projection_far.clone(),
                TerrainMaterialQuality::AtlasOnlyDebug => atlas_only_debug.clone(),
                TerrainMaterialQuality::WireframeDebug => full.clone(),
            }
        } else {
            wireframe_handle.clone()
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
            "gtaoTemporalDenoise": gtao.is_some_and(|config| config.denoise.enabled),
            "ssaoSupported": ssao_supported(world),
            "ssaoEnabled": ao.is_some_and(|config| config.ssao.enabled),
            "bakedAoStrength": baked_ao_strength(world),
        },
        "lightingAtmosphere": {
            "sunTimeOfDay": "runtime",
            "fogPreset": fog
                .map(|config| fog_preset_to_frontend(config.current_preset))
                .unwrap_or("Runtime"),
            "fogActive": render_feature_enabled(world, FrontendRenderFeatureFlag::Fog),
            "godRaysEnabled": god_rays
                .map(|config| config.enabled)
                .or_else(|| fog.map(|config| config.screen_god_rays.enabled))
                .unwrap_or(false),
            "godRayIntensity": god_rays
                .map(|config| config.intensity)
                .or_else(|| fog.map(|config| config.screen_god_rays.intensity))
                .unwrap_or(0.0),
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
}
