use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(default = "default_display_lines")]
    pub display_lines: u32,
}

fn default_display_lines() -> u32 {
    0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    pub width: f64,
    pub height: f64,
    pub opacity: f64,
    pub always_on_top: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppData {
    pub blocks: Vec<Block>,
    pub window: WindowConfig,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            blocks: vec![
                Block {
                    id: "block-git".into(),
                    title: "Git".into(),
                    content: "git pull origin main".into(),
                    display_lines: 0,
                },
                Block {
                    id: "block-docker".into(),
                    title: "Docker".into(),
                    content: "docker compose up -d".into(),
                    display_lines: 0,
                },
                Block {
                    id: "block-ssh".into(),
                    title: "SSH".into(),
                    content: "ssh user@server".into(),
                    display_lines: 0,
                },
            ],
            window: WindowConfig {
                width: 360.0,
                height: 520.0,
                opacity: 0.96,
                always_on_top: true,
            },
        }
    }
}

struct AppState {
    data_path: Mutex<PathBuf>,
}

fn data_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录: {e}"))?;
    Ok(dir.join("pinboard.json"))
}

fn read_data(path: &PathBuf) -> AppData {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => AppData::default(),
    }
}

fn write_data(path: &PathBuf, data: &AppData) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| format!("写入失败: {e}"))
}

#[tauri::command]
fn load_data(app: AppHandle, state: State<'_, AppState>) -> Result<AppData, String> {
    let path = data_file_path(&app)?;
    *state.data_path.lock().map_err(|e| e.to_string())? = path.clone();
    Ok(read_data(&path))
}

#[tauri::command]
fn save_data(app: AppHandle, state: State<'_, AppState>, data: AppData) -> Result<(), String> {
    let path = {
        let mut guard = state.data_path.lock().map_err(|e| e.to_string())?;
        if guard.as_os_str().is_empty() {
            *guard = data_file_path(&app)?;
        }
        guard.clone()
    };
    write_data(&path, &data)
}

#[tauri::command]
fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("复制失败: {e}"))
}

#[tauri::command]
fn apply_window_config(app: AppHandle, config: WindowConfig) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;

    let width = config.width.max(300.0);
    let height = config.height.max(360.0);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
    let _ = window.set_always_on_top(config.always_on_top);
    let _ = config.opacity;
    Ok(())
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if visible && !minimized {
        let _ = window.hide();
    } else {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 6.1 全局快捷键 Ctrl+Shift+P 显示/隐藏（Win32 RegisterHotKey，无额外 crate）
#[cfg(windows)]
fn start_toggle_hotkey(app: AppHandle) {
    std::thread::spawn(move || {
        const MOD_CONTROL: u32 = 0x0002;
        const MOD_SHIFT: u32 = 0x0004;
        const MOD_NOREPEAT: u32 = 0x4000;
        const VK_P: u32 = 0x50;
        const WM_HOTKEY: u32 = 0x0312;
        const HOTKEY_ID: i32 = 0x5042; // 'PB'

        #[repr(C)]
        struct Point {
            x: i32,
            y: i32,
        }

        #[repr(C)]
        struct Msg {
            hwnd: *mut core::ffi::c_void,
            message: u32,
            w_param: usize,
            l_param: isize,
            time: u32,
            pt: Point,
        }

        #[link(name = "user32")]
        extern "system" {
            fn RegisterHotKey(
                hwnd: *mut core::ffi::c_void,
                id: i32,
                fs_modifiers: u32,
                vk: u32,
            ) -> i32;
            fn UnregisterHotKey(hwnd: *mut core::ffi::c_void, id: i32) -> i32;
            fn GetMessageW(
                msg: *mut Msg,
                hwnd: *mut core::ffi::c_void,
                min: u32,
                max: u32,
            ) -> i32;
            fn TranslateMessage(msg: *const Msg) -> i32;
            fn DispatchMessageW(msg: *const Msg) -> isize;
        }

        unsafe {
            let ok = RegisterHotKey(
                std::ptr::null_mut(),
                HOTKEY_ID,
                MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT,
                VK_P,
            );
            if ok == 0 {
                eprintln!("PinBoard: Ctrl+Shift+P 注册失败（可能已被占用）");
                return;
            }

            let mut msg: Msg = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                if msg.message == WM_HOTKEY && msg.w_param == HOTKEY_ID as usize {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        toggle_main_window(&handle);
                    });
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID);
        }
    });
}

#[cfg(not(windows))]
fn start_toggle_hotkey(_app: AppHandle) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            data_path: Mutex::new(PathBuf::new()),
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            copy_text,
            apply_window_config
        ])
        .setup(|app| {
            let path = data_file_path(app.handle())?;
            let data = read_data(&path);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
                let width = data.window.width.max(300.0);
                let height = data.window.height.max(360.0);
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
                let _ = window.set_always_on_top(data.window.always_on_top);
            }

            start_toggle_hotkey(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PinBoard");
}
