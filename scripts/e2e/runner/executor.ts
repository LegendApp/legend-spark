// Runs parsed flows against backends (docs/e2e-flows.md#running-flows).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { COMMANDS } from "../format/commands.ts";
import { checkFlow, checkSubflow, formatDiagnostic, type Condition, type FlowAst, type FlowCommand, type SourceLocation } from "../format/parser.ts";
import { NESTED, SELECTOR_PROPS } from "../format/primitives.ts";
import {
  Failure, RETRYABLE, type Artifact, type Backend, type Candidate, type CommandContext, type FailureKind, type Matrix, type Target, type WindowInfo,
} from "./backend.ts";
import { candidate, center, describe, filterElements, locate, nearby, parseSelector, parseWindow, pickWindows, type Finder, type Located, type Selector } from "./selectors.ts";

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_FLOW_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 100;

export type Clock = { now(): number; sleep(ms: number): Promise<void> };
export const realClock: Clock = { now: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };

export type StepResult = { command: string; location: SourceLocation; depth: number; status: "passed" | "failed" | "skipped"; durationMs: number };
export type FailureReport = {
  kind: FailureKind;
  message: string;
  /** The innermost command that failed, and the runFlow / repeat / nested-command call sites that led to it. */
  command?: string;
  location: SourceLocation;
  stack: SourceLocation[];
  candidates: Candidate[];
  matches: Candidate[];
  artifacts: Artifact[];
  diagnostics?: string[];
};
export type FlowResult = {
  id: string;
  file: string;
  name?: string;
  intent?: string;
  checks: string[];
  tags: string[];
  matrix: Matrix;
  status: "passed" | "failed" | "skipped";
  skipReason?: string;
  durationMs: number;
  steps: StepResult[];
  failure?: FailureReport;
  /** Problems after the first failure: onFlowComplete, restoration, artifact collection, backend shutdown. */
  errors: string[];
  /** Files the flow produced on purpose (takeScreenshot). */
  artifacts: Artifact[];
  /** Measurements recorded by backends, by metric name, in recording order. */
  metrics: Record<string, number[]>;
};
export type RunEvent = { event: "flow-start"; id: string; file: string; name?: string; intent?: string; matrix: Matrix } | { event: "flow-end"; result: FlowResult };
export type RunOptions = {
  backends: Backend[]; runDir: string; app?: string; clock?: Clock; signal?: AbortSignal; onEvent?(event: RunEvent): void;
  /** Clock time after which every flow fails with `timeout`: the whole run's time budget. */
  deadline?: number;
};

/** `120ms`, `1.5s`, `2m`, or a bare number of milliseconds. */
export function ms(value: string | number): number {
  if (typeof value === "number") return value;
  const [, amount, unit] = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(value)!;
  return Number(amount) * { ms: 1, s: 1000, m: 60_000 }[unit as "ms" | "s" | "m"];
}

/** Every combination of the header matrix, in header order. A flow without a matrix runs once. */
export const expandMatrix = (matrix: Record<string, Array<string | boolean>> = {}): Matrix[] =>
  Object.entries(matrix).reduce<Matrix[]>((combos, [dimension, values]) => combos.flatMap(combo => values.map(value => ({ ...combo, [dimension]: value }))), [{}]);

const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
type Env = Record<string, string>;
function interpolate<T>(value: T, env: Env): T {
  if (typeof value === "string") return value.replace(VARIABLE, (_, name: string) => {
    if (!Object.hasOwn(env, name)) throw new Failure("invalid", `\${${name}} is not defined (defined: ${Object.keys(env).sort().join(", ")})`);
    return env[name]!;
  }) as T;
  if (Array.isArray(value)) return value.map(item => interpolate(item, env)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, env)])) as T;
  return value;
}
/** Interpolates a command's own arguments; nested commands are interpolated when they run, with their own env. */
function interpolateArgs(command: FlowCommand, env: Env): Record<string, unknown> {
  const props = COMMANDS[command.name]!.props;
  return Object.fromEntries(Object.entries(command.args).map(([key, value]) => [key, NESTED.has(props[key]!) ? value : interpolate(value, env)]));
}
const selectorArgs = (args: Record<string, unknown>) => Object.fromEntries(Object.entries(args).filter(([key]) => key in SELECTOR_PROPS));

