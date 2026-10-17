/** Generate keys interactively; never read or print the private key in this script. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { validateUpdaterConfig } from "./check-updater.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "src-tauri/tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (config.plugins.updater.pubkey) {
  console.error("已配置更新公钥，停止初始化。请继续使用原来的私钥，避免旧版无法更新。");
  process.exit(1);
}
const input = createInterface({ input: process.stdin, output: process.stdout });
const keyPathInput = (await input.question("私钥保存位置（仓库外的绝对路径，例如 D:\\PinBoardKeys\\updater.key）：")).trim();
input.close();
if (!isAbsolute(keyPathInput)) throw new Error("请提供仓库外的绝对路径。");
const keyPath = resolve(keyPathInput);
const within = relative(root, keyPath);
if (!within.startsWith("..") && !isAbsolute(within)) throw new Error("密钥必须保存在仓库外。");
if (!existsSync(dirname(keyPath))) throw new Error("请先创建密钥的父目录。");
if (existsSync(keyPath) || existsSync(`${keyPath}.pub`)) throw new Error("目标文件已存在，拒绝覆盖。");
console.log("接下来由 Tauri 提示输入私钥密码。请设置密码并保存到密码管理器。");
// Call the CLI JS entry directly: no shell interpolation of the chosen path.
const result = spawnSync(process.execPath, [resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
  "signer", "generate", "--write-keys", keyPath], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
config.plugins.updater.pubkey = readFileSync(`${keyPath}.pub`, "utf8").trim();
validateUpdaterConfig(config);
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log("\n公钥已写入 src-tauri/tauri.conf.json。\n请在 GitHub 仓库 Settings → Secrets and variables → Actions 配置：\n  TAURI_SIGNING_PRIVATE_KEY：私钥文件内容（不是文件路径）\n  TAURI_SIGNING_PRIVATE_KEY_PASSWORD：生成时设置的密码\n请安全备份私钥和密码，并提交公钥配置；不要将私钥发到聊天或提交到仓库。");
