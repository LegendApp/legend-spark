// The Kitchen Sink under test, launched in driver mode (docs/test-driver.md). Shared by `ks:capture` and the
// runner's driver backend: which app to launch, the JavaScript a dev build needs, and the launch itself.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { binary, run } from "../../packages/cli/src/commands.ts";
import type { ProcessLog } from "../../packages/cli/src/process.ts";
import { entryFile, prepareConfig, readJson, stateFile } from "../../packages/cli/src/project.ts";
import { DriverState, exactState, macHost, preserveDefaults, STATE_ENV, type AppIdentity, type AppState, type StateHost, type StateMode } from "./app-state.ts";
import { DRIVER_ENV, launchDriver, type Driver } from "./driver.ts";
import { readManifest } from "./gate/plan.ts";

export const KITCHEN_SINK = path.resolve(import.meta.dirname, "../../examples/kitchen-sink");
export const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)*$/;

const JS_LOCATION = "-RCT_jsLocation", BUNDLE_URL = "SPARK_BUNDLE_URL";
/**
 * Host settings AppKit renders from or Spark reports, pinned for every driver launch in the app's argument domain (launch
 * arguments), so captures and flows do not depend on the Mac's settings. Nothing outside the launched process changes.
 * docs/test-driver.md#pinned-host-settings lists what each pins and what cannot be pinned.
 */
const PINNED_DEFAULTS: Readonly<Record<string, string>> = {
  NSRequiresAquaSystemAppearance: "YES",
  AppleReduceDesktopTinting: "YES",
  AppleAccentColor: "4",
  AppleHighlightColor: "0.698039 0.843137 1.000000 Blue",
  increaseContrast: "NO",
  reduceTransparency: "NO",
  differentiateWithoutColor: "NO",
  AppleShowScrollBars: "WhenScrolling",
  AppleFontSmoothing: "2",
  reduceMotion: "NO",
  AppleInterfaceStyle: "Light",
  AppleInterfaceStyleSwitchesAutomatically: "NO",
};
/** The driven process's time zone, so JavaScript's Date and Intl match the system module's fixed `timeZone` (docs/system.md#testing-system-events). */
const PINNED_ENV: Readonly<Record<string, string>> = { TZ: "UTC" };
const PINNED = Object.entries(PINNED_DEFAULTS).flatMap(([key, value]) => [`-${key}`, value]);
export const plist = (app: string, key: string) =>
  execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim();
/** An optional Info.plist string: undefined when the key is absent. */
const plistValue = (app: string, key: string) => {
  const result = spawnSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" });
  if (result.status === 0) return result.stdout.trim();
  if (result.stderr.includes("No value at that key path")) return undefined;
  throw new Error(`plutil could not read ${key} from ${app}: ${result.stderr.trim()}`);
};

type Resolved = { app: string; executable: string; embedded: boolean } & AppIdentity;

