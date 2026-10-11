import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, createRef } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered, nodeHandle } = vi.hoisted(() => ({ platform: { OS: "macos", Version: "26.0" }, registered: vi.fn((_name: string) => true), nodeHandle: vi.fn((instance: unknown) => instance ? 42 : null) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View", findNodeHandle: nodeHandle }));
vi.mock("../packages/ui/src/popover/PopoverNativeComponent", () => ({ default: "SparkPopover" }));
vi.mock("../packages/ui/src/tab-view/TabViewNativeComponent", () => ({ default: "SparkTabView" }));
vi.mock("../packages/ui/src/tab-view/TabNativeComponent", () => ({ default: "SparkTab" }));
import { Popover, getPopoverAvailability, type PopoverProps } from "../packages/ui/src/popover";
import { Tab, TabView, getTabViewAvailability, type TabViewProps } from "../packages/ui/src/tab-view";

let rendered: any;
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element, { createNodeMock: () => ({ measureInWindow: (cb: Function) => cb(0, 0, 100, 30) }) }); }); }
async function update(element: React.ReactElement) { await act(async () => rendered.update(element)); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; platform.Version = "26.0"; registered.mockReturnValue(true); nodeHandle.mockClear();
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
const native = (type: string) => rendered.root.findByType(type);
const popover = (props: Partial<PopoverProps> = {}) => React.createElement(Popover, { open: false, anchor: { rect: { x: 10, y: 20, width: 30, height: 40 } }, onClose: () => {}, ...props } as PopoverProps, "Content");
const tabView = (props: Partial<TabViewProps> = {}, children: React.ReactNode = [React.createElement(Tab, { key: "a", id: "a", label: "A", testID: "tab-a" }, "Alpha"), React.createElement(Tab, { key: "b", id: "b", label: "B" }, "Beta")]) =>
  React.createElement(TabView, { selectedId: "a", onSelectionChange: () => {}, ...props } as TabViewProps, children);

test.each([
  ["popover", getPopoverAvailability, () => popover(), ["SparkPopover"]],
  ["tab view", getTabViewAvailability, () => tabView(), ["SparkTabView", "SparkTab"]],
] as const)("%s availability is truthful and an unavailable view throws a typed error", async (_name, availability, element, names) => {
  expect(availability()).toEqual({ available: true });
  for (const name of names) expect(registered).toHaveBeenCalledWith(name);
  registered.mockImplementation(name => name !== names.at(-1));
  expect(availability()).toEqual({ available: false, reason: "missing-module" });
  await expect(mount(element())).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  registered.mockReturnValue(true);
  platform.Version = "13.6";
  expect(availability()).toEqual({ available: false, reason: "host-restriction" });
  await expect(mount(element())).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  platform.Version = "26.0";
  for (const os of ["windows", "ios", "android", "web"]) {
    platform.OS = os;
    expect(availability()).toEqual({ available: false, reason: "unsupported-platform" });
    await expect(mount(element())).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  }
});

test("popover passes its configuration and hosts content in one unconstrained child", async () => {
  await mount(popover());
  const host = native("SparkPopover");
  expect(host.props).toMatchObject({ open: false, eventCount: 0, behavior: "transient", preferredEdge: "bottom", detachable: false, anchorTag: 0, hasAnchorRect: true, anchorX: 10, anchorY: 20, anchorWidth: 30, anchorHeight: 40 });
  expect(host.props.style).toEqual({ position: "absolute", width: 0, height: 0 });
  expect(host.children).toHaveLength(1);
  expect(host.children[0].props).toMatchObject({ collapsable: false, style: { position: "absolute", left: 0, top: 0 }, children: "Content" });
  await update(popover({ open: true, behavior: "application-defined", preferredEdge: "leading", detachable: true }));
  expect(native("SparkPopover").props).toMatchObject({ open: true, behavior: "application-defined", preferredEdge: "leading", detachable: true });
});

test("a ref anchor resolves to its React tag after commit and reports an unmounted ref while open", async () => {
  const onError = vi.fn();
  function Screen({ mounted, open }: { mounted: boolean; open: boolean }) {
    const ref = React.useRef(null);
    return React.createElement(React.Fragment, null, mounted ? React.createElement("View", { ref }) : null,
      React.createElement(Popover, { open, anchor: { ref, rect: { x: 1, y: 2, width: 3, height: 4 } }, onClose: () => {}, onError, children: "Content" }));
  }
  await mount(React.createElement(Screen, { mounted: true, open: true }));
  expect(native("SparkPopover").props).toMatchObject({ anchorTag: 42, hasAnchorRect: true, anchorX: 1, anchorHeight: 4 });
  expect(onError).not.toHaveBeenCalled();
  await update(React.createElement(Screen, { mounted: false, open: false }));
  expect(native("SparkPopover").props.anchorTag).toBe(-1);
  expect(onError).not.toHaveBeenCalled();
  await update(React.createElement(Screen, { mounted: false, open: true }));
  await update(React.createElement(Screen, { mounted: false, open: true }));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0]).toMatchObject({ code: "E_NOT_FOUND" });
});