/** The e2e root of a flow: the parent of its nearest `flows` directory, else its own directory. */
export function rootOf(file: string): string {
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) if (path.basename(dir) === "flows") return path.dirname(dir);
  return path.dirname(file);
}

class CommandError extends Error {
  constructor(readonly failure: Failure, readonly command: FlowCommand, readonly callers: SourceLocation[]) { super(failure.message); }
}
const toFailure = (error: unknown) => error instanceof Failure ? error : new Failure("error", error instanceof Error ? error.message : String(error));
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Which backend may run a catalog command: driver commands need a driver backend; lifecycle commands take either kind. */
function route(name: string, backends: Backend[]): Backend {
  const spec = COMMANDS[name]!;
  const kinds = spec.driver ? ["driver"] : spec.group === "lifecycle" ? ["black-box", "driver"] : ["black-box"];
  const eligible = backends.filter(backend => kinds.includes(backend.kind));
  if (!eligible.length) throw new Failure("unsupported", `${name} needs a ${kinds.join(" or ")} backend (active: ${backends.map(backend => `${backend.name} (${backend.kind})`).join(", ")})`);
  const backend = eligible.find(candidate => Object.hasOwn(candidate.commands, name));
  if (!backend) throw new Failure("unsupported", `${name} is not supported by backend ${eligible.map(candidate => candidate.name).join(", ")}`);
  return backend;
}

function finderFor(backend: Backend): Finder {
  return {
    async find(atom, scope) {
      const keys = Object.keys(atom) as Array<keyof typeof atom>;
      if (backend.query && keys.length && keys.every(key => backend.queryKeys?.has(key))) return backend.query(atom, scope);
      if (backend.elements) return filterElements(await backend.elements(), atom, scope);
      throw new Failure("unsupported", `backend ${backend.name} cannot select by ${keys.length ? keys.join(", ") : "position alone (it cannot list elements)"}`);
    },
    async windows() {
      if (!backend.windows) throw new Failure("unsupported", `backend ${backend.name} cannot select windows`);
      return backend.windows();
    },
  };
}

type Mode = "one" | "any" | "none";
/** Turns one lookup into a target, or a retryable failure that explains the miss. */
function settle(selector: Selector, located: Located, mode: Mode): Target | undefined {
  const what = describe(selector.source);
  if (located.problem) {
    const { part, found } = located.problem;
    if (!found.length && mode === "none") return undefined;
    const kind = found.length ? "ambiguous" : "not-found";
    throw new Failure(kind, `${describe(part)} in ${what} ${found.length ? `matched ${found.length} elements; it must match one` : "matched nothing"}`, { matches: found.map(candidate) });
  }
  const { matches } = located;
  if (mode === "none") {
    if (!matches.length) return undefined;
    throw new Failure("assertion", `${what} is visible (${matches.length} match${matches.length === 1 ? "" : "es"})`, { matches: matches.map(candidate) });
  }
  if (!matches.length) throw new Failure("not-found", `no element matches ${what}`);
  if (mode === "one" && matches.length > 1) throw new Failure("ambiguous", `${what} matches ${matches.length} elements; add id, within, window or index`, { matches: matches.map(candidate) });
  return { element: matches[0]!, point: located.point ?? center(matches[0]!.frame) };
}

type Scope = { file: string; env: Env; stack: SourceLocation[]; files: string[]; depth: number };

