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
    #[serde(default)]
    pub launch_on_startup: bool,
    /// 鼠标穿透：点击落到下层窗口；标题栏仍可交互以便关闭
    #[serde(default)]
    pub click_through: bool,
    /// 新建区域时的默认显示行数；0 表示显示全部
    #[serde(default = "default_display_lines")]
    pub default_display_lines: u32,
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
                launch_on_startup: false,
                click_through: false,
                default_display_lines: 0,
            },
        }
    }
}

struct AppState {
    data_path: Mutex<PathBuf>,
    click_through: Mutex<bool>,
    /// 设置页等需要整窗可点时暂停穿透（不改动已保存偏好）
    click_through_paused: Mutex<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    /// 自定义数据文件路径；空 / 缺省则使用应用数据目录下的 pinboard.json
    #[serde(default)]
    data_file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataPathInfo {
    path: String,
    is_default: bool,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录: {e}"))?;
    Ok(dir)
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("config.json"))
}

fn default_data_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("pinboard.json"))
}

fn read_config(app: &AppHandle) -> AppConfig {
    let Ok(path) = config_file_path(app) else {
        return AppConfig::default();
    };
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

fn write_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_file_path(app)?;
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| format!("写入配置失败: {e}"))
}

fn resolve_data_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config = read_config(app);
    if let Some(custom) = config.data_file_path {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    default_data_file_path(app)
}

fn data_path_info(app: &AppHandle) -> Result<DataPathInfo, String> {
    let path = resolve_data_file_path(app)?;
    let default = default_data_file_path(app)?;
    Ok(DataPathInfo {
        path: path.to_string_lossy().into_owned(),
        is_default: paths_equal(&path, &default),
    })
}

fn paths_equal(a: &PathBuf, b: &PathBuf) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

fn ensure_parent_dir(path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {e}"))?;
        }
    }
    Ok(())
}

fn set_active_data_path(
    app: &AppHandle,
    state: &State<'_, AppState>,
    path: PathBuf,
    data: &AppData,
    custom: bool,
) -> Result<DataPathInfo, String> {
    ensure_parent_dir(&path)?;
    write_data(&path, data)?;

    let default = default_data_file_path(app)?;
    let config = AppConfig {
        data_file_path: if custom && !paths_equal(&path, &default) {
            Some(path.to_string_lossy().into_owned())
        } else {
            None
        },
    };
    write_config(app, &config)?;

    *state.data_path.lock().map_err(|e| e.to_string())? = path.clone();
    data_path_info(app)
}

fn read_data(path: &PathBuf) -> AppData {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => AppData::default(),
    }
}

fn write_data(path: &PathBuf, data: &AppData) -> Result<(), String> {
    ensure_parent_dir(path)?;
    let raw = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| format!("写入失败: {e}"))
}

#[tauri::command]
fn load_data(app: AppHandle, state: State<'_, AppState>) -> Result<AppData, String> {
    let path = resolve_data_file_path(&app)?;
    *state.data_path.lock().map_err(|e| e.to_string())? = path.clone();
    Ok(read_data(&path))
}

#[tauri::command]
fn save_data(app: AppHandle, state: State<'_, AppState>, data: AppData) -> Result<(), String> {
    let path = {
        let mut guard = state.data_path.lock().map_err(|e| e.to_string())?;
        if guard.as_os_str().is_empty() {
            *guard = resolve_data_file_path(&app)?;
        }
        guard.clone()
    };
    write_data(&path, &data)
}

#[tauri::command]
fn get_data_path_info(app: AppHandle) -> Result<DataPathInfo, String> {
    data_path_info(&app)
}

#[tauri::command]
fn choose_data_file_path(
    app: AppHandle,
    state: State<'_, AppState>,
    data: AppData,
) -> Result<DataPathInfo, String> {
    let current = resolve_data_file_path(&app)?;
    let picked = pick_save_json_path(&app, &current)?.ok_or_else(|| "已取消".to_string())?;
    set_active_data_path(&app, &state, picked, &data, true)
}

#[tauri::command]
fn reset_data_file_path(
    app: AppHandle,
    state: State<'_, AppState>,
    data: AppData,
) -> Result<DataPathInfo, String> {
    let default = default_data_file_path(&app)?;
    set_active_data_path(&app, &state, default, &data, false)
}

