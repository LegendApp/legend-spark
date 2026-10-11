// bun e2e/verification/72/capture-child.ts --name <name> [--steps <row>,<row>] [--appearance light|dark] [--locale <language>]
// Like `bun run ks:capture windows/toolbar`, then presses Open child window and the listed rows' Next
// buttons (display-mode, shown, width, customization), waiting for each row to show its new value,
// and captures the child by window ID (`<name>-child.png`) and the main window (`<name>.png`).
import { execFileSync } from "node:child_process";
import { copyFileSync, createReadStream, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { binary, run } from "../../../packages/cli/src/commands.ts";
import { processLog } from "../../../packages/cli/src/process.ts";
import { entryFile, prepareConfig, readJson, stateFile } from "../../../packages/cli/src/project.ts";
import { launchDriver, type Driver } from "../../../scripts/e2e/driver.ts";

const { values } = parseArgs({ options: { name: { type: "string" }, steps: { type: "string" }, appearance: { type: "string" }, locale: { type: "string" } } });
if (!values.name) throw new Error("Pass --name");
const appearance = values.appearance === "dark" ? "dark" : "light";
const steps = values.steps?.split(",").filter(Boolean) ?? [];
const root = path.resolve(import.meta.dirname, "../../../examples/kitchen-sink");
const app: string = readJson(stateFile(root, "dev-build.json")).app;
const executable = path.join(app, "Contents/MacOS", execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim());
const work = mkdtempSync(path.join(os.tmpdir(), "ks-capture-toolbar-"));
const bundle = path.join(work, "index.bundle");
const server = createServer((_, response) => { response.writeHead(200, { "Content-Type": "application/javascript" }); createReadStream(bundle).pipe(response); });

async function text(driver: Driver, id: string) { return (await driver.elements()).elements.find(element => element.id === id)?.text; }
async function until(driver: Driver, id: string, accept: (value: string | undefined) => boolean, what: string) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const value = await text(driver, id);
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what} (${id} is ${JSON.stringify(value)})`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

let driver: Driver | undefined;
try {
  prepareConfig(root);
  await run(root, [binary(root, "expo"), "export:embed", "--platform", "macos", "--entry-file", path.resolve(root, entryFile(root)),
    "--bundle-output", bundle, "--dev", "false", "--minify", "false", "--max-workers", "2"], { env: { CI: "1" }, label: "Bundling Kitchen Sink JavaScript" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  driver = await launchDriver({
    executable, log: processLog(path.join(work, "app.log")),
    args: ["-RCT_jsLocation", `127.0.0.1:${port}`, ...(values.locale ? ["-AppleLanguages", `(${values.locale})`, "-AppleLocale", values.locale] : [])],
    env: { SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=false&minify=false` },
  });
  await driver.navigate("spark-ks://windows/toolbar");
  await driver.waitFor("windows-toolbar-root", 30000);
  await driver.setAppAppearance(appearance);
  await driver.tap({ testID: "windows-toolbar-open" });
  await driver.waitFor("secondary-window", 15000);
  await until(driver, "windows-toolbar-state-mode", value => value === "display mode: icon", "the opened toolbar's state");
  for (const step of steps) {
    const id = `windows-toolbar-${step}-value`, before = await text(driver, id);
    await driver.tap({ testID: `windows-toolbar-${step}` });
    console.log(`${step}: ${await until(driver, id, value => value !== undefined && value !== before, `${step} to change`)}`);
  }
  // Each row refreshes getToolbarState after it applies; wait for that read to land.
  await new Promise(resolve => setTimeout(resolve, 500));
  for (const line of ["mode", "shown", "items", "overflow"]) console.log(await text(driver, `windows-toolbar-state-${line}`));
  for (const [window, file] of [["id:windows-toolbar-child", `${values.name}-child`], ["main", values.name]] as const) {
    const capture = await driver.capture(window, file);
    copyFileSync(capture.file, path.join(import.meta.dirname, `${file}.png`));
    console.log(`${file}.png (${capture.width}x${capture.height} @${capture.scale}x)`);
  }
  await driver.quit();
} finally {
  await driver?.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
