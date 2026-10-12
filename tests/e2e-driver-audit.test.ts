import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { AuditElement, AuditFacts } from "../scripts/e2e/driver.ts";
import { AREAS } from "../examples/kitchen-sink/shell/areas.ts";
import { parseFlow } from "../scripts/e2e/format/parser.ts";
import { writePng, type Image } from "../scripts/e2e/golden/diff.ts";
import { DriverBackend } from "../scripts/e2e/runner/driver-backend.ts";
import { contrastRatio, dominantColor, judgeAudit, type AuditReport } from "../scripts/e2e/runner/driver-audit.ts";
import { runFlows } from "../scripts/e2e/runner/executor.ts";
import { FakeApp } from "./e2e-driver-fake.ts";
import { VirtualClock } from "./e2e-runner-backend.ts";

/** A `width` × `height` image of `background`, with `ink` in the rectangle `glyph` (the drawn text). */
function image(width: number, height: number, background: number[], ink?: { color: number[]; glyph: { x: number; y: number; width: number; height: number } }): Image {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = ink && x >= ink.glyph.x && x < ink.glyph.x + ink.glyph.width && y >= ink.glyph.y && y < ink.glyph.y + ink.glyph.height;
    data.set([...(inside ? ink.color : background), 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
const FRAME = { x: 0, y: 0, width: 50, height: 20 };
const SAMPLE = { x: 0, y: 0, width: 100, height: 40 };
const text = (overrides: Partial<AuditElement>): AuditElement => ({
  key: "0", window: "spark.main", frame: FRAME, element: true, enabled: true, opacity: 1, role: "staticText", within: "screen-root",
  text: "Hello", textStyle: { colors: [{ r: 0, g: 0, b: 0, a: 1 }], unresolved: false, size: 13, bold: false }, capture: 0, sample: SAMPLE, ...overrides,
});
const facts = (elements: AuditElement[]): AuditFacts => ({ windows: [{ id: "spark.main", title: "Kitchen Sink" }], captures: [{ file: "capture-0.png", window: "spark.main", width: 100, height: 40, scale: 2 }], elements });
const judge = (elements: AuditElement[], capture = image(100, 40, [255, 255, 255], { color: [0, 0, 0], glyph: { x: 10, y: 10, width: 30, height: 8 } })) =>
  judgeAudit(facts(elements), "window", () => capture);

describe("contrast", () => {
  test("ratios follow WCAG 2 relative luminance", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 })).toBe(1);
    // #767676 on white is the classic 4.54:1.
    expect(contrastRatio({ r: 0x76, g: 0x76, b: 0x76 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(4.54, 2);
  });
  test("the background is the most frequent colour behind the text, whatever the glyphs draw", () => {
    expect(dominantColor(image(100, 40, [30, 30, 30], { color: [250, 250, 250], glyph: { x: 0, y: 0, width: 60, height: 15 } }), SAMPLE)).toEqual({ r: 30, g: 30, b: 30 });
  });
  test("text below 4.5:1 is an error with its colours, ratio, capture and sample; at or above passes", () => {
    const report = judge([text({ key: "a", textStyle: { colors: [{ r: 0x99, g: 0x99, b: 0x99, a: 1 }], unresolved: false, size: 13, bold: false } }), text({ key: "b" })]);
    expect(report.errors).toEqual([expect.objectContaining({
      rule: "contrast", ratio: 2.85, required: 4.5, foreground: "#999999", background: "#ffffff", capture: "capture-0.png", sample: SAMPLE,
      message: 'staticText "Hello" in screen-root at 0,0 (spark.main) has contrast 2.85:1 (#999999 on #ffffff), below 4.5:1 for 13-point text',
    })]);
    expect(report.counts).toEqual({ elements: 2, described: 0, operable: 0, texts: 2, measured: 2, unseen: 0 });
  });
  test("large or bold text needs 3:1", () => {
    const grey = { colors: [{ r: 0x88, g: 0x88, b: 0x88, a: 1 }], unresolved: false };
    expect(judge([text({ textStyle: { ...grey, size: 18, bold: false } }), text({ textStyle: { ...grey, size: 12, bold: true } })]).errors).toEqual([]);
    expect(judge([text({ textStyle: { ...grey, size: 17, bold: false } })]).errors).toHaveLength(1);
  });
  test("alpha and ancestor opacity are composited over the background; the worst colour of a text counts", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(judge([text({ opacity: 0.3 })]).errors[0]).toMatchObject({ foreground: "#b3b3b3" });
    expect(judge([text({ textStyle: { colors: [black, { r: 0, g: 0, b: 0, a: 0.25 }], unresolved: false, size: 13, bold: false } })]).errors[0]).toMatchObject({ foreground: "#bfbfbf" });
  });
  test("disabled and invisible text are exempt; text no render shows is listed as unseen; an unresolved colour is an error", () => {
    const report = judge([
      text({ key: "disabled", enabled: false, opacity: 1, textStyle: { colors: [{ r: 250, g: 250, b: 250, a: 1 }], unresolved: false, size: 13, bold: false } }),
      text({ key: "hidden", opacity: 0, textStyle: { colors: [{ r: 250, g: 250, b: 250, a: 1 }], unresolved: false, size: 13, bold: false } }),
      text({ key: "offscreen", capture: undefined, sample: undefined }),
      text({ key: "pattern", textStyle: { colors: [], unresolved: true, size: 13, bold: false } }),
    ]);
    expect(report.unseen.map(element => element.key)).toEqual(["offscreen"]);
    expect(report.errors.map(error => [error.element.key, error.rule])).toEqual([["pattern", "contrast"]]);
    expect(report.errors[0]!.message).toMatch(/does not resolve to sRGB/);
  });
});

describe("description", () => {
  test("exposed controls and images need a label or a title; static text and unexposed views do not", () => {
    const control = (key: string, overrides: Partial<AuditElement>) => ({ key, window: "spark.main", frame: FRAME, element: true, enabled: true, opacity: 1, focusable: true, ...overrides });
    const report = judge([
      control("unnamed-button", { role: "button", id: "save", within: "save" }),
      control("labelled-button", { role: "button", label: "Save" }),
      control("titled-checkbox", { role: "checkBox", title: "Wrap lines" }),
      control("image", { role: "image" }),
      control("placeholder-only", { role: "textField", placeholder: "Search", editable: true }),
      control("read-only", { role: "textArea", editable: false }),
      control("disabled-button", { role: "button", enabled: false }),
      control("unexposed", { role: "image", element: false }),
      control("group", { role: "group" }),
      control("invisible", { role: "button", opacity: 0 }),
    ]);
    expect(report.errors.map(error => error.element.key)).toEqual(["unnamed-button", "image", "placeholder-only", "disabled-button"]);
    expect(report.errors[0]!.message).toBe("button in save at 0,0 (spark.main) has no accessibility label or title");
    expect(report.counts.described).toBe(6);
  });
});

describe("keyboard", () => {
  test("enabled exposed controls take focus, sit in a table or collection view, or are part of a focusable control; images, text, disabled and unexposed controls need not", () => {
    const control = (key: string, overrides: Partial<AuditElement>) => ({ key, window: "spark.main", frame: FRAME, element: true, enabled: true, opacity: 1, focusable: false, label: "Name", ...overrides });
    const report = judge([
      control("pressable", { role: "button", within: "save" }),
      control("focusable", { role: "button", focusable: true }),
      control("field", { role: "textField", editable: true }),
      control("read-only", { role: "textArea", editable: false }),
      control("image", { role: "image" }),
      control("disabled", { role: "checkBox", enabled: false }),
      control("unexposed", { role: "button", element: false }),
      control("group", { role: "group" }),
      control("search", { role: "textField", editable: true, focusable: true }),
      control("search-button", { role: "button", parent: "search" }),
      control("focusable-group", { role: "group", focusable: true }),
      control("in-group", { role: "button", parent: "focusable-group" }),
    ]);
    expect(report.errors.map(error => [error.element.key, error.rule])).toEqual([["pressable", "keyboard"], ["field", "keyboard"], ["in-group", "keyboard"]]);
    expect(report.errors[0]!.message).toBe('button "Name" in save at 0,0 (spark.main) cannot take keyboard focus');
    expect(report.counts.operable).toBe(6);
  });
});

describe("auditAccessibility on the driver backend", () => {
  const HEADER = "appId: so.legend.spark.examples.kitchensink\nname: Audit\nintent: The test intent.\n---\n";
  async function run(commands: string, app: FakeApp) {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-audit-"));
    mkdirSync(path.join(dir, "flows/area"), { recursive: true });
    writeFileSync(path.join(dir, "flows/area/test.yaml"), `${HEADER}${commands}`);
    const capture = path.join(dir, "a11y-audit-1-0.png");
    writePng(capture, image(100, 40, [255, 255, 255]));
    app.audit = { ...facts(app.audit.elements), captures: [{ file: capture, window: "spark.main", width: 100, height: 40, scale: 2 }] };
    return (await runFlows([path.join(dir, "flows/area/test.yaml")], { backends: [new DriverBackend(app)], runDir: path.join(dir, "run"), clock: new VirtualClock() }))[0]!;
  }
  const report = (file: string) => JSON.parse(readFileSync(file, "utf8")) as AuditReport;

  test("writes the report as flow output and passes with no errors; the step is white-box", async () => {
    const app = new FakeApp();
    app.audit = facts([text({}), { key: "1", window: "spark.main", frame: FRAME, element: true, enabled: true, opacity: 1, role: "button", label: "Save", focusable: true }]);
    const result = await run("- launchApp\n- auditAccessibility\n- auditAccessibility: { scope: window }", app);
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("accessibilityAudit"))).toEqual(["accessibilityAudit window a11y-audit-1", "accessibilityAudit window a11y-audit-2"]);
    expect(result.whiteBox).toEqual(["auditAccessibility"]);
    expect(result.artifacts.map(artifact => [artifact.kind, path.basename(artifact.path)])).toEqual([["output", "a11y-audit-1.a11y.json"], ["output", "a11y-audit-2.a11y.json"]]);
    expect(report(result.artifacts[0]!.path)).toMatchObject({ scope: "window", errors: [], counts: { elements: 2, described: 1, operable: 1, texts: 1, measured: 1, unseen: 0 } });
  });
  test("more errors than maxErrors fail with each error and the report; the capture an error refers to is kept", async () => {
    const app = new FakeApp();
    app.audit = facts([
      text({ textStyle: { colors: [{ r: 0xcc, g: 0xcc, b: 0xcc, a: 1 }], unresolved: false, size: 13, bold: false } }),
      { key: "1", window: "spark.main", frame: FRAME, element: true, enabled: true, opacity: 1, role: "image", within: "logo" },
    ]);
    const tolerated = await run("- launchApp\n- auditAccessibility: { scope: app, maxErrors: 2 }", app);
    expect(tolerated.status).toBe("passed");
    expect(app.log).toContain("accessibilityAudit app a11y-audit-1");
    const result = await run("- launchApp\n- auditAccessibility: { maxErrors: 1 }", app);
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ kind: "assertion", command: "auditAccessibility" });
    expect(result.failure!.message).toContain("2 accessibility errors (maxErrors 1)");
    expect(result.failure!.message).toContain('- staticText "Hello" in screen-root at 0,0 (spark.main) has contrast 1.61:1 (#cccccc on #ffffff), below 4.5:1 for 13-point text');
    expect(result.failure!.message).toContain("- image in logo at 0,0 (spark.main) has no accessibility label or title");
    const kept = result.artifacts.find(artifact => artifact.kind === "screenshot")!;
    expect(path.basename(kept.path)).toBe("a11y-audit-1-0.png");
    expect(existsSync(kept.path)).toBe(true);
    expect(report(result.artifacts.find(artifact => artifact.kind === "output")!.path).errors[0]).toMatchObject({ capture: "a11y-audit-1-0.png" });
  });
});

