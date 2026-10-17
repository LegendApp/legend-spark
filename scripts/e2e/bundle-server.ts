// What a dev build of the Kitchen Sink loads over HTTP under the driver, without Metro (scripts/e2e/kitchen-sink.ts):
// the app's bundle, the Runtimes worker entry isolated runtimes load, their source maps, and Metro's /symbolicate.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sourceMap } from "../testing/source-map.ts";

/** `app`: the app's entry (/index.bundle). `worker`: the entry isolated runtimes load (/.threaded-runtime/entry.bundle). */
export type Entry = "app" | "worker";
/** A bundle and its source map (v3, as `--sourcemap-output` writes it). */
export type Bundle = { code: Buffer; map: Buffer };
/** Builds `entry` with or without `__DEV__`. */
export type Bundler = (entry: Entry, dev: boolean) => Promise<Bundle>;
/** A stack frame as React Native posts it to /symbolicate: lines from 1, columns from 0. */
type Frame = { file?: unknown; lineNumber?: unknown; column?: unknown; methodName?: unknown };

const ROUTES: Readonly<Record<string, { entry: Entry; part: "code" | "map" }>> = {
  "/index.bundle": { entry: "app", part: "code" },
  "/index.map": { entry: "app", part: "map" },
  "/.threaded-runtime/entry.bundle": { entry: "worker", part: "code" },
  "/.threaded-runtime/entry.map": { entry: "worker", part: "map" },
};
const PATHS: Readonly<Record<Entry, string>> = { app: "/index.bundle", worker: "/.threaded-runtime/entry.bundle" };
const NAMES: Readonly<Record<Entry, string>> = { app: "the app's bundle", worker: "the Runtimes worker entry" };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

type Build = { bundle: Bundle; lookup?: ReturnType<typeof sourceMap> };

/**
 * Serves one mode at a time (`serve(dev)`) on 127.0.0.1. Each entry is built once per mode: concurrent requests share
 * one build, and a failed build is reported and retried by the next request. `prebundle` starts a build in the
 * background, so a later request finds it done; it never replaces the request's own build.
 */
export class BundleServer {
  private readonly builds = new Map<string, Promise<Build>>();
  private server?: Server;
  private dev?: boolean;

  /** `report` receives every failure (stderr by default); none is silent. */
  constructor(private readonly bundler: Bundler, private readonly report: (line: string) => void = line => console.error(line)) {}

  /** `entry` for `dev`, built on first use. */
  build(entry: Entry, dev: boolean): Promise<Build> {
    const key = `${entry}:${dev}`;
    let build = this.builds.get(key);
    if (!build) {
      build = this.bundler(entry, dev).then(bundle => ({ bundle }));
      this.builds.set(key, build);
      build.catch(() => { if (this.builds.get(key) === build) this.builds.delete(key); });
    }
    return build;
  }

  /** Starts building `entry` for `dev` in the background; a failure is reported, and the app's request builds it again. */
  prebundle(entry: Entry, dev: boolean) {
    this.build(entry, dev).catch((error: unknown) =>
      this.report(`Kitchen Sink: prebundling ${NAMES[entry]} (${dev ? "development" : "production"}) failed; the app's request bundles it again: ${message(error)}`));
  }

  /** Serves `dev`'s bundles (building the app's first) and returns the port. */
  async serve(dev: boolean): Promise<number> {
    await this.build("app", dev);
    this.dev = dev;
    if (!this.server) {
      const server = createServer((request, response) => {
        this.respond(request).then(({ status, type, body }) => response.writeHead(status, type ? { "Content-Type": type } : {}).end(body), (error: unknown) => {
          this.report(`Kitchen Sink: answering ${request.method} ${request.url} failed: ${message(error)}`);
          response.writeHead(500, { "Content-Type": "text/plain" }).end(message(error));
        });
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      this.server = server;
    }
    return (this.server.address() as AddressInfo).port;
  }

  private async respond(request: IncomingMessage): Promise<{ status: number; type?: string; body?: Buffer | string }> {
    const dev = this.dev;
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const route = ROUTES[pathname];
    if (dev !== undefined && route && request.method === "GET") {
      const { bundle } = await this.build(route.entry, dev);
      if (route.part === "map") return { status: 200, type: "application/json", body: bundle.map };
      const url = new URL(request.url!, `http://${request.headers.host ?? "127.0.0.1"}`);
      return { status: 200, type: "application/javascript", body: located(bundle.code, url) };
    }
    if (dev !== undefined && pathname === "/symbolicate" && request.method === "POST") {
      let stack: unknown;
      try { stack = (JSON.parse(await body(request)) as { stack?: unknown })?.stack; } catch { /* answered below */ }
      if (!Array.isArray(stack)) return { status: 400, type: "text/plain", body: "/symbolicate takes a JSON body with a stack array" };
      return { status: 200, type: "application/json", body: JSON.stringify({ stack: await this.symbolicate(stack as Frame[], dev), codeFrame: null }) };
    }
    this.report(`Kitchen Sink: the app requested ${request.method} ${request.url}, which is not served`);
    return { status: 404 };
  }

  /**
   * Metro's /symbolicate: each frame in a served bundle mapped to its source (file, line from 1, column from 0). A
   * position in a served bundle its map does not cover (module wrappers) answers `lineNumber: null`; other frames are
   * returned as they came.
   */
  private async symbolicate(stack: Frame[], dev: boolean) {
    return Promise.all(stack.map(async frame => {
      const entry = typeof frame.file === "string" && /^https?:/.test(frame.file) ? (Object.keys(PATHS) as Entry[]).find(name => new URL(frame.file as string).pathname === PATHS[name]) : undefined;
      if (!entry || typeof frame.lineNumber !== "number" || typeof frame.column !== "number") return frame;
      const build = await this.build(entry, dev);
      build.lookup ??= sourceMap(JSON.parse(build.bundle.map.toString("utf8")));
      const original = build.lookup.original(frame.lineNumber - 1, frame.column);
      return original ? { ...frame, file: original.source, lineNumber: original.line + 1, column: original.column } : { ...frame, lineNumber: null, column: null };
    }));
  }

  /** Stops serving; waits for builds in progress, so no bundler outlives the server. Builds are kept for the next `serve`. */
  async close() {
    const server = this.server;
    this.server = undefined;
    this.dev = undefined;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await Promise.allSettled(this.builds.values());
  }
}

/**
 * The bundle as Metro's server sends it: its trailing sourceURL and sourceMappingURL comments name the URL it was
 * requested at and the map's next to it (`.map` for `.bundle`). Stacks, profiles and DevTools name frames by sourceURL,
 * which `export:embed` sets to a Metro URL that nothing serves, or leaves out.
 */
function located(code: Buffer, url: URL): Buffer {
  const map = new URL(url.href);
  map.pathname = map.pathname.replace(/\.bundle$/, ".map");
  // The comments follow the last module, so only the tail is searched, from a line start (never inside a character).
  const start = Math.max(0, code.indexOf(10, Math.max(0, code.length - 4096)) + 1), tail = code.subarray(start).toString("utf8")
    .replace(/^\/\/# source(Mapping)?URL=.*\n?/gm, "").replace(/\n?$/, "\n");
  return Buffer.concat([code.subarray(0, start), Buffer.from(`${tail}//# sourceMappingURL=${map.href}\n//# sourceURL=${url.href}\n`)]);
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