/** Bundles one Kitchen Sink entry for macOS without Metro's server. Output shows only with a `label`. */
async function exportBundle(entry: string, dev: boolean, label: string | undefined): Promise<Buffer> {
  const work = mkdtempSync(path.join(os.tmpdir(), "ks-bundle-"));
  try {
    const file = path.join(work, "index.bundle");
    await run(KITCHEN_SINK, [binary(KITCHEN_SINK, "expo"), "export:embed", "--platform", "macos", "--entry-file", entry,
      "--bundle-output", file, "--dev", String(dev), "--minify", "false", "--max-workers", "2"], { env: { CI: "1" }, capture: !label, label });
    return readFileSync(file);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * An app bundle in driver mode. `open()` starts a driver session (docs/e2e-flows.md#app-state), which every launch runs
 * until `close()` ends it: with `state: "isolated"` (the default) a clone of the app with its own identity and state
 * (`DriverState`), with `exact` (the release gate) the app itself and its real state.
 * A release build (`Contents/Resources/main.jsbundle`) runs its embedded JavaScript.
 * A dev build loads JavaScript over HTTP, so `open()` bundles the current Kitchen Sink source (no Metro), once per
 * mode, and serves it on 127.0.0.1 until `close()`. The Runtimes worker entry (`.threaded-runtime/entry.bundle`) that
 * isolated runtimes load is bundled on its first request, once per mode. The default bundle is built without `__DEV__`; `{ dev: true }`
 * serves a development bundle (`__DEV__` code such as the Developer menu, LogBox), for `build: dev` flows. With
 * `devServer` (a running `spark dev` origin such as http://127.0.0.1:8081), a dev build loads development JavaScript
 * from that server instead, with its inspector proxy (React Native DevTools).
 */
export class KitchenSinkApp {
  private resolved?: Resolved;
  private readonly bundles = new Map<boolean, Buffer>();
  private readonly workerBundles = new Map<boolean, Promise<Buffer>>();
  private served?: { dev: boolean; bundle: Buffer };
  private server?: Server;
  private state?: AppState;

  /**
   * `app` is a `.app` bundle; without it, the last dev build (`cd examples/kitchen-sink && bun run rebuild:macos`). It is
   * resolved by `open()`. `host` is where the session keeps its state (tests pass scratch directories).
   */
  constructor(private readonly appPath?: string, private readonly devServer?: URL, private readonly mode: StateMode = "isolated", private readonly host: StateHost = macHost()) {}

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

  /**
   * Resolves the app, bundles (first call per mode only) and serves the JavaScript a dev build loads (a release build
   * needs neither), then starts a driver session. `bundleId` is the app's; `launchedBundleId` is what the launched
   * process registers as (the clone's identity in an isolated session). `release`: the app embeds its JavaScript.
   */
  async open(options: { dev?: boolean; label?: string } = {}): Promise<{ app: string; release: boolean; bundleId: string; launchedBundleId: string }> {
    const resolved = this.resolved ??= this.resolve();
    await this.serve(resolved, options.dev ?? false, options.label);
    this.state ??= this.mode === "exact"
      ? exactState(resolved.app, resolved, readManifest(path.join(KITCHEN_SINK, "../../e2e")).appId, this.host)
      : DriverState.create(resolved.app, resolved, this.host);
    return { app: resolved.app, release: resolved.embedded, bundleId: resolved.bundleId, launchedBundleId: this.state.identity.bundleId };
  }

  private async serve(resolved: Resolved, dev: boolean, label: string | undefined) {
    if (resolved.embedded) {
      if (dev || this.devServer) throw new Error(`${resolved.app} embeds a release bundle; development JavaScript needs a dev build (cd examples/kitchen-sink && bun run rebuild:macos)`);
      return;
    }
    if (this.devServer) return;
    let bundle = this.bundles.get(dev);
    if (!bundle) {
      prepareConfig(KITCHEN_SINK);
      bundle = await exportBundle(path.resolve(KITCHEN_SINK, entryFile(KITCHEN_SINK)), dev, label);
      this.bundles.set(dev, bundle);
    }
    this.served = { dev, bundle };
    if (this.server) return;
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/index.bundle") {
        response.writeHead(200, { "Content-Type": "application/javascript" }).end(this.served!.bundle);
        return;
      }
      if (pathname === "/.threaded-runtime/entry.bundle" && this.served) {
        this.workerBundle(this.served.dev).then(worker => response.writeHead(200, { "Content-Type": "application/javascript" }).end(worker), (error: unknown) => {
          console.error(`Kitchen Sink: bundling the Runtimes worker entry failed: ${error instanceof Error ? error.message : String(error)}`);
          response.writeHead(500).end();
        });
        return;
      }
      console.error(`Kitchen Sink: the app requested ${request.url}, which is not served`);
      response.writeHead(404).end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
  }

  /**
   * The worker entry for `dev`, bundled on first use (most launches never start an isolated runtime). Loading Metro's
   * config for the app's bundle generated the entry. Concurrent requests share one build; a failed build is retried.
   */
  private workerBundle(dev: boolean): Promise<Buffer> {
    let worker = this.workerBundles.get(dev);
    if (!worker) {
      worker = exportBundle(path.join(KITCHEN_SINK, ".threaded-runtime/entry.js"), dev, undefined);
      this.workerBundles.set(dev, worker);
      worker.catch(() => { if (this.workerBundles.get(dev) === worker) this.workerBundles.delete(dev); });
    }
    return worker;
  }

  /** Deletes the driver session's state (an isolated session never touches the app's own). Returns what existed. */
  async clearState(): Promise<string[]> {
    if (!this.state) throw new Error("KitchenSinkApp.open() must run before clearState()");
    return this.state.clear();
  }

  /**
   * `preserveDefaults` for the domain the launched app uses: the isolated session's `<id>.driver` copy, or in exact
   * mode the app's own identifier. Only the gate manifest's app (or its copy) is allowed.
   */
  async preserveDefaults(keys: readonly string[]): Promise<() => void> {
    if (!this.state) throw new Error("KitchenSinkApp.open() must run before preserveDefaults()");
    return preserveDefaults(this.state.identity.bundleId, keys, readManifest(path.join(KITCHEN_SINK, "../../e2e")).appId);
  }

  /** What `launch` sets itself; a flow's own arguments and environment may not repeat it. `locale` only applies with a locale. */
  readonly reserved = { arguments: [JS_LOCATION], env: [DRIVER_ENV, BUNDLE_URL, ...STATE_ENV], locale: ["-AppleLanguages", "-AppleLocale"] } as const;

  /**
   * Launches the driver session's app in driver mode with its state environment, `PINNED_ENV` and `PINNED_DEFAULTS`, then the
   * caller's `arguments` (after its own, so the last value of a key wins) and `env`. `locale` sets the app's language and region formats through launch arguments.
   */
  launch(options: { locale?: string; arguments?: readonly string[]; env?: Readonly<Record<string, string>>; log: ProcessLog }): Promise<Driver> {
    if (options.locale !== undefined && !LOCALE.test(options.locale)) throw new Error(`${options.locale} is not a language identifier such as ar or en-US`);
    const [languages, region] = this.reserved.locale;
    const locale = options.locale ? [languages, `(${options.locale})`, region, options.locale] : [];
    const resolved = this.resolved, state = this.state;
    if (!resolved || !state || (!resolved.embedded && !this.served && !this.devServer)) throw new Error("KitchenSinkApp.open() must run before launch()");
    const extra = options.arguments ?? [];
    const executable = path.join(state.app, path.relative(resolved.app, resolved.executable)), env = { ...PINNED_ENV, ...options.env, ...state.env };
    if (resolved.embedded) return launchDriver({ executable, args: [...PINNED, ...locale, ...extra], env, log: options.log });
    if (this.devServer) return launchDriver({
      executable,
      // React Native's packager and inspector connections use RCT_jsLocation; the bundle comes from the server.
      args: [JS_LOCATION, this.devServer.host, ...PINNED, ...locale, ...extra],
      env: { ...env, [BUNDLE_URL]: new URL("/index.bundle?platform=macos&dev=true&minify=false", this.devServer).href },
      log: options.log,
    });
    const port = (this.server!.address() as AddressInfo).port;
    return launchDriver({
      executable,
      // RCT_jsLocation points React Native's packager connection at the same server as the bundle URL.
      args: [JS_LOCATION, `127.0.0.1:${port}`, ...PINNED, ...locale, ...extra],
      env: { ...env, [BUNDLE_URL]: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=${this.served!.dev}&minify=false` },
      log: options.log,
    });
  }

  /**
   * Stops serving JavaScript and ends the driver session (an isolated one deletes its clone and state); the bundles are
   * kept for the next `open()`. Waits for a worker entry build in progress, so no bundler outlives the session.
   */
  async close() {
    const server = this.server, state = this.state, workers = [...this.workerBundles.values()];
    this.server = undefined;
    this.served = undefined;
    this.state = undefined;
    try { await state?.dispose(); } finally {
      if (server) await new Promise<void>(resolve => server.close(() => resolve()));
      await Promise.allSettled(workers);
    }
  }
}
