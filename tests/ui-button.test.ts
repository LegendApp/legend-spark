import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered } = vi.hoisted(() => ({ platform: { OS: "macos" }, registered: vi.fn(() => true) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View", Text: "Text" }));
vi.mock("../packages/ui/src/SparkButtonNativeComponent", () => ({ default: "SparkButton" }));
vi.mock("../packages/ui/src/SparkPrimitiveNativeComponent", () => ({ default: "SparkPrimitive" }));
vi.mock("../packages/ui/src/SparkTextInputNativeComponent", () => ({ default: "SparkTextInput" }));
vi.mock("../packages/ui/src/SparkSelectNativeComponent", () => ({ default: "SparkSelect" }));
vi.mock("../packages/ui/src/native-select/NativeSelectNativeComponent", () => ({ default: "NativeSelect" }));
vi.mock("../packages/ui/src/native-select/NativeSegmentedControlNativeComponent", () => ({ default: "NativeSegmentedControl" }));
import { Button, getButtonAvailability, type ButtonVariant, type ControlSize } from "../packages/ui/src/index";
import { Button as WebButton } from "../packages/ui/src/index.web";
let rendered: any;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; registered.mockReturnValue(true); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
const variants: ButtonVariant[] = ["push", "bevel", "toolbar", "help", "default", "cancel", "destructive"];
const sizes: ControlSize[] = ["mini", "small", "regular", "large"];
test.each(variants.flatMap(variant => sizes.map(size => ({ variant, size }))))("macOS forwards $variant/$size with accessible labels and disabled state", async options => {
  const onPress = vi.fn();
  expect(getButtonAvailability(options)).toEqual({ available: true });
  await act(async () => { rendered = create(React.createElement(Button, { ...options, children: "Action", accessibilityLabel: "Action label", disabled: true, onPress })); });
  const native = rendered.root.findByType("SparkButton").props;
  expect(native.variant).toBe(options.variant); expect(native.controlSize).toBe(options.size); expect(native.accessibilityLabel).toBe("Action label");
  native.onButtonPress(); expect(onPress).not.toHaveBeenCalled();
});
test.each(["windows", "web", "ios", "android"])("%s reports and rejects unavailable native styles and sizes", async os => {
  platform.OS = os;
  expect(getButtonAvailability({ variant: "bevel", size: "mini" })).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(act(async () => { rendered = create(React.createElement(Button, { children: "Action", variant: "bevel", size: "mini" })); })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
});
test("missing native registration rejects new options with module error", async () => {
  registered.mockReturnValue(false);
  expect(getButtonAvailability({ variant: "help" })).toEqual({ available: false, reason: "missing-module" });
  await expect(act(async () => { rendered = create(React.createElement(Button, { children: "Help", variant: "help" })); })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});
test("invalid style and size fail before native rendering", () => {
  for (const options of [{ variant: "custom" }, { size: "huge" }, null, []]) expect(() => getButtonAvailability(options as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});
test("unknown availability options reject even when undefined", () => {
  expect(() => getButtonAvailability({ native: undefined } as never)).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
});
test("web never silently accepts native sizing", async () => {
  await expect(act(async () => { rendered = create(React.createElement(WebButton, { children: "Save", size: "regular" })); })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
});
test("legacy Windows buttons remain available", () => {
  platform.OS = "windows";
  expect(getButtonAvailability()).toEqual({ available: true });
  expect(getButtonAvailability({ variant: "borderless" })).toEqual({ available: true });
  expect(getButtonAvailability({ variant: "default", size: "regular" })).toEqual({ available: false, reason: "unsupported-platform" });
});
test("macOS omitted variant is a plain push button; only explicit default is the Return-key button", async () => {
  await act(async () => { rendered = create(React.createElement(Button, { children: "Save" })); });
  expect(rendered.root.findByType("SparkButton").props.variant).toBe("push");
  await act(async () => { rendered.update(React.createElement(Button, { children: "Save", variant: "default" })); });
  expect(rendered.root.findByType("SparkButton").props.variant).toBe("default");
});
test.each(["windows", "web"])("%s explicit default keeps its portable behavior", async os => {
  platform.OS = os;
  const onPress = vi.fn();
  expect(getButtonAvailability({ variant: "default" })).toEqual({ available: true });
  if (os === "web") {
    await act(async () => { rendered = create(React.createElement(WebButton, { children: "Save", variant: "default", onPress })); });
    rendered.root.findByType("button").props.onClick();
  } else {
    await act(async () => { rendered = create(React.createElement(Button, { children: "Save", variant: "default", onPress })); });
    const native = rendered.root.findByType("SparkButton").props;
    expect(native.variant).toBe("default");
    native.onButtonPress();
  }
  expect(onPress).toHaveBeenCalledTimes(1);
});
test("Windows omitted variant preserves the legacy button and press callback", async () => {
  platform.OS = "windows";
  const onPress = vi.fn();
  expect(getButtonAvailability()).toEqual({ available: true });
  await act(async () => { rendered = create(React.createElement(Button, { children: "Save", onPress })); });
  const native = rendered.root.findByType("SparkButton").props;
  expect(native.variant).toBe("default");
  native.onButtonPress();
  expect(onPress).toHaveBeenCalledTimes(1);
});
