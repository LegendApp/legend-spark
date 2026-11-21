import { afterAll, beforeAll, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { processLog } from "../packages/cli/src/process.ts";
import type { StateHost } from "../scripts/e2e/app-state.ts";
import { DriverError, launchDriver, type Driver } from "../scripts/e2e/driver.ts";
import { KitchenSinkApp } from "../scripts/e2e/kitchen-sink.ts";

// A stand-in app that implements the driver's launch contract and protocol.
const fakeApp = String.raw`
const fs = require("node:fs"), net = require("node:net"), path = require("node:path");
const dir = process.env.SPARK_TEST_DRIVER_DIR;
if (process.env.FAKE_EXIT) process.exit(Number(process.env.FAKE_EXIT));
const mode = file => fs.statSync(file).mode & 0o777;
if (!dir || mode(dir) !== 0o700 || mode(path.join(dir, "token")) !== 0o600) process.exit(2);
const token = fs.readFileSync(path.join(dir, "token"), "utf8");
fs.unlinkSync(path.join(dir, "token"));
const launch = { argv: process.argv.slice(2), extra: process.env.FAKE_EXTRA };
if (process.env.FAKE_STATE_HOME) {
  const plist = path.resolve(path.dirname(process.execPath), "../Info.plist");
  const identity = JSON.parse(require("node:child_process").execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist]));
  const storage = path.join(process.env.FAKE_STATE_HOME, "Library", "Application Support", identity.CFBundleIdentifier);
  fs.mkdirSync(storage, { recursive: true });
  const state = path.join(storage, "setting");
  const previous = fs.existsSync(state) ? fs.readFileSync(state, "utf8") : null;
  fs.writeFileSync(state, process.env.FAKE_EXTRA);
  Object.assign(launch, { identity, state, previous });
}
fs.writeFileSync(path.join(dir, "launch.json"), JSON.stringify(launch));
const server = net.createServer(socket => {
  let buffer = "", authenticated = false;
  const send = message => socket.write(JSON.stringify(message) + "\n");
  socket.on("data", chunk => {
    buffer += chunk;
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (!authenticated) {
        if (message.token !== token) { send({ ok: false, error: { code: "E_AUTH", message: "Authentication failed" } }); socket.end(); server.close(); return; }
        authenticated = true; send({ ok: true, protocol: 1 }); continue;
      }
      const reply = { id: message.id, ok: true };
      if (message.command === "waitFor" && message.testID === "missing") Object.assign(reply, { ok: false, error: { code: "E_TIMEOUT", message: "No view with testID missing" } });
      else if (message.command === "waitFor") Object.assign(reply, { window: "spark.main", frame: { x: 0, y: 0, width: 10, height: 20 } });
      else if (message.command === "openFile" && message.path !== "/fixtures/notes.md") Object.assign(reply, { ok: false, error: { code: "E_NOT_FOUND", message: "No file at " + message.path } });
      else if (message.command === "setAppAppearance") reply.changed = message.appearance === "dark";
      else if (message.command === "capture") { fs.writeFileSync(path.join(dir, message.name + ".png"), "png", { mode: 0o600 }); Object.assign(reply, { file: message.name + ".png", width: 2000, height: 1400, scale: 2 }); }
      send(reply);
      if (message.command === "quit") { socket.end(); server.close(); }
    }
  });
});
server.listen(path.join(dir, "driver.sock"));
`;
let directory = "", script = "";
beforeAll(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-driver-client-"));
  script = path.join(directory, "fake-app.cjs");
  writeFileSync(script, fakeApp);
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

test.skipIf(process.platform !== "darwin")("parallel Kitchen Sink sessions preserve only their own state across launches and cleanup", async () => {
  const app = path.join(directory, "KitchenSink.app"), contents = path.join(app, "Contents");
  const bundleId = "so.legend.spark.examples.kitchensink";
  mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  mkdirSync(path.join(contents, "Resources"));
  copyFileSync(process.execPath, path.join(contents, "MacOS", "Fake"), constants.COPYFILE_FICLONE);
  writeFileSync(path.join(contents, "Resources", "main.jsbundle"), "");
  const plist = path.join(contents, "Info.plist");
  writeFileSync(plist, JSON.stringify({ CFBundlePackageType: "APPL", CFBundleExecutable: "Fake", CFBundleIdentifier: bundleId }));
  execFileSync("/usr/bin/plutil", ["-convert", "xml1", plist]);
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", "--preserve-metadata=entitlements,flags", app], { stdio: "pipe" });

  const scratch = mkdtempSync(path.join(directory, "state-"));
  const domains: string[] = [];
  const host: StateHost = { home: scratch, temp: scratch, running: () => [], deleteDefaults: id => { domains.push(id); return false; } };
  const first = new KitchenSinkApp(app, false, host), second = new KitchenSinkApp(app, false, host);
  const drivers: Driver[] = [];
  const start = async (session: KitchenSinkApp, marker: string) => {
    const driver = await session.launch({ arguments: [script], env: { FAKE_STATE_HOME: scratch, FAKE_EXTRA: marker }, log: processLog(path.join(scratch, `${marker}.log`)) });
    drivers.push(driver);
    const state = JSON.parse(readFileSync(path.join(driver.directory, "launch.json"), "utf8"));
    return { driver, ...state };
  };
  try {
    expect(await first.open()).toEqual({ app, bundleId });
    expect(await second.open()).toEqual({ app, bundleId });
    const results = await Promise.allSettled([start(first, "first"), start(second, "second")]);
    const [a, b] = results.map(result => { if (result.status === "rejected") throw result.reason; return result.value; });
    expect(a.identity.CFBundleIdentifier).not.toBe(bundleId);
    expect(b.identity.CFBundleIdentifier).not.toBe(a.identity.CFBundleIdentifier);
    expect(a.identity.SparkProjectIdentifier).toBe(a.identity.CFBundleIdentifier);
    expect(b.identity.SparkProjectIdentifier).toBe(b.identity.CFBundleIdentifier);
    expect([a.previous, b.previous]).toEqual([null, null]);

    await a.driver.quit();
    const relaunched = await start(first, "relaunch");
    expect(relaunched.state).toBe(a.state);
    expect(relaunched.previous).toBe("first");
    await relaunched.driver.quit();
    expect(await first.clearState()).toEqual([path.dirname(a.state)]);
    await first.close();
    expect(existsSync(a.state)).toBe(false);
    expect(readFileSync(b.state, "utf8")).toBe("second");
    await b.driver.ping();
    await b.driver.quit();
    await second.close();
    expect(existsSync(b.state)).toBe(false);
    expect(domains).not.toContain(bundleId);
    expect(readdirSync(scratch).filter(name => name.startsWith("spark-driver-state-"))).toEqual([]);
    execFileSync("/usr/bin/codesign", ["--verify", "--strict", app]);
  } finally {
    await Promise.all(drivers.map(driver => driver.close()));
    await Promise.all([first.close(), second.close()]);
  }

  const exact = new KitchenSinkApp(app, true, host), anotherExact = new KitchenSinkApp(app, true, host);
  try {
    await exact.open();
    await expect(anotherExact.open()).rejects.toThrow(/already locked/);
    await exact.close();
    await anotherExact.open();
  } finally {
    await Promise.all([exact.close(), anotherExact.close()]);
  }
}, 20000);
