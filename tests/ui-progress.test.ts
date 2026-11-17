import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered } = vi.hoisted(() => ({ platform: { OS: "macos", Version: "26.0" }, registered: vi.fn(() => true) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View", Text: "Text" }));
vi.mock("../packages/ui/src/progress/ProgressIndicatorNativeComponent", () => ({ default: "SparkProgressIndicator" }));
import { ProgressIndicator, getProgressIndicatorAvailability } from "../packages/ui/src/progress";
let rendered: any;
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; registered.mockReturnValue(true);
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
const native = () => rendered.root.findByType("SparkProgressIndicator").props;

test("progress is determinate for a value from 0 to 1 and indeterminate without one", async () => {
  await mount(React.createElement(ProgressIndicator, { value: 0.4, accessibilityLabel: "Fetching" }));
  expect(native()).toMatchObject({ variant: "bar", controlSize: "regular", value: 0.4, indeterminate: false, accessibilityLabel: "Fetching" });
  for (const value of [undefined, null]) {
    await act(async () => rendered.update(React.createElement(ProgressIndicator, { value, variant: "spinner", size: "mini" })));
    expect(native()).toMatchObject({ variant: "spinner", controlSize: "mini", indeterminate: true });
  }
  for (const props of [{ value: -0.1 }, { value: 1.01 }, { value: NaN }, { value: "0.5" }, { variant: "circle" }, { size: "large" }, { size: "mini" }]) {
    await expect(mount(React.createElement(ProgressIndicator, props as never))).rejects.toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  }
});

test("a spinner takes its native size and a bar its native height, unless a style sets them", async () => {
  await mount(React.createElement(ProgressIndicator, { variant: "spinner" }));
  await act(async () => native().onIntrinsicSize({ nativeEvent: { width: 32, height: 32 } }));
  expect(native().style).toEqual([{ width: 32, height: 32 }, undefined]);
  await mount(React.createElement(ProgressIndicator, { style: { width: 200 } }));
  await act(async () => native().onIntrinsicSize({ nativeEvent: { width: 96, height: 20 } }));
  expect(native().style).toEqual([{ height: 20 }, { width: 200 }]);
  const onError = vi.fn();
  await mount(React.createElement(ProgressIndicator, { onError }));
  await act(async () => native().onIntrinsicSize({ nativeEvent: { width: -1, height: 20 } }));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
});

test("other platforms keep the view's layout and report the progress indicator as unsupported", async () => {
  for (const os of ["windows", "ios", "android", "web"]) {
    platform.OS = os; const onError = vi.fn();
    expect(getProgressIndicatorAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
    await mount(React.createElement(ProgressIndicator, { value: 0.5, style: { width: 100 }, onError }));
    expect(rendered.root.findAllByType("SparkProgressIndicator")).toEqual([]);
    expect(rendered.root.findByType("View").props.style).toEqual({ width: 100 });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  }
});
