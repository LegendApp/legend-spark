import { beforeEach, expect, test, vi } from "vitest";
const { call, platform, managed } = vi.hoisted(() => ({
  call: vi.fn(), platform: { OS: "macos" },
  managed: {
    getConstantsJson: () => "{}",
    setWindowOptions: vi.fn(async (_id: string, _options: string) => '{"success":true}'),
    getWindowToolbarState: vi.fn(async (_id: string) => ""),
    runWindowToolbarCustomizationPalette: vi.fn(async (_id: string) => '{"success":true}'),
  },
}));
vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("../packages/desktop-windows/src/NativeDesktopWindowManager", () => ({ default: { call } }));
vi.mock("../packages/desktop-windows/src/window-manager/NativeWindowManager", () => ({ default: managed }));
vi.mock("@legendapp/spark-desktop-app/src/events", () => ({ onDesktopEvent: () => ({ remove() {} }) }));
import { getToolbarAvailability, setWindowOptions } from "../packages/desktop-windows/src/api";
import { getToolbarState, showToolbarCustomizationPalette } from "../packages/desktop-windows/src/macos";
import type { MacOSToolbarOptions } from "../packages/desktop-windows/src/types";

const sentStyle = () => JSON.parse(managed.setWindowOptions.mock.calls.at(-1)![1]).windowStyle;
const state = { shown: true, displayMode: "iconAndLabel", customizationId: "editor", itemIds: ["sidebar", "share"], overflowItemIds: ["share"] };
beforeEach(() => {
  platform.OS = "macos";
  call.mockReset();
  managed.setWindowOptions.mockClear();
  managed.getWindowToolbarState.mockReset().mockResolvedValue(JSON.stringify(state));
  managed.runWindowToolbarCustomizationPalette.mockReset().mockResolvedValue('{"success":true}');
});

test("toolbar availability is truthful per platform and rejects unknown features", () => {
  const features = ["customization", "displayMode", "overflow", "shown", "sidebarToggle"] as const;
  expect(getToolbarAvailability()).toEqual({ available: true });
  for (const feature of features) expect(getToolbarAvailability(feature)).toEqual({ available: true });
  platform.OS = "windows";
  expect(getToolbarAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  for (const feature of features) expect(getToolbarAvailability(feature)).toEqual({ available: false, reason: "unsupported-platform" });
  expect(() => getToolbarAvailability("palette" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(call).not.toHaveBeenCalled();
});

test("display mode, shown state, customization and the sidebar item reach AppKit in its wire format", async () => {
  await setWindowOptions("editor", { macos: { toolbar: { displayMode: "label", shown: false, customization: { id: "editor.main" }, items: [{ type: "sidebarToggle", id: "sidebar", placement: "leading" }] } } });
  expect(call).not.toHaveBeenCalled();
  expect(sentStyle()).toEqual({ toolbarDisplayMode: "label", toolbarShown: false, toolbarCustomization: "editor.main", toolbarItems: [{ type: "sidebarToggle", id: "sidebar", placement: "leading" }] });
  await setWindowOptions("editor", { macos: { toolbar: { customization: null } } });
  expect(sentStyle()).toEqual({ toolbarCustomization: null });
});

test("invalid toolbar options reject before any native call", async () => {
  const cases: [MacOSToolbarOptions, string][] = [
    [{ displayMode: "text" as never }, "E_INVALID_ARGUMENT"],
    [{ shown: "no" as never }, "E_INVALID_ARGUMENT"],
    [{ customization: { id: "" } }, "E_INVALID_ARGUMENT"],
    [{ customization: { id: "has space" } }, "E_INVALID_ARGUMENT"],
    [{ customization: { id: "editor", autosave: true } as never }, "E_UNSUPPORTED_OPTION"],
    [{ visible: false, displayMode: "icon" }, "E_INVALID_ARGUMENT"],
    [{ items: [{ type: "sidebarToggle", id: "a" }, { type: "sidebarToggle", id: "b" }] }, "E_INVALID_ARGUMENT"],
    [{ items: [{ type: "sidebarToggle", id: "a", label: "Sidebar" } as never] }, "E_UNSUPPORTED_OPTION"],
  ];
  for (const [toolbar, code] of cases) await expect(setWindowOptions("editor", { macos: { toolbar } })).rejects.toMatchObject({ code });
  // Removing the toolbar while setting other existing fields stays valid.
  await setWindowOptions("editor", { macos: { toolbar: { visible: false, style: "unified" } } });
  expect(managed.setWindowOptions).toHaveBeenCalledOnce();
});

test("Windows rejects toolbar options and macOS toolbar commands with typed errors", async () => {
  platform.OS = "windows";
  await expect(setWindowOptions("editor", { macos: { toolbar: { displayMode: "icon" } } })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(getToolbarState("editor")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(showToolbarCustomizationPalette("editor")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  expect(managed.setWindowOptions).not.toHaveBeenCalled();
  expect(managed.getWindowToolbarState).not.toHaveBeenCalled();
});

test("toolbar state is validated and exposes only the public shape", async () => {
  managed.getWindowToolbarState.mockResolvedValueOnce(JSON.stringify({ ...state, nativePrivate: 1 }));
  expect(await getToolbarState("editor")).toEqual(state);
  expect(managed.getWindowToolbarState).toHaveBeenCalledWith("editor");
  managed.getWindowToolbarState.mockResolvedValueOnce(JSON.stringify({ ...state, customizationId: null, displayMode: "icon" }));
  expect(await getToolbarState("editor")).toMatchObject({ customizationId: null, displayMode: "icon" });
  for (const malformed of [{ ...state, displayMode: "default" }, { ...state, overflowItemIds: [1] }, { ...state, shown: 1 }]) {
    managed.getWindowToolbarState.mockResolvedValueOnce(JSON.stringify(malformed));
    await expect(getToolbarState("editor")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  managed.getWindowToolbarState.mockRejectedValueOnce(Object.assign(new Error("The window has no toolbar"), { code: "E_NOT_FOUND" }));
  await expect(getToolbarState("editor")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  await expect(getToolbarState("../editor")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("the customization palette reports AppKit's refusal as a typed error", async () => {
  await showToolbarCustomizationPalette("editor");
  expect(managed.runWindowToolbarCustomizationPalette).toHaveBeenCalledWith("editor");
  managed.runWindowToolbarCustomizationPalette.mockRejectedValueOnce(Object.assign(new Error("Toolbar customization is off for this window"), { code: "E_UNAVAILABLE" }));
  await expect(showToolbarCustomizationPalette("editor")).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
});

test("a display mode AppKit refuses rejects as an unsupported option", async () => {
  managed.setWindowOptions.mockRejectedValueOnce(Object.assign(new Error("AppKit shows labels only when every toolbar item responds to a click"), { code: "E_UNSUPPORTED_OPTION" }));
  await expect(setWindowOptions("editor", { macos: { toolbar: { displayMode: "label" } } })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
});
