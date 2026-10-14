import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { runtimes } from "./helpers/js-runtimes";
import { run } from "../packages/cli/src/commands";
const require = createRequire(import.meta.url);
const { validateCustomize } = require("../packages/config-plugin/customize.cjs");
const { validateProvider } = require("../packages/config-plugin/customize-provider.cjs");
const worker = require("../packages/cli/src/customize-worker.cjs"), ai = require("../packages/cli/src/customize-ai.cjs"), cli = require("../packages/cli/src/customize-cli.cjs");
let root: string;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), "spark-customize-provider-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function workspace(name = "a") {
  const source = path.join(root, "source" + name); mkdirSync(source); writeFileSync(path.join(source, "index.js"), "original\n");
  const asset = { url: "https://github.com/test/app/releases/download/v1/source.tgz", sha256: "a".repeat(64), size: 100 };
  return worker.prepare({ schema: 1, project: "test", version: "1", release: name.repeat(64), runtime: { platform: "macos", mode: "release", fingerprint: "native", modules: {} }, entry: "index.js", source: asset, toolkit: asset }, source, path.join(root, "toolkit"), root);
}
describe("customize provider configuration", () => {
  it("invalidates customize release caches without rebuilding development hosts for source or tooling edits", async () => {
    const source = path.join(root, "cli"), app = path.join(root, "app"); mkdirSync(source); mkdirSync(app);
    for (const file of ["project.ts", "platform.ts", "helpers.ts", "macos-release.ts", "json.ts"]) copyFileSync(path.resolve("packages/cli/src", file), path.join(source, file));
    symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"));
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "cache-test", dependencies: {} }));
    writeFileSync(path.join(app, "index.js"), "original");
    const script = path.join(root, "cache.mjs");
    writeFileSync(script, `
      import { runtimeFor, writeJson } from './cli/project.ts';
      import { writeFileSync } from 'node:fs';
      import assert from 'node:assert/strict';
      const app = ${JSON.stringify(app)}, source = ${JSON.stringify(source)};
      const config = { expo: { name: 'Test', platforms: ['macos'], extra: { spark: { customize: { repository: 'test/app', files: ['index.js'] } } } } };
      writeJson(app + '/app.json', config);
      const fingerprint = mode => runtimeFor(app, [], mode).fingerprint;
      const assertReleaseOnly = edit => {
        const development = fingerprint('dev'), release = fingerprint('release');
        edit();
        assert.equal(fingerprint('dev'), development, 'customize changes must preserve the development host');
        assert.notEqual(fingerprint('release'), release, 'customize release artifacts must be refreshed');
      };
      assertReleaseOnly(() => writeFileSync(app + '/index.js', 'changed app source'));
      for (const file of ['customize-cli.cjs', 'customize-provider.cjs', 'runtime-bootstrap.sh']) {
        assertReleaseOnly(() => writeFileSync(source + '/' + file, 'changed'));
      }
      delete config.expo.extra.spark.customize;
      writeJson(app + '/app.json', config);
      const before = fingerprint('release');
      writeFileSync(source + '/customize-cli.cjs', 'changed again');
      assert.equal(fingerprint('release'), before);
    `);
    await run(root, [process.execPath, script], { capture: true });
  });
  it("supports installed CLI defaults, custom UI and keyless loopback models", () => {
    expect(validateCustomize({ repository: "owner/app", files: ["src"], ui: "custom", provider: { kind: "cli", tool: "codex" } })).toBeTruthy();
    expect(validateProvider({ kind: "cli", tool: "claude" })).toEqual({ kind: "cli", tool: "claude" });
    expect(validateProvider({ kind: "local", endpoint: "http://localhost:1234/v1/chat/completions", model: "local" }).endpoint).toContain("127.0.0.1");
    for (const endpoint of ["http://example.test/chat", "http://127.0.0.1.example.test/chat", "http://127.0.0.1@evil.test/chat", "http://127.0.0.1/chat?key=secret", "http://[::ffff:7f00:1]/chat"]) expect(() => validateProvider({ kind: "local", endpoint, model: "local" })).toThrow();
    expect(() => validateProvider({ kind: "remote", endpoint: "http://example.test/chat", model: "test" })).toThrow();
    expect(() => validateProvider({ kind: "cli", tool: "codex", apiKey: "secret" })).toThrow();
    expect(() => validateCustomize({ repository: "owner/app", files: ["src"], ui: "other" })).toThrow();
  });
  it("runs a real loopback HTTP tool-calling conversation without consent, keys or auth headers", async () => {
    const dir = workspace(); let calls = 0;
    const server = createServer(async (req, res) => {
      expect(req.headers.authorization).toBeUndefined(); let body = ""; for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      expect(request.model).toBe("local-test");
      if (calls) {
        const assistant = request.messages.find((message: { role: string }) => message.role === "assistant");
        expect(assistant.tool_calls[0].type).toBe("function");
        expect(request.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "write" });
      }
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
describe("installed CLI customize", () => {
  const fixture = `const fs=require('node:fs');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const body=JSON.parse(input.slice(input.indexOf('\\n')+1));const msgs=body.messages;const done=msgs.filter(x=>x.role==='tool').length;const name=done===0?'read_file':'write_file';const args=done===0?{path:'index.js'}:{path:'index.js',content:body.messages.some(x=>x.content&&x.content.includes('Build diagnostics'))?'repaired\\n':'cli edit\\n'};const message=done>=2?{content:'Updated by CLI',tool_calls:[]}:{content:'',tool_calls:[{id:String(done),function:{name,arguments:JSON.stringify(args)}}]};const out=process.argv.indexOf('--output-last-message');if(out>=0)fs.writeFileSync(process.argv[out+1],JSON.stringify(message));else process.stdout.write(JSON.stringify({structured_output:message}));});`;
  it.each(runtimes)("uses both installed CLI contracts through the real $name worker and retains prompt history", async engine => {
    const bin = path.join(root, "bin"); mkdirSync(bin);
    for (const tool of ["codex", "claude"]) {
      const exe = path.join(bin, tool); writeFileSync(exe, `#!${engine.executable}\n${fixture}`); chmodSync(exe, 0o755);
      const dir = workspace(tool === "codex" ? "a" : "b");
      // Keep the real candidate and provider code; substitute only the heavyweight compiler.
      const script = path.join(root, "run.cjs"); writeFileSync(script, `const w=require(${JSON.stringify(path.resolve("packages/cli/src/customize-worker.cjs"))});w.build=async()=>{};const ai=require(${JSON.stringify(path.resolve("packages/cli/src/customize-ai.cjs"))});ai.prompt(process.argv[2],{prompt:'Make it blue',provider:'cli',tool:process.argv[3],allowSourceSharing:true}).catch(e=>{console.error(e);process.exitCode=1});`);
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

describe("customize build trust boundary", () => {
  const policy = require("../packages/cli/src/customize-policy.cjs");
  it("freezes nested configs, scripts and locally imported build transforms", () => {
    mkdirSync(path.join(root, "src")); mkdirSync(path.join(root, "apps", "demo"), { recursive: true });
    writeFileSync(path.join(root, "metro.config.js"), "require('./src/transform'); module.exports={plugins:['./src/plugin']}; if(require('fs').existsSync('./optional.js')) req('./optional.js');");
    writeFileSync(path.join(root, "src/plugin.js"), "module.exports = {};");
    writeFileSync(path.join(root, "src/transform.js"), "require('./compiler');");
    writeFileSync(path.join(root, "src/compiler.js"), "module.exports = {};");
    writeFileSync(path.join(root, "apps/demo/babel.config.json"), JSON.stringify({ plugins: ["../../src/compiler"] }));
    const trusted = policy.collectTrustedFiles(root);
    expect(trusted).toContain("src/compiler.js"); expect(trusted).toContain("src/transform.js"); expect(trusted).toContain("src/plugin.js");
    for (const file of ["metro.config.js", "babel.config.cjs", "apps/demo/webpack.config.ts", "apps/demo/.babelrc", "scripts/build.js", "packages/shared/package.json", "bun.lock", "src/transform.js", "optional.js"]) {
      expect(() => ai.operate(root, "write_file", { path: file, content: "bad" }, trusted)).toThrow();
      expect(() => policy.assertCustomizeChanges({ [file]: "before" }, { [file]: "after" }, trusted)).toThrow();
      expect(() => policy.assertCustomizeChanges({}, { [file]: "new" }, trusted)).toThrow();
    }
    ai.operate(root, "write_file", { path: "src/App.tsx", content: "export const App = 1" }, trusted);
  });
  it("follows JSON Babel plugins and accepts bounded monorepo config selection", () => {
    mkdirSync(path.join(root, "src")); mkdirSync(path.join(root, "apps", "demo"), { recursive: true });
    writeFileSync(path.join(root, ".babelrc"), '{ // local plugin\n"plugins": ["./src/plugin",], }');
    writeFileSync(path.join(root, "src/plugin.js"), "module.exports = {};");
    writeFileSync(path.join(root, "babel.config.js"), "const path=require('node:path'); const id=process.env.APP_ID; const config=id && path.join(__dirname,'apps',id,'babel.config.cjs'); module.exports=require(config);");
    writeFileSync(path.join(root, "apps/demo/babel.config.cjs"), "module.exports = require('../../src/plugin');");
    expect(policy.collectTrustedFiles(root)).toContain("src/plugin.js");
  });
  it("rejects unbounded executable config imports before publication", () => {
    writeFileSync(path.join(root, "metro.config.js"), "require(process.env.BUILD_TRANSFORM);");
    expect(() => policy.collectTrustedFiles(root)).toThrow("static imports");
  });
  it("does not freeze runtime imports of a hidden generated entry as build transforms", () => {
    mkdirSync(path.join(root, ".legend")); mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, ".legend/index.js"), "require('../src/App');");
    writeFileSync(path.join(root, "src/App.js"), "module.exports = {};");
    expect(policy.collectTrustedFiles(root)).not.toContain("src/App.js");
  });
  it("rejects changed build config before starting the production compiler", async () => {
    const directory = workspace(); const toolkit = path.join(root, "toolkit"); mkdirSync(toolkit);
    writeFileSync(path.join(toolkit, "hermesc"), "compiler");
    worker.write(path.join(toolkit, "toolkit.json"), { arch: process.arch, compiler: require("node:crypto").createHash("sha256").update("compiler").digest("hex") });
    worker.restore(path.join(directory, "candidates", "edit"), worker.snapshot(path.join(directory, "base")));
    writeFileSync(path.join(directory, "candidates", "edit", "metro.config.js"), "throw new Error('must not execute');");
    await expect(worker.build(directory, "edit")).rejects.toThrow("configuration is fixed: metro.config.js");
  });
  it("uses the shared invocation defaults and disables Codex execution and unrestricted disk access", () => {
    const command = cli.invocation("codex", "model", root);
    expect(command.args).toContain("model_reasoning_effort=low");
    for (const value of ['default_permissions="spark-customize"', 'permissions.spark-customize.filesystem={":minimal"="read",":workspace_roots"="read"}', 'permissions.spark-customize.network.enabled=false', "shell_tool", "unified_exec", "view_image", "--strict-config"]) expect(command.args).toContain(value);
  });
});
