import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { showWindow, setWindowOptions, scrollToIndex, listState } = vi.hoisted(() => ({ showWindow: vi.fn(), setWindowOptions: vi.fn(), scrollToIndex: vi.fn(), listState: { scroll: 0, start: 0, positionAtIndex: (i: number) => i * 100, sizeAtIndex: () => 100 } }));
vi.mock("@legendapp/spark-desktop-windows/src/window-manager", () => ({ showWindow, setWindowOptions }));
vi.mock("@legendapp/spark-ui/src/appkit-split-view", async () => { const React = await import("react"); return { SidebarSplitView: (props: any) => React.createElement("SplitView", props, props.sidebar, props.content) }; });
vi.mock("@legendapp/spark-ui/src/classnames", () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, Pressable: "Pressable", View: "View", Text: "Text", ScrollView: "ScrollView", StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 } }));
vi.mock("@legendapp/list/react-native", async () => {
  const React = await import("react");
  return { LegendList: React.forwardRef((props: any, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToIndex, getState: () => listState }));
    return React.createElement("List", props);
  }) };
});
import { SettingsWindow, VirtualizedSettingsWindow, SettingsRow } from "../packages/settings-ui/src";
import { createSettingsWindowOptions } from "../packages/settings-ui/src/options";
const pages = [{ id: "general", title: "General", render: () => "General content" }, { id: "advanced", title: "Advanced", render: () => "Advanced content" }];
let rendered: any;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element); }); }
async function runFrames() { await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); }); }
const ready = { phase: "ready", contentHeight: 500, contentWidth: 500, sidebarHeight: 500, sidebarWidth: 200 };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  showWindow.mockReset().mockResolvedValue(undefined); setWindowOptions.mockReset().mockResolvedValue(undefined); scrollToIndex.mockReset().mockResolvedValue(undefined); listState.start = 0; listState.scroll = 0;
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function sidebar() { return rendered.root.findByType("SplitView").props.sidebar; }
function selectedSidebar() { return sidebar().props.children[0].props; }

test("controlled selection keeps parent ownership and both selection modes use the same page shape", async () => {
  const onSelectionChange = vi.fn();
  await mount(React.createElement(SettingsWindow, { pages, windowId: "settings", selectedPageId: "general", onSelectionChange }));
  await act(async () => selectedSidebar().onSelectionChange("advanced"));
  expect(onSelectionChange).toHaveBeenCalledWith("advanced"); expect(selectedSidebar().selectedPageId).toBe("general");
  await act(async () => rendered.update(React.createElement(SettingsWindow, { pages, windowId: "settings", selectedPageId: "advanced", onSelectionChange })));
  expect(setWindowOptions).toHaveBeenLastCalledWith("settings", { title: "Advanced", windowStyle: { appearance: "system" } });
});
test("default selection initializes once and removal of a page falls back to the first remaining page", async () => {
  await mount(React.createElement(SettingsWindow, { pages, windowId: "settings", defaultPageId: "advanced" }));
  expect(selectedSidebar().selectedPageId).toBe("advanced");
  await act(async () => rendered.update(React.createElement(SettingsWindow, { pages, windowId: "settings", defaultPageId: "general" })));
  expect(selectedSidebar().selectedPageId).toBe("advanced");
  await act(async () => rendered.update(React.createElement(SettingsWindow, { pages: pages.slice(0, 1), windowId: "settings" })));
  expect(selectedSidebar().selectedPageId).toBe("general");
});
test("layout readiness shows the explicit owner once and errors reach the latest callback", async () => {
  const first = vi.fn(), second = vi.fn();
  await mount(React.createElement(StrictMode, null, React.createElement(SettingsWindow, { pages, windowId: "settings", onError: first })));
  await act(async () => rendered.root.findByType("SplitView").props.onResize({ ...ready, phase: "provisional" })); expect(showWindow).not.toHaveBeenCalled();
  await act(async () => rendered.root.findByType("SplitView").props.onResize(ready)); expect(showWindow).toHaveBeenCalledExactlyOnceWith("settings");
  await act(async () => rendered.root.findByType("SplitView").props.onResize(ready)); expect(showWindow).toHaveBeenCalledTimes(1);
  setWindowOptions.mockRejectedValueOnce(new Error("window closed"));
  await act(async () => rendered.update(React.createElement(StrictMode, null, React.createElement(SettingsWindow, { pages, windowId: "settings", appearance: "dark", onError: second }))));
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledWith(expect.objectContaining({ code: "E_NATIVE" }));
});
test("scrolling composition restores parent-vetoed selections and updates the title", async () => {
  const onSelectionChange = vi.fn();
  await mount(React.createElement(VirtualizedSettingsWindow, { pages, windowId: "settings", selectedPageId: "general", onSelectionChange }));
  await runFrames(); expect(scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0, animated: false }));
  listState.scroll = 100; listState.start = 1;
  await act(async () => rendered.root.findByType("List").props.onScroll());
  expect(onSelectionChange).toHaveBeenCalledWith("advanced"); await runFrames();
  expect(scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0, animated: true }));
  await act(async () => rendered.update(React.createElement(VirtualizedSettingsWindow, { pages, windowId: "settings", selectedPageId: "advanced", onSelectionChange })));
  await runFrames(); expect(scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1 }));
  expect(setWindowOptions).toHaveBeenLastCalledWith("settings", { title: "Advanced", windowStyle: { appearance: "system" } });
});
test("late scroll completion cannot show an unmounted window", async () => {
  let finish!: () => void;
  scrollToIndex.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await mount(React.createElement(VirtualizedSettingsWindow, { pages, windowId: "settings", defaultPageId: "advanced" }));
  await runFrames(); await act(async () => rendered.root.findByType("SplitView").props.onResize(ready));
  expect(showWindow).not.toHaveBeenCalled();
  await act(async () => { rendered.unmount(); rendered = undefined; finish(); }); expect(showWindow).not.toHaveBeenCalled();
});
test("settings options use the same defaultPageId and row emphasis does not claim to disable children", async () => {
  expect(createSettingsWindowOptions({ defaultPageId: "advanced" }).initialProperties).toEqual({ defaultPageId: "advanced" });
  await mount(React.createElement(SettingsRow, { title: "Setting", muted: true, control: "Control" }));
  expect(rendered.root.findAllByType("View")[0].props.className).toContain("opacity-60");
});