async function executeFlow(flow: FlowAst, absolute: string, matrix: Matrix, base: Pick<FlowResult, "id" | "file" | "name" | "intent" | "checks" | "tags">, dir: string, options: RunOptions): Promise<FlowResult> {
  const { backends, signal } = options;
  const clock = options.clock ?? realClock;
  const platform = backends[0]!.platform;
  const began = clock.now();
  const flowTimeout = flow.header.timeout === undefined ? DEFAULT_FLOW_TIMEOUT_MS : ms(flow.header.timeout);
  const deadline = began + flowTimeout;
  const steps: StepResult[] = [], errors: string[] = [], outputs: Artifact[] = [];
  const metrics: Record<string, number[]> = {};
  const restores: Array<{ label: string; undo: () => Promise<void> }> = [];
  const result = (status: FlowResult["status"], extra: Partial<FlowResult> = {}): FlowResult =>
    ({ ...base, matrix, status, durationMs: Math.round(clock.now() - began), steps, errors, artifacts: outputs, metrics, ...extra });
  if (flow.header.platforms && !flow.header.platforms.includes(platform)) return result("skipped", { skipReason: `platforms: ${flow.header.platforms.join(", ")} (running ${platform})` });

  const outputDir = path.join(dir, "output");
  mkdirSync(path.join(dir, "tmp"), { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  const live = () => {
    if (signal?.aborted) throw new Failure("interrupted", "the run was interrupted");
    if (clock.now() > deadline) throw new Failure("timeout", `the flow exceeded its ${flowTimeout}ms timeout`);
    if (options.deadline !== undefined && clock.now() > options.deadline) throw new Failure("timeout", "the run exceeded its time budget");
  };
  async function eventually<T>(check: () => Promise<T>, timeoutMs: number): Promise<T> {
    const until = clock.now() + timeoutMs;
    for (;;) {
      live();
      try { return await check(); } catch (error) {
        if (!(error instanceof Failure && RETRYABLE.has(error.kind)) || clock.now() >= until) throw error;
      }
      await clock.sleep(POLL_MS);
    }
  }
  /** Waits for a selector to reach `mode` on a backend; a miss lists nearby candidates when the backend can list elements. */
  async function find(backend: Backend, value: unknown, mode: Mode, timeoutMs: number): Promise<Target | undefined> {
    const selector = parseSelector(value, platform), finder = finderFor(backend);
    try {
      return await eventually(async () => settle(selector, await locate(selector, finder), mode), timeoutMs);
    } catch (error) {
      if (!(error instanceof Failure) || !RETRYABLE.has(error.kind)) throw error;
      error.message += ` (waited ${timeoutMs}ms on ${backend.name})`;
      if (error.kind === "not-found" && backend.elements) error.details.candidates = nearby(selector, await backend.elements());
      throw error;
    }
  }
  /** Visibility checks (assertVisible, extendedWaitUntil, when) are black-box. */
  const observer = (name: string) => {
    const backend = backends.find(candidate => candidate.kind === "black-box");
    if (!backend) throw new Failure("unsupported", `${name} needs a black-box backend (active: ${backends.map(candidate => candidate.name).join(", ")})`);
    return backend;
  };
  async function holds(condition: Condition, name: string): Promise<boolean> {
    if (condition.platform && condition.platform !== platform) return false;
    if (condition.matrix && Object.entries(condition.matrix).some(([dimension, value]) => matrix[dimension] !== value)) return false;
    const visible = async (value: unknown) => {
      const located = await locate(parseSelector(value, platform), finderFor(observer(`${name} when`)));
      return !located.problem && located.matches.length > 0;
    };
    if (condition.visible !== undefined && !(await visible(condition.visible))) return false;
    if (condition.notVisible !== undefined && (await visible(condition.notVisible))) return false;
    return true;
  }

  const child = (scope: Scope, command: FlowCommand, extra: Partial<Scope> = {}): Scope =>
    ({ ...scope, stack: [...scope.stack, command.location], depth: scope.depth + 1, ...extra });
  async function runAll(commands: FlowCommand[], scope: Scope) { for (const command of commands) await exec(command, scope); }

  async function runFlowCommand(args: Record<string, unknown>, command: FlowCommand, scope: Scope) {
    const env = { ...scope.env, ...(args.env as Env | undefined) };
    if (args.commands) return runAll(args.commands as FlowCommand[], child(scope, command, { env }));
    const file = String(args.file);
    const target = /^\.\.?\//.test(file) ? path.resolve(path.dirname(scope.file), file) : path.resolve(rootOf(absolute), file);
    if (scope.files.includes(target)) throw new Failure("invalid", `runFlow cycle: ${[...scope.files, target].map(item => path.relative(process.cwd(), item)).join(" -> ")}`);
    let source: string;
    try { source = readFileSync(target, "utf8"); } catch (error) { throw new Failure("invalid", `runFlow cannot read ${file}: ${message(error)}`); }
    const checked = checkSubflow(source, path.relative(process.cwd(), target));
    if (!checked.value) throw new Failure("format", `runFlow ${file} is not a valid subflow:\n${checked.diagnostics.map(formatDiagnostic).join("\n")}`);
    await runAll(checked.value, child(scope, command, { env, file: target, files: [...scope.files, target] }));
  }

  async function dispatch(command: FlowCommand, args: Record<string, unknown>, scope: Scope) {
    const timeoutMs = command.timeout === undefined ? DEFAULT_TIMEOUT_MS : ms(command.timeout);
    switch (command.name) {
      case "runFlow": return runFlowCommand(args, command, scope);
      case "repeat":
        for (let index = 0; args.times === undefined || index < (args.times as number); index++) {
          live();
          if (args.while && !(await holds(args.while as Condition, command.name))) break;
          await runAll(args.commands as FlowCommand[], child(scope, command));
        }
        return;
      case "extendedWaitUntil":
        await find(observer(command.name), args.visible ?? args.notVisible, args.visible !== undefined ? "any" : "none", timeoutMs);
        return;
      case "assertVisible": await find(observer(command.name), selectorArgs(args), "any", timeoutMs); return;
      case "assertNotVisible": await find(observer(command.name), selectorArgs(args), "none", timeoutMs); return;
    }
    const backend = route(command.name, backends);
    const context: CommandContext = {
      command: { ...command, args }, timeoutMs, platform, matrix, outputDir,
      resolve: async value => (await find(backend, value, "one", timeoutMs))!,
      target: () => context.resolve(selectorArgs(args)),
      window: value => eventually(async () => {
        const windows = await finderFor(backend).windows(), found = pickWindows(parseWindow(value, platform), windows);
        if (found.length === 1) return found[0]!;
        const titles = (list: WindowInfo[]) => list.map(window => JSON.stringify(window.title)).join(", ") || "none";
        throw new Failure(found.length ? "ambiguous" : "not-found", `window ${describe(value)} matches ${found.length ? titles(found) : `nothing (windows: ${titles(windows)})`}`);
      }, timeoutMs),
      eventually: check => eventually(check, timeoutMs),
      onRestore: (label, undo) => { restores.push({ label, undo }); },
      run: commands => runAll(commands, child(scope, command)),
      addArtifact: artifact => { outputs.push({ ...artifact, backend: backend.name }); },
      metric: (name, value) => {
        if (!Number.isFinite(value)) throw new Failure("error", `metric ${name} must be a finite number, not ${value}`);
        (metrics[name] ??= []).push(value);
      },
    };
    await backend.commands[command.name]!(args, context);
  }

  async function exec(command: FlowCommand, scope: Scope) {
    const step: StepResult = { command: command.name, location: command.location, depth: scope.depth, status: "passed", durationMs: 0 };
    steps.push(step);
    const start = clock.now();
    try {
      live();
      if (command.when && !(await holds(interpolate(command.when, scope.env), command.name))) step.status = "skipped";
      else await dispatch(command, interpolateArgs(command, scope.env), scope);
    } catch (error) {
      step.status = "failed";
      throw error instanceof CommandError ? error : new CommandError(toFailure(error), command, scope.stack);
    } finally {
      step.durationMs = Math.round(clock.now() - start);
    }
  }

  const started: Backend[] = [];
  /** Failure evidence from every started backend: its element tree, plus whatever it collects (screenshot, logs, trace). */
  async function collect(): Promise<Artifact[]> {
    const out = path.join(dir, "failure");
    mkdirSync(out, { recursive: true });
    const artifacts: Artifact[] = [];
    for (const backend of started) {
      try {
        if (backend.elements) {
          const file = path.join(out, `elements-${backend.name}.json`);
          writeFileSync(file, `${JSON.stringify({ windows: backend.windows ? await backend.windows() : undefined, elements: await backend.elements() }, null, 2)}\n`);
          artifacts.push({ kind: "elements", path: file, backend: backend.name });
        }
        if (backend.collect) artifacts.push(...(await backend.collect(out)).map(artifact => ({ ...artifact, backend: backend.name })));
      } catch (error) {
        errors.push(`artifacts from ${backend.name}: ${message(error)}`);
      }
    }
    return artifacts;
  }

  const headerLocation: SourceLocation = { file: flow.file, line: 1, column: 1 };
  let failure: FailureReport | undefined;
  async function fail(error: unknown) {
    const { failure: cause, command, callers } = error instanceof CommandError ? error : { failure: toFailure(error), command: undefined, callers: [] };
    failure = {
      kind: cause.kind, message: cause.message, command: command?.name, location: command?.location ?? headerLocation, stack: callers,
      candidates: cause.details.candidates ?? [], matches: cause.details.matches ?? [], artifacts: await collect(),
    };
  }

  const env: Env = { FIXTURES: path.join(rootOf(absolute), "fixtures"), TMP: path.join(dir, "tmp"), ...(options.app ? { APP_PATH: options.app } : {}) };
  const scope: Scope = { file: absolute, env, stack: [], files: [absolute], depth: 0 };
  try {
    live();
    Object.assign(env, interpolate(flow.header.env ?? {}, env));
    for (const dimension of Object.keys(matrix)) {
      if (!backends.some(backend => backend.matrix.has(dimension))) throw new Failure("unsupported", `no active backend applies matrix dimension ${dimension} (active: ${backends.map(backend => backend.name).join(", ")})`);
    }
    for (const backend of backends) {
      const own = path.join(dir, `backend-${backend.name}`);
      mkdirSync(own, { recursive: true });
      await backend.start({ flow, matrix, platform, app: options.app, dir: own });
      started.push(backend);
    }
    await runAll(flow.header.onFlowStart ?? [], scope);
    await runAll(flow.commands, scope);
  } catch (error) {
    await fail(error);
  }
  if (flow.header.onFlowComplete && started.length === backends.length) {
    try { await runAll(flow.header.onFlowComplete, scope); } catch (error) {
      if (failure) errors.push(`onFlowComplete: ${message(error)}`);
      else await fail(error);
    }
  }
  const restoreErrors: string[] = [];
  for (const { label, undo } of restores.reverse()) {
    try { await undo(); } catch (error) { restoreErrors.push(`restore ${label}: ${message(error)}`); }
  }
  if (restoreErrors.length && !failure) failure = { kind: "restore", message: restoreErrors.join("\n"), location: headerLocation, stack: [], candidates: [], matches: [], artifacts: [] };
  else errors.push(...restoreErrors);
  for (const backend of started.reverse()) {
    try { await backend.stop(); } catch (error) { errors.push(`stop ${backend.name}: ${message(error)}`); }
  }
  return result(failure ? "failed" : "passed", { failure });
}

/** Parses and runs flow files, every matrix combination, in order. Invalid flows are reported as `format` failures. */
export async function runFlows(files: string[], options: RunOptions): Promise<FlowResult[]> {
  if (!options.backends.length) throw new Error("no backends to run flows with");
  const platforms = new Set(options.backends.map(backend => backend.platform));
  if (platforms.size > 1) throw new Error(`backends target different platforms: ${[...platforms].join(", ")}`);
  const results: FlowResult[] = [];
  for (const absolute of files) {
    const file = path.relative(process.cwd(), absolute);
    const relative = path.relative(rootOf(absolute), absolute).replace(/\.ya?ml$/, "");
    const checked = checkFlow(readFileSync(absolute, "utf8"), file);
    if (!checked.value) {
      const { file: at, line, column } = checked.diagnostics[0]!;
      const result: FlowResult = {
        id: relative, file, checks: [], tags: [], matrix: {}, status: "failed", durationMs: 0, steps: [], errors: [], artifacts: [], metrics: {},
        failure: { kind: "format", message: `${file} is not a valid flow`, location: { file: at, line, column }, stack: [], candidates: [], matches: [], artifacts: [], diagnostics: checked.diagnostics.map(formatDiagnostic) },
      };
      options.onEvent?.({ event: "flow-end", result });
      results.push(result);
      continue;
    }
    const flow = checked.value;
    for (const matrix of expandMatrix(flow.header.matrix)) {
      const suffix = Object.entries(matrix).map(([dimension, value]) => `${dimension}=${value}`).join(",");
      const base = { id: suffix ? `${relative}[${suffix}]` : relative, file, name: flow.header.name, intent: flow.header.intent, checks: flow.header.checks ?? [], tags: flow.header.tags ?? [] };
      options.onEvent?.({ event: "flow-start", id: base.id, file, name: base.name, intent: base.intent, matrix });
      const dir = path.join(options.runDir, relative, suffix ? suffix.replace(/=/g, "-").replace(/,/g, "+") : "run");
      const result = await executeFlow(flow, absolute, matrix, base, dir, options);
      options.onEvent?.({ event: "flow-end", result });
      results.push(result);
    }
  }
  return results;
}
