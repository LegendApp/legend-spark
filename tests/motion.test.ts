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
    environment: vi.fn(async (_tag: number) => ""),
    supportsMaterial: vi.fn((_name: string) => true),
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
import { spring, timing, keyframes, decay, sequence, animate, stagger, timeline, setMotionValues, stopMotion, getMotionState, linkScroll, recordMotionFrames, getMotionAvailability, getMotionEnvironment, MotionView,
  MotionMaterial, getMaterialAvailability } from "../packages/motion/src/index";

const a = {} as any, b = {} as any, c = {} as any;
const sent = (mock: { mock: { calls: unknown[][] } }, call = -1) => JSON.parse(mock.mock.calls.at(call)![0] as string);
const code = (run: () => unknown) => { try { run(); } catch (error) { return (error as { code?: string }).code; } return "none"; };
const CHANNELS = ["opacity", "translateX", "translateY", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "perspective", "borderRadius", "shadowOpacity", "shadowRadius",
  "shadowOffsetX", "shadowOffsetY", "blur", "maskInsetTop", "maskInsetBottom", "maskInsetStart", "maskInsetEnd", "maskRadius", "materialIntensity", "materialTintOpacity",
  "backgroundColorL", "backgroundColorC", "backgroundColorH", "backgroundColorAlpha"];
const values = (value: number) => Object.fromEntries(CHANNELS.map(property => [property, value]));

beforeEach(() => {
  platform.OS = "macos"; registered.mockReturnValue(true);
  tags.clear(); tags.set(a, 11); tags.set(b, 12); tags.set(c, 13);
  for (const fn of Object.values(native)) fn.mockClear();
});
afterEach(() => vi.restoreAllMocks());

