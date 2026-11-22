import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

// Node's rename cannot replace a nonempty directory. macOS can exchange their names.
const source = `#include <stdio.h>
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  if (renamex_np(argv[1], argv[2], RENAME_SWAP) == 0) return 0;
  perror("Cannot swap Spark build directories");
  return 1;
}
`;

export function swapToolchainEnv(selected = process.env.DEVELOPER_DIR || execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).trim()) {
  const developerDir = selected.endsWith("/CommandLineTools") ? "/Applications/Xcode.app/Contents/Developer" : selected;
  return { ...process.env, DEVELOPER_DIR: developerDir };
}

export function swapSdkPath(env = swapToolchainEnv()) {
  return execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { env, encoding: "utf8" }).trim();
}

export function publishDirectory(staged: string, target: string, tools: string) {
  if (!existsSync(target)) {
    renameSync(staged, target);
    return;
  }
  const tool = path.join(tools, `swap-${createHash("sha256").update(source).digest("hex").slice(0, 16)}`);
  if (!existsSync(tool)) {
    mkdirSync(tools, { recursive: true });
    const pending = `${tool}.${process.pid}.tmp`;
    try {
      const env = swapToolchainEnv();
      execFileSync("xcrun", ["clang", "-isysroot", swapSdkPath(env), "-x", "c", "-o", pending, "-"], { input: source, env });
      renameSync(pending, tool);
    } finally { rmSync(pending, { force: true }); }
  }
  execFileSync(tool, [staged, target]);
}
