// The driver backend's release-safety probe (assertNoDebugSurface, scripts/e2e/runner/driver-release.ts; #274): what it
// finds in a running app's sockets, menus, JavaScript and native code, and the command against a fake app.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseSockets, type DriverMenuItem } from "../scripts/e2e/driver.ts";
import { DriverBackend } from "../scripts/e2e/runner/driver-backend.ts";
import { debugMenuItems, codeProblems, socketProblems } from "../scripts/e2e/runner/driver-release.ts";
import { runFlows } from "../scripts/e2e/runner/executor.ts";
import { FakeApp } from "./e2e-driver-fake.ts";
import { VirtualClock } from "./e2e-runner-backend.ts";

const TMP = "/var/folders/ab/xyz/T";
const DRIVER = `${TMP}/spark-driver-1a2b3c/driver.sock`;
const item = (title: string, extra: object = {}): DriverMenuItem => ({ title, enabled: true, hidden: false, state: "off", ...extra });

describe("sockets", () => {
  test.skipIf(process.platform !== "darwin")("lsof output of a real process parses into its sockets, with a listening TCP socket's state", async () => {
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as net.AddressInfo;
      const result = spawnSync("lsof", ["-nP", "-p", String(process.pid), "-F", "ftPnT"], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(parseSockets(result.stdout, process.pid)).toContainEqual({ fd: expect.any(String), type: "IPv4", protocol: "TCP", name: `127.0.0.1:${port}`, state: "LISTEN" });
    } finally { server.close(); }
  });

  test("lsof output that does not list the process's files fails closed", () => {
    expect(() => parseSockets("", 42)).toThrow("lsof listed no open files of process 42");
    expect(() => parseSockets("p41\nf3\ntREG\nn/x\n", 42)).toThrow("lsof listed no open files of process 42");
  });

  test("network sockets and bound Unix sockets are findings; the driver's channel and connected Unix sockets are not", () => {
    const output = [
      "p42", "fcwd", "tDIR", "n/",
      "f3", "tunix", `n${DRIVER}`, "f4", "tunix", `n/private${DRIVER}`, "f5", "tunix", `n${TMP}/spark.desktop.${"f".repeat(40)}`, "f6", "tunix", "n->0xa3f577b332e764c0",
      "f7", "tIPv4", "PTCP", "n127.0.0.1:58602->127.0.0.1:8081", "TST=ESTABLISHED", "TQR=0",
      "f8", "tIPv6", "PTCP", "n*:8097", "TST=LISTEN", "f9", "tIPv4", "PUDP", "n*:5353",
      "f10", "tunix", `n${TMP}/inspector.sock`, "f11", "tunix", "n/tmp/spark.desktop.abc.sock",
    ].join("\n");
    expect(socketProblems(parseSockets(output, 42), DRIVER)).toEqual([
      `fd 5: Unix socket bound at ${TMP}/spark.desktop.${"f".repeat(40)}`,
      "fd 7: IPv4 TCP 127.0.0.1:58602->127.0.0.1:8081 (ESTABLISHED)",
      "fd 8: IPv6 TCP *:8097 (LISTEN)",
      "fd 9: IPv4 UDP *:5353",
      `fd 10: Unix socket bound at ${TMP}/inspector.sock`,
      "fd 11: Unix socket bound at /tmp/spark.desktop.abc.sock",
    ]);
  });
});

test("debug menu items are found at any depth by Developer menu identifier, title (English or Arabic) or debug tooling", () => {
  const menus: DriverMenuItem[] = [
    item("File", { items: [item("New"), { separator: true }, item("Reload")] }),
    item("المطوّر", { id: "spark-developer", items: [item("إعادة التحميل", { id: "spark-developer-reload" }), item("Show Developer Menu", { hidden: true })] }),
    item("View", { items: [item("Show React DevTools"), item("Element Inspector"), item("Attach Debugger"), item("Inspect Document Order"), item("Start Profiling"), item("Profiler…")] }),
    item("Window", { items: [item("Minimize"), item("Zoom")] }),
  ];
  expect(debugMenuItems(menus)).toEqual([
    "File > Reload", "المطوّر", "المطوّر > إعادة التحميل", "المطوّر > Show Developer Menu", "View > Show React DevTools", "View > Element Inspector", "View > Attach Debugger", "View > Start Profiling", "View > Profiler…",
  ]);
  expect(debugMenuItems([item("Window", { items: [item("Minimize")] })])).toEqual([]);
});

/** A .app bundle whose Contents/Resources holds `scripts` (name → contents) and whose Contents/MacOS holds `binaries`. */
function appBundle(scripts: Record<string, string | Buffer>, binaries: Record<string, string | Buffer> = { KitchenSink: MACHO("release") }) {
  const app = path.join(mkdtempSync(path.join(tmpdir(), "e2e-release-app-")), "KitchenSink.app");
  for (const [directory, files] of [["Resources", scripts], ["MacOS", binaries]] as const) {
    mkdirSync(path.join(app, "Contents", directory), { recursive: true });
    for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(app, "Contents", directory, name), contents);
  }
  return app;
}
// Hermes bytecode keeps string literals as bytes; a stand-in with the magic number, binary data and the marker.
const HBC = (text: string) => Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f, 0, 0, 0, 96]), Buffer.from(text, "utf8"), Buffer.from([0, 255])]);
// A 64-bit Mach-O stand-in (MH_MAGIC_64, little-endian) whose C strings include `text`.
const MACHO = (text: string) => Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 0x01]), Buffer.from(`\0${text}\0`, "utf8")]);

