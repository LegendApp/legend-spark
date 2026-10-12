// App inspection commands of the driver backend (docs/e2e-flows.md#app-inspection): assertStartup and assertState, on
// the in-app driver's startup phases and the state the app exposes (docs/test-driver.md#startup-phases,
// docs/test-driver.md#exposed-state). Measurements come from the app; nothing is estimated on the runner side.
import { isDeepStrictEqual } from "node:util";
import type { StartupPhases } from "../driver.ts";
import { Failure, type CommandHandler } from "./backend.ts";
import { driven } from "./driver-motion.ts";

/** What these commands use of a driver session (`Driver` in scripts/e2e/driver.ts). */
export type InspectClient = {
  startup(timeoutMs?: number, testID?: string): Promise<StartupPhases>;
  state(path: string, timeoutMs?: number): Promise<unknown>;
};

/** The first rendered UI of a launch can take longer than a command's default wait (a development build loads JavaScript over HTTP). */
const STARTUP_TIMEOUT_MS = 30000;
const round = (value: number) => Math.round(value * 10) / 10;
const describePhases = (phases: StartupPhases) => Object.entries(phases).sort(([, a], [, b]) => a - b).map(([phase, at]) => `${phase} ${round(at)} ms`).join(", ");

export function inspectCommands(client: () => InspectClient): Record<string, CommandHandler> {
  return {
    /**
     * Startup phases of the running launch, from the kernel's process start: `coldMs` to the first settled UI (with `id`,
     * the first settled UI showing that element), `firstPaintMs` to its first mount. Records `startup.coldMs` and
     * `startup.firstPaintMs`.
     */
    assertStartup: async (args, context) => {
      const id = args.id as string | undefined;
      const phases = await driven("assertStartup", () => client().startup(context.command.timeout === undefined ? STARTUP_TIMEOUT_MS : context.timeoutMs, id));
      const measured = { coldMs: id === undefined ? phases.settled : phases.ready!, firstPaintMs: phases.firstMount };
      context.metric("startup.coldMs", measured.coldMs);
      context.metric("startup.firstPaintMs", measured.firstPaintMs);
      const problems: string[] = [];
      for (const key of ["coldMs", "firstPaintMs"] as const) {
        const bound = args[key] as { min?: number; max?: number } | undefined;
        if (bound?.min !== undefined && measured[key] < bound.min) problems.push(`${key} ${round(measured[key])} is below ${bound.min}`);
        if (bound?.max !== undefined && measured[key] > bound.max) problems.push(`${key} ${round(measured[key])} is above ${bound.max}`);
      }
      if (problems.length) throw new Failure("assertion", `${problems.join("; ")} (${describePhases(phases)})`);
    },

    /** The JSON value at `path` of the state the app exposes, polled until it equals `equals`. */
    assertState: async (args, context) => {
      const path = String(args.path);
      await context.eventually(async () => {
        const value = await driven(`assertState ${path}`, () => client().state(path));
        if (!isDeepStrictEqual(value, args.equals)) throw new Failure("assertion", `state ${path} is ${JSON.stringify(value)}, not ${JSON.stringify(args.equals)}`);
      });
    },
  };
}
