import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
// Native RN macOS regression. The test driver is included only in this custom runtime.
import path from "node:path";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { build } from "../packages/cli/src/build.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { nodeCommand } from "../packages/cli/src/windows.ts";
import { projectEnvironment } from "../packages/cli/src/project.ts";
if (process.platform !== "darwin") throw Error("This regression targets RN macOS; use the manual acceptance checklist on Windows.");
const root = path.resolve("examples/kitchen-sink");
const directory = path.resolve(".spark/keyboard-tests");
mkdirSync(directory, { recursive: true });
const manifest = path.join(root, "package.json");
const original = readFileSync(manifest, "utf8");
let executable: string;
try {
  const pkg = JSON.parse(original);
  pkg.devDependencies = { ...pkg.devDependencies, "@legendapp/spark-sdk-test-driver": "workspace:*" };
  writeFileSync(manifest, JSON.stringify(pkg, null, 2) + "\n");
  executable = path.join((await build(root, "dev")).app, "Contents/MacOS/KitchenSink");
} finally { writeFileSync(manifest, original); }
const entry = path.join(root, "KeyboardNativeRegression.tsx");
if (existsSync(entry)) throw Error(`Temporary entry already exists: ${entry}`);
const report = path.join(directory, "report.json");
rmSync(report, { force: true });
writeFileSync(entry, `import {registerRootComponent} from 'expo';
import {useEffect} from 'react'; import {Text} from 'react-native';
import driver from '@legendapp/spark-sdk-test-driver'; import {writeText} from '@legendapp/spark/files';
function App(){useEffect(()=>{void driver.call('keyboardRegression','{}').then(async raw=>{
const checks=JSON.parse(raw); await writeText(${JSON.stringify(report)},JSON.stringify({passed:Object.keys(checks).length===9&&Object.values(checks).every(v=>v===true),checks}));
});},[]);return <Text>Native keyboard regression</Text>;}registerRootComponent(App);`);
const metroConfig = createRequire(path.join(root, "package.json"))(path.join(root, "metro.config.js"));
const metroRoot = metroConfig.server?.unstable_serverRoot ?? metroConfig.projectRoot;
const bundlePath = path.relative(metroRoot, entry).replaceAll(path.sep, "/").replace(/\.tsx$/, ".bundle");
const port = await availablePort();
const metroLog = processLog(path.join(directory, "metro.log"));
const metro = spawnProcess(nodeCommand(root, "expo", "expo", ["start", "--localhost", "--port", String(port), "--max-workers", "2"]), {
  cwd: root, env: { ...process.env, CI: "1", SPARK_PLATFORM: "macos" }, stdout: metroLog, stderr: metroLog,
});
let app: ReturnType<typeof spawnProcess> | undefined;
try {
  const deadline = Date.now() + 60000;
  while (!await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)) {
    if (Date.now() > deadline || metro.exitCode !== null || metro.signalCode !== null) throw Error(`Metro failed; see ${directory}`);
    await sleep(250);
  }
  const log = processLog(path.join(directory, "app.log"));
  app = spawnProcess([executable, "-RCT_jsLocation", `127.0.0.1:${port}`], {
    cwd: root, env: { ...process.env, ...projectEnvironment(root), SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/${bundlePath}?platform=macos&dev=true&minify=false` }, stdout: log, stderr: log,
  });
  const deadlineReport = Date.now() + 90000;
  while (!existsSync(report)) {
    if (Date.now() > deadlineReport || app.exitCode !== null || app.signalCode !== null) throw Error(`Native regression did not report; see ${directory}`);
    await sleep(250);
  }
  const result = JSON.parse(readFileSync(report, "utf8"));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) throw Error("Native keyboard regression failed");
} finally {
  app?.kill(); if (app) await app.exited;
  metro.kill(); await metro.exited;
  rmSync(entry, { force: true });
}
