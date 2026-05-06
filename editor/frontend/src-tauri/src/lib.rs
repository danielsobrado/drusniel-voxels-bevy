#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let runtime = EditorRuntimeProcess::start(app.handle());
            app.manage(runtime);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Drusniel Voxels editor");
}

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use std::{fs, fs::OpenOptions};
use tauri::{AppHandle, Manager};

const DEFAULT_BRIDGE_ADDR: &str = "127.0.0.1:17777";
const SIDECAR_DIR: &str = "binaries";
const SIDECAR_PREFIX: &str = "drusniel-editor-runtime";

struct EditorRuntimeProcess {
    child: Mutex<Option<Child>>,
}

impl EditorRuntimeProcess {
    fn start(app: &AppHandle) -> Self {
        let bridge_addr = std::env::var("DRUSNIEL_EDITOR_BRIDGE_ADDR")
            .unwrap_or_else(|_| DEFAULT_BRIDGE_ADDR.to_string());

        let child = match spawn_editor_runtime(app, &bridge_addr) {
            Ok(child) => {
                wait_for_runtime_health(&bridge_addr);
                Some(child)
            }
            Err(error) => {
                eprintln!("[editor-runtime] failed to start backend runtime: {error}");
                None
            }
        };

        Self {
            child: Mutex::new(child),
        }
    }
}

impl Drop for EditorRuntimeProcess {
    fn drop(&mut self) {
        let Ok(mut child) = self.child.lock() else {
            return;
        };
        let Some(mut child) = child.take() else {
            return;
        };

        if let Err(error) = child.kill() {
            eprintln!("[editor-runtime] failed to stop backend runtime: {error}");
        }
        let _ = child.wait();
    }
}

fn spawn_editor_runtime(app: &AppHandle, bridge_addr: &str) -> Result<Child, String> {
    let runtime_bin = std::env::var_os("DRUSNIEL_EDITOR_RUNTIME_BIN");
    let mut command = if let Some(runtime_bin) = runtime_bin {
        let mut command = Command::new(runtime_bin);
        command.arg("--editor-runtime");
        command
    } else if let Some(runtime_bin) = packaged_editor_runtime(app) {
        let mut command = Command::new(runtime_bin);
        command.arg("--editor-runtime");
        command
    } else {
        let mut command = Command::new("cargo");
        command
            .arg("run")
            .arg("--")
            .arg("--editor-runtime")
            .current_dir(repo_root());
        command
    };

    let (stdout, stderr) = runtime_stdio(app);
    command
        .env("DRUSNIEL_EDITOR_RUNTIME", "1")
        .env("DRUSNIEL_EDITOR_BRIDGE_ADDR", bridge_addr)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr)
        .spawn()
        .map_err(|error| error.to_string())
}

fn packaged_editor_runtime(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    find_editor_runtime_binary(resource_dir.join(SIDECAR_DIR))
        .or_else(|| find_editor_runtime_binary(resource_dir))
}

fn find_editor_runtime_binary(dir: PathBuf) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let is_runtime = file_name.starts_with(SIDECAR_PREFIX);
        let is_platform_binary = if cfg!(target_os = "windows") {
            file_name.ends_with(".exe")
        } else {
            true
        };
        if is_runtime && is_platform_binary {
            return Some(path);
        }
    }
    None
}

fn runtime_stdio(app: &AppHandle) -> (Stdio, Stdio) {
    match app.path().app_log_dir() {
        Ok(log_dir) => {
            if let Err(error) = fs::create_dir_all(&log_dir) {
                eprintln!(
                    "[editor-runtime] failed to create log directory {}: {error}",
                    log_dir.display()
                );
                return (Stdio::inherit(), Stdio::inherit());
            }

            let stdout = open_log_stream(log_dir.join("editor-runtime.stdout.log"));
            let stderr = open_log_stream(log_dir.join("editor-runtime.stderr.log"));
            match (stdout, stderr) {
                (Ok(stdout), Ok(stderr)) => (stdout, stderr),
                (stdout, stderr) => {
                    if let Err(error) = stdout {
                        eprintln!("[editor-runtime] failed to open stdout log: {error}");
                    }
                    if let Err(error) = stderr {
                        eprintln!("[editor-runtime] failed to open stderr log: {error}");
                    }
                    (Stdio::inherit(), Stdio::inherit())
                }
            }
        }
        Err(error) => {
            eprintln!("[editor-runtime] failed to resolve app log directory: {error}");
            (Stdio::inherit(), Stdio::inherit())
        }
    }
}

fn open_log_stream(path: PathBuf) -> Result<Stdio, std::io::Error> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(Stdio::from)
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

fn wait_for_runtime_health(bridge_addr: &str) {
    for _ in 0..150 {
        if TcpStream::connect(bridge_addr).is_ok() {
            eprintln!("[editor-runtime] backend bridge is ready at http://{bridge_addr}");
            return;
        }
        thread::sleep(Duration::from_millis(200));
    }

    eprintln!("[editor-runtime] backend bridge did not become ready at http://{bridge_addr}");
}
