// auditAccessibility on the driver backend (docs/e2e-flows.md#accessibility-audit): judges the facts the in-app driver
// collects in-process (`accessibilityAudit`, docs/test-driver.md#accessibility-audit) with the rules of the macOS
// accessibility audit that need no assistive-technology client: every control and image has a description, every
// control is reachable with the keyboard, and text has enough contrast against what is rendered behind it.
import { copyFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AuditColor, AuditElement, AuditFacts } from "../driver.ts";
import type { Image } from "../golden/diff.ts";
import { Failure, type CommandContext, type CommandHandler } from "./backend.ts";

/** Roles a user operates or must recognise: an assistive technology announces them by their description. */
export const DESCRIBED_ROLES: ReadonlySet<string> = new Set([
  "button", "checkBox", "radioButton", "popUpButton", "menuButton", "comboBox", "slider", "incrementor", "textField", "textArea",
  "link", "image", "disclosureTriangle", "colorWell", "segmentedControl",
]);
/** Roles a user operates: the keyboard must reach them. */
export const OPERABLE_ROLES: ReadonlySet<string> = new Set([...DESCRIBED_ROLES].filter(role => role !== "image"));
const TEXT_ROLES: ReadonlySet<string> = new Set(["textField", "textArea", "comboBox"]);
/** Apple's Human Interface Guidelines (Accessibility > Color and effects): 4.5:1, or 3:1 for text of 18 points or more, or bold. */
export const CONTRAST = { normal: 4.5, large: 3, largeSize: 18 } as const;

export type AuditRule = "description" | "keyboard" | "contrast";
export type AuditIssue = {
  rule: AuditRule;
  message: string;
  element: { key: string; window: string; id?: string; within?: string; role?: string; label?: string; text?: string; frame: AuditElement["frame"] };
  /** contrast: the ratio found, the ratio required, and the colours compared (#rrggbb, the text composited over the background). */
  ratio?: number;
  required?: number;
  foreground?: string;
  background?: string;
  /** contrast: the capture (copied next to the report) and its pixels that show the text. */
  capture?: string;
  sample?: AuditElement["sample"];
};
export type AuditReport = {
  scope: "window" | "app";
  windows: AuditFacts["windows"];
  /** Elements audited, texts whose contrast was measured, and texts no render shows (scrolling cannot reach them, or they are fully clipped). */
  counts: { elements: number; described: number; operable: number; texts: number; measured: number; unseen: number };
  errors: AuditIssue[];
  unseen: AuditIssue["element"][];
};

