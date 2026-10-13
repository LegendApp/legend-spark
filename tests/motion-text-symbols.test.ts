import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");

// Path animation, text transitions and symbol effects (docs/motion.md) against a recorded native module.
const { platform, registered, native, tags } = vi.hoisted(() => ({
  platform: { OS: "macos", Version: "15.4" as string | number },
  registered: vi.fn((_name: string) => true),
  native: {
    run: vi.fn(async (_json: string) => JSON.stringify({ finished: true })),
    stopAnimation: vi.fn(async () => {}), set: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    getState: vi.fn(async () => ""), link: vi.fn(async () => {}), unlink: vi.fn(async () => {}), recordFrames: vi.fn(async () => ""),
    environment: vi.fn(async () => ""),
    playSymbolEffect: vi.fn(async (_json: string) => JSON.stringify({ played: "bounce" })),
    removeSymbolEffect: vi.fn(async (_json: string) => {}),
    hasSymbol: vi.fn((_name: string) => true),
    // The app's SDK and macOS: here the effects of the macOS version in `platform.Version`.
    supportsSymbolEffect: vi.fn((_name: string) => true),
  },
  tags: new WeakMap<object, number>(),
}));
vi.mock("react-native", () => ({
  Platform: platform,
  UIManager: { hasViewManagerConfig: registered },
  TurboModuleRegistry: { get: () => native },
  findNodeHandle: (target: object) => tags.get(target) ?? null,
  StyleSheet: { flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style, absoluteFill: { position: "absolute" } },
  View: "View",
  Text: "Text",
}));
vi.mock("../packages/motion/src/motion-view-host", () => ({ getNativeMotionView: () => "SparkMotionView", getNativeMotionSymbol: () => "SparkMotionSymbol" }));
import { parseSvgPath } from "../packages/motion/src/svg-path";
import { getSymbolEffectAvailability, motionPath, MotionNumber, MotionSymbol, MotionText, playSymbolEffect, spring, stopSymbolEffects, timing } from "../packages/motion/src/index";
import { sharedUnits, textUnits } from "../packages/motion/src/text-units";

const h = React.createElement;
const code = (run: () => unknown) => { try { run(); } catch (error) { return (error as { code?: string }).code; } return "none"; };
const sent = (mock: { mock: { calls: unknown[][] } }, call = -1) => JSON.parse(mock.mock.calls.at(call)![0] as string);
const plans = () => native.run.mock.calls.map(([json]) => JSON.parse(json));
let rendered: any, nextTag = 0;
const byTag = new Map<number, string>();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  platform.OS = "macos"; platform.Version = "15.4"; registered.mockImplementation(() => true);
  for (const fn of Object.values(native)) fn.mockClear();
  native.hasSymbol.mockImplementation(() => true);
  const since: Record<string, number> = { wiggle: 15, rotate: 15, breathe: 15, drawOn: 26, drawOff: 26 };
  native.supportsSymbolEffect.mockImplementation((name: string) => (since[name] ?? 14) <= Number.parseFloat(String(platform.Version)));
  byTag.clear();
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });

/** Renders with each native view mocked by a tagged node; `byTag` names a tag by the text its MotionView shows. */
async function render(element: React.ReactElement) {
  if (rendered) await act(async () => { rendered.update(element); });
  else await act(async () => {
    rendered = create(element, { createNodeMock: (node: any) => {
      const mock = {}, tag = ++nextTag;
      tags.set(mock, tag);
      const text = (child: any): string => typeof child === "string" ? child : Array.isArray(child) ? child.map(text).join("") : child?.props ? text(child.props.children) : "";
      byTag.set(tag, text(node.props.children) || node.props.testID);
      return mock;
    } });
  });
}
/** Each plan's view (by its text) and opacity track. */
const opacities = () => plans().map(plan => [byTag.get(plan.groups[0].tag), plan.groups[0].tracks.opacity]);

test("text units: characters as a reader sees them, words of joined scripts, spaces and line breaks", () => {
  expect(textUnits("Hé 👍🏽🇫🇷\nok")).toEqual(["H", "é", " ", "👍🏽", "🇫🇷", "\n", "o", "k"]);
  expect(textUnits("é👩‍👩‍👧")).toEqual(["é", "👩‍👩‍👧"]);
  expect(textUnits("مرحبا  بك")).toEqual(["مرحبا", "  ", "بك"]);
  expect(textUnits("नमस्ते")).toEqual(["नमस्ते"]);
  expect(textUnits("")).toEqual([]);
  expect(sharedUnits(["a", "b", "c"], ["a", "b", "x", "y"])).toBe(2);
});

