// Render and leak commands of the driver backend (docs/e2e-flows.md#layout-flicker-and-leaks): assertNoLayoutThrash,
// assertNoFlicker, assertNoLeaks and assertMemory, on the in-app driver's commit watching, leak counters and memory
// (docs/test-driver.md#layout-thrash-and-flicker, docs/test-driver.md#leak-counters).
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { CommitReport, Counters, Frame } from "../driver.ts";
import type { FlowCommand } from "../format/parser.ts";
import { Failure, type CommandContext, type CommandHandler } from "./backend.ts";
import { driven } from "./driver-motion.ts";

/** What these commands use of a driver session (`Driver` in scripts/e2e/driver.ts). */
export type RenderClient = {
  startCommits(): Promise<void>;
  stopCommits(timeoutMs?: number): Promise<CommitReport>;
  counters(timeoutMs?: number): Promise<Counters>;
  memory(): Promise<{ footprintMB: number; residentMB: number }>;
};

const LISTED = 5;
const round = (value: number) => Math.round(value * 10) / 10;
const rect = ({ x, y, width, height }: Frame) => `${round(x)},${round(y)} ${round(width)}×${round(height)}`;
const list = (items: string[]) => items.slice(0, LISTED).join("; ") + (items.length > LISTED ? `; and ${items.length - LISTED} more` : "");

export function renderCommands(client: () => RenderClient, launchCounters: () => Counters | undefined): Record<string, CommandHandler> {
  /** Watches commits while `during` runs, until the UI settles; writes the report to `<what>-<n>.commits.json` when it fails. */
  async function watched(what: string, during: unknown, context: CommandContext) {
    await driven(what, () => client().startCommits());
    try { await context.run([during as FlowCommand]); } catch (error) {
      await client().stopCommits().catch(() => undefined);
      throw error;
    }
    return driven(what, () => client().stopCommits(context.timeoutMs));
  }
  function fail(what: string, report: CommitReport, problems: string[], context: CommandContext): never {
    const file = path.join(context.outputDir, `${what}-line${context.command.location.line}.commits.json`);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    throw new Failure("assertion", `${problems.join("; ")} (${report.commits} commits)`, { artifacts: [{ kind: "output", path: file }] });
  }

  return {
    /** Fails when a view's frame changed in more than one commit while `during` ran and the UI settled. */
    assertNoLayoutThrash: async (args, context) => {
      const report = await watched("assertNoLayoutThrash", args.during, context);
      if (report.relayouts.length) fail("assertNoLayoutThrash", report, [`${report.relayouts.length} views were laid out in more than one commit: ${list(report.relayouts.map(({ view, window, frames }) => `${view} (${window}) ${frames.map(rect).join(" → ")}`))}`], context);
    },

    /** Fails when an element went missing for a commit and came back, or a window showed no elements, while `during` ran. */
    assertNoFlicker: async (args, context) => {
      const report = await watched("assertNoFlicker", args.during, context);
      const problems = [
        ...report.gaps.length ? [`elements disappeared and came back: ${list(report.gaps.map(({ id, window, commits }) => `${id} (${window}) for ${commits} commit${commits === 1 ? "" : "s"}`))}`] : [],
        ...report.blanks.length ? [`windows showed no elements: ${list(report.blanks.map(({ window, commits }) => `${window} for ${commits} commit${commits === 1 ? "" : "s"}`))}`] : [],
      ];
      if (problems.length) fail("assertNoFlicker", report, problems, context);
    },

    /**
     * Leak counters (windows, views, file descriptors, desktop event listeners) after running `run` `repeat` times, or
     * now, must not exceed the baseline: before `run`, or (`since: flowStart`) before the flow's first command on the launch.
     */
    assertNoLeaks: async (args, context) => {
      if (args.since === "mark") throw new Failure("unsupported", "assertNoLeaks since: mark needs a command that sets a mark, and the flow format has none; use since: flowStart or run");
      let baseline: Counters | undefined;
      if (args.since === "flowStart") {
        baseline = launchCounters();
        if (!baseline) throw new Failure("invalid", "assertNoLeaks since: flowStart compares with the counters taken before the flow's first command on the launch, and this launch took none (is the command in a runFlow file?)");
      } else baseline = await driven("assertNoLeaks", () => client().counters(context.timeoutMs));
      const repeat = (args.repeat as number | undefined) ?? 1;
      if (args.run) for (let time = 0; time < repeat; time++) await context.run(args.run as FlowCommand[]);
      const now = await driven("assertNoLeaks", () => client().counters(context.timeoutMs));
      const grown = (Object.keys(baseline) as Array<keyof Counters>).filter(key => now[key] > baseline[key]);
      if (grown.length) throw new Failure("assertion", `leak counters grew${args.run ? ` after running ${repeat} time${repeat === 1 ? "" : "s"}` : ""}: ${grown.map(key => `${key} ${baseline[key]} → ${now[key]}`).join(", ")}`);
    },

    /** The process's memory footprint, recorded as `memory.mb`, must be at most `maxMB`. */
    assertMemory: async (args, context) => {
      if (args.window !== undefined) throw new Failure("unsupported", "assertMemory window is not supported by backend driver: it measures the app process");
      const { footprintMB } = await driven("assertMemory", () => client().memory());
      context.metric("memory.mb", footprintMB);
      if (footprintMB > (args.maxMB as number)) throw new Failure("assertion", `the app's memory footprint is ${round(footprintMB)} MB, more than ${args.maxMB} MB`);
    },
  };
}
