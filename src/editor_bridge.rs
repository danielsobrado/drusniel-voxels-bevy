use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bevy::prelude::*;
use serde_json::{Value, json};

use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_I32};
use crate::runtime_commands::{handle_runtime_command_json, runtime_snapshot_json};
use crate::terrain::generation::config::terrain_config_fingerprint;
use crate::voxel::chunk::MeshDirtyReason;
use crate::voxel::persistence::{
    self, EditorWorldMetadata, WORLD_SAVE_PATH, WorldData, read_world_data_from_bytes,
};
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
                "data": frontend_world_summary_from_world(voxel_world, "runtime-world"),
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
        return BridgeResponse {
            status: 400,
            body: json!({
                "ok": false,
                "error": format!(
                    "Saved world terrain fingerprint mismatch: saved {:#018x}, current {:#018x}",
                    data.terrain_config_fingerprint,
                    current_fingerprint
                ),
                "code": "TERRAIN_FINGERPRINT_MISMATCH",
            }),
        };
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
            "data": frontend_world_summary_from_metadata_and_world(&metadata, loaded),
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

fn frontend_world_summary_from_world(voxel_world: &VoxelWorld, save_path: &str) -> Value {
    let data = voxel_world.to_data();
    let metadata = persistence::editor_world_metadata_from_data_for_bridge(&data, save_path);
    frontend_world_summary_from_metadata_and_world(&metadata, voxel_world)
}

fn frontend_world_summary_from_metadata_and_world(
    metadata: &EditorWorldMetadata,
    voxel_world: &VoxelWorld,
) -> Value {
    let chunk_previews = voxel_world
        .chunk_entries()
        .map(|(_, chunk)| {
            let data = chunk.to_data();
            let [x, y, z] = [data.position.x, data.position.y, data.position.z];
            json!({
                "chunkId": format!("chunk-{x}-{y}-{z}"),
                "coordinate": [x, y, z],
                "samples": chunk_surface_samples(&data),
            })
        })
        .collect::<Vec<_>>();

    json!({
        "worldId": metadata.save_path,
        "name": world_name_from_path(&metadata.save_path),
        "chunks": voxel_world
            .chunk_entries()
            .map(|(_, chunk)| {
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
            })
            .collect::<Vec<_>>(),
        "protectedAreas": [],
        "waterBodies": [],
        "materials": [],
        "viewport": {
            "chunkSize": CHUNK_SIZE_I32,
            "sampleResolution": VIEWPORT_SAMPLE_RESOLUTION,
            "chunks": chunk_previews,
        },
        "updatedAt": timestamp_string(),
    })
}

const VIEWPORT_SAMPLE_RESOLUTION: usize = 8;

fn viewport_snapshot_from_world(world: &World, voxel_world: &VoxelWorld) -> Value {
    let bounds = world
        .get_resource::<WorldBounds>()
        .copied()
        .unwrap_or_else(|| WorldBounds::from_size_chunks(voxel_world.world_size_chunks()));

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
        "chunks": voxel_world
            .chunk_entries()
            .map(|(_, chunk)| {
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
                    "samples": chunk_surface_samples(&data),
                })
            })
            .collect::<Vec<_>>(),
        "generatedAt": timestamp_string(),
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