const hex = ({ r, g, b }: { r: number; g: number; b: number }) => `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
const linear = (channel: number) => { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** WCAG 2 relative luminance of an sRGB colour. */
export const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** WCAG 2 contrast ratio, 1-21. */
export function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
/** The most frequent colour in a rectangle of an image: the background a text is drawn on. */
export function dominantColor(image: Image, rect: { x: number; y: number; width: number; height: number }) {
  const counts = new Map<number, number>();
  let best = 0, bestCount = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const at = (y * image.width + x) * 4, rgb = (image.data[at]! << 16) | (image.data[at + 1]! << 8) | image.data[at + 2]!;
      const count = (counts.get(rgb) ?? 0) + 1;
      counts.set(rgb, count);
      if (count > bestCount) { best = rgb; bestCount = count; }
    }
  }
  return { r: best >> 16, g: (best >> 8) & 255, b: best & 255 };
}
const over = (color: AuditColor, opacity: number, background: { r: number; g: number; b: number }) => {
  const alpha = color.a * opacity;
  return { r: color.r * alpha + background.r * (1 - alpha), g: color.g * alpha + background.g * (1 - alpha), b: color.b * alpha + background.b * (1 - alpha) };
};

function summary({ key, window, id, within, role, label, text, frame }: AuditElement): AuditIssue["element"] {
  return { key, window, id, within, role, label, text: text && text.length > 80 ? `${text.slice(0, 79)}…` : text, frame };
}
function describe(element: AuditElement) {
  const name = element.label ?? element.text ?? element.title;
  return `${element.role ?? "text"}${name ? ` ${JSON.stringify(name.length > 60 ? `${name.slice(0, 59)}…` : name)}` : ""}${element.within ? ` in ${element.within}` : ""}`
    + ` at ${Math.round(element.frame.x)},${Math.round(element.frame.y)} (${element.window})`;
}

/**
 * Judges audit facts. `read` decodes a capture. Rules:
 * - description: an exposed accessibility element with a role in DESCRIBED_ROLES has a label or a title, except
 *   read-only text fields and areas.
 * - keyboard: an enabled exposed element with a role in OPERABLE_ROLES (read-only text excepted) is focusable, is
 *   inside a table, outline or collection view, or is part of a focusable control.
 * - contrast: enabled text with a declared colour has the HIG contrast against the dominant colour rendered behind
 *   it, for every colour it draws in (alpha and ancestor opacity composited). Text in a disabled AppKit control or
 *   React Native view is exempt, as in WCAG.
 *   Text whose colour does not resolve to sRGB cannot be measured, which is an error, not a pass.
 */
export function judgeAudit(facts: AuditFacts, scope: "window" | "app", read: (file: string) => Image): AuditReport {
  const errors: AuditIssue[] = [], unseen: AuditIssue["element"][] = [];
  const images = new Map<number, Image>();
  const image = (index: number) => images.get(index) ?? images.set(index, read(facts.captures[index]!.file)).get(index)!;
  let described = 0, operable = 0, texts = 0, measured = 0;
  const byKey = new Map(facts.elements.map(element => [element.key, element]));
  // A control the keyboard focuses brings its parts with it (a search field's search and cancel buttons).
  const reached = (element: AuditElement) => {
    for (let at: AuditElement | undefined = element; at; at = at.parent === undefined ? undefined : byKey.get(at.parent))
      if (at.focusable && (at === element || at.element && at.role !== undefined && OPERABLE_ROLES.has(at.role))) return true;
    return false;
  };
  for (const element of facts.elements) {
    if (element.opacity <= 0 || element.frame.width <= 0 || element.frame.height <= 0) continue;
    // Read-only text (a selectable React Native Text is a non-editable text view) is described by its own text.
    if (element.element && element.role && DESCRIBED_ROLES.has(element.role) && !(TEXT_ROLES.has(element.role) && element.editable === false)) {
      described++;
      if (!element.label && !element.title) errors.push({ rule: "description", message: `${describe(element)} has no accessibility label or title`, element: summary(element) });
      if (OPERABLE_ROLES.has(element.role) && element.enabled) {
        operable++;
        if (!reached(element)) errors.push({ rule: "keyboard", message: `${describe(element)} cannot take keyboard focus`, element: summary(element) });
      }
    }
    const style = element.textStyle;
    if (!element.text || !style || !element.enabled) continue;
    texts++;
    if (style.unresolved) { errors.push({ rule: "contrast", message: `${describe(element)} draws in a colour that does not resolve to sRGB, so its contrast cannot be measured`, element: summary(element) }); continue; }
    if (element.capture === undefined || !element.sample) { unseen.push(summary(element)); continue; }
    measured++;
    const background = dominantColor(image(element.capture), element.sample);
    const required = style.bold || style.size >= CONTRAST.largeSize ? CONTRAST.large : CONTRAST.normal;
    const worst = style.colors.map(color => ({ foreground: over(color, element.opacity, background), ratio: 0 }))
      .map(entry => ({ ...entry, ratio: contrastRatio(entry.foreground, background) }))
      .sort((a, b) => a.ratio - b.ratio)[0];
    if (!worst || worst.ratio >= required) continue;
    const ratio = Math.round(worst.ratio * 100) / 100;
    errors.push({
      rule: "contrast", element: summary(element), ratio, required, foreground: hex(worst.foreground), background: hex(background),
      message: `${describe(element)} has contrast ${ratio}:1 (${hex(worst.foreground)} on ${hex(background)}), below ${required}:1 for ${style.size}-point${style.bold ? " bold" : ""} text`,
      capture: facts.captures[element.capture]!.file, sample: element.sample,
    });
  }
  return { scope, windows: facts.windows, counts: { elements: facts.elements.length, described, operable, texts, measured, unseen: unseen.length }, errors, unseen };
}

/** What the handler needs of the driver backend. */
export type AuditClient = { accessibilityAudit(scope: "window" | "app", name: string): Promise<AuditFacts> };

/**
 * `auditAccessibility: { scope, maxErrors }`: writes `output/<name>.a11y.json` (the report) and the captures its
 * errors refer to, and fails when there are more than `maxErrors` (default 0) errors.
 */
export function auditCommand(client: () => AuditClient, read: (file: string) => Image): CommandHandler {
  return async (args: Record<string, unknown>, context: CommandContext) => {
    const scope = (args.scope as "window" | "app" | undefined) ?? "window", maxErrors = (args.maxErrors as number | undefined) ?? 0;
    // Numbered per flow run: the nth audit of the flow.
    const name = `a11y-audit-${readdirSync(context.outputDir).filter(file => file.endsWith(".a11y.json")).length + 1}`;
    const report = judgeAudit(await client().accessibilityAudit(scope, name), scope, read);
    const copied = new Map<string, string>();
    for (const error of report.errors) {
      if (!error.capture) continue;
      const file = copied.get(error.capture) ?? path.join(context.outputDir, path.basename(error.capture));
      if (!copied.has(error.capture)) { copyFileSync(error.capture, file); copied.set(error.capture, file); context.addArtifact({ kind: "screenshot", path: file }); }
      error.capture = path.basename(file);
    }
    const file = path.join(context.outputDir, `${name}.a11y.json`);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    context.addArtifact({ kind: "output", path: file });
    if (report.errors.length <= maxErrors) return;
    const shown = report.errors.slice(0, 10).map(error => `- ${error.message}`).join("\n");
    throw new Failure("assertion", `${report.errors.length} accessibility error${report.errors.length === 1 ? "" : "s"} (maxErrors ${maxErrors}); `
      + `${path.relative(process.cwd(), file)} lists them all:\n${shown}${report.errors.length > 10 ? `\n- … ${report.errors.length - 10} more` : ""}`);
  };
}
