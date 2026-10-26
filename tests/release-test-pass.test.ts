import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordTestPass, testSkipReason, workingTreeHash } from "../scripts/release-workflow.ts";

function temp() { return mkdtempSync(path.join(os.tmpdir(), "spark-test-pass-")); }
function write(file: string, content = "x") { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); }

test("test pass markers match only the exact working tree", () => {
  const root = temp();
  try {
    const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.trim();
    git("init", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@example.test");
    write(path.join(root, ".gitignore"), ".spark/\n"); write(path.join(root, "a.ts"), "1");
    git("add", "."); git("commit", "-m", "init");
    const tree = workingTreeHash(root);
    expect(tree).toBe(git("rev-parse", "HEAD^{tree}"));
    expect(testSkipReason(root, tree)).toBeUndefined();
    recordTestPass(root, tree);
    expect(testSkipReason(root, tree)).toContain("already passed");
    // Ignored files (the marker itself) don't change the key; edits and untracked files do.
    expect(workingTreeHash(root)).toBe(tree);
    write(path.join(root, "a.ts"), "2");
    const edited = workingTreeHash(root);
    expect(edited).not.toBe(tree);
    expect(testSkipReason(root, edited)).toBeUndefined();
    write(path.join(root, "a.ts"), "1"); write(path.join(root, "new.ts"), "n");
    expect(testSkipReason(root, workingTreeHash(root))).toBeUndefined();
    expect(testSkipReason(root, "other", true)).toBe("--skip-tests was passed");
    // The real index is untouched.
    expect(git("status", "--porcelain")).toBe("?? new.ts");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
