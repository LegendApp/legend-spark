// `bun run e2e:run <flow|dir>… [--backend name[,name]] [--agent] [--report dir] [--app path]`
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { collect } from "../files.ts";
import type { Artifact, Backend, BackendFactory } from "./backend.ts";
import { realClock, runFlows, type Clock, type FailureReport, type FlowResult, type RunEvent, type RunOptions } from "./executor.ts";
import { buildReport, failureText, writeReports, type RunReport } from "./report.ts";

const repo = path.resolve(import.meta.dirname, "../../..");

/**
 * Production backends by `--backend` name. The macOS black-box backend (AX + CGEvent) lands with #50 and the
 * Spark in-app driver adapter lands with #226; until then this table is empty and `e2e:run` says so.
 */
export const BACKENDS: Readonly<Record<string, BackendFactory>> = {};
export const NO_BACKENDS = "no backends are available yet: the macOS black-box backend lands with #50 and the in-app driver adapter with #226";

export type RunIO = { backends: Readonly<Record<string, BackendFactory>>; stdout(line: string): void; stderr(line: string): void; clock?: Clock; signal?: AbortSignal };
const USAGE = "usage: bun run e2e:run [flow|dir…] [--backend name[,name…]] [--agent] [--report dir] [--app path]";

function parse(args: string[]) {
  const options = { targets: [] as string[], backends: [] as string[], agent: false, report: undefined as string | undefined, app: undefined as string | undefined };
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index]!.startsWith("--") ? args[index]!.split(/=(.*)/s, 2) as [string, string | undefined] : [undefined, undefined];
    const value = () => {
      const next = inline ?? args[++index];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === undefined) options.targets.push(args[index]!);
    else if (flag === "--agent" && inline === undefined) options.agent = true;
    else if (flag === "--backend") options.backends.push(...value().split(",").filter(Boolean));
    else if (flag === "--report") options.report = value();
    else if (flag === "--app") options.app = value();
    else throw new Error(`unknown option ${args[index]}`);
  }
  return options;
}

/** Paths as given in agent mode: absolute, so an agent can open them directly. */
function agentFailure(failure: FailureReport) {
  const at = (location: FailureReport["location"]) => `${location.file}:${location.line}:${location.column}`;
  return { ...failure, location: at(failure.location), stack: failure.stack.map(at), artifacts: failure.artifacts.map(absolute) };
}
const absolute = (artifact: Artifact) => ({ ...artifact, path: path.resolve(artifact.path) });

/** Prints run events: one PASS/FAIL/SKIP line per flow, or JSON lines in agent mode. */
export function printer(io: Pick<RunIO, "stdout">, agent: boolean) {
  const line = (event: object) => io.stdout(JSON.stringify(event));
  return (event: RunEvent) => {
    if (event.event === "flow-start") { if (agent) line(event); return; }
    const { steps: _steps, ...result }: FlowResult = event.result;
    if (agent) return line({ event: "flow-end", ...result, artifacts: result.artifacts.map(absolute), ...(result.failure ? { failure: agentFailure(result.failure) } : {}) });
    const status = { passed: "PASS", failed: "FAIL", skipped: "SKIP" }[result.status];
    io.stdout(`${status} ${result.id} (${result.durationMs}ms)${result.skipReason ? `: ${result.skipReason}` : ""}`);
    if (result.failure) io.stdout(failureText(result.failure).replace(/^/gm, "  "));
    for (const error of result.errors) io.stdout(`  also: ${error}`);
  };
}

/** Runs flow files and writes report.json, junit.xml and index.html into `runDir`. The release gate runs flows through this too. */
export async function runSuite(files: string[], options: RunOptions): Promise<{ report: RunReport; reports: ReturnType<typeof writeReports> }> {
  mkdirSync(options.runDir, { recursive: true });
  const startedAt = new Date(), clock = options.clock ?? realClock, began = clock.now();
  const results = await runFlows(files, options);
  const report = buildReport(results, { startedAt, durationMs: clock.now() - began, backends: options.backends, runDir: options.runDir, interrupted: !!options.signal?.aborted });
  return { report, reports: writeReports(report, options.runDir) };
}

/** Runs the `run` subcommand; returns the exit code: 0 when every flow passed or was skipped, 1 on failures, 2 on usage errors. */
export async function runCommand(args: string[], io: RunIO): Promise<number> {
  let options: ReturnType<typeof parse>;
  try { options = parse(args); } catch (error) { io.stderr(`${(error as Error).message}\n${USAGE}`); return 2; }
  const names = options.backends.length ? options.backends : Object.keys(io.backends);
  if (!names.length) { io.stderr(NO_BACKENDS); return 2; }
  const unknown = names.filter(name => !Object.hasOwn(io.backends, name));
  if (unknown.length) { io.stderr(`unknown backend ${unknown.join(", ")} (available: ${Object.keys(io.backends).join(", ") || "none"})`); return 2; }
  const backends: Backend[] = names.map(name => io.backends[name]!({ app: options.app && path.resolve(options.app) }));
  const platforms = new Set(backends.map(backend => backend.platform));
  if (platforms.size > 1) { io.stderr(`backends target different platforms: ${[...platforms].join(", ")}`); return 2; }

  const targets = (options.targets.length ? options.targets : [path.join(repo, "e2e")]).map(target => path.resolve(target));
  const missing = targets.filter(target => !existsSync(target));
  if (missing.length) { io.stderr(`not found: ${missing.join(", ")}`); return 2; }
  const notFlows = targets.filter(target => !statSync(target).isDirectory()).flatMap(collect).filter(([, kind]) => kind !== "flow");
  if (notFlows.length) { io.stderr(`not a flow: ${notFlows.map(([file, kind]) => `${path.relative(process.cwd(), file)} (${kind})`).join(", ")}`); return 2; }
  const files = targets.flatMap(collect).filter(([, kind]) => kind === "flow").map(([file]) => file);
  if (!files.length) { io.stderr(`no flows under ${targets.map(target => path.relative(process.cwd(), target) || ".").join(", ")}`); return 2; }

  const runDir = path.resolve(options.report ?? path.join(repo, "artifacts/e2e", `run-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  if (options.agent) io.stdout(JSON.stringify({ event: "run-start", runDir, platform: backends[0]!.platform, backends: backends.map(({ name, kind }) => ({ name, kind })), files: files.length }));
  const { report, reports } = await runSuite(files, { backends, runDir, app: options.app && path.resolve(options.app), clock: io.clock, signal: io.signal, onEvent: printer(io, options.agent) });
  const { summary } = report;
  if (options.agent) io.stdout(JSON.stringify({ event: "run-end", summary, interrupted: report.interrupted, reports }));
  else io.stdout(`${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped${report.interrupted ? " (interrupted)" : ""}. Report: ${path.relative(process.cwd(), reports.html)}`);
  return summary.failed ? 1 : 0;
}
