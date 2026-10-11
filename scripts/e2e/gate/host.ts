// The gate's view of the real machine: OS target, reference-machine identity, git state and code signatures.
import { execFileSync, spawnSync } from "node:child_process";
import { machine, release } from "node:os";
import path from "node:path";
import { macOSArchitecture, windowsArchitecture } from "../../../packages/cli/src/platform.ts";
import { readSdkSurface } from "../../api-surface.ts";
import { BACKENDS } from "../runner/run.ts";
import type { GateEnv } from "./gate.ts";
import type { Host } from "./plan.ts";

const repo = path.resolve(import.meta.dirname, "../../..");
const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: repo, encoding: "utf8" }).trim();

/** The OS-reported CPU, not the process's (which may run under emulation), ignoring the SPARK_*_ARCH build overrides. */
export function detectHost(): Host {
  if (process.platform === "darwin") {
    return {
      os: `macos-${run("sw_vers", ["-productVersion"]).split(".")[0]}`,
      arch: macOSArchitecture(machine(), {}),
      model: run("sysctl", ["-n", "hw.model"]),
      memoryGB: Math.round(Number(run("sysctl", ["-n", "hw.memsize"])) / 2 ** 30),
    };
  }
  if (process.platform === "win32") return { os: Number(release().split(".")[2]) >= 22000 ? "windows-11" : "windows-10", arch: windowsArchitecture(process.platform, machine(), { ...process.env, SPARK_WINDOWS_ARCH: undefined }) };
  throw new Error(`the release gate runs on macOS or Windows, not ${process.platform}`);
}

/** macOS: `codesign --verify --deep --strict`. Windows signatures are not verified yet, so asking for it fails. */
function verifySignature(artifact: string): string | undefined {
  if (process.platform !== "darwin") return "verifying Windows signatures is not implemented";
  const result = spawnSync("codesign", ["--verify", "--deep", "--strict", artifact], { encoding: "utf8" });
  return result.status === 0 ? undefined : (result.stderr || result.error?.message || `codesign exited ${result.status}`).trim();
}

export const hostEnv = (): GateEnv => ({
  backends: BACKENDS,
  host: detectHost,
  source: () => ({ commit: run("git", ["rev-parse", "HEAD"]), dirty: run("git", ["status", "--porcelain"]) !== "" }),
  verifySignature,
  surface: readSdkSurface,
  stdout: line => console.log(line),
  stderr: line => console.error(line),
});
