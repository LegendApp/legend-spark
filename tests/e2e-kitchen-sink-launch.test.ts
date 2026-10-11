import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { processLog } from "../packages/cli/src/process.ts";
import { KitchenSinkApp } from "../scripts/e2e/kitchen-sink.ts";
import { FAKE_DRIVER_APP } from "./e2e-driver-fake.ts";

// A release-shaped app bundle (embedded JavaScript, so nothing is bundled or served) whose executable is the fake driver app.
let directory = "", bundle = "";
beforeAll(() => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-ks-launch-"));
  bundle = path.join(directory, "Fake.app");
  mkdirSync(path.join(bundle, "Contents/MacOS"), { recursive: true });
  mkdirSync(path.join(bundle, "Contents/Resources"));
  writeFileSync(path.join(bundle, "Contents/Resources/main.jsbundle"), "");
  writeFileSync(path.join(directory, "fake-app.cjs"), FAKE_DRIVER_APP);
  writeFileSync(path.join(bundle, "Contents/MacOS/Fake"), `#!/bin/sh\nexec "${process.execPath}" "${path.join(directory, "fake-app.cjs")}" "$@"\n`);
  chmodSync(path.join(bundle, "Contents/MacOS/Fake"), 0o755);
  const plist = path.join(bundle, "Contents/Info.plist");
  execFileSync("plutil", ["-create", "xml1", plist]);
  execFileSync("plutil", ["-insert", "CFBundleIdentifier", "-string", "so.legend.spark.examples.fake", plist]);
  execFileSync("plutil", ["-insert", "CFBundleExecutable", "-string", "Fake", plist]);
  execFileSync("codesign", ["-s", "-", bundle], { stdio: "ignore" });
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
const plist = (app: string, key: string) => execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim();

test.skipIf(process.platform !== "darwin")("driver launches run a clone of the app with its own identity and state, deleted by close", async () => {
  const app = new KitchenSinkApp(bundle);
  await app.open();
  const first = await app.launch({ log: processLog(path.join(directory, "app.log")) });
  let launch: { home: string; suffix: string };
  try {
    launch = JSON.parse(readFileSync(path.join(first.directory, "launch.json"), "utf8"));
    const root = path.dirname(launch.home), clone = path.join(root, "Fake.app");
    expect(launch.suffix).toBe("so.legend.spark.examples.fake.driver");
    expect(existsSync(launch.home)).toBe(true);
    expect([plist(clone, "CFBundleIdentifier"), plist(clone, "SparkProjectIdentifier")]).toEqual(["so.legend.spark.examples.fake.driver", "so.legend.spark.examples.fake.driver"]);
    expect(plist(bundle, "CFBundleIdentifier")).toBe("so.legend.spark.examples.fake");
    await first.quit();
  } finally {
    await first.close();
  }
  const second = await app.launch({ log: processLog(path.join(directory, "app.log")) });
  try {
    expect(JSON.parse(readFileSync(path.join(second.directory, "launch.json"), "utf8")).home).toBe(launch.home);
    await second.quit();
  } finally {
    await second.close();
    await app.close();
  }
  expect(existsSync(path.dirname(launch.home))).toBe(false);
});

test.skipIf(process.platform !== "darwin")("every driver launch pins the host rendering settings before the locale and the flow's arguments", async () => {
  const app = new KitchenSinkApp(bundle);
  await app.open();
  const driver = await app.launch({ locale: "ar", arguments: ["-AppleShowScrollBars", "Always"], log: processLog(path.join(directory, "app.log")) });
  try {
    const { argv } = JSON.parse(readFileSync(path.join(driver.directory, "launch.json"), "utf8"));
    expect(argv).toEqual([
      "-NSRequiresAquaSystemAppearance", "YES",
      "-AppleReduceDesktopTinting", "YES",
      "-AppleAccentColor", "4",
      "-AppleHighlightColor", "0.698039 0.843137 1.000000 Blue",
      "-increaseContrast", "NO",
      "-reduceTransparency", "NO",
      "-differentiateWithoutColor", "NO",
      "-AppleShowScrollBars", "WhenScrolling",
      "-AppleFontSmoothing", "2",
      "-AppleLanguages", "(ar)", "-AppleLocale", "ar",
      "-AppleShowScrollBars", "Always",
    ]);
    await driver.quit();
  } finally {
    await driver.close();
    await app.close();
  }
});
