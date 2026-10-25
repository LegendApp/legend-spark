import { afterAll, beforeAll, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DriverError, launchDriver } from "../scripts/e2e/driver.ts";

// A stand-in app that implements the driver's launch contract and protocol.
const fakeApp = String.raw`
const fs = require("node:fs"), net = require("node:net"), path = require("node:path");
const dir = process.env.SPARK_TEST_DRIVER_DIR;
if (process.env.FAKE_EXIT) process.exit(Number(process.env.FAKE_EXIT));
const mode = file => fs.statSync(file).mode & 0o777;
if (!dir || mode(dir) !== 0o700 || mode(path.join(dir, "token")) !== 0o600) process.exit(2);
const token = fs.readFileSync(path.join(dir, "token"), "utf8");
fs.unlinkSync(path.join(dir, "token"));
fs.writeFileSync(path.join(dir, "launch.json"), JSON.stringify({ argv: process.argv.slice(2), extra: process.env.FAKE_EXTRA }));
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
