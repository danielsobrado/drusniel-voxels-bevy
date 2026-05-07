use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bevy::prelude::*;
use log::warn;
use serde_json::{Value, json};

use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_I32};
use crate::rendering::ao_config::AmbientOcclusionConfig;
use crate::runtime_commands::{handle_runtime_command_json, runtime_snapshot_json};
use crate::terrain::generation::config::terrain_config_fingerprint;
use crate::voxel::chunk::{Chunk, MeshDirtyReason};
use crate::voxel::meshing::{
    MeshData, MeshSettings, WaterBodyKind, WaterBodyMaterialMode, generate_chunk_mesh_with_mode,
};
use crate::voxel::persistence::{
    self, EditorWorldMetadata, WORLD_SAVE_PATH, WorldData, read_world_data_from_bytes,
};
use crate::voxel::plugin::{WaterBodyInfo, WaterBodyRegistry};
use crate::voxel::skirt::{NeighborLods, SkirtConfig};
use crate::voxel::types::VoxelType;
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
    body: Value,
}

fn editor_runtime_bridge_enabled() -> bool {
    matches!(
        std::env::var("DRUSNIEL_EDITOR_BRIDGE").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("on")
    )
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

                BridgeResponse { status: 200, body }
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

                BridgeResponse { status: 200, body }
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

    let operation = match (request.method.as_str(), request.path.as_str()) {
        ("POST", "/editor/world/load-default") => BridgeOperation::EditorLoadDefaultWorld,
        ("POST", "/editor/world/load-upload") => {
            BridgeOperation::EditorLoadUploadedWorld(request.body)
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
        Ok(response) => {
            let _ = write_json_response(&mut stream, response.status, response.body);
        }
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
        return BridgeResponse {
            status: 503,
            body: json!({
                "ok": false,
                "error": "VoxelWorld resource is not available.",
                "code": "WORLD_UNAVAILABLE",
            }),
        };
    };

    let result = persistence::editor_save_default_world(voxel_world);
    if result.saved {
        BridgeResponse {
            status: 200,
            body: json!({
                "ok": true,
                "data": {
                    "worldId": result.save_path,
                    "savedAt": timestamp_string(),
                },
            }),
        }
    } else {
        BridgeResponse {
            status: 400,
            body: json!({
                "ok": false,
                "error": result.error_message.unwrap_or_else(|| "Failed to save default world.".to_string()),
                "code": result.error_kind.unwrap_or_else(|| "WORLD_SAVE_FAILED".to_string()),
            }),
        }
    }
}

fn editor_load_default_world_response(world: &mut World) -> BridgeResponse {
    match persistence::read_world_data_from_path(WORLD_SAVE_PATH) {
        Ok(data) => load_world_data_into_runtime(world, data, WORLD_SAVE_PATH.to_string()),
        Err(error) => BridgeResponse {
            status: 400,
            body: json!({
                "ok": false,
                "error": error.to_string(),
                "code": "WORLD_LOAD_FAILED",
            }),
        },
    }
}

fn editor_load_uploaded_world_response(world: &mut World, bytes: &[u8]) -> BridgeResponse {
    match read_world_data_from_bytes(bytes) {
        Ok(data) => load_world_data_into_runtime(world, data, "uploaded-world".to_string()),
        Err(error) => BridgeResponse {
            status: 400,
            body: json!({
                "ok": false,
                "error": error.to_string(),
                "code": "WORLD_UPLOAD_INVALID",
            }),
        },
    }
}

fn editor_current_world_summary_response(world: &World) -> BridgeResponse {
    match world.get_resource::<VoxelWorld>() {
        Some(voxel_world) => BridgeResponse {
            status: 200,
            body: json!({
                "ok": true,
                "data": frontend_world_summary_from_world(world, voxel_world, "runtime-world"),
            }),
        },
        None => BridgeResponse {
            status: 503,
            body: json!({
                "ok": false,
                "error": "VoxelWorld resource is not available.",
                "code": "WORLD_UNAVAILABLE",
            }),
        },
    }
}

fn editor_viewport_snapshot_response(world: &World) -> BridgeResponse {
    match world.get_resource::<VoxelWorld>() {
        Some(voxel_world) => BridgeResponse {
            status: 200,
            body: json!({
                "ok": true,
                "data": viewport_snapshot_from_world(world, voxel_world),
            }),
        },
        None => BridgeResponse {
            status: 503,
            body: json!({
                "ok": false,
                "error": "VoxelWorld resource is not available.",
                "code": "WORLD_UNAVAILABLE",
            }),
        },
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
    for (_, chunk) in loaded_world.chunk_entries_mut() {
        chunk.mark_dirty_with_reason(MeshDirtyReason::Generation);
    }

    world.insert_resource(WorldBounds::from_size_chunks(
        loaded_world.world_size_chunks(),
    ));
    world.insert_resource(loaded_world);

    let loaded = world
        .get_resource::<VoxelWorld>()
        .expect("loaded VoxelWorld should be present immediately after insertion");

    BridgeResponse {
        status: 200,
        body: json!({
            "ok": true,
            "data": frontend_world_summary_from_metadata_and_world(world, &metadata, loaded),
        }),
    }
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
    let summary_chunks = selected_editor_chunks(voxel_world, WORLD_SUMMARY_CHUNK_LIMIT);
    let viewport_chunks = selected_editor_chunks(voxel_world, VIEWPORT_CHUNK_LIMIT);
    let chunk_previews = chunk_preview_payloads(&viewport_chunks);

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
        "props": [],
        "materials": [],
        "viewport": {
            "chunkSize": CHUNK_SIZE_I32,
            "sampleResolution": VIEWPORT_SAMPLE_RESOLUTION,
            "chunkCountTotal": metadata.chunk_count,
            "chunkCountIncluded": chunk_previews.len(),
            "chunks": chunk_previews,
        },
        "updatedAt": timestamp_string(),
    })
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

const WORLD_SUMMARY_CHUNK_LIMIT: usize = 512;
const VIEWPORT_CHUNK_LIMIT: usize = 512;
const VIEWPORT_SAMPLE_RESOLUTION: usize = 4;
const VIEWPORT_MESH_CHUNK_LIMIT: usize = 16;
const VIEWPORT_MESH_VERTEX_LIMIT: usize = 20_000;

fn viewport_snapshot_from_world(world: &World, voxel_world: &VoxelWorld) -> Value {
    let bounds = world
        .get_resource::<WorldBounds>()
        .copied()
        .unwrap_or_else(|| WorldBounds::from_size_chunks(voxel_world.world_size_chunks()));
    let viewport_chunks = selected_editor_chunks(voxel_world, VIEWPORT_CHUNK_LIMIT);

    json!({
        "protocolVersion": 1,
        "worldId": "runtime-world",
        "chunkSize": CHUNK_SIZE_I32,
        "sampleResolution": VIEWPORT_SAMPLE_RESOLUTION,
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
                    "samples": chunk_surface_samples(&data),
                })
            })
            .collect::<Vec<_>>(),
        "generatedAt": timestamp_string(),
    })
}

