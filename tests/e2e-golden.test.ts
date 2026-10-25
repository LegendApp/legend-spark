import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { checkFlow } from "../scripts/e2e/format/parser.ts";
import { goldenCommand } from "../scripts/e2e/golden/approve.ts";
import { compare, deltaE2000, readPng, writePng, type Image } from "../scripts/e2e/golden/diff.ts";
import { checkGoldenId, goldenId } from "../scripts/e2e/golden/store.ts";
import { runFlows } from "../scripts/e2e/runner/executor.ts";
import { buildReport, html, writeReports } from "../scripts/e2e/runner/report.ts";
import { element, MemoryBackend, VirtualClock } from "./e2e-runner-backend.ts";

type Color = [number, number, number, number?];
const WHITE: Color = [255, 255, 255], BLACK: Color = [0, 0, 0];
function image(width: number, height: number, color: Color = WHITE): Image {
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) data.set([color[0], color[1], color[2], color[3] ?? 255], pixel * 4);
  return { width, height, data };
}
function fill(target: Image, x: number, y: number, width: number, height: number, color: Color): Image {
  for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) target.data.set([color[0], color[1], color[2], color[3] ?? 255], (row * target.width + column) * 4);
  return target;
}
const copy = (source: Image): Image => ({ ...source, data: Uint8Array.from(source.data) });
const at = (target: Image, x: number, y: number) => [...target.data.slice((y * target.width + x) * 4, (y * target.width + x) * 4 + 4)];

describe("CIEDE2000", () => {
  test("matches Sharma, Wu and Dalal's reference pairs", () => {
    const pairs: Array<[[number, number, number], [number, number, number], number]> = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 0, 0], [50, -1, 2], 2.3669],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
      [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
    ];
    for (const [a, b, expected] of pairs) expect(deltaE2000(a, b)).toBeCloseTo(expected, 4);
  });
});

describe("compare", () => {
  const options = { tolerance: 2, masks: [] };

  test("identical images have no differences", () => {
    const a = fill(image(20, 20), 5, 5, 4, 4, BLACK);
    expect(compare(a, copy(a), options).stats).toEqual({ compared: 400, different: 0, antialiased: 0, ratio: 0 });
  });

  test("a change below the colour tolerance is the same pixel; a visible one is not", () => {
    expect(compare(image(10, 10, [254, 254, 254]), image(10, 10), options).stats.different).toBe(0);
    expect(compare(image(10, 10, [230, 230, 230]), image(10, 10), options).stats.different).toBe(100);
  });

  test("an alpha change counts even when the colour over white is the same", () => {
    expect(compare(image(4, 4, [255, 255, 255, 0]), image(4, 4), options).stats.different).toBe(16);
  });

  test("anti-aliased edge pixels are tolerated, a solid change is not, and the diff image shows both", () => {
    // Black left half, white right half, a gray blend column at x=10 for rows 5-14.
    const expected = fill(fill(image(20, 20), 0, 0, 10, 20, BLACK), 10, 5, 1, 10, [160, 160, 160]);
    const actual = fill(fill(copy(expected), 10, 5, 1, 10, [90, 90, 90]), 14, 2, 3, 3, [255, 0, 0]);
    const { stats, diff } = compare(actual, expected, options);
    expect(stats).toMatchObject({ different: 9, antialiased: 10 });
    expect(at(diff, 15, 3)).toEqual([255, 0, 0, 255]);
    expect(at(diff, 10, 8)).toEqual([255, 200, 0, 255]);
  });

  test("masked pixels are not compared", () => {
    const expected = image(10, 10), actual = fill(copy(expected), 2, 2, 3, 3, BLACK);
    const { stats, diff } = compare(actual, expected, { tolerance: 2, masks: [{ x: 2, y: 2, width: 3, height: 3 }, { x: 8, y: 8, width: 10, height: 10 }] });
    expect(stats).toEqual({ compared: 87, different: 0, antialiased: 0, ratio: 0 });
    expect(at(diff, 3, 3)).toEqual([120, 160, 255, 255]);
  });

  test("masks outside the image mask nothing", () => {
    const masks = [{ x: -2, y: 0, width: 1, height: 1 }, { x: 12, y: 0, width: 3, height: 3 }];
    expect(compare(image(10, 10), image(10, 10), { tolerance: 2, masks }).stats.compared).toBe(100);
  });

  test("PNGs round-trip", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "golden-png-")), "a.png"), original = fill(image(7, 5), 1, 1, 2, 2, [10, 20, 30, 128]);
    writePng(file, original);
    expect(readPng(file)).toEqual({ width: 7, height: 5, data: Buffer.from(original.data) });
  });
});

