import "./styles.css";
import type { AppData, Block } from "./types";
import {
  clampDisplayLines,
  createBlock,
  DEFAULT_DATA,
  DEFAULT_DISPLAY_LINES,
  MAX_DISPLAY_LINES,
  MIN_DISPLAY_LINES,
  normalizeBlock,
} from "./types";
import {
  applyWindowConfig,
  chooseDataFilePath,
  copyText,
  getDataPathInfo,
  loadData,
  resetDataFilePath,
  saveBlocks,
  setClickThroughPaused,
  setLaunchOnStartup,
  type DataPathInfo,
} from "./storage";

const app = document.querySelector("#app")!;

let data: AppData = structuredClone(DEFAULT_DATA);
let editingId: string | null = null;
let expandedId: string | null = null;
/** 临时撑开（按 0 行显示）的区域 id，不写入持久化 */
const unfoldedIds = new Set<string>();
let currentView: "main" | "settings" = "main";
let dataPathInfo: DataPathInfo = { path: "", isDefault: true };
let toastTimer: number | undefined;
let dragFromIndex: number | null = null;
let suppressNextClick = false;
let copyClickTimer: number | undefined;

const DRAG_THRESHOLD = 6;
const COPY_CLICK_DELAY = 280;

/** 与 ✎ 同重量的线框图标，避免 Unicode 全屏符在部分字体里变形 */
const ICON_EXPAND = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_COLLAPSE = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** 临时撑开 / 折叠行数限制 */
const ICON_UNFOLD = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5h10M8 5.5v7M5 10l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_FOLD = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10.5h10M8 10.5V3.5M5 6l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** 覆盖应用到全部区域 */
const ICON_APPLY_ALL = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M3 8h10M3 11.5h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11 2.5l1.8 1.8L15.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function showToast(message: string) {
  const toast = document.querySelector<HTMLElement>(".toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1400);
}

function applyPanelOpacity(value: number) {
  const alpha = Math.min(1, Math.max(0.4, value));
  document.documentElement.style.setProperty("--panel-opacity", String(alpha));
  const shell = document.querySelector<HTMLElement>(".shell");
  if (shell) shell.style.setProperty("--panel-opacity", String(alpha));
}

async function persist() {
  await saveBlocks(data.blocks, data.window);
}

function moveBlock(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= data.blocks.length || to >= data.blocks.length) {
    return;
  }
  const [item] = data.blocks.splice(from, 1);
  data.blocks.splice(to, 0, item);
  void persist().then(() => render());
}

function clearDragStyles() {
  document.querySelectorAll(".block").forEach((b) => {
    b.classList.remove("dragging", "drag-over", "drag-over-before", "drag-over-after");
  });
  document.body.classList.remove("is-reordering");
  document.querySelector(".drag-ghost")?.remove();
}

function dropTargetFromPoint(
  x: number,
  y: number,
  fromIndex: number,
): { index: number; place: "before" | "after" } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(".block");
  if (!el || el.dataset.index == null) return null;
  const index = Number(el.dataset.index);
  if (index === fromIndex) return null;
  const rect = el.getBoundingClientRect();
  const place = y < rect.top + rect.height / 2 ? "before" : "after";
  return { index, place };
}

function resolveDropIndex(from: number, target: { index: number; place: "before" | "after" }): number {
  let to = target.place === "before" ? target.index : target.index + 1;
  if (from < to) to -= 1;
  return to;
}

