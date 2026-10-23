# 应用内更新与发布

PinBoard 使用 Tauri 2 官方 Updater，通过 GitHub Releases 的 `latest.json` 检查正式版。
启动时后台检查，持续运行时每 6 小时检查；发现更新显示标题栏图标和红点。
用户点击后可查看更新说明、下载进度，再选择“安装并重启”。安装前保存正在编辑的区域。
下载包由插件验证签名，校验失败不会安装。更新不迁移或删除用户数据文件。

## 首次配置（只做一次）

1. 运行 `npm ci`，在仓库外创建用于保存密钥的目录。
2. 在你自己的终端运行 `npm run setup-updater`。
3. 输入仓库外私钥的绝对路径，例如 `D:\PinBoardKeys\updater.key`，按提示设置非空密码。
4. 脚本调用 Tauri 生成密钥，并自动将 `.pub` 文件内容写入 `src-tauri/tauri.conf.json`。
5. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret** 中添加：
   - `TAURI_SIGNING_PRIVATE_KEY`：私钥文件的完整文本内容，不是路径，也不是 `.pub` 文件。
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成时设置的密码。
6. 安全备份私钥和密码。提交脚本生成的公钥配置；私钥只留在本机安全位置和 GitHub Secrets。
7. 运行 `npm run check-updater` 验证公钥配置。

初始化脚本不会覆盖已有密钥或已配置公钥。不要在每次发版时重新生成密钥；旧版客户端只信任内置的原公钥。
仓库初始公钥留空，发布流程会拒绝发布，必须完成初始化后再发版。

## 发布版本

1. 用 `npm version patch --no-git-tag-version`（或指定版本号）提升版本，现有脚本会同步 Rust 版本。
2. 提交版本文件和变更并推送 GitHub。
3. Actions → Release → Run workflow，填写用户可读的 `notes` 更新说明（必填，没有默认值）。
4. 工作流构建 Windows NSIS 安装包、签名和 `latest.json` 并上传 Release。
5. 正式发布时 `draft`、`prerelease` 均关闭。草稿和预发布不通过 `/releases/latest` 分发给正式版用户。

### 发版预检

构建前先跑 `preflight`（Ubuntu，十几秒），任一条不满足就直接失败、不进入构建：

- `package.json` / `Cargo.toml` / `Cargo.lock` 三处版本必须一致（`tauri.conf.json` 固定读 `../package.json`）
- 同名 tag 已存在且**不指向本次提交**时拒绝。这正是「版本号没 bump 就发版」的成因：tauri-action 按 `v__VERSION__` 找 tag，命中已有 Release 会把它的资产原地覆盖
- 版本号必须高于所有已发布 tag，避免 `releases/latest` 被旧版本顶回去、更新器读到过期清单
- 同名 Release 已是正式版则拒绝；同名草稿允许更新（草稿不产生 tag，发布后才出现）

失败原因在日志里以 `::error::` 开头，同时会写一张 `GITHUB_STEP_SUMMARY` 表（版本 / tag / 提交 / 草稿状态），发版前先扫一眼这张表再等构建。

Release 应包含 Windows 安装包、对应 `.sig` 和 `latest.json`。更新说明来自 Release 正文，应用按纯文本显示。
工作流使用 `scripts/create-updater-manifest.mjs` 生成清单，使用公开 Release 下载直链，避免匿名 GitHub API 额度影响安装包下载。
生成时同时检查签名与配置公钥的密钥标识一致；客户端仍会完整验证下载包签名。
`check-updater` 仅验证配置格式，不能证明安装版本内置公钥、发布签名、下载包三者匹配。
不要仅在发布完成后修改 Release 正文来更新应用内说明：`latest.json` 已生成，需要同步修改其 `notes`。
每次更新发布更高版本，并保证 manifest、签名、安装包配套。

现有不含更新功能的老版本，需要用户从 Release 手动安装一次带该功能的版本。
首次带更新功能的正式版发布后，再发布更高版本，才能验证完整升级链路。

## 本地检查与验收

Tauri 的 JavaScript 包与对应 Rust crate 必须保持主版本和次版本一致。
当前核心固定在 `2.11.x`，Updater 固定在 `2.12.x`（使用 `~` 允许补丁更新）。
升级这些依赖时应同时调整两端，并提交 `package-lock.json` 和 `src-tauri/Cargo.lock`。

- `npm run build`：TypeScript 与前端构建。
- `cargo check --manifest-path src-tauri/Cargo.toml`：Rust 插件与权限集成编译。
- `npm run check-updater`：发布配置检查，未初始化时应失败。
- 本地打签名包需要设置 `TAURI_SIGNING_PRIVATE_KEY`（私钥文本或绝对文件路径）和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 后运行 `npm run tauri build`。不要把密钥值写进命令历史。
- 安装签名版本 A，再发布版本 B：验证自动提示、手动检查、更新说明、下载、稍后安装、重启后版本号。
- 安装前保留一个未点击保存的编辑区域，确认重启后内容保留，并核对默认/自定义数据路径。
- 验证离线检查可重试、最新版本提示、启用鼠标穿透时更新弹窗仍可点击。
- 在隔离测试发布源替换包或签名，确认验证失败且不运行安装器。

Windows 的更新安装由 NSIS 接管并自动重启应用；无需额外的 process 插件。
更新签名与 Windows 发布者代码签名互相独立。
