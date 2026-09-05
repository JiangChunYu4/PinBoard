export interface Block {
  id: string;
  title: string;
  content: string;
  /** 展示态最多显示的行数；0 表示显示全部 */
  displayLines: number;
}

export interface WindowConfig {
  width: number;
  height: number;
  opacity: number;
  alwaysOnTop: boolean;
  /** Windows 开机自动启动 */
  launchOnStartup: boolean;
}

export interface AppData {
  blocks: Block[];
  window: WindowConfig;
}

export const DEFAULT_DISPLAY_LINES = 0;
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
  },
};

export function clampDisplayLines(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DISPLAY_LINES;
  return Math.min(MAX_DISPLAY_LINES, Math.max(MIN_DISPLAY_LINES, Math.round(value)));
}

export function normalizeBlock(block: Partial<Block> & Pick<Block, "id" | "title" | "content">): Block {
  return {
    id: block.id,
    title: block.title ?? "",
    content: block.content ?? "",
    displayLines: clampDisplayLines(block.displayLines ?? DEFAULT_DISPLAY_LINES),
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
