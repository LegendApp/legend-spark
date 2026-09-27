import { spawnProcess } from "../packages/cli/src/process.ts";
import { expect, test, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHelper, type Spawn } from "../examples/sidecar/client.ts";
const directory = mkdtempSync(path.join(os.tmpdir(), 'spark-helper-tests-'));
const binary = path.join(directory, 'worker');
beforeAll(async () => { if (process.platform !== 'win32') { const result = spawnProcess(['cc', path.resolve('examples/sidecar/worker.c'), '-Wall', '-Wextra', '-Werror', '-o', binary], { stderr: 'pipe' }); if (await result.exited) throw Error(await new Response(result.stderr).text()); } });
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const spawn: Spawn = async options => {
  if (options.target.type !== "executable") throw Error("Test requires an executable target");
  const child = spawnProcess([options.target.path, ...(options.args ?? [])], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let stderr = '';
  async function drain(stream: ReadableStream<Uint8Array>, name: 'stdout' | 'stderr') { for await (const chunk of stream) { if (name === 'stderr') stderr += new TextDecoder().decode(chunk); /* Force transport fragmentation, including between response tokens. */ for (let i = 0; i < chunk.length; i += 3) options.onOutput?.({ stream: name, bytes: chunk.subarray(i, i + 3) }); } }
  const drains = Promise.all([drain(child.stdout!, 'stdout'), drain(child.stderr!, 'stderr')]);
  return { write: async text => { await new Promise<void>((resolve, reject) => child.stdin!.write(text, error => error ? reject(error) : resolve())); }, closeInput: async () => { child.stdin!.end(); }, terminate: async () => { if (child.exitCode === null) child.kill(); }, exited: child.exited.then(async exitCode => { await drains; return { exit: { type: "exited", code: exitCode }, stderr: new TextEncoder().encode(stderr), stdout: new Uint8Array(), timedOut: false, aborted: false, outputTruncated: false }; }) };
};
const nativeTest = process.platform === 'win32' ? test.skip : test;
nativeTest('real helper handshake, fragmented concurrent replies, binary echo, and graceful stop', async () => {
  const client = await startHelper(spawn, { target: { type: "executable", path: binary } });
  try {
    const bytes = new TextEncoder().encode('hello 🦀\n');
    const [echo, hash] = await Promise.all([client.request('echo', bytes), client.request('hash', new Uint8Array())]);
    expect(echo).toEqual(bytes); expect(Array.from(hash)).toEqual([0x81, 0x1c, 0x9d, 0xc5]);
  } finally { await Promise.all([client.close(), client.close()]); }
  await expect(client.request('echo')).rejects.toThrow('closed');
});
nativeTest('crash rejects in-flight requests; explicit restart works', async () => {
  const client = await startHelper(spawn, { target: { type: "executable", path: binary } });
  await expect(client.request('crash')).rejects.toThrow('exited (7)'); await client.close();
  const restarted = await startHelper(spawn, { target: { type: "executable", path: binary } }); expect(await restarted.request('echo')).toEqual(new Uint8Array()); await restarted.close();
});
nativeTest('readiness and request timeout terminate stalled helpers', async () => {
  await expect(startHelper(spawn, { target: { type: "executable", path: binary }, args: ['--no-ready'], readyTimeoutMs: 50 })).rejects.toThrow('readiness timed out');
  const client = await startHelper(spawn, { target: { type: "executable", path: binary }, requestTimeoutMs: 50 });
  await expect(client.request('hang')).rejects.toThrow('timed out'); await client.close();
});
