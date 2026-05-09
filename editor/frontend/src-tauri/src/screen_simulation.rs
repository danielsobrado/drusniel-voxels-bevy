use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::{append_shell_log, editor_diagnostics_enabled, EditorRuntimeProcess};

const DEFAULT_AUTOMATION_ADDR: &str = "127.0.0.1:17778";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenPoint {
    x: i32,
    y: i32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenSimulationStatus {
    enabled: bool,
    automation_addr: String,
    cursor: Option<ScreenPoint>,
    window: Option<ScreenRect>,
    viewport: Option<ScreenRect>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenSimulationScreenshot {
    path: String,
    width: i32,
    height: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenSimulationPointerRequest {
    x: Option<i32>,
    y: Option<i32>,
    space: Option<String>,
    button: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenSimulationScreenshotRequest {
    label: Option<String>,
}

pub(crate) fn start_screen_simulation_server(app: AppHandle) {
    if !screen_simulation_enabled() {
        return;
    }

    let addr = std::env::var("DRUSNIEL_EDITOR_AUTOMATION_ADDR")
        .unwrap_or_else(|_| DEFAULT_AUTOMATION_ADDR.to_string());
    let listener = match TcpListener::bind(&addr) {
        Ok(listener) => listener,
        Err(error) => {
            append_shell_log(
                &app,
                &format!("[screen-simulation] failed to bind {addr}: {error}"),
            );
            return;
        }
    };

    append_shell_log(
        &app,
        &format!("[screen-simulation] automation endpoint listening at http://{addr}"),
    );

    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            thread::spawn(move || handle_http_request(app, stream));
        }
    });
}

#[tauri::command]
pub(crate) fn screen_simulation_focus_editor(window: WebviewWindow) -> Result<(), String> {
    ensure_enabled()?;
    raise_window(&window)
}

#[tauri::command]
pub(crate) fn screen_simulation_status(
    window: WebviewWindow,
    runtime: tauri::State<'_, EditorRuntimeProcess>,
) -> Result<ScreenSimulationStatus, String> {
    status_for(&window, Some(&runtime))
}

#[tauri::command]
pub(crate) fn screen_simulation_move_mouse(
    window: WebviewWindow,
    runtime: tauri::State<'_, EditorRuntimeProcess>,
    request: ScreenSimulationPointerRequest,
) -> Result<ScreenPoint, String> {
    ensure_enabled()?;
    let point = resolve_point(&window, Some(&runtime), &request)?;
    move_cursor(point)?;
    Ok(point)
}

#[tauri::command]
pub(crate) fn screen_simulation_click_mouse(
    window: WebviewWindow,
    runtime: tauri::State<'_, EditorRuntimeProcess>,
    request: ScreenSimulationPointerRequest,
) -> Result<ScreenPoint, String> {
    ensure_enabled()?;
    let point = resolve_point(&window, Some(&runtime), &request)?;
    move_cursor(point)?;
    click_cursor(request.button.as_deref().unwrap_or("left"))?;
    Ok(point)
}

#[tauri::command]
pub(crate) fn screen_simulation_capture_screenshot(
    window: WebviewWindow,
    request: Option<ScreenSimulationScreenshotRequest>,
) -> Result<ScreenSimulationScreenshot, String> {
    ensure_enabled()?;
    capture_window_screenshot(
        window.app_handle(),
        &window,
        request.and_then(|request| request.label),
    )
}

fn screen_simulation_enabled() -> bool {
    editor_diagnostics_enabled()
        || std::env::var("DRUSNIEL_EDITOR_SCREEN_SIMULATION")
            .is_ok_and(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
}

fn ensure_enabled() -> Result<(), String> {
    if screen_simulation_enabled() {
        Ok(())
    } else {
        Err("screen simulation is disabled; start the editor with DRUSNIEL_EDITOR_DIAGNOSTICS=1".to_string())
    }
}

fn automation_addr() -> String {
    std::env::var("DRUSNIEL_EDITOR_AUTOMATION_ADDR")
        .unwrap_or_else(|_| DEFAULT_AUTOMATION_ADDR.to_string())
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main editor window is not available".to_string())
}

fn handle_http_request(app: AppHandle, mut stream: TcpStream) {
    let mut buffer = [0_u8; 4096];
    let Ok(read) = stream.read(&mut buffer) else {
        return;
    };
    let request = String::from_utf8_lossy(&buffer[..read]);
    let Some(request_line) = request.lines().next() else {
        respond_json(&mut stream, 400, json!({ "ok": false, "error": "empty request" }));
        return;
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    if method != "GET" {
        respond_json(
            &mut stream,
            405,
            json!({ "ok": false, "error": "only GET is supported" }),
        );
        return;
    }

    let (path, params) = parse_target(target);
    let response = match path.as_str() {
        "/health" => Ok(json!({
            "ok": true,
            "automation": "drusniel-tauri-screen-simulation",
            "enabled": screen_simulation_enabled(),
            "addr": automation_addr()
        })),
        "/status" => main_window(&app)
            .and_then(|window| {
                let runtime = app.state::<EditorRuntimeProcess>();
                status_for(&window, Some(&runtime)).map_err(|error| error.to_string())
            })
            .and_then(|status| serde_json::to_value(status).map_err(|error| error.to_string())),
    "/screenshot" => {
            let label = params.get("label").cloned();
            main_window(&app)
                .and_then(|window| capture_window_screenshot(&app, &window, label))
                .and_then(|screenshot| serde_json::to_value(screenshot).map_err(|error| error.to_string()))
        }
        "/focus" => main_window(&app)
            .and_then(|window| {
                raise_window(&window)?;
                let runtime = app.state::<EditorRuntimeProcess>();
                status_for(&window, Some(&runtime)).map_err(|error| error.to_string())
            })
            .and_then(|status| serde_json::to_value(status).map_err(|error| error.to_string())),
        "/move" => {
            let request = pointer_request_from_params(&params);
            main_window(&app)
                .and_then(|window| {
                    raise_for_pointer_request(&window, &request)?;
                    let runtime = app.state::<EditorRuntimeProcess>();
                    let point = resolve_point(&window, Some(&runtime), &request)?;
                    move_cursor(point)?;
                    Ok(point)
                })
                .and_then(|point| serde_json::to_value(point).map_err(|error| error.to_string()))
        }
        "/click" => {
            let request = pointer_request_from_params(&params);
            main_window(&app)
                .and_then(|window| {
                    raise_for_pointer_request(&window, &request)?;
                    let runtime = app.state::<EditorRuntimeProcess>();
                    let point = resolve_point(&window, Some(&runtime), &request)?;
                    move_cursor(point)?;
                    click_cursor(request.button.as_deref().unwrap_or("left"))?;
                    Ok(point)
                })
                .and_then(|point| serde_json::to_value(point).map_err(|error| error.to_string()))
        }
        _ => Err(format!("unknown screen simulation endpoint: {path}")),
    };

    match response {
        Ok(value) => respond_json(&mut stream, 200, json!({ "ok": true, "result": value })),
        Err(error) => respond_json(&mut stream, 500, json!({ "ok": false, "error": error })),
    }
}

fn raise_for_pointer_request(
    window: &WebviewWindow,
    request: &ScreenSimulationPointerRequest,
) -> Result<(), String> {
    if request
        .space
        .as_deref()
        .unwrap_or("screen")
        .trim()
        .eq_ignore_ascii_case("screen")
    {
        return Ok(());
    }
    raise_window(window)
}

fn parse_target(target: &str) -> (String, HashMap<String, String>) {
    let mut split = target.splitn(2, '?');
    let path = split.next().unwrap_or_default().to_string();
    let query = split.next().unwrap_or_default();
    let mut params = HashMap::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let mut key_value = pair.splitn(2, '=');
        let key = percent_decode(key_value.next().unwrap_or_default());
        let value = percent_decode(key_value.next().unwrap_or_default());
        params.insert(key, value);
    }
    (path, params)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                output.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = &value[index + 1..index + 3];
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    output.push(byte);
                    index += 3;
                } else {
                    output.push(bytes[index]);
                    index += 1;
                }
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&output).to_string()
}

