import { expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listNotaryProfiles } from "../packages/cli/src/notary-profiles.ts";
import type { Runner } from "../packages/cli/src/credentials.ts";

test("discovery queries attributes without password data, including local and synchronized profiles", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-notary-profiles-"));
  try {
    const execute = vi.fn<Runner>().mockResolvedValue('["z-profile", "a-profile", "z-profile"]');
    expect(await listNotaryProfiles(root, undefined, execute)).toEqual(["a-profile", "z-profile"]);
    const args = execute.mock.calls[0]![1];
    expect(args.slice(0, 3)).toEqual(["xcrun", "swift", "-suppress-warnings"]);
    const source = readFileSync(args[3]!, "utf8");
    expect(source).toContain("kSecReturnAttributes: true");
    expect(source).toContain("kSecReturnData: false");
    expect(source).toContain("kSecAttrLabel: \"com.apple.gke.notary.tool\"");
    expect(source).toContain("kSecAttrSynchronizableAny");
    expect(source).toContain("kSecUseDataProtectionKeychain");
    expect(source).toContain("context.interactionNotAllowed = true");
    expect(source).not.toContain("kSecReturnData: true");
    expect(source).not.toContain("SecItemAdd");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("explicit keychains are passed as a single argument to a restricted search", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-notary-profiles-"));
  try {
    const execute = vi.fn<Runner>().mockResolvedValue("[]");
    const keychain = "/tmp/custom signing.keychain-db";
    expect(await listNotaryProfiles(root, keychain, execute)).toEqual([]);
    expect(execute.mock.calls[0]![1].at(-1)).toBe(keychain);
    expect(readFileSync(execute.mock.calls[0]![1][3]!, "utf8")).toContain("query[kSecMatchSearchList] = [keychain]");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each(["{}", '[1]', '[""]'])("invalid discovery results fail explicitly (%s)", async output => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-notary-profiles-"));
  try {
    await expect(listNotaryProfiles(root, undefined, async () => output)).rejects.toThrow("Invalid notarization profile discovery result");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== "darwin")("native discovery emits only profile names without creating Keychain items", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-notary-profiles-"));
  try {
    const profiles = await listNotaryProfiles(root);
    expect(profiles.every(profile => typeof profile === "string" && profile.length > 0)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
