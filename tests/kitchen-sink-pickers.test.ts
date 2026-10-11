import { createRequire } from "node:module";
import React, { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");

const state = vi.hoisted(() => ({ locale: "en" as "en" | "ar", available: true, closes: 0, colorOptions: undefined as any, fontOptions: undefined as any }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", ScrollView: "ScrollView" }));
vi.mock("../examples/kitchen-sink/shell/app-controller", () => ({ useI18n: () => ({ locale: state.locale, rtl: state.locale === "ar" }) }));
vi.mock("../examples/kitchen-sink/Controls", () => ({ Button: (props: object) => React.createElement("KSButton", props) }));
vi.mock("@legendapp/spark/contracts", () => ({ SparkError: class SparkError extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock("@legendapp/spark/ui", async () => {
  const { SparkError } = await import("@legendapp/spark/contracts") as { SparkError: new (code: string, message: string) => Error };
  const control = (name: string) => (props: object) => {
    if (!state.available) throw new SparkError("E_UNSUPPORTED_PLATFORM", `${name} is unavailable`);
    return React.createElement(name, props);
  };
  const availability = () => state.available ? { available: true } : { available: false, reason: "unsupported-platform" };
  const unsupported = () => Promise.reject(new SparkError("E_UNSUPPORTED_PLATFORM", "System panels are unavailable"));
  const session = { close: async () => { state.closes++; } };
  return {
    ...Object.fromEntries(["Button", "Checkbox", "ComboBox", "DisclosureTriangle", "LevelIndicator", "PathControl", "Progress", "RadioGroup", "Slider", "Stepper", "Switch", "TokenField", "DatePicker", "ColorWell"].map(name => [name, control(name)])),
    getControlAvailability: availability, getButtonAvailability: availability, getColorPanelAvailability: availability, getFontPanelAvailability: availability,
    showColorPanel: async (options: object) => { if (!state.available) return unsupported(); state.colorOptions = options; return session; },
    showFontPanel: async (options: object) => {
      if (!state.available) return unsupported();
      state.fontOptions = options;
      return { ...session, font: { family: "Helvetica Neue", postScriptName: "HelveticaNeue", size: 15, weight: 400, italic: false } };
    },
    sampleScreenColor: async () => state.available ? { canceled: false, color: "#a1b2c3" } : unsupported(),
  };
});
for (const [file, names] of Object.entries({ Glass: ["Glass"], Search: ["Search"], SFSymbols: ["SFSymbols"], Sidebar: ["SidebarDataItems", "SidebarDynamicHeights", "SidebarReactRows"], SplitView: ["SplitView"], Table: ["TableScreen", "OutlineScreen"], PopoverScreen: ["PopoverScreen"], TabViewScreen: ["TabViewScreen"] })) {
  vi.doMock(`../examples/kitchen-sink/screens/native-controls/${file}`, () => Object.fromEntries(names.map(name => [name, () => null])));
}
import { Pickers } from "../examples/kitchen-sink/screens/native-controls/Pickers";

let rendered: any;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; Object.assign(state, { locale: "en", available: true, closes: 0, colorOptions: undefined, fontOptions: undefined }); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
async function mount() { await act(async () => { rendered = create(React.createElement(Pickers)); }); }
const byID = (testID: string) => rendered.root.find((node: any) => typeof node.type === "string" && node.props.testID === testID);
const text = (testID: string) => byID(testID).props.children;

test("Pickers is a registered native-controls screen", async () => {
  const { default: registered } = await import("../examples/kitchen-sink/screens/native-controls/index");
  expect(registered.screens.find(screen => screen.component === Pickers)?.id).toBe("pickers");
});

test("date pickers are UTC, localized, and report Unix milliseconds with ISO readouts", async () => {
  state.locale = "ar";
  await mount();
  expect(byID("native-controls-pickers-date").props).toMatchObject({ mode: "date", timeZone: "UTC", value: Date.UTC(2026, 2, 14, 9, 30), accessibilityLabel: "التاريخ" });
  expect(byID("native-controls-pickers-calendar").props).toMatchObject({ variant: "clock-calendar", mode: "date" });
  expect(byID("native-controls-pickers-umm-al-qura").props).toMatchObject({ locale: "ar-SA" });
  expect(byID("native-controls-pickers-japanese").props).toMatchObject({ locale: "ja-JP", calendar: "japanese" });
  expect(byID("native-controls-pickers-bounded").props).toMatchObject({ min: Date.UTC(2026, 2, 1), max: Date.UTC(2026, 2, 31, 23, 59) });
  expect(text("native-controls-pickers-date-value")).toBe("1773480600000 2026-03-14T09:30:00.000Z");
  await act(async () => byID("native-controls-pickers-time").props.onValueChange(Date.UTC(2026, 2, 14, 17, 5)));
  expect(text("native-controls-pickers-time-value")).toBe("1773507900000 2026-03-14T17:05:00.000Z");
  expect(text("native-controls-pickers-availability-date-picker")).toBe('date-picker: {"available":true}');
});

test("color wells and the Disable controls checkbox", async () => {
  await mount();
  expect(byID("native-controls-pickers-well-alpha").props).toMatchObject({ alpha: true, value: "#3366cc80" });
  expect(byID("native-controls-pickers-well-expanded").props.variant).toBe("expanded");
  await act(async () => byID("native-controls-pickers-well").props.onValueChange("#ff8000"));
  expect(text("native-controls-pickers-well-value")).toBe('"#ff8000"');
  await act(async () => byID("native-controls-pickers-disabled").props.onValueChange(true));
  for (const row of ["date", "clock", "well", "well-minimal"]) expect(byID(`native-controls-pickers-${row}`).props.disabled).toBe(true);
});

test("panel demos stream into their readouts and close their sessions on unmount", async () => {
  await mount();
  await act(async () => byID("native-controls-pickers-color-panel").props.onPress());
  expect(state.colorOptions).toMatchObject({ color: "#3366ccff", alpha: true, mode: "wheel" });
  expect(text("native-controls-pickers-color-panel-state")).toBe("open");
  await act(async () => state.colorOptions.onChange({ color: "#00ff0080" }));
  expect(text("native-controls-pickers-color-panel-value")).toBe("#00ff0080");
  await act(async () => state.colorOptions.onClose({ reason: "dismissed" }));
  expect(text("native-controls-pickers-color-panel-state")).toBe("dismissed");
  await act(async () => byID("native-controls-pickers-sampler").props.onPress());
  expect(text("native-controls-pickers-sampler-result")).toBe('{"canceled":false,"color":"#a1b2c3"}');
  await act(async () => byID("native-controls-pickers-font-panel").props.onPress());
  expect(state.fontOptions.font).toEqual({ family: "Helvetica Neue", size: 15, weight: 400, italic: false });
  const bold = { family: "Helvetica Neue", postScriptName: "HelveticaNeue-BoldItalic", size: 18, weight: 700, italic: true };
  await act(async () => state.fontOptions.onChange({ font: bold }));
  expect(JSON.parse(text("native-controls-pickers-font-panel-value"))).toEqual(bold);
  expect(byID("native-controls-pickers-font-sample").props.style).toMatchObject({ fontFamily: "Helvetica Neue", fontSize: 18, fontWeight: "700", fontStyle: "italic" });
  await act(async () => { rendered.unmount(); rendered = undefined; });
  expect(state.closes).toBe(2);
});

test("Close closes only a session the screen opened, once", async () => {
  await mount();
  await act(async () => byID("native-controls-pickers-color-panel-close").props.onPress());
  expect(state.closes).toBe(0); expect(text("native-controls-pickers-color-panel-state")).toBe("No result yet");
  await act(async () => byID("native-controls-pickers-color-panel").props.onPress());
  await act(async () => byID("native-controls-pickers-color-panel-close").props.onPress());
  await act(async () => byID("native-controls-pickers-color-panel-close").props.onPress());
  expect(state.closes).toBe(1); expect(text("native-controls-pickers-color-panel-state")).toBe("closed");
  await act(async () => { rendered.unmount(); rendered = undefined; });
  expect(state.closes).toBe(1);
});

test("unsupported platforms show the typed error in place of each control and panel result", async () => {
  state.available = false;
  await mount();
  expect(text("native-controls-pickers-date-error")).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  expect(text("native-controls-pickers-well-alpha-error")).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  expect(text("native-controls-pickers-availability-font-panel")).toBe('font-panel: {"available":false,"reason":"unsupported-platform"}');
  await act(async () => byID("native-controls-pickers-font-panel").props.onPress());
  expect(text("native-controls-pickers-font-panel-state")).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  await act(async () => byID("native-controls-pickers-sampler").props.onPress());
  expect(text("native-controls-pickers-sampler-result")).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  expect(rendered.root.findAll((node: any) => node.type === "DatePicker")).toHaveLength(0);
});
