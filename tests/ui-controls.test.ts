import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode, createRef } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered } = vi.hoisted(() => ({ platform: { OS: "macos" }, registered: vi.fn(() => true) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View", Text: "Text", TextInput: "RNTextInput", Switch: "RNSwitch" }));
vi.mock("../packages/ui/src/SparkButtonNativeComponent", () => ({ default: "SparkButton" }));
vi.mock("../packages/ui/src/SparkTextInputNativeComponent", () => ({ default: "SparkTextInput" }));
vi.mock("../packages/ui/src/SparkSelectNativeComponent", () => ({ default: "SparkSelect" }));
vi.mock("../packages/ui/src/native-select/NativeSelectNativeComponent", () => ({ default: "NativeSelect" }));
vi.mock("../packages/ui/src/native-select/NativeSegmentedControlNativeComponent", () => ({ default: "NativeSegmentedControl" }));
vi.mock("../packages/ui/src/radio-group/RadioGroupNativeComponent", () => ({ default: "SparkRadioGroup" }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => ({}) }));
vi.mock("@expo/ui/swift-ui/modifiers", () => ({
  frame: vi.fn(), buttonStyle: vi.fn(), pickerStyle: vi.fn(), tag: vi.fn(), disabled: vi.fn(), accessibilityLabel: vi.fn(), accessibilityHint: vi.fn(),
}));
import { Button, Checkbox, Switch, RadioGroup, TextInput, Select, SegmentedControl, getControlAvailability, type ControlRef } from "../packages/ui/src/index.macos";
import { TextInput as MobileTextInput } from "../packages/ui/src/mobile-input";
import { Button as WebButton, Checkbox as WebCheckbox, TextInput as WebTextInput, Select as WebSelect, SegmentedControl as WebSegmentedControl, RadioGroup as WebRadioGroup } from "../packages/ui/src/index.web";
import { selectionIndex } from "../packages/ui/src/select";
import { Select as IOSSelect } from "../packages/ui/src/index.ios";
import { Select as AndroidSelect, Checkbox as AndroidCheckbox, Button as AndroidButton, RadioGroup as AndroidRadioGroup } from "../packages/ui/src/index.android";
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
test("uncontrolled desktop edits do not render or send text acknowledgments back to native", async () => {
  const onChangeText = vi.fn(); await mount(React.createElement(TextInput, { defaultValue: "one", onChangeText }));
  const before = rendered.root.findByType("SparkTextInput").props;
  await act(async () => { before.onTextChange(event("edit", 1)); before.onTextChange(event("newer", 2)); before.onTextChange(event("stale", 1)); });
  expect(rendered.root.findByType("SparkTextInput").props).toBe(before);
  expect(onChangeText.mock.calls).toEqual([["edit"], ["newer"]]);
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
test("placeholder and multiline reach the native text input on every platform", async () => {
  await mount(React.createElement(TextInput, { defaultValue: "", placeholder: "Summary", multiline: true }));
  const native = rendered.root.findByType("SparkTextInput").props;
  expect(native).toMatchObject({ placeholder: "Summary", multiline: true }); expect(native.style[0]).toEqual({ width: 240, height: 80 });
  await act(async () => rendered.update(React.createElement(TextInput, { defaultValue: "", placeholder: "Title" })));
  expect(rendered.root.findByType("SparkTextInput").props).toMatchObject({ placeholder: "Title", multiline: false });
  await mount(React.createElement(MobileTextInput, { value: "", placeholder: "Summary", multiline: true }));
  expect(rendered.root.findByType("RNTextInput").props).toMatchObject({ placeholder: "Summary", multiline: true });
  await mount(React.createElement(WebTextInput, { value: "a", placeholder: "Summary", multiline: true }));
  expect(rendered.root.findByType("textarea").props).toMatchObject({ placeholder: "Summary", value: "a" });
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
test("Android Select segments expose radio semantics with their checked state", async () => {
  const require = createRequire(import.meta.url), stub = (id: string, exports: object) => { require.cache[require.resolve(id)] = { exports } as any; };
  stub("@expo/ui/jetpack-compose", { Host: "Host", Text: "ComposeText", SingleChoiceSegmentedButtonRow: "SegmentedRow", SegmentedButton: Object.assign(function SegmentedButton(props: any) { return props.children; }, { Label: "SegmentedLabel" }) });
  stub("@expo/ui/jetpack-compose/modifiers", { selectable: (selected: boolean, handler: () => void, role: string) => ({ selected, handler, role }) });
  const onValueChange = vi.fn(); await mount(React.createElement(AndroidSelect, { options, value: "two", onValueChange }));
  const semantics = rendered.root.findAll((node: any) => node.type.name === "SegmentedButton").map((segment: any) => segment.props.modifiers[0]);
  expect(semantics.map(({ role, selected }: any) => ({ role, selected }))).toEqual([{ role: "radioButton", selected: false }, { role: "radioButton", selected: true }]);
  await act(async () => semantics[0].handler()); expect(onValueChange).toHaveBeenCalledWith("one");
});

const style = (props: any) => Object.assign({}, ...[props.style].flat(Infinity).filter(Boolean));
test("desktop buttons take the native intrinsic size unless a style sets one; WinUI keeps its default frame", async () => {
  const onError = vi.fn();
  await mount(React.createElement(Button, { children: "Save", onError }));
  let native = rendered.root.findByType("SparkButton").props; expect(style(native).width).toBeUndefined();
  await act(async () => native.onIntrinsicSize({ nativeEvent: { width: 64, height: 22 } }));
  native = rendered.root.findByType("SparkButton").props; expect(style(native)).toEqual({ width: 64, height: 22 });
  await act(async () => rendered.update(React.createElement(Button, { children: "Save", onError, style: { width: 200 } })));
  expect(style(rendered.root.findByType("SparkButton").props)).toEqual({ width: 200, height: 22 });
  native.onIntrinsicSize({ nativeEvent: { width: NaN, height: 22 } }); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
  platform.OS = "windows"; await mount(React.createElement(Button, { children: "Save" }));
  expect(style(rendered.root.findByType("SparkButton").props)).toEqual({ width: 160, height: 36 });
});
test("disclosure buttons are controlled by expanded, reassert it on press and are unavailable where the OS lacks them", async () => {
  const onPress = vi.fn();
  await mount(React.createElement(Button, { children: "Details", variant: "disclosure", expanded: false, onPress }));
  let native = rendered.root.findByType("SparkButton").props; expect(native.variant).toBe("disclosure"); expect(native.checked).toBe(false);
  await act(async () => native.onButtonPress());
  native = rendered.root.findByType("SparkButton").props; expect(onPress).toHaveBeenCalledTimes(1); expect(native.checked).toBe(false); expect(native.checkedRevision).toBe(1);
  await expect(mount(React.createElement(Button, { children: "Details", variant: "disclosure" }))).rejects.toThrow("Disclosure buttons require a boolean expanded");
  await expect(mount(React.createElement(Button, { children: "Save", expanded: true }))).rejects.toThrow("Disclosure buttons require a boolean expanded");
  for (const [os, Component] of [["windows", Button], ["android", AndroidButton]] as const) {
    platform.OS = os; const onError = vi.fn();
    await mount(React.createElement(Component, { children: "Details", variant: "disclosure", expanded: true, onError }));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  }
});
test("checkboxes are controlled native switch buttons with validated labels", async () => {
  const onValueChange = vi.fn();
  await mount(React.createElement(Checkbox, { children: "Amend", value: false, onValueChange }));
  let native = rendered.root.findByType("SparkButton").props;
  expect(native).toMatchObject({ variant: "checkbox", title: "Amend", checked: false, checkedRevision: 0, accessibilityLabel: "Amend" });
  await act(async () => native.onButtonPress());
  native = rendered.root.findByType("SparkButton").props; expect(onValueChange).toHaveBeenCalledWith(true); expect(native.checked).toBe(false); expect(native.checkedRevision).toBe(1);
  await act(async () => rendered.update(React.createElement(Checkbox, { children: "Amend", value: true, disabled: true, onValueChange })));
  native = rendered.root.findByType("SparkButton").props; expect(native.checked).toBe(true); expect(native.disabled).toBe(true);
  native.onButtonPress(); expect(onValueChange).toHaveBeenCalledTimes(1);
  await expect(mount(React.createElement(Checkbox, { value: false, onValueChange }))).rejects.toThrow("requires accessibilityLabel");
  await expect(mount(React.createElement(Checkbox, { children: "Amend", value: "yes", onValueChange } as never))).rejects.toThrow("Invalid checkbox options");
  await mount(React.createElement(Checkbox, { value: true, accessibilityLabel: "Select row", onValueChange }));
  expect(rendered.root.findByType("SparkButton").props.title).toBe("");
  platform.OS = "windows"; const windowsError = vi.fn();
  await mount(React.createElement(Checkbox, { children: "Amend", value: true, onValueChange, onError: windowsError }));
  expect(rendered.root.findByType("SparkButton").props).toMatchObject({ variant: "checkbox", title: "Amend", checked: true }); expect(windowsError).not.toHaveBeenCalled();
  platform.OS = "android"; const onError = vi.fn();
  await mount(React.createElement(AndroidCheckbox, { children: "Amend", value: true, onValueChange, onError }));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" })); expect(rendered.root.findAllByType("SparkButton")).toHaveLength(0);
});
test("segmented control size and distribution reach AppKit and web, and unknown values reject", async () => {
  await mount(React.createElement(SegmentedControl, { options, value: "one", onValueChange: vi.fn() }));
  expect(rendered.root.findByType("NativeSegmentedControl").props).toMatchObject({ controlSize: "regular", distribution: "fit" });
  await act(async () => rendered.update(React.createElement(SegmentedControl, { options, value: "one", onValueChange: vi.fn(), size: "small", distribution: "fill" })));
  expect(rendered.root.findByType("NativeSegmentedControl").props).toMatchObject({ controlSize: "small", distribution: "fill" });
  await expect(mount(React.createElement(SegmentedControl, { options, value: "one", onValueChange: vi.fn(), size: "large" } as never))).rejects.toThrow("Invalid segmented control options");
  await mount(React.createElement(WebSegmentedControl, { options, value: "one", onValueChange: vi.fn(), size: "small", distribution: "fill" }));
  expect(rendered.root.findAllByType("button").map((button: any) => [button.props.style.flex, button.props.style.font])).toEqual([[1, "12px system-ui"], [1, "12px system-ui"]]);
});
test("web checkbox and disclosure use native input and expanded semantics", async () => {
  const onValueChange = vi.fn();
  await mount(React.createElement(React.Fragment, null, React.createElement(WebCheckbox, { children: "Amend", value: false, onValueChange }), React.createElement(WebButton, { children: "Details", variant: "disclosure", expanded: true })));
  const input = rendered.root.findByType("input").props; expect(input.type).toBe("checkbox"); expect(input.checked).toBe(false);
  input.onChange(); expect(onValueChange).toHaveBeenCalledWith(true);
  const button = rendered.root.findByType("button").props; expect(button["aria-expanded"]).toBe(true); expect(button["aria-label"]).toBe("Details");
});
test("button symbols and sizes reach AppKit, report missing symbols, and are unavailable where the OS lacks them", async () => {
  const onError = vi.fn();
  await mount(React.createElement(Button, { children: "Generate", symbol: "sparkles", size: "small", onError }));
  const native = rendered.root.findByType("SparkButton").props;
  expect(native).toMatchObject({ title: "Generate", symbol: "sparkles", controlSize: "small" });
  await act(async () => native.onSymbolError({ nativeEvent: { name: "other", message: "stale" } }));
  expect(onError).not.toHaveBeenCalled();
  await act(async () => native.onSymbolError({ nativeEvent: { name: "sparkles", message: "SF Symbol 'sparkles' is not available on this system" } }));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_NOT_FOUND" }));
  await mount(React.createElement(Button, { children: "Save" }));
  expect(rendered.root.findByType("SparkButton").props).toMatchObject({ symbol: "", controlSize: "regular" });
  for (const props of [{ symbol: "" }, { symbol: 1 }, { symbol: "a\0b" }, { size: "large" }, { variant: "disclosure", expanded: false, symbol: "chevron.down" }]) {
    await expect(mount(React.createElement(Button, { children: "Save", ...props } as never))).rejects.toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  }
  for (const [os, Component, props] of [["windows", Button, { symbol: "sparkles" }], ["windows", Button, { size: "mini" }], ["android", AndroidButton, { symbol: "sparkles" }], ["android", AndroidButton, { size: "small" }]] as const) {
    platform.OS = os; const failed = vi.fn();
    await mount(React.createElement(Component, { children: "Generate", ...props, onError: failed }));
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  }
  platform.OS = "windows"; const regular = vi.fn();
  await mount(React.createElement(Button, { children: "Save", size: "regular", onError: regular }));
  expect(regular).not.toHaveBeenCalled();
  const webError = vi.fn();
  await mount(React.createElement(WebButton, { children: "Generate", size: "mini" }));
  expect(rendered.root.findByType("button").props.style.font).toBe("10px system-ui");
  await mount(React.createElement(WebButton, { children: "Generate", symbol: "sparkles", onError: webError }));
  expect(webError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  expect(rendered.root.findByType("button").props.disabled).toBe(true);
});
test("radio groups are controlled native radios that snap back until the app accepts a choice", async () => {
  const onValueChange = vi.fn();
  await mount(React.createElement(RadioGroup, { options, value: "one", onValueChange, orientation: "horizontal", size: "small", accessibilityLabel: "Review" }));
  let native = rendered.root.findByType("SparkRadioGroup").props;
  expect(native).toMatchObject({ itemsJson: JSON.stringify(options), value: "one", selectionRevision: 0, enabled: true, orientation: "horizontal", controlSize: "small", accessibilityLabel: "Review" });
  await act(async () => native.onValueChange({ nativeEvent: { value: "two" } }));
  native = rendered.root.findByType("SparkRadioGroup").props; expect(onValueChange).toHaveBeenCalledWith("two"); expect(native.value).toBe("one"); expect(native.selectionRevision).toBe(1);
  const onError = vi.fn();
  await act(async () => rendered.update(React.createElement(RadioGroup, { options, value: "one", onValueChange, onError })));
  await act(async () => rendered.root.findByType("SparkRadioGroup").props.onValueChange({ nativeEvent: { value: "three" } }));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" })); expect(onValueChange).toHaveBeenCalledTimes(1);
  await act(async () => rendered.update(React.createElement(RadioGroup, { options, value: "one", onValueChange, disabled: true })));
  native = rendered.root.findByType("SparkRadioGroup").props; expect(native.enabled).toBe(false);
  native.onValueChange({ nativeEvent: { value: "two" } }); expect(onValueChange).toHaveBeenCalledTimes(1);
  for (const props of [{ value: "three" }, { orientation: "diagonal" }, { size: "large" }, { onValueChange: undefined }]) await expect(mount(React.createElement(RadioGroup, { options, value: "one", onValueChange, ...props } as never))).rejects.toThrow();
  for (const [os, Component] of [["windows", RadioGroup], ["android", AndroidRadioGroup]] as const) {
    platform.OS = os; const onError = vi.fn();
    await mount(React.createElement(Component, { options, value: "two", onValueChange, onError }));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" })); expect(rendered.root.findAllByType("SparkRadioGroup")).toHaveLength(0);
    expect(rendered.root.findAll((node: any) => node.props.accessibilityRole === "radio" && node.props.accessibilityState?.checked).map((node: any) => node.props.children)).toEqual(["Two"]);
  }
});
test("web radio groups use native radio inputs", async () => {
  platform.OS = "web"; const onValueChange = vi.fn();
  await mount(React.createElement(WebRadioGroup, { options, value: "one", onValueChange, accessibilityLabel: "Review" }));
  const inputs = rendered.root.findAllByType("input");
  expect(inputs.map((input: any) => [input.props.type, input.props.checked])).toEqual([["radio", true], ["radio", false]]);
  expect(rendered.root.findByType("div").props).toMatchObject({ role: "radiogroup", "aria-label": "Review" });
  await act(async () => inputs[1].props.onChange()); expect(onValueChange).toHaveBeenCalledWith("two");
});

test.each(["macos", "windows", "ios", "android", "web"])("%s Switch keeps its controlled value and blocks disabled changes", async os => {
  platform.OS = os;
  const onValueChange = vi.fn();
  const element = (disabled: boolean) => React.createElement(Switch, { value: false, onValueChange, disabled, accessibilityLabel: "Wrap lines", accessibilityHint: "Wrap at the editor edge" });
  await mount(element(false));
  const native = rendered.root.findByType("RNSwitch").props;
  expect(native).toMatchObject({ value: false, accessibilityLabel: "Wrap lines", accessibilityHint: "Wrap at the editor edge" });
  native.onValueChange(true);
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(rendered.root.findByType("RNSwitch").props.value).toBe(false);
  await act(async () => rendered.update(element(true)));
  rendered.root.findByType("RNSwitch").props.onValueChange(true);
  expect(onValueChange).toHaveBeenCalledTimes(1);
});

test("Select applies borderless presentation on macOS and web", async () => {
  const props = { options, value: "one", variant: "borderless" as const, onValueChange: vi.fn() };
  await mount(React.createElement(Select, props));
  expect(rendered.root.findByType("NativeSelect").props.borderless).toBe(true);
  await act(async () => rendered.update(React.createElement(Select, { ...props, variant: "default" })));
  expect(rendered.root.findByType("NativeSelect").props.borderless).toBe(false);
  await act(async () => rendered.update(React.createElement(WebSelect, props)));
  expect(rendered.root.findByType("select").props.style).toMatchObject({ border: "none", background: "transparent" });
  await expect(mount(React.createElement(Select, { ...props, variant: "plain" as never }))).rejects.toThrow("Invalid Select variant");
});

test.each([["windows", Select], ["ios", IOSSelect], ["android", AndroidSelect]] as const)("%s reports an unsupported borderless Select", async (os, Component) => {
  platform.OS = os;
  const onError = vi.fn();
  await mount(React.createElement(Component, { options, value: "one", variant: "borderless", onValueChange: vi.fn(), onError }));
  expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  expect(rendered.root.findByType("Text").children).toEqual(["One"]);
});
