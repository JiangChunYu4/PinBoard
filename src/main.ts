import "./styles.css";
import { createUpdater } from "./updater";
import type { AppData, Block, RecentCopy } from "./types";
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
  saveData,
  setClickThroughPaused,
  setLaunchOnStartup,
  type DataPathInfo,
} from "./storage";

const app = document.querySelector("#app")!;

let data: AppData = structuredClone(DEFAULT_DATA);
let editingId: string | null = null;
let expandedId: string | null = null;
/** 编辑中的子区域草稿；null = 纯文本编辑模式（结构操作与保存前会先刷回 block） */
let subsDraft: string[] | null = null;
/** 进入放大/编辑铺满前的列表滚动位置，还原时恢复 */
let listScrollSnapshot: number | null = null;
/** 临时撑开（按 0 行显示）的区域 id，不写入持久化 */
const unfoldedIds = new Set<string>();
let currentView: "main" | "settings" = "main";
let dataPathInfo: DataPathInfo = { path: "", isDefault: true };
let toastTimer: number | undefined;
let dragFromIndex: number | null = null;
let suppressNextClick = false;
let copyClickTimer: number | undefined;
/** 搜索关键词：仅在内存中，不持久化，重启复位 */
let searchQuery = "";
/** 全局 Ctrl+F 监听只绑定一次，避免每次 render 重复挂载 */
let searchHotkeyBound = false;

/** 最近复制：最多 5 条，随区域数据一起持久化 */
const RECENT_COPIES_LIMIT = 5;
const recentCopies: RecentCopy[] = [];

const updater = createUpdater({
  async save() {
    // Include the current draft even if the editor's save button was not clicked.
    flushEditingDraft();
    await persist();
  },
  async pauseClickThrough(paused) {
    if (paused) {
      tipResumeCleanup?.();
      tipResumeCleanup = null;
    }
    await setClickThroughPaused(paused || currentView === "settings");
  },
});

const DRAG_THRESHOLD = 6;
const COPY_CLICK_DELAY = 280;
/** 单击容差：位移小于该值视为单击（非拖动/拖选） */
const SUB_CLICK_TOLERANCE = 4;
const COPY_TIP_CONTENT = "复制内容";
const COPY_TIP_TITLE = "复制标题";
let ctrlHeld = false;
let copyTipChromeBound = false;

/** 与放大/折叠同重的线框图标，避免 Unicode 字形在不同字体里变形 */
const ICON_EXPAND = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_COLLAPSE = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** 临时撑开 / 折叠行数限制 */
const ICON_UNFOLD = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5h10M8 5.5v7M5 10l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_FOLD = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10.5h10M8 10.5V3.5M5 6l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** 覆盖应用到全部区域 */
const ICON_APPLY_ALL = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M3 8h10M3 11.5h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11 2.5l1.8 1.8L15.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** 编辑态功能图标：统一线性 SVG（stroke 1.5 / 16 视框），替换原先的 emoji 字形 */
const ICON_CHECK = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.6l3.1 3.1L12.8 4.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_TRASH = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 4.5h9.6M6.4 4.5V3h3.2v1.5M4.7 4.5l.6 8a1 1 0 0 0 1 .9h3.4a1 1 0 0 0 1-.9l.6-8M6.9 7v4M9.1 7v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_PENCIL = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.8 2.7l1.5 1.5-8.1 8.1-2.2.5.5-2.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 4l1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const ICON_ARROW_UP = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.6M4.5 7.1L8 3.5l3.5 3.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_ARROW_DOWN = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v9.4M4.5 8.9L8 12.5l3.5-3.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_CLOSE = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

