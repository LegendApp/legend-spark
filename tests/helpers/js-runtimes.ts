import { createRequire } from "node:module";
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { which } from "../../packages/cli/src/process.ts";

export type RuntimeName = "node" | "bun";
const { selectRuntime } = createRequire(import.meta.url)("../../packages/cli/src/js-runtime.cjs");
export const runtimes: { name: RuntimeName; executable: string; version: string }[] = (["node", "bun"] as const).flatMap(name => {
  try { return [selectRuntime({ ...process.env, SPARK_JS_RUNTIME: name })]; }
  catch (error) {
    if (process.env.SPARK_TEST_REQUIRE_BOTH_RUNTIMES === "1") throw error;
    return [];
  }
});

export function linkCommand(executable: string, bin: string, name: string) {
  const target = path.join(bin, name + (process.platform === "win32" ? path.extname(executable) : ""));
  if (process.platform === "win32") {
    try { linkSync(executable, target); }
    catch (error: any) { if (error.code !== "EXDEV") throw error; copyFileSync(executable, target); }
  } else symlinkSync(executable, target);
}

/** No ambient /usr/bin/node or package-manager node shim can leak into a case. */
export function runtimeFixture(names: RuntimeName[] = []) {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark runtime "));
  const bin = path.join(root, "bin"); mkdirSync(bin);
  const env: NodeJS.ProcessEnv & { PATH: string; SPARK_HOME: string } = { ...process.env, PATH: bin, SPARK_JS_RUNTIME: "", SPARK_RUNTIME_DOWNLOAD: "", SPARK_HOME: path.join(root, "home") };
  // Windows environment keys are case-insensitive, including when spawning.
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = bin;
  for (const name of names) {
    const runtime = runtimes.find(runtime => runtime.name === name);
    if (!runtime) throw new Error(`Test requires a compatible ${name}`);
    linkCommand(runtime.executable, bin, name);
  }
  // Bootstrap utilities are deliberately exposed individually, without the
  // directory containing a system Node installation (common on Linux CI).
  if (process.platform !== "win32") for (const command of ["sh", "env", "dirname", "uname", "awk", "cat", "mkdir", "mktemp", "mv", "rm", "sleep", "curl", "tar", "gzip", "unzip", "shasum", "sha256sum", "find", "cp"]) {
    const executable = which(command);
    if (executable) linkCommand(executable, bin, command);
  }
  return { root, bin, env, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
