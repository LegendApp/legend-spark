import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, createRef } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered, commands } = vi.hoisted(() => ({ platform: { OS: "macos", Version: "26.0" }, registered: vi.fn(() => true), commands: { focus: vi.fn(), blur: vi.fn() } }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View", Text: "Text", requireNativeComponent: (name: string) => name }));
vi.mock("../packages/ui/src/text-input-search/TextInputSearchNativeComponent", () => ({ default: "TextInputSearch", Commands: commands }));
vi.mock("../packages/ui/src/appkit-split-view/SidebarSplitViewNativeComponent", () => ({ default: "SidebarSplitView" }));
vi.mock("../packages/ui/src/sidebar/SidebarNativeComponent", () => ({ default: "Sidebar" }));
vi.mock("../packages/ui/src/sidebar/SidebarItemNativeComponent", () => ({ default: "SidebarItem" }));
vi.mock("../packages/ui/src/sf-symbol/SFSymbolNativeComponent", () => ({ default: "SFSymbol" }));
import { TextInputSearch, type TextInputSearchRef } from "../packages/ui/src/text-input-search";
import { SidebarSplitView } from "../packages/ui/src/appkit-split-view";
import { Sidebar, SidebarItem } from "../packages/ui/src/sidebar";
import { GlassView, getGlassAvailability } from "../packages/ui/src/glass-effect-view";
import { SFSymbol } from "../packages/ui/src/sf-symbol";
let rendered: any;
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element, { createNodeMock: () => ({ measureInWindow: (cb: Function) => cb(0, 0, 100, 30) }) }); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; platform.Version = "26.0"; registered.mockReturnValue(true); commands.focus.mockClear(); commands.blur.mockClear();
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
test("search clears controlled text, acknowledges edits, and owns a bounded ref", async () => {
  const ref = createRef<TextInputSearchRef>(), onChangeText = vi.fn(), onError = vi.fn();
  await mount(React.createElement(TextInputSearch, { value: "", onChangeText, onError, ref }));
  let native = rendered.root.findByType("TextInputSearch").props;
  expect(native.text).toBe(""); expect(native.controlled).toBe(true);
  await act(async () => native.onChangeText({ nativeEvent: { text: "typed", eventCount: 1 } }));
  native = rendered.root.findByType("TextInputSearch").props; expect(native.text).toBe(""); expect(native.eventCount).toBe(1); expect(onChangeText).toHaveBeenCalledWith("typed");
  const handle = ref.current!; handle.focus(); handle.blur(); expect(commands.focus).toHaveBeenCalledTimes(1); expect(commands.blur).toHaveBeenCalledTimes(1);
  native.onChangeText({ nativeEvent: { text: 12, eventCount: 2 } }); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
  await act(async () => { rendered.unmount(); rendered = undefined; }); expect(() => handle.focus()).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
});
test("uncontrolled search edits preserve native ownership without a React render", async () => {
  const onChangeText = vi.fn(); await mount(React.createElement(TextInputSearch, { defaultValue: "query", onChangeText }));
  const before = rendered.root.findByType("TextInputSearch").props;
  await act(async () => {
    for (const [text, eventCount] of [["edit", 1], ["newer", 2], ["stale", 1]] as const) before.onChangeText({ nativeEvent: { text, eventCount } });
  });
  expect(rendered.root.findByType("TextInputSearch").props).toBe(before);
  expect(onChangeText.mock.calls).toEqual([["edit"], ["newer"]]);
});
test("split views preserve zero metrics and expose explicit readiness without native envelopes", async () => {
  const onResize = vi.fn(), onError = vi.fn();
  await mount(React.createElement(SidebarSplitView, { sidebar: "Sidebar", content: "Content", onResize, onError, titleBar: { content: { height: 50, overlay: { color: "#ffffff" } } } }));
  const native = rendered.root.findByType("SidebarSplitView"); expect(native.props.contentTitlebarOverlayOpacity).toBe(1); expect(native.props.contentTitlebarHeight).toBe(50);
  const data = { contentHeight: 100, contentWidth: 500, sidebarHeight: 100, sidebarWidth: 200, contentX: 201, height: 100, isLayoutReady: false, isVertical: true };
  await act(async () => native.props.onSplitViewDidResize({ nativeEvent: data }));
  expect(onResize.mock.calls[0][0]).toEqual({ contentHeight: 100, contentWidth: 500, sidebarHeight: 100, sidebarWidth: 200, contentX: 201, height: 100, phase: "provisional" });
  await act(async () => native.props.onSplitViewDidResize({ nativeEvent: { ...data, sidebarWidth: 0, sidebarHeight: 0, isLayoutReady: true } }));
  const panes = rendered.root.findAllByType("View"); expect(panes[0].props.style.width).toBe(0); expect(panes[0].props.style.height).toBe(0); expect(onResize.mock.calls[1][0].phase).toBe("ready");
  native.props.onSplitViewDidResize({ nativeEvent: { ...data, contentWidth: NaN } }); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" })); expect(onResize).toHaveBeenCalledTimes(2);
});
test("sidebar data selection can be cleared and unknown/disabled choices reject", async () => {
  const onSelectionChange = vi.fn(), onError = vi.fn();
  await mount(React.createElement(Sidebar, { items: [{ id: "a", label: "A" }, { id: "b", label: "B", selectable: false }], selectedId: "a", onSelectionChange, onError }));
  let native = rendered.root.findByType("Sidebar").props;
  await act(async () => native.onSidebarSelectionChange({ nativeEvent: { id: "" } }));
  expect(onSelectionChange).toHaveBeenCalledWith({ id: null }); native = rendered.root.findByType("Sidebar").props; expect(native.selectedId).toBe("a"); expect(native.selectionRevision).toBe(1);
  native.onSidebarSelectionChange({ nativeEvent: { id: "b" } }); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" })); expect(onSelectionChange).toHaveBeenCalledTimes(1);
});
test("sidebar selection has no silent write path", async () => {
  await expect(mount(React.createElement(Sidebar, { items: [{ id: "a", label: "A" }], selectedId: null } as never))).rejects.toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  await expect(mount(React.createElement(Sidebar, { items: [{ id: "a", label: "A" }], selectedId: null, onSelectionChange: "nope" } as never))).rejects.toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});
test("sidebar selection acknowledgments reuse the serialized rows and refreshed items replace the cache", async () => {
  const stringify = vi.spyOn(JSON, "stringify"), onSelectionChange = vi.fn();
  const items = [{ id: "a", label: "A" }];
  await mount(React.createElement(Sidebar, { items, selectedId: "a", onSelectionChange }));
  const serialized = stringify.mock.calls.length;
  const before = rendered.root.findByType("Sidebar").props;
  await act(async () => before.onSidebarSelectionChange({ nativeEvent: { id: "" } }));
  expect(stringify.mock.calls.length).toBe(serialized);
  const after = rendered.root.findByType("Sidebar").props;
  expect(after.itemsJson).toBe(before.itemsJson); expect(after.selectionRevision).toBe(1);
  await act(async () => rendered.update(React.createElement(Sidebar, { items: [{ id: "b", label: "B" }], selectedId: "b", onSelectionChange })));
  expect(JSON.parse(rendered.root.findByType("Sidebar").props.itemsJson)).toEqual([{ id: "b", title: "B", selectable: true }]);
});
test("custom sidebar rows expose owned context-menu coordinates", async () => {
  const onContextMenu = vi.fn();
  await mount(React.createElement(Sidebar, { selectedId: null, onSelectionChange: vi.fn(), children: React.createElement(SidebarItem, { id: "row", rowHeight: "auto", onContextMenu }, "Content") }));
  const native = rendered.root.findByType("SidebarItem").props; expect(native.autoHeight).toBe(true); expect(native.itemId).toBe("row");
  native.onRightClick({ nativeEvent: { x: 1, y: 2, pageX: 10, pageY: 20, altKey: false, ctrlKey: true, metaKey: false, shiftKey: false, button: 2 } });
  expect(onContextMenu).toHaveBeenCalledWith({ id: "row", position: { x: 1, y: 2 }, windowPosition: { x: 10, y: 20 }, modifiers: { alt: false, control: true, meta: false, shift: false } });
});
test("glass checks OS capability and preserves children without injecting error text", async () => {
  platform.Version = "15.0"; expect(getGlassAvailability()).toEqual({ available: false, reason: "host-restriction" });
  const onError = vi.fn(); await mount(React.createElement(GlassView, { onError }, "Content"));
  expect(rendered.root.findByType("View").children).toEqual(["Content"]); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNAVAILABLE" }));
});
test("symbols accept style arrays and report only errors for the current symbol", async () => {
  const onError = vi.fn(); await mount(React.createElement(SFSymbol, { name: "doc", size: 32, style: [{ opacity: 0.5 }], onError }));
  const native = rendered.root.findByType("SFSymbol").props; expect(native.style).toEqual([{ height: 32, width: 32 }, [{ opacity: 0.5 }]]);
  native.onSymbolError({ nativeEvent: { name: "old", message: "old error" } }); expect(onError).not.toHaveBeenCalled();
  native.onSymbolError({ nativeEvent: { name: "doc", message: "missing" } }); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_NOT_FOUND" }));
});
