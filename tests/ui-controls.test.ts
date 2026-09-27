import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode, createRef } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered } = vi.hoisted(() => ({ platform: { OS: "macos" }, registered: vi.fn(() => true) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View", Text: "Text", TextInput: "RNTextInput" }));
vi.mock("../packages/ui/src/SparkButtonNativeComponent", () => ({ default: "SparkButton" }));
vi.mock("../packages/ui/src/SparkTextInputNativeComponent", () => ({ default: "SparkTextInput" }));
vi.mock("../packages/ui/src/SparkSelectNativeComponent", () => ({ default: "SparkSelect" }));
vi.mock("../packages/ui/src/native-select/NativeSelectNativeComponent", () => ({ default: "NativeSelect" }));
vi.mock("../packages/ui/src/native-select/NativeSegmentedControlNativeComponent", () => ({ default: "NativeSegmentedControl" }));
import { Button, TextInput, Select, SegmentedControl, getControlAvailability, type ControlRef } from "../packages/ui/src/index";
import { TextInput as MobileTextInput } from "../packages/ui/src/mobile-input";
import { Button as WebButton, TextInput as WebTextInput, Select as WebSelect } from "../packages/ui/src/index.web";
import { selectionIndex } from "../packages/ui/src/select";
let rendered: any;
const event = (text: string, eventCount: number) => ({ nativeEvent: { text, eventCount } });
const options = [{ label: "One", value: "one" }, { label: "Two", value: "two" }];
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; registered.mockReturnValue(true);
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
test("desktop controlled input acknowledges edits even when its value is unchanged", async () => {
  const onChangeText = vi.fn(), onError = vi.fn();
  await mount(React.createElement(TextInput, { value: "original", onChangeText, onError }));
  const before = rendered.root.findByType("SparkTextInput").props;
  await act(async () => { before.onTextChange(event("edit", 1)); before.onTextChange(event("newer", 2)); before.onTextChange(event("stale", 1)); });
  const after = rendered.root.findByType("SparkTextInput").props;
  expect(after.text).toBe("original"); expect(after.controlled).toBe(true); expect(after.eventCount).toBe(2);
  expect(after.acknowledge).toBeUndefined(); expect(onChangeText.mock.calls).toEqual([["edit"], ["newer"]]);
  after.onTextChange(event("bad", NaN)); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
  await act(async () => rendered.unmount()); rendered = undefined; after.onTextChange(event("late", 3)); expect(onChangeText).toHaveBeenCalledTimes(2);
});
test("uncontrolled input retains its original default and disabled controls do not emit", async () => {
  const onChangeText = vi.fn(); await mount(React.createElement(TextInput, { defaultValue: "one", onChangeText }));
  await act(async () => rendered.update(React.createElement(TextInput, { defaultValue: "two", disabled: true, onChangeText })));
  const native = rendered.root.findByType("SparkTextInput").props;
  expect(native.defaultText).toBe("one"); expect(native.controlled).toBe(false); expect(native.disabled).toBe(true);
  native.onTextChange(event("edit", 1)); expect(onChangeText).not.toHaveBeenCalled();
});
test.each(["macos", "windows"])("%s Select uses one controlled value and validates native choices", async platformName => {
  platform.OS = platformName; const onValueChange = vi.fn(), onError = vi.fn();
  await mount(React.createElement(Select, { options, value: "one", onValueChange, onError, accessibilityLabel: "Theme" }));
  const type = platformName === "windows" ? "SparkSelect" : "NativeSelect";
  let native = rendered.root.findByType(type).props;
  const change = platformName === "windows" ? "onSelectionChange" : "onValueChange";
  await act(async () => native[change]({ nativeEvent: { value: "two" } }));
  native = rendered.root.findByType(type).props; expect(native.value).toBe("one"); expect(native.selectionRevision).toBe(1); expect(native.accessibilityLabel).toBe("Theme");
  native[change]({ nativeEvent: { value: "unknown" } }); expect(onValueChange).toHaveBeenCalledTimes(1); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
});
test("segmented control is distinct and reports its platform support", async () => {
  await mount(React.createElement(SegmentedControl, { options, value: "one", onValueChange: vi.fn(), disabled: true }));
  expect(rendered.root.findByType("NativeSegmentedControl").props.enabled).toBe(false);
  platform.OS = "windows"; expect(getControlAvailability("segmented-control")).toEqual({ available: false, reason: "unsupported-platform" });
});
test("buttons carry labels, expose layout-only refs and stop after unmount", async () => {
  const ref = createRef<ControlRef>(), press = vi.fn(), measure = vi.fn((callback: Function) => callback(1, 2, 3, 4));
  await act(async () => { rendered = create(React.createElement(Button, { children: "Save", accessibilityLabel: "Save document", onPress: press, ref }), { createNodeMock: () => ({ measureInWindow: measure }) }); });
  const native = rendered.root.findByType("SparkButton").props;
  expect(native.accessibilityLabel).toBe("Save document"); native.onButtonPress(); expect(press).toHaveBeenCalledTimes(1);
  const handle = ref.current!; expect(Object.keys(handle)).toEqual(["measureInWindow"]); const result = vi.fn(); handle.measureInWindow(result); expect(result).toHaveBeenCalledWith(1, 2, 3, 4);
  await act(async () => { rendered.unmount(); rendered = undefined; }); native.onButtonPress(); expect(press).toHaveBeenCalledTimes(1); expect(ref.current).toBeNull(); expect(() => handle.measureInWindow(result)).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
});
test("missing native control reports once without framework error copy", async () => {
  registered.mockReturnValue(false); const onError = vi.fn();
  await mount(React.createElement(StrictMode, null, React.createElement(Button, { children: "Save", onError })));
  expect(onError).toHaveBeenCalledTimes(1); expect(onError.mock.calls[0][0].code).toBe("E_MODULE_UNAVAILABLE");
  expect(rendered.root.findByType("Text").children).toEqual(["Save"]);
});
test("mobile text uses RN controlled editing and disabled semantics", async () => {
  const onChangeText = vi.fn(); await mount(React.createElement(MobileTextInput, { value: "abc", disabled: true, onChangeText }));
  const input = rendered.root.findByType("RNTextInput").props; expect(input.value).toBe("abc"); expect(input.editable).toBe(false); input.onChangeText("x"); expect(onChangeText).not.toHaveBeenCalled();
});
test("web controls retain controlled values and real disabled attributes", async () => {
  await mount(React.createElement(React.Fragment, null, React.createElement(WebButton, { children: "Save", disabled: true }), React.createElement(WebTextInput, { value: "x", disabled: true }), React.createElement(WebSelect, { options, value: "one", disabled: true, onValueChange: vi.fn() })));
  for (const type of ["button", "input", "select"]) expect(rendered.root.findByType(type).props.disabled).toBe(true);
  expect(rendered.root.findByType("input").props.value).toBe("x");
});
test("invalid select values and option fields use shared errors", () => {
  for (const options of [[], [null], [{ label: "", value: "a" }], [{ label: "A", value: 1 }]]) expect(() => selectionIndex(options as never, "a")).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => selectionIndex([{ label: "A", value: "a", enabled: false }] as never, "a")).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
});