/// Win32 另存为对话框，选择 pinboard.json 保存位置
#[cfg(windows)]
fn pick_save_json_path(app: &AppHandle, current: &PathBuf) -> Result<Option<PathBuf>, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    const OFN_EXPLORER: u32 = 0x00080000;
    const OFN_PATHMUSTEXIST: u32 = 0x00000800;
    const OFN_OVERWRITEPROMPT: u32 = 0x00000002;
    const OFN_HIDEREADONLY: u32 = 0x00000004;
    const MAX_PATH_BUF: usize = 1024;

    #[repr(C)]
    struct OpenFileNameW {
        l_struct_size: u32,
        hwnd_owner: *mut core::ffi::c_void,
        h_instance: *mut core::ffi::c_void,
        lpstr_filter: *const u16,
        lpstr_custom_filter: *mut u16,
        n_max_cust_filter: u32,
        n_filter_index: u32,
        lpstr_file: *mut u16,
        n_max_file: u32,
        lpstr_file_title: *mut u16,
        n_max_file_title: u32,
        lpstr_initial_dir: *const u16,
        lpstr_title: *const u16,
        flags: u32,
        n_file_offset: u16,
        n_file_extension: u16,
        lpstr_def_ext: *const u16,
        l_cust_data: isize,
        lpfn_hook: *mut core::ffi::c_void,
        lp_template_name: *const u16,
        pv_reserved: *mut core::ffi::c_void,
        dw_reserved: u32,
        flags_ex: u32,
    }

    #[link(name = "comdlg32")]
    extern "system" {
        fn GetSaveFileNameW(ofn: *mut OpenFileNameW) -> i32;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    let hwnd = app
        .get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as *mut core::ffi::c_void)
        .unwrap_or(std::ptr::null_mut());

    let filter = to_wide("JSON 文件 (*.json)\0*.json\0所有文件 (*.*)\0*.*\0");
    let title = to_wide("选择数据文件保存位置");
    let def_ext = to_wide("json");

    let initial_name = current
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("pinboard.json");
    let initial_dir = current
        .parent()
        .map(|p| to_wide(&p.to_string_lossy()))
        .unwrap_or_else(|| to_wide(""));

    let mut file_buf: Vec<u16> = Vec::with_capacity(MAX_PATH_BUF);
    file_buf.extend(OsStr::new(initial_name).encode_wide());
    file_buf.resize(MAX_PATH_BUF, 0);

    let mut ofn: OpenFileNameW = unsafe { std::mem::zeroed() };
    ofn.l_struct_size = std::mem::size_of::<OpenFileNameW>() as u32;
    ofn.hwnd_owner = hwnd;
    ofn.lpstr_filter = filter.as_ptr();
    ofn.n_filter_index = 1;
    ofn.lpstr_file = file_buf.as_mut_ptr();
    ofn.n_max_file = MAX_PATH_BUF as u32;
    ofn.lpstr_initial_dir = if initial_dir.len() > 1 {
        initial_dir.as_ptr()
    } else {
        std::ptr::null()
    };
    ofn.lpstr_title = title.as_ptr();
    ofn.flags = OFN_EXPLORER | OFN_PATHMUSTEXIST | OFN_OVERWRITEPROMPT | OFN_HIDEREADONLY;
    ofn.lpstr_def_ext = def_ext.as_ptr();

    let ok = unsafe { GetSaveFileNameW(&mut ofn) };
    if ok == 0 {
        return Ok(None);
    }

    let len = file_buf.iter().position(|&c| c == 0).unwrap_or(file_buf.len());
    let path = PathBuf::from(std::ffi::OsString::from_wide(&file_buf[..len]));
    Ok(Some(path))
}

#[cfg(not(windows))]
fn pick_save_json_path(_app: &AppHandle, _current: &PathBuf) -> Result<Option<PathBuf>, String> {
    Err("当前平台暂不支持选择数据路径".into())
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

    {
        let state = app.state::<AppState>();
        *state
            .click_through
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = config.click_through;
        let paused = *state
            .click_through_paused
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // 穿透开启时标题栏命中检测线程会按光标位置微调；设置页暂停时整窗可点
        let _ = window.set_ignore_cursor_events(config.click_through && !paused);
    }
    Ok(())
}

/// 临时暂停鼠标穿透（设置页打开时），不修改已保存的 clickThrough 偏好
#[tauri::command]
fn set_click_through_paused(app: AppHandle, paused: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state
        .click_through_paused
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = paused;

    let enabled = *state
        .click_through
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_ignore_cursor_events(enabled && !paused);
    }
    Ok(())
}

/// 与前端 `.titlebar` 高度一致（逻辑像素）
const TITLEBAR_HIT_HEIGHT_LOGICAL: f64 = 42.0;

/// 鼠标穿透开启时：光标在标题栏则接收事件，否则穿透到下层窗口
#[cfg(windows)]
fn start_click_through_tracker(app: AppHandle) {
    std::thread::spawn(move || {
        #[link(name = "user32")]
        extern "system" {
            fn GetCursorPos(point: *mut Point) -> i32;
        }

        #[repr(C)]
        struct Point {
            x: i32,
            y: i32,
        }

        let mut last_ignore: Option<bool> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(32));

            let (enabled, paused) = {
                let state = app.state::<AppState>();
                let enabled = *state
                    .click_through
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                let paused = *state
                    .click_through_paused
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                (enabled, paused)
            };

            let should_ignore = if !enabled || paused {
                false
            } else {
                let Some(window) = app.get_webview_window("main") else {
                    continue;
                };
                let Ok(pos) = window.outer_position() else {
                    continue;
                };
                let Ok(size) = window.outer_size() else {
                    continue;
                };
                let scale = window.scale_factor().unwrap_or(1.0);
                let titlebar_h = (TITLEBAR_HIT_HEIGHT_LOGICAL * scale).round().max(1.0) as i32;

                let mut pt = Point { x: 0, y: 0 };
                let ok = unsafe { GetCursorPos(&mut pt) };
                if ok == 0 {
                    continue;
                }

                let over_titlebar = pt.x >= pos.x
                    && pt.x < pos.x + size.width as i32
                    && pt.y >= pos.y
                    && pt.y < pos.y + titlebar_h;
                !over_titlebar
            };

            if last_ignore == Some(should_ignore) {
                continue;
            }
            last_ignore = Some(should_ignore);

            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.set_ignore_cursor_events(should_ignore);
                }
            });
        }
    });
}