/** 搜索：放大镜，与其余功能图标同一套 stroke 1.5 线性风格 */
const ICON_SEARCH = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.1 10.1l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
/** 组织方式切换（整段文本 ↔ 子区域）：两种模式下共用同一枚图标，动作名由气泡说明 */
const ICON_LAYOUT_SWITCH = `<svg class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5.5h9M9 3l2.5 2.5L9 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 10.5h-9M7 8l-2.5 2.5L7 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

type TipAlign = "start" | "center" | "end";

/**
 * 自定义气泡提示（与区域标题「复制」同款，避免系统 title 风格不一致）
 * above=true 时气泡改在元素上方，用于贴近容器底部的按钮（避免被滚动容器裁切）
 */
function uiTip(text: string, align: TipAlign = "center", above = false): string {
  return `<span class="ui-tip tip-${align}${above ? " tip-above" : ""}" role="tooltip">${escapeHtml(text)}</span>`;
}

function copyTipLabel(withCtrl: boolean): string {
  return withCtrl ? COPY_TIP_TITLE : COPY_TIP_CONTENT;
}

function syncCopyTips(withCtrl = ctrlHeld) {
  document.querySelectorAll<HTMLElement>('[data-action="copy"] .ui-tip').forEach((tip) => {
    if (tip.classList.contains("is-success")) return;
    tip.textContent = copyTipLabel(withCtrl);
  });
}

function bindCopyTipChrome() {
  if (copyTipChromeBound) return;
  copyTipChromeBound = true;

  const apply = (next: boolean, force = false) => {
    if (ctrlHeld === next && !force) return;
    ctrlHeld = next;
    document.body.classList.toggle("is-ctrl", next);
    syncCopyTips(next);
  };

  window.addEventListener("keydown", (e) => apply(e.ctrlKey), true);
  window.addEventListener("keyup", (e) => apply(e.ctrlKey), true);
  window.addEventListener("blur", () => apply(false, true));
  // 窗口失焦时收不到按键，靠指针移动携带的修饰键状态补上
  document.addEventListener(
    "pointermove",
    (e) => apply(e.ctrlKey),
    true,
  );
}

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

/** 串行写入：复制与开关可能紧挨着触发，避免先发起的旧数据后落盘 */
let saveQueue: Promise<unknown> = Promise.resolve();

async function persist() {
  const next = saveQueue.then(() => saveData(data));
  saveQueue = next.catch(() => {});
  await next;
}

/** 把编辑态 DOM 里的最新输入刷回 data（不持久化）；保存与结构操作前调用，避免重渲染丢输入 */
function flushEditingDraft(): void {
  if (!editingId) return;
  const editor = document.querySelector<HTMLElement>(".block.editing");
  const block = data.blocks.find((b) => b.id === editingId);
  if (!editor || !block) return;

  const titleEl = editor.querySelector<HTMLInputElement>('[data-field="title"]');
  if (titleEl) block.title = titleEl.value.trim();

  if (subsDraft != null) {
    const values = Array.from(editor.querySelectorAll<HTMLTextAreaElement>('[data-field="sub-input"]')).map((t) => t.value);
    subsDraft = values;
    block.subRegions = values;
    // content 同步为子区域拼接值：切回纯文本模式或子区域被清空时内容不丢
    block.content = values.filter((s) => s.trim().length > 0).join("\n\n");
  } else {
    const contentEl = editor.querySelector<HTMLTextAreaElement>('[data-field="content"]');
    if (contentEl) block.content = contentEl.value;
    // 整段模式下必须清掉子区域，否则保存后仍按 subRegions 判定，又回到子区域模式
    block.subRegions = undefined;
  }

  const linesEl = editor.querySelector<HTMLInputElement>('[data-field="displayLines"]');
  if (linesEl) block.displayLines = clampDisplayLines(Number(linesEl.value));
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
    b.classList.remove("dragging", "drag-over");
  });
  document.body.classList.remove("is-reordering");
  document.querySelector(".drag-ghost")?.remove();
}

/** 指针落在哪个区域上（整块命中即可，不再区分上下半区） */
function dropTargetIndexFromPoint(x: number, y: number, fromIndex: number): number | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(".block");
  if (!el || el.dataset.index == null) return null;
  const index = Number(el.dataset.index);
  if (!Number.isFinite(index) || index === fromIndex) return null;
  return index;
}

function startBlockReorder(blockEl: HTMLElement, fromIndex: number, e: PointerEvent) {
  // 过滤态禁用拖拽：被隐藏的块看不见地挡在中间，换位结果无法预期
  if (isFiltering()) return;
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
      b.classList.remove("drag-over");
    });
    const targetIndex = dropTargetIndexFromPoint(ev.clientX, ev.clientY, fromIndex);
    if (targetIndex == null) return;
    const overEl = document.querySelector<HTMLElement>(`.block[data-index="${targetIndex}"]`);
    overEl?.classList.add("drag-over");
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
    const targetIndex = active ? dropTargetIndexFromPoint(ev.clientX, ev.clientY, fromIndex) : null;
    dragFromIndex = null;
    clearDragStyles();

    if (active && from !== null && targetIndex != null) {
      // 落到目标区域任意位置 → 移到该区域当前下标（相邻时即交换）
      moveBlock(from, targetIndex);
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
        <button type="button" class="win-btn update-indicator" id="btn-update" aria-label="软件更新" hidden>↑<span class="update-dot" aria-hidden="true"></span>${uiTip("发现新版本", "end")}</button>
        <button type="button" class="win-btn${currentView === "settings" ? " active" : ""}" id="btn-settings" aria-label="设置" aria-pressed="${currentView === "settings"}">⚙${uiTip("设置", "end")}</button>
        <button type="button" class="win-btn" id="btn-minimize" aria-label="最小化">─${uiTip("最小化", "end")}</button>
        <button type="button" class="win-btn close" id="btn-close" aria-label="关闭">×${uiTip("关闭", "end")}</button>
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
        <div class="setting-row" id="update-settings"></div>
        <div class="setting-row">
          <div class="setting-meta">
            <span class="setting-name">面板透明度</span>
          </div>
          <div class="setting-control">
            <input type="range" id="opacity-range" min="40" max="100" value="${opacityPct}" aria-label="面板透明度" />
            <span class="setting-value" id="opacity-value">${opacityPct}%</span>
          </div>
        </div>
        <label class="setting-row setting-row-clickable" for="startup-toggle">
          <div class="setting-meta">
            <span class="setting-name">开机启动</span>
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
            <button type="button" class="setting-btn icon" id="btn-apply-default-lines" aria-label="应用到全部">${ICON_APPLY_ALL}${uiTip("应用到全部", "end")}</button>
          </div>
        </div>
        <label class="setting-row setting-row-clickable" for="recent-toggle">
          <div class="setting-meta">
            <span class="setting-name">最近复制</span>
            <span class="setting-desc">顶部显示最近复制的内容，点击即可再次复制</span>
          </div>
          <div class="setting-control">
            <span class="switch">
              <input type="checkbox" id="recent-toggle" ${data.window.showRecent ? "checked" : ""} />
              <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
            </span>
          </div>
        </label>
        <div class="setting-row setting-row-stack">
          <div class="setting-meta">
            <span class="setting-name">数据文件路径</span>
            <span class="setting-desc">区域与窗口配置保存位置；更改后会迁移当前数据</span>
          </div>
          <div class="path-box">
            <code class="path-text" title="${escapeAttr(pathLabel)}">${escapeHtml(pathLabel)}</code>
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

/** 分区条目的识别文本：块标题，子区域再带上段号 */
function copySourceLabel(block: Block, subIndex?: number): string {
  const title = block.title.trim() || "未命名";
  return subIndex == null ? title : `${title} · ${String(subIndex + 1).padStart(2, "0")}`;
}

/** 条目右侧预览：首个非空行，内部空白折成单空格 */
function previewLine(text: string): string {
  const line = text.split("\n").find((part) => part.trim().length > 0) ?? "";
  return line.trim().replace(/\s+/g, " ");
}

function renderRecentItem(item: RecentCopy, index: number): string {
  return `
        <button type="button" class="recent-item" data-recent-index="${index}" aria-label="复制：${escapeAttr(item.label)}">
          <span class="recent-label">${escapeHtml(item.label)}</span>
          <span class="recent-text">${escapeHtml(previewLine(item.text))}</span>
        </button>`;
}

function renderRecent(): string {
  if (!data.window.showRecent) return "";
  return `
    <section class="recent" id="recent" aria-label="最近复制"${recentCopies.length === 0 ? " hidden" : ""}>
      <div class="recent-list">${recentCopies.map(renderRecentItem).join("")}</div>
    </section>
  `;
}

/** 同文本去重后提到最前；只换分区内部，不重渲染整个列表，避免丢滚动位置与复制反馈 */
function rememberCopy(text: string, label: string, title: string) {
  if (!text.trim()) return;
  const existing = recentCopies.findIndex((item) => item.text === text);
  if (existing >= 0) recentCopies.splice(existing, 1);
  recentCopies.unshift({ text, label, title });
  recentCopies.length = Math.min(recentCopies.length, RECENT_COPIES_LIMIT);
  refreshRecent();
  void persist();
}

function refreshRecent() {
  const section = document.querySelector<HTMLElement>("#recent");
  const list = section?.querySelector<HTMLElement>(".recent-list");
  if (!section || !list) return;
  list.innerHTML = recentCopies.map(renderRecentItem).join("");
  section.hidden = recentCopies.length === 0;
}

/** 条目复制：默认复制内容，copyTitle 时只复制来源区域标题（不带段号） */
function copyRecentEntry(entry: RecentCopy, copyTitle: boolean, anchor: HTMLElement) {
  void (async () => {
    try {
      if (copyTitle) {
        if (!entry.title.trim()) {
          showToast("暂无标题");
          return;
        }
        await copyText(entry.title);
        showCopiedTip(anchor, "已复制标题");
        return;
      }
      await copyText(entry.text);
      showCopiedTip(anchor);
    } catch {
      showToast("复制失败");
    }
  })();
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

  const filtering = isFiltering();
  const entries = filtering ? filteredEntries() : data.blocks.map((block, index) => ({ block, index }));

  let listHtml: string;
  if (entries.length > 0) {
    listHtml = entries.map(({ block, index }) => renderBlock(block, index)).join("");
  } else if (filtering) {
    listHtml = renderNoResults();
  } else {
    listHtml = '<p class="empty">还没有区域，点击上方按钮新增</p>';
  }

  return `
    <div class="toolbar">
      <button type="button" class="add-btn" id="btn-add">＋ 新增区域</button>
      <div class="search-box">
        <span class="search-icon" aria-hidden="true">${ICON_SEARCH}</span>
        <input
          id="search-input"
          class="search-input"
          type="text"
          value="${escapeAttr(searchQuery)}"
          placeholder="搜索区域"
          aria-label="搜索区域标题或内容"
          autocomplete="off"
          spellcheck="false"
        />
        ${
          filtering
            ? `<button type="button" class="search-clear" id="search-clear" aria-label="清除搜索">${ICON_CLOSE}</button>`
            : `<kbd class="search-kbd" aria-hidden="true">Ctrl F</kbd>`
        }
      </div>
    </div>
    ${filtering ? "" : renderRecent()}
    <div class="blocks${filtering ? " is-filtered" : ""}">
      ${listHtml}
    </div>
  `;
}

/**
 * 无结果空态：按「空态要给出路」的原则，不只报数量，
 * 而是说明匹配范围 + 给一个「清除搜索」的直接动作。
 */
function renderNoResults(): string {
  return `
    <div class="empty search-empty">
      <p class="search-empty-title">没有找到包含「${escapeHtml(searchQuery.trim())}」的区域</p>
      <p class="search-empty-hint">匹配标题与全部内容，不区分大小写；多个关键词用空格分隔</p>
      <button type="button" class="search-empty-clear" id="search-clear-empty">清除搜索</button>
    </div>
  `;
}

function renderBlock(block: Block, index: number): string {
  const isEditing = editingId === block.id;
  const isExpanded = expandedId === block.id;
  const lines = clampDisplayLines(block.displayLines ?? DEFAULT_DISPLAY_LINES);
  const isUnfolded = unfoldedIds.has(block.id);
  const expandClass = isExpanded ? " is-expanded" : "";
  const hasSubs = (block.subRegions?.length ?? 0) > 0;
  // 放大态 / 临时撑开：忽略行数限制；折叠恢复后仍用已保存 displayLines
  const showClamp = !isExpanded && !isUnfolded && lines > 0;
  // 行数折叠按钮：纯 content 块与子区域块一致（都受 displayLines 限制）
  const canToggleFold = !isExpanded && (lines > 0 || isUnfolded);

  if (isEditing) {
    const editingSubs = subsDraft != null ? subsDraft : null;
    // 同一个按钮、同一枚图标，动作名交给气泡：气泡说明「点下去会变成什么」
    const convertLabel = editingSubs ? "转为整段文本" : "转为子区域";
    const draftCount = formatCharCount(charCount(editingSubs ? editingSubs.join("\n") : block.content));
    return `
      <article class="block editing${expandClass}" data-id="${block.id}" data-index="${index}">
        <div class="block-head">
          <input class="title-input" data-field="title" value="${escapeAttr(block.title)}" placeholder="区域名称" />
          <div class="block-tools">
            <button type="button" class="icon-btn" data-action="toggle-subs" aria-label="${convertLabel}">${ICON_LAYOUT_SWITCH}${uiTip(convertLabel, "end")}</button>
            <button type="button" class="icon-btn" data-action="save" aria-label="保存">${ICON_CHECK}${uiTip("保存", "end")}</button>
            <button type="button" class="icon-btn danger" data-action="delete" aria-label="删除">${ICON_TRASH}${uiTip("删除", "end")}</button>
          </div>
        </div>
        ${
          editingSubs
            ? `
        <div class="subs-editor">
          ${editingSubs
            .map((text, i) => {
              const count = formatCharCount(charCount(text));
              return `
          <div class="sub-edit" data-sub-index="${i}">
            <span class="sub-index" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
            <textarea class="sub-input" data-field="sub-input" rows="1" placeholder="子区域内容（可多行），展示时单击即可整段复制">${escapeHtml(text)}</textarea>
            <span class="sub-count${count.over ? " is-over" : ""}" aria-hidden="true">${count.text}</span>
            <div class="sub-edit-tools">
              <button type="button" class="icon-btn" data-action="sub-up" aria-label="上移" ${i === 0 ? "disabled" : ""}>${ICON_ARROW_UP}${uiTip("上移", "end")}</button>
              <button type="button" class="icon-btn" data-action="sub-down" aria-label="下移" ${i === editingSubs.length - 1 ? "disabled" : ""}>${ICON_ARROW_DOWN}${uiTip("下移", "end")}</button>
              <button type="button" class="icon-btn danger" data-action="sub-del" aria-label="删除该子区域">${ICON_CLOSE}${uiTip("删除该子区域", "end")}</button>
            </div>
          </div>`;
            })
            .join("")}
          <button type="button" class="sub-add-btn" data-action="sub-add">＋ 新增子区域</button>
        </div>`
            : `
        <textarea class="content-input" data-field="content" rows="4" placeholder="需要快速复制的文本">${escapeHtml(block.content)}</textarea>`
        }
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
          <span class="char-count${draftCount.over ? " is-over" : ""}" data-field="char-count">${draftCount.text}</span>
        </div>
      </article>
    `;
  }

  // 计数口径 = 复制口径
  const total = formatCharCount(charCount(blockContentText(block)));

  return `
    <article class="block${expandClass}" data-id="${block.id}" data-index="${index}">
      <div class="block-head">
        <button type="button" class="block-title" data-action="copy" aria-label="复制内容；Ctrl+点击复制标题">
          <span class="block-title-text">${block.title ? highlightHtml(block.title) : '<span class="title-placeholder">未命名</span>'}</span>
          ${uiTip("复制内容", "start")}
        </button>
        <span class="block-count${total.over ? " is-over" : ""}" data-field="block-count">${total.text}</span>
        <div class="block-tools">
          ${
            canToggleFold
              ? `<button type="button" class="icon-btn" data-action="fold" aria-label="${isUnfolded ? "折叠" : "展开"}" aria-pressed="${isUnfolded}">${isUnfolded ? ICON_FOLD : ICON_UNFOLD}${uiTip(isUnfolded ? "折叠" : "展开", "end")}</button>`
              : ""
          }
          <button type="button" class="icon-btn" data-action="expand" aria-label="${isExpanded ? "还原" : "放大"}">${isExpanded ? ICON_COLLAPSE : ICON_EXPAND}${uiTip(isExpanded ? "还原" : "放大", "end")}</button>
          <button type="button" class="icon-btn" data-action="edit" aria-label="编辑">${ICON_PENCIL}${uiTip("编辑", "end")}</button>
        </div>
      </div>
      ${
        hasSubs
          ? renderSubRegions(block, showClamp, lines)
          : `<pre class="block-content${showClamp ? " is-clamped" : ""}"${showClamp ? ` style="--display-lines: ${lines}"` : ""}>${highlightHtml(block.content) || '<span class="placeholder">点右上「编辑」按钮；拖动标题可排序</span>'}</pre>`
      }
    </article>
  `;
}

/** 子区域展示态：整体受该区域的「显示行数」限制（与纯文本块同一套折叠逻辑），单击整段复制 */
function renderSubRegions(block: Block, clamp: boolean, lines: number): string {
  const subs = block.subRegions!;
  const clampClass = clamp ? " is-clamped" : "";
  const clampStyle = clamp ? ` style="--display-lines: ${lines}"` : "";
  return `
    <div class="block-subs${clampClass}"${clampStyle}>
      ${subs
        .map(
          (text, i) => `
        <pre class="block-sub" data-sub-index="${i}">${highlightHtml(text)}</pre>
        `,
        )
        .join("")}
    </div>
  `;
}

const COMMON_CHAR_LIMITS = [100, 200, 500, 800];

/** 按 code point 计，emoji 不会被算成两个 */
function charCount(text: string): number {
  return [...text].length;
}

/** 统一为 N/上限（斜杠不留空格，省窄窗宽度）；over = 超过最大一档 */
function formatCharCount(count: number): { text: string; over: boolean } {
  const max = COMMON_CHAR_LIMITS[COMMON_CHAR_LIMITS.length - 1];
  const limit = COMMON_CHAR_LIMITS.find((value) => count <= value) ?? max;
  return { text: `${count}/${limit}`, over: count > max };
}

function applyCharCount(el: Element | null, count: number) {
  if (!(el instanceof HTMLElement)) return;
  const { text, over } = formatCharCount(count);
  el.textContent = text;
  el.classList.toggle("is-over", over);
}

/** 读 DOM 输入值，与保存共用同一份草稿 */
function refreshEditCounts(root: HTMLElement) {
  const cards = [...root.querySelectorAll<HTMLElement>(".sub-edit")];
  if (cards.length > 0) {
    const texts = cards.map(
      (card) => card.querySelector<HTMLTextAreaElement>('[data-field="sub-input"]')?.value ?? "",
    );
    cards.forEach((card, i) => applyCharCount(card.querySelector(".sub-count"), charCount(texts[i])));
    // 总数按复制口径拼接
    applyCharCount(root.querySelector('[data-field="char-count"]'), charCount(texts.join("\n")));
    return;
  }
  const content = root.querySelector<HTMLTextAreaElement>('[data-field="content"]')?.value ?? "";
  applyCharCount(root.querySelector('[data-field="char-count"]'), charCount(content));
}

/**
 * 整块复制文本（点标题复制）：子区域模式 = 各段按序以单换行拼接，纯 content 块 = 原文。
 * 单换行而不是空行：整块复制的结果多半直接贴进表单/编辑器，空行会变成多余的段落间隔。
 * 注意与「转为整段文本」区分——后者用空行拼接（在 flushEditingDraft 里），
 * 这样「整段 → 自动分段」才能按空行还原出原来的分段边界，往返稳定。
 */
function blockContentText(block: Block): string {
  return block.subRegions?.length ? block.subRegions.join("\n") : block.content;
}

/**
 * 搜索匹配：标题 + 内容（含全部子区域），大小写不敏感。
 * 关键词按空白拆成多个词，要求全部命中（AND）——「实习 字节」比单字更精准，
 * 而单个关键词的行为与直觉一致。纯结构匹配，不做拼音/模糊/语义扩展。
 */
function blockMatchesQuery(block: Block, query: string): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const haystack = `${block.title}\n${blockContentText(block)}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** 关键词列表：按空白拆分并小写；空查询返回空数组（= 不过滤） */
function searchTerms(query = searchQuery): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * 命中片段高亮：把匹配到的子串包成 <mark class="hl">。
 * 每个文本片段单独转义后再拼接 HTML，原文里的标签不会被当标记执行。
 * 多个关键词的命中区间先合并再输出，避免重叠关键词产生嵌套 <mark>。
 */
