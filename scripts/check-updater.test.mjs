import { test } from "node:test";
import assert from "node:assert/strict";
import { validateUpdaterConfig } from "./check-updater.mjs";

// Structurally valid synthetic public packet; no private key is created.
function config() {
  const packet = Buffer.alloc(42);
  packet.write("Ed");
  const key = Buffer.from(`untrusted comment: test\n${packet.toString("base64")}\n`).toString("base64");
  return { plugins: { updater: { pubkey: key, endpoints: ["https://example.com/latest.json"] } },
    bundle: { createUpdaterArtifacts: true } };
}
test("accepts a public packet and HTTPS endpoint", () => {
  assert.doesNotThrow(() => validateUpdaterConfig(config()));
});
test("rejects missing or malformed signing keys", () => {
  for (const key of ["", "not-a-key", Buffer.from("untrusted comment: fake\ninvalid").toString("base64")]) {
    const value = config();
    value.plugins.updater.pubkey = key;
    assert.throws(() => validateUpdaterConfig(value), /公钥/);
  }
});
test("rejects unsigned build configuration", () => {
  const value = config();
  value.bundle.createUpdaterArtifacts = false;
  assert.throws(() => validateUpdaterConfig(value), /createUpdaterArtifacts/);
});
test("rejects insecure and empty endpoints", () => {
  for (const endpoints of [[], ["http://example.com/latest.json"]]) {
    const value = config();
    value.plugins.updater.endpoints = endpoints;
    assert.throws(() => validateUpdaterConfig(value), /HTTPS/);
  }
});
