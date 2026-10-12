import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");

const { platform, registered, native, modules } = vi.hoisted(() => ({
  platform: { OS: "macos", Version: "26.0" },
  registered: vi.fn((_name: string) => true),
  native: { hideCursorUntilMoved: vi.fn(async () => {}), performHapticFeedback: vi.fn(async (_pattern: string, _time: string) => {}) },
  modules: { present: true },
}));
vi.mock("react-native", () => ({
  Platform: platform,
  UIManager: { hasViewManagerConfig: registered },
  TurboModuleRegistry: { get: () => modules.present ? native : null },
  StyleSheet: { flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style) : style },
}));
vi.mock("../packages/ui/src/pointer/PointerViewNativeComponent", () => ({ default: "SparkPointerView" }));
import * as pointer from "../packages/ui/src/pointer/index";
import { PointerView, getPointerAvailability, hideCursorUntilMoved, performHapticFeedback, type PointerFeature, type PointerViewProps } from "../packages/ui/src/pointer/index";

const FEATURES: PointerFeature[] = ["customCursors", "hideCursorUntilMoved", "gestures", "pressure", "mouseButtons", "haptics"];
const rejection = (promise: Promise<unknown>) => promise.then(() => "resolved", (error: { code?: string; name?: string }) => `${error.name}:${error.code}`);
let rendered: any;
async function mount(props: PointerViewProps) { await act(async () => { rendered = create(React.createElement(PointerView, props)); }); }
const host = () => rendered.root.findByType("SparkPointerView");
const send = (data: object) => act(() => host().props.onPointerInput({ nativeEvent: { x: 0, y: 0, magnification: 0, rotation: 0, phase: "", direction: "", pressure: 0, stage: 0, stageTransition: 0, button: "", ...data } }));
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; platform.Version = "26.0"; registered.mockReturnValue(true); modules.present = true;
  for (const fn of Object.values(native)) fn.mockClear();
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });

test("the public entry exports availability, the two commands and PointerView, and no hooks", () => {
  expect(Object.keys(pointer).sort()).toEqual(["PointerView", "getPointerAvailability", "hideCursorUntilMoved", "performHapticFeedback"]);
});

test("availability is truthful per platform, native view and module; unknown features throw", async () => {
  expect(getPointerAvailability()).toEqual({ available: true });
  expect(FEATURES.map(feature => getPointerAvailability(feature))).toEqual(Array(6).fill({ available: true }));
  expect(registered).toHaveBeenCalledWith("SparkPointerView");
  modules.present = false; vi.resetModules();
  const missing = (await import("../packages/ui/src/pointer/index")).getPointerAvailability;
  expect(missing()).toEqual({ available: false, reason: "missing-module" });
  expect(Object.fromEntries(FEATURES.map(feature => [feature, missing(feature).available]))).toEqual({
    customCursors: true, hideCursorUntilMoved: false, gestures: true, pressure: true, mouseButtons: true, haptics: false,
  });
  modules.present = true;
  registered.mockReturnValue(false);
  expect(getPointerAvailability("gestures")).toEqual({ available: false, reason: "missing-module" });
  expect(getPointerAvailability("haptics")).toEqual({ available: true });
  registered.mockReturnValue(true);
  platform.Version = "13.6";
  expect(getPointerAvailability("customCursors")).toEqual({ available: false, reason: "host-restriction" });
  platform.Version = "26.0";
  for (const os of ["windows", "ios", "android", "web"]) {
    platform.OS = os;
    expect([getPointerAvailability(), ...FEATURES.map(feature => getPointerAvailability(feature))]).toEqual(Array(7).fill({ available: false, reason: "unsupported-platform" }));
  }
  expect(() => getPointerAvailability("scroll" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});

test("hideCursorUntilMoved calls native; unavailable paths reject typed errors without calling it", async () => {
  await hideCursorUntilMoved();
  expect(native.hideCursorUntilMoved).toHaveBeenCalledTimes(1);
  modules.present = false; vi.resetModules();
  expect(await rejection((await import("../packages/ui/src/pointer/index")).hideCursorUntilMoved())).toBe("SparkError:E_MODULE_UNAVAILABLE");
  modules.present = true; platform.OS = "windows";
  expect(await rejection(hideCursorUntilMoved())).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  expect(native.hideCursorUntilMoved).toHaveBeenCalledTimes(1);
  platform.OS = "macos";
  native.hideCursorUntilMoved.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "E_NATIVE" }));
  expect(await rejection(hideCursorUntilMoved())).toBe("SparkError:E_NATIVE");
});