function highlightHtml(text: string): string {
  if (!text || !isFiltering()) return escapeHtml(text);

  const lower = text.toLowerCase();
  // 少数语言 toLowerCase 会改变长度（如土耳其 İ），偏移即不可信：退回纯转义
  if (lower.length !== text.length) return escapeHtml(text);

  const ranges: [number, number][] = [];
  for (const term of searchTerms()) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      ranges.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  if (ranges.length === 0) return escapeHtml(text);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }

  let html = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    html += escapeHtml(text.slice(cursor, start));
    html += `<mark class="hl">${escapeHtml(text.slice(start, end))}</mark>`;
    cursor = end;
  }
  return html + escapeHtml(text.slice(cursor));
}

/**
 * 过滤后的块列表，保留原始索引（拖拽排序 / 删除都依赖 data.blocks 的下标）。
 * 过滤态下拖拽被禁用，因此不会出现「跨隐藏块换位」的歧义结果。
 */
function filteredEntries(): { block: Block; index: number }[] {
  return data.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => blockMatchesQuery(block, searchQuery));
}

/** 搜索状态：去掉首尾空白后有内容才算处于过滤中 */
function isFiltering(): boolean {
  return searchQuery.trim().length > 0;
}

/** 空行是用户主动分段的最强信号：任何一行 trimmed 为空即视为存在分段意图 */
function hasBlankLine(lines: string[]): boolean {
  return lines.some((line) => line.trim().length === 0);
}