function startBlockReorder(blockEl: HTMLElement, fromIndex: number, e: PointerEvent) {
  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let active = false;
  let ghost: HTMLElement | null = null;
  dragFromIndex = fromIndex;

  const title =
    blockEl.querySelector(".block-title-text")?.textContent?.trim() ||
    blockEl.querySelector(".title-input")?.getAttribute("value") ||
    "区域";

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    if (!active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      active = true;
      suppressNextClick = true;
      blockEl.classList.add("dragging");
      document.body.classList.add("is-reordering");
      window.getSelection()?.removeAllRanges();

      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = title;
      document.body.appendChild(ghost);

      try {
        blockEl.setPointerCapture(pointerId);
      } catch {
        /* already captured or unavailable */
      }
    }

    if (ghost) {
      ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 14}px)`;
    }

    document.querySelectorAll(".block").forEach((b) => {
      b.classList.remove("drag-over", "drag-over-before", "drag-over-after");
    });
    const target = dropTargetFromPoint(ev.clientX, ev.clientY, fromIndex);
    if (!target) return;
    const overEl = document.querySelector<HTMLElement>(`.block[data-index="${target.index}"]`);
    overEl?.classList.add("drag-over", target.place === "before" ? "drag-over-before" : "drag-over-after");
  };

  const finish = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", finish, true);
    if (blockEl.hasPointerCapture?.(pointerId)) {
      blockEl.releasePointerCapture(pointerId);
    }

    const from = dragFromIndex;
    const target = active ? dropTargetFromPoint(ev.clientX, ev.clientY, fromIndex) : null;
    dragFromIndex = null;
    clearDragStyles();

    if (active && from !== null && target) {
      moveBlock(from, resolveDropIndex(from, target));
    }

    if (suppressNextClick) {
      window.setTimeout(() => {
        suppressNextClick = false;
      }, 0);
    }
  };

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", finish, true);
}

function renderTitlebar() {
  return `
    <header class="titlebar" data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        <span class="brand-mark" data-tauri-drag-region>Pin</span>
        <span class="brand-name" data-tauri-drag-region>Board</span>
      </div>
      <div class="window-actions">
        <button type="button" class="win-btn${currentView === "settings" ? " active" : ""}" id="btn-settings" title="设置" aria-label="设置" aria-pressed="${currentView === "settings"}">⚙</button>
        <button type="button" class="win-btn" id="btn-minimize" title="最小化" aria-label="最小化">─</button>
        <button type="button" class="win-btn close" id="btn-close" title="关闭" aria-label="关闭">×</button>
      </div>
    </header>
  `;
}

function renderSettings(): string {
  const opacityPct = Math.round(data.window.opacity * 100);
  const pathLabel = dataPathInfo.path || "（未加载）";
  return `
    <div class="settings-page">
      <div class="settings-list">
        <div class="setting-row">
          <div class="setting-meta">
            <span class="setting-name">面板透明度</span>
            <span class="setting-desc">调节面板背景透明度，不挡视线</span>
          </div>
          <div class="setting-control">
            <input type="range" id="opacity-range" min="40" max="100" value="${opacityPct}" aria-label="面板透明度" />
            <span class="setting-value" id="opacity-value">${opacityPct}%</span>
          </div>
        </div>
        <label class="setting-row setting-row-clickable" for="startup-toggle">
          <div class="setting-meta">
            <span class="setting-name">开机启动</span>
            <span class="setting-desc">登录 Windows 后自动运行 PinBoard</span>
          </div>
          <div class="setting-control">
            <span class="switch">
              <input type="checkbox" id="startup-toggle" ${data.window.launchOnStartup ? "checked" : ""} />
              <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
            </span>
          </div>
        </label>
        <label class="setting-row setting-row-clickable" for="click-through-toggle">
          <div class="setting-meta">
            <span class="setting-name">鼠标穿透</span>
            <span class="setting-desc">主界面内容区点击穿透；设置页内仍可正常操作</span>
          </div>
          <div class="setting-control">
            <span class="switch">
              <input type="checkbox" id="click-through-toggle" ${data.window.clickThrough ? "checked" : ""} />
              <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
            </span>
          </div>
        </label>
        <div class="setting-row">
          <div class="setting-meta">
            <span class="setting-name">默认显示行数</span>
            <span class="setting-desc">新建区域初始行数；可一键覆盖到全部已有区域</span>
          </div>
          <div class="setting-control">
            <input
              type="number"
              class="lines-input"
              id="default-lines-input"
              min="${MIN_DISPLAY_LINES}"
              max="${MAX_DISPLAY_LINES}"
              value="${clampDisplayLines(data.window.defaultDisplayLines ?? DEFAULT_DISPLAY_LINES)}"
              title="0 表示显示全部"
              aria-label="默认显示行数"
            />
            <span class="setting-value lines-hint">0=全部</span>
            <button type="button" class="setting-btn icon" id="btn-apply-default-lines" title="应用到全部已有区域" aria-label="应用到全部">${ICON_APPLY_ALL}</button>
          </div>
        </div>
        <div class="setting-row setting-row-stack">
          <div class="setting-meta">
            <span class="setting-name">数据文件路径</span>
            <span class="setting-desc">区域与窗口配置保存位置；更改后会迁移当前数据</span>
          </div>
          <div class="path-box">
            <code class="path-text" title="${escapeAttr(pathLabel)}">${escapeHtml(shortenPath(pathLabel))}</code>
            <div class="path-actions">
              <button type="button" class="setting-btn" id="btn-data-path-change">更改…</button>
              <button type="button" class="setting-btn ghost" id="btn-data-path-reset" ${dataPathInfo.isDefault ? "disabled" : ""}>恢复默认</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMain(): string {
  const expandedIndex = expandedId ? data.blocks.findIndex((b) => b.id === expandedId) : -1;
  const expanded = expandedIndex >= 0 ? data.blocks[expandedIndex] : null;

  if (expanded) {
    return `
      <div class="blocks is-expanded">
        ${renderBlock(expanded, expandedIndex)}
      </div>
    `;
  }

  return `
    <div class="toolbar">
      <button type="button" class="add-btn" id="btn-add">＋ 新增区域</button>
    </div>
    <div class="blocks">
      ${data.blocks.map((b, i) => renderBlock(b, i)).join("") || '<p class="empty">还没有区域，点击上方按钮新增</p>'}
    </div>
  `;
}

