import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validateUpdaterConfig } from "./check-updater.mjs";

export function createManifest({ version, repository, release, filename, signature, pubkey }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid GitHub repository");
  if (release.tag_name !== `v${version}`) throw new Error("Release tag does not match application version");
  const packet = (text) => Buffer.from(Buffer.from(text.trim(), "base64").toString("utf8").trim().split(/\r?\n/)[1] ?? "", "base64");
  const publicPacket = packet(pubkey);
  const signaturePacket = packet(signature);
  if (publicPacket.length !== 42 || signaturePacket.length !== 74 ||
      !publicPacket.subarray(2, 10).equals(signaturePacket.subarray(2, 10))) {
    throw new Error("Updater signature key ID does not match the configured public key");
  }
  const platform = {
    signature: signature.trim(),
    url: `https://github.com/${repository}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(filename)}`,
  };
  return {
    version,
    notes: release.body ?? "",
    pub_date: release.published_at ?? release.created_at,
    platforms: { "windows-x86_64": platform, "windows-x86_64-nsis": platform },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  validateUpdaterConfig(config);
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const directory = "src-tauri/target/release/bundle/nsis";
  const installers = readdirSync(directory).filter((name) => name.endsWith(".exe"));
  if (installers.length !== 1) throw new Error("Expected exactly one NSIS installer");
  const filename = installers[0];
  const manifest = createManifest({
    version,
    repository: process.env.GITHUB_REPOSITORY,
    release: JSON.parse(readFileSync("release-info.json", "utf8")),
    filename,
    signature: readFileSync(resolve(directory, `${filename}.sig`), "utf8"),
    pubkey: config.plugins.updater.pubkey,
  });
  writeFileSync("src-tauri/target/latest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updater manifest generated with public Release download URLs for v${version}`);
}
