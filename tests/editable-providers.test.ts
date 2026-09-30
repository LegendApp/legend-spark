import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { runtimes } from "./helpers/js-runtimes";
import { run } from "../packages/cli/src/commands";
const require = createRequire(import.meta.url);
const { validateEditable } = require("../packages/config-plugin/editable.cjs");
const { validateProvider } = require("../packages/config-plugin/editable-provider.cjs");
const worker = require("../packages/cli/src/editable-worker.cjs"), ai = require("../packages/cli/src/editable-ai.cjs"), cli = require("../packages/cli/src/editable-cli.cjs");
let root: string;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), "spark-editable-provider-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function workspace(name = "a") {
  const source = path.join(root, "source" + name); mkdirSync(source); writeFileSync(path.join(source, "index.js"), "original\n");
  const asset = { url: "https://github.com/test/app/releases/download/v1/source.tgz", sha256: "a".repeat(64), size: 100 };
  return worker.prepare({ schema: 1, project: "test", version: "1", release: name.repeat(64), runtime: { platform: "macos", mode: "release", fingerprint: "native", modules: {} }, entry: "index.js", source: asset, toolkit: asset }, source, path.join(root, "toolkit"), root);
}
describe("editing provider configuration", () => {
  it("invalidates editable release caches when CLI or runtime tooling changes", async () => {
    const source = path.join(root, "cli"), app = path.join(root, "app"); mkdirSync(source); mkdirSync(app);
    for (const file of ["project.ts", "platform.ts", "helpers.ts", "macos-release.ts"]) copyFileSync(path.resolve("packages/cli/src", file), path.join(source, file));
    symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"));
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "cache-test", dependencies: {} }));
    writeFileSync(path.join(app, "index.js"), "original");
    const script = path.join(root, "cache.mjs");
    writeFileSync(script, `import {runtimeFor,writeJson} from './cli/project.ts';import {writeFileSync} from 'node:fs';import assert from 'node:assert/strict';const app=${JSON.stringify(app)},source=${JSON.stringify(source)};const config={expo:{name:'Test',platforms:['macos'],extra:{spark:{editable:{repository:'test/app',files:['index.js']}}}}};writeJson(app+'/app.json',config);for(const file of ['editable-cli.cjs','editable-provider.cjs','runtime-bootstrap.sh']){const before=runtimeFor(app,[],'release').fingerprint;writeFileSync(source+'/'+file,'changed');assert.notEqual(runtimeFor(app,[],'release').fingerprint,before);}delete config.expo.extra.spark.editable;writeJson(app+'/app.json',config);const before=runtimeFor(app,[],'release').fingerprint;writeFileSync(source+'/editable-cli.cjs','changed again');assert.equal(runtimeFor(app,[],'release').fingerprint,before);`);
    await run(root, [process.execPath, script], { capture: true });
  });
  it("supports installed CLI defaults, custom UI and keyless loopback models", () => {
    expect(validateEditable({ repository: "owner/app", files: ["src"], ui: "custom", provider: { kind: "cli", tool: "codex" } })).toBeTruthy();
    expect(validateProvider({ kind: "cli", tool: "claude" })).toEqual({ kind: "cli", tool: "claude" });
    expect(validateProvider({ kind: "local", endpoint: "http://localhost:1234/v1/chat/completions", model: "local" }).endpoint).toContain("127.0.0.1");
    for (const endpoint of ["http://example.test/chat", "http://127.0.0.1.example.test/chat", "http://127.0.0.1@evil.test/chat", "http://127.0.0.1/chat?key=secret", "http://[::ffff:7f00:1]/chat"]) expect(() => validateProvider({ kind: "local", endpoint, model: "local" })).toThrow();
    expect(() => validateProvider({ kind: "remote", endpoint: "http://example.test/chat", model: "test" })).toThrow();
    expect(() => validateProvider({ kind: "cli", tool: "codex", apiKey: "secret" })).toThrow();
    expect(() => validateEditable({ repository: "owner/app", files: ["src"], ui: "other" })).toThrow();
  });
  it("runs a real loopback HTTP tool-calling conversation without consent, keys or auth headers", async () => {
    const dir = workspace(); let calls = 0;
    const server = createServer(async (req, res) => {
      expect(req.headers.authorization).toBeUndefined(); let body = ""; for await (const chunk of req) body += chunk;
      expect(JSON.parse(body).model).toBe("local-test");
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ choices: [{ message: ++calls === 1 ? { tool_calls: [{ id: "write", function: { name: "write_file", arguments: JSON.stringify({ path: "index.js", content: "local edit\n" }) } }] } : { content: "Changed locally" } }] }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as { port: number };
      await ai.prompt(dir, { prompt: "Edit", provider: "local", endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`, model: "local-test", apiKey: "must-not-send" }, { build: async () => {} });
      const history = worker.read(path.join(dir, "state.json")).history[0]; expect(history.providerKind).toBe("local"); expect(history.status).toBe("needs-review");
      expect(readFileSync(path.join(dir, "work/index.js"), "utf8")).toBe("original\n");
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
describe("installed CLI editing", () => {
  const fixture = `const fs=require('node:fs');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const body=JSON.parse(input.slice(input.indexOf('\\n')+1));const msgs=body.messages;const done=msgs.filter(x=>x.role==='tool').length;const name=done===0?'read_file':'write_file';const args=done===0?{path:'index.js'}:{path:'index.js',content:body.messages.some(x=>x.content&&x.content.includes('Build diagnostics'))?'repaired\\n':'cli edit\\n'};const message=done>=2?{content:'Updated by CLI',tool_calls:[]}:{content:'',tool_calls:[{id:String(done),function:{name,arguments:JSON.stringify(args)}}]};const out=process.argv.indexOf('--output-last-message');if(out>=0)fs.writeFileSync(process.argv[out+1],JSON.stringify(message));else process.stdout.write(JSON.stringify({structured_output:message}));});`;
  it.each(runtimes)("uses both installed CLI contracts through the real $name worker and retains prompt history", async engine => {
    const bin = path.join(root, "bin"); mkdirSync(bin);
    for (const tool of ["codex", "claude"]) {
      const exe = path.join(bin, tool); writeFileSync(exe, `#!${engine.executable}\n${fixture}`); chmodSync(exe, 0o755);
      const dir = workspace(tool === "codex" ? "a" : "b");
      // Keep the real candidate and provider code; substitute only the heavyweight compiler.
      const script = path.join(root, "run.cjs"); writeFileSync(script, `const w=require(${JSON.stringify(path.resolve("packages/cli/src/editable-worker.cjs"))});w.build=async()=>{};const ai=require(${JSON.stringify(path.resolve("packages/cli/src/editable-ai.cjs"))});ai.prompt(process.argv[2],{prompt:'Make it blue',provider:'cli',tool:process.argv[3],allowSourceSharing:true}).catch(e=>{console.error(e);process.exitCode=1});`);
      await run(root, [engine.executable, script, dir, tool], { capture: true, env: { PATH: bin + path.delimiter + process.env.PATH } });
      const event = worker.read(path.join(dir, "state.json")).history[0]; expect(event.provider).toBe(`cli:${tool}`); expect(event.prompt).toBe("Make it blue"); expect(event.status).toBe("needs-review");
      expect(readFileSync(path.join(dir, "candidates", event.candidate, "index.js"), "utf8")).toBe("cli edit\n");
      expect(readFileSync(path.join(dir, "work/index.js"), "utf8")).toBe("original\n");
    }
  });
  it("requires consent, reports missing tools and preserves failed prompts", async () => {
    const dir = workspace(); await expect(ai.prompt(dir, { prompt: "Edit", provider: "cli", tool: "codex" })).rejects.toThrow("permission");
    const previous = process.env.PATH; process.env.PATH = root;
    try { await expect(ai.prompt(dir, { prompt: "Edit", provider: "cli", tool: "codex", allowSourceSharing: true }, { build: async () => {} })).rejects.toThrow("Install codex"); }
    finally { process.env.PATH = previous; }
    expect(worker.read(path.join(dir, "state.json")).history[0].status).toBe("failed");
  });
  it("cancels the owned CLI process and removes its per-request temporary directory", async () => {
    const bin = path.join(root, "bin"); mkdirSync(bin); const exe = path.join(bin, "claude");
    writeFileSync(exe, `#!${process.execPath}\nprocess.stdin.resume();setInterval(()=>{},1000);`); chmodSync(exe, 0o755);
    const previous = process.env.PATH; process.env.PATH = bin;
    try { await expect(cli.complete({ kind: "cli", tool: "claude" }, { messages: [], tools: [] }, AbortSignal.timeout(100))).rejects.toThrow("canceled"); }
    finally { process.env.PATH = previous; }
  });
});