test("popover events are counted, echoed, and delivered once", async () => {
  const onShow = vi.fn(), onClose = vi.fn(), onDetach = vi.fn(), onError = vi.fn();
  await mount(popover({ open: true, onShow, onClose, onDetach, onError }));
  const emit = (state: unknown, eventCount: unknown) => act(async () => native("SparkPopover").props.onPopoverChange({ nativeEvent: { state, eventCount } }));
  await emit("shown", 1);
  expect(onShow).toHaveBeenCalledTimes(1); expect(native("SparkPopover").props.eventCount).toBe(1);
  await emit("detached", 2); await emit("closed", 3);
  expect(onDetach).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1); expect(native("SparkPopover").props.eventCount).toBe(3);
  // The parent kept `open`: native shows again once it sees the echoed count.
  expect(native("SparkPopover").props.open).toBe(true);
  await emit("closed", 2);
  expect(onClose).toHaveBeenCalledTimes(1);
  await emit("hidden", 4); await emit("shown", 0);
  expect(onError.mock.calls.map(([error]) => error.code)).toEqual(["E_INVALID_DATA", "E_INVALID_DATA"]);
  await act(async () => native("SparkPopover").props.onPopoverError({ nativeEvent: { code: "E_UNAVAILABLE", message: "Popover anchor window is not on screen" } }));
  expect(onError.mock.calls[2][0]).toMatchObject({ code: "E_UNAVAILABLE", message: "Popover anchor window is not on screen" });
  await act(async () => native("SparkPopover").props.onPopoverError({ nativeEvent: { code: 5 } }));
  expect(onError.mock.calls[3][0]).toMatchObject({ code: "E_INVALID_DATA" });
  const { onPopoverChange } = native("SparkPopover").props;
  await act(async () => { rendered.unmount(); rendered = undefined; });
  onPopoverChange({ nativeEvent: { state: "closed", eventCount: 5 } });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test.each([
  [{ open: "yes" }, "E_INVALID_ARGUMENT"], [{ onClose: undefined }, "E_INVALID_ARGUMENT"], [{ onShow: 1 }, "E_INVALID_ARGUMENT"],
  [{ behavior: "modal" }, "E_INVALID_ARGUMENT"], [{ preferredEdge: "left" }, "E_INVALID_ARGUMENT"], [{ detachable: 1 }, "E_INVALID_ARGUMENT"],
  [{ anchor: undefined }, "E_INVALID_ARGUMENT"], [{ anchor: { rect: { x: 0, y: 0, width: -1, height: 1 } } }, "E_INVALID_ARGUMENT"],
  [{ anchor: { rect: { x: NaN, y: 0, width: 1, height: 1 } } }, "E_INVALID_ARGUMENT"], [{ anchor: { ref: {} } }, "E_INVALID_ARGUMENT"],
])("popover rejects %j", async (props, code) => {
  await expect(mount(popover(props as Partial<PopoverProps>))).rejects.toMatchObject({ code });
});

test("tab view renders native tabs in order, sized to the reported content area", async () => {
  await mount(tabView({ testID: "tabs", tabPosition: "bottom" }, [React.createElement(React.Fragment, { key: "f" }, React.createElement(Tab, { id: "a", label: "A", testID: "tab-a" }, "Alpha"), null, false), React.createElement(Tab, { key: "b", id: "b", label: "B" }, "Beta")]));
  const host = native("SparkTabView");
  expect(host.props).toMatchObject({ selectedId: "a", eventCount: 0, tabPosition: "bottom", tabBorder: "bezel", testID: "tabs" });
  let tabs = rendered.root.findAllByType("SparkTab");
  expect(tabs.map((tab: any) => [tab.props.tabId, tab.props.label, tab.props.children])).toEqual([["a", "A", "Alpha"], ["b", "B", "Beta"]]);
  expect(tabs[0].props.testID).toBe("tab-a");
  expect(tabs[0].props.style).toEqual({ position: "absolute", left: 0, top: 0, width: 0, height: 0, overflow: "hidden" });
  await act(async () => host.props.onTabViewContentLayout({ nativeEvent: { width: 480, height: 254 } }));
  tabs = rendered.root.findAllByType("SparkTab");
  expect(tabs[1].props.style).toMatchObject({ width: 480, height: 254 });
  await update(tabView({ tabPosition: "none", tabBorder: "line" }));
  expect(native("SparkTabView").props).toMatchObject({ tabPosition: "none", tabBorder: "line" });
});

test("tab selection is controlled: every native count is echoed, including vetoed selections", async () => {
  const onSelectionChange = vi.fn(), onError = vi.fn();
  await mount(tabView({ onSelectionChange, onError }));
  const select = (id: unknown, eventCount: unknown) => act(async () => native("SparkTabView").props.onTabViewSelectionChange({ nativeEvent: { id, eventCount } }));
  await select("b", 1);
  expect(onSelectionChange).toHaveBeenCalledWith({ id: "b" });
  // The parent did not adopt "b": selectedId stays "a" and the echoed count lets native restore it.
  expect(native("SparkTabView").props).toMatchObject({ selectedId: "a", eventCount: 1 });
  await select("b", 1);
  expect(onSelectionChange).toHaveBeenCalledTimes(1);
  await select("zzz", 2);
  expect(native("SparkTabView").props.eventCount).toBe(2);
  expect(onError.mock.calls[0][0]).toMatchObject({ code: "E_INVALID_DATA" });
  await select("b", "3");
  expect(onError.mock.calls[1][0]).toMatchObject({ code: "E_INVALID_DATA" });
  await act(async () => native("SparkTabView").props.onTabViewContentLayout({ nativeEvent: { width: -1, height: 2 } }));
  expect(onError.mock.calls[2][0]).toMatchObject({ code: "E_INVALID_DATA" });
  await update(tabView({ onSelectionChange, onError, selectedId: "b" }));
  expect(native("SparkTabView").props.selectedId).toBe("b");
});

test.each([
  [{ selectedId: "missing" }, undefined, "E_INVALID_ARGUMENT"],
  [{ onSelectionChange: undefined }, undefined, "E_INVALID_ARGUMENT"],
  [{ tabPosition: "left" }, undefined, "E_INVALID_ARGUMENT"],
  [{ tabBorder: "thick" }, undefined, "E_INVALID_ARGUMENT"],
  [{ tabBorder: "line" }, undefined, "E_UNSUPPORTED_OPTION"],
  [{}, [React.createElement("View", { key: "v" })], "E_INVALID_ARGUMENT"],
  [{}, [React.createElement(Tab, { key: "1", id: "a", label: "A" }), React.createElement(Tab, { key: "2", id: "a", label: "B" })], "E_INVALID_ARGUMENT"],
  [{}, [React.createElement(Tab, { key: "1", id: "a", label: "" })], "E_INVALID_ARGUMENT"],
] as const)("tab view rejects %j", async (props, children, code) => {
  await expect(mount(tabView(props as Partial<TabViewProps>, children))).rejects.toMatchObject({ code });
});

test("a Tab outside a TabView throws, and the tab view ref measures", async () => {
  await expect(mount(React.createElement(Tab, { id: "a", label: "A" }))).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const ref = createRef<any>();
  await mount(tabView({ ref }));
  const measured = vi.fn();
  ref.current.measureInWindow(measured);
  expect(measured).toHaveBeenCalledWith(0, 0, 100, 30);
});