/**
 * 纯文本 → 子区域：纯结构切分，不做语义识别，不改写任何字符。
 * 判定优先级（自上而下，命中即停）：
 *   1. 存在空行   → 按空行分段，段内换行保留（一个空行 = 一道边界）
 *   2. 多行无空行 → 逐行分段（简历常见的「一行一项」）
 *   3. 单行       → 整段作为唯一子区域
 * 切分过度时由编辑态的「合并到上一段」一键回退，不在算法里猜语义。
 */
function splitIntoSubRegions(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!normalized.trim()) return [];
  const lines = normalized.split("\n");

  if (!hasBlankLine(lines)) {
    return lines.filter((line) => line.trim().length > 0);
  }

  const grouped: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (current.length) {
        grouped.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length) grouped.push(current);

  return grouped.map((group) => group.join("\n"));
}

/** 进入放大前记下列表滚动；已在放大态时不覆盖 */
function rememberListScroll() {
  if (expandedId != null) return;
  listScrollSnapshot = document.querySelector<HTMLElement>(".blocks")?.scrollTop ?? 0;
}

function render(
  options: {
    scrollBlocksToTop?: boolean;
    ensureVisibleId?: string | null;
    /** 重建后把焦点还给搜索框并恢复光标（输入过滤时用） */
    focusSearch?: boolean;
    caret?: number;
  } = {},
) {
  const prevScroll = document.querySelector<HTMLElement>(".blocks")?.scrollTop ?? 0;

  app.innerHTML = `
    <div class="shell">
      ${renderTitlebar()}
      <main class="content">
        ${currentView === "settings" ? renderSettings() : renderMain()}
      </main>
      <div class="toast" role="status" aria-live="polite"></div>
      <div class="update-overlay" id="update-overlay" hidden></div>
    </div>
  `;

  applyPanelOpacity(data.window.opacity);
  bindEvents();
  updater.mount();
  syncCopyTips();
  autoGrowSubInputs();
  markTruncatedBlocks();

  // 全量重建会销毁输入框：输入过滤时把焦点与光标位置还原，否则每敲一个字就丢焦点
  if (options.focusSearch) {
    const input = document.querySelector<HTMLInputElement>("#search-input");
    if (input) {
      input.focus({ preventScroll: true });
      const pos = options.caret ?? input.value.length;
      input.setSelectionRange(pos, pos);
    }
  }

  const blocksEl = document.querySelector<HTMLElement>(".blocks");
  if (!blocksEl) return;

  if (options.scrollBlocksToTop) {
    blocksEl.scrollTop = 0;
    return;
  }

  // 放大态 overflow:hidden，scrollTop 无意义；还原时用进入前快照
  if (expandedId) {
    blocksEl.scrollTop = 0;
    return;
  }

  const scroll = listScrollSnapshot ?? prevScroll;
  listScrollSnapshot = null;
  blocksEl.scrollTop = scroll;
  const focusId = options.ensureVisibleId ?? editingId;
  if (focusId) {
    // nearest：已在可视区则不滚动；仅当目标被裁切时微调
    blocksEl
      .querySelector<HTMLElement>(`.block[data-id="${CSS.escape(focusId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

/** 子区域编辑框高度随内容撑开：不限制可视行高，长文本完整可见 */
function autoGrowSubInputs() {
  document.querySelectorAll<HTMLTextAreaElement>(".sub-input").forEach((ta) => {
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 30)}px`;
  });
}

