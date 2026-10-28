import { createRequire } from "node:module";
import React, { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");

const mocks = vi.hoisted(() => ({ renderPicker: true, permission: "undetermined", heading: vi.fn() }));
vi.mock("react-native", () => ({
  ScrollView: "ScrollView", Text: "Text", View: "View", Pressable: "Pressable",
  TurboModuleRegistry: { get: () => ({}) }, UIManager: { hasViewManagerConfig: () => true },
}));
vi.mock("@react-native-community/datetimepicker", async () => {
  const { createElement } = await import("react");
  return { default: (props: object) => mocks.renderPicker ? createElement("NativePicker", props) : null };
});
vi.mock("expo-location", () => ({
  getForegroundPermissionsAsync: async () => ({ status: mocks.permission }),
  hasServicesEnabledAsync: async () => true,
  getProviderStatusAsync: async () => ({ locationServicesEnabled: true }),
  getHeadingAsync: () => mocks.heading(),
}));
vi.mock("react-native-gesture-handler", () => {
  const gesture = (kind: string) => ({
    kind, callback: undefined as any,
    runOnJS() { return this; },
    onEnd(callback: unknown) { this.callback = callback; return this; },
  });
  return {
    GestureDetector: "GestureDetector", GestureHandlerRootView: "GestureHandlerRootView", RectButton: "RectButton",
    Gesture: { Tap: () => gesture("tap"), Pan: () => gesture("pan"), Race: (...children: unknown[]) => ({ children }) },
  };
});

import { DateTimePickerDemo } from "../examples/kitchen-sink/screens/native-controls/DateTimePickerDemo";
import { ExpoLocationDemo } from "../examples/kitchen-sink/screens/system-integration/ExpoLocationDemo";
import { GestureHandlerDemo } from "../examples/kitchen-sink/screens/component-library/GestureHandlerDemo";

let rendered: any;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.renderPicker = true;
  mocks.permission = "undetermined";
  mocks.heading.mockReset();
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => {
  if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; });
  vi.restoreAllMocks();
});
async function mount(component: React.ComponentType) {
  await act(async () => { rendered = create(React.createElement(component)); });
}
const host = (type: string) => rendered.root.findAll((node: any) => node.type === type);
const ids = () => rendered.root.findAll((node: any) => typeof node.type === "string" && node.props.testID).map((node: any) => node.props.testID);
const layout = (width: number, height: number) => ({ nativeEvent: { layout: { width, height, x: 0, y: 0 } } });

test("each datetimepicker earns its own marker only after a nonzero native frame", async () => {
  await mount(DateTimePickerDemo);
  expect(ids()).toEqual([]);
  expect(host("View").every((node: any) => node.props.onLayout === undefined && node.props.testID === undefined)).toBe(true);
  for (const [index, name] of ["date", "time", "inline"].entries()) {
    for (const [width, height] of [[0, 20], [20, 0], [-1, 20]]) {
      await act(async () => host("NativePicker")[index].props.onLayout(layout(width!, height!)));
      expect(ids()).not.toContain(`native-controls-datetimepicker-${name}-laid-out`);
    }
    await act(async () => host("NativePicker")[index].props.onLayout(layout(100, 30)));
    expect(ids()).toEqual(["date", "time", "inline"].slice(0, index + 1).map(name => `native-controls-datetimepicker-${name}-laid-out`));
  }
});

test("datetimepicker wrappers cannot pass when the native pickers render nothing", async () => {
  mocks.renderPicker = false;
  await mount(DateTimePickerDemo);
  expect(host("View")).toHaveLength(3);
  expect(host("NativePicker")).toHaveLength(0);
  expect(ids()).toEqual([]);
});

for (const permission of ["granted", "denied", "undetermined"]) {
  test(`expo-location accepts the exact macOS heading rejection with ${permission} permission`, async () => {
    mocks.permission = permission;
    mocks.heading.mockRejectedValue(permission === "granted" ? "Heading updates not available" : { code: "ERR_DENIED_FOREGROUND_LOCATION_PERMISSION" });
    await mount(ExpoLocationDemo);
    expect(mocks.heading).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual(["system-integration-expo-location-passed"]);
  });

  test.each([
    ["a different native code", { code: "ERR_HEADING_UNAVAILABLE" }, false],
    ["an error without a code", new Error("unavailable"), false],
    ["an arbitrary rejection string", "unavailable", false],
    ["a resolved heading", { trueHeading: 0 }, true],
  ])(`expo-location fails for %s with ${permission} permission`, async (_description, value, resolves) => {
    mocks.permission = permission;
    if (resolves) mocks.heading.mockResolvedValue(value);
    else mocks.heading.mockRejectedValue(value);
    await mount(ExpoLocationDemo);
    expect(ids()).toEqual(["system-integration-expo-location-failed"]);
  });
}

test("gesture-handler passes only after the detector's successful tap callback", async () => {
  await mount(GestureHandlerDemo);
  const marker = "component-library-gesture-handler-tap-fired";
  expect(ids()).not.toContain(marker);
  const target = host("View").find((node: any) => node.props.testID === "component-library-gesture-handler-target");
  expect(target.props.onLayout).toBeUndefined();
  await act(async () => host("RectButton")[0].props.onPress());
  expect(ids()).not.toContain(marker);
  const detector = host("GestureDetector")[0];
  expect(detector.findAll((node: any) => node === target)).toHaveLength(1);
  const tap = () => host("GestureDetector")[0].props.gesture.children.find((gesture: any) => gesture.kind === "tap");
  await act(async () => tap().callback({}, false));
  expect(ids()).not.toContain(marker);
  await act(async () => tap().callback({}, true));
  expect(ids()).toContain(marker);
});