describe("golden store", () => {
  test("appearance and locale are directories; other dimensions are sorted file-name suffixes", () => {
    expect(goldenId("macos", { locale: "ar", appearance: "dark" }, "catalog")).toBe("macos/dark/ar/catalog");
    expect(goldenId("macos", { reduceMotion: true, locale: "en", appearance: "light", density: "2x" }, "sheet")).toBe("macos/light/en/sheet+density-2x+reduceMotion-true");
    expect(() => goldenId("macos", { appearance: "light" }, "catalog")).toThrow("a golden needs locale in the matrix");
  });

  test("golden IDs are validated", () => {
    expect(checkGoldenId("windows/dark/en-US/x")).toBe("windows/dark/en-US/x");
    expect(() => checkGoldenId("macos/light/x")).toThrow("it must be <platform>/<appearance>/<locale>/<name>");
    expect(() => checkGoldenId("linux/light/en/x")).toThrow('platform "linux"');
    expect(() => checkGoldenId("macos/system/en/x")).toThrow('appearance "system"');
    expect(() => checkGoldenId("macos/light/en/../x")).toThrow("it must be");
  });

  test("a flow with assertScreenshot needs appearance and locale in its matrix", () => {
    const flow = (matrix: string) => `appId: a\nname: n\n${matrix}---\n- assertScreenshot: home\n`;
    expect(checkFlow(flow("matrix: { appearance: [dark] }\n")).diagnostics.map(diagnostic => diagnostic.message)).toEqual([
      "assertScreenshot needs locale in the header matrix: the golden path is golden/<platform>/<appearance>/<locale>/<name>.png",
    ]);
    expect(checkFlow(flow("matrix: { appearance: [dark], locale: [en] }\n")).diagnostics).toEqual([]);
  });
});

