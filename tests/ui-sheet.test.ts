import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered } = vi.hoisted(() => ({ platform: { OS: "macos", Version: "26.0" }, registered: vi.fn(() => true) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View", Text: "Text" }));
vi.mock("../packages/ui/src/sheet/SheetNativeComponent", () => ({ default: "SparkSheet" }));
import { Sheet as SheetComponent, getSheetAvailability } from "../packages/ui/src/sheet";
const Sheet = SheetComponent as React.FC<any>;
let rendered: any;
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; registered.mockReturnValue(true);
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
const native = () => rendered.root.findByType("SparkSheet").props;
const form = React.createElement("Text", null, "New Branch");
const layout = (width: number, height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });

test("the sheet mounts its content while visible and shows it at the content's layout size", async () => {
  const onCancel = vi.fn();
  await mount(React.createElement(Sheet, { visible: false, onCancel }, form));
  expect(native()).toMatchObject({ visible: false, contentWidth: 0, contentHeight: 0 });
  expect(native().children).toBeFalsy();
  await act(async () => rendered.update(React.createElement(Sheet, { visible: true, onCancel }, form)));
  expect(native().children.props.style).toMatchObject({ position: "absolute" });
  await act(async () => rendered.root.findAll((node: any) => typeof node.props.onLayout === "function")[0].props.onLayout(layout(360, 180)));
  expect(native()).toMatchObject({ visible: true, contentWidth: 360, contentHeight: 180 });
  await act(async () => native().onCancel());
  expect(onCancel).toHaveBeenCalledTimes(1);
  await act(async () => rendered.update(React.createElement(Sheet, { visible: false, onCancel }, form)));
  expect(native()).toMatchObject({ visible: false, contentWidth: 0, contentHeight: 0 });
});

test("invalid sheet options throw, and other platforms render visible content inline and report E_UNSUPPORTED_PLATFORM", async () => {
  for (const props of [{ visible: "yes" }, { onCancel: 1 }]) await expect(mount(React.createElement(Sheet, { visible: true, ...props } as never, form))).rejects.toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  platform.OS = "web"; const onError = vi.fn();
  expect(getSheetAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await mount(React.createElement(Sheet, { visible: true, onError }, form));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  expect(rendered.root.findAllByType("SparkSheet")).toHaveLength(0);
  expect(rendered.root.findByType("Text").props.children).toBe("New Branch");
  await act(async () => rendered.update(React.createElement(Sheet, { visible: false, onError }, form)));
  expect(rendered.root.findAllByType("Text")).toHaveLength(0);
});
