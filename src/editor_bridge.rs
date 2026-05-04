use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;

use bevy::prelude::*;
use serde_json::{Value, json};

use crate::runtime_commands::{handle_runtime_command_json, runtime_snapshot_json};

const DEFAULT_BRIDGE_ADDR: &str = "127.0.0.1:17777";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

pub struct EditorRuntimeBridgePlugin;

impl Plugin for EditorRuntimeBridgePlugin {
    fn build(&self, app: &mut App) {
        if editor_runtime_bridge_enabled() {
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
