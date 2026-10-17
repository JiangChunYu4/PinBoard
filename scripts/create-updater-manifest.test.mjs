import { test } from "node:test";
import assert from "node:assert/strict";
import { createManifest } from "./create-updater-manifest.mjs";

function options() {
  const encode = (length) => {
    const packet = Buffer.alloc(length);
    packet.write("Ed");
    packet.fill(1, 2, 10);
    return Buffer.from(`untrusted comment: test\n${packet.toString("base64")}\n`).toString("base64");
  };
  return { version: "0.4.3", repository: "owner/repo", release: {
    tag_name: "v0.4.3", body: "Release notes", published_at: "2026-10-17T00:00:00Z",
  }, filename: "PinBoard_0.4.3_x64-setup.exe", signature: encode(74), pubkey: encode(42) };
}
test("uses public download URLs and preserves signed metadata for both Windows targets", () => {
  const input = options();
  const result = createManifest(input);
  assert.equal(result.platforms["windows-x86_64"].url,
    "https://github.com/owner/repo/releases/download/v0.4.3/PinBoard_0.4.3_x64-setup.exe");
  assert.deepEqual(result.platforms["windows-x86_64"], result.platforms["windows-x86_64-nsis"]);
  assert.equal(result.platforms["windows-x86_64"].signature, input.signature);
  assert.equal(result.notes, input.release.body);
});
test("rejects release tag mismatch", () => {
  const input = options();
  input.version = "0.4.4";
  assert.throws(() => createManifest(input), /tag/);
});
test("rejects a signing key different from the configured public key", () => {
  const input = options();
  const packet = Buffer.alloc(74, 2);
  input.signature = Buffer.from(`untrusted comment: test\n${packet.toString("base64")}`).toString("base64");
  assert.throws(() => createManifest(input), /key ID/);
});
