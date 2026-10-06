import { expect, test } from "vitest";
import path from "node:path";
import { spawnProcess, which } from "../packages/cli/src/process.ts";
const runtimes = ["node", ...(which("bun") ? ["bun"] : [])];
test.each(runtimes)("compiled runtime works on %s with Bun absent from PATH", async runtime => {
  const node = which("node")!;
  const system = process.platform === "win32" ? [process.env.SystemRoot!, path.join(process.env.SystemRoot!, "System32")] : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const child = spawnProcess([which(runtime)!, path.join(import.meta.dirname, "fixtures/node-runtime.mjs"), path.resolve(import.meta.dirname, "../packages/cli/dist")], {
    env: { ...process.env, PATH: [path.dirname(node), ...system].join(path.delimiter) },
  });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, err).toBe(0); expect(out).toContain("checks passed without Bun on PATH");
}, 15_000);
