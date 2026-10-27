import { dockWindow, getWindowSnapshot, undockWindow, type WindowSnapshot } from "./storage";
import type { DockSide } from "./types";

const EDGE_TOLERANCE = 8;
const COLLAPSE_DELAY = 500;
/** 穿透关闭后轮询光标的间隔与次数上限（约 10s） */
const WATCH_INTERVAL = 250;
const WATCH_TICKS = 40;
/** 与 CSS 里的过渡时长保持一致 */
const ANIM_IN_MS = 200;
const ANIM_OUT_MS = 140;
/** Windows 最小化后窗口的坐标 */
const MINIMIZED_X = -30000;

export interface ExpandedBounds {
  /** 窗口左上角物理像素 */
  x: number;
  y: number;
  /** 逻辑尺寸 */
  width: number;
  height: number;
}

export interface DockOptions {
  /** 穿透开启时细边收不到指针事件，收起来就展不开 */
  isClickThrough: () => boolean;
  /** 编辑中不自动收起 */
  isEditing: () => boolean;
  /** 系统光标是否在窗口内：穿透期间 WebView 的悬停状态不可信 */
  isPointerInside: () => Promise<boolean>;
  /** null = 解除收纳 */
  onPreferenceChange: (side: DockSide | null) => void;
}

export interface DockController {
  /** 启动时按已保存偏好对齐界面（窗口几何由 Rust 摆好） */
  hydrate: (side: DockSide | null, bounds: ExpandedBounds | null, collapsedNow: boolean) => void;
  /**
   * 拖动 / 缩放停止后调用；返回 true 表示几何已由收纳接管，调用方不要再写配置，
   * 否则下次启动只剩一条细边。
   */
  handleBoundsSettled: () => Promise<boolean>;
  expandForClickThrough: () => Promise<void>;
  /** 关掉穿透后恢复贴边待命 */
  resumeAfterClickThrough: () => void;
  /** 点任务栏图标 / Alt+Tab 切回来时展开 */
  handleWake: () => void;
}

