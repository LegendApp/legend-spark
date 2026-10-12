import { createRequire } from "node:module";
import React, { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");

// The Layout, presence and shared elements screen against the real @legendapp/spark/motion package with a recorded native module.
const { state, native, tags } = vi.hoisted(() => ({
  state: { locale: "en" as "en" | "ar", os: "macos" },
  native: {
    run: vi.fn(async (_json: string) => JSON.stringify({ finished: true })),
    stopAnimation: vi.fn(async () => {}), set: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    getState: vi.fn(async () => ""), link: vi.fn(async () => {}), unlink: vi.fn(async () => {}), recordFrames: vi.fn(async () => ""),
  },
  tags: new WeakMap<object, number>(),
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
import { Layout } from "../examples/kitchen-sink/screens/motion-system/LayoutScreen";

let rendered: any, nextTag = 100;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = "en"; state.os = "macos";
  for (const fn of Object.values(native)) fn.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
const mount = () => act(async () => { rendered = create(React.createElement(Layout), { createNodeMock: () => { const node = {}; tags.set(node, ++nextTag); return node; } }); });
const motionViews = () => rendered.root.findAll((node: any) => node.type === "SparkMotionView");
const byID = (testID: string) => motionViews().find((node: any) => node.props.testID === testID) ?? rendered.root.find((node: any) => typeof node.type === "string" && node.props.testID === testID);
const ids = () => motionViews().map((node: any) => node.props.testID);
const press = (testID: string) => act(async () => { byID(testID).props.onPress(); });
const plans = () => native.run.mock.calls.map(([json]) => JSON.parse(json));

test("rows enter, exit before they unmount and animate their layout; added rows start at the leading side", async () => {
  await mount();
  expect(ids().filter((id: string) => id.includes("-row-"))).toEqual(["motion-system-layout-row-1", "motion-system-layout-row-2", "motion-system-layout-row-3"]);
  expect(byID("motion-system-layout-row-1").props).toMatchObject({ layout: "position", initialValues: undefined });
  expect(JSON.parse(byID("motion-system-layout-row-1").props.transition)).toMatchObject({ type: "spring", stiffness: expect.any(Number) });
  native.run.mockClear();
  await press("motion-system-layout-add");
  expect(JSON.parse(byID("motion-system-layout-row-4").props.initialValues)).toEqual({ opacity: 0, translateX: -24 });
  expect(Object.keys(plans()[0].groups[0].tracks)).toEqual(["opacity", "translateX"]);
  expect(byID("motion-system-layout-rows").props.children).toBe("[1,2,3,4]");
  native.run.mockClear();
  await press("motion-system-layout-remove");
  // The engine resolved the exit at once here, so row 1 is gone after its exit plan ran.
  expect(plans()[0].groups[0].tracks).toMatchObject({ opacity: { type: "timing", to: 0 }, scaleX: { to: 0.9 }, scaleY: { to: 0.9 } });
  expect(ids()).not.toContain("motion-system-layout-row-1");
  await press("motion-system-layout-reorder");
  expect(ids().filter((id: string) => id.includes("-row-"))).toEqual(["motion-system-layout-row-4", "motion-system-layout-row-2", "motion-system-layout-row-3"]);
});

test("the frame box scales between widths, and a photo's detail shares its thumbnail's id", async () => {
  await mount();
  expect(byID("motion-system-layout-frame").props).toMatchObject({ layout: "frame", style: { width: 48 } });
  await press("motion-system-layout-toggle");
  expect(byID("motion-system-layout-frame").props.style).toMatchObject({ width: 160 });
  expect(ids()).not.toContain("motion-system-layout-detail");
  await press("motion-system-layout-open-2");
  expect(ids()).not.toContain("motion-system-layout-thumb-2");
  expect(byID("motion-system-layout-detail").props.sharedId).toBe("motion-system-photo-2");
  expect(byID("motion-system-layout-thumb-1").props.sharedId).toBe("motion-system-photo-1");
  await press("motion-system-layout-close");
  expect(byID("motion-system-layout-thumb-2").props.sharedId).toBe("motion-system-photo-2");
  expect(ids()).not.toContain("motion-system-layout-detail");
});

test("rows enter from the right in Arabic; Windows shows the typed unsupported error", async () => {
  state.locale = "ar";
  await mount();
  await press("motion-system-layout-add");
  expect(JSON.parse(byID("motion-system-layout-row-4").props.initialValues)).toEqual({ opacity: 0, translateX: 24 });
  await act(async () => { rendered.unmount(); rendered = undefined; });
  state.os = "windows";
  native.run.mockClear();
  await mount();
  expect(byID("motion-system-layout-error").props.children).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  expect(motionViews()).toHaveLength(0);
  expect(native.run).not.toHaveBeenCalled();
});
