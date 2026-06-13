use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bevy::prelude::*;
use log::warn;
use serde_json::{Value, json};

use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_I32};
use crate::props::{PropConfig, PropDefinition};
use crate::rendering::ao_config::AmbientOcclusionConfig;
use crate::runtime_commands::{
    EditorWorldSavePath, editor_lights_payload, editor_placed_props_payload,
    handle_runtime_command_json, runtime_snapshot_json, save_editor_lights,
    save_editor_placed_props,
};
use crate::terrain::generation::config::terrain_config_fingerprint;
use crate::voxel::chunk::{Chunk, MeshDirtyReason};
use crate::voxel::materials::MaterialCatalog;
use crate::voxel::meshing::{
    MeshData, MeshSettings, WaterBodyKind, WaterBodyMaterialMode, generate_chunk_mesh_with_mode,
};
use crate::voxel::model_io::{VoxelModelFormat, export_world, import_world_data};
use crate::voxel::persistence::{
    self, EditorWorldMetadata, WORLD_SAVE_PATH, WorldData, read_world_data_from_bytes,
};
use crate::voxel::plugin::{
    LodSettings, WaterBodyInfo, WaterBodyRegistry, build_terrain_neighbor_lods,
    effective_terrain_mesh_lod_for_chunk, target_terrain_mesh_mode_for_lod,
};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelWorld, WorldBounds};

const DEFAULT_BRIDGE_ADDR: &str = "127.0.0.1:17777";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct EditorRuntimeBridgePlugin {
    always_on: bool,
}

impl EditorRuntimeBridgePlugin {
    pub fn enabled() -> Self {
        Self { always_on: true }
    }
}

impl Plugin for EditorRuntimeBridgePlugin {
    fn build(&self, app: &mut App) {
        if self.always_on || editor_runtime_bridge_enabled() {
            app.init_resource::<EditorBridgeChannel>()
                .add_systems(Update, service_editor_bridge_requests);
        }
    }
}

#[derive(Resource)]
struct EditorBridgeChannel {
    receiver: Mutex<Receiver<BridgeRequest>>,
}

impl FromWorld for EditorBridgeChannel {
    fn from_world(_world: &mut World) -> Self {
        let (sender, receiver) = mpsc::channel();
        let addr = std::env::var("DRUSNIEL_EDITOR_BRIDGE_ADDR")
            .unwrap_or_else(|_| DEFAULT_BRIDGE_ADDR.to_string());

        thread::Builder::new()
            .name("drusniel-editor-runtime-bridge".to_string())
            .spawn(move || run_bridge_server(addr, sender))
            .expect("failed to start editor runtime bridge thread");

        Self {
            receiver: Mutex::new(receiver),
        }
    }
}

enum BridgeOperation {
    EditorLoadDefaultWorld,
    EditorLoadUploadedWorld(Vec<u8>),
    EditorImportVoxelModel {
        format: VoxelModelFormat,
        bytes: Vec<u8>,
    },
    EditorExportVoxelModel(VoxelModelFormat),
    EditorSaveDefaultWorld,
    EditorWorldSummary,
    EditorViewportSnapshot,
    RuntimeCommand(Value),
    RuntimeSnapshot,
}

struct BridgeRequest {
    operation: BridgeOperation,
    response: Sender<BridgeResponse>,
}

struct BridgeResponse {
    status: u16,
    body: BridgeResponseBody,
}

enum BridgeResponseBody {
    Json(Value),
    Binary {
        content_type: &'static str,
        bytes: Vec<u8>,
    },
}

impl BridgeResponse {
    fn json(status: u16, body: Value) -> Self {
        Self {
            status,
            body: BridgeResponseBody::Json(body),
        }
    }

    fn binary(status: u16, content_type: &'static str, bytes: Vec<u8>) -> Self {
        Self {
            status,
            body: BridgeResponseBody::Binary {
                content_type,
                bytes,
            },
        }
    }
}

fn editor_runtime_bridge_enabled() -> bool {
    matches!(
        std::env::var("DRUSNIEL_EDITOR_BRIDGE").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("on")
    )
}

fn editor_asset_path(relative: &str) -> PathBuf {
    std::env::var_os("DRUSNIEL_EDITOR_ASSET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("assets"))
        .join(relative)
}

fn service_editor_bridge_requests(world: &mut World) {
    let requests = {
        let channel = world.resource::<EditorBridgeChannel>();
        let receiver = channel
            .receiver
            .lock()
            .expect("editor bridge receiver mutex poisoned");
        let mut requests = Vec::new();

        while let Ok(request) = receiver.try_recv() {
            requests.push(request);
        }

        requests
    };

    for request in requests {
        let response = match request.operation {
            BridgeOperation::EditorLoadDefaultWorld => editor_load_default_world_response(world),
            BridgeOperation::EditorLoadUploadedWorld(bytes) => {
                editor_load_uploaded_world_response(world, &bytes)
            }
            BridgeOperation::EditorImportVoxelModel { format, bytes } => {
                editor_import_voxel_model_response(world, format, &bytes)
            }
            BridgeOperation::EditorExportVoxelModel(format) => {
                editor_export_voxel_model_response(world, format)
            }
            BridgeOperation::EditorSaveDefaultWorld => editor_save_default_world_response(world),
            BridgeOperation::EditorWorldSummary => editor_current_world_summary_response(world),
            BridgeOperation::EditorViewportSnapshot => editor_viewport_snapshot_response(world),
            BridgeOperation::RuntimeCommand(payload) => {
                let response = handle_runtime_command_json(world, payload);
                let body = serde_json::to_value(response).unwrap_or_else(|error| {
                    json!({
                        "status": "failure",
                        "ok": false,
                        "message": format!("Failed to serialize runtime command response: {error}"),
                    })
                });

                BridgeResponse::json(200, body)
            }
            BridgeOperation::RuntimeSnapshot => {
                let body =
                    serde_json::to_value(runtime_snapshot_json(world)).unwrap_or_else(|error| {
                        json!({
                            "status": "failure",
                            "ok": false,
                            "message": format!("Failed to serialize runtime snapshot: {error}"),
                        })
                    });

                BridgeResponse::json(200, body)
            }
        };

        let _ = request.response.send(response);
    }
}

fn run_bridge_server(addr: String, sender: Sender<BridgeRequest>) {
    let listener = match TcpListener::bind(&addr) {
        Ok(listener) => listener,
        Err(error) => {
            error!("Failed to bind editor runtime bridge at {addr}: {error}");
            return;
        }
    };

    info!("Editor runtime bridge listening at http://{addr}");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let sender = sender.clone();
                thread::spawn(move || handle_bridge_connection(stream, sender));
            }
            Err(error) => warn!("Editor runtime bridge connection failed: {error}"),
        }
    }
}

