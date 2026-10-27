// The Kitchen Sink under test, launched in driver mode (docs/test-driver.md). Shared by `ks:capture` and the
// runner's driver backend: which app to launch, the JavaScript a dev build needs, and the launch itself.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { binary, run } from "../../packages/cli/src/commands.ts";
import type { ProcessLog } from "../../packages/cli/src/process.ts";
import { entryFile, prepareConfig, readJson, stateFile } from "../../packages/cli/src/project.ts";
import { clearAppState, type AppIdentity } from "./app-state.ts";
import { DRIVER_ENV, launchDriver, type Driver } from "./driver.ts";
import { readManifest } from "./gate/plan.ts";

export const KITCHEN_SINK = path.resolve(import.meta.dirname, "../../examples/kitchen-sink");
export const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)*$/;

const JS_LOCATION = "-RCT_jsLocation", BUNDLE_URL = "SPARK_BUNDLE_URL";
const plist = (app: string, key: string) =>
  execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim();
/** An optional Info.plist string: undefined when the key is absent. */
const plistValue = (app: string, key: string) => {
  const result = spawnSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" });
  if (result.status === 0) return result.stdout.trim();
  if (result.stderr.includes("No value at that key path")) return undefined;
  throw new Error(`plutil could not read ${key} from ${app}: ${result.stderr.trim()}`);
};

type Resolved = { app: string; executable: string; embedded: boolean } & AppIdentity;

/**
 * An app bundle in driver mode. A release build (`Contents/Resources/main.jsbundle`) runs its embedded JavaScript.
 * A dev build loads JavaScript over HTTP, so `open()` bundles the current Kitchen Sink source once (no Metro) and
 * serves it on 127.0.0.1 until `close()`.
 */
export class KitchenSinkApp {
  private resolved?: Resolved;
  private bundle?: Buffer;
  /** Asset files by URL path (`/assets/…`), as a dev server serves fonts and images. */
  private assets = new Map<string, Buffer>();
  private server?: Server;

  /** `app` is a `.app` bundle; without it, the last dev build (`cd examples/kitchen-sink && bun run rebuild:macos`). It is resolved by `open()`. */
  constructor(private readonly appPath?: string) {}

  private resolve(): Resolved {
    let app = this.appPath;
    if (!app) {
      const receipt = stateFile(KITCHEN_SINK, "dev-build.json");
      if (!existsSync(receipt)) throw new Error("Build the Kitchen Sink first: cd examples/kitchen-sink && bun run rebuild:macos");
      app = readJson(receipt).app as string;
    }
    if (!existsSync(path.join(app, "Contents/Info.plist"))) throw new Error(`${app} is not a macOS app bundle`);
    const bundleId = plist(app, "CFBundleIdentifier");
    return {
      app, executable: path.join(app, "Contents/MacOS", plist(app, "CFBundleExecutable")), bundleId,
      // The host falls back to the bundle identifier the same way (SparkContext in SparkDesktop.mm).
      projectId: plistValue(app, "SparkProjectIdentifier") ?? bundleId,
      sandboxed: /<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\/>/.test(execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", app], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })),
      embedded: existsSync(path.join(app, "Contents/Resources/main.jsbundle")),
    };
  }

  /** Resolves the app, then bundles (first call only) and serves the JavaScript a dev build loads. A release build needs neither. */
  async open(label?: string): Promise<{ app: string; bundleId: string }> {
    const resolved = this.resolved ??= this.resolve();
    if (resolved.embedded || this.server) return resolved;
    if (!this.bundle) {
      const work = mkdtempSync(path.join(os.tmpdir(), "ks-bundle-"));
      try {
        const file = path.join(work, "index.bundle");
        prepareConfig(KITCHEN_SINK);
        await run(KITCHEN_SINK, [binary(KITCHEN_SINK, "expo"), "export:embed", "--platform", "macos", "--entry-file", path.resolve(KITCHEN_SINK, entryFile(KITCHEN_SINK)),
          "--bundle-output", file, "--assets-dest", work, "--dev", "false", "--minify", "false", "--max-workers", "2"], { env: { CI: "1" }, capture: !label, label });
        this.bundle = readFileSync(file);
        const assets = path.join(work, "assets");
        if (existsSync(assets)) for (const name of readdirSync(assets, { recursive: true, withFileTypes: true }))
          if (name.isFile()) this.assets.set("/" + path.relative(work, path.join(name.parentPath, name.name)).split(path.sep).join("/"), readFileSync(path.join(name.parentPath, name.name)));
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
    const bundle = this.bundle;
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/index.bundle") {
        response.writeHead(200, { "Content-Type": "application/javascript" }).end(bundle);
        return;
      }
      const asset = this.assets.get(decodeURIComponent(pathname));
      if (asset) {
        response.writeHead(200).end(asset);
        return;
      }
      console.error(`Kitchen Sink: the app requested ${request.url}, which is not served`);
      response.writeHead(404).end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
    return resolved;
  }

  /** Deletes the app's persisted state (`clearAppState`), allowing only the gate manifest's app. Returns what existed. */
  async clearState(): Promise<string[]> {
    if (!this.resolved) throw new Error("KitchenSinkApp.open() must run before clearState()");
    return clearAppState(this.resolved, readManifest(path.join(KITCHEN_SINK, "../../e2e")).appId);
  }

  /** What `launch` sets itself; a flow's own arguments and environment may not repeat it. `locale` only applies with a locale. */
  readonly reserved = { arguments: [JS_LOCATION], env: [DRIVER_ENV, BUNDLE_URL], locale: ["-AppleLanguages", "-AppleLocale"] } as const;

  /**
   * Launches the app in driver mode with the caller's `arguments` (after its own) and `env`. `locale` sets the app's
   * language and region formats through launch arguments.
   */
  launch(options: { locale?: string; arguments?: readonly string[]; env?: Readonly<Record<string, string>>; log: ProcessLog }): Promise<Driver> {
    if (options.locale !== undefined && !LOCALE.test(options.locale)) throw new Error(`${options.locale} is not a language identifier such as ar or en-US`);
    const [languages, region] = this.reserved.locale;
    const locale = options.locale ? [languages, `(${options.locale})`, region, options.locale] : [];
    const resolved = this.resolved;
    if (!resolved || (!resolved.embedded && !this.server)) throw new Error("KitchenSinkApp.open() must run before launch()");
    const extra = options.arguments ?? [];
    if (resolved.embedded) return launchDriver({ executable: resolved.executable, args: [...locale, ...extra], env: options.env, log: options.log });
    const port = (this.server!.address() as AddressInfo).port;
    return launchDriver({
      executable: resolved.executable,
      // RCT_jsLocation points React Native's packager connection at the same server as the bundle URL.
      args: [JS_LOCATION, `127.0.0.1:${port}`, ...locale, ...extra],
      env: { ...options.env, [BUNDLE_URL]: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=false&minify=false` },
      log: options.log,
    });
  }

  /** Stops serving JavaScript; the bundle is kept for the next `open()`. */
  async close() {
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
