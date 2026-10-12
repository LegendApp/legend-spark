import { createRequire } from "node:module";
import React, { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");

// The screens run against the real @legendapp/spark/motion package with a recorded native module.
const { state, native, tags, system } = vi.hoisted(() => ({
  state: { locale: "en" as "en" | "ar", os: "macos" },
  native: {
    run: vi.fn(async (_json: string) => JSON.stringify({ finished: true })),
    stopAnimation: vi.fn(async (_id: string) => {}), set: vi.fn(async (_json: string) => {}), stop: vi.fn(async (_json: string) => {}),
    getState: vi.fn(async (_tag: number) => ""), link: vi.fn(async (_json: string) => {}), unlink: vi.fn(async (_id: string) => {}), recordFrames: vi.fn(async (_json: string) => ""),
    environment: vi.fn(async (_tag: number) => JSON.stringify({ reduceMotion: false, lowPowerMode: false, maximumFrameRate: 120, frameRate: 120, windowVisible: true })),
  },
  tags: new WeakMap<object, number>(),
  system: { handler: undefined as undefined | (() => void), options: undefined as unknown, removed: 0 },
}));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", ScrollView: "ScrollView",
  Platform: { get OS() { return state.os; } },
  UIManager: { hasViewManagerConfig: () => true },
  TurboModuleRegistry: { get: () => native },
  findNodeHandle: (target: object) => tags.get(target) ?? null,
  StyleSheet: { flatten: (style: unknown) => style },
}));
vi.mock("../packages/motion/src/motion-view-host", () => ({ getNativeMotionView: () => "SparkMotionView" }));
vi.mock("../examples/kitchen-sink/shell/app-controller", () => ({ useI18n: () => ({ locale: state.locale, rtl: state.locale === "ar" }) }));
vi.mock("@legendapp/spark/ui", () => ({ Button: (props: object) => React.createElement("Button", props) }));
vi.mock("@legendapp/spark/system", () => ({
  onSystemEvent: async (handler: () => void, options: unknown) => { system.handler = handler; system.options = options; return { remove: async () => { system.removed++; } }; },
}));
import { AccessibilityPower, ScrollAndFrames, Springs, Timelines } from "../examples/kitchen-sink/screens/motion-system/MotionScreens";

let rendered: any, nextTag = 100;
const state0 = (x: number, v: number) => JSON.stringify({ values: { opacity: 1, translateX: x, translateY: 0, scaleX: 1, scaleY: 1, rotate: 0 }, velocities: { opacity: 0, translateX: v, translateY: 0, scaleX: 0, scaleY: 0, rotate: 0 }, animating: v ? ["translateX"] : [] });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = "en"; state.os = "macos";
  for (const fn of Object.values(native)) fn.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
async function mount(screen: React.ComponentType) {
  await act(async () => { rendered = create(React.createElement(screen), { createNodeMock: () => { const node = {}; tags.set(node, ++nextTag); return node; } }); });
}
const byID = (testID: string) => rendered.root.find((node: any) => typeof node.type === "string" && node.props.testID === testID);
const text = (testID: string) => byID(testID).props.children;
const press = (testID: string) => act(async () => { byID(testID).props.onPress(); });
const plans = () => native.run.mock.calls.map(([json]) => JSON.parse(json));

test("the motion screens are registered in the motion-system area", async () => {
  const { default: registered } = await import("../examples/kitchen-sink/screens/motion-system/index");
  expect(registered.area).toBe("motion-system");
  expect(registered.screens.map(screen => screen.id)).toEqual(["springs", "timelines", "scroll-and-frames", "layout", "accessibility-power"]);
});

test("springs: preset parameters, playing every preset, and moving with the reading direction", async () => {
  await mount(Springs);
  expect(text("motion-system-springs-availability")).toBe('{"available":true}');
  expect(byID("motion-system-springs-bouncy").type).toBe("SparkMotionView");
  expect(text("motion-system-springs-interactive-parameters")).toBe('{"mass":1,"stiffness":1754.6,"damping":72}');
  await press("motion-system-springs-play");
  expect(plans().map(plan => plan.groups[0].tracks.translateX.to)).toEqual([240, 240, 240, 240, 240]);
  expect(text("motion-system-springs-play-result")).toBe(JSON.stringify(Array(5).fill({ finished: true })));
  await press("motion-system-springs-play");
  expect(plans().slice(5).map(plan => plan.groups[0].tracks.translateX.to)).toEqual([0, 0, 0, 0, 0]);
  await act(async () => rendered.unmount()); rendered = undefined;
  state.locale = "ar"; native.run.mockClear();
  await mount(Springs);
  await press("motion-system-springs-release");
  expect(plans()[0].groups[0].tracks.translateX).toMatchObject({ to: -120, velocity: -2400 });
});