test("motionPath: keyframes along an SVG path at even distances, paced by the easing, with the heading on request", () => {
  const line = motionPath("M0 0 L100 0", { durationMs: 400, easing: "linear" });
  expect(line.translateX.values.at(-1)).toBeCloseTo(100, 9);
  expect(line.translateY.values.every(value => value === 0)).toBe(true);
  expect(line.translateX).toMatchObject({ type: "keyframes", durationMs: 400 });
  expect(line.translateX.offsets.at(-1)).toBe(1);
  expect(line.translateX.offsets.every((offset, index, all) => index === 0 || offset > all[index - 1]!)).toBe(true);
  // Linear pace: distance is proportional to time.
  line.translateX.values.forEach((value, index) => expect(value / 100).toBeCloseTo(line.translateX.offsets[index]!, 9));
  expect(line).not.toHaveProperty("rotate");
  // Relative commands, curves and the heading: down, then right (90° then 0°, unwrapped).
  const turn = motionPath("m0 0 v50 q0 50 50 50", { durationMs: 600, rotate: true, delayMs: 100, repeat: 1, reverse: true });
  expect(turn.rotate!.values[0]).toBeCloseTo(90, 9);
  expect(Math.abs(turn.rotate!.values.at(-1)!)).toBeLessThan(3);  // the last chord of the flattened curve
  expect(turn.translateX.values.at(-1)).toBeCloseTo(50, 9);
  expect(turn.translateY.values.at(-1)).toBeCloseTo(100, 9);
  expect(turn.translateX).toMatchObject({ delayMs: 100, repeat: 1, reverse: true });
  for (const bad of [() => motionPath("L1 1", { durationMs: 1 }), () => motionPath("M0 0", { durationMs: 1 }), () => motionPath("M0 0 L0 0", { durationMs: 1 }),
    () => motionPath("M0 0 X1 1", { durationMs: 1 }), () => motionPath("M0 0 L1", { durationMs: 1 }), () => motionPath(1 as never, { durationMs: 1 })])
    expect(code(bad)).toBe("E_INVALID_ARGUMENT");
  expect(code(() => motionPath("M0 0 A5 5 0 0 1 10 0", { durationMs: 1 }))).toBe("E_UNSUPPORTED_OPTION");
  expect(code(() => motionPath("M0 0 L1 0", { durationMs: 1, velocity: 2 } as never))).toBe("E_UNSUPPORTED_OPTION");
  // The strict path data parser (docs/motion.md#path-data): stray characters and commas before commands are rejected
  // (they were ignored), upper-case exponents and leading plus signs are numbers, and S and T reflect only the previous
  // C/S or Q/T control point.
  for (const bad of ["M0 0 L100 0 ;", "M0 0, L100 0", "M0 0 L100 0,"]) expect(code(() => motionPath(bad, { durationMs: 1 })), bad).toBe("E_INVALID_ARGUMENT");
  expect(motionPath("M0 0 L1E2 +0", { durationMs: 1 }).translateX.values.at(-1)).toBeCloseTo(100, 9);
  const after = motionPath("M0 0 Q50 50 100 0 S150 0 200 0", { durationMs: 1 });
  after.translateX.values.forEach((x, index) => { if (x > 100.5) expect(Math.abs(after.translateY.values[index]!), String(x)).toBeLessThan(1e-9); });
});

test("SVG path data: the number grammar, token positions in errors, commas between numbers only, and Z", () => {
  const start = (d: string) => parseSvgPath(d, "d")[0]!.start;
  expect(start("M1-2 L0 0")).toEqual([1, -2]);
  expect(start("M.5.5 L0 0")).toEqual([0.5, 0.5]);
  expect(start("M1E5 +.5 L0 0")).toEqual([100000, 0.5]);
  expect(start("M1e-1,2 L0 0")).toEqual([0.1, 2]);
  const message = (d: string) => { try { parseSvgPath(d, "d"); } catch (error) { return `${(error as { code: string }).code} ${(error as Error).message}`; } return "none"; };
  expect(message("M0 0 L10")).toBe("E_INVALID_ARGUMENT d needs another number for L at its end");
  expect(message("M0 0 L10 Z")).toBe("E_INVALID_ARGUMENT d needs another number for L before Z at character 10");
  expect(message("M0 0 L1 1 Z 5 5")).toMatch(/^E_INVALID_ARGUMENT d has a number after Z at character 13/);
  expect(message("M0 0 ,L1 1")).toBe('E_INVALID_ARGUMENT d has an unexpected "," at character 6');
  expect(message("M,0 0")).toBe('E_INVALID_ARGUMENT d has an unexpected "," at character 2');
  expect(message("M0 0 L1 1 ?")).toBe('E_INVALID_ARGUMENT d has an unexpected "?" at character 11');
  // Z right after Z closes nothing more; a closed subpath then starts again from its start.
  expect(parseSvgPath("M0 0 L10 0 L10 10 Z Z", "d")).toEqual([{ start: [0, 0], segments: expect.any(Array), closed: true }]);
  const reopened = parseSvgPath("M5 5 L10 5 Z L5 10", "d");
  expect(reopened).toHaveLength(2);
  expect(reopened[1]).toMatchObject({ start: [5, 5], closed: false });
  // T after C does not reflect the cubic's control point: its control is the current point.
  expect(parseSvgPath("M0 0 C10 10 20 10 30 0 T60 0", "d")[0]!.segments[1]).toEqual([30, 0, 40, 0, 60, 0]);
  expect(code(() => motionPath("M0 0 L1 0", { durationMs: 1, easing: [0.3, -0.5, 0.7, 1.5] }))).toBe("E_UNSUPPORTED_OPTION");
});