fn pointer_request_from_params(params: &HashMap<String, String>) -> ScreenSimulationPointerRequest {
    ScreenSimulationPointerRequest {
        x: params.get("x").and_then(|value| value.parse::<i32>().ok()),
        y: params.get("y").and_then(|value| value.parse::<i32>().ok()),
        space: params.get("space").cloned(),
        button: params.get("button").cloned(),
    }
}

fn respond_json(stream: &mut TcpStream, status: u16, value: serde_json::Value) {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    };
    let body = value.to_string();
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

#[cfg(windows)]
fn status_for(
    window: &WebviewWindow,
    runtime: Option<&EditorRuntimeProcess>,
) -> Result<ScreenSimulationStatus, String> {
    Ok(ScreenSimulationStatus {
        enabled: screen_simulation_enabled(),
        automation_addr: automation_addr(),
        cursor: cursor_position(),
        window: Some(window_rect(window)?),
        viewport: runtime.and_then(viewport_rect),
    })
}

#[cfg(not(windows))]
fn status_for(
    _window: &WebviewWindow,
    _runtime: Option<&EditorRuntimeProcess>,
) -> Result<ScreenSimulationStatus, String> {
    Ok(ScreenSimulationStatus {
        enabled: false,
        automation_addr: automation_addr(),
        cursor: None,
        window: None,
        viewport: None,
    })
}

