// `bun run harness` (docs/release-harness.md).
import path from "node:path";
import { spawnProcess } from "../../packages/cli/src/process.ts";
import { hostEnv } from "../e2e/gate/host.ts";
import { harnessCommand } from "./harness.ts";
import { sh } from "./install.ts";
import { tartDriver } from "./vm.ts";

// SIGINT/SIGTERM abort the run: the gate stops its flows, and a VM run stops waiting and disposes its clone.
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => controller.abort());
const vm = tartDriver({
  async run(argv, signal) {
    const { code, stdout, stderr } = await sh(argv, signal);
    return { code, output: stdout + stderr };
  },
  spawn: argv => spawnProcess(argv, { stdout: "ignore", stderr: "ignore" }),
});
process.exitCode = await harnessCommand(process.argv.slice(2), {
  repo: path.resolve(import.meta.dirname, "../.."), gate: { ...hostEnv(), signal: controller.signal }, sh, vm, bun: process.execPath,
});
