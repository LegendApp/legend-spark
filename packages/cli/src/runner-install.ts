import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { run } from "./commands.ts";
import { sparkHome, readRuntime, registerRuntime } from "./local.ts";
import { architecture, type DesktopPlatform } from "./platform.ts";
import { VERSION } from "./project.ts";
import { installedRelease, type RunnerAsset } from "./release.ts";

type Dependencies = { fetch: typeof fetch; run: typeof run };
const defaults: Dependencies = { fetch: globalThis.fetch, run };
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
  let owned = false;
  for (let attempt = 0; !owned && attempt < 600; attempt++) {
    try { const fd = openSync(lock, "wx"); writeFileSync(fd, String(process.pid)); closeSync(fd); owned = true; }
    catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(readFileSync(lock, "utf8"));
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); }
        catch (probe: any) { if (probe.code === "ESRCH") rmSync(lock, { force: true }); }
      }
      await sleep(1000);
    }
  }
  if (!owned) throw new Error("Another process is installing Runner. Retry desktop launch when it finishes.");
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
      renameSync(unpacked, destination);
    }
    registerRuntime(app);
    console.log("Spark Runner installed and verified.");
    return app;
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    rmSync(lock, { force: true });
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
