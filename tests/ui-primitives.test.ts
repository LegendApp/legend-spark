import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode, createRef } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered, loadNative } = vi.hoisted(() => ({ platform: { OS: "macos" }, registered: vi.fn(() => true), loadNative: vi.fn(() => "SparkPrimitive") }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered } }));
vi.mock("../packages/ui/src/primitive-host", () => ({ getNativePrimitive: loadNative }));
import * as controls from "../packages/ui/src/primitives-controls";
import { primitivePayload, primitiveEventValue, primitiveKinds } from "../packages/ui/src/primitives";
import { getControlAvailability } from "../packages/ui/src/availability";
import type { ControlRef } from "../packages/ui/src/types";
import type { PrimitiveKind, PrimitivePropsByKind } from "../packages/ui/src/primitives.types";

const examples: { [K in PrimitiveKind]: PrimitivePropsByKind[K] } = {
  checkbox: { value: "mixed", label: "Option", onValueChange: vi.fn() },
  "radio-group": { value: "a", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], onValueChange: vi.fn() },
  switch: { value: false, onValueChange: vi.fn() },
  slider: { value: 4, min: 0, max: 10, step: 2, ticks: 6, continuous: false, onValueChange: vi.fn() },
  stepper: { value: 5, onValueChange: vi.fn() },
  "combo-box": { value: "free text", options: ["a", "b"], onValueChange: vi.fn() },
  "token-field": { value: ["a", "b"], onValueChange: vi.fn() },
  "path-control": { value: "file:///Users", onValueChange: vi.fn() },
  progress: { mode: "determinate", value: 0.5 },
  "level-indicator": { value: 50 },
  "disclosure-triangle": { value: true, onValueChange: vi.fn() },
};
const components = { checkbox: controls.Checkbox, "radio-group": controls.RadioGroup, switch: controls.Switch, slider: controls.Slider, stepper: controls.Stepper, "combo-box": controls.ComboBox, "token-field": controls.TokenField, "path-control": controls.PathControl, progress: controls.Progress, "level-indicator": controls.LevelIndicator, "disclosure-triangle": controls.DisclosureTriangle };
let rendered: any;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  platform.OS = "macos"; registered.mockReturnValue(true); loadNative.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
async function mount(kind: PrimitiveKind, props: object) { await act(async () => { rendered = create(React.createElement(components[kind] as React.ComponentType<any>, props)); }); }

test.each(primitiveKinds)("%s supplies native value, size, accessibility and layout ref", async kind => {
  const ref = createRef<ControlRef>();
  for (const size of ["mini", "small", "regular", "large"] as const) {
    await mount(kind, { ...examples[kind], size, ref, accessibilityLabel: "Example control", testID: kind });
    const props = rendered.root.findByType("SparkPrimitive").props;
    expect(loadNative).toHaveBeenCalled();
    expect(props).toMatchObject({ kind, controlSize: size, accessibilityLabel: "Example control", testID: kind, disabled: false, eventCount: 0 });
    expect(JSON.parse(props.valueJson)).toMatchObject({ value: examples[kind].value });
    expect(Object.keys(ref.current!)).toEqual(["measureInWindow"]);
    await act(async () => { rendered.unmount(); rendered = undefined; });
    expect(ref.current).toBeNull();
  }
});

test.each(primitiveKinds)("%s exposes truthful availability and throws typed unsupported/missing errors", async kind => {
  expect(getControlAvailability(kind)).toEqual({ available: true });
  expect(registered).toHaveBeenCalledWith("SparkPrimitive");
  registered.mockReturnValue(false);
  expect(getControlAvailability(kind)).toEqual({ available: false, reason: "missing-module" });
  await expect(mount(kind, examples[kind])).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  expect(loadNative).not.toHaveBeenCalled();
  for (const os of ["windows", "ios", "android", "web"]) {
    platform.OS = os;
    expect(getControlAvailability(kind)).toEqual({ available: false, reason: "unsupported-platform" });
    await expect(mount(kind, examples[kind])).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    expect(loadNative).not.toHaveBeenCalled();
  }
});

