import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run } from "./commands.ts";
import { createRequire } from "node:module";
const { identity } = createRequire(import.meta.url)("@legendapp/spark-desktop-config/identity.cjs");

/** Restore app-owned values after Expo Desktop's template string replacement. */
export async function restoreNativeMetadata(root: string, config: any, execute = run) {
  const overrides = { ...config.macos?.infoPlist, ...identity(config) };
  const nativeRoot = path.join(root, "macos");
  const matches: { file: string; info: Record<string, unknown> }[] = [];
  for (const entry of readdirSync(nativeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(nativeRoot, entry.name, "Info.plist");
    if (!existsSync(file)) continue;
    const info = JSON.parse(await execute(root, ["plutil", "-convert", "json", "-o", "-", file], { capture: true }));
    if ("SparkProjectIdentifier" in info) matches.push({ file, info });
  }
  if (matches.length !== 1) throw new Error(`Expected one generated Spark Info.plist, found ${matches.length}`);
  const { file, info } = matches[0]!;
  writeFileSync(file, JSON.stringify({ ...info, ...overrides }));
  await execute(root, ["plutil", "-convert", "xml1", file], { capture: true });
}