describe("the gate's accessibility audit flows", () => {
  const root = path.join(import.meta.dirname, "..");
  const flows = readdirSync(path.join(root, "e2e/flows/accessibility")).filter(file => file.startsWith("audit-")).map(file => {
    const source = path.join(root, "e2e/flows/accessibility", file);
    return parseFlow(readFileSync(source, "utf8"), source);
  });
  const audited = (subflow: string) => flows.flatMap(flow => flow.commands.filter(command => command.name === "runFlow" && command.args.file === `subflows/accessibility/${subflow}.yaml`)
    .map(command => command.args.env as Record<string, string>));
  test("audit every screen registered in screens/<area>/index.tsx and every area page, in light and dark, English and Arabic", () => {
    // The registry is a React Native module, so its screen IDs are read from the source; screens/<area>/index.tsx lists them as `{ id: "<screen>", title: … }`.
    const registered = readdirSync(path.join(root, "examples/kitchen-sink/screens")).flatMap(area =>
      [...readFileSync(path.join(root, "examples/kitchen-sink/screens", area, "index.tsx"), "utf8").matchAll(/\{ id: "([a-z0-9-]+)", title:/g)].map(match => `${area}/${match[1]}`));
    expect(registered.length).toBeGreaterThan(40);
    expect(audited("audit-screen").map(env => `${env.AREA}/${env.SCREEN}`).sort()).toEqual(registered.sort());
    expect(audited("audit-area").map(env => env.AREA)).toEqual(AREAS.map(area => area.id));
    for (const flow of flows) expect(flow.header).toMatchObject({ checks: ["A11Y-AUDIT-01"], matrix: { appearance: ["light", "dark"], locale: ["en", "ar"] } });
  });
});
