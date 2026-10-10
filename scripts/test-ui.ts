import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prepareKitchenSink } from "./prepare-kitchen-sink.ts";
import { build } from "../packages/cli/src/build.ts";
import { binary, run } from "../packages/cli/src/commands.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { readJson, writeJson } from "../packages/cli/src/project.ts";

const root = path.resolve(process.argv[2] ?? ".spark/ui-tests/KitchenSink");
await prepareKitchenSink(root);
const pkg = readJson(path.join(root, "package.json"));
pkg.dependencies["@legendapp/spark-sdk-test-driver"] = pkg.overrides["@legendapp/spark-sdk-test-driver"];
writeJson(path.join(root, "package.json"), pkg);
await run(root, managerCommand(packageManager(root), ["install"]));
const driverFile = path.join(root, "test-driver.ts");
const originalDriver = readFileSync(driverFile, "utf8");
writeFileSync(driverFile, 'import driver from "@legendapp/spark-sdk-test-driver";\nexport type TestDriver = typeof driver;\nexport const testDriver = driver;\n');
let metro: ReturnType<typeof spawnProcess> | undefined;
let app: ReturnType<typeof spawnProcess> | undefined;
async function waitFor(predicate: () => Promise<boolean>, description: string) {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
try {
  const product = await build(root, "dev");
  const port = await availablePort();
  writeJson(path.join(root, ".spark/session.json"), { compatible: true, target: "test", port });
  const log = processLog(path.join(root, ".spark/ui-metro.log"));
  metro = spawnProcess([binary(root, "expo"), "start", "--localhost", "--port", String(port), "--max-workers", "2"], {
    cwd: root, env: { ...process.env, CI: "1" }, stdout: log, stderr: log,
  });
  // Expo SDK 58 binds --localhost to the name "localhost" (::1 first), not 127.0.0.1.
  await waitFor(async () => fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false), "Metro");
  const executable = (await run(root, ["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleExecutable", path.join(product.app, "Contents/Info.plist")], { capture: true })).trim();
  const report = path.join(root, `.spark/ui-results-${Date.now()}.json`);
  const output = processLog(path.join(root, ".spark/ui-app.log"));
  app = spawnProcess([path.join(product.app, "Contents/MacOS", executable), "-RCT_jsLocation", `localhost:${port}`, "--spark-ui-report", report], {
    cwd: root, env: { ...process.env, SPARK_BUNDLE_URL: `http://localhost:${port}/index.bundle?platform=macos&dev=true&minify=false` }, stdout: output, stderr: output,
  });
  await waitFor(async () => existsSync(report), "native UI checks");
  const result = readJson(report);
  if (!result.passed) throw new Error(`Native UI checks failed: ${JSON.stringify(result)}`);
  for (const name of result.results) console.log(`PASS ${name}`);
  console.log(`Native UI report: ${report}`);
} finally {
  if (app && app.exitCode === null) { app.kill(); await app.exited; }
  if (metro) { metro.kill(); await metro.exited; }
  writeFileSync(driverFile, originalDriver);
}
