import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { showWindow, setWindowOptions, scrollToIndex, listState, platform } = vi.hoisted(() => ({
  showWindow: vi.fn(), setWindowOptions: vi.fn(), scrollToIndex: vi.fn(),
  listState: { scroll: 0, start: 0, positionAtIndex: (index: number) => index * 100 },
  platform: { OS: "macos" },
}));

vi.mock("@legendapp/spark-desktop-windows/src/api", () => ({ showWindow, setWindowOptions }));
vi.mock("@legendapp/spark-ui/src/appkit-split-view", () => ({
  SidebarSplitView: (props: any) => React.createElement("SplitView", props, props.sidebar, props.content),
}));
vi.mock("@legendapp/spark-ui/src/sidebar", () => ({ Sidebar: "Sidebar", SidebarItem: "SidebarItem" }));
vi.mock("@legendapp/spark-ui/src/sf-symbol", () => ({ SFSymbol: "SFSymbol" }));
vi.mock("@legendapp/spark-ui", () => ({ Switch: "Switch", Select: "Select", SegmentedControl: "SegmentedControl" }));
vi.mock("react-native", () => ({
  Platform: platform, PlatformColor: (name: string) => name, DynamicColorMacOS: (value: unknown) => value,
  Pressable: "Pressable", View: "View", Text: "Text", Image: "Image",
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
vi.mock("@legendapp/list/react-native", () => ({
  LegendList: React.forwardRef((props: any, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToIndex, getState: () => listState }));
    return React.createElement("List", props);
  }),
}));
import {
  SettingsImageChoiceRow, SettingsPage, SettingsSection, SettingsSwitchRow, SettingsWindow, VirtualizedSettingsWindow,
  createSettingsWindowOptions,
} from "../packages/desktop/ui-settings";

