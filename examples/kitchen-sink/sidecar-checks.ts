import { startHelper } from "./sidecar-client";
import { getAppContext, quit } from "@legendapp/spark/app";
import { Platform } from "react-native";
import { spawn, runCommand } from "@legendapp/spark/processes";
import * as windows from "@legendapp/spark/windows";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function runSidecarChecks() {
  const results: { name: string; passed: boolean; error?: string }[] = [];
  async function check(name: string, action: () => Promise<void>) {
    try { await action(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
  }
  await check("packaged helper resolves and preserves Unicode stdin/stdout", async () => {
    const result = await runCommand({ target: { type: "helper", name: "echo" }, input: "hello 🦀\n", timeoutMs: 5000 });
    assert(result.exit.type === "exited" && result.exit.code === 0 && new TextDecoder().decode(result.stdout) === "hello 🦀\n" && new TextDecoder().decode(result.stderr) === "ready\n", JSON.stringify(result));
  });
  await check("missing helper rejects and helper failure preserves exit status", async () => {
    let failed = false;
    try { await spawn({ target: { type: "helper", name: "missing" } }); } catch { failed = true; }
    assert(failed, "Missing helper succeeded");
    const result = await runCommand({ target: { type: "helper", name: "echo" }, args: ["--fail"], timeoutMs: 5000 });
    assert(result.exit.type === "exited" && result.exit.code === 7 && new TextDecoder().decode(result.stderr).includes("requested failure"), JSON.stringify(result));
  });
  await check("binary streaming remains complete beyond the capture limit", async () => {
    let received = 0, valid = true;
    const child = await spawn({ target: { type: "helper", name: "echo" }, args: ["--binary"], timeoutMs: 15000, onOutput: chunk => {
      if (chunk.stream !== "stdout") return;
      for (const byte of chunk.bytes) { if (byte !== received % 256) valid = false; received++; }
    } });
    await child.closeInput();
    const result = await child.exited;
    assert(valid && received === 9 * 1024 * 1024 && result.outputTruncated && result.stdout.length === 8 * 1024 * 1024, `Binary stream: ${received}, valid=${valid}, truncated=${result.outputTruncated}`);
  });
  await check("repeated immediate secondary-window closure preserves the app-owned helper", async () => {
    const child = await spawn({ target: { type: "helper", name: "echo" }, timeoutMs: 30000 });
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        await windows.openWindow({ id: "sidecar-owner-probe", component: "main", size: { width: 400, height: 300 }, props: { windowId: "sidecar-owner-probe", windowProps: {} } });
        await windows.closeWindow("sidecar-owner-probe");
        assert(!(await windows.listWindows()).some(window => window.id === "sidecar-owner-probe"), "Closed window remained registered");
      }
      await child.write("still alive"); await child.closeInput();
      assert(new TextDecoder().decode((await child.exited).stdout) === "still alive", "Window close terminated helper");
    } finally { await child.terminate(); }
  });
  await check("timeout terminates blocked input and repeated termination is safe", async () => {
    const child = await spawn({ target: { type: "helper", name: "echo" }, timeoutMs: 100 });
    assert((await child.exited).timedOut, "Missing timeout result");
    await child.terminate(); await child.closeInput();
  });
  if (Platform.OS === "macos") await check("root exit and cancellation clean up descendants holding pipes", async () => {
    for (const script of ["sleep 30 & exit 0", "sleep 30 & wait"]) {
      const result = await runCommand({ target: { type: "executable", path: "/bin/sh" }, args: ["-c", script], timeoutMs: 200 });
      assert(script.endsWith("exit 0") ? result.exit.type === "exited" && result.exit.code === 0 : result.timedOut, "Wrong descendant exit result");
    }
  });
  await check("worker readiness, concurrent binary protocol, crash and explicit restart", async () => {
    const client = await startHelper(spawn);
    try {
      const input = new Uint8Array([0, 1, 127, 128, 255]);
      const [echo, hash] = await Promise.all([client.request("echo", input), client.request("hash")]);
      assert(echo.join() === input.join() && hash.join() === "129,28,157,197", "Worker reply mismatch");
      let failed = false; try { await client.request("crash"); } catch { failed = true; } assert(failed, "Worker crash did not reject request");
    } finally { await client.close(); }
    const restarted = await startHelper(spawn);
    try { assert((await restarted.request("echo")).length === 0, "Restart failed"); } finally { await restarted.close(); }
  });
  await check("worker readiness and request deadlines clean up the process", async () => {
    let missing = false; try { await startHelper(spawn, { args: ["--no-ready"], readyTimeoutMs: 200 }); } catch { missing = true; } assert(missing, "Missing ready handshake succeeded");
    const client = await startHelper(spawn, { requestTimeoutMs: 200 });
    try { let failed = false; try { await client.request("hang"); } catch { failed = true; } assert(failed, "Hung worker request succeeded"); } finally { await client.close(); }
  });
  let livePid: number | undefined;
  if ((await getAppContext()).launchArguments.includes("--spark-sidecar-quit-probe")) {
    await check("live helper is ready for external app-quit cleanup verification", async () => {
      let text = "";
      await spawn({ target: { type: "helper", name: "echo" }, args: ["--identity"], onOutput: chunk => {
        if (chunk.stream === "stdout") text += String.fromCharCode(...chunk.bytes);
      } });
      const deadline = Date.now() + 3000;
      while (!text.includes("\n") && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      livePid = Number(text.trim()); assert(livePid > 0, "Missing live helper PID");
    });
    setTimeout(() => void quit(), 1000);
  }
  return { livePid, passed: results.every(result => result.passed), results };
}