fn selected_editor_chunks(voxel_world: &VoxelWorld, limit: usize) -> Vec<&Chunk> {
    let mut columns: BTreeMap<(i32, i32), &Chunk> = BTreeMap::new();
    for (_, chunk) in voxel_world.chunk_entries() {
        if !chunk_has_visible_voxels(chunk) {
            continue;
        }

        let position = chunk.position();
        columns
            .entry((position.x, position.z))
            .and_modify(|existing| {
                if position.y > existing.position().y {
                    *existing = chunk;
                }
            })
            .or_insert(chunk);
    }

    let mut chunks = columns.into_values().collect::<Vec<_>>();
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

    take_evenly(chunks, limit)
}

fn take_evenly<T>(items: Vec<T>, limit: usize) -> Vec<T> {
    if limit == 0 || items.len() <= limit {
        return items;
    }

    let len = items.len();
    items
        .into_iter()
        .enumerate()
        .filter_map(|(index, item)| {
            if index * limit / len != (index + 1) * limit / len {
                Some(item)
            } else {
                None
            }
        })
        .collect()
}

fn chunk_has_visible_voxels(chunk: &Chunk) -> bool {
    chunk.iter_solid().next().is_some()
}

fn chunk_preview_payloads(chunks: &[&Chunk]) -> Vec<Value> {
    chunks
        .iter()
        .map(|chunk| {
            let data = chunk.to_data();
            let [x, y, z] = [data.position.x, data.position.y, data.position.z];
            json!({
                "chunkId": format!("chunk-{x}-{y}-{z}"),
                "coordinate": [x, y, z],
                "samples": chunk_surface_samples(&data),
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
    let skirt_config = world
        .get_resource::<SkirtConfig>()
        .cloned()
        .unwrap_or_default();
    let ao_config = world
        .get_resource::<AmbientOcclusionConfig>()
        .cloned()
        .unwrap_or_default();
    let neighbor_lods = NeighborLods {
        neg_x: voxel_world
            .get_chunk(chunk_pos + IVec3::new(-1, 0, 0))
            .map(|neighbor| neighbor.lod_level()),
        pos_x: voxel_world
            .get_chunk(chunk_pos + IVec3::new(1, 0, 0))
            .map(|neighbor| neighbor.lod_level()),
        neg_z: voxel_world
            .get_chunk(chunk_pos + IVec3::new(0, 0, -1))
            .map(|neighbor| neighbor.lod_level()),
        pos_z: voxel_world
            .get_chunk(chunk_pos + IVec3::new(0, 0, 1))
            .map(|neighbor| neighbor.lod_level()),
    };

    let mesh_result = generate_chunk_mesh_with_mode(
        chunk,
        voxel_world,
        mesh_settings.mode,
        chunk.lod_level(),
        neighbor_lods,
        &skirt_config,
        &ao_config.baked,
        mesh_settings.water_air_exposure_mode,
    );

    let terrain_too_large = mesh_result.solid.positions.len() > VIEWPORT_MESH_VERTEX_LIMIT;
    let water_too_large = mesh_result.water.positions.len() > VIEWPORT_MESH_VERTEX_LIMIT;

    json!({
        "included": !(terrain_too_large || water_too_large),
        "reason": if terrain_too_large || water_too_large { "vertex_limit" } else { "included" },
        "terrain": mesh_buffer_payload(&mesh_result.solid, terrain_too_large),
        "water": mesh_buffer_payload(&mesh_result.water, water_too_large),
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

fn mesh_buffer_payload(mesh: &MeshData, omit_buffers: bool) -> Value {
    json!({
        "vertexCount": mesh.positions.len(),
        "indexCount": mesh.indices.len(),
        "triangleCount": mesh.indices.len() / 3,
        "positions": if omit_buffers { Value::Null } else { json!(mesh.positions) },
        "normals": if omit_buffers { Value::Null } else { json!(mesh.normals) },
        "uvs": if omit_buffers { Value::Null } else { json!(mesh.uvs) },
        "colors": if omit_buffers { Value::Null } else { json!(mesh.colors) },
        "indices": if omit_buffers { Value::Null } else { json!(mesh.indices) },
    })
}

fn chunk_surface_samples(data: &crate::voxel::chunk::ChunkData) -> Vec<Value> {
    let stride = CHUNK_SIZE / VIEWPORT_SAMPLE_RESOLUTION;
    let chunk_origin = data.position * CHUNK_SIZE_I32;
    let mut samples = Vec::with_capacity(VIEWPORT_SAMPLE_RESOLUTION * VIEWPORT_SAMPLE_RESOLUTION);

    for sample_z in 0..VIEWPORT_SAMPLE_RESOLUTION {
        for sample_x in 0..VIEWPORT_SAMPLE_RESOLUTION {
            let local_x = (sample_x * stride).min(CHUNK_SIZE - 1);
            let local_z = (sample_z * stride).min(CHUNK_SIZE - 1);
            let mut surface_y = 0_i32;
            let mut material = VoxelType::Air;

            for local_y in (0..CHUNK_SIZE).rev() {
                let voxel = data
                    .voxels
                    .get(crate::voxel::chunk::Chunk::index(local_x, local_y, local_z))
                    .copied()
                    .unwrap_or_default();
                if voxel != VoxelType::Air {
                    surface_y = chunk_origin.y + local_y as i32;
                    material = voxel;
                    break;
                }
            }

            samples.push(json!({
                "x": chunk_origin.x + local_x as i32,
                "z": chunk_origin.z + local_z as i32,
                "height": surface_y,
                "material": voxel_material_name(material),
                "water": material == VoxelType::Water,
            }));
        }
    }

    samples
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
}