export function createDock(options: DockOptions): DockController {
  let side: DockSide | null = null;
  /** 处于细边形态；悬停展开时 side 仍保留 */
  let collapsed = false;
  /** 展开态边界，只在内存里 */
  let expanded: ExpandedBounds | null = null;
  let busy = false;
  let collapseTimer: number | undefined;
  let settleTimer: number | undefined;
  let watchTimer: number | undefined;
  /** 收起动画未结束时指针就进来了，落定后补一次展开 */
  let pendingExpand = false;
  /** 从任务栏唤醒时指针还在外面，先别按「离开即收起」处理 */
  let sticky = false;

  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  /** 连续两帧：等改尺寸引发的重排与绘制落地 */
  const settleFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  /** 等 WebView 真的切到目标宽度，别在重排中途起动画 */
  async function waitViewport(width: number) {
    const deadline = performance.now() + 150;
    while (performance.now() < deadline && Math.abs(window.innerWidth - width) > 1) {
      await frame();
    }
    await settleFrame();
  }

  /** 等 transform 过渡结束，带超时兜底 */
  function waitSlide(ms: number): Promise<void> {
    const shell = document.querySelector(".shell");
    if (!shell) return wait(ms);
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        shell.removeEventListener("transitionend", onEnd);
        window.clearTimeout(timer);
        resolve();
      };
      const onEnd = (event: Event) => {
        if ((event as TransitionEvent).propertyName === "transform") finish();
      };
      shell.addEventListener("transitionend", onEnd);
      const timer = window.setTimeout(finish, ms + 80);
    });
  }

  function flushTimer() {
    if (collapseTimer !== undefined) {
      window.clearTimeout(collapseTimer);
      collapseTimer = undefined;
    }
  }

  function stopWatch() {
    if (watchTimer !== undefined) {
      window.clearInterval(watchTimer);
      watchTimer = undefined;
    }
  }

  /** 指针是否还在窗口里；查不到就退回 WebView 的悬停状态 */
  async function pointerInside(): Promise<boolean> {
    try {
      return await options.isPointerInside();
    } catch {
      return document.body.matches(":hover");
    }
  }

  function paint() {
    document.body.classList.toggle("is-docked", collapsed);
    if (side) document.body.dataset.dock = side;
    else delete document.body.dataset.dock;
  }

  function detectEdge(snapshot: WindowSnapshot): DockSide | null {
    const scale = snapshot.scaleFactor || 1;
    const tolerance = Math.max(4, Math.round(EDGE_TOLERANCE * scale));
    const leftGap = snapshot.x - snapshot.monitorX;
    const rightGap = snapshot.monitorX + snapshot.monitorWidth - (snapshot.x + snapshot.widthPx);
    // 另一侧必须明显不贴边，避免「窗口几乎占满整屏」时两侧同时命中
    if (leftGap <= tolerance && rightGap > tolerance) return "left";
    if (rightGap <= tolerance && leftGap > tolerance) return "right";
    return null;
  }

  function armCollapse() {
    flushTimer();
    if (!side || collapsed || sticky || options.isClickThrough()) return;
    collapseTimer = window.setTimeout(() => {
      collapseTimer = undefined;
      void collapseIfPointerLeft();
    }, COLLAPSE_DELAY);
  }

  async function collapseIfPointerLeft() {
    const target = side;
    if (collapsed || !target || options.isClickThrough()) return;
    // 关掉穿透时会主动起计时，这时用户可能还停在设置页
    if (await pointerInside()) return;
    if (!side || collapsed) return;
    if (options.isEditing()) {
      armCollapse();
      return;
    }
    void collapse(target);
  }

  async function collapse(next: DockSide) {
    if (busy || collapsed) return;
    const snapshot = await getWindowSnapshot();
    if (!snapshot) return;
    // 最小化时窗口坐标是 -32000、尺寸 160x28，写进展开位置会让下次展开错位
    if (snapshot.x <= MINIMIZED_X || snapshot.width < 20) {
      armCollapse();
      return;
    }
    busy = true;
    flushTimer();
    stopWatch();
    expanded = {
      x: snapshot.x,
      y: snapshot.y,
      width: snapshot.width,
      height: snapshot.height,
    };
    // 先定贴边侧：滑动方向由它决定
    side = next;
    document.body.dataset.dock = next;
    try {
      // 面板先滑出；细边等窗口缩到 10px 再淡入，免得闪一下蓝线
      document.body.classList.add("dock-out", "dock-park");
      await waitSlide(ANIM_OUT_MS);
      document.body.classList.remove("dock-out");
      // 滑出途中刚开了穿透：不再压成细边，让面板滑回去
      if (options.isClickThrough()) return;
      await dockWindow(next);
      collapsed = true;
      document.body.classList.add("dock-strip-on");
    } finally {
      document.body.classList.remove("dock-out");
      document.body.classList.toggle("dock-park", collapsed);
      document.body.classList.toggle("dock-strip-on", collapsed);
      paint();
      busy = false;
    }
    if (pendingExpand) {
      pendingExpand = false;
      if (collapsed) void expand();
    }
  }

  async function expand() {
    if (busy || !collapsed || !expanded) return;
    pendingExpand = false;
    busy = true;
    const target = expanded;
    try {
      // 面板在屏幕外显形：此时窗口只有 10px；细边同时退场，免得跟着弹出来
      document.body.classList.add("dock-park");
      document.body.classList.remove("is-docked", "dock-strip-on");
      // 窗口跳到全宽，重排与重绘都发生在看不见的时候
      await undockWindow(target);
      // 下限 300：配置写坏也别死等
      await waitViewport(Math.max(target.width, 300));
      document.body.classList.add("dock-in");
      document.body.classList.remove("dock-park", "dock-strip-on");
      await waitSlide(ANIM_IN_MS);
      collapsed = false;
    } finally {
      document.body.classList.remove("dock-in", "dock-park", "dock-strip-on");
      paint();
      busy = false;
    }
    // 展开途中指针可能已离开，兜一次收起计时
    if (!document.body.matches(":hover")) armCollapse();
  }

  async function handleBoundsSettled(): Promise<boolean> {
    if (busy) {
      // 还没落定：260ms 后按最终位置再判一次，别丢掉「展开后立刻拖到边缘」
      if (settleTimer === undefined) {
        settleTimer = window.setTimeout(() => {
          settleTimer = undefined;
          void handleBoundsSettled();
        }, 260);
      }
      return true;
    }
    if (collapsed) return true;
    const snapshot = await getWindowSnapshot();
    if (!snapshot) return false;

    const edge = detectEdge(snapshot);
    // 展开态仍贴着原侧：继续由收纳接管
    if (side && edge === side) return true;

    if (edge && !options.isClickThrough()) {
      // 就地改贴另一侧；只清旧侧会让首次换侧不收纳
      side = edge;
      options.onPreferenceChange(edge);
      paint();
      void collapse(edge);
      return false;
    }

    if (side) {
      side = null;
      options.onPreferenceChange(null);
      paint();
    }
    // 返回 false，让调用方照常记录位置：下次展开才从边缘滑出
    return false;
  }

  /** 穿透启动时窗口已展开，侧偏好仍要留着 */
  function hydrate(saved: DockSide | null, bounds: ExpandedBounds | null, collapsedNow: boolean) {
    side = saved;
    expanded = bounds;
    collapsed = collapsedNow && Boolean(saved) && Boolean(bounds);
    paint();
  }

  /** 开穿透前先展开；收起动画可能正在跑，等它落定，否则窗口会先被压成细边再弹回 */
  async function expandForClickThrough() {
    flushTimer();
    for (let i = 0; i < 16 && busy; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (collapsed) await expand();
  }

  /** 恢复自动收起待命：穿透期间 WebView 的指针事件不可信，改轮询系统光标 */
  function resumeAfterClickThrough() {
    stopWatch();
    sticky = false;
    if (!side || collapsed || options.isClickThrough()) return;
    let ticks = 0;
    watchTimer = window.setInterval(() => {
      ticks += 1;
      if (collapsed || !side || options.isClickThrough()) {
        stopWatch();
        return;
      }
      if (ticks > WATCH_TICKS) {
        stopWatch();
        armCollapse();
        return;
      }
      void pointerInside().then((inside) => {
        if (inside || watchTimer === undefined) return;
        stopWatch();
        armCollapse();
      });
    }, WATCH_INTERVAL);
  }

  function handleWake() {
    stopWatch();
    if (busy) {
      pendingExpand = true;
      return;
    }
    if (!collapsed) return;
    sticky = true;
    void expand();
  }

  document.body.addEventListener("pointerenter", () => {
    flushTimer();
    stopWatch();
    sticky = false;
    if (busy) {
      pendingExpand = true;
      return;
    }
    if (collapsed) void expand();
  });

  document.body.addEventListener("pointerleave", () => {
    pendingExpand = false;
    if (!side || collapsed || busy) return;
    armCollapse();
  });

  return {
    hydrate,
    handleBoundsSettled,
    expandForClickThrough,
    resumeAfterClickThrough,
    handleWake,
  };
}
