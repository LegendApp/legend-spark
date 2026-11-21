import { spawnSync } from "node:child_process";
import path from "node:path";
import { readRuntime } from "../packages/cli/src/local.ts";
import { readAppConfig } from "../packages/cli/src/project.ts";
import { releaseAppExpectation, validateApp } from "../packages/cli/src/signing.ts";
import { probeKitchenSinkRelease } from "./e2e/release-probe.ts";
import { KITCHEN_SINK } from "./e2e/kitchen-sink.ts";
import type { Runner } from "../packages/cli/src/credentials.ts";

const [project, artifact, option, ...extra] = process.argv.slice(2);
if (!project || project.startsWith("-") || !artifact?.endsWith(".app") || (option && option !== "--probe") || extra.length) {
  throw new Error("Usage: bun run release:check <project> <signed.app> [--probe]");
}
if (process.platform !== "darwin") throw new Error("The release app checks require macOS.");

const root = path.resolve(project);
const app = path.resolve(artifact);
const runtime = readRuntime(app);
if (!runtime) throw new Error("Expected a Spark app with a compatible runtime receipt.");

// Keep standalone inspection independent of packaging logs and credentials.
const execute: Runner = async (cwd, [tool, ...args]) => {
  const result = spawnSync(tool!, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${tool} exited with status ${result.status}`);
  return tool === "codesign" ? result.stdout + result.stderr : result.stdout;
};
const info = JSON.parse(await execute(root, ["plutil", "-convert", "json", "-o", "-", path.join(app, "Contents/Info.plist")], { capture: true }));
const config = readAppConfig(root).expo;
const expected = releaseAppExpectation(root, runtime, config, info.CFBundleVersion);
if (option === "--probe" && (runtime.mode !== "release" || !expected.testDriverInRelease ||
    expected.bundleId !== readAppConfig(KITCHEN_SINK).expo.macos?.bundleIdentifier)) {
  throw new Error("--probe requires a Kitchen Sink release built with the test driver.");
}
const signature = await execute(root, ["codesign", "-dvvv", app], { capture: true });
const name = /^Authority=(Developer ID Application: .+)$/m.exec(signature)?.[1];
const teamId = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(signature)?.[1];
if (!name || !teamId) throw new Error("The app requires a Developer ID Application signature.");
await validateApp(root, app, { name, teamId }, expected, false, execute);
console.log(`Verified macOS release app: ${app}`);

if (option === "--probe") {
  await probeKitchenSinkRelease(app);
  console.log("Kitchen Sink ignored the decoy development server and opened no development sockets.");
}