test("interruption reports the state before and after the replacement spring, then stop and reset", async () => {
  await mount(Springs);
  native.getState.mockResolvedValueOnce(state0(60, 60)).mockResolvedValueOnce(state0(60, 60));
  await press("motion-system-springs-interrupt");
  expect(text("motion-system-springs-interruption-result")).toBe('{"before":{"value":60,"velocity":60},"after":{"value":60,"velocity":60},"finished":true}');
  expect(plans()[0].groups[0].tracks.translateX).toMatchObject({ type: "spring", to: 0 });
  native.getState.mockResolvedValue(state0(30, 0));
  await press("motion-system-springs-stop");
  expect(JSON.parse(native.stop.mock.calls[0]![0]).properties).toEqual(["translateX"]);
  expect(text("motion-system-springs-interruption-result")).toBe('{"value":30,"velocity":0,"animating":[]}');
  await press("motion-system-springs-reset");
  expect(JSON.parse(native.set.mock.calls[0]![0]).values).toEqual({ translateX: 0 });
});

test("timelines send one plan each: keyframes, sequence, a centered stagger, a timeline and a clamped decay", async () => {
  await mount(Timelines);
  for (const id of ["keyframes", "sequence", "stagger", "timeline", "decay"]) {
    await press(`motion-system-timelines-${id}-run`);
    expect(text(`motion-system-timelines-${id}-result`)).toBe('{"finished":true}');
  }
  const [keyframes, sequence, stagger, timeline, decay] = plans();
  expect(keyframes.groups[0].tracks.translateX).toMatchObject({ type: "keyframes", values: [240, 80, 158.4, 0] });
  expect(sequence.groups[0].tracks.translateX).toMatchObject({ type: "sequence", repeat: 1, reverse: true });
  expect(stagger.groups.map((group: { offsetMs: number }) => group.offsetMs)).toEqual([140, 70, 0, 70, 140]);
  expect(timeline.groups[1]).toMatchObject({ after: "previous" });
  expect(decay.groups[0].tracks.translateX).toMatchObject({ type: "decay", velocity: 1800, clamp: [0, 240] });
});

test("scroll and frames: the runner loops from mount, the badge links to the list, and the JS block reports frames", async () => {
  await mount(ScrollAndFrames);
  expect(plans()[0].groups[0].tracks.translateX).toMatchObject({ type: "timing", to: 240, repeat: "infinite", reverse: true });
  expect(text("motion-system-scroll-and-frames-loop")).toBe('{"finished":true}');
  await press("motion-system-scroll-and-frames-link");
  expect(JSON.parse(native.link.mock.calls[0]![0])).toMatchObject({ nativeID: "motion-system-scroll-source", output: { opacity: [1, 0.5, 0.2], scaleX: [1, 0.8, 0.6], rotate: [0, 90, 180] } });
  expect(text("motion-system-scroll-and-frames-link-result")).toBe('"linked"');
  await press("motion-system-scroll-and-frames-unlink");
  expect(native.unlink).toHaveBeenCalledTimes(1);
  native.recordFrames.mockResolvedValueOnce(JSON.stringify({ refreshRate: 120, durationMs: 1500.04, frames: 181, stalledFrames: 0, animatedFrames: 181, droppedFrames: 0, maxFrameGapMs: 8.333 }));
  await press("motion-system-scroll-and-frames-block");
  expect(JSON.parse(native.recordFrames.mock.calls[0]![0]).durationMs).toBe(1500);
  expect(text("motion-system-scroll-and-frames-report")).toMatch(/^\{"blockedMs":5\d\d,"frames":181,"animatedFrames":181,"droppedFrames":0,"stalledFrames":0,"maxFrameGapMs":8.3,"refreshRate":120,"durationMs":1500\}$/);
});

