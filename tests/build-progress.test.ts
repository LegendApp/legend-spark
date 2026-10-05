import { expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cancelCommands, run } from "../packages/cli/src/commands.ts";

test("labelled commands stream both outputs and retain logs before the child exits", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-progress-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  let streamed!: () => void;
  const received = new Promise<void>(resolve => { streamed = resolve; });
  let stdout = "", stderr = "";
  const ready = () => { if (stdout.includes("building") && stderr.includes("warning")) streamed(); };
  const out = vi.spyOn(process.stdout, "write").mockImplementation(chunk => { stdout += String(chunk); ready(); return true; });
  const err = vi.spyOn(process.stderr, "write").mockImplementation(chunk => { stderr += String(chunk); ready(); return true; });
  let completed = false;
  const pending = run(root, [process.execPath, "-e", 'process.stdout.write("building\\n"); process.stderr.write("warning\\n"); setInterval(() => {}, 1000);'], { label: "Compiling fixture" }).finally(() => { completed = true; });
  const observed = pending.catch(() => {});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([received, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Output was buffered until exit")), 2000); })]);
    expect(completed).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Compiling fixture…\nLog:"));
    expect(readFileSync(path.join(root, ".spark/logs", readdirSync(path.join(root, ".spark/logs"))[0]!), "utf8")).toContain("building");
    cancelCommands(root);
    await expect(pending).rejects.toThrow("exited");
    expect(stderr).toContain("warning");
  } finally { clearTimeout(timeout); cancelCommands(root); await observed; out.mockRestore(); err.mockRestore(); log.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});

test("captured output stays quiet and labelled completion reports elapsed time", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-capture-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    expect(await run(root, [process.execPath, "-e", 'process.stdout.write("result")'], { capture: true, label: "Inspecting fixture" })).toBe("result");
    expect(out).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Inspecting fixture finished \(\d+\.\d+s\)\.$/));
  } finally { out.mockRestore(); log.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});
