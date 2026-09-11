/**
 * 以 package.json 的 version 为准，同步到 Cargo.toml / Cargo.lock。
 * tauri.conf.json 已配置为读取 ../package.json，无需再改。
 *
 * 用法：
 *   npm run sync-version
 *   npm version 0.3.2 --no-git-tag-version   # 会先改 package.json，再触发本脚本
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`无效版本号: ${version}`);
  process.exit(1);
}

const cargoTomlPath = join(root, "src-tauri", "Cargo.toml");
const cargoToml = readFileSync(cargoTomlPath, "utf8");
const nextCargoToml = cargoToml.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${version}"`,
);
if (nextCargoToml === cargoToml && !cargoToml.includes(`version = "${version}"`)) {
  console.error("未能更新 src-tauri/Cargo.toml 的 version 字段");
  process.exit(1);
}
writeFileSync(cargoTomlPath, nextCargoToml);

const cargoLockPath = join(root, "src-tauri", "Cargo.lock");
const cargoLock = readFileSync(cargoLockPath, "utf8");
const nextCargoLock = cargoLock.replace(
  /(name = "pinboard"\n)version = "[^"]+"/,
  `$1version = "${version}"`,
);
if (nextCargoLock === cargoLock && !cargoLock.includes(`name = "pinboard"\nversion = "${version}"`)) {
  console.error("未能更新 src-tauri/Cargo.lock 中 pinboard 的 version");
  process.exit(1);
}
writeFileSync(cargoLockPath, nextCargoLock);

console.log(`已同步版本 ${version} → Cargo.toml / Cargo.lock`);