#[cfg(windows)]
fn resolve_point(
    window: &WebviewWindow,
    runtime: Option<&EditorRuntimeProcess>,
    request: &ScreenSimulationPointerRequest,
) -> Result<ScreenPoint, String> {
    let space = request
        .space
        .as_deref()
        .unwrap_or("screen")
        .trim()
        .to_ascii_lowercase();

    if space == "screen" {
        return Ok(ScreenPoint {
            x: request.x.ok_or_else(|| "screen-space x is required".to_string())?,
            y: request.y.ok_or_else(|| "screen-space y is required".to_string())?,
        });
    }

    let rect = match space.as_str() {
        "window" => window_rect(window)?,
        "viewport" => runtime
            .and_then(viewport_rect)
            .ok_or_else(|| "native viewport bounds are not available yet".to_string())?,
        _ => return Err(format!("unknown coordinate space: {space}")),
    };

    let local_x = request.x.unwrap_or(rect.width / 2).clamp(0, rect.width.max(1) - 1);
    let local_y = request.y.unwrap_or(rect.height / 2).clamp(0, rect.height.max(1) - 1);
    Ok(ScreenPoint {
        x: rect.x + local_x,
        y: rect.y + local_y,
    })
}

#[cfg(not(windows))]
fn resolve_point(
    _window: &WebviewWindow,
    _runtime: Option<&EditorRuntimeProcess>,
    _request: &ScreenSimulationPointerRequest,
) -> Result<ScreenPoint, String> {
    Err("screen simulation input is Windows-only".to_string())
}

#[cfg(windows)]
fn window_rect(window: &WebviewWindow) -> Result<ScreenRect, String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0
        as windows_sys::Win32::Foundation::HWND;
    hwnd_rect(hwnd)
}

#[cfg(windows)]
fn viewport_rect(runtime: &EditorRuntimeProcess) -> Option<ScreenRect> {
    let hwnd = runtime
        .viewport_hwnd
        .lock()
        .ok()
        .and_then(|guard| *guard)
        .map(|hwnd| hwnd as windows_sys::Win32::Foundation::HWND)
        .or_else(|| {
            runtime
                .child_id()
                .and_then(crate::find_runtime_window)
        })?;
    hwnd_rect(hwnd).ok()
}

#[cfg(windows)]
fn hwnd_rect(hwnd: windows_sys::Win32::Foundation::HWND) -> Result<ScreenRect, String> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let ok = unsafe { GetWindowRect(hwnd, &mut rect) } != 0;
    if !ok {
        return Err("failed to read window bounds".to_string());
    }
    Ok(ScreenRect {
        x: rect.left,
        y: rect.top,
        width: (rect.right - rect.left).max(1),
        height: (rect.bottom - rect.top).max(1),
    })
}

