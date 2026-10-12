// The gate's view of the real machine: OS target, reference-machine identity, git state and code signatures.
import { execFileSync, spawnSync } from "node:child_process";
import { hostname, machine, release } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { macOSArchitecture, windowsArchitecture } from "../../../packages/cli/src/platform.ts";
import { readSdkSurface } from "../../api-surface.ts";
import { AUDIT_STEPS } from "../audit/bundle.ts";
import { runningApps } from "../app-state.ts";
import { plist } from "../kitchen-sink.ts";
import { BACKENDS } from "../runner/run.ts";
import type { GateEnv } from "./gate.ts";
import type { Signer, SignoffEnv } from "./signoff.ts";
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
  audit: (name, options) => AUDIT_STEPS[name](options),
  surface: readSdkSurface,
  stdout: line => console.log(line),
  stderr: line => console.error(line),
});

/** git user.name and user.email; both must be set, because the sign-off names the person. */
function signer(): Signer {
  const config = (key: string) => spawnSync("git", ["config", key], { cwd: repo, encoding: "utf8" }).stdout.trim();
  const [name, email] = [config("user.name"), config("user.email")];
  if (!name || !email) throw new Error("set git config user.name and user.email: a sign-off names the person who signed");
  return { name, email, machine: `${hostname()} (${detectHost().model ?? `${process.platform}/${machine()}`})` };
}

async function ask(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return await prompt.question(question); } finally { prompt.close(); }
}

/**
 * Opens a new instance of the app through LaunchServices, so it is a normal, focused app, and waits for it to quit. The
 * release build runs with its real state and its single-instance lock (docs/app.md#single-instance): a second launch
 * would forward itself to a running one and quit, so this refuses while one runs.
 */
async function launch(app: string, session: string) {
  if (process.platform !== "darwin") throw new Error("gate:signoff opens the app on macOS only; Windows has no sign-off launcher yet");
  const bundleId = plist(app, "CFBundleIdentifier"), running = runningApps(bundleId);
  if (running.length) throw new Error(`quit the running ${bundleId} first: a second launch of it forwards itself to the running one and quits, so the checklist would not open (running: ${running.join(", ")})`);
  const result = spawnSync("open", ["-W", "-n", "-a", app, "--args", "--ks-signoff", session], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`open exited ${result.status ?? result.signal}`);
}

export const signoffEnv = (): SignoffEnv => ({ ...hostEnv(), signer, interactive: !!process.stdin.isTTY && !!process.stdout.isTTY, ask, launch });
