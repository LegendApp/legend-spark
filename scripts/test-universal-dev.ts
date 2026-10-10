import { spawnProcess } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import { create } from "../packages/cli/src/create.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { run } from "../packages/cli/src/commands.ts";
import { readJson, sourceMapSources, writeJson } from "../packages/cli/src/project.ts";

// One real Expo process serves all five graphs. No native toolchains/devices required.
const framework = path.resolve(import.meta.dirname, "..");
const root = path.resolve(process.argv[2] ?? `.spark/universal-dev/Settings${Date.now()}`);
await run(framework, [process.execPath, "scripts/pack.ts"], { capture: true });
await create(root, path.join(framework, "artifacts/packages/manifest.json"), "macos", true);
const sourceFiles = ["desktop.config.json", "package.json", "App.tsx", "app.config.js", "metro.config.js", "react-native.config.js"];
const original = sourceFiles.map(file => readFileSync(path.join(root, file), "utf8"));
const configFile = path.join(root, "desktop.config.json");
const config = readJson(configFile);
// Deterministic incompatible desktop state, independent of the local Go registry.
writeJson(configFile, { ...config, scheme: "spark-session-test" });
const port = await availablePort();
const base = `http://127.0.0.1:${port}`;
const logFile = path.join(root, ".spark/universal-dev.log");
mkdirSync(path.dirname(logFile), { recursive: true });
const log = openSync(logFile, "a");
const session = spawnProcess([process.execPath, "node_modules/@legendapp/spark/bin/spark.cjs", "dev", "--platform", "ios", "--no-open", "--go", "--offline", "--clear", "-p", String(port), "--max-workers", "2"], {
  cwd: root, env: { ...process.env, CI: "false" }, stdin: "ignore", stdout: log, stderr: log,
});
const sessionFile = path.join(root, ".spark/platforms", process.platform === "win32" ? "windows" : "macos", "session.json");
const desktop = process.platform === "win32" ? "windows" : "macos";
async function until(check: () => Promise<boolean>, label: string, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (session.exitCode !== null) throw new Error(`Expo exited (${session.exitCode}): ${readFileSync(logFile, "utf8")}`);
    if (await check()) return;
    await sleep(150);
  }
  throw new Error(`Timed out: ${label}. See ${logFile}`);
}
async function request(resource: string) {
  return fetch(`${base}${resource}`, { signal: AbortSignal.timeout(60000) });
}
try {
  await until(async () => {
    try { return existsSync(sessionFile) && readJson(sessionFile).port === port && (await request("/status")).ok; } catch { return false; }
  }, "shared Metro ready");
  const results = [];
  for (const platform of ["ios", "android", "web", "macos", "windows"]) {
    const query = `platform=${platform}&dev=true&minify=false`;
    const bundle = await request(`/index.bundle?${query}`);
    assert.equal(bundle.status, platform === desktop ? 409 : 200, `${platform}: ${await bundle.text()}`);
    // Source maps exercise the desktop graph even while runtime launch is blocked.
    const mapResponse = await request(`/index.map?${query}`);
    assert.equal(mapResponse.status, 200);
    const sources = sourceMapSources(await mapResponse.json());
    const adapter = platform === "macos" ? "index.tsx" : `index.${platform}.tsx`;
    assert.ok(sources.some(source => source.includes(`@legendapp/spark-ui/src/${adapter}`)), `${platform} UI adapter`);
    assert.ok(sources.some(source => source.includes(platform === "web" ? "uniwind/dist/module/core/config/config.js" : "uniwind/src/core/config/config.native.ts")), `${platform} Uniwind runtime`);
    const rn = platform === "macos" ? "react-native-macos" : platform === "windows" ? "react-native-windows" : platform === "web" ? "react-native-web" : "react-native";
    assert.ok(sources.some(source => source.includes(`/node_modules/${rn}/`)), `${platform} React Native backend`);
    if (["ios", "android", "web"].includes(platform)) assert.ok(!sources.some(source => /Spark(?:Button|TextInput|Select)NativeComponent|NativeDesktop/.test(source)), `${platform} AppKit exclusion`);
    if (["macos", "windows", "web"].includes(platform)) assert.ok(!sources.some(source => source.includes("@expo/ui/")), `${platform} mobile UI exclusion`);
    results.push({ platform, status: bundle.status, modules: sources.length });
    console.log(`PASS ${platform} on the same Metro port: ${sources.length} modules, HTTP ${bundle.status}`);
  }
  const clients = ["ios", "web"].map(platform => {
    const messages: any[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/hot`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "register-entrypoints", entryPoints: [`${base}/index.bundle?platform=${platform}&dev=true&minify=false`] }));
    socket.onmessage = event => messages.push(JSON.parse(String(event.data)));
    return { socket, messages, platform };
  });
  try {
    await until(async () => clients.every(c => c.messages.some(m => m.type === "bundle-registered")), "iOS and web HMR registration");
    for (const client of clients) client.messages.length = 0;
    const appFile = path.join(root, "App.tsx");
    writeFileSync(appFile, readFileSync(appFile, "utf8") + '\nexport const sharedSessionProbe = "spark-shared-session-hmr";\n');
    await until(async () => clients.every(c => c.messages.some(m => m.type === "update" && JSON.stringify(m.body.modified).includes("spark-shared-session-hmr"))), "shared source edit reaches both HMR clients");
    console.log("PASS one source edit reaches iOS and web HMR clients while desktop is blocked");
  } finally { for (const client of clients) client.socket.close(); }
  const beforeLog = readFileSync(logFile, "utf8");
  assert.equal(beforeLog.split("Starting Metro Bundler").length - 1, 1);
  assert.ok(beforeLog.includes("Networking has been disabled"));
  assert.ok(beforeLog.includes("Bundler cache is empty"));
  // Native config changes must restart the shared server even if desktop stays incompatible.
  writeJson(configFile, { ...config, scheme: "spark-session-test-changed" });
  await until(async () => (readFileSync(logFile, "utf8")).split("Starting Metro Bundler").length - 1 === 2, "Metro restart while desktop is blocked");
  await until(async () => { try { return (await request("/status")).ok; } catch { return false; } }, "restarted server ready");
  for (const platform of ["ios", "android", "web"]) {
    const response = await request(`/index.bundle?platform=${platform}&dev=true&minify=false`);
    assert.equal(response.status, 200, `${platform} after config restart`);
    await response.arrayBuffer();
  }
  console.log("PASS Expo clear/offline/Go/port forwarding and restart with incompatible desktop");
  writeJson(path.join(root, ".spark/universal-dev-report.json"), { results, port, passed: true, scope: "Live Metro graphs, forwarding, gate isolation, restart, cleanup; no native execution" });
} finally {
  session.kill("SIGTERM");
  await session.exited;
  closeSync(log);
  for (const [i, name] of sourceFiles.entries()) {
    if (["desktop.config.json", "App.tsx"].includes(name)) writeFileSync(path.join(root, name), original[i]!);
    else assert.equal(readFileSync(path.join(root, name), "utf8"), original[i], `${name} preserved`);
  }
}
assert.ok(!existsSync(sessionFile), "session state removed on exit");
await assert.rejects(fetch(`${base}/status`, { signal: AbortSignal.timeout(2000) }), "Metro stopped on exit");
console.log(`PASS preserved configuration and clean shutdown. Report: ${root}/.spark/universal-dev-report.json`);
