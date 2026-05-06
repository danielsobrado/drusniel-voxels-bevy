#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = EditorRuntimeProcess::start();

    tauri::Builder::default()
        .manage(runtime)
        .run(tauri::generate_context!())
        .expect("failed to run Drusniel Voxels editor");
}

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

const DEFAULT_BRIDGE_ADDR: &str = "127.0.0.1:17777";

struct EditorRuntimeProcess {
    child: Mutex<Option<Child>>,
}

impl EditorRuntimeProcess {
    fn start() -> Self {
        let bridge_addr = std::env::var("DRUSNIEL_EDITOR_BRIDGE_ADDR")
            .unwrap_or_else(|_| DEFAULT_BRIDGE_ADDR.to_string());

        let child = match spawn_editor_runtime(&bridge_addr) {
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

fn spawn_editor_runtime(bridge_addr: &str) -> Result<Child, String> {
    let runtime_bin = std::env::var_os("DRUSNIEL_EDITOR_RUNTIME_BIN");
    let mut command = if let Some(runtime_bin) = runtime_bin {
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

    command
        .env("DRUSNIEL_EDITOR_RUNTIME", "1")
        .env("DRUSNIEL_EDITOR_BRIDGE_ADDR", bridge_addr)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| error.to_string())
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