test("accessibility, power and lifecycle: the environment follows system events, plans carry alternates, cues and the hidden rule, and unmount cancels", async () => {
  await mount(AccessibilityPower);
  const id = (part: string) => `motion-system-accessibility-power-${part}`;
  expect(native.environment).not.toHaveBeenCalled();  // read once the card is laid out in its window
  await act(async () => { rendered.root.find((node: any) => typeof node.props.onLayout === "function").props.onLayout(); });
  expect(text(id("environment"))).toBe('{"reduceMotion":false,"lowPowerMode":false,"maximumFrameRate":120,"frameRate":120,"windowVisible":true}');
  expect(native.environment.mock.calls[0]![0]).toBeGreaterThan(100);  // the card's MotionView, not the main display (0)
  expect(system.options).toEqual({ types: ["accessibilityDisplayChanged", "lowPowerChanged"] });
  native.environment.mockResolvedValueOnce(JSON.stringify({ reduceMotion: true, lowPowerMode: true, maximumFrameRate: 120, frameRate: 60, windowVisible: true }));
  await act(async () => { system.handler!(); });
  expect(text(id("environment"))).toBe('{"reduceMotion":true,"lowPowerMode":true,"maximumFrameRate":120,"frameRate":60,"windowVisible":true}');

  for (const part of ["slide", "shake", "instant"]) await press(id(part));
  const [slid, shook, instant] = plans();
  expect(slid.groups[0].tracks.translateX).toMatchObject({ type: "spring", to: 240 });
  expect(slid.reducedMotion).toBeUndefined();
  expect(shook.groups[0]).toMatchObject({ tracks: { translateX: { type: "keyframes", values: [-12, 12, -8, 8, 0] } }, reducedTracks: { opacity: { type: "sequence" } } });
  expect(instant).toMatchObject({ reducedMotion: "instant", groups: [{ tracks: { translateX: { to: 0 } } }] });
  expect(text(id("reduced-result"))).toBe('{"finished":true}');

  native.run.mockClear();
  await press(id("hidden-start"));
  expect(native.set).toHaveBeenCalledTimes(2);
  const [spin, away] = plans();
  expect(spin.groups[0].tracks.rotate).toMatchObject({ type: "timing", to: 360, repeat: "infinite" });
  expect(away).toMatchObject({ whenHidden: "complete", groups: [{ tracks: { translateX: { type: "timing", to: 240, durationMs: 8000 } } }] });
  expect(text(id("hidden-result"))).toBe('{"finished":true}');

  native.run.mockClear();
  await press(id("cues-play"));
  expect(plans()[0].cues).toEqual([{ at: 0, haptic: "alignment" }, { at: "end", haptic: "levelChange", sound: "Tink" }]);

  native.run.mockClear();
  let settle!: (json: string) => void;
  native.run.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  await press(id("long-start"));
  expect(plans()[0].groups[0].tracks.translateX).toMatchObject({ durationMs: 10000 });
  expect(text(id("long-result"))).toBe("…");
  await press(id("long-mount"));
  expect(rendered.root.findAll((node: any) => typeof node.type === "string" && node.props.testID === id("long"))).toHaveLength(0);
  await act(async () => { settle(JSON.stringify({ finished: false })); });  // the engine settles an unmounted view's animation
  expect(text(id("long-result"))).toBe('{"finished":false}');
  await act(async () => rendered.unmount()); rendered = undefined;
  expect(system.removed).toBe(1);
});

test("Windows shows the typed unsupported error where the motion views would be, and sends nothing", async () => {
  state.os = "windows";
  for (const [screen, id] of [[Springs, "springs"], [Timelines, "timelines"], [ScrollAndFrames, "scroll-and-frames"], [AccessibilityPower, "accessibility-power"]] as const) {
    await mount(screen);
    expect(text(`motion-system-${id}-availability`)).toBe('{"available":false,"reason":"unsupported-platform"}');
    expect(text(`motion-system-${id}-error`)).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
    expect(rendered.root.findAll((node: any) => node.type === "SparkMotionView")).toHaveLength(0);
    await act(async () => rendered.unmount()); rendered = undefined;
  }
  expect(Object.values(native).every(fn => fn.mock.calls.length === 0)).toBe(true);
});
