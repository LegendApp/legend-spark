import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered } = vi.hoisted(() => ({ platform: { OS: "macos" }, registered: vi.fn(() => true) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View" }));
vi.mock("../packages/drag-drop/src/DesktopDragViewNativeComponent", () => ({ default: "DesktopDragView" }));
import { DragDropView, getDragDropAvailability, type DragDropViewProps } from "../packages/drag-drop/src/index";
let rendered: any;
const event = (value: unknown) => ({ nativeEvent: { json: JSON.stringify(value) } });
async function mount(props: DragDropViewProps) { await act(async () => { rendered = create(React.createElement(StrictMode, null, React.createElement(DragDropView, props, "Child"))); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; registered.mockReturnValue(true);
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
test("component normalizes sources and emits owned payloads using current callbacks", async () => {
  const first = vi.fn(), second = vi.fn(), onError = vi.fn();
  await mount({ source: { files: ["file:///tmp/a%20b"] }, onDrop: first, onError });
  let native = rendered.root.findByType("DesktopDragView");
  expect(JSON.parse(native.props.sourceJson).files).toEqual(["/tmp/a b"]);
  const drop = event({ text: "Hello", x: 2, y: 3, operation: "copy", nativeField: true });
  native.props.onDrop(drop); expect(first).toHaveBeenCalledWith({ text: "Hello", x: 2, y: 3, operation: "copy" });
  await act(async () => rendered.update(React.createElement(StrictMode, null, React.createElement(DragDropView, { onDrop: second, onError }))));
  native = rendered.root.findByType("DesktopDragView"); native.props.onDrop(drop); expect(second).toHaveBeenCalledTimes(1);
  native.props.onDrop({ nativeEvent: { json: "invalid" } }); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
  const late = native.props.onDrop; await act(async () => { rendered.unmount(); rendered = undefined; }); late(drop); expect(second).toHaveBeenCalledTimes(1);
});
test.each(["unsupported-platform", "missing-module"])("unavailable %s preserves children and reports once in Strict Mode", async reason => {
  if (reason === "unsupported-platform") platform.OS = "ios"; else registered.mockReturnValue(false);
  expect(getDragDropAvailability()).toEqual({ available: false, reason });
  const onError = vi.fn(); await mount({ onError, testID: "fallback" });
  expect(rendered.root.findByType("View").children).toEqual(["Child"]);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0].code).toBe(reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE");
});
test("operation errors report without losing the view; host failures preserve child content", async () => {
  const onError = vi.fn(); await mount({ onError });
  const native = rendered.root.findByType("DesktopDragView");
  await act(async () => native.props.onError(event({ message: "No file", unavailable: false })));
  expect(rendered.root.findByType("DesktopDragView")).toBeDefined();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_NATIVE" }));
  await act(async () => native.props.onError(event({ message: "Missing host geometry", unavailable: true })));
  expect(rendered.root.findByType("View").children).toEqual(["Child"]);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNAVAILABLE" }));
});