test("JavaScript that contains the network inspector or the profiler is a finding, at any depth; an app without JavaScript fails closed", () => {
  expect(codeProblems(appBundle({ "main.jsbundle": HBC("getNetworkInspectorAvailability getProfilerAvailability development-only") }))).toEqual([]);
  expect(codeProblems(appBundle({ "main.jsbundle": HBC("id spark-network-inspector:shared:"), "worker.js": "spark-profiler-20261012", "notes.txt": "spark-network-inspector spark-profiler" }))).toEqual([
    "Contents/Resources/main.jsbundle contains the network inspector (spark-network-inspector)",
    "Contents/Resources/worker.js contains the profiler (spark-profiler)",
  ]);
  const empty = appBundle({});
  expect(codeProblems(empty)).toEqual([`no JavaScript bundle found in ${empty} to check for the network inspector and the profiler`]);
});

test("native code that contains the profiler is a finding, in any Mach-O file; an app without native code fails closed (DEVT-REL-05)", () => {
  const scripts = { "main.jsbundle": HBC("release") };
  expect(codeProblems(appBundle(scripts, { KitchenSink: MACHO("SparkFrameTimeline startFrames") }))).toEqual([]);
  // A file that is not Mach-O is not native code, whatever it holds.
  expect(codeProblems(appBundle(scripts, { KitchenSink: MACHO("release"), "notes.txt": "spark-profiler" }))).toEqual([]);
  expect(codeProblems(appBundle(scripts, { KitchenSink: MACHO("spark-profiler-XXXXXX"), helper: MACHO("release") }))).toEqual([
    "Contents/MacOS/KitchenSink contains the profiler (spark-profiler)",
  ]);
  const native = appBundle(scripts, {});
  expect(codeProblems(native)).toEqual([`no native code found in ${native} to check for the profiler`]);
});

const HEADER = "appId: so.legend.spark.examples.kitchensink\nname: Release probe\nintent: The test intent.\n---\n";
async function probe(app: FakeApp, command = "- assertNoDebugSurface: { for: 0 }") {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-release-probe-"));
  mkdirSync(path.join(dir, "flows/area"), { recursive: true });
  writeFileSync(path.join(dir, "flows/area/test.yaml"), `${HEADER}${command}`);
  const [result] = await runFlows([path.join(dir, "flows/area/test.yaml")], { backends: [new DriverBackend(app)], runDir: path.join(dir, "run"), clock: new VirtualClock() });
  return result!;
}

describe("assertNoDebugSurface", () => {
  test("relaunches the app pointed at a decoy development server, waits for its first settled UI and passes a clean app", async () => {
    const app = new FakeApp({}, undefined, [item("Window", { items: [item("Minimize")] })]);
    app.bundle = { app: appBundle({ "main.jsbundle": HBC("release") }), release: true };
    app.sockets = driver => [{ fd: "3", type: "unix", name: path.join(driver.directory, "driver.sock") }];
    const result = await probe(app, "- launchApp\n- assertNoDebugSurface: { for: 0 }");
    expect(result.status, JSON.stringify(result.failure)).toBe("passed");
    const launches = app.log.filter(line => line.startsWith("launch"));
    expect(launches[0]).toBe("launch locale=- log=app-1.log");
    expect(launches[1]).toMatch(/^launch locale=- args=-RCT_jsLocation 127\.0\.0\.1:(\d+) env=\{"SPARK_BUNDLE_URL":"http:\/\/127\.0\.0\.1:\1\/index\.bundle\?platform=macos&dev=true&minify=false"\} log=app-2\.log$/);
    expect(app.log.slice(app.log.indexOf(launches[1]!) + 1)).toEqual(["startup 30000", "menus", "sockets", "quit", "close", "app close"]);
  });

  test("fails with every finding: a connection to the decoy, network and bound Unix sockets, debug menu items, the network inspector, the profiler", async () => {
    const app = new FakeApp({}, undefined, [item("Developer", { id: "spark-developer", items: [item("Reload", { id: "spark-developer-reload" })] })]);
    app.bundle = { app: appBundle({ "main.jsbundle": HBC("spark-network-inspector") }, { KitchenSink: MACHO("spark-profiler") }), release: true };
    app.onLaunch = async options => {
      const host = options.arguments[options.arguments.indexOf("-RCT_jsLocation") + 1]!.split(":");
      await new Promise<void>((resolve, reject) => net.connect(Number(host[1]), host[0]).on("close", () => resolve()).on("error", reject));
    };
    app.sockets = () => [{ fd: "12", type: "IPv4", protocol: "TCP", name: "127.0.0.1:58602->127.0.0.1:8081", state: "ESTABLISHED" }, { fd: "6", type: "unix", name: `${tmpdir()}/devtools.sock` }];
    const result = await probe(app);
    expect(result.failure).toMatchObject({ kind: "assertion" });
    const lines = result.failure!.message.split("\n");
    expect(lines[0]).toBe("the app has a debug surface (7 findings):");
    expect(lines[1]).toMatch(/^ {2}connected 1 time to the development server it was given \(127\.0\.0\.1:\d+; from 127\.0\.0\.1:\d+\)$/);
    expect(lines.slice(2)).toEqual([
      "  fd 12: IPv4 TCP 127.0.0.1:58602->127.0.0.1:8081 (ESTABLISHED)", `  fd 6: Unix socket bound at ${tmpdir()}/devtools.sock`, "  menu item Developer", "  menu item Developer > Reload",
      "  Contents/Resources/main.jsbundle contains the network inspector (spark-network-inspector)", "  Contents/MacOS/KitchenSink contains the profiler (spark-profiler)",
    ]);
  });
});
