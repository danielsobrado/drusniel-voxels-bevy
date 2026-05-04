use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::rendering::array_loader::{AtlasMapping, BlockAtlasMap};
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::water_reflection::{
    WaterPresence, WaterReflectionConfig, WaterReflectionDebugViewMode, WaterReflectionStatus,
};
use crate::rendering::water_visual_probe::WaterVisualDebugState;
use crate::voxel::chunk::MeshDirtyReason;
use crate::voxel::meshing::{WaterBodyKind, WaterBodyMaterialMode};
use crate::voxel::world::VoxelWorld;
use crate::world_rules::{
    ProtectedArea, ProtectedAreaPatch, ProtectedAreaRegistry, WORLD_RULES_PATH,
    validate_protected_area,
};

const ATLAS_TILE_COUNT: u32 = 64;

pub struct RuntimeWriteCommandPlugin;

impl Plugin for RuntimeWriteCommandPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<RuntimeCommandQueue>()
            .init_resource::<RuntimeCommandResults>()
            .add_systems(Update, process_runtime_command_queue);
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
    #[serde(rename = "runtime.setRenderQuality")]
    SetRenderQuality { preset: FrontendRenderQualityPreset },
    #[serde(rename = "runtime.setWaterReflectionDebugMode")]
    SetWaterReflectionDebugMode {
        #[serde(rename = "waterBodyId")]
        water_body_id: String,
        mode: FrontendWaterReflectionDebugViewMode,
    },
    #[serde(rename = "runtime.runWaterVisualProbe")]
    RunWaterVisualProbe {},
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
pub enum FrontendWaterReflectionDebugViewMode {
    Off,
    Mask,
    ReflectionOnly,
    BlendFactor,
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

pub fn validate_runtime_write_command(command: &RuntimeWriteCommand) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    match command {
        RuntimeWriteCommand::SetWaterReflectionDebugMode { water_body_id, .. } => {
            if water_body_id.trim().is_empty() {
                errors.push("waterBodyId is required.".to_string());
            }
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
        | RuntimeWriteCommand::RunWaterVisualProbe {}
        | RuntimeWriteCommand::SaveProtectedAreas {}
        | RuntimeWriteCommand::LoadProtectedAreas {} => {}
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
        RuntimeWriteCommand::RunWaterVisualProbe {} => {
            RuntimeCommandResult::success(water_visual_probe_payload(world))
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
        RuntimeWriteCommand::CreateProtectedArea { area } => {
            let Some(mut registry) = world.get_resource_mut::<ProtectedAreaRegistry>() else {
                return RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    "ProtectedAreaRegistry resource is not available.",
                );
            };

            match registry.upsert(area) {
                Ok(area) => RuntimeCommandResult::success(json!({ "area": area })),
                Err(message) => {
                    RuntimeCommandResult::validation("Runtime command validation failed.", vec![message])
                }
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
                Err(message) => {
                    RuntimeCommandResult::validation("Runtime command validation failed.", vec![message])
                }
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
                Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
            }
        }
        RuntimeWriteCommand::QueryProtectedRulesAtVoxel { voxel } => {
            let Some(registry) = world.get_resource::<ProtectedAreaRegistry>() else {
                return RuntimeCommandResult::failure(
                    RuntimeCommandStatus::Failure,
                    "ProtectedAreaRegistry resource is not available.",
                );
            };
            RuntimeCommandResult::success(json!(registry.query_rules_at_voxel(IVec3::new(
                voxel[0], voxel[1], voxel[2],
            ))))
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
                Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
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
                Err(message) => RuntimeCommandResult::failure(RuntimeCommandStatus::Failure, message),
            }
        }
    }
}

fn mark_chunk_dirty(world: &mut World, chunk_pos: IVec3) -> Result<(), String> {
    let Some(mut voxel_world) = world.get_resource_mut::<VoxelWorld>() else {
        return Err("VoxelWorld resource is not available.".to_string());
    };
    let Some(chunk) = voxel_world.get_chunk_mut(chunk_pos) else {
        return Err(format!("Chunk {chunk_pos:?} does not exist."));
    };

    chunk.mark_dirty_with_reason(MeshDirtyReason::Generation);
    Ok(())
}

fn set_atlas_mapping(world: &mut World, mut mapping: AtlasMapping) {
    mapping.needs_rebuild = true;
    if let Some(mut atlas_mapping) = world.get_resource_mut::<AtlasMapping>() {
        *atlas_mapping = mapping;
    } else {
        world.insert_resource(mapping);
    }
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
