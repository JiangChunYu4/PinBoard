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

export async function saveBlocks(blocks: Block[], window: WindowConfig): Promise<void> {
  await saveData({ blocks, window });
}
