import { createRequire } from "node:module";
import React, { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");

const state = vi.hoisted(() => ({ locale: "en" as "en" | "ar", available: true }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", ScrollView: "ScrollView" }));
vi.mock("../examples/kitchen-sink/shell/app-controller", () => ({ useI18n: () => ({ locale: state.locale, rtl: state.locale === "ar" }) }));
vi.mock("@legendapp/spark/contracts", () => ({ SparkError: class SparkError extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock("@legendapp/spark/ui", async () => {
  const { SparkError } = await import("@legendapp/spark/contracts") as { SparkError: new (code: string, message: string) => Error };
  const control = (name: string) => (props: object) => {
    if (!state.available) throw new SparkError("E_UNSUPPORTED_PLATFORM", `${name} is unavailable`);
    return React.createElement(name, props);
  };
  const availability = () => state.available ? { available: true } : { available: false, reason: "unsupported-platform" };
  return {
    ...Object.fromEntries(["Button", "Checkbox", "ComboBox", "DisclosureTriangle", "LevelIndicator", "PathControl", "Progress", "RadioGroup", "Slider", "Stepper", "Switch", "TokenField"].map(name => [name, control(name)])),
    getControlAvailability: availability, getButtonAvailability: availability,
  };
});
// The area index also registers screens owned by other tasks; they are not under test here.
for (const [file, names] of Object.entries({ Glass: ["Glass"], Search: ["Search"], SFSymbols: ["SFSymbols"], Sidebar: ["SidebarDataItems", "SidebarDynamicHeights", "SidebarReactRows"], SplitView: ["SplitView"] })) {
  vi.doMock(`../examples/kitchen-sink/screens/native-controls/${file}`, () => Object.fromEntries(names.map(name => [name, () => null])));
}
import { Buttons, Indicators, Inputs, Toggles } from "../examples/kitchen-sink/screens/native-controls/ControlPrimitives";

let rendered: any;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; state.locale = "en"; state.available = true; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
async function mount(screen: React.ComponentType) { await act(async () => { rendered = create(React.createElement(screen)); }); }
const byID = (testID: string) => rendered.root.find((node: any) => typeof node.type === "string" && node.props.testID === testID);
const text = (testID: string) => byID(testID).props.children;

test("the gallery pages are registered screens in the native-controls area", async () => {
  const { default: registered } = await import("../examples/kitchen-sink/screens/native-controls/index");
  expect(registered.area).toBe("native-controls");
  expect(registered.screens.filter(screen => [Toggles, Inputs, Indicators, Buttons].includes(screen.component as never)).map(screen => screen.id)).toEqual(["toggles", "inputs", "indicators", "buttons"]);
});

test("samples render in every size with localized accessibility labels and JSON readouts", async () => {
  state.locale = "ar";
  await mount(Toggles);
  for (const size of ["mini", "small", "regular", "large"]) expect(byID(`native-controls-toggles-checkbox-${size}`).type).toBe("Checkbox");
  expect(byID("native-controls-toggles-checkbox-regular").props.accessibilityLabel).toBe("خانة اختيار، عادي");
  expect(byID("native-controls-toggles-radio-group-small").props.options.map((option: { label: string }) => option.label)).toEqual(["الأول", "الثاني"]);
  expect(text("native-controls-toggles-checkbox-mixed-mini-value")).toBe('"mixed"');
  expect(text("native-controls-toggles-checkbox-availability")).toBe('{"available":true}');
  await act(async () => byID("native-controls-toggles-checkbox-mini").props.onValueChange(true));
  expect(text("native-controls-toggles-checkbox-mini-value")).toBe("true");
});

test("the page Disable controls checkbox disables every sample", async () => {
  await mount(Inputs);
  expect(byID("native-controls-inputs-slider-large").props.disabled).toBe(false);
  await act(async () => byID("native-controls-inputs-disabled").props.onValueChange(true));
  for (const row of ["slider", "slider-ticks", "stepper", "combo-box", "token-field", "path-control"]) expect(byID(`native-controls-inputs-${row}-regular`).props.disabled).toBe(true);
});

test("the Amount stepper drives the read-only indicators", async () => {
  await mount(Indicators);
  await act(async () => byID("native-controls-indicators-amount").props.onValueChange(7));
  expect(byID("native-controls-indicators-progress-small").props.value).toBe(0.7);
  expect(text("native-controls-indicators-progress-small-value")).toBe("0.7");
  expect(byID("native-controls-indicators-level-indicator-large").props.value).toBe(7);
});

test("buttons: plain rows omit the variant; the keyboard section has one default and one cancel button at the chosen size", async () => {
  await mount(Buttons);
  expect(byID("native-controls-buttons-plain-mini").props.variant).toBeUndefined();
  expect(byID("native-controls-buttons-keyboard-plain").props).not.toHaveProperty("variant");
  expect(byID("native-controls-buttons-keyboard-plain").props).not.toHaveProperty("size");
  expect(byID("native-controls-buttons-keyboard-default").props).toMatchObject({ variant: "default", size: "regular" });
  await act(async () => byID("native-controls-buttons-keyboard-size").props.onValueChange("mini"));
  expect(byID("native-controls-buttons-keyboard-cancel").props).toMatchObject({ variant: "cancel", size: "mini" });
  await act(async () => byID("native-controls-buttons-keyboard-default").props.onPress());
  expect(text("native-controls-buttons-keyboard-default-value")).toBe("1");
});

test("unsupported platforms show the typed error in place of each control, never a substitute", async () => {
  state.available = false;
  await mount(Toggles);
  expect(text("native-controls-toggles-checkbox-availability")).toBe('{"available":false,"reason":"unsupported-platform"}');
  expect(text("native-controls-toggles-switch-large-error")).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  expect(text("native-controls-toggles-disabled-error")).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  expect(rendered.root.findAll((node: any) => node.type === "Checkbox")).toHaveLength(0);
});
