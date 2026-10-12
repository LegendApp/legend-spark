import { beforeAll, afterAll, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { outcome, run, runOk } from "./subprocess.ts";

const darwin = process.platform === "darwin";
const root = path.resolve(import.meta.dirname, "..");
const native = path.join(root, "packages/desktop-app/macos");
const driverSources = ["SparkTestDriver.mm", "SparkTestDriverInput.mm", "SparkTestDriverCursor.mm", "SparkTestDriverFrames.mm"].map(file => path.join(native, file));
const compile = (sources: string[], output: string, include: string[] = []) => runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "QuartzCore",
  "-I", native, ...include.flatMap(directory => ["-I", directory]), ...sources, "-o", output], { timeout: 120_000 });
let directory = "", harness = "", windowState = "";
// Unix socket paths are limited to 104 bytes, so run directories live under /tmp.
beforeAll(async () => {
  if (!darwin) return;
  directory = mkdtempSync("/tmp/spark-driver-test-");
  harness = path.join(directory, "test-driver");
  // SparkWindow.mm includes SparkDesktop.h, which needs one React Native type.
  const shim = path.join(directory, "include/React");
  mkdirSync(shim, { recursive: true });
  writeFileSync(path.join(shim, "RCTBridgeModule.h"), "typedef void (^RCTPromiseRejectBlock)(NSString *code, NSString *message, NSError *error);\n");
  windowState = path.join(directory, "driver-window-state");
  await Promise.all([
    compile([...driverSources, path.join(root, "tests/test-driver.native.mm")], harness),
    compile([...driverSources, path.join(native, "SparkWindow.mm"), path.join(root, "tests/driver-window-state.native.mm")], windowState, [path.join(directory, "include")]),
  ]);
}, 240_000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
const runMode = (mode: string) => run(harness, [mode, directory], { timeout: 60_000 });
/** Runs the harness in `mode` and expects it to pass. */
async function passes(mode: string) {
  const result = await runMode(mode);
  expect(result.stdout, outcome(result)).toContain(`${mode} passed`);
  return result;
}

test.skipIf(!darwin)("the driver is inert unless the runner launches the app", async () => {
  await passes("inert");
}, 90_000);
test.skipIf(!darwin)("the driver refuses run directories and tokens other users could read", async () => {
  for (const mode of ["refuse-directory", "refuse-token"]) {
    const result = await runMode(mode);
    expect(result.status, outcome(result)).toBe(78);
    expect(result.stderr).toMatch(/Spark test driver: The run directory (must be a 0700 directory|needs a 0600 token)/);
  }
}, 90_000);
test.skipIf(!darwin)("a wrong token ends the session and quits the app", async () => {
  await passes("auth");
}, 90_000);
test.skipIf(!darwin)("a client that disconnects before its reply cannot kill the app with SIGPIPE", async () => {
  const result = await passes("disconnect");
  expect(result.signal).toBeNull();
}, 90_000);
test.skipIf(!darwin)("protocol: ping, navigate, openFile, waitFor, appearance, settled private captures and quit", async () => {
  await passes("session");
}, 90_000);
test.skipIf(!darwin)("driver mode keeps the configured window size although a frame was saved, and saves none", async () => {
  const seed = ["-NSWindow Frame spark.test.main", "100 100 1040 720 0 0 1728 1084 "];
  for (const mode of ["normal", "driver"]) {
    const result = await run(windowState, [mode, directory, ...seed], { timeout: 60_000 });
    expect(result.stdout, outcome(result)).toContain(`${mode} passed`);
  }
}, 90_000);
test.skipIf(!darwin)("input: clicks, drags, hover, scroll, typing and keys reach real AppKit controls in-process without activating, and modal loops do not block the session", async () => {
  await passes("input");
}, 90_000);
test.skipIf(!darwin)("pointer: gestures, pressure, back and forward buttons and cursor queries in-process; cursor hiding is recorded, never applied", async () => {
  await passes("pointer");
}, 90_000);
test.skipIf(!darwin)("module hooks: start and input observers, render wrappers around captures", async () => {
  await passes("hooks");
}, 90_000);
// Needs a display whose link ticks (CI runners may have none): the harness reports why it skipped.
test.skipIf(!darwin)("frame counting keeps an idle main thread's cadence and sees a blocked main thread drop frames", async context => {
  const result = await passes("frames");
  const skipped = /^frames skipped: (.*)$/m.exec(result.stdout);
  context.skip(skipped !== null, `no display link to count frames with: ${skipped?.[1]}`);
}, 90_000);
// Opens a real context menu on screen for a moment, so it runs only where that is acceptable (SPARK_GUI_TESTS=1).
test.skipIf(!darwin || !process.env.SPARK_GUI_TESTS)("input that opens a native menu closes it and fails with E_MENU (opens a menu on screen; SPARK_GUI_TESTS=1)", async () => {
  await passes("menu");
}, 90_000);
