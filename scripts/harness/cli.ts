// `bun run harness` (docs/release-harness.md).
import path from "node:path";
import { spawnProcess } from "../../packages/cli/src/process.ts";
import { hostEnv } from "../e2e/gate/host.ts";
import { harnessCommand } from "./harness.ts";
import { sh } from "./install.ts";
import { tartDriver } from "./vm.ts";

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => controller.abort());
const vm = tartDriver({
  async run(argv) {
    const child = spawnProcess(argv, { stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout!).text(), new Response(child.stderr!).text()]);
    return { code, output: out + err };
  },
  spawn: argv => spawnProcess(argv, { stdout: "ignore", stderr: "ignore" }),
});
process.exitCode = await harnessCommand(process.argv.slice(2), {
  repo: path.resolve(import.meta.dirname, "../.."), gate: { ...hostEnv(), signal: controller.signal }, sh, vm, bun: process.execPath,
});
