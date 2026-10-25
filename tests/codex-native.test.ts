import { execFile, execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { expect, test } from "vitest";
// One clang++ syntax pass over Foundation and the Nitro headers: 1.3-6.4 s across 65 macos-latest CI runs
// (p95 4.6 s), so the 5 s default timed out twice. 20 s is about 3x the slowest run seen.
const headerCompileTimeoutMs = 20_000;
test.skipIf(process.platform !== "darwin")("Codex supervisor and generated bindings compile against the pinned Nitro headers", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-codex-headers-"));
  const headers = path.join(root, "NitroModules"); mkdirSync(headers);
  function gather(directory: string) {
    for (const file of readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, file.name);
      if (file.isDirectory()) gather(source);
      else if (/\.hpp$/.test(file.name)) symlinkSync(path.resolve(source), path.join(headers, file.name));
    }
  }
  try {
    gather("node_modules/react-native-nitro-modules/cpp");
    await promisify(execFile)("clang++", ["-fsyntax-only", "-fobjc-arc", "-fblocks", "-std=c++20", "-I", root, "-I", "node_modules/react-native/ReactCommon/jsi", "packages/codex/cpp/HybridCodexAppServer.mm"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, headerCompileTimeoutMs);

test.skipIf(process.platform !== "darwin")("Codex cancellation and turn lifecycle stay bounded with a fake app-server", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-codex-harness-"));
  const binary = path.join(root, "supervisor-test");
  const fake = path.resolve("tests/codex-fake-app-server.py");
  const cwd = process.cwd();
  try {
    chmodSync(fake, 0o755);
    execFileSync("clang++", ["-DSPARK_CODEX_TESTING", "-fobjc-arc", "-fblocks", "-std=c++20", "packages/codex/cpp/HybridCodexAppServer.mm", "tests/codex-supervisor-harness.mm", "-framework", "Foundation", "-o", binary], { stdio: "pipe" });
    const runMode = (mode: string) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const modeMarker = path.join(root, `marker-${mode}`);
      const child = spawn(binary, [mode], { cwd, detached: true, env: { ...process.env, CODEX_PATH: fake, CODEX_HOME: root, CODEX_TEST_MODE: mode, CODEX_TEST_MARKER: modeMarker, ...(mode === "preack" || mode === "postack" ? { CODEX_TEST_ACCEPT_TURN_AFTER_EXIT: "1" } : mode === "protocol-restart" ? { CODEX_TEST_ACCEPT_TURN_AFTER_EXIT: "next" } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk) => { output += chunk.toString(); });
      let timedOut = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid!, "SIGTERM"); } catch {}
        forceTimer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch {} }, 500);
      }, 8000);
      child.on("error", (error) => { clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        if (timedOut) reject(new Error(`native fake-server harness timed out (${mode}): ${output}`));
        else resolve({ code, output });
      });
    });
    for (const mode of ["cancel-init", "cancel-thread", "cancel-turn", "stall"]) {
      const result = await runMode(mode);
      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain("Codex request was cancelled.");
      expect(result.output).toContain("cancelled=1");
    }
    const cancelRestart = await runMode("cancel-restart");
    expect(cancelRestart.code, cancelRestart.output).toBe(0);
    expect(cancelRestart.output).toContain("cancelled=1 retry_result=0");
    const early = await runMode("preack");
    expect(early.code, early.output).toBe(0);
    expect(early.output).toContain("output=preack");
    const postAck = await runMode("postack");
    expect(postAck.code, postAck.output).toBe(0);
    expect(postAck.output).toContain("output=postack");
    const protocolRestart = await runMode("protocol-restart");
    expect(protocolRestart.code, protocolRestart.output).toBe(0);
    expect(readFileSync(path.join(root, "marker-protocol-restart.count"), "utf8")).toBe("2");
    const oversized = await runMode("oversize-preack");
    expect(oversized.code, oversized.output).toBe(0);
    expect(oversized.output).toContain("16 MiB pre-ack");
    const late = await runMode("late");
    expect(late.code, late.output).toBe(0);
    expect(late.output).toContain("retained=0");
    const restart = await runMode("restart");
    expect(restart.code, restart.output).toBe(0);
    expect(readFileSync(path.join(root, "marker-restart.count"), "utf8")).toBe("2");
    expect(readFileSync(path.join(root, "marker-cancel-restart.count"), "utf8")).toBe("2");
    const writeRestart = await runMode("write-restart");
    expect(writeRestart.code, writeRestart.output).toBe(0);
    expect(writeRestart.output).toContain("retry_result=0");
    expect(readFileSync(path.join(root, "marker-write-restart.count"), "utf8")).toBe("2");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);