#[cfg(windows)]
fn cursor_position() -> Option<ScreenPoint> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut point = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut point) } != 0;
    ok.then_some(ScreenPoint {
        x: point.x,
        y: point.y,
    })
}

#[cfg(windows)]
fn move_cursor(point: ScreenPoint) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos;

    let ok = unsafe { SetCursorPos(point.x, point.y) } != 0;
    if ok {
        Ok(())
    } else {
        Err("failed to move cursor".to_string())
    }
}

#[cfg(not(windows))]
fn move_cursor(_point: ScreenPoint) -> Result<(), String> {
    Err("screen simulation input is Windows-only".to_string())
}

#[cfg(windows)]
fn raise_window(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, SetForegroundWindow, SetWindowPos, ShowWindow, SWP_NOMOVE,
        SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE,
    };

    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    let topmost = -1_isize as HWND;
    let not_topmost = -2_isize as HWND;
    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW;

    unsafe {
        ShowWindow(hwnd, SW_RESTORE);
        let _raised = SetWindowPos(hwnd, topmost, 0, 0, 0, 0, flags) != 0;
        thread::sleep(Duration::from_millis(80));
        let _foreground = SetForegroundWindow(hwnd) != 0;
        thread::sleep(Duration::from_millis(80));
        let _ = SetWindowPos(hwnd, not_topmost, 0, 0, 0, 0, flags);
        let foreground_hwnd = GetForegroundWindow();

        if foreground_hwnd == hwnd {
            Ok(())
        } else {
            Err(format!(
                "failed to raise editor window; foreground hwnd is {}",
                foreground_hwnd as isize
            ))
        }
    }
}

#[cfg(not(windows))]
fn raise_window(_window: &WebviewWindow) -> Result<(), String> {
    Err("screen simulation focus is Windows-only".to_string())
}

#[cfg(windows)]
fn click_cursor(button: &str) -> Result<(), String> {
    use std::mem::size_of;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
        MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN,
        MOUSEEVENTF_RIGHTUP, MOUSEINPUT,
    };

    let (down_flag, up_flag) = match button.trim().to_ascii_lowercase().as_str() {
        "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
        _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
    };
    let mut inputs = [
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: down_flag,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: up_flag,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];

    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            size_of::<INPUT>() as i32,
        )
    };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err("failed to send mouse click input".to_string())
    }
}

#[cfg(not(windows))]
fn click_cursor(_button: &str) -> Result<(), String> {
    Err("screen simulation input is Windows-only".to_string())
}

