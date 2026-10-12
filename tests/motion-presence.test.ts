import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");

// Layout, presence and shared elements (docs/motion.md#layout-presence-and-shared-elements) against a recorded native module.
const { platform, native, tags } = vi.hoisted(() => ({
  platform: { OS: "macos" },
  native: {
    run: vi.fn(async (_json: string) => JSON.stringify({ finished: true })),
    stopAnimation: vi.fn(async () => {}), set: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    getState: vi.fn(async () => ""), link: vi.fn(async () => {}), unlink: vi.fn(async () => {}), recordFrames: vi.fn(async () => ""),
  },
  tags: new WeakMap<object, number>(),
}));
vi.mock("react-native", () => ({
  Platform: platform,
  UIManager: { hasViewManagerConfig: () => true },
  TurboModuleRegistry: { get: () => native },
  findNodeHandle: (target: object) => tags.get(target) ?? null,
  StyleSheet: { flatten: (style: unknown) => style },
}));
vi.mock("../packages/motion/src/motion-view-host", () => ({ getNativeMotionView: () => "SparkMotionView" }));
import { MotionPresence, MotionView, spring, timing, type MotionAnimationValues } from "../packages/motion/src/index";
import { Presence } from "../packages/motion/src/presence";
import { transitionSpec } from "../packages/motion/src/specs";

const h = React.createElement;
const code = (run: () => unknown) => { try { run(); } catch (error) { return (error as { code?: string }).code; } return "none"; };
const plans = () => native.run.mock.calls.map(([json]) => JSON.parse(json));
let rendered: any, nextTag = 0;
const nodes = new Map<string, object>();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  platform.OS = "macos";
  native.run.mockReset();
  native.run.mockImplementation(async () => JSON.stringify({ finished: true }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });

async function render(element: React.ReactElement) {
  if (rendered) await act(async () => { rendered.update(element); });
  else await act(async () => {
    rendered = create(element, { createNodeMock: (node: any) => { const mock = {}; tags.set(mock, ++nextTag); nodes.set(node.props.testID, mock); return mock; } });
  });
}
const shown = () => rendered.root.findAll((node: any) => node.type === "SparkMotionView").map((node: any) => node.props.testID);
const tagOf = (testID: string) => tags.get(nodes.get(testID)!);
/** Resolves the next native run when the test says so. */
function deferRun() {
  let finish!: (finished: boolean) => void;
  native.run.mockImplementationOnce(() => new Promise(resolve => { finish = finished => resolve(JSON.stringify({ finished })); }));
  return (finished: boolean) => act(async () => { finish(finished); });
}

test("transitions: the smooth spring by default, a spring or timing without a target, nothing an animation option would add", () => {
  const { to: _to, ...smooth } = spring(0, { preset: "smooth" });
  expect(transitionSpec()).toEqual(smooth);
  expect(transitionSpec({ preset: "bouncy" })).toEqual((({ to: _, ...rest }) => rest)(spring(0, { preset: "bouncy" })));
  expect(transitionSpec({ type: "timing", durationMs: 200, easing: "easeOut" })).toEqual({ type: "timing", durationMs: 200, easing: [0, 0, 0.58, 1] });
  expect(code(() => transitionSpec({ velocity: 10 } as never))).toBe("E_UNSUPPORTED_OPTION");
  expect(code(() => transitionSpec({ type: "timing", repeat: 2 } as never))).toBe("E_UNSUPPORTED_OPTION");
  expect(code(() => transitionSpec({ type: "decay" } as never))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => transitionSpec({ responseMs: -1 }))).toBe("E_INVALID_ARGUMENT");
});

