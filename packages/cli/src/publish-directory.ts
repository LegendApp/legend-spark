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
      execFileSync("xcrun", ["clang", "-x", "c", "-o", pending, "-"], { input: source });
      renameSync(pending, tool);
    } finally { rmSync(pending, { force: true }); }
  }
  execFileSync(tool, [staged, target]);
}
