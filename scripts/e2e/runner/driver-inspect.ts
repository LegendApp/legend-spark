// App inspection commands of the driver backend (docs/e2e-flows.md#app-inspection): assertStartup and assertState, on
// the in-app driver's startup phases and the state the app exposes (docs/test-driver.md#startup-phases,
// docs/test-driver.md#exposed-state), and assertCrashSymbol on an exposed crash report. Measurements come from the app;
// nothing is estimated on the runner side.
import { existsSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { findDwarf, symbolicateReport } from "../../../packages/cli/src/symbolicate.ts";
import type { StartupPhases } from "../driver.ts";
import { Failure, type CommandHandler } from "./backend.ts";
import { driven } from "./driver-motion.ts";

/** What these commands use of a driver session (`Driver` in scripts/e2e/driver.ts). */
export type InspectClient = {
  startup(timeoutMs?: number, testID?: string): Promise<StartupPhases>;
  state(path: string, timeoutMs?: number): Promise<unknown>;
};
/** The app bundle a driver session runs (the one given, never an isolated clone), and whether it is a release build. */
export type InspectedApp = { app: string; release: boolean };
type Frame = { address: string; image?: string; imageUUID?: string; symbol?: string; symbolOffset?: number };

/** The first rendered UI of a launch can take longer than a command's default wait (a development build loads JavaScript over HTTP). */
const STARTUP_TIMEOUT_MS = 30000;
const round = (value: number) => Math.round(value * 10) / 10;
const describePhases = (phases: StartupPhases) => Object.entries(phases).sort(([, a], [, b]) => a - b).map(([phase, at]) => `${phase} ${round(at)} ms`).join(", ");

/**
 * The stack of a release build's report, named with the dSYMs the build writes next to the app (`spark symbolicate`):
 * a stripped binary has no names for its own frames in-process.
 */
function symbolicated(report: { stack: Frame[] }, app: string): { stack: Frame[]; missing: string[] } {
  const folder = path.join(path.dirname(app), "dSYMs");
  if (!existsSync(folder)) throw new Failure("invalid", `no dSYM: ${app} is a stripped release build with no dSYMs folder next to it (${folder}), so its crash report cannot be symbolicated`);
  const dwarf = findDwarf([folder]);
  // Only the dSYMs' names count: the in-process ones are dropped first.
  const stack = symbolicateReport({ stack: report.stack.map(({ symbol: _symbol, symbolOffset: _offset, ...frame }) => frame) }, dwarf).stack;
  // The app's own images (system libraries ship no dSYM) that have none in the folder.
  const missing = [...new Set(stack.filter(frame => frame.image?.includes(".app/Contents/") && !dwarf.has(frame.imageUUID ?? "")).map(frame => `${path.basename(frame.image!)} (${frame.imageUUID ?? "no UUID"})`))];
  return { stack, missing };
}

export function inspectCommands(client: () => InspectClient, inspected: () => InspectedApp): Record<string, CommandHandler> {
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

    /**
     * The native crash report at `path` has a frame named `symbol`: in-process names on a dev build, the dSYMs next to
     * the app on a stripped release build.
     */
    assertCrashSymbol: async args => {
      const at = String(args.path), symbol = String(args.symbol);
      const report = await driven(`assertCrashSymbol ${at}`, () => client().state(at)) as { kind?: unknown; stack?: unknown } | null;
      if (report?.kind !== "native" || !Array.isArray(report.stack)) throw new Failure("assertion", `state ${at} is not a native crash report: ${JSON.stringify(report)}`);
      const { app, release } = inspected();
      const { stack, missing } = release ? symbolicated(report as { stack: Frame[] }, app) : { stack: report.stack as Frame[], missing: [] };
      if (stack.some(frame => frame.symbol === symbol)) return;
      const names = [...new Set(stack.map(frame => frame.symbol ?? "?"))].join(", ");
      throw new Failure("assertion", `no frame of ${at} is named ${symbol}${release ? " after symbolicating with the dSYMs next to the app" : " in-process"} (frames: ${names})${missing.length ? `; no dSYM in ${path.join(path.dirname(app), "dSYMs")} for ${missing.join(", ")}` : ""}`);
    },
  };
}
