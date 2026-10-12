// `bun run e2e:golden approve <run dir | flow dir in a run | capture.png>` and `approve <file.png> --to <golden id>`:
// the only way goldens change (docs/e2e-flows.md#approving-goldens).
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { RunReport } from "../runner/report.ts";
import type { GoldenResult } from "../runner/screenshot.ts";
import { compare, DEFAULT_TOLERANCE, readPng } from "./diff.ts";
import { checkGoldenId, goldenFile } from "./store.ts";

export const GOLDEN_USAGE = "usage: bun run e2e:golden approve <run dir | path in a run dir> | bun run e2e:golden approve <file.png> --to <platform>/<appearance>/<locale>/<name>";
type IO = { stdout(line: string): void; stderr(line: string): void };
const shown = (file: string) => path.relative(process.cwd(), file);

/** Copies `actual` over `golden` and says what changed. Identical images are left alone. */
function approve(actual: string, golden: string, io: IO) {
  const now = readPng(actual);
  if (!existsSync(golden)) {
    io.stdout(`added ${shown(golden)} (${now.width}x${now.height}) from ${shown(actual)}`);
  } else {
    const before = readPng(golden);
    if (before.width !== now.width || before.height !== now.height) io.stdout(`updated ${shown(golden)}: ${before.width}x${before.height} -> ${now.width}x${now.height}`);
    else if (Buffer.compare(Buffer.from(before.data), Buffer.from(now.data)) === 0) return io.stdout(`unchanged ${shown(golden)}: identical pixels`);
    else {
      const { stats } = compare(now, before, { tolerance: 0, masks: [] });
      const { stats: visible } = compare(now, before, { tolerance: DEFAULT_TOLERANCE, masks: [] });
      io.stdout(`updated ${shown(golden)}: ${stats.different} pixels changed (${(stats.ratio * 100).toFixed(3)}%), ${visible.different} beyond ΔE ${DEFAULT_TOLERANCE} (${(visible.ratio * 100).toFixed(3)}%)`);
    }
  }
  mkdirSync(path.dirname(golden), { recursive: true });
  copyFileSync(actual, golden);
}

/** The run directory holding `target`: the nearest directory at or above it with a report.json. */
function runDirOf(target: string): string | undefined {
  for (let dir = statSync(target).isDirectory() ? target : path.dirname(target); dir !== path.dirname(dir); dir = path.dirname(dir)) if (existsSync(path.join(dir, "report.json"))) return dir;
}

/** Runs `e2e:golden`; returns the exit code (0 done, 2 usage error or nothing to approve). */
export function goldenCommand(args: string[], e2eRoot: string, io: IO): number {
  const [mode, target, ...rest] = args;
  const usage = (message: string) => { io.stderr(`${message}\n${GOLDEN_USAGE}`); return 2; };
  if (mode !== "approve" || !target) return usage("e2e:golden needs `approve` and a path");
  const file = path.resolve(target);
  if (!existsSync(file)) return usage(`not found: ${target}`);
  if (rest.length) {
    if (rest[0] !== "--to" || rest.length !== 2) return usage(`unexpected arguments: ${rest.join(" ")}`);
    let id: string;
    try { id = checkGoldenId(rest[1]!); } catch (error) { return usage((error as Error).message); }
    approve(file, goldenFile(e2eRoot, id), io);
    return 0;
  }
  const runDir = runDirOf(file);
  if (!runDir) return usage(`${target} is not in a run directory (no report.json at or above it); for a capture made outside the runner, pass --to <golden id>`);
  const report = JSON.parse(readFileSync(path.join(runDir, "report.json"), "utf8")) as RunReport;
  const inside = (actual: string) => actual === file || actual.startsWith(`${file}${path.sep}`);
  const selected = report.flows.flatMap(flow => flow.goldens ?? []).map(golden => ({ ...golden, golden: path.resolve(runDir, golden.golden), actual: path.resolve(runDir, golden.actual) })).filter(golden => inside(golden.actual));
  if (!selected.length) return usage(`no assertScreenshot captures under ${target}`);
  const changed = selected.filter(golden => golden.status !== "passed");
  const twice = changed.find(golden => changed.some(other => other.golden === golden.golden && other.actual !== golden.actual));
  if (twice) return usage(`more than one capture under ${target} would replace ${shown(twice.golden)}; approve one of them by its path`);
  for (const golden of selected as GoldenResult[]) {
    if (golden.status === "passed") io.stdout(`unchanged ${shown(golden.golden)}: the capture passed`);
    else approve(golden.actual, golden.golden, io);
  }
  return 0;
}