const nativeEvent = (valueJson: string, eventCount: number) => ({ nativeEvent: { valueJson, eventCount } });
test("controlled edits echo event counts, restore rejected values and use current callbacks; events stop when disabled/unmounted", async () => {
  const onValueChange = vi.fn(), nextCallback = vi.fn();
  await act(async () => { rendered = create(React.createElement(StrictMode, null, React.createElement(controls.Checkbox, { value: "mixed", onValueChange }))); });
  let native = rendered.root.findByType("SparkPrimitive").props;
  await act(async () => native.onValueChange(nativeEvent("true", 1)));
  native = rendered.root.findByType("SparkPrimitive").props;
  expect(native.eventCount).toBe(1); expect(JSON.parse(native.valueJson).value).toBe("mixed"); expect(onValueChange).toHaveBeenCalledWith(true);
  await act(async () => { rendered.update(React.createElement(controls.Checkbox, { value: false, onValueChange: nextCallback })); });
  native = rendered.root.findByType("SparkPrimitive").props;
  await act(async () => native.onValueChange(nativeEvent('"mixed"', 2)));
  expect(nextCallback).toHaveBeenCalledWith("mixed"); expect(onValueChange).toHaveBeenCalledTimes(1);
  await act(async () => { rendered.update(React.createElement(controls.Checkbox, { value: false, onValueChange: nextCallback, disabled: true })); });
  native = rendered.root.findByType("SparkPrimitive").props;
  // A disabled control ignores the edit but still echoes the count, so native restores the controlled value.
  await act(async () => native.onValueChange(nativeEvent("true", 3)));
  expect(nextCallback).toHaveBeenCalledTimes(1); expect(rendered.root.findByType("SparkPrimitive").props.eventCount).toBe(3);
  await act(async () => { rendered.unmount(); rendered = undefined; });
  native.onValueChange(nativeEvent("true", 4));
  expect(nextCallback).toHaveBeenCalledTimes(1);
});

test("interleaved native events: stale counts are ignored and the latest count is echoed", async () => {
  const onValueChange = vi.fn(), onError = vi.fn();
  await mount("combo-box", { ...examples["combo-box"], onValueChange, onError });
  const send = (valueJson: string, eventCount: number) => act(async () => rendered.root.findByType("SparkPrimitive").props.onValueChange(nativeEvent(valueJson, eventCount)));
  // Native typed "t" (1) and "tw" (2); JS sees 2 before a late duplicate of 1.
  await send('"tw"', 2); await send('"t"', 1); await send('"tw"', 2);
  expect(onValueChange.mock.calls).toEqual([["tw"]]);
  expect(rendered.root.findByType("SparkPrimitive").props.eventCount).toBe(2);
  // The parent kept its value, so the echoed count makes native restore "free text".
  expect(JSON.parse(rendered.root.findByType("SparkPrimitive").props.valueJson).value).toBe("free text");
  for (const eventCount of [0, -1, 1.5, 2147483648, undefined]) await send('"x"', eventCount as never);
  expect(onValueChange).toHaveBeenCalledTimes(1); expect(onError).toHaveBeenCalledTimes(5);
  expect(onError.mock.calls.every(([error]) => error.code === "E_INVALID_DATA")).toBe(true);
});

test("native serialization and configuration failures report E_INVALID_DATA and echo their count", async () => {
  const onError = vi.fn(), onValueChange = vi.fn();
  await mount("slider", { ...examples.slider, onError, onValueChange });
  await act(async () => rendered.root.findByType("SparkPrimitive").props.onNativeError({ nativeEvent: { message: "Native slider value cannot be serialized as JSON", eventCount: 1 } }));
  expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "E_INVALID_DATA", message: "Native slider value cannot be serialized as JSON" }));
  expect(rendered.root.findByType("SparkPrimitive").props.eventCount).toBe(1);
  // A configuration failure carries the already-acknowledged count.
  await act(async () => rendered.root.findByType("SparkPrimitive").props.onNativeError({ nativeEvent: { message: "Invalid slider configuration JSON", eventCount: 0 } }));
  expect(onError).toHaveBeenCalledTimes(2); expect(rendered.root.findByType("SparkPrimitive").props.eventCount).toBe(1);
  expect(onValueChange).not.toHaveBeenCalled();
});

