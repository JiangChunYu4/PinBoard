import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function validateUpdaterConfig(value) {
  const key = value.plugins?.updater?.pubkey;
  const lines = typeof key === "string" ? Buffer.from(key, "base64").toString("utf8").trim().split(/\r?\n/) : [];
  const packet = Buffer.from(lines[1] ?? "", "base64");
  if (!lines[0]?.startsWith("untrusted comment:") || packet.length !== 42 || packet.subarray(0, 2).toString() !== "Ed") {
    throw new Error("尚未配置有效更新公钥，请先运行 npm run setup-updater 并配置 GitHub Actions Secrets。");
  }
  if (value.bundle?.createUpdaterArtifacts !== true) throw new Error("必须启用 createUpdaterArtifacts。");
  if (!value.plugins.updater.endpoints?.every((url) => url.startsWith("https://")) || !value.plugins.updater.endpoints.length) {
    throw new Error("更新源必须使用 HTTPS。");
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    validateUpdaterConfig(JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")));
    console.log("更新公钥与更新产物配置格式检查通过（不验证下载包签名或私钥密码）。");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
