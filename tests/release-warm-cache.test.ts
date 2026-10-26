import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareSparkVersions, previousRunnerVersion, seedRunnerCaches, cloneTree } from "../packages/cli/src/warm-runner-cache.ts";
import { recordTestPass, testSkipReason, workingTreeHash } from "../scripts/release-workflow.ts";

function temp() { return mkdtempSync(path.join(os.tmpdir(), "spark-warm-cache-")); }
function write(file: string, content = "x") { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); }

test("versions order previews before their stable release", () => {
  const sorted = ["0.0.1", "0.0.1-next.10", "0.0.1-next.9", "0.0.2-next.1", "junk"].sort(compareSparkVersions);
  expect(sorted).toEqual(["junk", "0.0.1-next.9", "0.0.1-next.10", "0.0.1", "0.0.2-next.1"]);
});

test("seeds DerivedData and Pods from the newest previous version only into missing paths", () => {
  const root = temp();
  try {
    const runner = (version: string, relative: string) => path.join(root, version, "SparkRunner", relative);
    write(runner("0.0.1-next.8", ".spark/DerivedData/macos-arm64/marker"), "next.8");
    write(runner("0.0.1-next.9", ".spark/DerivedData/macos-arm64/marker"), "next.9");
    write(runner("0.0.1-next.9", "macos/Pods/Manifest.lock"), "pods");
    write(runner("0.0.1-next.9", "macos/Podfile.lock"), "lock");
    write(runner("0.0.1-next.11", ".spark/DerivedData/macos-arm64/marker"), "newer must be ignored");
    expect(previousRunnerVersion(root, "0.0.1-next.10", ".spark/DerivedData/macos-arm64")).toBe("0.0.1-next.9");
    const logs: string[] = [];
    // Force the fallback path so the test runs on any filesystem.
    const seeded = seedRunnerCaches(root, "0.0.1-next.10", "arm64", line => logs.push(line), () => false);
    expect(seeded).toEqual([".spark/DerivedData/macos-arm64", "macos/Pods", "macos/Podfile.lock"]);
    expect(readFileSync(runner("0.0.1-next.10", ".spark/DerivedData/macos-arm64/marker"), "utf8")).toBe("next.9");
    expect(readFileSync(runner("0.0.1-next.10", "macos/Pods/Manifest.lock"), "utf8")).toBe("pods");
    expect(logs[0]).toContain("copied .spark/DerivedData/macos-arm64 from 0.0.1-next.9");
    // An existing build is never overwritten.
    write(runner("0.0.1-next.10", ".spark/DerivedData/macos-arm64/marker"), "own");
    expect(seedRunnerCaches(root, "0.0.1-next.10", "arm64", () => {})).toEqual([]);
    expect(readFileSync(runner("0.0.1-next.10", ".spark/DerivedData/macos-arm64/marker"), "utf8")).toBe("own");
    // Nothing earlier: nothing seeded.
    expect(seedRunnerCaches(root, "0.0.1-next.1", "arm64", () => {})).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("cloneTree uses cp -c and falls back to a plain copy", () => {
  const root = temp();
  try {
    write(path.join(root, "src/a/b"), "data");
    const how = cloneTree(path.join(root, "src"), path.join(root, "out/dst"));
    expect(["clone", "copy"]).toContain(how);
    expect(readFileSync(path.join(root, "out/dst/a/b"), "utf8")).toBe("data");
    expect(cloneTree(path.join(root, "src"), path.join(root, "out/fallback"), () => false)).toBe("copy");
    expect(existsSync(path.join(root, "out/fallback/a/b"))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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
