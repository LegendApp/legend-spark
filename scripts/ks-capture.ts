// bun run ks:capture [<area>/<screen>] [--wait-for <testID>] [--appearance light|dark] [--locale <language>] [--name <name>] [--out <directory>]
// Launches the built Kitchen Sink in driver mode (it never shows a window or takes focus),
// navigates, waits for the screen, renders the main window in-process to PNG and quits.
import { execFileSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { binary, run } from "../packages/cli/src/commands.ts";
import { processLog } from "../packages/cli/src/process.ts";
import { entryFile, prepareConfig, readJson, stateFile } from "../packages/cli/src/project.ts";
import { launchDriver, type Driver } from "./e2e/driver.ts";

const usage = "Usage: bun run ks:capture [<area>/<screen>] [--wait-for <testID>] [--appearance light|dark] [--locale <language>] [--name <name>] [--out <directory>]";
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  "wait-for": { type: "string" }, appearance: { type: "string" }, locale: { type: "string" }, name: { type: "string" }, out: { type: "string" }, help: { type: "boolean" },
} });
if (values.help) { console.log(usage); process.exit(0); }
const screen = positionals[0];
if (positionals.length > 1 || (screen !== undefined && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(screen))) throw new Error(usage);
if (!screen && !values["wait-for"]) throw new Error(`Pass <area>/<screen> or --wait-for <testID>.\n${usage}`);
const appearance = values.appearance ?? "light";
if (appearance !== "light" && appearance !== "dark") throw new Error("--appearance is light or dark");
if (values.locale !== undefined && !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)*$/.test(values.locale)) throw new Error("--locale is a language identifier such as ar or en-US");
const testID = values["wait-for"] ?? `${screen!.replace("/", "-")}-root`;
const name = values.name ?? [screen?.replace("/", "-") ?? testID, appearance, values.locale].filter(Boolean).join("-");

const framework = path.resolve(import.meta.dirname, "..");
const root = path.join(framework, "examples/kitchen-sink");
const out = path.resolve(values.out ?? path.join(root, ".spark/captures"));
const receipt = stateFile(root, "dev-build.json");
if (!existsSync(receipt)) throw new Error("Build the Kitchen Sink first: cd examples/kitchen-sink && bun run rebuild:macos");
const app: string = readJson(receipt).app;
const executable = path.join(app, "Contents/MacOS", execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim());

// The development build loads JavaScript over HTTP from localhost. Serve a production
// bundle of the current source, so no Metro session or packager connection is involved.
const work = mkdtempSync(path.join(os.tmpdir(), "ks-capture-"));
const bundle = path.join(work, "index.bundle");
const server = createServer((request, response) => {
  if (new URL(request.url ?? "/", "http://127.0.0.1").pathname === "/index.bundle") {
    response.writeHead(200, { "Content-Type": "application/javascript" });
    createReadStream(bundle).pipe(response);
    return;
  }
  console.error(`ks:capture: the app requested ${request.url}, which is not served`);
  response.writeHead(404).end();
});
let driver: Driver | undefined;
const log = path.join(work, "app.log");
try {
  prepareConfig(root);
  await run(root, [binary(root, "expo"), "export:embed", "--platform", "macos", "--entry-file", path.resolve(root, entryFile(root)),
    "--bundle-output", bundle, "--dev", "false", "--minify", "false", "--max-workers", "2"], { env: { CI: "1" }, label: "Bundling Kitchen Sink JavaScript" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  driver = await launchDriver({
    executable,
    args: ["-RCT_jsLocation", `127.0.0.1:${port}`, ...(values.locale ? ["-AppleLanguages", `(${values.locale})`, "-AppleLocale", values.locale] : [])],
    env: { SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=false&minify=false` },
    log: processLog(log),
  });
  if (screen) await driver.navigate(`spark-ks://${screen}`);
  await driver.waitFor(testID, 30000);
  await driver.setAppAppearance(appearance);
  const capture = await driver.capture("main", name);
  mkdirSync(out, { recursive: true });
  const destination = path.join(out, `${name}.png`);
  copyFileSync(capture.file, destination);
  await driver.quit();
  console.log(`${destination} (${capture.width}x${capture.height} @${capture.scale}x)`);
} catch (error) {
  if (existsSync(log)) console.error(`App log (last 40 lines):\n${readFileSync(log, "utf8").split("\n").slice(-40).join("\n")}`);
  throw error;
} finally {
  await driver?.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
