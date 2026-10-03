import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { acquireRunnerLock } from "../packages/cli/src/runner-install.ts";

const macTest = test.skipIf(process.platform !== "darwin");

macTest("recovers a stale incomplete legacy lock", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-runner-lock-"));
  const lock = path.join(temporary, "runner.lock");
  try {
    writeFileSync(lock, "");
    const old = new Date(Date.now() - 31_000);
    utimesSync(lock, old, old);
    const release = await acquireRunnerLock(lock, 100);
    expect(readFileSync(lock, "utf8")).toMatch(/^v2:/);
    await release();
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

macTest("does not take over a live legacy PID lock", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-runner-lock-"));
  const lock = path.join(temporary, "runner.lock");
  try {
    writeFileSync(lock, String(process.pid));
    await expect(acquireRunnerLock(lock, 50)).rejects.toThrow("Another process is installing Runner");
    expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

macTest("kernel lock serializes installers and releases when the owner process dies", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-runner-lock-"));
  const lock = path.join(temporary, "runner.lock");
  try {
    const release = await acquireRunnerLock(lock, 100);
    const owner = readFileSync(lock, "utf8");
    expect(owner).toMatch(/^v2:/);
    await expect(acquireRunnerLock(lock, 10)).rejects.toThrow("already locked");
    expect(readFileSync(lock, "utf8")).toBe(owner);
    await Promise.all([release(), release()]);
    const next = await acquireRunnerLock(lock, 100);
    await next();
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

macTest("parent death closes the keeper pipe and releases the kernel lock", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-runner-lock-"));
  const lock = path.join(temporary, "runner.lock");
  const moduleUrl = pathToFileURL(path.resolve("packages/cli/src/runner-install.ts")).href;
  const script = `import { acquireRunnerLock } from ${JSON.stringify(moduleUrl)}; await acquireRunnerLock(${JSON.stringify(lock)}, 5000); process.stdout.write('parent-ready\\n'); setInterval(() => {}, 1000);`;
  const parent = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  let keeperPid: number | undefined;
  parent.stderr.setEncoding("utf8").on("data", value => { stderr += value; });
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      parent.stdout.setEncoding("utf8").on("data", (value: string) => {
        output += value;
        if (output.includes("parent-ready\n")) resolve();
      });
      parent.once("error", reject);
      parent.once("close", code => reject(new Error(`Lock-owning parent exited before readiness (${code}): ${stderr}`)));
    });
    const keeper = spawnSync("pgrep", ["-P", String(parent.pid)], { encoding: "utf8" });
    keeperPid = Number(keeper.stdout.trim().split("\n")[0]);
    expect(Number.isInteger(keeperPid) && keeperPid > 0).toBe(true);
    parent.kill("SIGKILL");
    await new Promise<void>(resolve => parent.once("close", () => resolve()));
    const afterParentDeath = await acquireRunnerLock(lock, 3000);
    keeperPid = undefined;
    await afterParentDeath();
  } finally {
    if (keeperPid && parent.signalCode === "SIGKILL") {
      try { process.kill(keeperPid, 0); process.kill(-keeperPid, "SIGKILL"); } catch {}
    }
    if (parent.exitCode === null && parent.signalCode === null) {
      parent.kill("SIGKILL");
      await new Promise<void>(resolve => parent.once("close", () => resolve()));
    }
    rmSync(temporary, { recursive: true, force: true });
  }
});

macTest("recovers a dead legacy owner process", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-runner-lock-"));
  const lock = path.join(temporary, "runner.lock");
  try {
    const child = spawnSync(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(lock)}, String(process.pid))`]);
    expect(child.status).toBe(0);
    const release = await acquireRunnerLock(lock, 100);
    expect(readFileSync(lock, "utf8")).toMatch(/^v2:/);
    await release();
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