test("the public entry exports the imperative API, builders, the components, and no hooks", () => {
  expect(Object.keys(motion).sort()).toEqual(["MotionMaterial", "MotionNumber", "MotionPresence", "MotionSymbol", "MotionText", "MotionView", "animate", "decay", "getMaterialAvailability", "getMotionAvailability", "getMotionEnvironment", "getMotionState",
    "getSymbolEffectAvailability", "keyframes", "linkScroll", "motionPath", "playSymbolEffect", "recordMotionFrames", "sequence", "setMotionValues", "spring", "stagger", "stopMotion", "stopSymbolEffects", "timeline", "timing"]);
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

test("plans carry the Reduce Motion alternate, the hidden-window rule and cues, validated before native code", async () => {
  await animate(a, { translateX: 100 }, { reducedValues: { opacity: timing(0.5) }, reducedMotion: "instant", whenHidden: "pause", cues: [{ at: 0, haptic: "alignment" }, { at: "end", sound: "Tink", haptic: "levelChange" }] }).finished;
  const plan = sent(native.run);
  expect(plan).toMatchObject({ reducedMotion: "instant", whenHidden: "pause", cues: [{ at: 0, haptic: "alignment" }, { at: "end", haptic: "levelChange", sound: "Tink" }] });
  expect(plan.groups).toEqual([{ tag: 11, tracks: { translateX: spring(100) }, reducedTracks: { opacity: timing(0.5) } }]);
  // Omitted options keep the engine's defaults (fade, complete, no cues) and add nothing to the plan.
  await animate(a, { opacity: 1 }, { cues: [] }).finished;
  expect(Object.keys(sent(native.run)).sort()).toEqual(["groups", "id"]);
  await stagger([a, b], { opacity: 0 }, { eachMs: 10, reducedValues: { opacity: timing(0) }, reducedMotion: "play" }).finished;
  expect(sent(native.run)).toMatchObject({ reducedMotion: "play", groups: [{ reducedTracks: { opacity: timing(0) } }, { reducedTracks: { opacity: timing(0) } }] });
  await timeline([{ target: a, values: { opacity: 1 }, reducedValues: { opacity: timing(1, { durationMs: 0 }) } }, { target: b, values: { scale: 1.1 } }], { whenHidden: "complete" }).finished;
  expect(sent(native.run)).toMatchObject({ whenHidden: "complete", groups: [{ reducedTracks: { opacity: timing(1, { durationMs: 0 }) } }, { tracks: { scaleX: spring(1.1) } }] });
  expect(sent(native.run).groups[1].reducedTracks).toBeUndefined();

  native.run.mockClear();
  for (const bad of [{ reducedMotion: "slow" }, { whenHidden: "stop" }, { cues: {} }, { cues: [{ at: 0 }] }, { cues: [{ at: -1, haptic: "generic" }] }, { cues: [{ at: "start", haptic: "generic" }] },
    { cues: [{ at: 0, haptic: "thud" }] }, { cues: [{ at: 0, sound: "" }] }, { cues: [{ at: 0, haptic: "generic", volume: 1 }] }, { reducedValues: {} }, { reducedValues: { width: 1 } }, { speed: 2 }])
    expect(code(() => animate(a, { opacity: 1 }, bad as never)), JSON.stringify(bad)).toBe("E_INVALID_ARGUMENT");
  expect(code(() => timeline([{ target: a, values: { opacity: 1 } }], { delayMs: 1 } as never))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => stagger([a], { opacity: 1 }, { eachMs: 1, cues: [{ at: 0 }] } as never))).toBe("E_INVALID_ARGUMENT");
  expect(native.run).not.toHaveBeenCalled();
});

test("getMotionEnvironment reads Reduce Motion, power, frame rate and window visibility, and validates the reply", async () => {
  const environment = { reduceMotion: true, reduceTransparency: false, lowPowerMode: false, maximumFrameRate: 120, frameRate: 120, windowVisible: true };
  native.environment.mockResolvedValueOnce(JSON.stringify(environment));
  await expect(getMotionEnvironment(a)).resolves.toEqual(environment);
  expect(native.environment).toHaveBeenLastCalledWith(11);
  const display = { ...environment, maximumFrameRate: null, frameRate: 60, windowVisible: null };
  native.environment.mockResolvedValueOnce(JSON.stringify(display));
  await expect(getMotionEnvironment()).resolves.toEqual(display);
  expect(native.environment).toHaveBeenLastCalledWith(0);
  native.environment.mockResolvedValueOnce(JSON.stringify({ ...environment, frameRate: "120" }));
  await expect(getMotionEnvironment(a)).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  native.environment.mockRejectedValueOnce(Object.assign(new Error("not mounted"), { code: "E_NOT_FOUND" }));
  await expect(getMotionEnvironment(a)).rejects.toMatchObject({ name: "SparkError", code: "E_NOT_FOUND" });
  await expect(getMotionEnvironment(null)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(getMotionEnvironment({} as never)).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});

test("set, stop, state, scroll links and frame reports validate input and native results", async () => {
  await setMotionValues(a, { scale: 2, translateX: -4 });
  expect(sent(native.set)).toEqual({ tag: 11, values: { scaleX: 2, scaleY: 2, translateX: -4 } });
  await expect(setMotionValues(a, { opacity: Number.NaN })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await stopMotion(a);
  expect(sent(native.stop).tag).toBe(11);
  expect([...sent(native.stop).properties].sort()).toEqual([...CHANNELS].sort());
  await stopMotion(b, ["scale", "rotate"]);
  expect(sent(native.stop)).toEqual({ tag: 12, properties: ["scaleX", "scaleY", "rotate"] });

  const state = { values: { ...values(1), backgroundColorL: 0.627955, backgroundColorC: 0.257683, backgroundColorH: 389.2339, backgroundColorAlpha: 1 }, velocities: values(0), animating: ["translateX"] };
  native.getState.mockResolvedValueOnce(JSON.stringify(state));
  // Colors are reported as CSS OKLCH, the hue back on the wheel.
  await expect(getMotionState(a)).resolves.toEqual({ ...state, colors: { backgroundColor: "oklch(0.628 0.2577 29.23 / 1)" } });
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
    await expect(getMotionEnvironment()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    expect(code(() => MotionView({ children: null }))).toBe("E_UNSUPPORTED_PLATFORM");
    expect(getMaterialAvailability("hudWindow")).toEqual({ available: false, reason: "unsupported-platform" });
    expect(code(() => MotionMaterial({ material: "hudWindow" }))).toBe("E_UNSUPPORTED_PLATFORM");
  }
  expect(Object.values(native).every(fn => fn.mock.calls.length === 0)).toBe(true);
});

test("visual effects: number properties, OKLCH color animations split into components, and colors where numbers belong are rejected", async () => {
  await animate(a, { rotateY: 180, perspective: timing(600), borderRadius: spring(12), shadowRadius: 8, blur: timing(4), maskInsetStart: keyframes([10, 0], { durationMs: 300 }) }).finished;
  expect(Object.keys(sent(native.run).groups[0].tracks)).toEqual(["rotateY", "perspective", "borderRadius", "shadowRadius", "blur", "maskInsetStart"]);
  // One color animation is four component animations: lightness, chroma, hue and alpha, each with the spec's timing.
  await animate(a, { backgroundColor: timing("#ff0000", { durationMs: 400 }) }).finished;
  const red = sent(native.run).groups[0].tracks;
  expect(Object.keys(red)).toEqual(["backgroundColorL", "backgroundColorC", "backgroundColorH", "backgroundColorAlpha"]);
  expect(red.backgroundColorL.to).toBeCloseTo(0.627955, 5); expect(red.backgroundColorC.to).toBeCloseTo(0.257683, 5);
  expect(red.backgroundColorH.to).toBeCloseTo(29.2339, 3); expect(red.backgroundColorAlpha).toEqual({ ...red.backgroundColorL, to: 1 });
  expect(red.backgroundColorL).toMatchObject({ type: "timing", durationMs: 400 });
  // A gray leaves the hue alone; a transparent target only fades alpha; a bare color is a default spring.
  await animate(a, { backgroundColor: "rgb(128 128 128 / 50%)" }).finished;
  const gray = sent(native.run).groups[0].tracks;
  expect(Object.keys(gray)).toEqual(["backgroundColorL", "backgroundColorC", "backgroundColorAlpha"]);
  expect(gray.backgroundColorAlpha).toMatchObject({ type: "spring", to: 0.5 });
  await animate(a, { backgroundColor: timing("transparent") }).finished;
  expect(sent(native.run).groups[0].tracks).toEqual({ backgroundColorAlpha: expect.objectContaining({ to: 0 }) });
  // Keyframes unwrap the hue the shorter way round between stops; a gray stop takes its neighbour's hue.
  await animate(a, { backgroundColor: keyframes(["oklch(0.7 0.1 350)", "oklch(0.7 0 0)", "oklch(0.7 0.1 20)"], { durationMs: 600 }) }).finished;
  expect(sent(native.run).groups[0].tracks.backgroundColorH.values).toEqual([350, 350, 380]);
  await animate(a, { backgroundColor: sequence([timing("#00f"), spring("#ff0")]) }).finished;
  expect(sent(native.run).groups[0].tracks.backgroundColorL).toMatchObject({ type: "sequence", steps: [{ type: "timing" }, { type: "spring" }] });
  for (const bad of [
    () => animate(a, { backgroundColor: 1 as never }), () => animate(a, { opacity: spring("#fff") as never }), () => animate(a, { backgroundColor: decay({ velocity: 1 }) as never }),
    () => spring("red"), () => timing("#ggg"), () => keyframes([1, "#fff"] as never, { durationMs: 1 }), () => sequence([timing(1), timing("#fff")] as never),
    () => animate(a, { backgroundColor: "color(display-p3 1 0 0)" }),
  ]) expect(code(bad)).toBe("E_INVALID_ARGUMENT");
  expect(code(() => spring("#fff", { velocity: 2 }))).toBe("E_UNSUPPORTED_OPTION");
  expect(code(() => timing("#fff", { restDelta: 0.1 }))).toBe("E_UNSUPPORTED_OPTION");
  // Set, stop and scroll links take colors too.
  await setMotionValues(a, { backgroundColor: "#ffffff", borderRadius: 6 });
  const white = sent(native.set).values;
  expect(white.backgroundColorL).toBeCloseTo(1, 5); expect(white.backgroundColorC).toBeCloseTo(0, 5); expect(white).toMatchObject({ backgroundColorAlpha: 1, borderRadius: 6 });
  await stopMotion(a, ["backgroundColor", "blur"]);
  expect(sent(native.stop).properties).toEqual(["backgroundColorL", "backgroundColorC", "backgroundColorH", "backgroundColorAlpha", "blur"]);
  await linkScroll(a, { source: { nativeID: "list" }, input: [0, 100], output: { backgroundColor: ["#ffffff", "#2563eb"] } });
  expect(Object.keys(sent(native.link).output)).toEqual(["backgroundColorL", "backgroundColorC", "backgroundColorH", "backgroundColorAlpha"]);
  expect(sent(native.link).output.backgroundColorH[0]).toBe(sent(native.link).output.backgroundColorH[1]);  // white takes blue's hue
  await expect(linkScroll(a, { source: { nativeID: "list" }, input: [0, 100], output: { backgroundColor: ["#fff", 2] as never } })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("MotionView passes validated initial values once, refuses style opacity or transform, and a property set by both initial and style", async () => {
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
  // The style may set the background, corners and shadow (motion takes them over when it first drives them), but not
  // a property `initial` sets too.
  const styled = { backgroundColor: "red", borderTopStartRadius: 4, shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } };
  await act(async () => { rendered = create(React.createElement(MotionView, { style: styled })); });
  expect(rendered.root.findByType("SparkMotionView").props.style).toEqual(styled);
  await act(async () => rendered.unmount());
  for (const [initial, style] of [[{ backgroundColor: "#fff" }, { backgroundColor: "red" }], [{ borderRadius: 2 }, { borderTopStartRadius: 4 }], [{ shadowOffsetY: 2 }, { shadowOffset: { width: 0, height: 1 } }]] as const)
    expect(code(() => MotionView({ initial, style } as never)), JSON.stringify(style)).toBe("E_INVALID_ARGUMENT");
  await act(async () => { rendered = create(React.createElement(MotionView, { initial: { backgroundColor: "#000", maskRadius: 4 }, style: { shadowColor: "#000", borderRadius: 3 } })); });
  expect(JSON.parse(rendered.root.findByType("SparkMotionView").props.initialValues)).toEqual({ backgroundColorL: 0, backgroundColorC: 0, backgroundColorH: 0, backgroundColorAlpha: 1, maskRadius: 4 });
  await act(async () => rendered.unmount());
  expect(code(() => MotionView({ initial: { backgroundColor: "blue" } }))).toBe("E_INVALID_ARGUMENT");
  // Style React Native draws on other layers (its own borders, a clip mask) cannot be driven by `initial`.
  for (const [initial, style] of [[{ backgroundColor: "#fff" }, { borderWidth: 1, borderColor: "#000" }], [{ borderRadius: 4 }, { borderTopColor: "red" }],
    [{ backgroundColor: "#fff" }, { borderStyle: "dashed" }], [{ maskRadius: 2 }, { overflow: "hidden", borderTopLeftRadius: 8 }]] as const)
    expect(code(() => MotionView({ initial, style } as never)), JSON.stringify(style)).toBe("E_UNSUPPORTED_OPTION");
});

test("MotionMaterial: truthful availability, validated material props, a crossfade transition, and material properties only on a material", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  expect(getMaterialAvailability("hudWindow")).toEqual({ available: true });
  expect(native.supportsMaterial).toHaveBeenLastCalledWith("hudWindow");
  native.supportsMaterial.mockImplementation(name => name !== "glass");
  expect(getMaterialAvailability("glass")).toEqual({ available: false, reason: "host-restriction" });
  expect(code(() => MotionMaterial({ material: "glass" }))).toBe("E_UNAVAILABLE");
  native.supportsMaterial.mockImplementation(() => true);
  expect(code(() => getMaterialAvailability("frosted" as never))).toBe("E_INVALID_ARGUMENT");
  let rendered: any;
  await act(async () => { rendered = create(React.createElement(MotionMaterial, { material: "sidebar", blendingMode: "withinWindow", tintColor: "#2563eb80", initial: { materialIntensity: 0 }, testID: "panel" })); });
  const props = rendered.root.findByType("SparkMotionView").props;
  expect(props.testID).toBe("panel");
  expect(JSON.parse(props.material)).toEqual({ material: "sidebar", blendingMode: "withinWindow" });
  expect(JSON.parse(props.tintColor)).toHaveLength(4);
  expect(JSON.parse(props.tintColor)[3]).toBeCloseTo(128 / 255, 6);
  expect(JSON.parse(props.crossfade)).toEqual({ type: "timing", durationMs: 250, easing: [0.42, 0, 0.58, 1] });
  expect(JSON.parse(props.initialValues)).toEqual({ materialIntensity: 0 });
  await act(async () => rendered.unmount());
  await act(async () => { rendered = create(React.createElement(MotionMaterial, { material: "glass", crossfade: { preset: "snappy" } })); });
  expect(JSON.parse(rendered.root.findByType("SparkMotionView").props.crossfade)).toMatchObject({ type: "spring" });
  await act(async () => rendered.unmount());
  expect(code(() => MotionMaterial({ material: "frosted" as never }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionMaterial({ material: "menu", blendingMode: "over" as never }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionMaterial({ material: "menu", state: "on" as never }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionMaterial({ material: "menu", emphasized: 1 as never }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionMaterial({ material: "menu", tintColor: "blue" }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionMaterial({ material: "menu", crossfade: { type: "timing", velocity: 2 } as never }))).toBe("E_UNSUPPORTED_OPTION");
  expect(code(() => MotionMaterial({ material: "glass", blendingMode: "withinWindow" }))).toBe("E_UNSUPPORTED_OPTION");
  expect(code(() => MotionMaterial({ material: "menu", children: "text" } as never))).toBe("E_INVALID_ARGUMENT");
  // The material properties animate like any property; a MotionView without a material cannot start with them.
  await animate(a, { materialIntensity: timing(0.5), materialTintOpacity: spring(0) }).finished;
  expect(Object.keys(sent(native.run).groups[0].tracks)).toEqual(["materialIntensity", "materialTintOpacity"]);
  expect(code(() => MotionView({ initial: { materialTintOpacity: 0 } }))).toBe("E_UNSUPPORTED_OPTION");
  expect(code(() => animate(a, { materialCrossfade: 0 } as never))).toBe("E_INVALID_ARGUMENT");
});
