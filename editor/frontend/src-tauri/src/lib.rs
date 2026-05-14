#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            attach_native_viewport,
            detach_native_viewport,
            screen_simulation_capture_screenshot,
            screen_simulation_click_mouse,
            screen_simulation_focus_editor,
            screen_simulation_move_mouse,
            screen_simulation_status
        ])
        .setup(|app| {
            let runtime = EditorRuntimeProcess::start(app.handle());
            app.manage(runtime);
            screen_simulation::start_screen_simulation_server(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Drusniel Voxels editor");
}

mod screen_simulation;

use screen_simulation::{
    screen_simulation_capture_screenshot, screen_simulation_click_mouse,
    screen_simulation_focus_editor, screen_simulation_move_mouse, screen_simulation_status,
};
use serde::{Deserialize, Serialize};
use std::io::Write;
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

fn editor_diagnostics_enabled() -> bool {
    std::env::var("DRUSNIEL_EDITOR_DIAGNOSTICS")
        .or_else(|_| std::env::var("DRUSNIEL_EDITOR_HEAVY_DEBUG"))
        .is_ok_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeViewportRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    visible: Option<bool>,
    focus: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeViewportAttachment {
    attached: bool,
    hwnd: Option<isize>,
    message: String,
}

struct EditorRuntimeProcess {
    child: Mutex<Option<Child>>,
    viewport_hwnd: Mutex<Option<isize>>,
}

impl EditorRuntimeProcess {
    fn start(app: &AppHandle) -> Self {
        let bridge_addr = std::env::var("DRUSNIEL_EDITOR_BRIDGE_ADDR")
            .unwrap_or_else(|_| DEFAULT_BRIDGE_ADDR.to_string());

        let child = match spawn_editor_runtime(app, &bridge_addr) {
            Ok(child) => {
                append_shell_log(app, "editor runtime process spawned");
                wait_for_runtime_health(&bridge_addr);
                Some(child)
            }
            Err(error) => {
                append_shell_log(
                    app,
                    &format!("failed to start backend runtime process: {error}"),
                );
                eprintln!("[editor-runtime] failed to start backend runtime: {error}");
                None
            }
        };

        Self {
            child: Mutex::new(child),
            viewport_hwnd: Mutex::new(None),
        }
    }

    fn child_id(&self) -> Option<u32> {
        self.child.lock().ok()?.as_ref().map(Child::id)
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

#[cfg(windows)]
#[tauri::command]
fn attach_native_viewport(
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, EditorRuntimeProcess>,
    rect: NativeViewportRect,
) -> Result<NativeViewportAttachment, String> {
    let child_pid = runtime
        .child_id()
        .ok_or_else(|| "editor runtime process is not running".to_string())?;
    let parent_hwnd =
        window.hwnd().map_err(|error| error.to_string())?.0 as windows_sys::Win32::Foundation::HWND;

    let cached_hwnd = runtime.viewport_hwnd.lock().ok().and_then(|guard| *guard);
    let found_from_cache = cached_hwnd.is_some();
    let hwnd = {
        if let Some(hwnd) = cached_hwnd {
            hwnd as windows_sys::Win32::Foundation::HWND
        } else {
            find_runtime_window(child_pid)
                .ok_or_else(|| "native Bevy viewport window is not ready yet".to_string())?
        }
    };

    if editor_diagnostics_enabled() {
        append_shell_log(
            window.app_handle(),
            &format!(
                "[editor-diagnostics][nativeViewport] attach request pid={} parent_hwnd={} child_hwnd={} cached={} rect=({}, {}, {}, {})",
                child_pid,
                parent_hwnd as isize,
                hwnd as isize,
                found_from_cache,
                rect.x,
                rect.y,
                rect.width,
                rect.height
            ),
        );
    }

    embed_runtime_window(parent_hwnd, hwnd, &rect)?;

    if let Ok(mut cached_hwnd) = runtime.viewport_hwnd.lock() {
        *cached_hwnd = Some(hwnd as isize);
    }

    let visible = rect.visible.unwrap_or(true);

    Ok(NativeViewportAttachment {
        attached: true,
        hwnd: Some(hwnd as isize),
        message: if visible {
            "native Bevy viewport attached".to_string()
        } else {
            "native Bevy viewport prepared".to_string()
        },
    })
}

#[cfg(not(windows))]
#[tauri::command]
fn attach_native_viewport(
    _window: tauri::WebviewWindow,
    _runtime: tauri::State<'_, EditorRuntimeProcess>,
    _rect: NativeViewportRect,
) -> Result<NativeViewportAttachment, String> {
    Ok(NativeViewportAttachment {
        attached: false,
        hwnd: None,
        message: "native viewport embedding is Windows-only".to_string(),
    })
}

#[cfg(windows)]
#[tauri::command]
fn detach_native_viewport(runtime: tauri::State<'_, EditorRuntimeProcess>) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

    if let Ok(mut cached_hwnd) = runtime.viewport_hwnd.lock() {
        if let Some(hwnd) = cached_hwnd.take() {
            unsafe {
                ShowWindow(hwnd as windows_sys::Win32::Foundation::HWND, SW_HIDE);
            }
        }
    }

    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
fn detach_native_viewport(_runtime: tauri::State<'_, EditorRuntimeProcess>) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn find_runtime_window(pid: u32) -> Option<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsWindowVisible,
    };

    struct SearchContext {
        pid: u32,
        hwnd: Option<HWND>,
    }

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
        let context = unsafe { &mut *(lparam as *mut SearchContext) };
        let mut window_pid = 0;

        unsafe {
            GetWindowThreadProcessId(hwnd, &mut window_pid);
        }

        if window_pid != context.pid {
            return 1;
        }

        let is_visible = unsafe { IsWindowVisible(hwnd) } != 0;
        if !is_visible {
            return 1;
        }

        let title_length = unsafe { GetWindowTextLengthW(hwnd) };
        if title_length <= 0 {
            return 1;
        }

        let mut title = vec![0u16; title_length as usize + 1];
        let copied = unsafe { GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32) };
        if copied <= 0 {
            return 1;
        }

        let title = String::from_utf16_lossy(&title[..copied as usize]);
        if title.contains("Drusniel Bevy Viewport") {
            context.hwnd = Some(hwnd);
            return 0;
        }

        1
    }

    let mut context = SearchContext { pid, hwnd: None };
    unsafe {
        EnumWindows(
            Some(enum_windows_proc),
            &mut context as *mut SearchContext as LPARAM,
        );
    }

    context.hwnd
}

#[cfg(windows)]
fn embed_runtime_window(
    parent_hwnd: windows_sys::Win32::Foundation::HWND,
    child_hwnd: windows_sys::Win32::Foundation::HWND,
    rect: &NativeViewportRect,
) -> Result<(), String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetDeviceCaps, LOGPIXELSX};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowLongPtrW, SetParent, SetWindowLongPtrW, SetWindowPos,
        ShowWindow, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW,
        SW_HIDE, SW_SHOW, WS_CAPTION, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
        WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU, WS_THICKFRAME, WS_VISIBLE,
    };

    let visible = rect.visible.unwrap_or(true);
    let focus = rect.focus.unwrap_or(visible);
    let visible_style = if visible { WS_VISIBLE } else { 0 };
    let child_style = (WS_CHILD | visible_style | WS_CLIPSIBLINGS | WS_CLIPCHILDREN) as isize;
    let removed_style =
        (WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)
            as isize;

    unsafe {
        SetParent(child_hwnd, parent_hwnd);

        let style = GetWindowLongPtrW(child_hwnd, GWL_STYLE);
        SetWindowLongPtrW(
            child_hwnd,
            GWL_STYLE,
            (style & !removed_style) | child_style,
        );

        let mut parent_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetClientRect(parent_hwnd, &mut parent_rect) == 0 {
            return Err("failed to read editor window bounds".to_string());
        }

        let hdc = windows_sys::Win32::Graphics::Gdi::GetDC(parent_hwnd);
        let dpi_scale = if hdc.is_null() {
            1.0
        } else {
            let dpi = GetDeviceCaps(hdc, LOGPIXELSX as i32);
            let _ = windows_sys::Win32::Graphics::Gdi::ReleaseDC(parent_hwnd, hdc);
            if dpi > 0 {
                dpi as f32 / 96.0
            } else {
                1.0
            }
        };

        let parent_width = (parent_rect.right - parent_rect.left).max(1);
        let parent_height = (parent_rect.bottom - parent_rect.top).max(1);
        let x = ((rect.x as f32) * dpi_scale)
            .round()
            .clamp(0.0, parent_width.saturating_sub(1) as f32) as i32;
        let y = ((rect.y as f32) * dpi_scale)
            .round()
            .clamp(0.0, parent_height.saturating_sub(1) as f32) as i32;
        let width = ((rect.width.max(1) as f32) * dpi_scale)
            .round()
            .max(1.0)
            .min((parent_width - x).max(1) as f32) as i32;
        let height = ((rect.height.max(1) as f32) * dpi_scale)
            .round()
            .max(1.0)
            .min((parent_height - y).max(1) as f32) as i32;

        let position_flags = if visible {
            SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW
        } else {
            SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE
        };
        let positioned = SetWindowPos(
            child_hwnd,
            null_mut(),
            x,
            y,
            width,
            height,
            position_flags,
        ) != 0;
        if !positioned {
            return Err("failed to position Bevy viewport window".to_string());
        }

        ShowWindow(child_hwnd, if visible { SW_SHOW } else { SW_HIDE });
        let previous_focus = if focus {
            SetFocus(child_hwnd)
        } else {
            null_mut()
        };
        if editor_diagnostics_enabled() {
            eprintln!(
                "[editor-diagnostics][nativeViewport] embedded parent_hwnd={} child_hwnd={} previous_focus={} dpi_scale={:.2} rect=({}, {}, {}, {}) client=({}, {})",
                parent_hwnd as isize,
                child_hwnd as isize,
                previous_focus as isize,
                dpi_scale,
                x,
                y,
                width,
                height,
                parent_width,
                parent_height
            );
        }
    }

    Ok(())
}

