// The Kitchen Sink under test, launched in driver mode (docs/test-driver.md). Shared by `ks:capture` and the
// runner's driver backend: which app to launch, the JavaScript a dev build needs, and the launch itself.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { binary, run } from "../../packages/cli/src/commands.ts";
import type { ProcessLog } from "../../packages/cli/src/process.ts";
import { entryFile, prepareConfig, readJson, stateFile } from "../../packages/cli/src/project.ts";
import { launchDriver, type Driver } from "./driver.ts";

export const KITCHEN_SINK = path.resolve(import.meta.dirname, "../../examples/kitchen-sink");
export const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)*$/;

const plist = (app: string, key: string) =>
  execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim();

type Resolved = { app: string; executable: string; bundleId: string; embedded: boolean };

/**
 * An app bundle in driver mode. A release build (`Contents/Resources/main.jsbundle`) runs its embedded JavaScript.
 * A dev build loads JavaScript over HTTP, so `open()` bundles the current Kitchen Sink source once (no Metro) and
 * serves it on 127.0.0.1 until `close()`.
 */
export class KitchenSinkApp {
  private resolved?: Resolved;
  private bundle?: Buffer;
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
    return {
      app, executable: path.join(app, "Contents/MacOS", plist(app, "CFBundleExecutable")), bundleId: plist(app, "CFBundleIdentifier"),
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
          "--bundle-output", file, "--dev", "false", "--minify", "false", "--max-workers", "2"], { env: { CI: "1" }, capture: !label, label });
        this.bundle = readFileSync(file);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
    const bundle = this.bundle;
    const server = createServer((request, response) => {
      if (new URL(request.url ?? "/", "http://127.0.0.1").pathname === "/index.bundle") {
        response.writeHead(200, { "Content-Type": "application/javascript" }).end(bundle);
        return;
      }
      console.error(`Kitchen Sink: the app requested ${request.url}, which is not served`);
      response.writeHead(404).end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
    return resolved;
  }

  /** Launches the app in driver mode. `locale` sets the app's language and region formats through launch arguments. */
  launch(options: { locale?: string; log: ProcessLog }): Promise<Driver> {
    if (options.locale !== undefined && !LOCALE.test(options.locale)) throw new Error(`${options.locale} is not a language identifier such as ar or en-US`);
    const locale = options.locale ? ["-AppleLanguages", `(${options.locale})`, "-AppleLocale", options.locale] : [];
    const resolved = this.resolved;
    if (!resolved || (!resolved.embedded && !this.server)) throw new Error("KitchenSinkApp.open() must run before launch()");
    if (resolved.embedded) return launchDriver({ executable: resolved.executable, args: locale, log: options.log });
    const port = (this.server!.address() as AddressInfo).port;
    return launchDriver({
      executable: resolved.executable,
      // RCT_jsLocation points React Native's packager connection at the same server as the bundle URL.
      args: ["-RCT_jsLocation", `127.0.0.1:${port}`, ...locale],
      env: { SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=false&minify=false` },
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
