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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PinBoard");
}
