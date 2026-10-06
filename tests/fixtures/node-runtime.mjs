import assert from "node:assert/strict";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
const directory = process.argv[2];
const { spawnProcess, processLog, which } = await import(pathToFileURL(path.join(directory, "process.js")));
const { startWindowsMetro } = await import(pathToFileURL(path.join(directory, "windows-metro.js")));
const { installedPackages } = await import(pathToFileURL(path.join(directory, "project.js")));
const packageFixture = mkdtempSync(path.join(os.tmpdir(), "spark-package-graph-"));
try {
  const dependency = path.join(packageFixture, "node_modules/hidden-package");
  mkdirSync(path.join(dependency, "dist"), { recursive: true });
  writeFileSync(path.join(packageFixture, "package.json"), JSON.stringify({ name: "app", dependencies: { "hidden-package": "1.0.0" } }));
  writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "hidden-package", version: "1.0.0", exports: "./dist/index.js" }));
  writeFileSync(path.join(dependency, "dist/package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(path.join(dependency, "dist/index.js"), "export default {};\n");
  assert.deepEqual(installedPackages(packageFixture).map(pkg => pkg.name), ["hidden-package"]);
  const log = path.join(packageFixture, "child.log");
  const child = spawnProcess([process.execPath, "-e", 'process.stdin.on("data", chunk => { process.stdout.write(chunk); process.stderr.write("stderr\\n"); });'], {
    stdin: "pipe", stdout: processLog(log), stderr: processLog(log),
  });
  await new Promise((resolve, reject) => child.stdin.write("stdin payload\n", error => error ? reject(error) : resolve()));
  child.stdin.end();
  assert.equal(await child.exited, 0);
  assert.equal(child.signalCode, null);
  assert.equal(readFileSync(log, "utf8"), "stdin payload\nstderr\n");
} finally { rmSync(packageFixture, { recursive: true, force: true }); }
const WebSocket = createRequire(path.join(directory, "index.js"))("ws");
const { WebSocketServer } = WebSocket;
assert.equal(which("bun"), undefined, "Test PATH must not contain Bun");
const output = spawnProcess([process.execPath, "-e", 'process.stdout.write("x".repeat(200000));process.stderr.write("y".repeat(200000))']);
const [stdout, stderr, code] = await Promise.all([new Response(output.stdout).text(), new Response(output.stderr).text(), output.exited]);
assert.equal(stdout.length, 200000); assert.equal(stderr.length, 200000); assert.equal(code, 0);
await assert.rejects(spawnProcess(["spark-command-that-does-not-exist"]).exited, { code: "ENOENT" });
let ready;
const started = new Promise(resolve => { ready = resolve; });
const ipc = spawnProcess([process.execPath, "-e", 'process.on("message", m => process.send({echo:m}));process.send({ready:true})'], {
  ipc(message, child) { if (message.ready) child.send({ action: "open" }); else { assert.deepEqual(message.echo, { action: "open" }); ready(); } },
});
await started; ipc.kill("SIGTERM"); assert.notEqual(await ipc.exited, 0); assert.notEqual(ipc.exitCode, null);
const compressed = gzipSync("encoded Metro response");
const upstream = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", chunk => chunks.push(chunk));
  request.on("end", () => {
    if (request.url.startsWith("/encoded")) { response.writeHead(200, { "content-encoding": "gzip", "content-length": compressed.length }); response.end(compressed); }
    else response.end(JSON.stringify({ body: Buffer.concat(chunks).toString(), url: request.url }));
  });
});
const ws = new WebSocketServer({ server: upstream });
ws.on("connection", socket => socket.on("message", (data, binary) => socket.send(data, { binary })));
await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
const proxy = await startWindowsMetro(upstream.address().port, { dev: false, minify: true });
try {
  const base = `http://127.0.0.1:${proxy.port}`;
  const response = await (await fetch(base + "/index.bundle?platform=windows", { method: "POST", body: "body" })).json();
  assert.equal(response.body, "body"); assert.match(response.url, /dev=false/); assert.match(response.url, /minify=true/);
  const encoded = await new Promise((resolve, reject) => http.get(base + "/encoded", response => {
    const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve(Buffer.concat(chunks))); response.on("error", reject);
  }).on("error", reject));
  assert.deepEqual(encoded, compressed);
  for (const binary of [false, true]) {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${proxy.port}/hot`);
      const timeout = setTimeout(() => { socket.terminate(); reject(new Error("WebSocket timeout")); }, 3000);
      socket.on("open", () => socket.send(Buffer.from("reload"), { binary }));
      socket.on("message", (data, isBinary) => { clearTimeout(timeout); assert.equal(isBinary, binary); assert.equal(data.toString(), "reload"); socket.close(); resolve(); });
      socket.on("error", reject);
    });
  }
} finally {
  proxy.stop(); for (const client of ws.clients) client.terminate(); ws.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
}
console.log("Process, IPC, signals, HTTP compression, and WebSocket checks passed without Bun on PATH");