const general = React.createElement(SettingsPage, { id: "general", title: "General", icon: "gearshape", children: "General content" });
const advanced = React.createElement(SettingsPage, { id: "advanced", title: "Advanced", icon: "wrench", children: "Advanced content" });
const pages = React.createElement(React.Fragment, null, general, false, advanced);
const settings = { children: pages, windowId: "settings" };
const ready = { phase: "ready", contentHeight: 500, contentWidth: 500, sidebarHeight: 500, sidebarWidth: 200 };
let rendered: any;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const mount = async (element: React.ReactElement) => { await act(async () => { rendered = create(element); }); };
const update = async (element: React.ReactElement) => { await act(async () => rendered.update(element)); };
const sidebar = () => rendered.root.findByType("Sidebar").props;
const list = () => rendered.root.findByType("List").props;
const resize = async (event = ready) => { await act(async () => rendered.root.findByType("SplitView").props.onResize(event)); };
const scroll = async (position: number, start: number) => {
  listState.scroll = position;
  listState.start = start;
  await act(async () => list().onScroll());
};
async function runFrames() {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn(0));
  });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  platform.OS = "macos";
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  showWindow.mockReset().mockResolvedValue(undefined);
  setWindowOptions.mockReset().mockResolvedValue(undefined);
  scrollToIndex.mockReset().mockResolvedValue(undefined);
  listState.start = 0; listState.scroll = 0;
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args);
  });
});
afterEach(async () => {
  if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("fragments declare one list and one icon sidebar", async () => {
  expect(SettingsWindow).toBe(VirtualizedSettingsWindow);
  await mount(React.createElement(SettingsWindow, settings));
  expect(sidebar().selectedId).toBe("general");
  expect(rendered.root.findAllByType("List")).toHaveLength(0);
  expect(rendered.root.findByType("SplitView").props.titleBar).toEqual({ content: { height: 52, material: "windowBackground" } });
  await resize();
  expect(rendered.root.findAllByType("SFSymbol").map((node: any) => node.props.name)).toEqual(["gearshape", "wrench"]);
  expect(list().data.map((page: any) => page.id)).toEqual(["general", "advanced"]);
  expect(list().renderItem({ index: 1, item: list().data[1] }).props.children).toBe("Advanced content");
});

test("sidebar selects and scrolls to the requested page while scroll changes update the title", async () => {
  const onSelectionChange = vi.fn();
  await mount(React.createElement(SettingsWindow, { ...settings, onSelectionChange }));
  await resize(); await runFrames();
  await act(async () => sidebar().onSelectionChange({ id: "advanced" }));
  await runFrames();
  expect(scrollToIndex).toHaveBeenLastCalledWith({ index: 1, animated: true, viewOffset: 52, viewPosition: 0 });
  expect(sidebar().selectedId).toBe("advanced");
  const lastPage = list().renderItem({ index: 1, item: list().data[1] });
  expect(lastPage.props.style[1].minHeight).toBe(448);
  await scroll(0, 0);
  await runFrames();
  expect(scrollToIndex).toHaveBeenCalledTimes(2);
  expect(sidebar().selectedId).toBe("general");
  expect(onSelectionChange.mock.calls).toEqual([["advanced"], ["general"]]);
  expect(setWindowOptions).toHaveBeenLastCalledWith("settings", { title: "General", appearance: "system" });
});

test("default selection initializes once and falls back when its page is removed", async () => {
  await mount(React.createElement(SettingsWindow, { ...settings, defaultPageId: "advanced" }));
  expect(sidebar().selectedId).toBe("advanced");
  await update(React.createElement(SettingsWindow, { ...settings, defaultPageId: "general" }));
  expect(sidebar().selectedId).toBe("advanced");
  await update(React.createElement(SettingsWindow, { ...settings, children: general }));
  expect(sidebar().selectedId).toBe("general");
});

test("the hidden window waits for split layout and scroll, then reports errors to the latest callback", async () => {
  const first = vi.fn(), second = vi.fn();
  const element = (appearance: "system" | "dark", onError: typeof first) =>
    React.createElement(StrictMode, null, React.createElement(SettingsWindow, { ...settings, defaultPageId: "advanced", appearance, onError }));
  await mount(element("system", first));
  await runFrames();
  expect(scrollToIndex).not.toHaveBeenCalled();
  await resize({ ...ready, phase: "provisional" });
  await scroll(0, 0);
  expect(sidebar().selectedId).toBe("advanced");
  await runFrames();
  expect(scrollToIndex).toHaveBeenCalledExactlyOnceWith({ index: 1, animated: false, viewOffset: 52, viewPosition: 0 });
  expect(showWindow).not.toHaveBeenCalled();
  await resize(); await resize();
  expect(showWindow).toHaveBeenCalledExactlyOnceWith("settings");
  setWindowOptions.mockRejectedValueOnce(new Error("window closed"));
  await update(element("dark", second));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith(expect.objectContaining({ code: "E_NATIVE" }));
});

test("controlled scrolling restores parent-vetoed selections", async () => {
  const onSelectionChange = vi.fn();
  const element = (selectedPageId: string) => React.createElement(SettingsWindow, { ...settings, selectedPageId, onSelectionChange });
  await mount(element("general"));
  await resize(); await runFrames();
  await scroll(100, 0); await runFrames();
  expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith("advanced");
  expect(scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0, animated: true }));
  await update(element("advanced")); await runFrames();
  expect(scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1 }));
  expect(setWindowOptions).toHaveBeenLastCalledWith("settings", { title: "Advanced", appearance: "system" });
});

test("a new sidebar selection supersedes an in-progress scroll", async () => {
  await mount(React.createElement(SettingsWindow, settings));
  await resize(); await runFrames();
  let finish!: () => void;
  scrollToIndex.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => sidebar().onSelectionChange({ id: "advanced" }));
  await runFrames();
  await act(async () => sidebar().onSelectionChange({ id: "general" }));
  await runFrames();
  expect(scrollToIndex.mock.calls.map(([request]) => request.index)).toEqual([0, 1, 0]);
  await act(async () => finish());
  expect(sidebar().selectedId).toBe("general");
});

