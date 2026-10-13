import { afterEach, expect, test } from "vitest";
import { BundleServer, type Bundle, type Entry } from "../scripts/e2e/bundle-server.ts";

// Line 1: column 0 maps to app.ts 1:0, column 4 to app.ts 1:4, column 6 to nothing. Line 2: column 0 maps to app.ts 2:4 (source columns carry over).
const map = (source: string) => Buffer.from(JSON.stringify({ version: 3, sources: [source], names: [], mappings: "AAAA,IAAI,E;AACA" }));
// As `export:embed` writes them: a development bundle names a Metro URL nothing serves; a production one names none.
const bundle = (entry: Entry, dev: boolean): Bundle => ({
  code: Buffer.from(`// ${entry} dev=${dev}\n//# sourceMappingURL=${entry}.map\n${dev ? "//# sourceURL=http://localhost:8081/src/index.ts.bundle?dev=true\n" : ""}//# debugId=${entry}`),
  map: map(`/src/${entry}.ts`),
});

let server: BundleServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

/** A server whose bundler records each build and fails `entry` builds while `failing` holds it. */
function start(options: { failing?: Set<string>; delay?: number } = {}) {
  const builds: string[] = [], reports: string[] = [];
  server = new BundleServer(async (entry, dev) => {
    builds.push(`${entry}:${dev}`);
    await new Promise(resolve => setTimeout(resolve, options.delay ?? 0));
    if (options.failing?.has(entry)) throw new Error(`${entry} did not bundle`);
    return bundle(entry, dev);
  }, line => reports.push(line));
  return { server, builds, reports };
}
const get = (port: number, pathname: string) => fetch(`http://127.0.0.1:${port}${pathname}`);
/** The served bundle's first line, which names the build. */
const first = async (response: Response) => (await response.text()).split("\n")[0];
const symbolicate = (port: number, body: unknown) => fetch(`http://127.0.0.1:${port}/symbolicate`, { method: "POST", body: JSON.stringify(body) });

test("serves the app's bundle, the worker entry built on its first request, and both source maps", async () => {
  const { server, builds } = start({ delay: 20 });
  const port = await server.serve(true);
  expect(builds).toEqual(["app:true"]);
  expect(await first(await get(port, "/index.bundle?platform=macos&dev=true"))).toBe("// app dev=true");
  expect(JSON.parse(await (await get(port, "/index.map?platform=macos")).text()).sources).toEqual(["/src/app.ts"]);
  const [code, sourceMap] = await Promise.all([get(port, "/.threaded-runtime/entry.bundle?platform=macos&dev=true"), get(port, "/.threaded-runtime/entry.map")]);
  expect([code.headers.get("content-type"), await first(code)]).toEqual(["application/javascript", "// worker dev=true"]);
  expect(JSON.parse(await sourceMap.text()).sources).toEqual(["/src/worker.ts"]);
  expect(builds).toEqual(["app:true", "worker:true"]);
  // Another mode builds its own bundles; a mode served before keeps its builds.
  expect(await server.serve(false)).toBe(port);
  expect(await first(await get(port, "/.threaded-runtime/entry.bundle"))).toBe("// worker dev=false");
  await server.serve(true);
  await get(port, "/.threaded-runtime/entry.bundle");
  expect(builds).toEqual(["app:true", "worker:true", "app:false", "worker:false"]);
});

test("a served bundle names the URL it was requested at and its map next to it, as Metro's server does", async () => {
  const { server } = start();
  const port = await server.serve(true), origin = `http://127.0.0.1:${port}`;
  expect(await (await get(port, "/index.bundle?platform=macos&dev=true")).text()).toBe([
    "// app dev=true", "//# debugId=app",
    `//# sourceMappingURL=${origin}/index.map?platform=macos&dev=true`, `//# sourceURL=${origin}/index.bundle?platform=macos&dev=true`, "",
  ].join("\n"));
  await server.serve(false);
  expect(await (await get(port, "/.threaded-runtime/entry.bundle?platform=macos&dev=false")).text()).toBe([
    "// worker dev=false", "//# debugId=worker",
    `//# sourceMappingURL=${origin}/.threaded-runtime/entry.map?platform=macos&dev=false`, `//# sourceURL=${origin}/.threaded-runtime/entry.bundle?platform=macos&dev=false`, "",
  ].join("\n"));
});