function renderBlock(block: Block, index: number): string {
  const isEditing = editingId === block.id;
  const isExpanded = expandedId === block.id;
  const lines = clampDisplayLines(block.displayLines ?? DEFAULT_DISPLAY_LINES);
  const isUnfolded = unfoldedIds.has(block.id);
  const expandClass = isExpanded ? " is-expanded" : "";
  // 放大态 / 临时撑开：忽略行数限制；折叠恢复后仍用已保存 displayLines
  const showClamp = !isExpanded && !isUnfolded && lines > 0;
  const canToggleFold = !isExpanded && (lines > 0 || isUnfolded);

  if (isEditing) {
    return `
      <article class="block editing${expandClass}" data-id="${block.id}" data-index="${index}">
        <div class="block-head">
          <input class="title-input" data-field="title" value="${escapeAttr(block.title)}" placeholder="区域名称" />
          <div class="block-tools">
            ${
              isExpanded
                ? `<button type="button" class="icon-btn" data-action="expand" title="退出放大">${ICON_COLLAPSE}</button>`
                : ""
            }
            <button type="button" class="icon-btn" data-action="save" title="保存">✓</button>
            <button type="button" class="icon-btn danger" data-action="delete" title="删除">🗑</button>
          </div>
        </div>
        <textarea class="content-input" data-field="content" rows="4" placeholder="需要快速复制的文本">${escapeHtml(block.content)}</textarea>
        <div class="block-settings">
          <label class="lines-setting">
            <span>显示行数</span>
            <input
              type="number"
              class="lines-input"
              data-field="displayLines"
              min="${MIN_DISPLAY_LINES}"
              max="${MAX_DISPLAY_LINES}"
              value="${lines}"
              title="0 表示显示全部"
            />
            <span class="lines-hint">0=全部</span>
          </label>
        </div>
      </article>
    `;
  }

  return `
    <article class="block${expandClass}" data-id="${block.id}" data-index="${index}">
      <div class="block-head">
        <button type="button" class="block-title" data-action="copy" aria-label="复制${block.title ? `「${escapeAttr(block.title)}」` : "内容"}">
          <span class="block-title-text">${block.title ? escapeHtml(block.title) : '<span class="title-placeholder">未命名</span>'}</span>
          <span class="copy-pop" role="tooltip">复制</span>
        </button>
        <div class="block-tools">
          ${
            canToggleFold
              ? `<button type="button" class="icon-btn" data-action="fold" title="${isUnfolded ? "折叠行数" : "临时撑开"}" aria-label="${isUnfolded ? "折叠行数" : "临时撑开"}" aria-pressed="${isUnfolded}">${isUnfolded ? ICON_FOLD : ICON_UNFOLD}</button>`
              : ""
          }
          <button type="button" class="icon-btn" data-action="expand" title="${isExpanded ? "退出放大" : "放大铺满"}">${isExpanded ? ICON_COLLAPSE : ICON_EXPAND}</button>
          <button type="button" class="icon-btn" data-action="edit" title="编辑">✎</button>
        </div>
      </div>
      <pre class="block-content${showClamp ? " is-clamped" : ""}"${showClamp ? ` style="--display-lines: ${lines}"` : ""}>${escapeHtml(block.content) || '<span class="placeholder">双击区域或点 ✎ 编辑；拖动标题可排序</span>'}</pre>
    </article>
  `;
}