test("late scroll completion cannot show an unmounted window", async () => {
  let finish!: () => void;
  scrollToIndex.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await mount(React.createElement(SettingsWindow, { ...settings, defaultPageId: "advanced" }));
  await resize(); await runFrames();
  expect(showWindow).not.toHaveBeenCalled();
  await act(async () => { rendered.unmount(); rendered = undefined; finish(); });
  expect(showWindow).not.toHaveBeenCalled();
});

test.each([false, true])("windows reject an invalid children shape (duplicate IDs: %s)", async duplicate => {
  const children = duplicate ? [general, general] : React.createElement("Text", null, "Invalid page");
  await expect(mount(React.createElement(SettingsWindow, { ...settings, children }))).rejects.toThrow(
    duplicate ? "Settings page IDs must be unique" : "Settings windows require SettingsPage children",
  );
});

test("other platforms report the macOS boundary before touching window APIs", async () => {
  platform.OS = "windows";
  await expect(mount(React.createElement(SettingsWindow, settings))).rejects.toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  expect(setWindowOptions).not.toHaveBeenCalled();
});

test("sections divide non-null children and keep custom content full width", async () => {
  const switchRow = React.createElement(SettingsSwitchRow, { key: "wrap", label: "Wrap", description: "Long lines", info: "Editor only", value: true, disabled: true, onValueChange: vi.fn() });
  const fragment = React.createElement(React.Fragment, { key: "custom" }, React.createElement("CustomEditor"), React.createElement("CustomPreview"));
  await mount(React.createElement(SettingsSection, { title: "Editor", children: [switchRow, null, fragment, false] }));
  expect(rendered.root.findAllByType("View").filter((node: any) => node.props.style?.[1]?.backgroundColor === "separatorColor")).toHaveLength(1);
  expect(rendered.root.findByType("Switch").props).toMatchObject({ accessibilityLabel: "Wrap", accessibilityHint: "Long lines Editor only", disabled: true });
  expect(rendered.root.findByType("CustomEditor").parent).toBe(rendered.root.findByType("CustomPreview").parent);
});

test("image choices expose radios and handle arrows without adding tab stops", async () => {
  const options = [{ label: "Canvas", value: "canvas", image: 11 }, { label: "Outline", value: "outline", image: 12 }];
  const onValueChange = vi.fn();
  const props = { label: "Layout", options, value: "canvas", onValueChange };
  await mount(React.createElement(SettingsImageChoiceRow, props));
  const group = () => rendered.root.findAllByType("View").find((node: any) => node.props.accessibilityRole === "radiogroup").props;
  const radios = () => rendered.root.findAllByType("Pressable").map((node: any) => node.props);
  expect(group()).toMatchObject({ focusable: true, accessibilityLabel: "Layout" });
  expect(radios()[0]).toMatchObject({ accessibilityRole: "radio", accessibilityState: { checked: true }, focusable: false });
  group().onKeyDown({ nativeEvent: { key: "ArrowRight" } });
  group().onKeyDown({ nativeEvent: { key: "ArrowLeft", metaKey: true } });
  radios()[0].onPress();
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("outline");
  radios()[1].onPress();
  expect(onValueChange).toHaveBeenCalledTimes(2);
  await update(React.createElement(SettingsImageChoiceRow, { ...props, disabled: true }));
  expect(group().focusable).toBe(false);
  expect(group().onKeyDown).toBeUndefined();
  expect(radios()[1].disabled).toBe(true);
  radios()[1].onPress();
  expect(onValueChange).toHaveBeenCalledTimes(2);
});

test("settings options retain the hidden overlay-window defaults", () => {
  expect(createSettingsWindowOptions({ title: "Preferences" })).toMatchObject({
    title: "Preferences", show: false, titleBarStyle: "overlay", size: { width: 820, height: 640 },
  });
});

test("windows that mount together keep their native owners", async () => {
  await mount(React.createElement(StrictMode, null,
    React.createElement(SettingsWindow, { ...settings, windowId: "a" }),
    React.createElement(SettingsWindow, { ...settings, windowId: "b", defaultPageId: "advanced" }),
  ));
  expect(setWindowOptions.mock.calls).toEqual([
    ["a", { title: "General", appearance: "system" }],
    ["b", { title: "Advanced", appearance: "system" }],
  ]);
});
