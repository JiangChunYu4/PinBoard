# PinBoard

<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="PinBoard" />
</p>

<p align="center">
  <strong>一款轻量、离线的桌面工具，用于快速查看和复制固定文本。</strong>
</p>

<p align="center">
  <a href="https://github.com/JiangChunYu4/PinBoard/releases/latest"><img src="https://img.shields.io/github/v/release/JiangChunYu4/PinBoard?style=for-the-badge&label=Download&logo=github" alt="Latest Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-FFC131?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
</p>

---

## ✨ 功能

| | |
| --- | --- |
| 📌 **始终置顶** | 悬浮在其他窗口之上，随时可见 |
| 📋 **一键复制** | 点击区域名称，全文写入系统剪贴板 |
| 🗂️ **多区域管理** | 文本分区存放，互不干扰 |
| ✏️ **快捷编辑** | 双击区域或点 ✎ 即可修改 |
| ↕️ **拖拽排序** | 拖动标题调整区域顺序 |
| 👁️ **显示行数** | 每个区域可单独限制展示行数（`0` = 全部） |
| 🌫️ **透明度** | 滑条调节面板透明度，不挡视线 |
| ⌨️ **快捷键呼出** | `Ctrl + Shift + P` 快速显示 / 隐藏窗口 |
| 💾 **本地保存** | 数据存在本机，关闭后自动恢复，无需联网 |

---

## ⬇️ 下载安装

1. 打开 [最新 Release](https://github.com/JiangChunYu4/PinBoard/releases/latest)
2. 下载 **`PinBoard_*_x64-setup.exe`**
3. 运行安装包，按提示完成安装

> 系统要求：Windows 10 / 11（一般已自带 WebView2）

安装后从开始菜单启动 **PinBoard** 即可。

---

## 🚀 快速上手

1. 点 **＋ 新增区域**，写入标题和内容  
2. **点击区域名称** → 复制成功  
3. **双击区域** 或点 **✎** → 编辑  
4. 拖动标题 → 调整顺序  
5. 顶部滑条 → 调整透明度  

正文仍可选中局部文字后用 `Ctrl+C` 复制。

---

## 👨‍💻 参与开发

```bash
npm install
npm run tauri dev
```

环境：Node.js 18+、Rust stable、Windows + MSVC Build Tools。  
打包：`npm run tauri build`。更多说明见 [`docs/requirement.md`](docs/requirement.md)。

---

## 📄 License

[MIT](LICENSE) © jiangchunyu