fn spawn_editor_runtime(app: &AppHandle, bridge_addr: &str) -> Result<Child, String> {
    let runtime_bin = std::env::var_os("DRUSNIEL_EDITOR_RUNTIME_BIN");
    let mut command = if let Some(runtime_bin) = runtime_bin {
        append_shell_log(
            app,
            &format!(
                "spawning runtime from DRUSNIEL_EDITOR_RUNTIME_BIN: {}",
                PathBuf::from(&runtime_bin).display()
            ),
        );
        let mut command = Command::new(runtime_bin);
        command.arg("--editor-native-viewport");
        command
    } else if let Some(runtime_bin) = packaged_editor_runtime(app) {
        append_shell_log(
            app,
            &format!("spawning packaged runtime: {}", runtime_bin.display()),
        );
        let mut command = Command::new(runtime_bin);
        command.arg("--editor-native-viewport");
        command
    } else {
        append_shell_log(app, "spawning runtime through cargo fallback");
        let mut command = Command::new("cargo");
        command
            .arg("run")
            .arg("--")
            .arg("--editor-native-viewport")
            .current_dir(repo_root());
        command
    };

    let (stdout, stderr) = runtime_stdio(app);
    let working_dir = editor_runtime_working_dir(app);
    let asset_dir = working_dir.join("assets");

    command
        .current_dir(&working_dir)
        .env("DRUSNIEL_EDITOR_ASSET_DIR", asset_dir)
        .env("DRUSNIEL_EDITOR_NATIVE_VIEWPORT", "1")
        .env("DRUSNIEL_EDITOR_BRIDGE", "1")
        .env("DRUSNIEL_EDITOR_BRIDGE_ADDR", bridge_addr)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr)
        .spawn()
        .map_err(|error| error.to_string())
}

fn packaged_editor_runtime(app: &AppHandle) -> Option<PathBuf> {
    let source_sidecar_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(SIDECAR_DIR);
    let resource_dir = app.path().resource_dir().ok();
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from));

    [source_sidecar_dir]
        .iter()
        .chain(resource_dir.iter())
        .chain(executable_dir.iter())
        .flat_map(|dir| [dir.join(SIDECAR_DIR), dir.to_path_buf()])
        .find_map(find_editor_runtime_binary)
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

fn append_shell_log(app: &AppHandle, message: &str) {
    let Ok(log_dir) = app.path().app_log_dir() else {
        return;
    };
    if fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("editor-shell.log"))
    else {
        return;
    };
    let _ = writeln!(file, "{message}");
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
        .join("..")
}

fn editor_runtime_working_dir(app: &AppHandle) -> PathBuf {
    let repo_root = repo_root();
    if repo_root.join("assets").exists() {
        return repo_root;
    }

    app.path()
        .resource_dir()
        .ok()
        .filter(|path| path.join("assets").exists())
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(PathBuf::from))
                .filter(|path| path.join("assets").exists())
        })
        .unwrap_or(repo_root)
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
