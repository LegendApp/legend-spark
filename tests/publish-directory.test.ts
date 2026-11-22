import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { swapSdkPath, swapToolchainEnv } from "../packages/cli/src/publish-directory.ts";

afterEach(() => vi.unstubAllEnvs());

test("swap helper honors the developer directory used by the native build", () => {
  vi.stubEnv("DEVELOPER_DIR", "/Applications/Xcode-27.2.0.app/Contents/Developer");
  expect(swapToolchainEnv().DEVELOPER_DIR).toBe(process.env.DEVELOPER_DIR);
});

test("swap helper resolves Xcode when xcode-select points at Command Line Tools", () => {
  expect(swapToolchainEnv("/Library/Developer/CommandLineTools").DEVELOPER_DIR).toBe("/Applications/Xcode.app/Contents/Developer");
});

test("swap helper resolves the SDK from the selected Xcode", () => {
  const env = swapToolchainEnv();
  expect(path.relative(env.DEVELOPER_DIR!, swapSdkPath(env))).toMatch(/^Platforms\/MacOSX\.platform\/Developer\/SDKs\/MacOSX/);
});

test("swap helper uses xcode-select when DEVELOPER_DIR is unset", () => {
  vi.stubEnv("DEVELOPER_DIR", undefined);
  expect(swapToolchainEnv().DEVELOPER_DIR).toBe(execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).trim());
});