describe("assertScreenshot in the runner", () => {
  /** The app's window: 50x50 points at (100, 50) on screen, captured at 2x into 100x100 pixels. */
  const FRAME = { x: 100, y: 50, width: 50, height: 50 };
  const header = (matrix: string) => `appId: so.legend.kitchensink\nname: Golden\nintent: Shows the catalog.\nmatrix: ${matrix}\n---\n`;

  function setup(commands: string, goldens: Record<string, Image> = {}, matrix = "{ appearance: [light], locale: [en] }") {
    const root = mkdtempSync(path.join(tmpdir(), "e2e-golden-"));
    mkdirSync(path.join(root, "flows/area"), { recursive: true });
    writeFileSync(path.join(root, "flows/area/test.yaml"), header(matrix) + commands);
    for (const [id, golden] of Object.entries(goldens)) {
      mkdirSync(path.dirname(path.join(root, "golden", `${id}.png`)), { recursive: true });
      writePng(path.join(root, "golden", `${id}.png`), golden);
    }
    const screen = { image: image(100, 100) };
    const backend = new MemoryBackend(new VirtualClock(), {
      name: "driver", kind: "driver", matrix: ["appearance", "locale"], collect: false,
      elements: [element("clock", { id: "clock", frame: { x: 110, y: 60, width: 5, height: 5 } })],
      screenshot: async file => { writePng(file, screen.image); return { frame: FRAME, scale: 2 }; },
    });
    const runDir = path.join(root, "run");
    const run = async () => {
      const results = await runFlows([path.join(root, "flows/area/test.yaml")], { backends: [backend], runDir, clock: backend.clock });
      const report = buildReport(results, { startedAt: new Date(), durationMs: 0, backends: [backend], runDir, interrupted: false });
      writeReports(report, runDir);
      return { result: results[0]!, report };
    };
    return { root, runDir, screen, run, golden: (id: string) => path.join(root, "golden", `${id}.png`) };
  }
  const GOLDEN = "macos/light/en/home";

  test("an identical capture passes and is recorded", async () => {
    const { run, golden, runDir } = setup("- assertScreenshot: home\n", { [GOLDEN]: image(100, 100) });
    const { result, report } = await run();
    expect(result.status).toBe("passed");
    expect(result.goldens).toEqual([{ id: GOLDEN, golden: golden(GOLDEN), actual: path.join(runDir, "flows/area/test/appearance-light+locale-en/screenshots/home.png"), status: "passed", stats: { compared: 10000, different: 0, antialiased: 0, ratio: 0 } }]);
    expect(report.flows[0]!.goldens[0]).toMatchObject({ golden: path.relative(runDir, golden(GOLDEN)), actual: "flows/area/test/appearance-light+locale-en/screenshots/home.png" });
  });

  test("a change under the threshold passes; over it, the flow fails with the capture, the golden and a diff image", async () => {
    const under = setup("- assertScreenshot: { golden: home, threshold: 0.5% }\n", { [GOLDEN]: image(100, 100) });
    fill(under.screen.image, 0, 0, 5, 5, BLACK); // 25 of 10000 pixels: 0.25%
    expect((await under.run()).result.status).toBe("passed");

    const over = setup("- assertScreenshot: { golden: home, threshold: 0.1% }\n", { [GOLDEN]: image(100, 100) });
    fill(over.screen.image, 0, 0, 5, 5, BLACK);
    const { result, report } = await over.run();
    expect(result.failure).toMatchObject({ kind: "assertion", command: "assertScreenshot", message: expect.stringMatching(/^0\.250% of pixels \(25 of 10000\) differ from golden .*home\.png by more than ΔE 2; the threshold is 0\.1%/) });
    const dir = "flows/area/test/appearance-light+locale-en/screenshots";
    expect(report.flows[0]!.failure!.artifacts.map(artifact => [artifact.kind, artifact.path])).toEqual([
      ["screenshot", `${dir}/home.png`], ["golden", `${dir}/home.expected.png`], ["diff", `${dir}/home.diff.png`], ["elements", "flows/area/test/appearance-light+locale-en/failure/elements-driver.json"],
    ]);
    expect(report.flows[0]!.goldens[0]).toMatchObject({ status: "failed", diff: `${dir}/home.diff.png`, stats: { different: 25 } });
    expect(at(readPng(path.join(over.runDir, dir, "home.diff.png")), 2, 2)).toEqual([255, 0, 0, 255]);
    expect(html(report)).toContain('<img src="flows/area/test/appearance-light%2Blocale-en/screenshots/home.diff.png"');
  });

  test("the default threshold is 0%", async () => {
    const { run, screen } = setup("- assertScreenshot: home\n", { [GOLDEN]: image(100, 100) });
    fill(screen.image, 50, 50, 1, 1, BLACK);
    expect((await run()).result.failure?.message).toMatch(/^0\.010% of pixels \(1 of 10000\)/);
  });

  test("element masks (mapped from screen points) and explicit rects exclude regions", async () => {
    const { run, screen } = setup("- assertScreenshot: { golden: home, mask: [{ id: clock }], maskRects: [{ x: 40, y: 0, w: 10, h: 2.5 }] }\n", { [GOLDEN]: image(100, 100) });
    fill(screen.image, 20, 20, 10, 10, BLACK); // the clock: (110, 60) 5x5 points on screen
    fill(screen.image, 80, 0, 20, 5, BLACK);
    const { result } = await run();
    expect(result.status).toBe("passed");
    expect(result.goldens[0]!.stats).toEqual({ compared: 10000 - 100 - 100, different: 0, antialiased: 0, ratio: 0 });
  });

  test("a missing golden fails and is never created", async () => {
    const { run, golden, root } = setup("- assertScreenshot: home\n");
    const { result } = await run();
    expect(result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining("a run never creates one") });
    expect(result.goldens[0]!.status).toBe("missing");
    expect(result.failure!.artifacts.map(artifact => artifact.kind)).toEqual(["screenshot", "elements"]);
    expect(existsSync(golden(GOLDEN))).toBe(false);
    expect(existsSync(path.join(root, "golden"))).toBe(false);
  });

  test("a size change fails", async () => {
    const { run } = setup("- assertScreenshot: home\n", { [GOLDEN]: image(50, 50) });
    expect((await run()).result.failure?.message).toMatch(/^the capture is 100x100 but golden .* is 50x50/);
  });

  test("a subflow screenshot in a flow without appearance and locale is invalid", async () => {
    const { root, run } = setup("- runFlow: subflows/shot.yaml\n");
    writeFileSync(path.join(root, "flows/area/test.yaml"), "appId: a\nname: n\n---\n- runFlow: subflows/shot.yaml\n");
    mkdirSync(path.join(root, "subflows"));
    writeFileSync(path.join(root, "subflows/shot.yaml"), "- assertScreenshot: home\n");
    expect((await run()).result.failure).toMatchObject({ kind: "invalid", message: "assertScreenshot: a golden needs appearance and locale in the matrix" });
  });

  test("takeScreenshot stores a screenshot artifact; a driver without screenshot() is unsupported", async () => {
    const { run, runDir } = setup("- takeScreenshot: before\n");
    const { result } = await run();
    expect(result.artifacts).toEqual([{ kind: "screenshot", path: path.join(runDir, "flows/area/test/appearance-light+locale-en/output/before.png"), backend: "driver" }]);
    const backend = new MemoryBackend(new VirtualClock(), { name: "driver", kind: "driver" });
    const root = mkdtempSync(path.join(tmpdir(), "e2e-golden-"));
    writeFileSync(path.join(root, "flow.yaml"), "appId: a\nname: n\n---\n- takeScreenshot: x\n");
    const [unsupported] = await runFlows([path.join(root, "flow.yaml")], { backends: [backend], runDir: path.join(root, "run"), clock: backend.clock });
    expect(unsupported!.failure).toMatchObject({ kind: "unsupported", message: "takeScreenshot is not supported by backend driver (no screenshot())" });
  });

  describe("e2e:golden approve", () => {
    function io() {
      const out: string[] = [], err: string[] = [];
      return { out, err, io: { stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) } };
    }

    test("approving a run adds missing goldens and updates changed ones, printing what changed; passed ones stay", async () => {
      const commands = "- assertScreenshot: home\n";
      const added = setup(commands);
      await added.run();
      const first = io();
      expect(goldenCommand(["approve", added.runDir], "/unused", first.io)).toBe(0);
      expect(first.out).toEqual([expect.stringMatching(/^added .*golden\/macos\/light\/en\/home\.png \(100x100\) from .*screenshots\/home\.png$/)]);
      expect(readPng(added.golden(GOLDEN))).toEqual(readPng(path.join(added.runDir, "flows/area/test/appearance-light+locale-en/screenshots/home.png")));

      fill(added.screen.image, 0, 0, 10, 10, BLACK);
      expect((await added.run()).result.status).toBe("failed");
      const second = io();
      expect(goldenCommand(["approve", path.join(added.runDir, "flows/area/test")], "/unused", second.io)).toBe(0);
      expect(second.out).toEqual([expect.stringMatching(/^updated .*home\.png: 100 pixels changed \(1\.000%\), 100 beyond ΔE 2 \(1\.000%\)$/)]);
      expect((await added.run()).result.status).toBe("passed");
      const third = io();
      expect(goldenCommand(["approve", added.runDir], "/unused", third.io)).toBe(0);
      expect(third.out).toEqual([expect.stringMatching(/^unchanged .*home\.png: the capture passed$/)]);
    });

    test("approving one image approves only that image", async () => {
      const { run, runDir, golden } = setup("- assertScreenshot: home\n", {}, "{ appearance: [light, dark], locale: [en] }");
      expect((await run()).report.summary.failed).toBe(2);
      const { out, io: options } = io();
      expect(goldenCommand(["approve", path.join(runDir, "flows/area/test/appearance-dark+locale-en/screenshots/home.png")], "/unused", options)).toBe(0);
      expect(out).toEqual([expect.stringMatching(/^added .*golden\/macos\/dark\/en\/home\.png/)]);
      expect(existsSync(golden("macos/dark/en/home"))).toBe(true);
      expect(existsSync(golden("macos/light/en/home"))).toBe(false);
    });

    test("--to approves a capture made outside the runner at an explicit golden ID", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "e2e-golden-")), capture = path.join(dir, "catalog.png");
      writePng(capture, image(4, 4));
      const { out, io: options } = io();
      expect(goldenCommand(["approve", capture, "--to", "macos/dark/en/infra-shell-catalog"], path.join(dir, "e2e"), options)).toBe(0);
      expect(existsSync(path.join(dir, "e2e/golden/macos/dark/en/infra-shell-catalog.png"))).toBe(true);
      expect(out[0]).toMatch(/^added .*e2e\/golden\/macos\/dark\/en\/infra-shell-catalog\.png \(4x4\)/);
      expect(goldenCommand(["approve", capture, "--to", "macos/dusk/en/x"], path.join(dir, "e2e"), io().io)).toBe(2);
    });

    test("usage errors: no subcommand, a path outside a run, a run path with no captures", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "e2e-golden-"));
      const { err, io: options } = io();
      expect(goldenCommand([], dir, options)).toBe(2);
      expect(goldenCommand(["approve", dir], dir, options)).toBe(2);
      expect(err[1]).toContain("is not in a run directory");
      writeFileSync(path.join(dir, "report.json"), JSON.stringify({ flows: [] }));
      expect(goldenCommand(["approve", dir], dir, options)).toBe(2);
      expect(err[2]).toContain("no assertScreenshot captures under");
      expect(readFileSync(path.join(dir, "report.json"), "utf8")).toBe('{"flows":[]}');
    });
  });
});
