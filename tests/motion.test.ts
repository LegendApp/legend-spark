import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");

const { platform, registered, native, tags } = vi.hoisted(() => ({
  platform: { OS: "macos" },
  registered: vi.fn(() => true),
  native: {
    run: vi.fn(async (_json: string) => JSON.stringify({ finished: true })),
    stopAnimation: vi.fn(async () => {}), set: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    getState: vi.fn(async () => ""), link: vi.fn(async () => {}), unlink: vi.fn(async () => {}), recordFrames: vi.fn(async () => ""),
  },
  tags: new Map<object, number>(),
}));
vi.mock("react-native", () => ({
  Platform: platform,
  UIManager: { hasViewManagerConfig: registered },
  TurboModuleRegistry: { get: () => native },
  findNodeHandle: (target: object) => tags.get(target) ?? null,
  StyleSheet: { flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style) : style },
}));
vi.mock("../packages/motion/src/motion-view-host", () => ({ getNativeMotionView: () => "SparkMotionView" }));
import * as motion from "../packages/motion/src/index";
import { spring, timing, keyframes, decay, sequence, animate, stagger, timeline, setMotionValues, stopMotion, getMotionState, linkScroll, recordMotionFrames, getMotionAvailability, MotionView } from "../packages/motion/src/index";

const a = {} as any, b = {} as any, c = {} as any;
const sent = (mock: { mock: { calls: unknown[][] } }, call = -1) => JSON.parse(mock.mock.calls.at(call)![0] as string);
const code = (run: () => unknown) => { try { run(); } catch (error) { return (error as { code?: string }).code; } return "none"; };
const values = (value: number) => ({ opacity: value, translateX: value, translateY: value, scaleX: value, scaleY: value, rotate: value });

beforeEach(() => {
  platform.OS = "macos"; registered.mockReturnValue(true);
  tags.clear(); tags.set(a, 11); tags.set(b, 12); tags.set(c, 13);
  for (const fn of Object.values(native)) fn.mockClear();
});
afterEach(() => vi.restoreAllMocks());

test("the public entry exports the imperative API, builders, MotionView and MotionPresence, and no hooks", () => {
  expect(Object.keys(motion).sort()).toEqual(["MotionPresence", "MotionView", "animate", "decay", "getMotionAvailability", "getMotionState", "keyframes", "linkScroll", "recordMotionFrames", "sequence", "setMotionValues", "spring", "stagger", "stopMotion", "timeline", "timing"]);
});

