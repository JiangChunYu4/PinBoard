import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";

type Phase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing";

/** Updates own only their DOM, so background checks never replace an active editor. */
export function createUpdater(hooks: {
  save: () => Promise<void>;
  pauseClickThrough: (paused: boolean) => Promise<void>;
}) {
  let phase: Phase = "idle";
  let update: Update | null = null;
  let version = "";
  let error = "";
  let checked = false;
  let opened = false;
  let received = 0;
  let total: number | undefined;
  let previousFocus: HTMLElement | null = null;
  let downloaded = false;

  const busy = () => ["checking", "downloading", "installing"].includes(phase);
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const status = () => {
    if (phase === "checking") return "正在检查更新…";
    if (phase === "downloading") return total
      ? `正在下载 ${Math.min(100, Math.round(received / total * 100))}%`
      : `正在下载 ${(received / 1024 / 1024).toFixed(1)} MB`;
    if (phase === "ready") return "下载完成，安装后将自动重启";
    if (phase === "installing") return "正在安装，即将自动重启…";
    if (update) return `发现新版本 v${update.version}`;
    return checked ? "当前已是最新版本" : "启动后自动检查，也可手动检查更新";
  };

  function refresh() {
    const button = document.querySelector<HTMLButtonElement>("#btn-update");
    if (button) {
      button.hidden = !update;
      button.setAttribute("aria-label", update ? `发现新版本 v${update.version}，查看更新` : "软件更新");
    }
    const settings = document.querySelector<HTMLElement>("#update-settings");
    if (settings) {
      settings.innerHTML = `<div class="setting-meta"><span class="setting-name">软件更新${version ? ` · v${escape(version)}` : ""}</span>
        <span class="setting-desc">${escape(error || status())}</span></div>
        <button type="button" class="setting-btn" id="btn-check-update" ${busy() ? "disabled" : ""}>${update ? "查看更新" : "检查更新"}</button>`;
      settings.querySelector("button")?.addEventListener("click", () => void open(!update));
    }
    const host = document.querySelector<HTMLElement>("#update-overlay");
    if (!host) return;
    host.hidden = !opened;
    for (const child of Array.from(host.parentElement?.children ?? [])) {
      if (child !== host && child instanceof HTMLElement) child.inert = opened;
    }
    if (!opened) { host.innerHTML = ""; return; }
    // Keep the dialog and its buttons in place while progress changes (keyboard focus).
    if (!host.firstElementChild) {
      host.innerHTML = `<section class="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title" tabindex="-1">
        <h2 id="update-title">软件更新</h2><p class="update-current"></p>
        <p class="update-status" role="status" aria-live="polite"></p>
        <progress class="update-progress" max="100" aria-label="更新下载进度"></progress>
        <pre class="update-notes"></pre><p class="update-error" role="alert"></p>
        <div class="update-actions"><button type="button" class="setting-btn ghost" id="update-dismiss">稍后</button>
        <button type="button" class="setting-btn" id="update-action"></button></div></section>`;
      host.querySelector("#update-dismiss")?.addEventListener("click", () => void close());
      host.querySelector("#update-action")?.addEventListener("click", () => void act());
      host.addEventListener("keydown", trapFocus);
      host.querySelector<HTMLElement>(".update-dialog")?.focus();
    }
    host.querySelector(".update-current")!.textContent = version ? `当前版本 v${version}` : "";
    host.querySelector(".update-status")!.textContent = status();
    const notes = host.querySelector<HTMLElement>(".update-notes")!;
    notes.hidden = !update;
    notes.textContent = update?.body || "此版本暂无更新说明";
    host.querySelector(".update-error")!.textContent = error;
    const progress = host.querySelector<HTMLProgressElement>("progress")!;
    progress.hidden = phase !== "downloading";
    if (total) progress.value = Math.min(100, received / total * 100);
    else progress.removeAttribute("value");
    const action = host.querySelector<HTMLButtonElement>("#update-action")!;
    action.disabled = busy();
    action.textContent = phase === "ready" ? "安装并重启" : update ? "立即更新" : "重新检查";
    host.querySelector<HTMLButtonElement>("#update-dismiss")!.disabled = phase === "installing";
  }

  function trapFocus(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); void close(); }
    if (event.key !== "Tab") return;
    const host = document.querySelector("#update-overlay");
    const buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length) { event.preventDefault(); return; }
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
  }

  async function open(manualCheck = false) {
    if (!opened) {
      try { await hooks.pauseClickThrough(true); }
      catch { return; }
      previousFocus = document.activeElement as HTMLElement;
      opened = true;
    }
    refresh();
    if (manualCheck) await checkForUpdates();
  }

  async function close() {
    if (phase === "installing") return;
    opened = false;
    refresh();
    previousFocus?.focus();
    await hooks.pauseClickThrough(false);
  }

  async function checkForUpdates() {
    if (busy()) return;
    if (!("__TAURI_INTERNALS__" in window)) {
      error = "请在已安装的 PinBoard 中检查更新";
      refresh();
      return;
    }
    phase = "checking";
    error = "";
    refresh();
    try {
      const next = await check({ timeout: 20000 });
      await update?.close();
      update = next;
      downloaded = false;
      checked = true;
      phase = next ? "available" : "idle";
    } catch (err) {
      console.error("Update check failed", err);
      error = "检查更新失败，请确认能连接 GitHub 后重试";
      phase = update ? "available" : "idle";
    }
    refresh();
  }

  async function act() {
    if (busy()) return;
    if (!update) { await checkForUpdates(); return; }
    error = "";
    try {
      if (!downloaded) {
        phase = "downloading";
        received = 0;
        total = undefined;
        refresh();
        await update.download((event) => {
          if (event.event === "Started") total = event.data.contentLength;
          if (event.event === "Progress") received += event.data.chunkLength;
          refresh();
        });
        downloaded = true;
        phase = "ready";
      } else {
        phase = "installing";
        refresh();
        // Windows updater exits this process to run NSIS and relaunches the app.
        await hooks.save();
        // Retry with a fresh download if launching the native installer fails.
        downloaded = false;
        await update.install();
      }
    } catch (err) {
      console.error("Update failed", err);
      const message = phase === "installing" ? "保存数据或安装失败，请重试" : "下载或签名验证失败，请重试";
      error = message;
      phase = downloaded ? "ready" : "available";
    }
    refresh();
  }

  return {
    mount() {
      document.querySelector("#btn-update")?.addEventListener("click", () => void open());
      refresh();
    },
    async start() {
      if (!("__TAURI_INTERNALS__" in window)) return;
      try { version = await getVersion(); } catch { /* version is optional in preview */ }
      await checkForUpdates();
      // Long-running pinned windows also discover releases without restarting.
      window.setInterval(() => { if (!busy() && !update) void checkForUpdates(); }, 6 * 60 * 60 * 1000);
    },
  };
}
