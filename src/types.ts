export interface Block {
  id: string;
  title: string;
  content: string;
  /** 展示态最多显示的行数；0 表示显示全部 */
  displayLines: number;
  /**
   * 块内子区域（R1）：每段是独立的值文本（单行/多行皆可），单击整段复制。
   * 软件对内容零假设；存在非空数组时展示态按子区域渲染，纯 content 块不受影响。
   */
  subRegions?: string[];
}

export interface WindowConfig {
  width: number;
  height: number;
  opacity: number;
  alwaysOnTop: boolean;
  /** Windows 开机自动启动 */
  launchOnStartup: boolean;
  /** 鼠标穿透：内容区点击落到下层窗口；标题栏仍可操作 */
  clickThrough: boolean;
  /** 新建区域时的默认显示行数；0 表示显示全部 */
  defaultDisplayLines: number;
}

export interface AppData {
  blocks: Block[];
  window: WindowConfig;
}

export const DEFAULT_DISPLAY_LINES = 4;
export const MIN_DISPLAY_LINES = 0;
export const MAX_DISPLAY_LINES = 30;

export const DEFAULT_DATA: AppData = {
  blocks: [
    {
      id: "block-git",
      title: "Git",
      content: "git pull origin main",
      displayLines: DEFAULT_DISPLAY_LINES,
    },
    {
      id: "block-docker",
      title: "Docker",
      content: "docker compose up -d",
      displayLines: DEFAULT_DISPLAY_LINES,
    },
    {
      id: "block-ssh",
      title: "SSH",
      content: "ssh user@server",
      displayLines: DEFAULT_DISPLAY_LINES,
    },
  ],
  window: {
    width: 360,
    height: 520,
    opacity: 0.96,
    alwaysOnTop: true,
    launchOnStartup: false,
    clickThrough: false,
    defaultDisplayLines: DEFAULT_DISPLAY_LINES,
  },
};

export function clampDisplayLines(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DISPLAY_LINES;
  return Math.min(MAX_DISPLAY_LINES, Math.max(MIN_DISPLAY_LINES, Math.round(value)));
}

export function normalizeBlock(block: Partial<Block> & Pick<Block, "id" | "title" | "content">): Block {
  // 子区域只做机械规范化：转字符串、丢弃空白项；空数组视为未启用（undefined）
  const rawSubs = block.subRegions;
  const subs = Array.isArray(rawSubs)
    ? rawSubs.map((s) => String(s)).filter((s) => s.trim().length > 0)
    : undefined;
  return {
    id: block.id,
    title: block.title ?? "",
    content: block.content ?? "",
    displayLines: clampDisplayLines(block.displayLines ?? DEFAULT_DISPLAY_LINES),
    subRegions: subs && subs.length > 0 ? subs : undefined,
  };
}

export function createBlock(title = "", content = "", displayLines = DEFAULT_DISPLAY_LINES): Block {
  return {
    id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content,
    displayLines: clampDisplayLines(displayLines),
  };
}
