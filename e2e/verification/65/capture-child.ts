// bun e2e/verification/65/capture-child.ts [--next <row>,<row>] [--appearance light|dark] [--locale <language>] [--name <name>]
// Like `bun run ks:capture windows/window-options`, then opens the child window through
// spark-ks://windows/window-options?child=open&next=… and captures it by window ID, plus the main window.
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

const { values } = parseArgs({ options: { next: { type: "string" }, appearance: { type: "string" }, locale: { type: "string" }, name: { type: "string" } } });
const appearance = values.appearance === "dark" ? "dark" : "light";
const name = values.name ?? ["window-options", appearance, values.locale].filter(Boolean).join("-");
const root = path.resolve(import.meta.dirname, "../../../examples/kitchen-sink");
const app: string = readJson(stateFile(root, "dev-build.json")).app;
const executable = path.join(app, "Contents/MacOS", execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim());
const work = mkdtempSync(path.join(os.tmpdir(), "ks-capture-child-"));
const bundle = path.join(work, "index.bundle");
const server = createServer((_, response) => { response.writeHead(200, { "Content-Type": "application/javascript" }); createReadStream(bundle).pipe(response); });
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
  await driver.navigate("spark-ks://windows/window-options");
  await driver.waitFor("windows-window-options-root", 30000);
  await driver.setAppAppearance(appearance);
  await driver.navigate(`spark-ks://windows/window-options?child=open${values.next ? `&next=${values.next}` : ""}`);
  await driver.waitFor("secondary-window", 15000);
  for (const [window, file] of [["id:windows-window-options-child", `${name}-child`], ["main", name]] as const) {
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
