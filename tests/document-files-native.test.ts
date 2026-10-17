import { runOk } from "./subprocess.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const ID = "so.legend.spark.tests.document-files";
const plist = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${entries}</dict></plist>`;

test.skipIf(process.platform !== "darwin" || process.getuid?.() === 0)("native document versions, locking and coordinated conditional writes on temp files, unsandboxed and in the App Sandbox", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-document-files-"));
  const mount = path.join(directory, "fat");
  let attached = false;
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const native = path.join(root, "packages/file-system/macos");
    const output = path.join(directory, "test");
    writeFileSync(path.join(directory, "Info.plist"), plist(`<key>CFBundleIdentifier</key><string>${ID}</string>`));
    await runOk("clang++", ["-sectcreate", "__TEXT", "__info_plist", path.join(directory, "Info.plist"),"-std=c++17", "-fobjc-arc", "-fblocks", "-framework", "Foundation", "-framework", "AppKit", "-framework", "Quartz", "-framework", "QuickLookThumbnailing", "-framework", "UniformTypeIdentifiers", "-framework", "CoreServices", "-framework", "Security",
      "-I", native, "-I", path.join(root, "packages/desktop-app/macos"),
      path.join(native, "SparkDocumentFiles.mm"), path.join(native, "SparkFileIntegration.mm"), path.join(native, "SparkFileMutations.mm"),
      path.join(root, "tests/document-files.native.mm"), "-o", output]);
    // A FAT image has no document revision store.
    await runOk("hdiutil", ["create", "-quiet", "-size", "8m", "-fs", "MS-DOS", "-volname", "SPARKDOC", path.join(directory, "fat.dmg")]);
    mkdirSync(mount);
    await runOk("hdiutil", ["attach", "-quiet", "-nobrowse", "-mountpoint", mount, path.join(directory, "fat.dmg")]);
    attached = true;
    const work = path.join(directory, "work");
    mkdirSync(work);
    expect(await runOk(output, [work, mount])).toContain("Document file tests passed");
    // Sandboxed as `spark build --sandbox` signs an app, on a scratch folder in its container (~/Library/Containers/<ID>).
    const sandboxed = `${output}-sandboxed`;
    writeFileSync(`${sandboxed}.entitlements`, plist("<key>com.apple.security.app-sandbox</key><true/>"));
    await runOk("cp", [output, sandboxed]);
    await runOk("codesign", ["--force", "--sign", "-", "--entitlements", `${sandboxed}.entitlements`, sandboxed]);
    expect(await runOk(sandboxed, ["-"])).toContain("Document file tests passed");
  } finally {
    if (attached) await runOk("hdiutil", ["detach", "-quiet", mount]);
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);
