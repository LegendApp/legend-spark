import { test, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, readlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mirrorRunner, preservedBuildState, releaseRunnerRoot, releaseRunnerStaging, rewritePathRecords, syncTree } from "../packages/cli/src/release-runner-root.ts";

const temp = () => mkdtempSync(path.join(os.tmpdir(), "spark-release-root-"));
const write = (file: string, content = "x") => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); };
const read = (file: string) => readFileSync(file, "utf8");

test("fixed and staging folders keep the SparkRunner project name", () => {
  expect(path.basename(releaseRunnerRoot("/s"))).toBe("SparkRunner");
  expect(path.basename(releaseRunnerStaging("/s"))).toBe("SparkRunner");
  expect(releaseRunnerRoot("/s")).not.toBe(releaseRunnerStaging("/s"));
});

test("sync rewrites only changed files, deletes stale ones and keeps build state", () => {
  const root = temp();
  try {
    const fresh = path.join(root, "staging"), fixed = path.join(root, "fixed");
    write(path.join(fixed, "node_modules/pod/same.m"), "same");
    write(path.join(fixed, "node_modules/pod/patched.m"), "old");
    write(path.join(fixed, "stale.ts"), "gone");
    write(path.join(fixed, ".spark/DerivedData/macos-arm64/build.db"), "warm");
    write(path.join(fixed, "macos/Pods/Manifest.lock"), "pods");
    write(path.join(fixed, ".spark/logs/old.log"), "log");
    const old = new Date("2020-01-01T00:00:00Z");
    utimesSync(path.join(fixed, "node_modules/pod/same.m"), old, old);
    write(path.join(fresh, "node_modules/pod/same.m"), "same");
    write(path.join(fresh, "node_modules/pod/patched.m"), "new patch");
    write(path.join(fresh, "App.tsx"), "app");
    symlinkSync("../pod/same.m", path.join(fresh, "node_modules/link"));
    const changed = syncTree(fresh, fixed, preservedBuildState);
    expect(changed.sort()).toEqual([".spark/logs", "App.tsx", "node_modules/link", "node_modules/pod/patched.m", "stale.ts"]);
    // Unchanged sources keep their mtime so Xcode doesn't recompile them; changed ones are rewritten.
    expect(statSync(path.join(fixed, "node_modules/pod/same.m")).mtime.getTime()).toBe(old.getTime());
    expect(read(path.join(fixed, "node_modules/pod/patched.m"))).toBe("new patch");
    expect(readlinkSync(path.join(fixed, "node_modules/link"))).toBe("../pod/same.m");
    expect(existsSync(path.join(fixed, "stale.ts"))).toBe(false);
    expect(read(path.join(fixed, "macos/Pods/Manifest.lock"))).toBe("pods");
    // .spark is pruned around preserved build state; DerivedData survives.
    expect(existsSync(path.join(fixed, ".spark/logs"))).toBe(false);
    expect(read(path.join(fixed, ".spark/DerivedData/macos-arm64/build.db"))).toBe("warm");
    write(path.join(fresh, ".spark/version"), "0.0.1-next.11");
    syncTree(fresh, fixed, preservedBuildState);
    expect(read(path.join(fixed, ".spark/DerivedData/macos-arm64/build.db"))).toBe("warm");
    expect(read(path.join(fixed, ".spark/version"))).toBe("0.0.1-next.11");
    expect(syncTree(fresh, fixed, preservedBuildState)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mirror copies the build into the version folder without DerivedData and rewrites recorded paths", () => {
  const root = temp();
  try {
    const fixed = path.join(root, "release/SparkRunner"), version = path.join(root, "0.0.1-next.11/SparkRunner");
    write(path.join(fixed, "package.json"), "{}");
    write(path.join(fixed, ".spark/go-build.json"), JSON.stringify({ app: `${fixed}/.spark/products/macos-arm64/go/SparkRunner.app`, runtime: { sourceRevision: "abc" } }));
    write(path.join(fixed, ".spark/products/macos-arm64/go/SparkRunner.app/Contents/Info.plist"), "plist");
    write(path.join(fixed, ".spark/DerivedData/macos-arm64/build.db"), "warm");
    write(path.join(fixed, "macos/Podfile.lock"), `PATH: ${fixed}/node_modules/x`);
    // A pending notarization from an earlier attempt in the version folder is kept.
    write(path.join(version, ".spark/packaging/hash/state.json"), "pending");
    write(path.join(version, "stale.txt"), "old");
    for (const clone of [undefined, () => false]) {
      mirrorRunner(fixed, version, clone);
      const built = JSON.parse(read(path.join(version, ".spark/go-build.json")));
      expect(built.app).toBe(`${version}/.spark/products/macos-arm64/go/SparkRunner.app`);
      expect(built.runtime.sourceRevision).toBe("abc");
      expect(read(path.join(version, ".spark/products/macos-arm64/go/SparkRunner.app/Contents/Info.plist"))).toBe("plist");
      expect(read(path.join(version, "macos/Podfile.lock"))).toBe(`PATH: ${version}/node_modules/x`);
      expect(read(path.join(version, ".spark/packaging/hash/state.json"))).toBe("pending");
      expect(existsSync(path.join(version, ".spark/DerivedData"))).toBe(false);
      expect(existsSync(path.join(version, "stale.txt"))).toBe(false);
      expect(existsSync(`${version}.incoming`)).toBe(false);
    }
    // The fixed folder keeps its warm state and its own paths.
    expect(read(path.join(fixed, ".spark/DerivedData/macos-arm64/build.db"))).toBe("warm");
    expect(read(path.join(fixed, ".spark/go-build.json"))).toContain(fixed);
    rewritePathRecords(fixed, fixed, "/elsewhere");
    expect(read(path.join(fixed, "macos/Podfile.lock"))).toBe("PATH: /elsewhere/node_modules/x");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
