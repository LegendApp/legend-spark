import { managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { spawnProcess, type ManagedProcess } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { serveTestHTTP } from "./testing/http.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { create } from "../packages/cli/src/create.ts";
import { packageManifest } from "../packages/cli/src/local.ts";
import { nativePackages, runtimeFor, incompatible, stateFile, writeJson, readJson, digest } from "../packages/cli/src/project.ts";
import { prepareWindows } from "../packages/cli/src/windows.ts";
import { nodeCommand } from "../packages/cli/src/process.ts";
import { run } from "../packages/cli/src/commands.ts";
import { architecture } from "../packages/cli/src/platform.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { project: { type: "string" }, "prepare-only": { type: "boolean" } } });
const root = path.resolve(values.project ?? ".spark/windows-probe/WindowsProbe");
const cli = path.join(root, "node_modules/@legendapp/spark/bin/spark.cjs");
const prepareOnly = !!values["prepare-only"];
if (!prepareOnly && process.platform !== "win32") throw new Error("Run the native verifier on Windows x64 or ARM64, or pass --prepare-only to check generation and bundles here.");
if (existsSync(path.join(root, "package.json"))) throw new Error("Choose a fresh --project directory; this test installs a native fixture.");
const manifest = packageManifest();
const report: any = { host: process.platform, arch: architecture("windows"), native: !prepareOnly, passed: false, stages: [] };
let session: ManagedProcess | undefined;
let server: Awaited<ReturnType<typeof serveTestHTTP>> | undefined;
let originalApp: string | undefined;
let proof: any;
const token = crypto.randomUUID();
function startSession(extra: string[] = []) {
  const child = spawnProcess([process.execPath, cli, "dev", "--project", root, ...extra], { cwd: root, env: { ...process.env, SPARK_SESSION_TOKEN: token }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  for (const stream of [child.stdout, child.stderr]) void (async () => {
    for await (const chunk of stream!) appendFileSync(stateFile(root, "logs/windows-session.log"), chunk);
  })();
  return child;
}
async function wait(check: () => boolean | Promise<boolean>, message: string, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (session && session.exitCode !== null) throw new Error("spark dev exited; inspect .spark/logs/windows-session.log");
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(message);
}
function stage(name: string) {
  report.currentStage = name;
  // Expo Desktop must receive an empty destination when creating the fixture.
  if (existsSync(path.join(root, "package.json"))) writeJson(stateFile(root, "windows-verification.json"), report);
  console.log(name);
}
function pass(details?: unknown) { report.stages.push({ name: report.currentStage, passed: true, details }); }
async function bundle() {
  await run(root, nodeCommand(root, "expo", "expo", ["export:embed", "--platform", "windows", "--entry-file", "index.ts", "--bundle-output", stateFile(root, "windows-check.bundle"), "--dev", "true", "--minify", "false", "--max-workers", "2"]), { capture: true });
}
try {
  stage("Create through the framework starter");
  await create(root, manifest, "windows"); pass();
  originalApp = readFileSync(path.join(root, "App.tsx"), "utf8");
  const baseline = runtimeFor(root, nativePackages(root), "go");
  let go: any;
  let goHash: string | undefined;
  if (prepareOnly) {
    stage("Prebuild and bundle the integrated Windows starter");
    await prepareWindows(root, "go"); await bundle();
    if (runtimeFor(root, nativePackages(root), "go").fingerprint !== baseline.fingerprint) throw new Error("Native fingerprint changed during prebuild");
    pass();
  } else {
    stage("Build and register the Spark Runner with spark sdk build-runner");
    await run(root, [process.execPath, cli, "sdk", "build-runner", "--project", root]);
    go = readJson(stateFile(root, "go-build.json"));
    goHash = digest(readFileSync(path.join(go.app, "MyApp.exe")).toString("base64"));
    pass({ app: go.app });
    server = await serveTestHTTP({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      if (request.method !== "POST" || request.headers.get("x-spark-token") !== token) return new Response("Wrong session", { status: 403 });
      proof = await request.json();
      return new Response("ok");
    } });
    writeFileSync(path.join(root, "Marker.ts"), 'export default "initial";\n');
    writeFileSync(path.join(root, "WindowsExtra.ts"), 'export function greeting() { return null; }\n');
    writeFileSync(path.join(root, "App.tsx"), `import React, { useEffect, useState } from "react";
import { View, Text, Button, TurboModuleRegistry } from "react-native";
import marker from "./Marker";
import { greeting } from "./WindowsExtra";
const host = TurboModuleRegistry.getEnforcing<any>("NativeSparkRuntime");
export default function App() {
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    void fetch("http://127.0.0.1:${server.port}", { method: "POST", headers: { "Content-Type": "application/json", "x-spark-token": host.session() }, body: JSON.stringify({ native: JSON.parse(host.describe()), marker, greeting: greeting(), hermes: !!(globalThis as any).HermesInternal }) });
  }, [marker]);
  return <View><Text>{marker}</Text><Button title={String(clicks)} onPress={() => setClicks(v => v + 1)} /></View>;
}
`);
    stage("Launch through spark dev and execute the native core with Hermes");
    mkdirSync(stateFile(root, "logs"), { recursive: true });
    session = startSession(["--runner-binary", go.app]);
    await wait(() => proof?.marker === "initial", "The native prebuilt app did not report", 10 * 60 * 1000);
    if (!proof.hermes || proof.native.fingerprint !== go.runtime.fingerprint || proof.native.mode !== "go") throw new Error("Wrong Spark Runner or JavaScript engine");
    pass(proof);
    stage("Fast Refresh in the same prebuilt session");
    writeFileSync(path.join(root, "Marker.ts"), 'export default "refreshed";\n');
    await wait(() => proof?.marker === "refreshed", "Fast Refresh did not reach the native app"); pass(proof);
  }
  stage("Install the existing native-greeting fixture and invalidate prebuilt");
  const archive = path.resolve(path.dirname(manifest), readJson(manifest)["@legendapp/spark-native-greeting"]);
  await run(root, managerCommand(packageManager(root), [packageManager(root) === "npm" ? "install" : "add", archive]));
  const issues = incompatible(baseline, nativePackages(root), "windows");
  if (!issues.includes("@legendapp/spark-native-greeting")) throw new Error("Shared compatibility check did not detect the new module");
  if (prepareOnly) {
    writeFileSync(path.join(root, "App.tsx"), 'import React from "react";\nimport { Text } from "react-native";\nimport { getGreeting } from "@legendapp/spark-native-greeting";\nexport default function App() { return <Text>{getGreeting()}</Text>; }\n');
    pass(issues);
    stage("Prebuild and bundle the custom Windows graph");
    await prepareWindows(root, "dev"); await bundle(); pass();
  } else {
    await wait(() => {
      try { const s = readJson(stateFile(root, "session.json")); return s.target === "go" && !s.compatible && s.reason.includes("native-greeting"); } catch { return false; }
    }, "spark dev did not reject the incompatible Spark Runner");
    pass(issues);
    writeFileSync(path.join(root, "WindowsExtra.ts"), 'import { getGreeting } from "@legendapp/spark-native-greeting";\nexport const greeting = getGreeting;\n');
    stage("Build explicitly and reopen through Expo's noninteractive development session");
    session!.kill();
    await session!.exited;
    session = undefined;
    await run(root, [process.execPath, cli, "build", "--dev", "--project", root]);
    session = startSession();
    await wait(() => proof?.native.mode === "dev" && proof.greeting === "Hello from the custom native module", "The custom runtime did not report", 20 * 60 * 1000);
    const custom = readJson(stateFile(root, "dev-build.json"));
    if (!proof.hermes || proof.native.fingerprint !== custom.runtime.fingerprint) throw new Error("Custom native runtime identity did not match the build");
    if (digest(readFileSync(path.join(go.app, "MyApp.exe")).toString("base64")) !== goHash) throw new Error("The saved prebuilt executable changed");
    pass(proof);
  }
  report.passed = true;
  console.log(prepareOnly ? "PASS: integrated generation, compatibility and Windows bundles. Native execution NOT verified." : "PASS: integrated Windows prebuilt, Hermes, Fast Refresh and custom native module.");
} catch (error) {
  report.error = String(error); process.exitCode = 1; console.error(error);
} finally {
  if (session && session.exitCode === null) {
    session.kill();
    await Promise.race([session.exited, sleep(5000)]);
    if (session.exitCode === null) session.kill();
  }
  await server?.stop(true);
  if (originalApp !== undefined) writeFileSync(path.join(root, "App.tsx"), originalApp);
  for (const name of ["Marker.ts", "WindowsExtra.ts"]) rmSync(path.join(root, name), { force: true });
  report.finished = new Date().toISOString(); writeJson(stateFile(root, "windows-verification.json"), report);
  console.log(`Report: ${stateFile(root, "windows-verification.json")}`);
}
