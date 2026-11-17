import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered } = vi.hoisted(() => ({ platform: { OS: "macos", Version: "26.0" }, registered: vi.fn(() => true) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View", Text: "Text" }));
vi.mock("../packages/ui/src/popover/PopoverNativeComponent", () => ({ default: "SparkPopover" }));
import { Popover, getPopoverAvailability } from "../packages/ui/src/popover";
let rendered: any;
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; registered.mockReturnValue(true);
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
const native = () => rendered.root.findByType("SparkPopover").props;
const content = React.createElement("Text", null, "Comment");
const layout = (width: number, height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });

test("the popover hosts its content as the second native child and shows once the content has a size", async () => {
  const onClose = vi.fn();
  await mount(React.createElement(Popover, { visible: false, content, onClose, edge: "trailing", behavior: "semitransient" }, React.createElement("Text", null, "Anchor")));
  expect(native()).toMatchObject({ visible: false, edge: "trailing", behavior: "semitransient", contentWidth: 0, contentHeight: 0, anchorWidth: 0 });
  expect(native().children.filter(Boolean)).toHaveLength(1);
  await act(async () => rendered.update(React.createElement(Popover, { visible: true, content, onClose, anchorRect: { x: 10, y: 2, width: 40, height: 14 } }, React.createElement("Text", null, "Anchor"))));
  const wrapper = native().children[1];
  expect(wrapper.props.style).toMatchObject({ position: "absolute" });
  expect(native()).toMatchObject({ visible: true, contentWidth: 0, anchorX: 10, anchorY: 2, anchorWidth: 40, anchorHeight: 14 });
  await act(async () => rendered.root.findAll((node: any) => typeof node.props.onLayout === "function")[0].props.onLayout(layout(280, 120)));
  expect(native()).toMatchObject({ visible: true, contentWidth: 280, contentHeight: 120 });
  await act(async () => native().onClose());
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => rendered.update(React.createElement(Popover, { visible: false, content, onClose }, React.createElement("Text", null, "Anchor"))));
  expect(native()).toMatchObject({ visible: false, contentWidth: 0, contentHeight: 0 });
});

test("invalid popover options throw, and other platforms keep the anchor and report E_UNSUPPORTED_PLATFORM", async () => {
  for (const props of [{ visible: "yes" }, { edge: "left" }, { behavior: "modal" }, { onClose: 1 }, { anchorRect: { x: 0, y: 0, width: -1, height: 1 } }, { anchorRect: { x: NaN, y: 0, width: 1, height: 1 } }]) {
    await expect(mount(React.createElement(Popover, { visible: true, content, ...props } as never))).rejects.toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  }
  platform.OS = "web"; const onError = vi.fn();
  expect(getPopoverAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await mount(React.createElement(Popover, { visible: true, content, onError }, React.createElement("Text", null, "Anchor")));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  expect(rendered.root.findAllByType("SparkPopover")).toHaveLength(0);
  expect(rendered.root.findByType("Text").props.children).toBe("Anchor");
});
