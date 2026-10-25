import { beforeAll, afterAll, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const darwin = process.platform === "darwin";
const root = path.resolve(import.meta.dirname, "..");
let directory = "", harness = "";
// Unix socket paths are limited to 104 bytes, so run directories live under /tmp.
beforeAll(() => {
  if (!darwin) return;
  directory = mkdtempSync("/tmp/spark-driver-test-");
  harness = path.join(directory, "test-driver");
  const native = path.join(root, "packages/desktop-app/macos");
  execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "QuartzCore", "-I", native,
    path.join(native, "SparkTestDriver.mm"), path.join(root, "tests/test-driver.native.mm"), "-o", harness]);
}, 60000);
// SparkWindow.mm includes SparkDesktop.h, which needs one React Native type.
let windowState = "";
beforeAll(() => {
  if (!darwin) return;
  const shim = path.join(directory, "include/React");
  mkdirSync(shim, { recursive: true });
  writeFileSync(path.join(shim, "RCTBridgeModule.h"), "typedef void (^RCTPromiseRejectBlock)(NSString *code, NSString *message, NSError *error);\n");
  windowState = path.join(directory, "driver-window-state");
  const native = path.join(root, "packages/desktop-app/macos");
  execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "QuartzCore", "-I", native, "-I", path.join(directory, "include"),
    path.join(native, "SparkTestDriver.mm"), path.join(native, "SparkWindow.mm"), path.join(root, "tests/driver-window-state.native.mm"), "-o", windowState]);
}, 60000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
const run = (mode: string) => spawnSync(harness, [mode, directory], { encoding: "utf8", timeout: 30000 });

test.skipIf(!darwin)("the driver is inert unless the runner launches the app", () => {
  expect(run("inert").stdout).toContain("inert passed");
});
test.skipIf(!darwin)("the driver refuses run directories and tokens other users could read", () => {
  for (const mode of ["refuse-directory", "refuse-token"]) {
    const result = run(mode);
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/Spark test driver: The run directory (must be a 0700 directory|needs a 0600 token)/);
  }
});
test.skipIf(!darwin)("a wrong token ends the session and quits the app", () => {
  const result = run("auth");
  expect(result.stdout, result.stderr).toContain("auth passed");
});
test.skipIf(!darwin)("a client that disconnects before its reply cannot kill the app with SIGPIPE", () => {
  const result = run("disconnect");
  expect(result.signal).toBeNull();
  expect(result.stdout, result.stderr).toContain("disconnect passed");
});
test.skipIf(!darwin)("protocol: ping, navigate, openFile, waitFor, appearance, settled private captures and quit", () => {
  const result = run("session");
  expect(result.stdout, result.stderr).toContain("session passed");
}, 30000);
test.skipIf(!darwin)("driver mode keeps the configured window size although a frame was saved, and saves none", () => {
  const seed = ["-NSWindow Frame spark.test.main", "100 100 1040 720 0 0 1728 1084 "];
  for (const mode of ["normal", "driver"]) {
    const result = spawnSync(windowState, [mode, directory, ...seed], { encoding: "utf8", timeout: 30000 });
    expect(result.stdout, result.stderr).toContain(`${mode} passed`);
  }
});