test("MotionView sends its layout mode, shared id and validated transition to the native view", async () => {
  await render(h(MotionView, { testID: "row", layout: "position" }));
  const row = rendered.root.findByType("SparkMotionView").props;
  expect(row).toMatchObject({ layout: "position", sharedId: undefined });
  expect(JSON.parse(row.transition)).toEqual(transitionSpec());
  await render(h(MotionView, { testID: "photo", sharedId: "photo-1", transition: { type: "timing", durationMs: 300 } }));
  const photo = rendered.root.findByType("SparkMotionView").props;
  expect(photo).toMatchObject({ layout: undefined, sharedId: "photo-1" });
  expect(JSON.parse(photo.transition)).toEqual({ type: "timing", durationMs: 300, easing: [0.42, 0, 0.58, 1] });
  await render(h(MotionView, { testID: "plain" }));
  expect(rendered.root.findByType("SparkMotionView").props.transition).toBeUndefined();
  expect(code(() => MotionView({ layout: "size" as never }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionView({ sharedId: "" }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionView({ transition: { preset: "snappy" } }))).toBe("E_INVALID_ARGUMENT");
  expect(code(() => MotionView({ layout: "frame", transition: { stiffness: 1 } }))).toBe("E_INVALID_ARGUMENT");
  expect(native.run).not.toHaveBeenCalled();
});

test("enter plays at mount from initial; exit needs a MotionPresence; both validate when rendered", async () => {
  const ref = React.createRef<any>();
  await render(h(MotionView, { testID: "card", ref, initial: { opacity: 0 }, enter: { opacity: timing(1, { durationMs: 150 }), translateY: 0 } }));
  expect(ref.current).toBe(nodes.get("card"));
  expect(plans()).toEqual([{ id: expect.any(String), groups: [{ tag: tagOf("card"), tracks: { opacity: timing(1, { durationMs: 150 }), translateY: spring(0) } }] }]);
  for (const element of [h(MotionView, { exit: { opacity: 0 } }), h(MotionView, { enter: { width: 1 } as never }), h(MotionPresence, null, h(MotionView, { exit: { opacity: Number.NaN } })),
    h(MotionPresence, null, h(MotionView, { exit: { opacity: timing(0, { durationMs: 200, repeat: Infinity }) } })),
    h(MotionPresence, null, h(MotionView, { exit: { scale: spring(0.9, { repeat: Infinity, reverse: true }) } }))])
    await expect(act(async () => { create(element); })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await act(async () => { rendered.unmount(); rendered = undefined; });
  expect(ref.current).toBeNull();
});

const exit: MotionAnimationValues = { opacity: timing(0, { durationMs: 200 }) };
const list = (keys: string[], props: { enter?: MotionAnimationValues; exit?: MotionAnimationValues } = { exit }) =>
  h(MotionPresence, null, keys.map(key => h(MotionView, { key, testID: key, layout: "position", ...props })));

test("a removed child stays mounted, where it was, until its exit settles, then unmounts", async () => {
  await render(list(["a", "b", "c"]));
  expect(native.run).not.toHaveBeenCalled();
  const settle = deferRun();
  await render(list(["a", "c"]));
  expect(shown()).toEqual(["a", "b", "c"]);
  expect(plans()).toEqual([{ id: expect.any(String), groups: [{ tag: tagOf("b"), tracks: { opacity: timing(0, { durationMs: 200 }) } }] }]);
  await render(list(["a", "c", "d"]));
  expect(shown()).toEqual(["a", "b", "c", "d"]);
  await settle(true);
  expect(shown()).toEqual(["a", "c", "d"]);
  // A child with no exit animation unmounts at once.
  await render(list(["a", "d"], {}));
  expect(shown()).toEqual(["a", "d"]);
});

test("a child added back while it exits stays and plays enter; the interrupted exit does not unmount it", async () => {
  const enter = { opacity: timing(1, { durationMs: 200 }) };
  await render(list(["a", "b"], { enter, exit }));
  native.run.mockClear();
  const settle = deferRun();
  await render(list(["a"], { enter, exit }));
  await render(list(["a", "b"], { enter, exit }));
  expect(plans().map(plan => plan.groups[0].tracks.opacity.to)).toEqual([0, 1]);
  await settle(false);
  expect(shown()).toEqual(["a", "b"]);
  // Removed again, it waits for its new exit.
  const again = deferRun();
  await render(list(["a"], { enter, exit }));
  expect(shown()).toEqual(["a", "b"]);
  await again(true);
  expect(shown()).toEqual(["a"]);
});

test("presence keeps removed children at their place across reorders, and rejects non-element children", () => {
  const changed = vi.fn();
  const presence = new Presence(changed);
  const element = (key: string) => h(MotionView, { key });
  const keys = (children: React.ReactNode) => presence.update(children).map(entry => [entry.key.replace(".$", ""), entry.state.exiting]);
  expect(keys(["a", "b", "c", "d"].map(element))).toEqual([["a", false], ["b", false], ["c", false], ["d", false]]);
  expect(keys(["d", "a", "c"].map(element))).toEqual([["d", false], ["a", false], ["b", true], ["c", false]]);
  expect(keys(["d", "a", "c"].map(element))).toEqual([["d", false], ["a", false], ["b", true], ["c", false]]);
  expect(code(() => presence.update(["text"]))).toBe("E_INVALID_ARGUMENT");
});

test("MotionPresence is typed unsupported where motion is unavailable", () => {
  platform.OS = "windows";
  expect(code(() => MotionPresence({ children: null }))).toBe("E_UNSUPPORTED_PLATFORM");
  expect(code(() => MotionView({ layout: "position" }))).toBe("E_UNSUPPORTED_PLATFORM");
});
