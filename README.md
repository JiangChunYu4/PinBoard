# PinBoard

轻量级桌面置顶文本管理工具。把常用命令、代码片段、账号信息等固定在桌面，一键复制。

## 功能（MVP）

- 窗口置顶、无边框拖动、可调整大小
- 多区域独立管理文本
- 一键复制到系统剪贴板
- 双击 / 编辑按钮修改内容
- 拖拽调整区域顺序
- 本地 JSON 持久化（关闭后自动恢复）
- 透明度调节

## 技术栈

- Tauri 2
- Vite + TypeScript
- 本地文件存储（`%APPDATA%/com.pinboard.desktop/pinboard.json`）

## 开发环境要求

- Node.js 18+
- Rust stable（[rustup](https://rustup.rs/)）
- Windows 10/11
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（WebView2 通常已预装）

## 启动

在 **x64 Native Tools / Developer Command Prompt** 环境，或先初始化 MSVC 后再运行：

```powershell
# PowerShell 示例
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
cmd /c "`"$vcvars`" && set PATH=%USERPROFILE%\.cargo\bin;%PATH% && cd /d d:\PycharmProjects\PinBoard && npm run tauri -- dev"
```

日常开发（已配置好 PATH / MSVC 时）：

```bash
npm install
npm run tauri dev
```

仅预览前端（浏览器，无置顶/系统剪贴板能力）：

```bash
npm run dev
```

打包（NSIS 安装包）：

```bash
npm run tauri build
```

## 项目结构

```
PinBoard/
├── docs/requirement.md      # 需求文档
├── src/                     # 前端
│   ├── main.ts
│   ├── storage.ts
│   ├── types.ts
│   └── styles.css
└── src-tauri/               # Tauri / Rust
    ├── src/lib.rs           # 数据读写、复制、窗口配置
    └── tauri.conf.json
```