test("performHapticFeedback validates the pattern, time and options before calling native", async () => {
  await performHapticFeedback("alignment");
  await performHapticFeedback("levelChange", { performanceTime: "drawCompleted" });
  await performHapticFeedback("generic", { performanceTime: undefined });
  expect(native.performHapticFeedback.mock.calls).toEqual([["alignment", "default"], ["levelChange", "drawCompleted"], ["generic", "default"]]);
  expect(await rejection(performHapticFeedback("buzz" as never))).toBe("SparkError:E_INVALID_ARGUMENT");
  expect(await rejection(performHapticFeedback("generic", { performanceTime: "later" as never }))).toBe("SparkError:E_INVALID_ARGUMENT");
  expect(await rejection(performHapticFeedback("generic", { intensity: 1 } as never))).toBe("SparkError:E_UNSUPPORTED_OPTION");
  expect(await rejection(performHapticFeedback("generic", { intensity: undefined } as never))).toBe("SparkError:E_UNSUPPORTED_OPTION");
  expect(await rejection(performHapticFeedback("generic", null as never))).toBe("SparkError:E_INVALID_ARGUMENT");
  platform.OS = "windows";
  expect(await rejection(performHapticFeedback("generic"))).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  expect(native.performHapticFeedback).toHaveBeenCalledTimes(3);
});

test("PointerView passes its custom cursor and the event types it handles to the native view", async () => {
  await mount({ testID: "canvas", style: { flex: 1 }, customCursor: { type: "symbol", name: "pencil.tip" }, onMagnify: () => {}, onMouseButton: () => {} });
  expect(host().props).toMatchObject({ testID: "canvas", style: { flex: 1 }, cursorType: "symbol", cursorName: "pencil.tip", cursorPointSize: 16, cursorHasHotSpot: false, handledEvents: ["magnify", "mouseButton"] });
  await act(async () => rendered.update(React.createElement(PointerView, { customCursor: { type: "image", path: "/tmp/cursor.png", hotSpot: { x: 2, y: 3 } }, onRotate: () => {}, onSwipe: () => {}, onSmartMagnify: () => {}, onPressure: () => {} })));
  expect(host().props).toMatchObject({ cursorType: "image", cursorName: "/tmp/cursor.png", cursorHasHotSpot: true, cursorHotSpotX: 2, cursorHotSpotY: 3, handledEvents: ["rotate", "swipe", "smartMagnify", "pressure"] });
  await act(async () => rendered.update(React.createElement(PointerView, {})));
  expect(host().props).toMatchObject({ cursorType: "", cursorName: "", handledEvents: [] });
});

