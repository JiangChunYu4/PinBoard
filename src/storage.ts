import { invoke } from "@tauri-apps/api/core";
import type { AppData, Block, WindowConfig } from "./types";
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

export async function applyWindowConfig(config: WindowConfig): Promise<void> {
  if (!isTauri()) return;
  await invoke("apply_window_config", { config });
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

export async function saveBlocks(blocks: Block[], window: WindowConfig): Promise<void> {
  await saveData({ blocks, window });
}
