# PinBoard

<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="PinBoard" />
</p>

<p align="center">
  <strong>一款轻量、离线的桌面工具，用于快速查看和复制固定文本。</strong>
</p>

<p align="center">
  <a href="https://github.com/JiangChunYu4/PinBoard/releases/latest"><img src="https://img.shields.io/github/v/release/JiangChunYu4/PinBoard?style=for-the-badge&label=Download&logo=github" alt="Latest Release" /></a>
  <a href="https://github.com/JiangChunYu4/PinBoard/releases"><img src="https://img.shields.io/github/downloads/JiangChunYu4/PinBoard/total?style=for-the-badge&label=Downloads" alt="Downloads" /></a>
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

|                      |                                                      |
| -------------------- | ---------------------------------------------------- |
| 📌 **始终置顶**      | 悬浮在其他窗口之上，随时可见                         |
| 📋 **一键复制**      | 点击区域名复制全文，点击分段复制该段                 |
| 🔀 **子区域**        | 一段文字可拆成多段，长清单也能逐项复制               |
| 🔍 **搜索**          | 标题、内容与分段实时筛选，命中高亮                   |
| 🔢 **字数统计**      | 区域与分段实时计数，超出上限标色                     |
| 🕘 **最近复制**      | 顶部保留最近 5 条，单击即可再次复制，重启后仍在      |
| 🗂️ **分区管理**     | 多区域存放、拖拽排序、各自限制显示行数               |
| 🌫️ **外观**         | 透明度可调，窗口位置与尺寸自动记忆                   |
| ⌨️ **快捷操作**     | `Ctrl + Shift + P` 呼出 / 隐藏，可开机自启           |
| 💾 **本地保存**      | 数据存于本机 `pinboard.json`，路径可自定义，无需联网 |

---

## ⬇️ 下载安装

1. 打开 [最新 Release](https://github.com/JiangChunYu4/PinBoard/releases/latest)
2. 下载 **`PinBoard_*_x64-setup.exe`**
3. 运行安装包，按提示完成安装

> 系统要求：Windows 10 / 11（一般已自带 WebView2）

安装后从开始菜单启动 **PinBoard** 即可。之后在设置页可检查更新，有新版本时可直接下载安装。

---

## 🚀 快速上手

1. 点 **＋ 新增区域**，写入标题和内容
2. **点击区域名称** → 复制全文；`Ctrl + 单击` 只复制标题
3. 点 **✎** 编辑；长内容可点布局按钮「转为子区域」，改成逐段复制
4. 拖动标题调整顺序，顶部搜索框实时筛选
5. 顶部滑条调透明度，齿轮进设置页

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

[MIT](LICENSE) © Jiang, Chunyu