#[cfg(not(windows))]
fn start_click_through_tracker(_app: AppHandle) {}

#[tauri::command]
fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    apply_launch_on_startup(enabled)
}

/// 开机启动：写入 / 删除 HKCU\...\Run 中的 PinBoard 项
#[cfg(windows)]
fn apply_launch_on_startup(enabled: bool) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    const HKEY_CURRENT_USER: *mut core::ffi::c_void = 0x8000_0001u32 as usize as *mut _;
    const KEY_SET_VALUE: u32 = 0x0002;
    const KEY_QUERY_VALUE: u32 = 0x0001;
    const REG_OPTION_NON_VOLATILE: u32 = 0;
    const REG_SZ: u32 = 1;
    const ERROR_SUCCESS: i32 = 0;
    const ERROR_FILE_NOT_FOUND: i32 = 2;

    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(
            hkey: *mut core::ffi::c_void,
            sub_key: *const u16,
            options: u32,
            sam_desired: u32,
            result: *mut *mut core::ffi::c_void,
        ) -> i32;
        fn RegSetValueExW(
            hkey: *mut core::ffi::c_void,
            value_name: *const u16,
            reserved: u32,
            value_type: u32,
            data: *const u8,
            data_len: u32,
        ) -> i32;
        fn RegDeleteValueW(hkey: *mut core::ffi::c_void, value_name: *const u16) -> i32;
        fn RegCloseKey(hkey: *mut core::ffi::c_void) -> i32;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    let sub_key = to_wide(r"Software\Microsoft\Windows\CurrentVersion\Run");
    let value_name = to_wide("PinBoard");

    let mut hkey: *mut core::ffi::c_void = std::ptr::null_mut();
    let open = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            sub_key.as_ptr(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE | KEY_QUERY_VALUE,
            &mut hkey,
        )
    };
    if open != ERROR_SUCCESS {
        return Err(format!("无法打开开机启动注册表项: {open}"));
    }

    let result = if enabled {
        let exe = std::env::current_exe().map_err(|e| format!("无法获取程序路径: {e}"))?;
        let exe_str = exe.to_string_lossy();
        let command = if exe_str.contains(' ') {
            format!("\"{exe_str}\"")
        } else {
            exe_str.into_owned()
        };
        let wide = to_wide(&command);
        let bytes = unsafe {
            std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2)
        };
        let status = unsafe {
            RegSetValueExW(
                hkey,
                value_name.as_ptr(),
                0,
                REG_SZ,
                bytes.as_ptr(),
                bytes.len() as u32,
            )
        };
        if status == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(format!("写入开机启动失败: {status}"))
        }
    } else {
        let status = unsafe { RegDeleteValueW(hkey, value_name.as_ptr()) };
        if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(format!("删除开机启动失败: {status}"))
        }
    };

    unsafe {
        RegCloseKey(hkey);
    }
    result
}

#[cfg(not(windows))]
fn apply_launch_on_startup(_enabled: bool) -> Result<(), String> {
    Err("当前平台不支持开机启动设置".into())
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

/// 全局快捷键 Ctrl+Shift+P 显示/隐藏（Win32 RegisterHotKey，无额外 crate）
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
            click_through: Mutex::new(false),
            click_through_paused: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            copy_text,
            apply_window_config,
            set_click_through_paused,
            set_launch_on_startup,
            get_data_path_info,
            choose_data_file_path,
            reset_data_file_path
        ])
        .setup(|app| {
            let path = resolve_data_file_path(app.handle())?;
            let data = read_data(&path);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
                let width = data.window.width.max(300.0);
                let height = data.window.height.max(360.0);
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
                let _ = window.set_always_on_top(data.window.always_on_top);
                let _ = window.set_ignore_cursor_events(data.window.click_through);
            }

            {
                let state = app.state::<AppState>();
                *state
                    .click_through
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = data.window.click_through;
            }

            // 启动时按已保存偏好同步注册表（安装路径变更后也能纠正）
            if let Err(err) = apply_launch_on_startup(data.window.launch_on_startup) {
                eprintln!("PinBoard: 同步开机启动失败: {err}");
            }

            start_click_through_tracker(app.handle().clone());
            start_toggle_hotkey(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PinBoard");
}