fn handle_bridge_connection(mut stream: TcpStream, sender: Sender<BridgeRequest>) {
    let request = match read_http_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            let _ = write_json_response(&mut stream, 400, json!({ "error": error }));
            return;
        }
    };

    if request.method == "OPTIONS" {
        let _ = write_empty_response(&mut stream, 204);
        return;
    }

    if request.method == "GET" && request.path == "/health" {
        let _ = write_json_response(
            &mut stream,
            200,
            json!({ "ok": true, "bridge": "drusniel-runtime" }),
        );
        return;
    }

    if request.method == "GET" && request.path == "/assets/textures/atlas.png" {
        let path = editor_asset_path("textures/atlas.png");
        match fs::read(&path) {
            Ok(bytes) => {
                let _ = write_binary_response(&mut stream, 200, "image/png", &bytes);
            }
            Err(error) => {
                let _ = write_json_response(
                    &mut stream,
                    404,
                    json!({
                        "status": "failure",
                        "ok": false,
                        "message": format!("Texture atlas asset not found at {}: {error}", path.display()),
                    }),
                );
            }
        }
        return;
    }

    let operation = match (request.method.as_str(), request.path.as_str()) {
        ("POST", "/editor/world/load-default") => BridgeOperation::EditorLoadDefaultWorld,
        ("POST", "/editor/world/load-upload") => {
            BridgeOperation::EditorLoadUploadedWorld(request.body)
        }
        ("POST", "/editor/model/import/vox") => BridgeOperation::EditorImportVoxelModel {
            format: VoxelModelFormat::Vox,
            bytes: request.body,
        },
        ("POST", "/editor/model/import/vl32") => BridgeOperation::EditorImportVoxelModel {
            format: VoxelModelFormat::Vl32,
            bytes: request.body,
        },
        ("GET", "/editor/model/export/vox") => {
            BridgeOperation::EditorExportVoxelModel(VoxelModelFormat::Vox)
        }
        ("GET", "/editor/model/export/vl32") => {
            BridgeOperation::EditorExportVoxelModel(VoxelModelFormat::Vl32)
        }
        ("POST", "/editor/world/save-default") => BridgeOperation::EditorSaveDefaultWorld,
        ("GET", "/editor/world/summary") => BridgeOperation::EditorWorldSummary,
        ("GET", "/editor/viewport/snapshot") => BridgeOperation::EditorViewportSnapshot,
        ("POST", "/runtime/command") => match serde_json::from_slice::<Value>(&request.body) {
            Ok(payload) => BridgeOperation::RuntimeCommand(payload),
            Err(error) => {
                let _ = write_json_response(
                    &mut stream,
                    400,
                    json!({
                        "status": "validation_error",
                        "ok": false,
                        "message": format!("Runtime command JSON is invalid: {error}"),
                    }),
                );
                return;
            }
        },
        ("GET", "/runtime/snapshot") => BridgeOperation::RuntimeSnapshot,
        _ => {
            let _ = write_json_response(
                &mut stream,
                404,
                json!({ "status": "unsupported", "ok": false, "message": "Unknown editor runtime bridge route." }),
            );
            return;
        }
    };

    let (response_sender, response_receiver) = mpsc::channel();
    if sender
        .send(BridgeRequest {
            operation,
            response: response_sender,
        })
        .is_err()
    {
        let _ = write_json_response(
            &mut stream,
            503,
            json!({ "status": "runtime_unavailable", "ok": false, "message": "Bevy runtime bridge is unavailable." }),
        );
        return;
    }

    match response_receiver.recv_timeout(REQUEST_TIMEOUT) {
        Ok(response) => match response.body {
            BridgeResponseBody::Json(body) => {
                let _ = write_json_response(&mut stream, response.status, body);
            }
            BridgeResponseBody::Binary {
                content_type,
                bytes,
            } => {
                let _ = write_binary_response(&mut stream, response.status, content_type, &bytes);
            }
        },
        Err(_) => {
            let _ = write_json_response(
                &mut stream,
                504,
                json!({ "status": "runtime_unavailable", "ok": false, "message": "Timed out waiting for Bevy runtime response." }),
            );
        }
    }
}