test("springs: macOS presets and SwiftUI's response/bounce conversion, or physical parameters", () => {
  const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 9);
  const smooth = spring(1, { preset: "smooth" });
  close(smooth.stiffness, (2 * Math.PI / 0.5) ** 2); close(smooth.damping, 4 * Math.PI / 0.5); expect(smooth.mass).toBe(1);
  const byDefault = spring(1);
  close(byDefault.stiffness, (2 * Math.PI / 0.55) ** 2); close(byDefault.damping, 4 * Math.PI * 0.825 / 0.55);
  const over = spring(1, { responseMs: 400, bounce: -0.5 });
  close(over.damping / (2 * Math.sqrt(over.stiffness * over.mass)), 2);  // ratio 1 / (1 - 0.5)
  const bouncy = spring(1, { responseMs: 400, bounce: 0.4 });
  close(bouncy.damping / (2 * Math.sqrt(bouncy.stiffness)), 0.6);
  for (const preset of ["snappy", "bouncy", "interactive"] as const) expect(spring(1, { preset }).stiffness).toBeGreaterThan(0);
  expect(spring(5, { stiffness: 300, damping: 20, velocity: -900 })).toEqual({ type: "spring", to: 5, mass: 1, stiffness: 300, damping: 20, velocity: -900 });
  expect(Object.isFrozen(smooth)).toBe(true);
  expect(code(() => spring(1, { preset: "smooth", stiffness: 1, damping: 1 }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => spring(1, { responseMs: 300, mass: 2 }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => spring(1, { bounce: 1 }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => spring(1, { stiffness: 100 }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => spring(1, { preset: "wobbly" as never }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => spring(Number.NaN))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => spring(1, { springiness: 2 } as never))).toBe("E_UNSUPPORTED_OPTION");
});

test("timing, keyframes, decay and sequence validate before anything reaches native code", () => {
  expect(timing(10)).toEqual({ type: "timing", to: 10, durationMs: 250, easing: [0.42, 0, 0.58, 1] });
  expect(timing(10, { durationMs: 0, easing: [0.2, 3, 0.8, -2], repeat: Infinity, reverse: true })).toMatchObject({ durationMs: 0, easing: [0.2, 3, 0.8, -2], repeat: "infinite", reverse: true });
  for (const bad of [{ durationMs: -1 }, { durationMs: Infinity }, { easing: [1.2, 0, 0.5, 1] }, { easing: [0, 0, -0.1, 1] }, { easing: "springy" }, { easing: [0, 0, 1] }, { repeat: 1.5 }, { repeat: -1 }, { delayMs: -5 }, { reverse: 1 }, { restDelta: 0 }])
    expect(code(() => timing(1, bad as never)), JSON.stringify(bad)).toBe("E_INVALID_ARGUMENT");

  expect(keyframes([10, -10, 0], { durationMs: 600 })).toMatchObject({ offsets: [1 / 3, 2 / 3, 1], easings: [[0.42, 0, 0.58, 1]] });
  expect(keyframes([1, 2], { durationMs: 100, offsets: [0.25, 1], easing: ["linear", [0, 0, 0.58, 1]] }).easings).toEqual([[0, 0, 1, 1], [0, 0, 0.58, 1]]);
  expect(keyframes([1, 2], { durationMs: 100, easing: [0.1, 0.2, 0.3, 0.4] }).easings).toEqual([[0.1, 0.2, 0.3, 0.4]]);
  for (const [frames, options] of [[[], { durationMs: 1 }], [[1, 2], { durationMs: 1, offsets: [0.5, 0.25] }], [[1, 2], { durationMs: 1, offsets: [0.5, 0.9] }], [[1, 2], { durationMs: 1, offsets: [0, 1] }],
    [[1, 2], { durationMs: 1, offsets: [1] }], [[1, 2, 3], { durationMs: 1, easing: ["linear", "linear"] }], [[1, 2], { durationMs: -1 }], [[1, Number.NaN], { durationMs: 1 }]] as const)
    expect(code(() => keyframes(frames as never, options as never)), JSON.stringify([frames, options])).toBe("E_INVALID_ARGUMENT");

  expect(decay({ velocity: 1200 })).toEqual({ type: "decay", deceleration: 0.998, velocity: 1200 });
  const clamped = decay({ clamp: [-200, 0] });
  expect(clamped.clamp).toEqual([-200, 0]);
  expect(clamped.bounce!.stiffness).toBeCloseTo((2 * Math.PI / 0.3) ** 2, 9);
  for (const bad of [{ deceleration: 1 }, { deceleration: 0 }, { clamp: [1, 0] }, { clamp: [0] }, { clampSpring: { preset: "smooth" } }, { repeat: 1 }, { reverse: true }])
    expect(code(() => decay(bad as never)), JSON.stringify(bad)).toMatch(/^E_(INVALID_ARGUMENT|UNSUPPORTED_OPTION)$/);

  const chain = sequence([timing(50, { durationMs: 200 }), spring(0)], { repeat: 2 });
  expect(chain.steps.map(step => step.type)).toEqual(["timing", "spring"]);
  expect(code(() => sequence([]))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => sequence([{ type: "timing", to: 1, durationMs: 1, easing: [0, 0, 1, 1] } as never]))).toBe("E_INVALID_ARGUMENT");  // hand-built specs are not accepted
  expect(code(() => sequence([timing(1, { repeat: Infinity })]))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => sequence([decay(), spring(0)], { reverse: true }))).toBe("E_INVALID_ARGUMENT");
});

test("animate sends one plan: bare numbers are default springs, scale drives both axes, delay offsets the step", async () => {
  const handle = animate(a, { scale: 1.2, opacity: timing(0, { durationMs: 100 }) }, { delayMs: 40 });
  await expect(handle.finished).resolves.toEqual({ finished: true });
  const plan = sent(native.run);
  expect(plan.groups).toEqual([{ tag: 11, offsetMs: 40, tracks: { scaleX: spring(1.2), scaleY: spring(1.2), opacity: timing(0, { durationMs: 100 }) } }]);
  expect(plan.id).toMatch(/^motion-\d+$/);
  await handle.stop();
  expect(native.stopAnimation).toHaveBeenCalledWith(plan.id);

  native.run.mockRejectedValueOnce(Object.assign(new Error("Spring does not settle"), { code: "E_INVALID_ARGUMENT" }));
  await expect(animate(a, { rotate: 90 }).finished).rejects.toMatchObject({ name: "SparkError", code: "E_INVALID_ARGUMENT" });
  native.run.mockResolvedValueOnce("{\"done\":1}");
  await expect(animate(a, { rotate: 90 }).finished).rejects.toMatchObject({ code: "E_INVALID_DATA" });

  native.run.mockClear();
  expect(code(() => animate(a, { scale: 1, scaleX: 2 }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => animate(a, { width: 3 } as never))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => animate(a, {}))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => animate(a, { opacity: { type: "spring" } as never }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => animate(null, { opacity: 1 }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => animate({} as never, { opacity: 1 }))).toBe("E_NOT_FOUND");
  expect(code(() => animate(a, { opacity: 1 }, { delayMs: -1 }))).toBe("E_INVALID_ARGUMENT");
  expect(native.run).not.toHaveBeenCalled();
});

test("stagger and timeline resolve their start times in one native plan", async () => {
  await stagger([a, b, c], { translateY: 0 }, { eachMs: 50, delayMs: 10 }).finished;
  expect(sent(native.run).groups.map((group: { tag: number; offsetMs: number }) => [group.tag, group.offsetMs])).toEqual([[11, 10], [12, 60], [13, 110]]);
  await stagger([a, b, c], { translateY: 0 }, { eachMs: 50, from: "last" }).finished;
  expect(sent(native.run).groups.map((group: { offsetMs: number }) => group.offsetMs)).toEqual([100, 50, 0]);
  await stagger([a, b, c], { translateY: 0 }, { eachMs: 50, from: "center" }).finished;
  expect(sent(native.run).groups.map((group: { offsetMs: number }) => group.offsetMs)).toEqual([50, 0, 50]);
  expect(code(() => stagger([], { opacity: 1 }, { eachMs: 1 }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => stagger([a], { opacity: 1 }, { eachMs: -1 }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => stagger([a], { opacity: 1 }, { eachMs: 1, from: "middle" as never }))).toBe("E_INVALID_ARGUMENT");

  await timeline([{ target: a, values: { opacity: 1 } }, { target: b, values: { opacity: 1 }, after: "previous", offsetMs: 20 }]).finished;
  expect(sent(native.run).groups.map((group: { tag: number; after?: string; offsetMs?: number }) => [group.tag, group.after, group.offsetMs])).toEqual([[11, undefined, undefined], [12, "previous", 20]]);
  expect(code(() => timeline([{ target: a, values: { opacity: 1 }, after: "previous" }]))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => timeline([]))).toBe("E_INVALID_ARGUMENT");
});

test("set, stop, state, scroll links and frame reports validate input and native results", async () => {
  await setMotionValues(a, { scale: 2, translateX: -4 });
  expect(sent(native.set)).toEqual({ tag: 11, values: { scaleX: 2, scaleY: 2, translateX: -4 } });
  await expect(setMotionValues(a, { opacity: Number.NaN })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await stopMotion(a);
  expect(sent(native.stop)).toEqual({ tag: 11, properties: ["opacity", "translateX", "translateY", "scaleX", "scaleY", "rotate"] });
  await stopMotion(b, ["scale", "rotate"]);
  expect(sent(native.stop)).toEqual({ tag: 12, properties: ["scaleX", "scaleY", "rotate"] });

  const state = { values: values(1), velocities: values(0), animating: ["translateX"] };
  native.getState.mockResolvedValueOnce(JSON.stringify(state));
  await expect(getMotionState(a)).resolves.toEqual(state);
  expect(native.getState).toHaveBeenCalledWith(11);
  native.getState.mockResolvedValueOnce(JSON.stringify({ ...state, animating: ["width"] }));
  await expect(getMotionState(a)).rejects.toMatchObject({ code: "E_INVALID_DATA" });

  const link = await linkScroll(a, { source: { nativeID: "list" }, input: [0, 100], output: { opacity: [1, 0], scale: [1, 0.8] } });
  expect(sent(native.link)).toMatchObject({ tag: 11, nativeID: "list", axis: "y", clamp: true, input: [0, 100], output: { opacity: [1, 0], scaleX: [1, 0.8], scaleY: [1, 0.8] } });
  const id = sent(native.link).id;
  await Promise.all([link.remove(), link.remove()]);
  expect(native.unlink).toHaveBeenCalledTimes(1);
  expect(native.unlink).toHaveBeenCalledWith(id);
  for (const bad of [{ input: [0] }, { input: [0, 0] }, { input: [10, 0] }, { output: { opacity: [1] } }, { output: {} }, { axis: "z" }, { extrapolate: "wrap" }, { source: { nativeID: "" } }])
    await expect(linkScroll(a, { source: { nativeID: "list" }, input: [0, 100], output: { opacity: [1, 0] }, ...bad } as never), JSON.stringify(bad)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(native.link).toHaveBeenCalledTimes(1);

  const report = { frames: 180, animatedFrames: 150, droppedFrames: 0, stalledFrames: 0, maxFrameGapMs: 8.4, refreshRate: 120, durationMs: 1500 };
  native.recordFrames.mockResolvedValueOnce(JSON.stringify(report));
  await expect(recordMotionFrames(a, { durationMs: 1500 })).resolves.toEqual(report);
  expect(sent(native.recordFrames)).toEqual({ tag: 11, durationMs: 1500 });
  await expect(recordMotionFrames(a, { durationMs: 0 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(recordMotionFrames(a, { durationMs: 20000 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("availability is truthful; unavailable targets throw typed errors and render nothing", async () => {
  expect(getMotionAvailability()).toEqual({ available: true });
  expect(registered).toHaveBeenCalledWith("SparkMotionView");
  registered.mockReturnValue(false);
  expect(getMotionAvailability()).toEqual({ available: false, reason: "missing-module" });
  expect(code(() => animate(a, { opacity: 1 }))).toBe("E_MODULE_UNAVAILABLE");
  for (const os of ["windows", "ios", "android", "web"]) {
    platform.OS = os;
    expect(getMotionAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
    expect(code(() => animate(a, { opacity: 1 }))).toBe("E_UNSUPPORTED_PLATFORM");
    expect(code(() => stagger([a], { opacity: 1 }, { eachMs: 1 }))).toBe("E_UNSUPPORTED_PLATFORM");
    await expect(getMotionState(a)).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(setMotionValues(a, { opacity: 1 })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(linkScroll(a, { source: { nativeID: "x" }, input: [0, 1], output: { opacity: [0, 1] } })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    expect(code(() => MotionView({ children: null }))).toBe("E_UNSUPPORTED_PLATFORM");
  }
  expect(Object.values(native).every(fn => fn.mock.calls.length === 0)).toBe(true);
});

test("MotionView passes validated initial values once and refuses style opacity or transform", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let rendered: any;
  await act(async () => { rendered = create(React.createElement(MotionView, { initial: { opacity: 0, scale: 0.5 }, style: { width: 10 }, testID: "card" })); });
  const props = rendered.root.findByType("SparkMotionView").props;
  expect(props).toMatchObject({ testID: "card", style: { width: 10 } });
  expect(JSON.parse(props.initialValues)).toEqual({ opacity: 0, scaleX: 0.5, scaleY: 0.5 });
  await act(async () => rendered.unmount());
  expect(code(() => MotionView({ style: { opacity: 0.5 } }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionView({ style: [{ width: 1 }, { transform: [{ scale: 2 }] }] }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionView({ initial: { rotate: Infinity } }))).toBe("E_INVALID_ARGUMENT");
});