/** 限行裁切且内容溢出时标记，用于底部淡出提示（纯文本块与子区域块一致） */
function markTruncatedBlocks() {
  document
    .querySelectorAll<HTMLElement>(".block-content.is-clamped, .block-subs.is-clamped")
    .forEach((el) => {
      el.classList.toggle("is-truncated", el.scrollHeight > el.clientHeight + 1);
    });
}

/** 进入编辑：铺满当前区域，便于专注修改 */
function enterEdit(id: string, renderOpts?: { scrollBlocksToTop?: boolean; ensureVisibleId?: string | null }) {
  rememberListScroll();
  // 新建区域滚到顶部：还原时也应停在顶部附近
  if (renderOpts?.scrollBlocksToTop) listScrollSnapshot = 0;
  const block = data.blocks.find((b) => b.id === id);
  subsDraft = block?.subRegions ? [...block.subRegions] : null;
  editingId = id;
  expandedId = id;
  render(renderOpts ?? { ensureVisibleId: id });
}

/** 结束编辑：回到列表 */
function exitEdit() {
  editingId = null;
  expandedId = null;
  subsDraft = null;
}

let tipResumeCleanup: (() => void) | null = null;

/** 离开设置后若立刻恢复穿透，顶栏收不到 mouseleave，气泡会卡住且内容区点不到 */
function resumeClickThroughAfterTitlebarLeave() {
  tipResumeCleanup?.();
  tipResumeCleanup = null;

  if (!data.window.clickThrough) {
    void setClickThroughPaused(false);
    return;
  }

  // 先保持暂停，等指针离开顶栏再恢复穿透
  void setClickThroughPaused(true);

  const titlebar = document.querySelector<HTMLElement>(".titlebar");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener("pointermove", onMove, true);
    titlebar?.removeEventListener("pointerleave", finish);
    tipResumeCleanup = null;
    void setClickThroughPaused(false);
  };

  const onMove = (e: PointerEvent) => {
    const rect = titlebar?.getBoundingClientRect();
    if (!rect) {
      finish();
      return;
    }
    const inside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (!inside) finish();
  };

  titlebar?.addEventListener("pointerleave", finish);
  window.addEventListener("pointermove", onMove, true);
  tipResumeCleanup = finish;
}