fn editor_save_default_world_response(world: &World) -> BridgeResponse {
    let Some(voxel_world) = world.get_resource::<VoxelWorld>() else {
        return BridgeResponse::json(
            503,
            json!({
                "ok": false,
                "error": "VoxelWorld resource is not available.",
                "code": "WORLD_UNAVAILABLE",
            }),
        );
    };

    let result = persistence::editor_save_default_world(voxel_world);
    if result.saved {
        let (editor_prop_count, editor_prop_save_path) = match save_editor_placed_props(world) {
            Ok(summary) => summary,
            Err(message) => {
                return BridgeResponse::json(
                    500,
                    json!({
                        "ok": false,
                        "error": message,
                        "code": "EDITOR_PROP_SAVE_FAILED",
                    }),
                );
            }
        };
        let (editor_light_count, editor_light_save_path) = match save_editor_lights(world) {
            Ok(summary) => summary,
            Err(message) => {
                return BridgeResponse::json(
                    500,
                    json!({
                        "ok": false,
                        "error": message,
                        "code": "EDITOR_LIGHT_SAVE_FAILED",
                    }),
                );
            }
        };

        BridgeResponse::json(
            200,
            json!({
                "ok": true,
                "data": {
                    "worldId": result.save_path,
                    "savedAt": timestamp_string(),
                    "editorProps": {
                        "saved": true,
                        "count": editor_prop_count,
                        "savePath": editor_prop_save_path,
                    },
                    "editorLights": {
                        "saved": true,
                        "count": editor_light_count,
                        "savePath": editor_light_save_path,
                    },
                },
            }),
        )
    } else {
        BridgeResponse::json(
            400,
            json!({
                "ok": false,
                "error": result.error_message.unwrap_or_else(|| "Failed to save default world.".to_string()),
                "code": result.error_kind.unwrap_or_else(|| "WORLD_SAVE_FAILED".to_string()),
            }),
        )
    }
}

fn editor_load_default_world_response(world: &mut World) -> BridgeResponse {
    match persistence::read_world_data_from_path(WORLD_SAVE_PATH) {
        Ok(data) => load_world_data_into_runtime(world, data, WORLD_SAVE_PATH.to_string()),
        Err(error) => BridgeResponse::json(
            400,
            json!({
                "ok": false,
                "error": error.to_string(),
                "code": "WORLD_LOAD_FAILED",
            }),
        ),
    }
}

fn editor_load_uploaded_world_response(world: &mut World, bytes: &[u8]) -> BridgeResponse {
    match read_world_data_from_bytes(bytes) {
        Ok(data) => load_world_data_into_runtime(world, data, "uploaded-world".to_string()),
        Err(error) => BridgeResponse::json(
            400,
            json!({
                "ok": false,
                "error": error.to_string(),
                "code": "WORLD_UPLOAD_INVALID",
            }),
        ),
    }
}

fn editor_import_voxel_model_response(
    world: &mut World,
    format: VoxelModelFormat,
    bytes: &[u8],
) -> BridgeResponse {
    match import_world_data(format, bytes) {
        Ok(data) => {
            let save_path = format!("uploaded-model.{}", format.extension());
            load_world_data_into_runtime(world, data, save_path)
        }
        Err(error) => BridgeResponse::json(
            400,
            json!({
                "ok": false,
                "error": error.to_string(),
                "code": "VOXEL_MODEL_IMPORT_FAILED",
            }),
        ),
    }
}

fn editor_export_voxel_model_response(world: &World, format: VoxelModelFormat) -> BridgeResponse {
    let Some(voxel_world) = world.get_resource::<VoxelWorld>() else {
        return BridgeResponse::json(
            503,
            json!({
                "ok": false,
                "error": "VoxelWorld resource is not available.",
                "code": "WORLD_UNAVAILABLE",
            }),
        );
    };

    match export_world(format, voxel_world) {
        Ok(bytes) => BridgeResponse::binary(200, format.content_type(), bytes),
        Err(error) => BridgeResponse::json(
            400,
            json!({
                "ok": false,
                "error": error.to_string(),
                "code": "VOXEL_MODEL_EXPORT_FAILED",
            }),
        ),
    }
}

fn editor_current_world_summary_response(world: &World) -> BridgeResponse {
    match world.get_resource::<VoxelWorld>() {
        Some(voxel_world) => BridgeResponse::json(
            200,
            json!({
                "ok": true,
                "data": frontend_world_summary_from_world(world, voxel_world, "runtime-world"),
            }),
        ),
        None => BridgeResponse::json(
            503,
            json!({
                "ok": false,
                "error": "VoxelWorld resource is not available.",
                "code": "WORLD_UNAVAILABLE",
            }),
        ),
    }
}

fn editor_viewport_snapshot_response(world: &World) -> BridgeResponse {
    match world.get_resource::<VoxelWorld>() {
        Some(voxel_world) => BridgeResponse::json(
            200,
            json!({
                "ok": true,
                "data": viewport_snapshot_from_world(world, voxel_world),
            }),
        ),
        None => BridgeResponse::json(
            503,
            json!({
                "ok": false,
                "error": "VoxelWorld resource is not available.",
                "code": "WORLD_UNAVAILABLE",
            }),
        ),
    }
}

fn load_world_data_into_runtime(
    world: &mut World,
    data: WorldData,
    save_path: String,
) -> BridgeResponse {
    let current_fingerprint = terrain_config_fingerprint();
    if data.terrain_config_fingerprint != current_fingerprint {
        warn!(
            "Editor loading world with terrain fingerprint mismatch: saved {:#018x}, current {:#018x}; next editor save will rewrite the current fingerprint",
            data.terrain_config_fingerprint, current_fingerprint
        );
    }

    despawn_existing_chunk_entities(world);

    let metadata = persistence::editor_world_metadata_from_data_for_bridge(&data, &save_path);
    let mut loaded_world = VoxelWorld::from_data(data);
    loaded_world.mark_all_loaded_chunks_dirty_with_reason(MeshDirtyReason::Generation);

    world.insert_resource(WorldBounds::from_size_chunks(
        loaded_world.world_size_chunks(),
    ));
    world.insert_resource(EditorWorldSavePath(save_path.clone()));
    world.insert_resource(loaded_world);

    let loaded = world
        .get_resource::<VoxelWorld>()
        .expect("loaded VoxelWorld should be present immediately after insertion");

    BridgeResponse::json(
        200,
        json!({
            "ok": true,
            "data": frontend_world_summary_from_metadata_and_world(world, &metadata, loaded),
        }),
    )
}