test("prebundling builds the worker entry before the app asks; a failed prebundle is reported and the request bundles again", async () => {
  const failing = new Set(["worker"]);
  const { server, builds, reports } = start({ failing });
  const port = await server.serve(false);
  server.prebundle("worker", false);
  await expect.poll(() => reports).toEqual(["Kitchen Sink: prebundling the Runtimes worker entry (production) failed; the app's request bundles it again: worker did not bundle"]);
  failing.clear();
  expect(await first(await get(port, "/.threaded-runtime/entry.bundle"))).toBe("// worker dev=false");
  expect(builds).toEqual(["app:false", "worker:false", "worker:false"]);
  server.prebundle("worker", false);
  await get(port, "/.threaded-runtime/entry.bundle");
  expect(builds).toHaveLength(3);
});

test("a prebundle in progress serves the request without a second build, and close waits for it", async () => {
  const { server, builds } = start({ delay: 50 });
  const port = await server.serve(true);
  server.prebundle("worker", true);
  expect(await first(await get(port, "/.threaded-runtime/entry.bundle"))).toBe("// worker dev=true");
  server.prebundle("worker", false);
  await server.close();
  expect(builds).toEqual(["app:true", "worker:true", "worker:false"]);
  await expect(get(port, "/index.bundle")).rejects.toThrow();
});

test("a failed build answers 500 and is reported; the next request builds again", async () => {
  const failing = new Set(["worker"]);
  const { server, builds, reports } = start({ failing });
  const port = await server.serve(true);
  const failed = await get(port, "/.threaded-runtime/entry.bundle");
  expect([failed.status, await failed.text()]).toEqual([500, "worker did not bundle"]);
  expect(reports).toEqual(["Kitchen Sink: answering GET /.threaded-runtime/entry.bundle failed: worker did not bundle"]);
  failing.clear();
  expect((await get(port, "/.threaded-runtime/entry.bundle")).status).toBe(200);
  expect(builds).toEqual(["app:true", "worker:true", "worker:true"]);
});

test("/symbolicate maps frames of both served bundles through their source maps, as Metro's does", async () => {
  const { server } = start();
  const port = await server.serve(true);
  const origin = `http://127.0.0.1:${port}`;
  const response = await symbolicate(port, { stack: [
    { file: `${origin}/index.bundle?platform=macos&dev=true`, lineNumber: 1, column: 5, methodName: "a" },
    { file: `${origin}/.threaded-runtime/entry.bundle?platform=macos&dev=true`, lineNumber: 2, column: 3, methodName: "b" },
    // Past the segment that maps to nothing, and a line the map does not have.
    { file: `${origin}/index.bundle?platform=macos&dev=true`, lineNumber: 1, column: 6, methodName: "c" },
    { file: `${origin}/index.bundle?platform=macos&dev=true`, lineNumber: 9, column: 0, methodName: "d" },
    { file: "[native code]", lineNumber: null, column: null, methodName: "e" },
    { file: `${origin}/other.bundle`, lineNumber: 1, column: 0, methodName: "f" },
  ] });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ codeFrame: null, stack: [
    { file: "/src/app.ts", lineNumber: 1, column: 4, methodName: "a" },
    { file: "/src/worker.ts", lineNumber: 2, column: 4, methodName: "b" },
    { file: `${origin}/index.bundle?platform=macos&dev=true`, lineNumber: null, column: null, methodName: "c" },
    { file: `${origin}/index.bundle?platform=macos&dev=true`, lineNumber: null, column: null, methodName: "d" },
    { file: "[native code]", lineNumber: null, column: null, methodName: "e" },
    { file: `${origin}/other.bundle`, lineNumber: 1, column: 0, methodName: "f" },
  ] });
  expect((await symbolicate(port, { frames: [] })).status).toBe(400);
});

test("anything else is reported and answers 404", async () => {
  const { server, reports } = start();
  const port = await server.serve(false);
  expect((await get(port, "/index.delta")).status).toBe(404);
  expect((await get(port, "/symbolicate")).status).toBe(404);
  expect(reports).toEqual(["Kitchen Sink: the app requested GET /index.delta, which is not served", "Kitchen Sink: the app requested GET /symbolicate, which is not served"]);
});
