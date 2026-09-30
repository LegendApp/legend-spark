import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, symlinkSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { expect, test } from "vitest";
test.skipIf(process.platform !== "darwin")("Codex supervisor and generated bindings compile against the pinned Nitro headers", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-codex-headers-"));
  const headers = path.join(root, "NitroModules"); mkdirSync(headers);
  function gather(directory: string) {
    for (const file of readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, file.name);
      if (file.isDirectory()) gather(source);
      else if (/\.hpp$/.test(file.name)) symlinkSync(path.resolve(source), path.join(headers, file.name));
    }
  }
  try {
    gather("node_modules/react-native-nitro-modules/cpp");
    expect(() => execFileSync("clang++", ["-fsyntax-only", "-fobjc-arc", "-fblocks", "-std=c++20", "-I", root, "-I", "node_modules/react-native/ReactCommon/jsi", "packages/codex/cpp/HybridCodexAppServer.mm"], { stdio: "pipe" })).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
