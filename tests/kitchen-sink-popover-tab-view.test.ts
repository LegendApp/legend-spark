import { createRequire } from "node:module";
import React, { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");

const state = vi.hoisted(() => ({ locale: "en" as "en" | "ar", available: true }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", ScrollView: "ScrollView" }));
vi.mock("../examples/kitchen-sink/shell/app-controller", () => ({ useI18n: () => ({ locale: state.locale, rtl: state.locale === "ar" }) }));
vi.mock("../examples/kitchen-sink/Controls", () => ({ Button: (props: object) => React.createElement("KSButton", props) }));
const { SparkError, unavailable, availability } = vi.hoisted(() => {
  class SparkError extends Error { constructor(public code: string, message: string) { super(message); } }
  // A native container that throws SparkError E_UNSUPPORTED_PLATFORM when unavailable, as the real ones do.
  const unavailable = (name: string) => (props: object) => {
    if (!state.available) throw new SparkError("E_UNSUPPORTED_PLATFORM", `${name} is unavailable`);
    return React.createElement(name, props);
  };
  return { SparkError, unavailable, availability: () => state.available ? { available: true } : { available: false, reason: "unsupported-platform" } };
});
vi.mock("@legendapp/spark/contracts", () => ({ SparkError }));
vi.mock("@legendapp/spark/ui", () => Object.fromEntries(["Button", "Checkbox", "TextInput", "ComboBox", "DisclosureTriangle", "LevelIndicator", "PathControl", "Progress", "RadioGroup", "Slider", "Stepper", "Switch", "TokenField"].map(name => [name, (props: object) => React.createElement(name, props)])));
vi.mock("@legendapp/spark/ui/popover", () => ({ Popover: unavailable("Popover"), getPopoverAvailability: availability }));
vi.mock("@legendapp/spark/ui/tab-view", () => ({ TabView: unavailable("TabView"), Tab: (props: object) => React.createElement("Tab", props), getTabViewAvailability: availability }));
import { PopoverScreen } from "../examples/kitchen-sink/screens/native-controls/PopoverScreen";
import { TabViewScreen } from "../examples/kitchen-sink/screens/native-controls/TabViewScreen";

let rendered: any;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; state.locale = "en"; state.available = true; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
async function mount(screen: React.ComponentType) { await act(async () => { rendered = create(React.createElement(screen), { createNodeMock: () => ({ measureInWindow: (cb: Function) => cb(24, 300, 288, 36) }) }); }); }
const byID = (testID: string) => rendered.root.find((node: any) => typeof node.type === "string" && node.props.testID === testID);
const text = (testID: string) => byID(testID).props.children;

test("the Popover and Tab view screens are registered last in native-controls", async () => {
  for (const [file, names] of Object.entries({ ControlPrimitives: ["Buttons", "Indicators", "Inputs", "Toggles", "Boundary", "describe"], Glass: ["Glass"], Search: ["Search"], SFSymbols: ["SFSymbols"], Sidebar: ["SidebarDataItems", "SidebarDynamicHeights", "SidebarReactRows"], SplitView: ["SplitView"] })) {
    vi.doMock(`../examples/kitchen-sink/screens/native-controls/${file}`, () => Object.fromEntries(names.map(name => [name, () => null])));
  }
  const { default: registered } = await import("../examples/kitchen-sink/screens/native-controls/index");
  expect(registered.screens.slice(-2).map(screen => [screen.id, screen.component])).toEqual([["popover", PopoverScreen], ["tab-view", TabViewScreen]]);
});

test("the popover opens from its anchor view, reports its lifecycle and closes from its content", async () => {
  await mount(PopoverScreen);
  let popover = byID("native-controls-popover-host");
  expect(text("native-controls-popover-availability")).toBe('{"available":true}');
  expect(popover.props).toMatchObject({ open: false, behavior: "transient", preferredEdge: "bottom", detachable: false });
  expect(popover.props.anchor.ref.current).toBeTruthy();
  await act(async () => byID("native-controls-popover-behavior").props.onValueChange("semi-transient"));
  await act(async () => byID("native-controls-popover-edge").props.onValueChange("leading"));
  await act(async () => byID("native-controls-popover-detachable").props.onValueChange(true));
  await act(async () => byID("native-controls-popover-show").props.onPress());
  popover = byID("native-controls-popover-host");
  expect(popover.props).toMatchObject({ open: true, behavior: "semi-transient", preferredEdge: "leading", detachable: true });
  await act(async () => { popover.props.onShow(); popover.props.onDetach(); });
  expect(text("native-controls-popover-events")).toBe('["shown","detached"]');
  expect(byID("native-controls-popover-note").props.accessibilityLabel).toBe("Note");
  await act(async () => byID("native-controls-popover-close").props.onPress());
  expect(byID("native-controls-popover-host").props.open).toBe(false);
  await act(async () => byID("native-controls-popover-host").props.onClose());
  expect(text("native-controls-popover-events")).toBe('["shown","detached","closed"]');
  expect(text("native-controls-popover-open")).toBe('{"open":false,"anchor":"view"}');
  await act(async () => byID("native-controls-popover-host").props.onError({ code: "E_UNAVAILABLE" }));
});

test("the window-rect anchor measures the button when shown", async () => {
  state.locale = "ar";
  await mount(PopoverScreen);
  expect(byID("native-controls-popover-behavior").props.options.map((option: { label: string }) => option.label)).toEqual(["عابرة", "شبه عابرة", "يحددها التطبيق"]);
  await act(async () => byID("native-controls-popover-anchor-mode").props.onValueChange("rect"));
  await act(async () => byID("native-controls-popover-show").props.onPress());
  expect(byID("native-controls-popover-host").props).toMatchObject({ open: true, anchor: { rect: { x: 24, y: 300, width: 288, height: 36 } } });
});

test("tabs are localized, selection is controlled and the lock vetoes native selections", async () => {
  state.locale = "ar";
  await mount(TabViewScreen);
  const tabs = () => byID("native-controls-tab-view-tabs");
  expect(rendered.root.findAllByType("Tab").map((tab: any) => [tab.props.id, tab.props.label])).toEqual([["general", "عام"], ["appearance", "المظهر"], ["advanced", "متقدم"]]);
  expect(tabs().props).toMatchObject({ selectedId: "general", tabPosition: "top", tabBorder: "bezel" });
  await act(async () => tabs().props.onSelectionChange({ id: "advanced" }));
  expect(text("native-controls-tab-view-selected")).toBe('{"selectedId":"advanced"}');
  await act(async () => byID("native-controls-tab-view-lock").props.onValueChange(true));
  await act(async () => tabs().props.onSelectionChange({ id: "appearance" }));
  expect(tabs().props.selectedId).toBe("advanced");
  expect(text("native-controls-tab-view-requests")).toBe('["advanced","appearance"]');
  await act(async () => byID("native-controls-tab-view-select").props.onValueChange("general"));
  expect(tabs().props.selectedId).toBe("general");
  // A selection that arrives before the lock change has rendered is still vetoed.
  await act(async () => byID("native-controls-tab-view-lock").props.onValueChange(false));
  const { onSelectionChange } = tabs().props;
  await act(async () => { byID("native-controls-tab-view-lock").props.onValueChange(true); onSelectionChange({ id: "appearance" }); });
  expect(tabs().props.selectedId).toBe("general");
});

test("borders other than bezel apply only to a tabless view", async () => {
  await mount(TabViewScreen);
  expect(byID("native-controls-tab-view-border").props.disabled).toBe(true);
  await act(async () => byID("native-controls-tab-view-position").props.onValueChange("none"));
  await act(async () => byID("native-controls-tab-view-border").props.onValueChange("line"));
  expect(byID("native-controls-tab-view-tabs").props).toMatchObject({ tabPosition: "none", tabBorder: "line" });
  expect(text("native-controls-tab-view-style")).toBe('{"tabPosition":"none","tabBorder":"line"}');
  await act(async () => byID("native-controls-tab-view-position").props.onValueChange("leading"));
  expect(byID("native-controls-tab-view-tabs").props).toMatchObject({ tabPosition: "leading", tabBorder: "bezel" });
});

test.each([[PopoverScreen, "native-controls-popover"], [TabViewScreen, "native-controls-tab-view"]] as const)("unsupported hosts show the typed error in place of %#", async (screen, id) => {
  state.available = false;
  await mount(screen);
  expect(text(`${id}-availability`)).toBe('{"available":false,"reason":"unsupported-platform"}');
  expect(text(`${id}-${screen === PopoverScreen ? "host" : "tabs"}-error`)).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
});