function render(options: { scrollBlocksToTop?: boolean; ensureVisibleId?: string | null } = {}) {
  const prevScroll = document.querySelector<HTMLElement>(".blocks")?.scrollTop ?? 0;

  app.innerHTML = `
    <div class="shell">
      ${renderTitlebar()}
      <main class="content">
        ${currentView === "settings" ? renderSettings() : renderMain()}
      </main>
      <div class="toast" role="status" aria-live="polite"></div>
    </div>
  `;

  applyPanelOpacity(data.window.opacity);
  bindEvents();
  markTruncatedBlocks();

  const blocksEl = document.querySelector<HTMLElement>(".blocks");
  if (!blocksEl) return;

  if (options.scrollBlocksToTop) {
    blocksEl.scrollTop = 0;
    return;
  }

  blocksEl.scrollTop = prevScroll;
  const focusId = options.ensureVisibleId ?? editingId;
  if (focusId) {
    // nearest：已在可视区则不滚动；仅当编辑态变高被裁切时微调
    blocksEl
      .querySelector<HTMLElement>(`.block[data-id="${CSS.escape(focusId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

/** 限行裁切且内容溢出时标记，用于底部淡出提示 */
function markTruncatedBlocks() {
  document.querySelectorAll<HTMLElement>(".block-content.is-clamped").forEach((el) => {
    el.classList.toggle("is-truncated", el.scrollHeight > el.clientHeight + 1);
  });
}

function bindWindowChrome() {
  document.querySelector("#btn-settings")?.addEventListener("click", () => {
    currentView = currentView === "settings" ? "main" : "settings";
    if (currentView === "settings") {
      editingId = null;
      expandedId = null;
      unfoldedIds.clear();
    }
    void setClickThroughPaused(currentView === "settings");
    render();
  });

  document.querySelector("#btn-minimize")?.addEventListener("click", async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {
      /* browser preview */
    }
  });

  document.querySelector("#btn-close")?.addEventListener("click", async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      window.close();
    }
  });
}

function bindSettingsEvents() {
  document.querySelector("#opacity-range")?.addEventListener("input", async (e) => {
    const value = Number((e.target as HTMLInputElement).value) / 100;
    data.window.opacity = value;
    applyPanelOpacity(value);
    const label = document.querySelector("#opacity-value");
    if (label) label.textContent = `${Math.round(value * 100)}%`;
    await persist();
  });

  document.querySelector("#startup-toggle")?.addEventListener("change", async (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    const previous = data.window.launchOnStartup;
    data.window.launchOnStartup = enabled;
    try {
      await setLaunchOnStartup(enabled);
      await persist();
      showToast(enabled ? "已开启开机启动" : "已关闭开机启动");
    } catch (err) {
      data.window.launchOnStartup = previous;
      (e.target as HTMLInputElement).checked = previous;
      console.error(err);
      showToast("开机启动设置失败");
    }
  });

  document.querySelector("#click-through-toggle")?.addEventListener("change", async (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    const previous = data.window.clickThrough;
    data.window.clickThrough = enabled;
    try {
      await applyWindowConfig(data.window);
      await persist();
      showToast(enabled ? "已开启鼠标穿透" : "已关闭鼠标穿透");
    } catch (err) {
      data.window.clickThrough = previous;
      (e.target as HTMLInputElement).checked = previous;
      console.error(err);
      showToast("鼠标穿透设置失败");
    }
  });

  document.querySelector("#default-lines-input")?.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const value = clampDisplayLines(Number(input.value));
    input.value = String(value);
    data.window.defaultDisplayLines = value;
    await persist();
    showToast(value === 0 ? "新建区域将显示全部" : `新建区域默认 ${value} 行`);
  });

  document.querySelector("#btn-apply-default-lines")?.addEventListener("click", async () => {
    const input = document.querySelector<HTMLInputElement>("#default-lines-input");
    const value = clampDisplayLines(Number(input?.value ?? data.window.defaultDisplayLines));
    if (input) input.value = String(value);
    data.window.defaultDisplayLines = value;
    data.blocks = data.blocks.map((block) => ({
      ...block,
      displayLines: value,
    }));
    unfoldedIds.clear();
    await persist();
    showToast(
      data.blocks.length === 0
        ? "已保存默认行数"
        : value === 0
          ? `已覆盖 ${data.blocks.length} 个区域为全部显示`
          : `已覆盖 ${data.blocks.length} 个区域为 ${value} 行`,
    );
  });

  document.querySelector("#btn-data-path-change")?.addEventListener("click", async () => {
    try {
      dataPathInfo = await chooseDataFilePath(data);
      showToast("数据路径已更新");
      render();
    } catch (err) {
      const message = String(err ?? "");
      if (message.includes("已取消")) return;
      console.error(err);
      showToast("更改路径失败");
    }
  });

  document.querySelector("#btn-data-path-reset")?.addEventListener("click", async () => {
    try {
      dataPathInfo = await resetDataFilePath(data);
      showToast("已恢复默认路径");
      render();
    } catch (err) {
      console.error(err);
      showToast("恢复默认失败");
    }
  });
}

function bindEvents() {
  bindWindowChrome();

  if (currentView === "settings") {
    bindSettingsEvents();
    return;
  }

  document.querySelector("#btn-add")?.addEventListener("click", async () => {
    const block = createBlock("", "", data.window.defaultDisplayLines);
    data.blocks.unshift(block);
    editingId = block.id;
    await persist();
    render({ scrollBlocksToTop: true });
  });

  document.querySelectorAll<HTMLElement>(".block").forEach((el) => {
    const id = el.dataset.id!;
    const index = Number(el.dataset.index);

    el.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => {
      if (suppressNextClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      window.clearTimeout(copyClickTimer);
      copyClickTimer = window.setTimeout(() => {
        void (async () => {
          const block = data.blocks.find((b) => b.id === id);
          if (!block) return;
          try {
            await copyText(block.content);
            const tip = el.querySelector<HTMLElement>(".copy-pop");
            if (tip) {
              tip.textContent = "已复制";
              tip.classList.add("copied");
              window.setTimeout(() => {
                tip.textContent = "点击复制";
                tip.classList.remove("copied");
              }, 1200);
            }
            showToast("复制成功");
          } catch {
            showToast("复制失败");
          }
        })();
      }, COPY_CLICK_DELAY);
    });

    el.querySelector('[data-action="fold"]')?.addEventListener("click", () => {
      window.clearTimeout(copyClickTimer);
      if (unfoldedIds.has(id)) unfoldedIds.delete(id);
      else unfoldedIds.add(id);
      render({ ensureVisibleId: id });
    });

    el.querySelector('[data-action="expand"]')?.addEventListener("click", () => {
      window.clearTimeout(copyClickTimer);
      expandedId = expandedId === id ? null : id;
      render();
    });

    el.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
      window.clearTimeout(copyClickTimer);
      editingId = id;
      render({ ensureVisibleId: id });
    });

    el.addEventListener("dblclick", (e) => {
      if (el.classList.contains("editing")) return;
      const target = e.target as HTMLElement;
      if (target.closest(".icon-btn, input, textarea, .content-input, .title-input, .lines-input")) {
        return;
      }
      e.preventDefault();
      window.clearTimeout(copyClickTimer);
      editingId = id;
      render({ ensureVisibleId: id });
    });

    el.querySelector('[data-action="save"]')?.addEventListener("click", async () => {
      const title = (el.querySelector('[data-field="title"]') as HTMLInputElement).value.trim();
      const content = (el.querySelector('[data-field="content"]') as HTMLTextAreaElement).value;
      const linesRaw = Number((el.querySelector('[data-field="displayLines"]') as HTMLInputElement).value);
      const block = data.blocks.find((b) => b.id === id);
      if (!block) return;
      block.title = title;
      block.content = content;
      block.displayLines = clampDisplayLines(linesRaw);
      unfoldedIds.delete(id);
      editingId = null;
      await persist();
      render();
      showToast("已保存");
    });

    el.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      data.blocks = data.blocks.filter((b) => b.id !== id);
      editingId = null;
      if (expandedId === id) expandedId = null;
      unfoldedIds.delete(id);
      await persist();
      render();
      showToast("已删除");
    });

    el.addEventListener("pointerdown", (e) => {
      if (editingId || expandedId || e.button !== 0 || el.classList.contains("editing")) return;
      const target = e.target as HTMLElement;
      // 正文保留选字；编辑按钮/输入框不启动拖拽
      if (
        target.closest(
          ".block-content, .icon-btn, .block-title, input, textarea, .content-input, .title-input",
        )
      ) {
        return;
      }
      e.preventDefault();
      startBlockReorder(el, index, e);
    });

    // 从标题拖动能排序；短按仍复制（超过阈值后会 suppressNextClick）
    el.querySelector(".block-title")?.addEventListener("pointerdown", (e) => {
      const pe = e as PointerEvent;
      if (editingId || expandedId || pe.button !== 0 || el.classList.contains("editing")) return;
      startBlockReorder(el, index, pe);
    });
  });
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replaceAll("'", "&#39;");
}

function shortenPath(path: string, max = 44): string {
  if (path.length <= max) return path;
  const keep = Math.max(10, Math.floor((max - 3) / 2));
  return `${path.slice(0, keep)}...${path.slice(-keep)}`;
}

async function rememberWindowSize() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const factor = await win.scaleFactor();
    const physical = await win.innerSize();
    const width = Math.round(physical.width / factor);
    const height = Math.round(physical.height / factor);
    // 避免最小化/异常尺寸被写进配置，导致下次只剩标题栏
    if (width < 300 || height < 200) return;
    data.window.width = width;
    data.window.height = height;
    await persist();
  } catch {
    /* browser preview */
  }
}

async function boot() {
  try {
    data = await loadData();
    if (!data.blocks) data.blocks = structuredClone(DEFAULT_DATA.blocks);
    else data.blocks = data.blocks.map((b) => normalizeBlock(b));
    if (!data.window) data.window = structuredClone(DEFAULT_DATA.window);
    data.window.width = Math.max(300, data.window.width || 360);
    data.window.height = Math.max(360, data.window.height || 520);
    data.window.opacity = Math.min(1, Math.max(0.4, data.window.opacity || 0.96));
    data.window.launchOnStartup = Boolean(data.window.launchOnStartup);
    data.window.clickThrough = Boolean(data.window.clickThrough);
    data.window.defaultDisplayLines = clampDisplayLines(
      data.window.defaultDisplayLines ?? DEFAULT_DISPLAY_LINES,
    );
    try {
      dataPathInfo = await getDataPathInfo();
    } catch {
      dataPathInfo = { path: "", isDefault: true };
    }
    await applyWindowConfig(data.window);

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      let resizeTimer: number | undefined;
      await win.onResized(() => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          void rememberWindowSize();
        }, 400);
      });
    } catch {
      /* browser preview */
    }
  } catch (err) {
    console.error(err);
    data = structuredClone(DEFAULT_DATA);
  }
  render();
}

void boot();