test("symbol effect availability is what the native side reports for the app's SDK and macOS", () => {
  expect(getSymbolEffectAvailability("bounce")).toEqual({ available: true });
  expect(getSymbolEffectAvailability("breathe")).toEqual({ available: true });
  expect(getSymbolEffectAvailability("drawOn")).toEqual({ available: false, reason: "host-restriction" });
  platform.Version = "14.6";
  expect(getSymbolEffectAvailability("wiggle")).toEqual({ available: false, reason: "host-restriction" });
  expect(getSymbolEffectAvailability("replace")).toEqual({ available: true });
  platform.Version = "26.0";
  expect(getSymbolEffectAvailability("drawOff")).toEqual({ available: true });
  registered.mockImplementation(name => name !== "SparkMotionSymbol");
  expect(getSymbolEffectAvailability("pulse")).toEqual({ available: false, reason: "missing-module" });
  platform.OS = "windows";
  expect(getSymbolEffectAvailability("pulse")).toEqual({ available: false, reason: "unsupported-platform" });
  expect(code(() => getSymbolEffectAvailability("spin" as never))).toBe("E_INVALID_ARGUMENT");
});

test("playSymbolEffect validates, sends one request, and removes what played", async () => {
  await render(h(MotionSymbol, { name: "bell", testID: "bell", ref: React.createRef() }));
  const target = rendered.root.findByType("SparkMotionSymbol").instance ?? rendered.getInstance?.();
  const ref = React.createRef<any>();
  await render(h(MotionSymbol, { name: "bell", testID: "bell", size: 32, color: "red", replaceTransition: "downUp", ref }));
  expect(rendered.root.findByType("SparkMotionSymbol").props).toMatchObject({ name: "bell", size: 32, color: "red", replaceTransition: "downUp", style: [{ width: 32, height: 32 }, undefined] });
  void target;
  const playback = await playSymbolEffect(ref.current, "bounce", { direction: "up", repeat: Infinity, byLayer: true });
  expect(sent(native.playSymbolEffect)).toEqual({ tag: expect.any(Number), effect: "bounce", repeat: "infinite", speed: 1, byLayer: true, direction: "up" });
  expect(playback.played).toBe("bounce");
  await playback.remove();
  await playback.remove();
  expect(native.removeSymbolEffect).toHaveBeenCalledTimes(1);
  expect(sent(native.removeSymbolEffect)).toEqual({ tag: sent(native.playSymbolEffect).tag, effect: "bounce" });
  // Under Reduce Motion the native side plays the alternate; a fade or nothing leaves nothing to remove.
  native.playSymbolEffect.mockResolvedValueOnce(JSON.stringify({ played: "none" }));
  await (await playSymbolEffect(ref.current, "wiggle", { reducedMotion: "instant" })).remove();
  expect(native.removeSymbolEffect).toHaveBeenCalledTimes(1);
  await stopSymbolEffects(ref.current);
  expect(sent(native.removeSymbolEffect)).toEqual({ tag: sent(native.playSymbolEffect).tag });
  for (const [effect, options, expected] of [
    ["bounce", { direction: "left" }, "E_INVALID_ARGUMENT"], ["pulse", { repeat: -1 }, "E_INVALID_ARGUMENT"], ["pulse", { speed: 0 }, "E_INVALID_ARGUMENT"],
    ["pulse", { byLayer: 1 }, "E_INVALID_ARGUMENT"], ["pulse", { reducedMotion: "skip" }, "E_INVALID_ARGUMENT"], ["pulse", { delayMs: 10 }, "E_UNSUPPORTED_OPTION"],
    ["drawOn", {}, "E_UNAVAILABLE"],
  ] as const) await expect(playSymbolEffect(ref.current, effect, options as never), effect).rejects.toMatchObject({ code: expected });
  native.playSymbolEffect.mockResolvedValueOnce(JSON.stringify({ played: "spin" }));
  await expect(playSymbolEffect(ref.current, "pulse")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await expect(playSymbolEffect(null, "pulse")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  platform.Version = "26";
  await expect(playSymbolEffect(ref.current, "drawOff", { repeat: 1 })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
});

test("MotionSymbol checks the symbol exists and its props before rendering", () => {
  native.hasSymbol.mockImplementation(name => name === "bell");
  expect(code(() => MotionSymbol({ name: "no.such.symbol" }))).toBe("E_NOT_FOUND");
  expect(code(() => MotionSymbol({ name: "" }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionSymbol({ name: "bell", size: -1 }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionSymbol({ name: "bell", replaceTransition: "fade" as never }))).toBe("E_INVALID_ARGUMENT");
  platform.OS = "ios";
  expect(code(() => MotionSymbol({ name: "bell" }))).toBe("E_UNSUPPORTED_PLATFORM");
});

test("MotionText crossfades each changed character in its place, and fades out characters past a shorter text", async () => {
  await render(h(MotionText, { text: "cat", testID: "word" }));
  expect(native.run).not.toHaveBeenCalled();
  expect(rendered.root.find((node: any) => node.type === "View" && node.props.testID === "word").props).toMatchObject({ accessible: true, accessibilityLabel: "cat" });
  await render(h(MotionText, { text: "cut", testID: "word" }));
  const fade = { durationMs: 200 };
  expect(opacities()).toEqual([["a", timing(0, fade)], ["u", timing(1, fade)]]);
  native.run.mockClear();
  let finish!: (value: string) => void;
  native.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(h(MotionText, { text: "cu", testID: "word", transition: { type: "crossfade", durationMs: 120 } }));
  expect(opacities()).toEqual([["t", timing(0, { durationMs: 200 })]]);
  expect(rendered.root.findAllByType("Text").some((node: any) => node.props.children === "t")).toBe(true);
  await act(async () => { finish(JSON.stringify({ finished: true })); });
  expect(rendered.root.findAllByType("Text").some((node: any) => node.props.children === "t")).toBe(false);
  // A longer text: new places fade in.
  native.run.mockClear();
  await render(h(MotionText, { text: "cup", testID: "word", transition: { type: "crossfade", durationMs: 120 } }));
  expect(opacities()).toEqual([["p", timing(1, { durationMs: 120 })]]);
  expect(code(() => MotionText({ text: 1 as never }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionText({ text: "a", transition: { type: "wipe" } as never }))).toBe("E_INVALID_ARGUMENT");
});

test("MotionText types characters one after another, keeping those it already showed", async () => {
  await render(h(MotionText, { text: "ab", transition: { type: "typewriter", characterMs: 50 } }));
  expect(opacities()).toEqual([["a", timing(1, { durationMs: 50, delayMs: 0 })], ["b", timing(1, { durationMs: 50, delayMs: 50 })]]);
  native.run.mockClear();
  await render(h(MotionText, { text: "abcd", transition: { type: "typewriter", characterMs: 50 } }));
  expect(opacities()).toEqual([["c", timing(1, { durationMs: 50, delayMs: 0 })], ["d", timing(1, { durationMs: 50, delayMs: 50 })]]);
  expect(code(() => MotionText({ text: "a", transition: { type: "typewriter", characterMs: -1 } }))).toBe("E_INVALID_ARGUMENT");
});

test("MotionNumber rolls only the digits that change, each column on the compositor", async () => {
  await render(h(MotionNumber, { value: 41, testID: "count", style: { fontSize: 16 } }));
  expect(native.run).not.toHaveBeenCalled();
  expect(rendered.root.find((node: any) => node.type === "View" && node.props.testID === "count").props).toMatchObject({ accessibilityLabel: "41", accessibilityRole: "text" });
  await render(h(MotionNumber, { value: 42, testID: "count", style: { fontSize: 16 } }));
  expect(plans()).toHaveLength(1);
  expect(plans()[0].groups[0].tracks).toEqual({ translateY: spring(-2 * 20, { preset: "snappy" }) });
  native.run.mockClear();
  await render(h(MotionNumber, { value: 42, testID: "count", style: { fontSize: 16 }, transition: { type: "timing", durationMs: 300 } }));
  expect(native.run).not.toHaveBeenCalled();
  await render(h(MotionNumber, { value: 52, testID: "count", style: { fontSize: 16 }, transition: { type: "timing", durationMs: 300 } }));
  expect(plans()[0].groups[0].tracks).toEqual({ translateY: timing(-5 * 20, { durationMs: 300 }) });
  expect(code(() => MotionNumber({ value: Number.NaN }))).toBe("E_INVALID_ARGUMENT");
});