test.each([
  [{ customCursor: { type: "bitmap", path: "/a.png" } }, "E_INVALID_ARGUMENT"],
  [{ customCursor: { type: "symbol", name: "" } }, "E_INVALID_ARGUMENT"],
  [{ customCursor: { type: "symbol", name: "pencil", pointSize: 0 } }, "E_INVALID_ARGUMENT"],
  [{ customCursor: { type: "symbol", name: "pencil", tint: "red" } }, "E_UNSUPPORTED_OPTION"],
  [{ customCursor: { type: "symbol", name: "pencil", hotSpot: { x: 1, y: 1, z: 1 } } }, "E_UNSUPPORTED_OPTION"],
  [{ customCursor: { type: "image", path: "cursor.png", hotSpot: { x: 0, y: 0 } } }, "E_INVALID_ARGUMENT"],
  [{ customCursor: { type: "image", path: "/cursor.png" } }, "E_INVALID_ARGUMENT"],
  [{ customCursor: { type: "image", path: "/cursor.png", hotSpot: { x: -1, y: 0 } } }, "E_INVALID_ARGUMENT"],
  [{ customCursor: { type: "symbol", name: "pencil" }, style: { cursor: "pointer" } }, "E_INVALID_ARGUMENT"],
  [{ onMagnify: "zoom" }, "E_INVALID_ARGUMENT"],
])("PointerView rejects %j with %s", async (props, code) => {
  await expect(mount(props as never)).rejects.toMatchObject({ name: "SparkError", code });
});

test("PointerView throws a typed error where it is unavailable", async () => {
  registered.mockReturnValue(false);
  await expect(mount({})).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  registered.mockReturnValue(true);
  platform.OS = "windows";
  await expect(mount({})).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
});

test("native pointer input reaches the matching handler as a typed event; malformed input reports E_INVALID_DATA", async () => {
  const handlers = { onMagnify: vi.fn(), onRotate: vi.fn(), onSwipe: vi.fn(), onSmartMagnify: vi.fn(), onPressure: vi.fn(), onMouseButton: vi.fn(), onError: vi.fn() };
  await mount(handlers);
  await send({ type: "magnify", x: 1, y: 2, magnification: 0.25, phase: "changed" });
  await send({ type: "rotate", x: 1, y: 2, rotation: -15, phase: "began" });
  await send({ type: "swipe", x: 1, y: 2, direction: "left" });
  await send({ type: "smartMagnify", x: 1, y: 2 });
  await send({ type: "pressure", x: 1, y: 2, pressure: 0.5, stage: 2, stageTransition: 0.1 });
  await send({ type: "mouseButton", x: 1, y: 2, button: "back" });
  expect(handlers.onMagnify).toHaveBeenCalledWith({ x: 1, y: 2, magnification: 0.25, phase: "changed" });
  expect(handlers.onRotate).toHaveBeenCalledWith({ x: 1, y: 2, rotation: -15, phase: "began" });
  expect(handlers.onSwipe).toHaveBeenCalledWith({ x: 1, y: 2, direction: "left" });
  expect(handlers.onSmartMagnify).toHaveBeenCalledWith({ x: 1, y: 2 });
  expect(handlers.onPressure).toHaveBeenCalledWith({ x: 1, y: 2, pressure: 0.5, stage: 2, stageTransition: 0.1 });
  expect(handlers.onMouseButton).toHaveBeenCalledWith({ x: 1, y: 2, button: "back" });
  for (const data of [{ type: "magnify", phase: "sideways" }, { type: "swipe", direction: "in" }, { type: "pressure", stage: 3 }, { type: "mouseButton", button: "middle" }, { type: "tap" }, { type: "magnify", phase: "began", x: Number.NaN }]) await send(data);
  expect(handlers.onError).toHaveBeenCalledTimes(6);
  expect(handlers.onError.mock.calls.every(([error]) => error.code === "E_INVALID_DATA")).toBe(true);
  await act(() => host().props.onPointerViewError({ nativeEvent: { code: "E_INVALID_ARGUMENT", message: "No SF Symbol named nope" } }));
  expect(handlers.onError).toHaveBeenLastCalledWith(expect.objectContaining({ name: "SparkError", code: "E_INVALID_ARGUMENT", message: "No SF Symbol named nope" }));
});

test("handlers are read from the latest render", async () => {
  const first = vi.fn(), second = vi.fn();
  await mount({ onSmartMagnify: first });
  await act(async () => rendered.update(React.createElement(PointerView, { onSmartMagnify: second })));
  await send({ type: "smartMagnify" });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});
