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
  copyText,
  loadData,
  saveBlocks,
} from "./storage";

const app = document.querySelector("#app")!;

let data: AppData = structuredClone(DEFAULT_DATA);
let editingId: string | null = null;
let toastTimer: number | undefined;
let dragFromIndex: number | null = null;
let suppressNextClick = false;
let copyClickTimer: number | undefined;

const DRAG_THRESHOLD = 6;
const COPY_CLICK_DELAY = 280;

function showToast(message: string) {
  const toast = document.querySelector<HTMLElement>(".toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1400);
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
  void persist().then(render);
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
        <button type="button" class="win-btn" id="btn-minimize" title="最小化" aria-label="最小化">─</button>
        <button type="button" class="win-btn close" id="btn-close" title="关闭" aria-label="关闭">×</button>
      </div>
    </header>
  `;
}

function renderBlock(block: Block, index: number): string {
  const isEditing = editingId === block.id;
  const lines = clampDisplayLines(block.displayLines ?? DEFAULT_DISPLAY_LINES);

  if (isEditing) {
    return `
      <article class="block editing" data-id="${block.id}" data-index="${index}">
        <div class="block-head">
          <input class="title-input" data-field="title" value="${escapeAttr(block.title)}" placeholder="区域名称" />
          <div class="block-tools">
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
        <div class="edit-hint">编辑完成后点击 ✓ 保存</div>
      </article>
    `;
  }

  return `
    <article class="block" data-id="${block.id}" data-index="${index}">
      <div class="block-head">
        <button type="button" class="block-title" data-action="copy" aria-label="复制${block.title ? `「${escapeAttr(block.title)}」` : "内容"}">
          <span class="block-title-text">${block.title ? escapeHtml(block.title) : '<span class="title-placeholder">未命名</span>'}</span>
          <span class="copy-pop" role="tooltip">复制</span>
        </button>
        <div class="block-tools">
          <button type="button" class="icon-btn" data-action="edit" title="编辑">✎</button>
        </div>
      </div>
      <pre class="block-content${lines > 0 ? " is-clamped" : ""}"${lines > 0 ? ` style="--display-lines: ${lines}"` : ""}>${escapeHtml(block.content) || '<span class="placeholder">双击区域或点 ✎ 编辑；拖动标题可排序</span>'}</pre>
    </article>
  `;
}

function render() {
  const opacityPct = Math.round(data.window.opacity * 100);

  app.innerHTML = `
    <div class="shell" style="--panel-opacity: ${data.window.opacity}">
      ${renderTitlebar()}
      <main class="content">
        <div class="toolbar">
          <button type="button" class="add-btn" id="btn-add">＋ 新增区域</button>
          <label class="opacity-control" title="窗口面板透明度">
            <span>透明度</span>
            <input type="range" id="opacity-range" min="40" max="100" value="${opacityPct}" />
          </label>
        </div>
        <div class="blocks">
          ${data.blocks.map((b, i) => renderBlock(b, i)).join("") || '<p class="empty">还没有区域，点击上方按钮新增</p>'}
        </div>
      </main>
      <div class="toast" role="status" aria-live="polite"></div>
    </div>
  `;

  bindEvents();
}

function bindEvents() {
  document.querySelector("#btn-add")?.addEventListener("click", async () => {
    const block = createBlock();
    data.blocks.unshift(block);
    editingId = block.id;
    await persist();
    render();
    document.querySelector(".blocks")?.scrollTo({ top: 0 });
  });

  document.querySelector("#opacity-range")?.addEventListener("input", async (e) => {
    const value = Number((e.target as HTMLInputElement).value) / 100;
    data.window.opacity = value;
    await applyWindowConfig(data.window);
    await persist();
    const shell = document.querySelector<HTMLElement>(".shell");
    if (shell) shell.style.setProperty("--panel-opacity", String(value));
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

    el.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
      window.clearTimeout(copyClickTimer);
      editingId = id;
      render();
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
      render();
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
      editingId = null;
      await persist();
      render();
      showToast("已保存");
    });

    el.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      data.blocks = data.blocks.filter((b) => b.id !== id);
      editingId = null;
      await persist();
      render();
      showToast("已删除");
    });

    el.addEventListener("pointerdown", (e) => {
      if (editingId || e.button !== 0 || el.classList.contains("editing")) return;
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
      if (editingId || pe.button !== 0 || el.classList.contains("editing")) return;
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
