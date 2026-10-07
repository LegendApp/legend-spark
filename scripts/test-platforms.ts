import { spawnProcess, which, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { serveTestHTTP } from "./testing/http.ts";
import { managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { create } from "../packages/cli/src/create.ts";
import { build } from "../packages/cli/src/build.ts";
import { run, cancelCommands } from "../packages/cli/src/commands.ts";
import { nodeCommand } from "../packages/cli/src/windows.ts";
import { architecture } from "../packages/cli/src/platform.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { readJson, writeJson, stateFile, projectEnvironment } from "../packages/cli/src/project.ts";
import { platforms, type TestPlatform } from "../examples/kitchen-sink/contract-report.ts";
import { createReport, record, saveReport, installedVersions, acceptRuntimeMessage } from "./testing/report.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  platform: { type: "string" }, project: { type: "string" }, device: { type: "string" },
  "prepare-only": { type: "boolean" }, "api-only": { type: "boolean" }, "no-open": { type: "boolean" },
  timeout: { type: "string", default: "180" }, "report-dir": { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log(`bun run test:platform --platform macos|windows|ios|android|web [options]
  --prepare-only    Create/generate/bundle; never claims native execution
  --api-only        Finish after API assertions; UI remains not tested
  --device ID       Simulator UDID / adb serial (required for mobile runtime)
  --no-open         Print the web URL instead of opening a browser
  --timeout 180     Seconds to wait for runtime results after building
  --project PATH    Fresh disposable consumer directory
  --report-dir DIR  Portable JSON reports (default .spark/test-results)

Desktop uses Spark builds; mobile uses Expo run:ios/run:android. Interact with
controls and choose Finish run, or use --api-only for noninteractive API checks.
Clipboard checks replace clipboard content and restore text; use a test session.`);
  process.exit(0);
}
class MissingPrerequisite extends Error {}
const framework = path.resolve(import.meta.dirname, "..");
const platform = (values.platform ?? (process.platform === "win32" ? "windows" : "macos")) as TestPlatform;
if (!platforms.includes(platform)) throw new Error(`Invalid platform: ${platform}`);
const timeoutMs = Number(values.timeout) * 1000;
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error("--timeout must be a positive number of seconds");
const root = path.resolve(values.project ?? `.spark/platform-tests/Platform${platform}${Date.now()}`);
if (existsSync(root)) throw new Error("Choose a fresh --project directory; this runner creates a disposable consumer");
const prepareOnly = !!values["prepare-only"];
const desktop = platform === "macos" || platform === "windows";
const report = createReport(framework, root, { platform, arch: desktop ? architecture(platform) : "not-reported",
  device: values.device ?? (platform === "web" ? "browser" : desktop ? "interactive desktop" : "not selected"), mode: "dev" }, prepareOnly ? "prepare" : "runtime");
const reportFile = path.resolve(values["report-dir"] ?? ".spark/test-results", `${report.runId}.json`);
let stage = "build.project";
let metro: ReturnType<typeof spawnProcess> | undefined;
let app: ReturnType<typeof spawnProcess> | undefined;
let server: Awaited<ReturnType<typeof serveTestHTTP>> | undefined;
let completed = false;
let transportError: string | undefined;
let expectedFingerprint: string | undefined;
let androidReversePort: number | undefined;
let mobileApplicationId: string | undefined;
let received = false;
let interrupted = false;
const previousPlatform = process.env.SPARK_PLATFORM;
process.env.SPARK_PLATFORM = platform;
function checkpoint() { saveReport(reportFile, report); }
function stop() { interrupted = true; cancelCommands(root); app?.kill(); metro?.kill(); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
checkpoint();
async function until(predicate: () => Promise<boolean> | boolean, label: string, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (interrupted) throw new Error("Test run interrupted");
    if (transportError) throw new Error(transportError);
    if (app && app.exitCode !== null) throw new Error(`Application exited before reporting (${app.exitCode})`);
    if (metro && metro.exitCode !== null) throw new Error(`Metro exited (${metro.exitCode}); inspect ${root}`);
    if (await predicate()) return;
    await sleep(150);
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  if (!prepareOnly && ((platform === "windows" && process.platform !== "win32") || (["macos", "ios"].includes(platform) && process.platform !== "darwin"))) {
    record(report, { id: "build.native", status: "not-tested", detail: `Native ${platform} execution requires its host toolchain; use --prepare-only here` });
    report.execution = "blocked"; process.exitCode = 2;
  } else if (!prepareOnly && ["ios", "android"].includes(platform) && !values.device) {
    record(report, { id: "build.native", status: "not-tested", detail: "Choose --device <simulator UDID / adb serial> so launch, reporting and cleanup target one device" });
    report.execution = "blocked"; process.exitCode = 2;
  } else {
    if (!prepareOnly && platform !== "web") {
      const tools = { macos: ["xcodebuild", "pod"], windows: ["pwsh.exe", "dotnet.exe"], ios: ["xcrun", "pod"], android: ["adb", "java"] }[platform];
      const missing = tools.filter(tool => !which(tool));
      if (missing.length) throw new MissingPrerequisite(`Missing native test prerequisites: ${missing.join(", ")}`);
    }
    await run(framework, [process.execPath, "scripts/pack.ts", ...(platform === "windows" ? ["--platform=windows"] : [])], { capture: true });
    await create(root, path.join(framework, "artifacts/packages/manifest.json"), platform === "windows" ? "windows" : "macos", true);
    for (const name of ["contract-cases.ts", "contract-report.ts", "PlatformChecks.tsx", "desktop-contract-cases.ts", "foundation-checks.ts", "file-stream-checks.ts", "desktop-contracts.ts", "desktop-contracts.desktop.ts", "desktop-contracts.macos.ts", "desktop-contracts.windows.ts", "DesktopInteractionChecks.tsx", "DesktopInteractionChecks.desktop.tsx", "DesktopInteractionChecks.macos.tsx", "DesktopInteractionChecks.windows.tsx", "DesktopLibraryChecks.tsx", "DesktopLibraryChecks.desktop.tsx", "DesktopLibraryChecks.macos.tsx", "DesktopLibraryChecks.windows.tsx", "platform-runtime-tasks.ts"]) cpSync(path.join(framework, "examples/kitchen-sink", name), path.join(root, name));
    writeFileSync(path.join(root, "App.tsx"), 'export { default } from "./PlatformChecks";\n');
    if (desktop) {
      const pkg = readJson(path.join(root, "package.json"));
      for (const name of ["@legendapp/spark", "react-native-nitro-modules", "@react-native-runtimes/core"]) pkg.dependencies[name] = pkg.overrides[name];
      writeJson(path.join(root, "package.json"), pkg); await run(root, managerCommand(packageManager(root), ["install"]), { capture: true });
    }
    // A unique application ID prevents this probe replacing another test or user app.
    if (!prepareOnly && platform === "ios") {
      const listing = JSON.parse(await run(root, ["xcrun", "simctl", "list", "devices", "available", "--json"], { capture: true }));
      if (!(Object.values(listing.devices).flat() as { udid: string }[]).some(device => device.udid === values.device)) throw new MissingPrerequisite("--device must identify an available iOS simulator UDID; physical-device transport is not configured");
    }
    const config = readJson(path.join(root, "desktop.config.json"));
    const applicationId = `so.legend.spark.acceptance.p${report.runId.replaceAll("-", "")}`;
    config.expo = { ...config.expo, ios: { bundleIdentifier: applicationId }, android: { package: applicationId } };
    writeJson(path.join(root, "desktop.config.json"), config);
    const appCases = new Set(["clipboard.read", "clipboard.roundtrip", "storage.lifecycle", "storage.unavailable", "links.resolution", "files.recursive-watch", "windows.overlay", "files.streaming", "files.trash", "ui.button", "ui.input", "ui.select", "desktop.filesystem", "desktop.settings", "desktop.recent-documents", "desktop.rich-clipboard", "desktop.message-dialog", "desktop.context-menu", "desktop.tray", "desktop.global-shortcuts", "desktop.modal-windows", "desktop.advanced-menus", "desktop.processes", "desktop.system", "desktop.notifications", "desktop.sqlite", "desktop.nitro", "desktop.runtimes", "desktop.webview", "desktop.drag-drop"]);
    server = await serveTestHTTP({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 128 * 1024, async fetch(request) {
      const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
      if (request.method === "GET" && new URL(request.url).pathname === `/${report.runId}/webview`) return new Response('<html><body><p id="value">WebView URL acceptance</p></body></html>', { headers: { "Content-Type": "text/html; charset=utf-8" } });
      if (new URL(request.url).pathname !== `/${report.runId}`) return new Response("Not found", { status: 404, headers });
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (request.method !== "POST" || completed) return new Response("Run not accepting results", { status: 409, headers });
      try {
        const message = await request.json();
        completed = acceptRuntimeMessage(report, message, appCases, expectedFingerprint);
        received = true; checkpoint();
        return new Response("ok", { headers });
      } catch (error) { transportError = String(error); return new Response(String(error), { status: 400, headers }); }
    } });
    writeFileSync(path.join(root, "platform-test-config.ts"), `export const testConfig = ${JSON.stringify({ runId: report.runId, reportURL: `http://127.0.0.1:${server.port}/${report.runId}`, apiOnly: !!values["api-only"], processExecutable: platform === "windows" ? which("pwsh.exe") ?? undefined : "/bin/sh" })};\n`);
    report.versions = installedVersions(root);
    if (platform === "macos") {
      const manifest = readFileSync(path.join(root, "package.json"), "utf8");
      try { await run(root, nodeCommand(root, "expo-desktop", "expo-desktop", ["prebuild", "--platform", "macos", "--template", "expo-desktop-template-bare-minimum@54.81.1", "--no-install"]), { env: { CI: "1" }, capture: true }); }
      finally { writeFileSync(path.join(root, "package.json"), manifest); }
    } else if (platform !== "web") await run(root, [process.execPath, "node_modules/@legendapp/spark/bin/spark.cjs", "prebuild", "--platform", platform], { capture: true });
    record(report, { id: "build.project", status: "passed" }); stage = "build.bundle"; checkpoint();
    await run(root, nodeCommand(root, "expo", "expo", ["export:embed", "--entry-file", "index.ts", "--platform", platform, "--dev", "true", "--max-workers", "2", "--bundle-output", stateFile(root, "contract-check.js")]), { capture: true });
    record(report, { id: "build.bundle", status: "passed" }); checkpoint();
    if (!prepareOnly) {
      const port = await availablePort();
      writeJson(stateFile(root, "session.json"), { compatible: true, target: "test", port });
      mkdirSync(path.dirname(stateFile(root, "contract-metro.log")), { recursive: true });
      metro = spawnProcess(nodeCommand(root, "expo", "expo", ["start", "--localhost", "--port", String(port), "--max-workers", "2"]), {
        cwd: root, env: { ...process.env, CI: "1" }, stdout: processLog(stateFile(root, "contract-metro.log")), stderr: processLog(stateFile(root, "contract-metro-errors.log")),
      });
      stage = "runtime.launch";
      await until(() => fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false), "Metro", 60_000);
      if (desktop) {
        stage = "build.native";
        const product = await build(root, "dev"); expectedFingerprint = product.runtime.fingerprint;
        record(report, { id: "build.native", status: "passed" });
        if (platform === "windows") app = spawnProcess([path.join(product.app, "MyApp.exe")], { cwd: product.app, env: { ...process.env, ...projectEnvironment(root), SPARK_METRO_PORT: String(port) }, stdout: "inherit", stderr: "inherit" });
        else {
          const executable = (await run(root, ["/usr/libexec/PlistBuddy", "-c", "Print CFBundleExecutable", path.join(product.app, "Contents/Info.plist")], { capture: true })).trim();
          app = spawnProcess([path.join(product.app, "Contents/MacOS", executable), "-RCT_jsLocation", `127.0.0.1:${port}`], { cwd: root, env: { ...process.env, ...projectEnvironment(root), SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=true&minify=false` }, stdout: "inherit", stderr: "inherit" });
        }
      } else if (platform === "web") {
        const url = `http://localhost:${port}`;
        console.log(`Open test screen: ${url}`);
        if (!values["no-open"]) {
          const opener = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["rundll32.exe", "url.dll,FileProtocolHandler", url] : ["xdg-open", url];
          await run(root, opener, { capture: true });
        }
      } else {
        stage = "build.native";
        if (platform === "android") {
          await run(root, ["adb", "-s", values.device!, "reverse", `tcp:${server.port}`, `tcp:${server.port}`], { capture: true }); androidReversePort = server.port;
        }
        mobileApplicationId = applicationId;
        await run(root, nodeCommand(root, "expo", "expo", [`run:${platform}`, "--no-bundler", "--port", String(port), ...(values.device ? ["--device", values.device] : [])]), { capture: true });
        record(report, { id: "build.native", status: "passed" });
      }
      stage = "runtime.launch"; checkpoint();
      console.log(`Waiting for ${platform} results. ${values["api-only"] ? "API-only: UI will remain untested." : "Interact with the three controls, then choose Finish run."}`);
      await until(() => completed, "application results / Finish run", timeoutMs);
      if (report.results.some(r => r.status === "failed")) { report.execution = "failed"; process.exitCode = 1; }
    }
  }
} catch (error) {
  report.execution = error instanceof MissingPrerequisite ? "blocked" : "failed"; report.error = String(error);
  // A user who does not finish UI interaction has not disproved successful startup.
  if (error instanceof MissingPrerequisite) record(report, { id: "build.native", status: "not-tested", detail: error.message });
  else if (received && stage === "runtime.launch" && !transportError) {
    for (const id of ["ui.button", "ui.input", "ui.select"]) if (report.results.find(r => r.id === id)?.status === "not-tested") record(report, { id, status: "not-tested", detail: String(error) });
  } else record(report, { id: stage, status: "failed", detail: String(error) });
  console.error(error); process.exitCode = error instanceof MissingPrerequisite ? 2 : 1;
} finally {
  if (app && app.exitCode === null) { app.kill(); await app.exited; }
  if (metro && metro.exitCode === null) { metro.kill(); await metro.exited; }
  if (mobileApplicationId && platform === "android") await run(root, ["adb", "-s", values.device!, "shell", "am", "force-stop", mobileApplicationId], { capture: true }).catch(() => {});
  if (mobileApplicationId && platform === "ios") await run(root, ["xcrun", "simctl", "terminate", values.device!, mobileApplicationId], { capture: true }).catch(() => {});
  if (androidReversePort) await run(root, ["adb", "-s", values.device!, "reverse", "--remove", `tcp:${androidReversePort}`], { capture: true }).catch(() => {});
  await server?.stop(true);
  if (report.execution === "running") report.execution = "completed";
  report.finishedAt = new Date().toISOString(); checkpoint();
  process.off("SIGINT", stop); process.off("SIGTERM", stop);
  if (previousPlatform === undefined) delete process.env.SPARK_PLATFORM; else process.env.SPARK_PLATFORM = previousPlatform;
  console.log(`${report.target.platform}: ${Object.entries(report.summary.counts).map(([status, count]) => `${count} ${status}`).join(", ")}. Coverage ${report.summary.complete ? "complete" : "incomplete"}.`);
  console.log(`Platform report: ${reportFile}`);
}
