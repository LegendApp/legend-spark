// The failure bundle: one bundle.json per failed flow run, next to the evidence the runner already collected
// (docs/e2e-flows.md#failure-bundles). It points at artifacts; it never copies them.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SELECTOR_PROPS } from "../format/primitives.ts";
import type { Artifact, Backend, Matrix, Platform } from "./backend.ts";
import type { FailureReport, FlowResult } from "./executor.ts";
import type { GoldenResult } from "./screenshot.ts";

export const BUNDLE_FILE = "bundle.json";

/** Everything an agent needs to repair a failed flow run. Paths are relative to the directory holding bundle.json. */
export type FailureBundle = {
  version: 1;
  flow: Pick<FlowResult, "id" | "file" | "name" | "intent" | "checks" | "tags"> & { matrix: Matrix; source: string; env: Record<string, string> };
  failure: Omit<FailureReport, "location" | "stack"> & { location: string; stack: string[]; selector?: unknown };
  /** The last screenshot: the capture taken when the flow failed, else the last one the flow took. */
  screenshot?: string;
  /** Every assertScreenshot that did not pass: golden, capture, expected copy and diff. */
  goldens: GoldenResult[];
  /** All evidence in collection order: failure artifacts (element tree, screenshot, logs, traces) first, then the flow's own outputs. */
  artifacts: Artifact[];
  /** Every command that ran, subflows included, in order, with its status. */
  steps: FlowResult["steps"];
  errors: string[];
  run: { platform: Platform; backends: Array<Pick<Backend, "name" | "kind">>; app?: string; host?: object };
};

export type BundleInput = {
  result: FlowResult & { failure: FailureReport };
  /** The flow file as an absolute path. */
  source: string;
  env: Record<string, string>;
  platform: Platform;
  backends: Backend[];
  app?: string;
  host?: object;
};

const at = (location: FailureReport["location"]) => `${location.file}:${location.line}:${location.column}`;

/** The failing command's selector: its selector keys, or the selector of `visible` / `notVisible`. */
function selectorOf(args: Record<string, unknown> | undefined): unknown {
  if (!args) return undefined;
  const keys = Object.keys(SELECTOR_PROPS).filter(key => key in args);
  return keys.length ? Object.fromEntries(keys.map(key => [key, args[key]])) : args.visible ?? args.notVisible;
}

/** Writes `<dir>/bundle.json` for a failed run and returns its path. */
export function writeBundle(dir: string, input: BundleInput): string {
  const { result, source, env, platform, backends, app, host } = input;
  const from = (file: string) => path.relative(dir, file);
  const relative = (artifact: Artifact) => ({ ...artifact, path: from(artifact.path) });
  const { failure } = result;
  const artifacts = [...failure.artifacts, ...result.artifacts];
  const last = (list: Artifact[]) => list.filter(artifact => artifact.kind === "screenshot").at(-1);
  const screenshot = last(failure.artifacts) ?? last(result.artifacts);
  const bundle: FailureBundle = {
    version: 1,
    flow: { id: result.id, file: result.file, name: result.name, intent: result.intent, checks: result.checks, tags: result.tags, matrix: result.matrix, source: from(source), env },
    failure: { ...failure, location: at(failure.location), stack: failure.stack.map(at), selector: selectorOf(failure.args), artifacts: failure.artifacts.map(relative) },
    ...(screenshot ? { screenshot: from(screenshot.path) } : {}),
    goldens: result.goldens.filter(golden => golden.status !== "passed").map(({ golden, actual, diff, ...rest }) => ({ ...rest, golden: from(golden), actual: from(actual), ...(diff ? { diff: from(diff) } : {}) })),
    artifacts: artifacts.map(relative),
    steps: result.steps,
    errors: result.errors,
    run: { platform, backends: backends.map(({ name, kind }) => ({ name, kind })), ...(app ? { app } : {}), ...(host ? { host } : {}) },
  };
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, BUNDLE_FILE);
  writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`);
  return file;
}
