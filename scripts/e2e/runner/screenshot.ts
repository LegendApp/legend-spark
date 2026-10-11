// takeScreenshot and assertScreenshot: the runner captures through Backend.screenshot and compares with the golden store
// (docs/e2e-flows.md#visual-goldens). Runs never write goldens; only `bun run e2e:golden approve` does.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { compare, DEFAULT_TOLERANCE, readPng, writePng, type DiffStats, type PixelRect } from "../golden/diff.ts";
import { goldenFile, goldenId } from "../golden/store.ts";
import { Failure, type Artifact, type Backend, type Capture, type CommandContext, type Rect } from "./backend.ts";

/** One assertScreenshot, recorded in the flow result so `e2e:golden approve` can find the capture and its golden. */
export type GoldenResult = {
  /** `<platform>/<appearance>/<locale>/<name>`, relative to golden/. */
  id: string;
  golden: string;
  actual: string;
  status: "passed" | "failed" | "missing";
  diff?: string;
  stats?: DiffStats;
};

const shown = (file: string) => path.relative(process.cwd(), file);
const windowOf = async (args: Record<string, unknown>, context: CommandContext) => args.window === undefined ? undefined : context.window(args.window);

export async function takeScreenshot(backend: Backend, args: Record<string, unknown>, context: CommandContext) {
  const file = path.join(context.outputDir, `${args.name}.png`);
  await backend.screenshot!(file, await windowOf(args, context));
  context.addArtifact({ kind: "screenshot", path: file });
}

/** A rectangle in points from the capture's origin, as image pixels, grown to whole pixels. */
function pixels(rect: Rect, capture: Capture, from = { x: 0, y: 0 }): PixelRect {
  const x = Math.floor((rect.x - from.x) * capture.scale), y = Math.floor((rect.y - from.y) * capture.scale);
  return { x, y, width: Math.ceil((rect.x - from.x + rect.width) * capture.scale) - x, height: Math.ceil((rect.y - from.y + rect.height) * capture.scale) - y };
}

export async function assertScreenshot(backend: Backend, args: Record<string, unknown>, context: CommandContext, flow: { root: string; dir: string; record(result: GoldenResult): void }) {
  let id: string;
  try { id = goldenId(context.platform, context.matrix, String(args.golden)); } catch (error) { throw new Failure("invalid", `assertScreenshot: ${(error as Error).message}`); }
  const window = await windowOf(args, context);
  const elements = [];
  for (const selector of (args.mask as unknown[] | undefined) ?? []) elements.push((await context.resolve(selector)).element.frame);
  const out = path.join(flow.dir, "screenshots");
  mkdirSync(out, { recursive: true });
  const golden = goldenFile(flow.root, id), actual = path.join(out, `${args.golden}.png`);
  const capture = await backend.screenshot!(actual, window);
  const result: GoldenResult = { id, golden, actual, status: "missing" };
  flow.record(result);
  const evidence: Artifact[] = [{ kind: "screenshot", path: actual }];
  const approve = `review it, then approve it with \`bun run e2e:golden approve ${shown(actual)}\``;
  if (!existsSync(golden)) throw new Failure("assertion", `no golden at ${shown(golden)}; a run never creates one: ${approve}`, { artifacts: evidence });

  result.status = "failed";
  const expected = path.join(out, `${args.golden}.expected.png`);
  const [now, before] = [readPng(actual), readPng(golden)];
  if (now.width !== before.width || now.height !== before.height) {
    copyFileSync(golden, expected);
    throw new Failure("assertion", `the capture is ${now.width}x${now.height} but golden ${shown(golden)} is ${before.width}x${before.height}; if the new size is right, ${approve}`, { artifacts: [...evidence, { kind: "golden", path: expected }] });
  }
  const tolerance = (args.tolerance as number | undefined) ?? DEFAULT_TOLERANCE, threshold = parseFloat((args.threshold as string | undefined) ?? "0%");
  const masks = [...elements.map(frame => pixels(frame, capture, capture.frame)), ...((args.maskRects as Array<{ x: number; y: number; w: number; h: number }> | undefined) ?? []).map(({ x, y, w, h }) => pixels({ x, y, width: w, height: h }, capture))];
  const { stats, diff } = compare(now, before, { tolerance, masks });
  result.stats = stats;
  if (stats.ratio * 100 <= threshold) { result.status = "passed"; return; }
  result.diff = path.join(out, `${args.golden}.diff.png`);
  writePng(result.diff, diff);
  copyFileSync(golden, expected);
  throw new Failure("assertion", `${(stats.ratio * 100).toFixed(3)}% of pixels (${stats.different} of ${stats.compared}) differ from golden ${shown(golden)} by more than ΔE ${tolerance}; the threshold is ${threshold}% (${stats.antialiased} anti-aliased pixels tolerated). If the change is intended, ${approve}`, {
    artifacts: [...evidence, { kind: "golden", path: expected }, { kind: "diff", path: result.diff }],
  });
}
