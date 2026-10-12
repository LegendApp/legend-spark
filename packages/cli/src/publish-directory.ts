import { execFileSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";

// renamex_np(RENAME_SWAP) exchanges two directory entries in one step; Node has no binding for it.
const swap = `import Darwin
let paths = CommandLine.arguments
if renamex_np(paths[1], paths[2], UInt32(RENAME_SWAP)) != 0 {
  fputs("Cannot swap \\(paths[1]) with \\(paths[2]): \\(String(cString: strerror(errno)))\\n", stderr)
  exit(1)
}`;

/**
 * Moves the complete directory `staged` to `target`, which may exist. A reader of `target` sees the old directory or
 * the new one, never a missing or partial one: an existing target is exchanged with `staged` in one rename, and the
 * old contents (now at `staged`) are then removed.
 */
export function publishDirectory(staged: string, target: string) {
  if (!existsSync(target)) return renameSync(staged, target);
  execFileSync("xcrun", ["swift", "-suppress-warnings", "-e", swap, staged, target], { stdio: ["ignore", "ignore", "pipe"] });
  rmSync(staged, { recursive: true, force: true });
}