fn despawn_existing_chunk_entities(world: &mut World) {
    let entities = world
        .get_resource::<VoxelWorld>()
        .map(|voxel_world| {
            voxel_world
                .chunk_entries()
                .flat_map(|(_, chunk)| {
                    [
                        chunk.mesh_entity(),
                        chunk.water_mesh_entity(),
                        chunk.water_mask_mesh_entity(),
                    ]
                })
                .flatten()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    for entity in entities {
        let _ = world.despawn(entity);
    }
}

fn frontend_world_summary_from_world(
    world: &World,
    voxel_world: &VoxelWorld,
    save_path: &str,
) -> Value {
    let data = voxel_world.to_data();
    let metadata = persistence::editor_world_metadata_from_data_for_bridge(&data, save_path);
    frontend_world_summary_from_metadata_and_world(world, &metadata, voxel_world)
}

fn frontend_world_summary_from_metadata_and_world(
    world: &World,
    metadata: &EditorWorldMetadata,
    voxel_world: &VoxelWorld,
) -> Value {
    let summary_chunks = selected_editor_chunks(voxel_world);
    let chunk_previews = chunk_preview_payloads(voxel_world, &summary_chunks);

    json!({
        "worldId": metadata.save_path,
        "name": world_name_from_path(&metadata.save_path),
        "chunkCountTotal": metadata.chunk_count,
        "chunkCountIncluded": summary_chunks.len(),
        "chunks": summary_chunks
            .iter()
            .map(|chunk| chunk_summary_payload(chunk))
            .collect::<Vec<_>>(),
        "protectedAreas": [],
        "waterBodies": frontend_water_bodies_payload(world),
        "lights": editor_lights_payload(world),
        "props": editor_placed_props_payload(world),
        "propAssets": frontend_prop_assets_payload(world),
        "materials": frontend_materials_payload(world),
        "viewport": {
            "chunkSize": CHUNK_SIZE_I32,
            "sampleResolution": CHUNK_SIZE,
            "chunkCountTotal": metadata.chunk_count,
            "chunkCountIncluded": chunk_previews.len(),
            "chunks": chunk_previews,
        },
        "updatedAt": timestamp_string(),
    })
}

fn frontend_prop_assets_payload(world: &World) -> Vec<Value> {
    let Some(config) = world.get_resource::<PropConfig>() else {
        return Vec::new();
    };

    let mut assets = Vec::new();
    append_prop_assets(&mut assets, "tree", &config.props.trees);
    append_prop_assets(&mut assets, "rock", &config.props.rocks);
    append_prop_assets(&mut assets, "bush", &config.props.bushes);
    append_prop_assets(&mut assets, "flower", &config.props.flowers);
    assets
}

fn frontend_materials_payload(world: &World) -> Vec<Value> {
    let catalog = world
        .get_resource::<MaterialCatalog>()
        .cloned()
        .unwrap_or_default();

    catalog
        .materials
        .iter()
        .map(|material| {
            json!({
                "id": format!("mat-{}", material.id.0),
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
        })
        .collect()
}

fn append_prop_assets(
    assets: &mut Vec<Value>,
    prop_type: &'static str,
    definitions: &[PropDefinition],
) {
    for definition in definitions {
        let category = if definition.id.starts_with("building_") {
            "building"
        } else {
            prop_type
        };

        assets.push(json!({
            "id": &definition.id,
            "name": prop_display_name(&definition.id),
            "type": category,
            "category": category,
            "assetPath": format!("assets/{}", definition.path),
            "defaultMaterial": default_prop_material(category),
        }));
    }
}

fn prop_display_name(id: &str) -> String {
    id.split(['_', '-'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn default_prop_material(category: &str) -> &'static str {
    match category {
        "rock" => "mat-rock-block",
        "building" => "mat-village-building",
        _ => "mat-grass-block",
    }
}

fn frontend_water_bodies_payload(world: &World) -> Vec<Value> {
    let Some(registry) = world.get_resource::<WaterBodyRegistry>() else {
        return Vec::new();
    };

    let mut bodies = registry.bodies.values().collect::<Vec<_>>();
    bodies.sort_by_key(|body| body.id.0);
    bodies
        .into_iter()
        .map(frontend_water_body_payload)
        .collect()
}

fn frontend_water_body_payload(body: &WaterBodyInfo) -> Value {
    let center = (body.aabb_min + body.aabb_max) * 0.5;
    let kind = water_body_kind_to_frontend(body.kind);
    let (shallow_color, deep_color) = water_body_colors(body.kind);
    let (wave_amplitude, wave_speed, wave_scale, wave_count) = water_body_wave_defaults(body.kind);
    json!({
        "id": format!("water-body-{}", body.id.0),
        "name": format!("{} {}", water_body_label(body.kind), body.id.0),
        "kind": kind,
        "bodyType": water_body_type(body.kind),
        "center": [center.x, body.surface_y, center.z],
        "surfaceY": body.surface_y,
        "waveAmplitude": wave_amplitude,
        "waveSpeed": wave_speed,
        "waveScale": wave_scale,
        "waveCount": wave_count,
        "reflectionStrength": body.reflection_strength,
        "fresnelPower": body.fresnel_power,
        "distortionStrength": body.distortion_strength,
        "shallowColor": shallow_color,
        "deepColor": deep_color,
        "clarity": water_body_clarity(body.kind),
        "murkiness": water_body_murkiness(body.kind),
        "foamEnabled": matches!(body.kind, WaterBodyKind::Ocean | WaterBodyKind::River),
        "shoreFoam": if matches!(body.kind, WaterBodyKind::Ocean | WaterBodyKind::River) { 0.65 } else { 0.25 },
        "waveCrestFoam": if matches!(body.kind, WaterBodyKind::Ocean | WaterBodyKind::River) { 0.58 } else { 0.2 },
        "baseAlpha": if matches!(body.kind, WaterBodyKind::Ocean) { 0.91 } else { 0.86 },
        "detailNormalIntensity": if matches!(body.kind, WaterBodyKind::River) { 0.66 } else { 0.42 },
        "detailScrollSpeed": if matches!(body.kind, WaterBodyKind::River) { 0.34 } else { 0.18 },
        "reflectionStatus": {
            "active": matches!(body.material_mode, WaterBodyMaterialMode::Fancy),
            "sampleReflection": matches!(body.material_mode, WaterBodyMaterialMode::Fancy),
            "reason": if matches!(body.material_mode, WaterBodyMaterialMode::Hidden) { "no-water" } else { "active" },
            "resolutionScale": 1.0,
            "effectiveHz": 30.0,
            "enabled": !matches!(body.material_mode, WaterBodyMaterialMode::Hidden),
            "debugViewMode": "Off",
            "probeValid": true,
            "lastProbeUpdateMs": 0.0,
        },
    })
}

fn water_body_kind_to_frontend(kind: WaterBodyKind) -> &'static str {
    match kind {
        WaterBodyKind::Ocean => "Ocean",
        WaterBodyKind::Lake => "Lake",
        WaterBodyKind::River => "River",
        WaterBodyKind::Pond | WaterBodyKind::ShallowFlood => "Pond",
        WaterBodyKind::Unknown => "Unknown",
    }
}

fn water_body_label(kind: WaterBodyKind) -> &'static str {
    match kind {
        WaterBodyKind::Ocean => "Ocean",
        WaterBodyKind::Lake => "Lake",
        WaterBodyKind::River => "River",
        WaterBodyKind::Pond => "Pond",
        WaterBodyKind::ShallowFlood => "Shallow Flood",
        WaterBodyKind::Unknown => "Water Body",
    }
}

fn water_body_type(kind: WaterBodyKind) -> &'static str {
    match kind {
        WaterBodyKind::Ocean => "open_ocean",
        WaterBodyKind::Lake => "still_lake",
        WaterBodyKind::River => "fast_current",
        WaterBodyKind::Pond => "slow_eddy",
        WaterBodyKind::ShallowFlood => "shallow_flood",
        WaterBodyKind::Unknown => "unknown",
    }
}

fn water_body_colors(kind: WaterBodyKind) -> (&'static str, &'static str) {
    match kind {
        WaterBodyKind::Ocean => ("#82d8ff", "#0d3d8f"),
        WaterBodyKind::Lake => ("#9ee8ff", "#1d5aa6"),
        WaterBodyKind::River => ("#6bb0ff", "#2b56ad"),
        WaterBodyKind::Pond | WaterBodyKind::ShallowFlood => ("#7ad2ff", "#1f4e97"),
        WaterBodyKind::Unknown => ("#8bdcff", "#214f92"),
    }
}

fn water_body_wave_defaults(kind: WaterBodyKind) -> (f32, f32, f32, u32) {
    match kind {
        WaterBodyKind::Ocean => (0.72, 0.88, 1.7, 12),
        WaterBodyKind::Lake => (0.32, 0.42, 1.05, 5),
        WaterBodyKind::River => (0.64, 1.1, 1.2, 10),
        WaterBodyKind::Pond | WaterBodyKind::ShallowFlood => (0.18, 0.28, 0.9, 3),
        WaterBodyKind::Unknown => (0.3, 0.4, 1.0, 4),
    }
}

fn water_body_clarity(kind: WaterBodyKind) -> f32 {
    match kind {
        WaterBodyKind::Ocean => 0.91,
        WaterBodyKind::Lake => 0.88,
        WaterBodyKind::River => 0.74,
        WaterBodyKind::Pond | WaterBodyKind::ShallowFlood => 0.82,
        WaterBodyKind::Unknown => 0.8,
    }
}

fn water_body_murkiness(kind: WaterBodyKind) -> f32 {
    match kind {
        WaterBodyKind::Ocean => 0.08,
        WaterBodyKind::Lake => 0.04,
        WaterBodyKind::River => 0.22,
        WaterBodyKind::Pond | WaterBodyKind::ShallowFlood => 0.27,
        WaterBodyKind::Unknown => 0.16,
    }
}

const VIEWPORT_MESH_CHUNK_LIMIT: usize = 16;
const VIEWPORT_MESH_VERTEX_LIMIT: usize = 20_000;
const VIEWPORT_EXPOSED_FACE_OFFSETS: [(&str, IVec3); 6] = [
    ("negX", IVec3::new(-1, 0, 0)),
    ("posX", IVec3::new(1, 0, 0)),
    ("negY", IVec3::new(0, -1, 0)),
    ("posY", IVec3::new(0, 1, 0)),
    ("negZ", IVec3::new(0, 0, -1)),
    ("posZ", IVec3::new(0, 0, 1)),
];

fn viewport_snapshot_from_world(world: &World, voxel_world: &VoxelWorld) -> Value {
    let bounds = world
        .get_resource::<WorldBounds>()
        .copied()
        .unwrap_or_else(|| WorldBounds::from_size_chunks(voxel_world.world_size_chunks()));
    let viewport_chunks = selected_editor_chunks(voxel_world);

    json!({
        "protocolVersion": 1,
        "worldId": "runtime-world",
        "chunkSize": CHUNK_SIZE_I32,
        "sampleResolution": CHUNK_SIZE,
        "bounds": {
            "minChunk": [bounds.min_chunk.x, bounds.min_chunk.y, bounds.min_chunk.z],
            "maxChunk": [bounds.max_chunk.x, bounds.max_chunk.y, bounds.max_chunk.z],
            "minWorldY": bounds.min_world_y,
            "maxWorldY": bounds.max_world_y,
            "horizontalMin": [bounds.horizontal_min.x, bounds.horizontal_min.y],
            "horizontalMax": [bounds.horizontal_max.x, bounds.horizontal_max.y],
        },
        "camera": {
            "target": [
                ((bounds.horizontal_min.x + bounds.horizontal_max.x) as f32) * 0.5,
                ((bounds.min_world_y + bounds.max_world_y) as f32) * 0.5,
                ((bounds.horizontal_min.y + bounds.horizontal_max.y) as f32) * 0.5,
            ],
            "distance": (bounds.horizontal_max.x - bounds.horizontal_min.x)
                .max(bounds.horizontal_max.y - bounds.horizontal_min.y)
                .max(CHUNK_SIZE_I32),
        },
        "chunkCountTotal": voxel_world.chunk_entries().count(),
        "chunkCountIncluded": viewport_chunks.len(),
        "chunks": viewport_chunks
            .iter()
            .enumerate()
            .map(|(index, chunk)| {
                let data = chunk.to_data();
                let summary = persistence::editor_chunk_summary_for_bridge(&data);
                let [x, y, z] = summary.position;
                json!({
                    "payloadId": format!("chunk-{x}-{y}-{z}-{}", chunk.dirty_reason_flags()),
                    "chunkId": format!("chunk-{x}-{y}-{z}"),
                    "coordinate": summary.position,
                    "dirty": chunk.is_dirty(),
                    "meshState": if chunk.is_dirty() { "queued" } else { "clean" },
                    "materialStats": {
                        "nonAirVoxels": summary.non_air_voxels,
                        "waterVoxels": summary.water_voxels,
                    },
                    "water": {
                        "voxelCount": summary.water_voxels,
                        "present": summary.water_voxels > 0,
                    },
                    "mesh": chunk_mesh_payload(world, voxel_world, chunk.position(), index),
                    "samples": [],
                    "voxels": chunk_exposed_voxels_from_world(voxel_world, chunk),
                })
            })
            .collect::<Vec<_>>(),
        "generatedAt": timestamp_string(),
    })
}

fn selected_editor_chunks(voxel_world: &VoxelWorld) -> Vec<&Chunk> {
    let mut chunks = voxel_world
        .chunk_entries()
        .filter_map(|(_, chunk)| chunk_has_visible_voxels(chunk).then_some(chunk))
        .collect::<Vec<_>>();
    if chunks.is_empty() {
        chunks = voxel_world
            .chunk_entries()
            .map(|(_, chunk)| chunk)
            .collect::<Vec<_>>();
        chunks.sort_by_key(|chunk| {
            let position = chunk.position();
            (position.x, position.z, position.y)
        });
    }

    chunks
}

fn chunk_has_visible_voxels(chunk: &Chunk) -> bool {
    chunk.iter_solid().next().is_some()
}

fn chunk_preview_payloads(voxel_world: &VoxelWorld, chunks: &[&Chunk]) -> Vec<Value> {
    chunks
        .iter()
        .map(|chunk| {
            let data = chunk.to_data();
            let [x, y, z] = [data.position.x, data.position.y, data.position.z];
            json!({
                "chunkId": format!("chunk-{x}-{y}-{z}"),
                "coordinate": [x, y, z],
                "samples": [],
                "voxels": chunk_exposed_voxels_from_world(voxel_world, chunk),
            })
        })
        .collect()
}

fn chunk_exposed_voxels_from_world(voxel_world: &VoxelWorld, chunk: &Chunk) -> Vec<Value> {
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());
    chunk
        .iter_solid()
        .filter_map(|(local, voxel)| {
            let world_pos = chunk_origin + local.as_ivec3();
            let exposed_faces = VIEWPORT_EXPOSED_FACE_OFFSETS
                .iter()
                .filter_map(|(face, offset)| {
                    let neighbor = voxel_world
                        .sample_voxel_for_terrain_meshing(world_pos + *offset)
                        .terrain_meshing_voxel();
                    let exposed = if voxel == VoxelType::Water {
                        neighbor == VoxelType::Air
                    } else {
                        neighbor.is_transparent()
                    };
                    exposed.then_some(json!(face))
                })
                .collect::<Vec<_>>();

            (!exposed_faces.is_empty()).then(|| {
                json!({
                    "position": [world_pos.x, world_pos.y, world_pos.z],
                    "material": voxel_material_name(voxel),
                    "water": voxel == VoxelType::Water,
                    "exposedFaces": exposed_faces,
                })
            })
        })
        .collect()
}

fn chunk_summary_payload(chunk: &Chunk) -> Value {
    let data = chunk.to_data();
    let summary = persistence::editor_chunk_summary_for_bridge(&data);
    let [x, y, z] = summary.position;
    json!({
        "id": format!("chunk-{x}-{y}-{z}"),
        "label": format!("Chunk {x},{y},{z}"),
        "coordinate": summary.position,
        "blockCount": summary.non_air_voxels,
        "dirty": chunk.is_dirty(),
        "biome": "loaded world",
        "meshStatus": if chunk.is_dirty() { "queued" } else { "clean" },
        "meshMode": "Mesher",
        "vertexCount": 0,
        "triangleCount": 0,
        "waterMeshCount": summary.water_voxels,
        "lodGroup": 0,
    })
}

fn chunk_mesh_payload(
    world: &World,
    voxel_world: &VoxelWorld,
    chunk_pos: IVec3,
    chunk_index: usize,
) -> Value {
    if chunk_index >= VIEWPORT_MESH_CHUNK_LIMIT {
        return json!({
            "included": false,
            "reason": "chunk_limit",
            "terrain": mesh_stats_payload(None),
            "water": mesh_stats_payload(None),
        });
    }

    let Some(chunk) = voxel_world.get_chunk(chunk_pos) else {
        return json!({
            "included": false,
            "reason": "missing_chunk",
            "terrain": mesh_stats_payload(None),
            "water": mesh_stats_payload(None),
        });
    };

    let mesh_settings = world
        .get_resource::<MeshSettings>()
        .copied()
        .unwrap_or_default();
    let lod_settings = world
        .get_resource::<LodSettings>()
        .copied()
        .unwrap_or_default();
    let ao_config = world
        .get_resource::<AmbientOcclusionConfig>()
        .cloned()
        .unwrap_or_default();
    let target_mode =
        target_terrain_mesh_mode_for_lod(chunk.lod_level(), &mesh_settings, &lod_settings);
    let mesh_lod_level =
        effective_terrain_mesh_lod_for_chunk(voxel_world, chunk_pos, &mesh_settings, &lod_settings)
            .unwrap_or_else(|| chunk.lod_level());
    let neighbor_lods =
        build_terrain_neighbor_lods(voxel_world, chunk_pos, &mesh_settings, &lod_settings);

    let mesh_result = generate_chunk_mesh_with_mode(
        chunk,
        voxel_world,
        target_mode,
        mesh_lod_level,
        neighbor_lods,
        &ao_config.baked,
        mesh_settings.water_air_exposure_mode,
    );

    let terrain_too_large = mesh_result.solid.positions.len() > VIEWPORT_MESH_VERTEX_LIMIT;
    let water_too_large = mesh_result.water.positions.len() > VIEWPORT_MESH_VERTEX_LIMIT;

    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos).as_vec3();

    json!({
        "included": !(terrain_too_large || water_too_large),
        "reason": if terrain_too_large || water_too_large { "vertex_limit" } else { "included" },
        "terrain": mesh_buffer_payload(&mesh_result.solid, terrain_too_large, chunk_origin),
        "water": mesh_buffer_payload(&mesh_result.water, water_too_large, chunk_origin),
        "stats": {
            "waterAirBoundariesTotal": mesh_result.water_stats.air_boundaries_total,
            "waterAirBoundariesExposed": mesh_result.water_stats.air_boundaries_exposed,
            "waterAirBoundariesSealed": mesh_result.water_stats.air_boundaries_sealed,
            "waterTrianglesRemovedSealed": mesh_result.water_stats.triangles_removed_sealed,
        },
    })
}

fn mesh_stats_payload(mesh: Option<&MeshData>) -> Value {
    json!({
        "vertexCount": mesh.map(|mesh| mesh.positions.len()).unwrap_or_default(),
        "indexCount": mesh.map(|mesh| mesh.indices.len()).unwrap_or_default(),
        "triangleCount": mesh.map(|mesh| mesh.indices.len() / 3).unwrap_or_default(),
    })
}

fn mesh_buffer_payload(mesh: &MeshData, omit_buffers: bool, chunk_origin: Vec3) -> Value {
    let world_positions = (!omit_buffers).then(|| {
        mesh.positions
            .iter()
            .map(|position| {
                [
                    position[0] + chunk_origin.x,
                    position[1] + chunk_origin.y,
                    position[2] + chunk_origin.z,
                ]
            })
            .collect::<Vec<_>>()
    });

    json!({
        "vertexCount": mesh.positions.len(),
        "indexCount": mesh.indices.len(),
        "triangleCount": mesh.indices.len() / 3,
        "positions": if omit_buffers { Value::Null } else { json!(world_positions) },
        "normals": if omit_buffers { Value::Null } else { json!(mesh.normals) },
        "uvs": if omit_buffers { Value::Null } else { json!(mesh.uvs) },
        "colors": if omit_buffers { Value::Null } else { json!(mesh.colors) },
        "indices": if omit_buffers { Value::Null } else { json!(mesh.indices) },
    })
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

fn world_name_from_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Loaded voxel world")
        .to_string()
}

fn timestamp_string() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    millis.to_string()
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;

    let mut buffer = Vec::new();
    let mut scratch = [0_u8; 1024];
    let header_end;

    loop {
        let read = stream
            .read(&mut scratch)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("Connection closed before request headers completed.".to_string());
        }

        buffer.extend_from_slice(&scratch[..read]);
        if let Some(index) = find_header_end(&buffer) {
            header_end = index;
            break;
        }

        if buffer.len() > 32 * 1024 {
            return Err("Request headers are too large.".to_string());
        }
    }

    let headers = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = headers.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "Missing HTTP request line.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "Missing HTTP method.".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "Missing HTTP path.".to_string())?
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();

    let content_length = lines
        .filter_map(|line| line.split_once(':'))
        .find_map(|(key, value)| {
            key.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);

    let body_start = header_end + 4;
    let mut body = buffer.get(body_start..).unwrap_or_default().to_vec();

    while body.len() < content_length {
        let read = stream
            .read(&mut scratch)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("Connection closed before request body completed.".to_string());
        }
        body.extend_from_slice(&scratch[..read]);
    }

    body.truncate(content_length);

    Ok(HttpRequest { method, path, body })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn write_json_response(stream: &mut TcpStream, status: u16, body: Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(&body)?;
    let reason = status_reason(status);
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: GET,POST,OPTIONS\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(&body)
}