#[cfg(windows)]
fn capture_window_screenshot(
    app: &AppHandle,
    window: &WebviewWindow,
    label: Option<String>,
) -> Result<ScreenSimulationScreenshot, String> {
    use std::fs::{self, File};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, GetWindowDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        CAPTUREBLT, DIB_RGB_COLORS, RGBQUAD, SRCCOPY,
    };
    use windows_sys::Win32::Storage::Xps::PrintWindow;

    ensure_enabled()?;

    let rect = window_rect(window)?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0
        as windows_sys::Win32::Foundation::HWND;
    let width = rect.width.max(1);
    let height = rect.height.max(1);
    let image_size = width as usize * height as usize * 4;
    let mut pixels = vec![0_u8; image_size];

    unsafe {
        let window_dc = GetWindowDC(hwnd);
        if window_dc.is_null() {
            return Err("failed to acquire editor window device context".to_string());
        }

        let memory_dc = CreateCompatibleDC(window_dc);
        if memory_dc.is_null() {
            let _ = ReleaseDC(hwnd, window_dc);
            return Err("failed to create screenshot memory device context".to_string());
        }

        let bitmap = CreateCompatibleBitmap(window_dc, width, height);
        if bitmap.is_null() {
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(hwnd, window_dc);
            return Err("failed to create screenshot bitmap".to_string());
        }

        let previous_object = SelectObject(memory_dc, bitmap as _);
        let printed = PrintWindow(hwnd, memory_dc, 0x00000002) != 0;
        let copied = if printed {
            true
        } else {
            let screen_dc = GetDC(std::ptr::null_mut());
            if screen_dc.is_null() {
                false
            } else {
                let copied = BitBlt(
                    memory_dc,
                    0,
                    0,
                    width,
                    height,
                    screen_dc,
                    rect.x,
                    rect.y,
                    SRCCOPY | CAPTUREBLT,
                ) != 0;
                let _ = ReleaseDC(std::ptr::null_mut(), screen_dc);
                copied
            }
        };
        if !copied {
            let _ = SelectObject(memory_dc, previous_object);
            let _ = DeleteObject(bitmap as _);
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(hwnd, window_dc);
            return Err("failed to copy screen pixels".to_string());
        }

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: image_size as u32,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }],
        };

        let scan_lines = GetDIBits(
            memory_dc,
            bitmap,
            0,
            height as u32,
            pixels.as_mut_ptr() as *mut _,
            &mut info,
            DIB_RGB_COLORS,
        );

        let _ = SelectObject(memory_dc, previous_object);
        let _ = DeleteObject(bitmap as _);
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(hwnd, window_dc);

        if scan_lines == 0 {
            return Err("failed to extract screenshot pixels".to_string());
        }
    }

    let screenshot_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?
        .join("screen-simulation");
    fs::create_dir_all(&screenshot_dir).map_err(|error| error.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let label = label
        .map(|label| sanitize_label(&label))
        .filter(|label| !label.is_empty())
        .unwrap_or_else(|| "capture".to_string());
    let path = screenshot_dir.join(format!("{timestamp}-{label}.bmp"));

    let mut file = File::create(&path).map_err(|error| error.to_string())?;
    write_bmp(&mut file, width, height, &pixels).map_err(|error| error.to_string())?;

    Ok(ScreenSimulationScreenshot {
        path: path.to_string_lossy().to_string(),
        width,
        height,
    })
}

#[cfg(not(windows))]
fn capture_window_screenshot(
    _app: &AppHandle,
    _window: &WebviewWindow,
    _label: Option<String>,
) -> Result<ScreenSimulationScreenshot, String> {
    Err("screen simulation screenshots are Windows-only".to_string())
}

#[cfg(windows)]
fn write_bmp(
    file: &mut std::fs::File,
    width: i32,
    height: i32,
    pixels: &[u8],
) -> std::io::Result<()> {
    let header_size = 14_u32 + 40_u32;
    let file_size = header_size + pixels.len() as u32;

    file.write_all(b"BM")?;
    file.write_all(&file_size.to_le_bytes())?;
    file.write_all(&0_u16.to_le_bytes())?;
    file.write_all(&0_u16.to_le_bytes())?;
    file.write_all(&header_size.to_le_bytes())?;

    file.write_all(&40_u32.to_le_bytes())?;
    file.write_all(&width.to_le_bytes())?;
    file.write_all(&(-height).to_le_bytes())?;
    file.write_all(&1_u16.to_le_bytes())?;
    file.write_all(&32_u16.to_le_bytes())?;
    file.write_all(&0_u32.to_le_bytes())?;
    file.write_all(&(pixels.len() as u32).to_le_bytes())?;
    file.write_all(&0_i32.to_le_bytes())?;
    file.write_all(&0_i32.to_le_bytes())?;
    file.write_all(&0_u32.to_le_bytes())?;
    file.write_all(&0_u32.to_le_bytes())?;
    file.write_all(pixels)?;
    Ok(())
}

fn sanitize_label(label: &str) -> String {
    label
        .chars()
        .filter_map(|character| {
            if character.is_ascii_alphanumeric() {
                Some(character.to_ascii_lowercase())
            } else if matches!(character, '-' | '_') {
                Some(character)
            } else if character.is_whitespace() {
                Some('-')
            } else {
                None
            }
        })
        .take(48)
        .collect()
}