function bindWindowChrome() {
  document.querySelector("#btn-settings")?.addEventListener("click", () => {
    const enteringSettings = currentView !== "settings";
    currentView = enteringSettings ? "settings" : "main";
    if (enteringSettings) {
      editingId = null;
      expandedId = null;
      subsDraft = null;
      unfoldedIds.clear();
      tipResumeCleanup?.();
      tipResumeCleanup = null;
      void setClickThroughPaused(true);
      render();
      return;
    }

    render();
    resumeClickThroughAfterTitlebarLeave();
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
      // 拖完立刻关窗时 debounce 还没触发，这里补记一次
      await rememberWindowBounds();
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

  document.querySelector("#recent-toggle")?.addEventListener("change", async (e) => {
    data.window.showRecent = (e.target as HTMLInputElement).checked;
    // 只切换显隐：记录继续保留、继续累积，重新打开时原样回来
    await persist();
  });

  document.querySelector("#btn-data-path-change")?.addEventListener("click", async () => {
    try {
      dataPathInfo = await chooseDataFilePath(data);
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

/**
 * 搜索框交互。两个必须照顾的细节：
 * 1. 全量 render 会销毁输入框，所以每次过滤都要把焦点与光标还回去；
 * 2. 中文/日文输入法组合期间不能重建 DOM，否则拼音会被打断——靠 isComposing 拦，
 *    再用 compositionend 兜底（此时值已定稿）。
 */
function bindSearchEvents() {
  const input = document.querySelector<HTMLInputElement>("#search-input");
  if (!input) return;

  const apply = (value: string, caret: number) => {
    // 值相同不重建：IME 的 compositionend 与 input 可能连续触发同一值
    if (value === searchQuery) return;
    searchQuery = value;
    render({ scrollBlocksToTop: true, focusSearch: true, caret });
  };

  const fromDOM = () => apply(input.value, input.selectionStart ?? input.value.length);

  input.addEventListener("input", (e) => {
    if ((e as InputEvent).isComposing) return;
    fromDOM();
  });
  input.addEventListener("compositionend", fromDOM);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isFiltering()) {
      e.preventDefault();
      apply("", 0);
    }
  });

  document.querySelector("#search-clear")?.addEventListener("click", () => apply("", 0));
  document.querySelector("#search-clear-empty")?.addEventListener("click", () => apply("", 0));
}

/** Ctrl+F（应用内）：聚焦搜索框并全选，便于直接覆盖输入。设置页/编辑态无搜索框则不拦截。 */
function bindSearchHotkey() {
  if (searchHotkeyBound) return;
  searchHotkeyBound = true;
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "f") return;
    const input = document.querySelector<HTMLInputElement>("#search-input");
    if (!input) return;
    e.preventDefault();
    input.focus();
    input.select();
  });
}