fn write_empty_response(stream: &mut TcpStream, status: u16) -> std::io::Result<()> {
    let reason = status_reason(status);
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: GET,POST,OPTIONS\r\nConnection: close\r\n\r\n"
    )
}

fn write_binary_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let reason = status_reason(status);
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: GET,POST,OPTIONS\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)
}

fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "OK",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::CHUNK_VOLUME;
    use crate::voxel::meshing::WaterBodyId;

    #[test]
    fn world_summary_includes_runtime_water_bodies() {
        let mut world = World::new();
        let mut registry = WaterBodyRegistry::default();
        registry.bodies.insert(
            WaterBodyId(42),
            WaterBodyInfo {
                id: WaterBodyId(42),
                kind: WaterBodyKind::Lake,
                aabb_min: Vec3::new(10.0, 4.0, 20.0),
                aabb_max: Vec3::new(30.0, 6.0, 60.0),
                surface_y: 7.0,
                surface_area: 800.0,
                max_depth: 5,
                average_depth: 2.5,
                nearest_distance: 12.0,
                visible_chunks: 3,
                chunk_count: 4,
                material_mode: WaterBodyMaterialMode::Fancy,
                reflection_strength: 0.76,
                fresnel_power: 4.5,
                distortion_strength: 0.0045,
            },
        );
        world.insert_resource(registry);

        let water_bodies = frontend_water_bodies_payload(&world);

        assert_eq!(water_bodies.len(), 1);
        assert_eq!(water_bodies[0]["id"], json!("water-body-42"));
        assert_eq!(water_bodies[0]["kind"], json!("Lake"));
        assert_eq!(water_bodies[0]["center"], json!([20.0, 7.0, 40.0]));
        let reflection_strength = water_bodies[0]["reflectionStrength"].as_f64().unwrap();
        assert!((reflection_strength - 0.76).abs() < 0.0001);
        assert_eq!(water_bodies[0]["reflectionStatus"]["active"], json!(true));
    }

    #[test]
    fn viewport_exposed_voxels_cover_every_surface_column() {
        let mut voxel_world = VoxelWorld::new(IVec3::new(1, 1, 1));
        let mut voxels = [VoxelType::Air; CHUNK_VOLUME];
        for z in 0..CHUNK_SIZE {
            for x in 0..CHUNK_SIZE {
                voxels[Chunk::index(x, 3, z)] = VoxelType::TopSoil;
            }
        }
        voxel_world.insert_chunk(Chunk::with_voxels(IVec3::ZERO, voxels));

        let chunk = voxel_world.get_chunk(IVec3::ZERO).unwrap();
        let voxels = chunk_exposed_voxels_from_world(&voxel_world, chunk);

        assert_eq!(voxels.len(), CHUNK_SIZE * CHUNK_SIZE);
        assert_eq!(voxels[0]["position"], json!([0, 3, 0]));
        assert_eq!(voxels[1]["position"], json!([1, 3, 0]));
        assert!(
            voxels
                .iter()
                .all(|voxel| voxel["material"] == json!("TopSoil"))
        );
        assert!(voxels.iter().all(|voxel| {
            voxel["exposedFaces"]
                .as_array()
                .unwrap()
                .contains(&json!("posY"))
        }));
    }

    #[test]
    fn viewport_exposed_voxels_hide_shared_faces_and_keep_vertical_chunks() {
        let mut voxel_world = VoxelWorld::new(IVec3::new(1, 2, 1));
        let mut lower_voxels = [VoxelType::Air; CHUNK_VOLUME];
        lower_voxels[Chunk::index(0, 3, 0)] = VoxelType::TopSoil;
        lower_voxels[Chunk::index(1, 3, 0)] = VoxelType::TopSoil;
        let mut upper_voxels = [VoxelType::Air; CHUNK_VOLUME];
        upper_voxels[Chunk::index(0, 10, 0)] = VoxelType::Rock;
        voxel_world.insert_chunk(Chunk::with_voxels(IVec3::ZERO, lower_voxels));
        voxel_world.insert_chunk(Chunk::with_voxels(IVec3::new(0, 1, 0), upper_voxels));

        let selected_chunks = selected_editor_chunks(&voxel_world);
        assert_eq!(selected_chunks.len(), 2);

        let lower_chunk = voxel_world.get_chunk(IVec3::ZERO).unwrap();
        let lower_payload = chunk_exposed_voxels_from_world(&voxel_world, lower_chunk);
        let left = lower_payload
            .iter()
            .find(|voxel| voxel["position"] == json!([0, 3, 0]))
            .unwrap();
        let right = lower_payload
            .iter()
            .find(|voxel| voxel["position"] == json!([1, 3, 0]))
            .unwrap();

        assert!(
            !left["exposedFaces"]
                .as_array()
                .unwrap()
                .contains(&json!("posX"))
        );
        assert!(
            !right["exposedFaces"]
                .as_array()
                .unwrap()
                .contains(&json!("negX"))
        );

        let upper_chunk = voxel_world.get_chunk(IVec3::new(0, 1, 0)).unwrap();
        let upper_payload = chunk_exposed_voxels_from_world(&voxel_world, upper_chunk);
        assert_eq!(
            upper_payload[0]["position"],
            json!([0, CHUNK_SIZE_I32 + 10, 0])
        );
        assert_eq!(upper_payload[0]["material"], json!("Rock"));
    }
}
