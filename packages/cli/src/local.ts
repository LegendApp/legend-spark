import { installedRelease } from "./release.ts";
import { architecture, type DesktopPlatform } from "./platform.ts";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { digest, incompatible, readJson, VERSION, writeJson, type NativePackage, type Runtime } from "./project.ts";

export function sparkHome() {
  return path.resolve(process.env.SPARK_HOME ?? path.join(os.homedir(), ".spark"));
}

export function findFramework(start = import.meta.dirname): string | undefined {
  let dir = path.resolve(start);
  while (true) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg) && readJson(pkg).name === "spark-workspace") return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function findProject(start: string): string {
  let dir = path.resolve(start);
  while (true) {
    if ((existsSync(path.join(dir, "app.json")) || existsSync(path.join(dir, "desktop.config.json"))) && existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("No spark app found. Run this command inside your app, or create one with spark create MyApp.");
    dir = parent;
  }
}

export function readRuntime(app: string): Runtime | undefined {
  try {
    const windows = existsSync(path.join(app, "spark-runtime.json"));
    const runtime = readJson(path.join(app, windows ? "spark-runtime.json" : "Contents/Resources/spark-runtime.json"));
    if (runtime.schema !== 1 || runtime.framework !== VERSION || !["macos", "windows"].includes(runtime.platform) || !["arm64", "x64"].includes(runtime.arch) || !runtime.modules || typeof runtime.modules !== "object" || typeof runtime.fingerprint !== "string") return undefined;
    if (!existsSync(path.join(app, windows ? "MyApp.exe" : "Contents/MacOS")) || windows !== (runtime.platform === "windows")) return undefined;
    return runtime;
  } catch { return undefined; }
}

export function registerRuntime(app: string) {
  app = path.resolve(app);
  const runtime = readRuntime(app);
  if (!runtime || runtime.mode !== "go") throw new Error(`Not a compatible Spark Runner: ${app}`);
  // One record per path preserves multiple local builds of the same SDK.
  writeJson(path.join(sparkHome(), "runtimes", `${digest(app)}.json`), { app });
  return { app, runtime };
}

export function registerPackages(manifest: string) {
  manifest = path.resolve(manifest);
  const archives = readJson(manifest);
  for (const name of ["@legendapp/spark"]) {
    if (typeof archives[name] !== "string" || !existsSync(path.resolve(path.dirname(manifest), archives[name]))) {
      throw new Error(`Missing local archive for ${name}. Run spark sdk pack in the framework checkout.`);
    }
  }
  writeJson(path.join(sparkHome(), "sdks", `${VERSION}.json`), { manifest });
  for (const name of ["SparkRunner.app", "SparkPrebuilt.app"]) {
    const savedRunner = path.resolve(path.dirname(manifest), "../runtimes", name);
    if (readRuntime(savedRunner)?.mode === "go") registerRuntime(savedRunner);
  }
  return manifest;
}

export function creationManifest(explicit?: string) {
  return !explicit && installedRelease() ? undefined : packageManifest(explicit);
}

export function packageManifest(explicit?: string) {
  if (explicit) return registerPackages(explicit);
  const framework = findFramework(process.cwd()) ?? findFramework();
  if (framework) {
    const manifest = path.join(framework, "artifacts/packages/manifest.json");
    if (existsSync(manifest)) return registerPackages(manifest);
    throw new Error("Local SDK packages have not been packed. Run spark sdk pack, then retry.");
  }
  const record = path.join(sparkHome(), "sdks", `${VERSION}.json`);
  if (existsSync(record)) return registerPackages(readJson(record).manifest);
  throw new Error(`No local SDK ${VERSION} is registered. Run spark sdk pack in the framework checkout. Public SDK downloads are not available yet.`);
}

export function findGo(required: NativePackage[], preferred?: string, platform: DesktopPlatform = "macos") {
  const apps: string[] = preferred ? [path.resolve(preferred)] : [];
  const dir = path.join(sparkHome(), "runtimes");
  if (existsSync(dir)) for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const record = readJson(path.join(dir, file));
      if (typeof record.app === "string") apps.push(record.app);
    } catch { /* Ignore stale/corrupt registry entries; never launch without validation. */ }
  }
  const candidates = [...new Set(apps)].flatMap((app) => {
    const runtime = readRuntime(app);
    return runtime?.mode === "go" && runtime.platform === platform && runtime.arch === architecture(platform) ? [{ app, runtime }] : [];
  });
  return candidates.find(({ runtime }) => incompatible(runtime, required, platform).length === 0) ?? candidates[0];
}

export async function availablePort(explicit?: number): Promise<number> {
  if (explicit !== undefined && (!Number.isInteger(explicit) || explicit < 1 || explicit > 65535)) throw new Error("Port must be an integer between 1 and 65535.");
  for (let port = explicit ?? 19120; port < (explicit === undefined ? 19220 : explicit + 1); port++) {
    const free = await new Promise<boolean>((resolve, reject) => {
      const server = createServer();
      server.once("error", (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
      // Match Metro's wildcard bind. On macOS a loopback-only bind can succeed
      // even while another process owns the wildcard IPv6 listener.
      server.listen(port, () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(explicit ? `Port ${explicit} is already in use. Omit --port to choose one automatically.` : "No development port is available between 19120 and 19219.");
}
