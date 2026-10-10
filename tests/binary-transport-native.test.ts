import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const frameworks = path.join(root, "artifacts/runtimes/LegendGo.app/Contents/Frameworks");
const hermesHeaders = path.join(root, "examples/kitchen-sink/macos/Pods/hermes-engine/destroot/include");
const available = process.platform === "darwin" && existsSync(path.join(frameworks, "hermesvm.framework/hermesvm")) && existsSync(path.join(hermesHeaders, "hermes/hermes.h"));
test.skipIf(!available)("actual Hermes binary binding snapshots input views, shares owned output and releases pending callbacks", () => {
  const space = execFileSync("df", ["-k", "/System/Volumes/Data"], { encoding: "utf8" }).trim().split("\n").at(-1)!.trim().split(/\s+/);
  if (Number(space[3]) * 1024 <= 50_000_000_000) throw Error("The 50 GB disk reserve prevents native test compilation");
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-binary-native-"));
  try {
    const binary = path.join(directory, "test"), react = path.join(root, "node_modules/react-native/ReactCommon");
    execFileSync("clang++", ["-O3", "-DNDEBUG", "-std=c++20", "-mmacosx-version-min=14.0",
      path.join(root, "tests/binary-transport.native.cpp"), path.join(react, "jsi/jsi/jsi.cpp"), path.join(react, "react/bridging/LongLivedObject.cpp"),
      "-I", hermesHeaders, "-I", path.join(react, "jsi"), "-I", path.join(react, "callinvoker"), "-I", react,
      "-F", frameworks, "-framework", "hermesvm", `-Wl,-rpath,${frameworks}`, "-o", binary], { timeout: 15000 });
    const result = JSON.parse(execFileSync(binary, { encoding: "utf8", timeout: 15000 }));
    expect(result).toMatchObject({ checksPassed: true });
    expect(result.readMs).toHaveLength(27); expect(result.writeMs).toHaveLength(27);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 30000);
