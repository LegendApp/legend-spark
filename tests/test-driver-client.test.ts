import { afterAll, beforeAll, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DriverError, launchDriver } from "../scripts/e2e/driver.ts";
import { FAKE_DRIVER_APP } from "./e2e-driver-fake.ts";

let directory = "", script = "";
beforeAll(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-driver-client-"));
  script = path.join(directory, "fake-app.cjs");
  writeFileSync(script, FAKE_DRIVER_APP);
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("launches with a private run directory and one-time token, then drives the app", async () => {
  const driver = await launchDriver({ executable: process.execPath, args: [script, "--flag"], env: { FAKE_EXTRA: "yes" } });
  try {
    expect(existsSync(path.join(driver.directory, "token"))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(driver.directory, "launch.json"), "utf8"))).toEqual({ argv: ["--flag"], extra: "yes" });
    await driver.ping();
    await driver.navigate("spark-ks://windows/frame");
    await driver.openFile("/fixtures/notes.md");
    await expect(driver.openFile("/fixtures/missing.md")).rejects.toThrow("E_NOT_FOUND: No file at /fixtures/missing.md");
    expect(await driver.waitFor("windows-frame-root")).toEqual({ window: "spark.main", frame: { x: 0, y: 0, width: 10, height: 20 } });
    const missing = await driver.waitFor("missing", 100).catch(error => error);
    expect(missing).toBeInstanceOf(DriverError);
    expect(missing.code).toBe("E_TIMEOUT");
    expect(await driver.setAppAppearance("dark")).toEqual({ changed: true });
    expect(await driver.setClock("virtual")).toEqual({ mode: "virtual", timeMs: 1000 });
    expect(await driver.advanceClock(16)).toEqual({ mode: "virtual", timeMs: 1016 });
    expect(await driver.waitForMotion("box", { progress: 0.5 }, 2000)).toEqual({ clock: "virtual", timeMs: 1100, echo: { testID: "box", progress: 0.5, timeoutMs: 2000 } });
    expect(await driver.sampleMotion("box", { fromMs: 1000, intervalMs: 50 })).toEqual({ fromMs: 1000, toMs: 1100, intervalMs: 50, truncated: false, samples: [] });
    expect(await driver.startFrames()).toEqual({ refreshRate: 120 });
    expect(await driver.stopFrames()).toEqual({ frames: 61, droppedFrames: 0, maxFrameGapMs: 8.3, durationMs: 500, fps: 120, refreshRate: 120 });
    expect(await driver.startup(2000)).toEqual({ firstMount: 510, settled: 690, echo: [2000, null] });
    expect(await driver.startup(2000, "catalog")).toEqual({ firstMount: 510, settled: 690, echo: [2000, "catalog"] });
    expect(await driver.state("documents.open.length")).toEqual({ path: "documents.open.length", timeoutMs: 5000 });
    await expect(driver.state("missing")).rejects.toThrow("E_NOT_FOUND: No test state named missing");
    await driver.startCommits();
    expect(await driver.stopCommits(3000)).toEqual({ commits: 2, relayouts: [], gaps: [], blanks: [], echo: 3000 });
    expect(await driver.counters()).toEqual({ windows: 1, views: 10, fileDescriptors: 30, listeners: 4 });
    expect(await driver.memory()).toEqual({ footprintMB: 120.5, residentMB: 200 });
    const capture = await driver.capture("main", "home");
    expect(capture).toEqual({ file: path.join(driver.directory, "home.png"), width: 2000, height: 1400, scale: 2 });
    expect(readFileSync(capture.file, "utf8")).toBe("png");
    await driver.quit();
    expect(driver.app.exitCode).toBe(0);
  } finally { await driver.close(); }
  expect(existsSync(driver.directory)).toBe(false);
});

test("reports an app that exits before its driver starts", async () => {
  await expect(launchDriver({ executable: process.execPath, args: [script], env: { FAKE_EXIT: "7" } })).rejects.toThrow("The app exited (7) before its driver started");
});

test("rejects requests after the connection closes", async () => {
  const driver = await launchDriver({ executable: process.execPath, args: [script] });
  try {
    await driver.quit();
    await expect(driver.ping()).rejects.toThrow("The driver closed the connection");
  } finally { await driver.close(); }
});
