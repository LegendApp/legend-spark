import { expect, test } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { verifyUpdateSignature, prepareUpdate, SPARKLE_VERSION, validateUpdateBuildVersion } from "../packages/cli/src/updates.ts";
import { goConfigurationIssues } from "../packages/cli/src/project.ts";
const { updateConfiguration, updatePlist } = createRequire(import.meta.url)("../packages/config-plugin/updates.cjs");
const valid = { feedURL: "https://example.com/updates/appcast.xml", publicKey: Buffer.alloc(32).toString("base64") };
function config(updates: unknown) { return { extra: { spark: { updates } } }; }
test("update configuration requires HTTPS, an XML feed and a 32-byte Ed25519 public key", () => {
  expect(updateConfiguration({})).toBeUndefined();
  expect(updateConfiguration(config(valid))).toEqual(valid);
  for (const feedURL of ["http://example.com/appcast.xml", "https://u:p@example.com/appcast.xml", "file:///appcast.xml", "https://example.com/appcast.xml?token=secret", "https://example.com/feed"])
    expect(() => updateConfiguration(config({ ...valid, feedURL }))).toThrow();
  for (const publicKey of ["", "secret", Buffer.alloc(16).toString("base64")]) expect(() => updateConfiguration(config({ ...valid, publicKey }))).toThrow();
});
test("CNG pins signed feeds and archives and leaves checks/installations under user control", () => {
  expect(updatePlist(config(valid))).toMatchObject({ SUPublicEDKey: valid.publicKey, SURequireSignedFeed: true, SUVerifyUpdateBeforeExtraction: true, SUEnableAutomaticChecks: false, SUAllowsAutomaticUpdates: false });
  expect(goConfigurationIssues(config(valid))).toContain("Update feed configuration requires a custom runtime");
  expect(readFileSync(new URL("../packages/updates/RNDesktopUpdates.podspec", import.meta.url), "utf8")).toContain(`"Sparkle", "${SPARKLE_VERSION}"`);
});
test("update signatures verify real bytes and reject tampering and another signing key", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-update-signatures-"));
  try {
    const file = path.join(root, "update.zip"); const bytes = Buffer.from("the exact distribution archive"); writeFileSync(file, bytes);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const key = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64");
    const signature = sign(null, bytes, privateKey).toString("base64");
    expect(() => verifyUpdateSignature(file, signature, key)).not.toThrow();
    expect(() => verifyUpdateSignature(file, signature, valid.publicKey)).toThrow();
    writeFileSync(file, "tampered"); expect(() => verifyUpdateSignature(file, signature, key)).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("ordinary packaging does not download tools or touch update credentials", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-no-updates-"));
  try {
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: {} }));
    expect(await prepareUpdate(root, "unused.zip", "1", { run: async () => { throw new Error("unexpected subprocess"); }, tools: async () => { throw new Error("unexpected download"); } })).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("Spark update build numbers increase numerically and allow only exact-byte retries", () => {
  const records = { "2.9": { sha256: "a" }, "10": { sha256: "b" } };
  expect(() => validateUpdateBuildVersion("9", records, "c")).toThrow("must be greater");
  expect(() => validateUpdateBuildVersion("2.10", { "2.9": { sha256: "a" } }, "b")).not.toThrow();
  expect(() => validateUpdateBuildVersion("2.9", { "2.10": { sha256: "a" } }, "b")).toThrow("must be greater");
  expect(() => validateUpdateBuildVersion("2.9.1", { "2.9": { sha256: "a" } }, "b")).not.toThrow();
  expect(() => validateUpdateBuildVersion("1", { "1.0": { sha256: "a" } }, "a")).toThrow("aliases");
  expect(() => validateUpdateBuildVersion("1.0.0", { "01.0": { sha256: "a" } }, "a")).toThrow("aliases");
  expect(() => validateUpdateBuildVersion("1", { "1": { sha256: "a" } }, "a")).not.toThrow();
  expect(() => validateUpdateBuildVersion("1", { "1": { sha256: "a" } }, "b")).toThrow("different bytes");
  expect(() => validateUpdateBuildVersion("0", {}, "a")).not.toThrow();
  expect(() => validateUpdateBuildVersion("1.10", { "1.9": { sha256: "a" } }, "b")).not.toThrow();
  expect(() => validateUpdateBuildVersion("1.9", { "1.10": { sha256: "a" } }, "b")).toThrow("must be greater");
  const huge = "9".repeat(200);
  const next = `1${"0".repeat(200)}`;
  expect(() => validateUpdateBuildVersion(next, { [huge]: { sha256: "a" } }, "b")).not.toThrow();
  expect(() => validateUpdateBuildVersion(huge, { [next]: { sha256: "a" } }, "b")).toThrow("must be greater");
  expect(() => validateUpdateBuildVersion("1.2.3.4", {}, "a")).toThrow("numeric macOS buildNumber");
});
test("delta generation is opt-in, bounded, and passed to generate_appcast", () => {
  expect(updateConfiguration(config({ ...valid, maximumDeltas: 3 }))).toEqual({ ...valid, maximumDeltas: 3 });
  for (const maximumDeltas of [-1, 1.5, 11, "3", null]) expect(() => updateConfiguration(config({ ...valid, maximumDeltas }))).toThrow("maximumDeltas");
  expect(updatePlist(config({ ...valid, maximumDeltas: 3 }))).not.toHaveProperty("maximumDeltas");
});
test("packaging publishes, reports and keeps only the new build's signed deltas", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-update-deltas-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const key = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: { macos: { bundleIdentifier: "so.legend.fixture" }, extra: { spark: { updates: { feedURL: valid.feedURL, publicKey: key, maximumDeltas: 2 } } } } }));
    const archive = path.join(root, "App.zip"); writeFileSync(archive, "archive bytes");
    const signature = sign(null, readFileSync(archive), privateKey).toString("base64");
    // A previous release left its delta and a feed item referencing it.
    mkdirSync(path.join(root, "dist/updates"), { recursive: true });
    writeFileSync(path.join(root, "dist/updates/App1-0.delta"), "old delta");
    writeFileSync(path.join(root, "dist/updates/appcast.xml"), "<item><sparkle:version>1</sparkle:version>\n<sparkle:deltas>\n<enclosure url=\"App1-0.delta\"/>\n</sparkle:deltas>\n</item>");
    const commands: string[][] = [];
    let staged: { files: string[]; feed: string } | undefined;
    const run = async (_root: string, command: string[]) => {
      commands.push(command);
      const tool = path.basename(command[0]);
      if (tool === "sign_update") return command.includes("--verify") ? "" : signature;
      const staging = command.at(-1)!;
      staged = { files: readdirSync(staging), feed: readFileSync(command[command.indexOf("-o") + 1], "utf8") };
      writeFileSync(path.join(staging, "App2-1.delta"), "delta");
      writeFileSync(command[command.indexOf("-o") + 1], `<enclosure sparkle:edSignature="${signature}"/>`);
      return "";
    };
    const result = await prepareUpdate(root, archive, "2", { run, tools: async () => "/tools" });
    expect(commands.find(command => command[0].endsWith("generate_appcast"))).toEqual(expect.arrayContaining(["--maximum-deltas", "2"]));
    expect(result?.deltas).toEqual([path.join(root, "dist/updates/App2-1.delta")]);
    expect(readFileSync(path.join(root, "dist/updates/App2-1.delta"), "utf8")).toBe("delta");
    // generate_appcast saw neither the old delta nor a reference to it; the stale file is gone.
    expect(staged?.files).not.toContain("App1-0.delta");
    expect(staged?.feed).toBe("<item><sparkle:version>1</sparkle:version>\n</item>");
    expect(readdirSync(path.join(root, "dist/updates")).filter(file => file.endsWith(".delta"))).toEqual(["App2-1.delta"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
