import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

// renamex_np(RENAME_SWAP) exchanges two directory entries in one step; Node has no binding for it.
const source = `#include <errno.h>
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  if (renamex_np(argv[1], argv[2], RENAME_SWAP) == 0) return 0;
  fprintf(stderr, "Cannot swap %s with %s: %s\\n", argv[1], argv[2], strerror(errno));
  return 1;
}
`;

/** The swap helper, compiled into `directory` once per source revision. */
function swapTool(directory: string) {
  const tool = path.join(directory, `swap-${createHash("sha256").update(source).digest("hex").slice(0, 16)}`);
  if (existsSync(tool)) return tool;
  mkdirSync(directory, { recursive: true });
  // Compiled beside its final name and renamed, so a concurrent build never runs a half-written binary.
  const pending = `${tool}.${process.pid}`;
  execFileSync("xcrun", ["clang", "-x", "c", "-O2", "-o", pending, "-"], { input: source, stdio: ["pipe", "ignore", "pipe"] });
  renameSync(pending, tool);
  return tool;
}

/**
 * Moves the complete directory `staged` to `target`, which may exist. A reader of `target` sees the old directory or
 * the new one, never a missing or partial one: an existing target is exchanged with `staged` in one rename, and the
 * old contents (now at `staged`) are then removed. `tools` holds the compiled swap helper.
 */
export function publishDirectory(staged: string, target: string, tools: string) {
  if (!existsSync(target)) return renameSync(staged, target);
  execFileSync(swapTool(tools), [staged, target], { stdio: ["ignore", "ignore", "pipe"] });
  rmSync(staged, { recursive: true, force: true });
}
