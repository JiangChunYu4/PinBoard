import { invoke } from "@tauri-apps/api/core";
import type { AppData, DockSide, WindowConfig } from "./types";
import { DEFAULT_DATA } from "./types";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function loadData(): Promise<AppData> {
  if (!isTauri()) {
    const raw = localStorage.getItem("pinboard-data");
    if (!raw) return structuredClone(DEFAULT_DATA);
    return { ...structuredClone(DEFAULT_DATA), ...JSON.parse(raw) };
  }
  return invoke<AppData>("load_data");
}

export async function saveData(data: AppData): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem("pinboard-data", JSON.stringify(data));
    return;
  }
  await invoke("save_data", { data });
}

export async function copyText(text: string): Promise<void> {
  if (!isTauri()) {
    await navigator.clipboard.writeText(text);
    return;
  }
  await invoke("copy_text", { text });
}

export async function applyWindowConfig(config: WindowConfig): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("apply_window_config", { config });
}

/** 窗口几何 + 所在显示器边界（带 Px 后缀的是物理像素） */
export interface WindowSnapshot {
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  width: number;
  height: number;
  monitorX: number;
  monitorY: number;
  monitorWidth: number;
  monitorHeight: number;
  scaleFactor: number;
}

export async function getWindowSnapshot(): Promise<WindowSnapshot | null> {
  if (!isTauri()) return null;
  return invoke<WindowSnapshot>("window_snapshot");
}

/** 收成细边：宽度 10px、高度不变，贴住该侧屏幕边缘 */
export async function dockWindow(side: DockSide): Promise<void> {
  if (!isTauri()) return;
  await invoke("dock_window", { side });
}

/** 展开回原尺寸与位置；位置不在任何显示器内时居中 */
export async function undockWindow(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<void> {
  if (!isTauri()) return;
  await invoke("undock_window", bounds);
}

export async function setLaunchOnStartup(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_launch_on_startup", { enabled });
}

/** 设置页打开时暂停穿透，离开后恢复（不改偏好） */
export async function setClickThroughPaused(paused: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_click_through_paused", { paused });
}

/** 只切换穿透开关，不重新套用窗口几何（避免位置被夹动） */
export async function setClickThrough(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_click_through", { enabled });
}

/** 系统光标是否落在窗口内（穿透时 WebView 收不到指针事件） */
export async function isCursorInsideWindow(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("cursor_inside_window");
}

export interface DataPathInfo {
  path: string;
  isDefault: boolean;
}

export async function getDataPathInfo(): Promise<DataPathInfo> {
  if (!isTauri()) {
    return { path: "浏览器本地存储", isDefault: true };
  }
  return invoke<DataPathInfo>("get_data_path_info");
}

export async function chooseDataFilePath(data: AppData): Promise<DataPathInfo> {
  if (!isTauri()) {
    throw new Error("浏览器预览不支持更改路径");
  }
  return invoke<DataPathInfo>("choose_data_file_path", { data });
}

export async function resetDataFilePath(data: AppData): Promise<DataPathInfo> {
  if (!isTauri()) {
    return { path: "浏览器本地存储", isDefault: true };
  }
  return invoke<DataPathInfo>("reset_data_file_path", { data });
}
