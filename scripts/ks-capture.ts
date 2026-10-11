// bun run ks:capture [<area>/<screen>] [--wait-for <testID>] [--appearance light|dark] [--locale <language>] [--name <name>] [--out <directory>] [--dev-bundle]
// Launches the built Kitchen Sink in driver mode (it never shows a window or takes focus),
// navigates, waits for the screen, renders the main window in-process to PNG and quits.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { processLog } from "../packages/cli/src/process.ts";
import type { Driver } from "./e2e/driver.ts";
import { KITCHEN_SINK, KitchenSinkApp, LOCALE } from "./e2e/kitchen-sink.ts";

const usage = "Usage: bun run ks:capture [<area>/<screen>] [--wait-for <testID>] [--appearance light|dark] [--locale <language>] [--name <name>] [--out <directory>] [--dev-bundle]";
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  "wait-for": { type: "string" }, appearance: { type: "string" }, locale: { type: "string" }, name: { type: "string" }, out: { type: "string" }, "dev-bundle": { type: "boolean" }, help: { type: "boolean" },
} });
if (values.help) { console.log(usage); process.exit(0); }
const screen = positionals[0];
if (positionals.length > 1 || (screen !== undefined && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(screen))) throw new Error(usage);
if (!screen && !values["wait-for"]) throw new Error(`Pass <area>/<screen> or --wait-for <testID>.\n${usage}`);
const appearance = values.appearance ?? "light";
if (appearance !== "light" && appearance !== "dark") throw new Error("--appearance is light or dark");
if (values.locale !== undefined && !LOCALE.test(values.locale)) throw new Error("--locale is a language identifier such as ar or en-US");
const testID = values["wait-for"] ?? `${screen!.replace("/", "-")}-root`;
const name = values.name ?? [screen?.replace("/", "-") ?? testID, appearance, values.locale].filter(Boolean).join("-");

const out = path.resolve(values.out ?? path.join(KITCHEN_SINK, ".spark/captures"));
const app = new KitchenSinkApp();
const work = mkdtempSync(path.join(os.tmpdir(), "ks-capture-"));
let driver: Driver | undefined;
const log = path.join(work, "app.log");
try {
  // --dev-bundle renders development-only UI (__DEV__), such as the Developer menu's status.
  await app.open({ dev: values["dev-bundle"], label: "Bundling Kitchen Sink JavaScript" });
  driver = await app.launch({ locale: values.locale, log: processLog(log) });
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
  await app.close();
  rmSync(work, { recursive: true, force: true });
}