test("malformed native edits report E_INVALID_DATA and restore controlled value without callbacks", async () => {
  const onError = vi.fn(), onValueChange = vi.fn();
  await mount("slider", { ...examples.slider, onError, onValueChange });
  let count = 0;
  for (const valueJson of ["NaN", "11", "null", '"4"', '{"value":4}']) {
    await act(async () => rendered.root.findByType("SparkPrimitive").props.onValueChange(nativeEvent(valueJson, ++count)));
  }
  expect(onValueChange).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledTimes(5);
  expect(onError.mock.calls.every(([error]) => error.code === "E_INVALID_DATA")).toBe(true);
  expect(rendered.root.findByType("SparkPrimitive").props.eventCount).toBe(5);
});

test("input payload validation rejects invalid ranges, selections, modes, URLs and sizes", () => {
  const bad: [PrimitiveKind, object][] = [
    ["checkbox", { value: 1 }], ["switch", { value: "mixed" }], ["radio-group", { value: "unknown" }],
    ["slider", { min: 4, max: 4 }], ["slider", { ticks: -1 }], ["slider", { ticks: 1001 }], ["slider", { continuous: "yes" }],
    ["stepper", { step: 0 }], ["level-indicator", { value: Infinity }], ["combo-box", { options: [3] }],
    ["token-field", { value: [null] }], ["path-control", { value: "https://example.com" }],
    ["progress", { value: 2 }], ["progress", { mode: "spinner", value: 0.5 }], ["checkbox", { size: "huge" }],
    ["disclosure-triangle", { onValueChange: undefined }],
  ];
  for (const [kind, patch] of bad) expect(() => primitivePayload(kind, { ...examples[kind], ...patch } as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(JSON.parse(primitivePayload("progress", { mode: "spinner" }))).toEqual({ mode: "spinner", value: 0 });
  expect(JSON.parse(primitivePayload("progress", { mode: "indeterminate" }))).toEqual({ mode: "indeterminate", value: 0 });
  expect(primitiveEventValue("combo-box", examples["combo-box"], '"unlisted"')).toBe("unlisted");
  expect(primitiveEventValue("token-field", examples["token-field"], '["new", "tokens"]')).toEqual(["new", "tokens"]);
  expect(() => primitiveEventValue("radio-group", examples["radio-group"], '"unlisted"')).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
  expect(() => primitiveEventValue("progress", examples.progress, "0.7")).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
});


test("unknown primitive props reject even undefined and options never leak between kinds", () => {
  for (const [kind, key] of [["stepper", "continuous"], ["level-indicator", "step"], ["checkbox", "defaultValue"], ["progress", "onValueChange"]] as const) {
    expect(() => primitivePayload(kind, { ...examples[kind], [key]: undefined })).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
  }
});

test.each([
  ["checkbox", true], ["radio-group", "b"], ["switch", true], ["slider", 6], ["stepper", 6],
  ["combo-box", "typed text"], ["token-field", ["new", "tokens"]], ["path-control", "file:///"], ["disclosure-triangle", false],
] as const)("%s delivers its public value shape and acknowledges a parent-vetoed change", async (kind, next) => {
  const onValueChange = vi.fn();
  await mount(kind, { ...examples[kind], onValueChange });
  await act(async () => rendered.root.findByType("SparkPrimitive").props.onValueChange(nativeEvent(JSON.stringify(next), 1)));
  const native = rendered.root.findByType("SparkPrimitive").props;
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith(next);
  expect(JSON.parse(native.valueJson).value).toEqual(examples[kind].value);
  expect(native.eventCount).toBe(1);
});
