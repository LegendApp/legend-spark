import { createRequire } from "node:module";
import React, { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MOTION_PROPERTIES } from "../packages/motion/src/specs";
import { COLOR_COMPONENTS } from "../packages/motion/src/colors";
const { create } = createRequire(import.meta.url)("react-test-renderer");

// The Cross-window shared elements screen and its photo window against the real @legendapp/spark/motion package, with a
// recorded native module and a recorded window API.
const { state, native, tags, windows, registry } = vi.hoisted(() => ({
  state: { locale: "en" as "en" | "ar", os: "macos" },
  native: {
    run: vi.fn(async (_json: string) => JSON.stringify({ finished: true })),
    stopAnimation: vi.fn(async () => {}), set: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    environment: vi.fn(async () => JSON.stringify({ reduceMotion: false, reduceTransparency: false, lowPowerMode: false, maximumFrameRate: 120, frameRate: 120, windowVisible: null })),
    getState: vi.fn(async (_tag: number) => ""), link: vi.fn(async () => {}), unlink: vi.fn(async () => {}), recordFrames: vi.fn(async () => ""),
  },
  tags: new WeakMap<object, number>(),
  windows: {
    openWindowFrom: vi.fn(async (options: { id: string }) => ({ id: options.id, bounds: {}, finished: Promise.resolve({ finished: true, reducedMotion: false }) })),
    closeWindow: vi.fn(async () => ({ closed: true })),
    getWindow: vi.fn(async (): Promise<{ visible: boolean }> => ({ visible: false })),
  },
  registry: new Map<string, () => unknown>(),
}));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", ScrollView: "ScrollView",
  Platform: { get OS() { return state.os; } },
  UIManager: { hasViewManagerConfig: () => true },
  TurboModuleRegistry: { get: () => native },
  AppRegistry: { registerComponent: (name: string, provider: () => unknown) => { registry.set(name, provider); } },
  findNodeHandle: (target: object) => tags.get(target) ?? null,
  StyleSheet: { flatten: (style: unknown) => style },
}));
vi.mock("../packages/motion/src/motion-view-host", () => ({ getNativeMotionView: () => "SparkMotionView" }));
vi.mock("../examples/kitchen-sink/shell/app-controller", () => ({ useI18n: () => ({ locale: state.locale, rtl: state.locale === "ar" }) }));
vi.mock("@legendapp/spark/ui", () => ({ Button: (props: object) => React.createElement("Button", props) }));
vi.mock("@legendapp/spark/windows", () => windows);
vi.mock("@legendapp/spark/system", () => ({ onSystemEvent: vi.fn(async () => ({ remove: async () => {} })) }));
import { SparkError } from "@legendapp/spark/contracts";
import { SharedWindows } from "../examples/kitchen-sink/screens/motion-system/SharedWindowsScreen";

let rendered: any, nextTag = 100;
const at = (scale: number, moving = false) => {
  const values: Record<string, number> = Object.fromEntries([...MOTION_PROPERTIES, ...COLOR_COMPONENTS].map(property => [property, 0]));
  Object.assign(values, { opacity: 1, scaleX: scale, scaleY: scale });
  return JSON.stringify({ values, velocities: Object.fromEntries(Object.keys(values).map(key => [key, 0])), animating: moving ? ["translateX", "scaleX"] : [] });
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  state.locale = "en"; state.os = "macos";
  for (const fn of [...Object.values(native), ...Object.values(windows)]) fn.mockClear();
  native.getState.mockImplementation(async () => at(1));
  windows.getWindow.mockImplementation(async () => { throw new SparkError("E_NOT_FOUND", "No such window"); });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.useRealTimers(); vi.restoreAllMocks(); });
const nodeMock = () => { const node = { measureInWindow: (done: (...values: number[]) => void) => done(24, 120, 40, 30) }; tags.set(node, ++nextTag); return node; };
const mount = (element: React.ReactElement) => act(async () => { rendered = create(element, { createNodeMock: nodeMock }); });
const byID = (testID: string) => rendered.root.find((node: any) => typeof node.type === "string" && node.props.testID === testID);
const has = (testID: string) => rendered.root.findAll((node: any) => typeof node.type === "string" && node.props.testID === testID).length > 0;
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(100); });

test("the thumbnails share ids with the photo window across windows", async () => {
  await mount(React.createElement(SharedWindows));
  for (const photo of [1, 2, 3]) expect(byID(`motion-system-shared-windows-thumb-${photo}`).props).toMatchObject({ sharedId: `motion-system-shared-windows-photo-${photo}`, sharedAcrossWindows: true });
  await poll();
  expect(has("motion-system-shared-windows-reduce-motion-false") && has("motion-system-shared-windows-window-closed") && has("motion-system-shared-windows-photo-none") && has("motion-system-shared-windows-thumb-2-still-scale-1.00-opacity-1.00")).toBe(true);
});

test("Open zooms the photo window out of its thumbnail; the readout follows the engine; Close closes it", async () => {
  await mount(React.createElement(SharedWindows));
  await act(async () => { byID("motion-system-shared-windows-open-2").props.onPress(); await vi.advanceTimersByTimeAsync(0); });
  expect(has("motion-system-shared-windows-error") ? byID("motion-system-shared-windows-error").props.children : null).toBeNull();
  expect(windows.openWindowFrom).toHaveBeenCalledWith({ id: "ks-shared-photo", component: "KitchenSinkSharedPhoto", title: "Photo 2", props: { photo: 2, locale: "en" }, size: { width: 360, height: 240 } },
    { from: { windowId: "main", x: 24, y: 120, width: 40, height: 30 }, focusOnClose: "main", transition: { durationMs: 300, easing: "easeOut" } });
  // The photo window's root renders the photo with the thumbnail's shared id.
  const Root = registry.get("KitchenSinkSharedPhoto")!() as React.ComponentType<{ photo: number; locale: string }>;
  const screen = rendered;
  await mount(React.createElement(Root, { photo: 2, locale: "ar" }));
  expect(byID("motion-system-shared-windows-photo").props).toMatchObject({ sharedId: "motion-system-shared-windows-photo-2", sharedAcrossWindows: true, style: { width: 200, height: 150 } });
  expect(byID("motion-system-shared-windows-photo-window").props.style).toEqual({ direction: "rtl" });
  const photoWindow = rendered;
  rendered = screen;
  windows.getWindow.mockResolvedValue({ visible: true });
  native.getState.mockImplementation(async (tag: number) => tag === nextTag ? at(0.2, true) : at(1));
  await poll();
  expect(has("motion-system-shared-windows-window-open")).toBe(true);
  expect(has("motion-system-shared-windows-photo-moving-scale-0.20-opacity-1.00")).toBe(true);
  native.getState.mockImplementation(async (tag: number) => tag === nextTag ? at(0.6, true) : at(1));
  await poll();
  expect(has("motion-system-shared-windows-photo-moving-scale-between-opacity-1.00")).toBe(true);
  await act(async () => { byID("motion-system-shared-windows-close").props.onPress(); await vi.advanceTimersByTimeAsync(0); });
  expect(windows.closeWindow).toHaveBeenCalledWith("ks-shared-photo");
  await act(async () => { photoWindow.unmount(); });
});

test("Windows shows the typed unsupported error", async () => {
  state.os = "windows";
  await mount(React.createElement(SharedWindows));
  expect(byID("motion-system-shared-windows-error").props.children).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  expect(native.run).not.toHaveBeenCalled();
});
