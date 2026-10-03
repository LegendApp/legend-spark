import { createHash } from "node:crypto";
import { closeSync, existsSync, ftruncateSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { run } from "./commands.ts";
import { sparkHome, readRuntime, registerRuntime } from "./local.ts";
import { architecture, type DesktopPlatform } from "./platform.ts";
import { VERSION } from "./project.ts";
import { installedRelease, type RunnerAsset } from "./release.ts";

type Dependencies = { fetch: typeof fetch; run: typeof run };
type RunnerLockRelease = (() => Promise<void>) & { assertAlive(): void };
const defaults: Dependencies = { fetch: globalThis.fetch, run };
function readLegacyPid(lock: string): number | undefined {
  try {
    const content = readFileSync(lock, "utf8").trim();
    if (/^\d+$/.test(content)) return Number(content);
  } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  return undefined;
}
/** The kernel releases this advisory lock if the installer exits, including on a crash. */
export async function acquireRunnerLock(lock: string, waitMs = 600_000): Promise<RunnerLockRelease> {
  const deadline = Date.now() + waitMs;
  let child: ReturnType<typeof spawn>;
  let exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  while (true) {
    if (Date.now() >= deadline) throw new Error("Another process is installing Runner. Retry desktop launch when it finishes.");
    const existingPid = readLegacyPid(lock);
    if (existingPid) {
      try {
        process.kill(existingPid, 0);
        if (Date.now() >= deadline) throw new Error("Another process is installing Runner. Retry desktop launch when it finishes.");
        await sleep(Math.min(1000, deadline - Date.now()));
        continue;
      } catch (error: any) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    const existed = existsSync(lock);
    const observed = existed ? lstatSync(lock) : undefined;
    const remaining = Math.max(1, deadline - Date.now());
    child = spawn("/usr/bin/lockf", ["-k", "-t", String(Math.max(1, Math.ceil(remaining / 1000))), lock, process.execPath, "-e", "process.stdout.write('locked\\n'); process.stdin.resume()"], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr!.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
    try {
      await new Promise<void>((resolve, reject) => {
        let output = "";
        child.stdout!.setEncoding("utf8").on("data", chunk => {
          output += chunk;
          if (output.includes("locked\n")) resolve();
        });
        child.once("error", reject);
        void exited.then(({ code }) => reject(new Error(`Could not acquire Runner install lock${stderr ? `: ${stderr.trim()}` : ` (lockf exited ${code})`}`)));
      });
    } catch (error) {
      try { process.kill(-child.pid!, "SIGTERM"); } catch {}
      await exited;
      throw error;
    }
    const stopKeeper = async () => { child.stdin!.end(); await exited; };
    let fd: number | undefined;
    try {
      const acquired = lstatSync(lock);
      if (observed && (acquired.dev !== observed.dev || acquired.ino !== observed.ino)) {
        await stopKeeper();
        continue;
      }
      const content = readFileSync(lock, "utf8").trim();
      const legacyPid = readLegacyPid(lock);
      if (legacyPid) {
        let legacyLive = false;
        try { process.kill(legacyPid, 0); legacyLive = true; }
        catch (error: any) { if (error.code !== "ESRCH") throw error; }
        if (legacyLive) {
          await stopKeeper();
          if (Date.now() >= deadline) throw new Error("Another process is installing Runner. Retry desktop launch when it finishes.");
          await sleep(Math.min(1000, deadline - Date.now()));
          continue;
        }
      } else if (!content && existed) {
        const age = Date.now() - statSync(lock).mtimeMs;
        if (age < 30_000) {
          await stopKeeper();
          if (Date.now() >= deadline) throw new Error("Another process is installing Runner. Retry desktop launch when it finishes.");
          await sleep(Math.min(1000, deadline - Date.now()));
          continue;
        }
      }
      fd = openSync(lock, "r+");
      ftruncateSync(fd, 0);
      writeFileSync(fd, `v2:${process.pid}`);
      closeSync(fd); fd = undefined;
      break;
    } catch (error) {
      if (fd !== undefined) {
        try { closeSync(fd); } catch {}
      }
      await stopKeeper();
      throw error;
    }
  }
  let released = false;
  let releasePromise: Promise<void> | undefined;
  let unexpectedExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  void exited.then(result => { if (!released) unexpectedExit = result; });
  const release = () => releasePromise ??= (async () => {
    released = true;
    child.stdin!.end();
    const result = await exited;
    if (result.code !== 0) throw new Error(`Runner install lock process exited unexpectedly (${result.signal ?? result.code}).`);
  })();
  return Object.assign(release, {
    assertAlive() {
      if (unexpectedExit) throw new Error(`Runner install lock process exited unexpectedly (${unexpectedExit.signal ?? unexpectedExit.code}).`);
    },
  });
}
export async function downloadAsset(asset: { url: string; size: number; sha256: string }, file: string, request: typeof fetch = globalThis.fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const response = await request(asset.url, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
      handle = await open(file, "w", 0o600);
      const hash = createHash("sha256");
      let bytes = 0, reported = -1;
      for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
        bytes += chunk.byteLength;
        if (bytes > asset.size) throw new Error("Download exceeds its declared size");
        hash.update(chunk);
        await handle.writeFile(chunk);
        const percent = Math.floor(bytes / asset.size * 10) * 10;
        if (percent !== reported) { console.log(`Downloading Spark Runner: ${percent}%`); reported = percent; }
      }
      if (bytes !== asset.size || hash.digest("hex") !== asset.sha256) throw new Error("Download checksum or size mismatch");
      await handle.close(); handle = undefined;
      break;
    } catch (error) {
      await handle?.close(); handle = undefined;
      rmSync(file, { force: true });
      if (attempt === 2) throw error;
      console.log(`Runner download interrupted; retrying (${attempt + 1}/2)…`);
      await sleep(500 * (attempt + 1));
    }
  }
}
async function verify(app: string, asset: RunnerAsset, deps: Dependencies) {
  const runtime = readRuntime(app);
  if (!runtime || runtime.mode !== "go" || runtime.platform !== "macos" || runtime.arch !== architecture("macos") || runtime.fingerprint !== asset.fingerprint) throw new Error("Downloaded Runner has incompatible runtime metadata");
  await deps.run(path.dirname(app), ["codesign", "--verify", "--deep", "--strict", app], { capture: true });
  const signature = await deps.run(path.dirname(app), ["codesign", "-dvvv", app], { capture: true });
  if (!signature.includes(`TeamIdentifier=${asset.teamId}\n`) || !signature.includes("Authority=Developer ID Application:")) throw new Error("Runner publisher signature does not match this SDK");
  await deps.run(path.dirname(app), ["spctl", "--assess", "--type", "execute", app], { capture: true });
}
/** A checksum-pinned, signed app is promoted atomically and registered only after validation. */
export async function installRunner(asset: RunnerAsset, cache = sparkHome(), deps: Dependencies = defaults) {
  const parent = path.join(cache, "downloads", VERSION);
  const destination = path.join(parent, asset.sha256);
  const app = path.join(destination, asset.app);
  mkdirSync(parent, { recursive: true });
  const lock = `${destination}.lock`;
  const releaseLock = await acquireRunnerLock(lock);
  let staging: string | undefined;
  try {
    if (existsSync(app)) {
      try { await verify(app, asset, deps); }
      catch { rmSync(destination, { recursive: true, force: true }); }
    }
    if (!existsSync(app)) {
      staging = mkdtempSync(path.join(parent, ".runner-"));
      const archive = path.join(staging, "runner.zip");
      await downloadAsset(asset, archive, deps.fetch);
      const unpacked = path.join(staging, "unpacked");
      mkdirSync(unpacked);
      // Only publisher-pinned bytes reach the platform extractor.
      await deps.run(staging, ["ditto", "-x", "-k", archive, unpacked], { capture: true });
      await verify(path.join(unpacked, asset.app), asset, deps);
      releaseLock.assertAlive();
      renameSync(unpacked, destination);
    }
    releaseLock.assertAlive();
    registerRuntime(app);
    console.log("Spark Runner installed and verified.");
    return app;
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    await releaseLock();
  }
}
export async function acquireRunner(platform: DesktopPlatform) {
  const release = installedRelease();
  let app: string | undefined;
  if (release) {
    const target = `${platform}-${architecture(platform)}`;
    const asset = release.runners[target];
    if (!asset) throw new Error(`This Spark release has no Runner for ${target}. Use a custom development build.`);
    if (process.platform !== "darwin") throw new Error("This release's macOS Runner requires macOS.");
    app = await installRunner(asset);
  }
  return app;
}
