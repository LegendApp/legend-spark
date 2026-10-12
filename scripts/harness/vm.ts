// Virtual machines for the release harness (docs/release-harness.md#virtual-machines): a disposable clone of a clean
// image, a host directory shared into it, and a way to run a command inside. `tartDriver` is the macOS one.
import { setTimeout as sleep } from "node:timers/promises";
import type { GateTarget, Machine } from "../e2e/format/parser.ts";
import { platformOf } from "../e2e/gate/plan.ts";

export type GuestResult = { code: number; output: string };
/** A booted clone. `dispose` stops and deletes it; the image is never modified. */
export type Guest = {
  /** Where the host's shared directory appears inside the guest. */
  readonly share: string;
  /** Runs `argv` in the guest; `signal` stops it. */
  exec(argv: string[], signal?: AbortSignal): Promise<GuestResult>;
  dispose(): Promise<void>;
};
export type VmDriver = {
  readonly name: string;
  /**
   * Clones `image`, boots the clone with `share` (a host directory) visible inside, and returns once it accepts commands.
   * Aborting `signal` stops waiting, disposes the clone and rejects.
   */
  boot(image: string, share: string, signal?: AbortSignal): Promise<Guest>;
};

/** Why a target cannot be installed in a VM, or undefined when it can. Reference machines and Intel Macs are physical hardware. */
export function vmProblem(target: GateTarget & { id: string }, machine: Machine | undefined): string | undefined {
  if (platformOf(target.os) === "windows") return `${target.id}: there is no Windows VM driver, because Spark has no Windows release build to install yet (gate.yaml has no build.windows)`;
  if (target.machine) return `${target.id} is bound to the reference machine ${machine?.name ?? target.machine}; a VM is not that hardware, so run bun run harness on the machine itself`;
  if (target.arch !== "arm64") return `${target.id}: tart runs Apple Silicon macOS guests only; run bun run harness on an Intel Mac`;
  return undefined;
}

/** What `tartDriver` runs on the host. Tests pass doubles. */
export type TartHost = {
  /** Runs a command to completion; `signal` kills it. */
  run(argv: string[], signal?: AbortSignal): Promise<GuestResult>;
  /** Starts a long-running command (`tart run`). */
  spawn(argv: string[]): { exited: Promise<number>; kill(): void };
  sleep?(ms: number): Promise<unknown>;
};

const TART_SHARE = "harness";
/** How long a booted clone may take to get an IP address and then to accept `tart exec`. */
const BOOT_SECONDS = 300, AGENT_MS = 120_000;

/**
 * [Tart](https://tart.run) on an Apple Silicon host. The image needs the Tart Guest Agent for `tart exec`.
 * The share is mounted with `tart run --dir`.
 */
export function tartDriver(host: TartHost): VmDriver {
  const wait = host.sleep ?? sleep;
  const must = async (argv: string[], signal?: AbortSignal) => {
    const result = await host.run(argv, signal);
    signal?.throwIfAborted();
    if (result.code) throw new Error(`${argv.join(" ")} exited ${result.code}: ${result.output.trim()}`);
    return result.output;
  };
  return {
    name: "tart",
    async boot(image, share, signal) {
      const name = `spark-harness-${process.pid}-${Date.now()}`;
      await must(["tart", "clone", image, name], signal).catch(async (error: unknown) => {
        // An interrupted clone may have left a partial VM behind.
        if (signal?.aborted) await host.run(["tart", "delete", name]);
        throw error;
      });
      const vm = host.spawn(["tart", "run", name, "--no-graphics", `--dir=${TART_SHARE}:${share}`]);
      const dispose = async () => {
        try { await host.run(["tart", "stop", name]); } finally {
          vm.kill();
          await vm.exited;
          await must(["tart", "delete", name]);
        }
      };
      try {
        await must(["tart", "ip", name, "--wait", String(BOOT_SECONDS)], signal);
        // The agent starts after login, a little after the network: wait for it, bounded.
        for (const deadline = Date.now() + AGENT_MS; (await host.run(["tart", "exec", name, "true"], signal)).code;) {
          signal?.throwIfAborted();
          if (Date.now() >= deadline) throw new Error(`tart exec ${name} did not answer within ${AGENT_MS / 1000}s; the image needs the Tart Guest Agent`);
          await wait(2000);
        }
      } catch (error) { await dispose(); throw error; }
      return { share: `/Volumes/My Shared Files/${TART_SHARE}`, exec: (argv, signal) => host.run(["tart", "exec", name, ...argv], signal), dispose };
    },
  };
}