function bindEvents() {
  bindWindowChrome();
  bindSearchHotkey();

  if (currentView === "settings") {
    bindSettingsEvents();
    return;
  }

  bindSearchEvents();

  document.querySelector("#btn-add")?.addEventListener("click", async () => {
    // 过滤中新增：先清空搜索。否则新块若不匹配当前关键词会立刻从列表消失，像没建成
    searchQuery = "";
    const block = createBlock("", "", data.window.defaultDisplayLines);
    data.blocks.unshift(block);
    await persist();
    enterEdit(block.id, { scrollBlocksToTop: true });
  });

  // 条目：单击复制内容，Ctrl+单击复制所属区域标题（不带段号）；拖选文字交给原生 Ctrl+C
  let recentDown: { x: number; y: number; item: HTMLElement } | null = null;

  document.querySelector("#recent")?.addEventListener("pointerdown", (e) => {
    const pe = e as PointerEvent;
    const item = (e.target as HTMLElement | null)?.closest<HTMLElement>(".recent-item");
    if (!item || pe.button !== 0) return;
    recentDown = { x: pe.clientX, y: pe.clientY, item };
  });

  document.querySelector("#recent")?.addEventListener("pointerup", (e) => {
    const pe = e as PointerEvent;
    const down = recentDown;
    recentDown = null;
    if (!down || pe.button !== 0) return;
    // 拖出去是选文字，不是点击
    if (Math.hypot(pe.clientX - down.x, pe.clientY - down.y) >= SUB_CLICK_TOLERANCE) return;

    const entry = recentCopies[Number(down.item.dataset.recentIndex)];
    if (!entry) return;
    const copyTitle = pe.ctrlKey;
    window.clearTimeout(copyClickTimer);

    const runCopy = () => {
      // 双击选词后选区还在，这次点击是选字不是复制
      if (window.getSelection()?.toString()) return;
      copyRecentEntry(entry, copyTitle, down.item);
    };

    if (copyTitle) runCopy();
    else copyClickTimer = window.setTimeout(runCopy, COPY_CLICK_DELAY);
  });

  // 键盘激活（Tab 到条目后回车/空格）走同一套逻辑
  document.querySelector("#recent")?.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== "Enter" && ke.key !== " ") return;
    const item = (e.target as HTMLElement | null)?.closest<HTMLElement>(".recent-item");
    if (!item) return;
    e.preventDefault();
    const entry = recentCopies[Number(item.dataset.recentIndex)];
    if (!entry) return;
    copyRecentEntry(entry, ke.ctrlKey, item);
  });

  document.querySelectorAll<HTMLElement>(".block").forEach((el) => {
    const id = el.dataset.id!;
    const index = Number(el.dataset.index);

    // 标题不计入，其余改动即时刷新
    if (el.classList.contains("editing")) {
      el.addEventListener("input", (e) => {
        const field = (e.target as HTMLElement | null)?.dataset.field;
        if (field === "content" || field === "sub-input") refreshEditCounts(el);
      });
    }

    el.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => {
      if (suppressNextClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const copyTitle = (e as MouseEvent).ctrlKey;
      window.clearTimeout(copyClickTimer);

      const runCopy = () => {
        void (async () => {
          const block = data.blocks.find((b) => b.id === id);
          if (!block) return;
          if (copyTitle && !block.title.trim()) {
            showToast("暂无标题");
            return;
          }
          const text = copyTitle ? block.title : blockContentText(block);
          try {
            await copyText(text);
            if (!copyTitle) rememberCopy(text, copySourceLabel(block), block.title);
            const tip = el.querySelector<HTMLElement>('[data-action="copy"] .ui-tip');
            if (tip) {
              tip.textContent = copyTitle ? "已复制标题" : "已复制内容";
              tip.classList.add("is-success");
              window.setTimeout(() => {
                tip.textContent = copyTipLabel(ctrlHeld);
                tip.classList.remove("is-success");
              }, 1200);
            }
          } catch {
            showToast("复制失败");
          }
        })();
      };

      if (copyTitle) runCopy();
      else copyClickTimer = window.setTimeout(runCopy, COPY_CLICK_DELAY);
    });

    el.querySelector('[data-action="fold"]')?.addEventListener("click", () => {
      window.clearTimeout(copyClickTimer);
      if (unfoldedIds.has(id)) unfoldedIds.delete(id);
      else unfoldedIds.add(id);
      render({ ensureVisibleId: id });
    });

    el.querySelector('[data-action="expand"]')?.addEventListener("click", () => {
      window.clearTimeout(copyClickTimer);
      const collapsing = expandedId === id;
      if (!collapsing) rememberListScroll();
      expandedId = collapsing ? null : id;
      render(collapsing ? { ensureVisibleId: id } : undefined);
    });

    el.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
      window.clearTimeout(copyClickTimer);
      enterEdit(id);
    });

    el.querySelector('[data-action="save"]')?.addEventListener("click", async () => {
      flushEditingDraft();
      const block = data.blocks.find((b) => b.id === id);
      if (!block) return;
      // 子区域清到全空 → 退回纯文本块（content 已是拼接值，内容不丢）
      if (block.subRegions) {
        const subs = block.subRegions.filter((s) => s.trim().length > 0);
        block.subRegions = subs.length ? subs : undefined;
      }
      unfoldedIds.delete(id);
      exitEdit();
      await persist();
      render({ ensureVisibleId: id });
      showToast("已保存");
    });

    el.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      data.blocks = data.blocks.filter((b) => b.id !== id);
      exitEdit();
      unfoldedIds.delete(id);
      await persist();
      render();
      showToast("已删除");
    });

    // ---- 子区域编辑：结构操作先刷回草稿再重渲染，输入不丢 ----
    el.querySelectorAll<HTMLTextAreaElement>('[data-field="sub-input"]').forEach((ta) => {
      ta.addEventListener("input", autoGrowSubInputs);
    });

    el.querySelector('[data-action="sub-add"]')?.addEventListener("click", () => {
      flushEditingDraft();
      subsDraft?.push("");
      render({ ensureVisibleId: id });
      const editors = document.querySelectorAll<HTMLTextAreaElement>(
        `.block.editing [data-field="sub-input"]`,
      );
      editors[editors.length - 1]?.focus();
    });

    // 同一个按钮在两个模式间切换：子区域 → 整段（content 已是空行拼接值）/ 整段 → 自动分段
    el.querySelector('[data-action="toggle-subs"]')?.addEventListener("click", () => {
      flushEditingDraft();
      const block = data.blocks.find((b) => b.id === id);
      if (!block) return;
      if (subsDraft != null) {
        subsDraft = null;
      } else {
        subsDraft = splitIntoSubRegions(block.content);
        if (subsDraft.length === 0) subsDraft = [""];
      }
      render({ ensureVisibleId: id });
    });

    el.querySelectorAll<HTMLElement>(".sub-edit").forEach((row) => {
      const subIndex = Number(row.dataset.subIndex);
      if (!Number.isFinite(subIndex)) return;

      // 编辑中隐藏右上工具条，避免挡住这一段
      row.querySelector<HTMLTextAreaElement>('[data-field="sub-input"]')?.addEventListener("focus", () => {
        row.classList.add("is-typing");
      });
      row.querySelector<HTMLTextAreaElement>('[data-field="sub-input"]')?.addEventListener("blur", () => {
        row.classList.remove("is-typing");
      });

      // 数字浮层要自己接收指针才能 hover，落上的点击手动转给输入框；
      // preventDefault 不能省，否则焦点被浮层夺走，刚 focus 的输入框立刻 blur
      row.querySelector(".sub-count")?.addEventListener("pointerdown", (e) => {
        const input = row.querySelector<HTMLTextAreaElement>('[data-field="sub-input"]');
        if (!input) return;
        e.preventDefault();
        input.focus();
        const end = input.value.length;
        input.setSelectionRange(end, end);
      });

      row.querySelector('[data-action="sub-up"]')?.addEventListener("click", () => {
        flushEditingDraft();
        if (subsDraft != null && subIndex > 0 && subIndex < subsDraft.length) {
          [subsDraft[subIndex - 1], subsDraft[subIndex]] = [subsDraft[subIndex], subsDraft[subIndex - 1]];
        }
        render({ ensureVisibleId: id });
      });

      row.querySelector('[data-action="sub-down"]')?.addEventListener("click", () => {
        flushEditingDraft();
        if (subsDraft != null && subIndex >= 0 && subIndex < subsDraft.length - 1) {
          [subsDraft[subIndex + 1], subsDraft[subIndex]] = [subsDraft[subIndex], subsDraft[subIndex + 1]];
        }
        render({ ensureVisibleId: id });
      });

      row.querySelector('[data-action="sub-del"]')?.addEventListener("click", () => {
        flushEditingDraft();
        if (subsDraft != null) subsDraft.splice(subIndex, 1);
        render({ ensureVisibleId: id });
      });
    });

    el.addEventListener("pointerdown", (e) => {
      if (editingId || expandedId || e.button !== 0 || el.classList.contains("editing")) return;
      const target = e.target as HTMLElement;
      // 正文保留选字；子区域保留单击复制与拖选；编辑按钮/输入框不启动拖拽
      if (
        target.closest(
          ".block-content, .block-sub, .icon-btn, .block-title, input, textarea, .content-input, .title-input",
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

    // 子区域：单击整段复制；拖选/双击选词时交还原生 Ctrl+C
    const countEl = el.querySelector<HTMLElement>('[data-field="block-count"]');
    el.querySelectorAll<HTMLElement>(".block-sub").forEach((sub) => {
      const subIndex = Number(sub.dataset.subIndex);
      if (!Number.isFinite(subIndex)) return;
      let startPt: { x: number; y: number } | null = null;

      // 悬停某段：标题栏改显该段字数（限长的是单个字段）
      sub.addEventListener("pointerenter", () => {
        const text = data.blocks.find((b) => b.id === id)?.subRegions?.[subIndex];
        if (!countEl || text == null) return;
        applyCharCount(countEl, charCount(text));
        countEl.classList.add("is-sub");
      });

      sub.addEventListener("pointerleave", () => {
        if (!countEl) return;
        countEl.classList.remove("is-sub");
        const block = data.blocks.find((b) => b.id === id);
        if (block) applyCharCount(countEl, charCount(blockContentText(block)));
      });

      sub.addEventListener("pointerdown", (e) => {
        const pe = e as PointerEvent;
        if (pe.button !== 0) return;
        startPt = { x: pe.clientX, y: pe.clientY };
      });

      sub.addEventListener("pointerup", (e) => {
        const pe = e as PointerEvent;
        if (pe.button !== 0 || !startPt) return;
        const dist = Math.hypot(pe.clientX - startPt.x, pe.clientY - startPt.y);
        startPt = null;
        if (dist >= SUB_CLICK_TOLERANCE || suppressNextClick) return;

        window.clearTimeout(copyClickTimer);
        // 延迟执行：双击选词的第二次 pointerup 会带上选区，届时取消本次复制
        copyClickTimer = window.setTimeout(() => {
          if (window.getSelection()?.toString()) return;
          void (async () => {
            const block = data.blocks.find((b) => b.id === id);
            const text = block?.subRegions?.[subIndex];
            if (!block || text == null) return;
            try {
              await copyText(text);
              // 先记录：分区从无到有会把列表下推，气泡要按推完后的位置落点
              rememberCopy(text, copySourceLabel(block, subIndex), block.title);
              flashSubCopied(sub);
            } catch {
              showToast("复制失败");
            }
          })();
        }, COPY_CLICK_DELAY);
      });
    });
  });
}

/**
 * 子区域复制成功的一次性反馈：颜色信号 + 一次性文字气泡。
 * 两条都不得碰被复制的那一行——值的可见性是置顶面板的意义所在。
 * 颜色信号 = 左侧绿条 + 从左淡出的洗色；气泡浮在该行下方（挂 body），1.2s 后自行消失。
 */
function flashSubCopied(sub: HTMLElement) {
  window.clearTimeout(Number(sub.dataset.flashTimer ?? 0));
  sub.classList.add("is-copied");
  showCopiedTip(sub);
  const timer = window.setTimeout(() => {
    sub.classList.remove("is-copied");
  }, 1100);
  sub.dataset.flashTimer = String(timer);
}

let copiedTip: HTMLElement | null = null;

/**
 * 一次性「已复制」气泡：挂到 body 用 fixed 定位，浮在被复制行的下方。
 * 挂在行内会被限行容器的 overflow:hidden 裁掉，也会遮住这一行的内容——两个都不接受。
 */
function showCopiedTip(sub: HTMLElement, text = "已复制") {
  copiedTip?.remove();
  const tip = document.createElement("span");
  tip.className = "ui-tip tip-start is-success is-floating";
  tip.textContent = text;
  document.body.appendChild(tip);
  copiedTip = tip;

  const rect = sub.getBoundingClientRect();
  const height = tip.offsetHeight;
  const below = rect.bottom + 6;
  // 贴到视口底部时翻到该行上方，箭头同步翻转
  const flip = below + height > window.innerHeight - 4;
  if (flip) tip.classList.add("tip-above");
  tip.style.left = `${Math.max(rect.left + 8, 4)}px`;
  tip.style.top = `${flip ? Math.max(rect.top - height - 6, 4) : below}px`;

  const kill = () => {
    window.removeEventListener("scroll", kill, { capture: true });
    tip.remove();
    if (copiedTip === tip) copiedTip = null;
  };
  // 滚动后 fixed 定位会与内容脱节，直接撤掉；正常情况由计时器收尾
  window.addEventListener("scroll", kill, { capture: true });
  window.setTimeout(kill, 1200);
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

async function rememberWindowBounds() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    // 最小化时系统会把窗口挪到屏幕外，写进配置下次就开在看不见的地方
    if (await win.isMinimized()) return;
    const factor = await win.scaleFactor();
    const physical = await win.innerSize();
    const width = Math.round(physical.width / factor);
    const height = Math.round(physical.height / factor);
    // 异常尺寸不写，否则下次只剩标题栏
    if (width < 300 || height < 200) return;
    const position = await win.outerPosition();
    data.window.width = width;
    data.window.height = height;
    data.window.x = position.x;
    data.window.y = position.y;
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
    data.window.x = Number.isFinite(data.window.x) ? data.window.x : undefined;
    data.window.y = Number.isFinite(data.window.y) ? data.window.y : undefined;
    data.window.opacity = Math.min(1, Math.max(0.4, data.window.opacity || 0.96));
    data.window.launchOnStartup = Boolean(data.window.launchOnStartup);
    data.window.clickThrough = Boolean(data.window.clickThrough);
    data.window.defaultDisplayLines = clampDisplayLines(
      data.window.defaultDisplayLines ?? DEFAULT_DISPLAY_LINES,
    );
    data.window.showRecent = data.window.showRecent !== false;
    // 手改过或来自旧版本的数据同样只取前 5 条，空文本直接丢弃
    for (const item of data.recent ?? []) {
      if (recentCopies.length >= RECENT_COPIES_LIMIT) break;
      if (!item?.text?.trim()) continue;
      recentCopies.push({ text: item.text, label: item.label ?? "", title: item.title ?? "" });
    }
    try {
      dataPathInfo = await getDataPathInfo();
    } catch {
      dataPathInfo = { path: "", isDefault: true };
    }
    await applyWindowConfig(data.window);

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      let boundsTimer: number | undefined;
      const rememberBounds = () => {
        window.clearTimeout(boundsTimer);
        boundsTimer = window.setTimeout(() => {
          void rememberWindowBounds();
        }, 400);
      };
      await win.onResized(rememberBounds);
      await win.onMoved(rememberBounds);
    } catch {
      /* browser preview */
    }
  } catch (err) {
    console.error(err);
    data = structuredClone(DEFAULT_DATA);
  }
  bindCopyTipChrome();
  // 分区与 data 共用同一个数组，任何一次保存都带着最新的最近复制
  data.recent = recentCopies;
  // 窗口尺寸变化后子区域编辑框需重算高度，避免撑高不足导致内容被裁
  window.addEventListener("resize", autoGrowSubInputs);
  render();
}

void boot().then(() => updater.start());
