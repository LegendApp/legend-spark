import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered } = vi.hoisted(() => ({ platform: { OS: "macos" }, registered: vi.fn(() => true) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View" }));
const { commands } = vi.hoisted(() => ({ commands: { completePromisedFile: vi.fn() } }));
vi.mock("../packages/drag-drop/src/DesktopDragViewNativeComponent", () => ({ default: "DesktopDragView", Commands: commands }));
import { DragDropView, getDragDropAvailability, type DragDropViewProps } from "../packages/drag-drop/src/index";
import * as contracts from "../packages/drag-drop/src/contracts";
let rendered: any;
const event = (value: unknown) => ({ nativeEvent: { json: JSON.stringify(value) } });
async function mount(props: DragDropViewProps) { await act(async () => { rendered = create(React.createElement(StrictMode, null, React.createElement(DragDropView, props, "Child")), { createNodeMock: () => ({ nativeView: true }) }); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; registered.mockReturnValue(true); commands.completePromisedFile.mockReset();
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
test("each drag view render normalizes its source once", async () => {
  const normalize = vi.spyOn(contracts, "dragSource");
  await act(async () => { rendered = create(React.createElement(DragDropView, { source: { files: ["file:///tmp/a%20b"] } })); });
  expect(normalize).toHaveBeenCalledTimes(1);
  expect(JSON.parse(rendered.root.findByType("DesktopDragView").props.sourceJson).files).toEqual(["/tmp/a b"]);
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

test("features report availability per platform; unknown features are invalid", () => {
  for (const feature of ["promisedFiles", "springLoading", "dragImage", "operationMasks"] as const) expect(getDragDropAvailability(feature)).toEqual({ available: true });
  platform.OS = "windows";
  expect(getDragDropAvailability()).toEqual({ available: true });
  for (const feature of ["promisedFiles", "springLoading", "dragImage", "operationMasks"] as const) expect(getDragDropAvailability(feature)).toEqual({ available: false, reason: "unsupported-platform" });
  expect(() => getDragDropAvailability("thumbnails" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});
test("unsupported features throw a typed error when rendered on Windows", async () => {
  platform.OS = "windows";
  const errors: unknown[] = [];
  class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error: unknown) { errors.push(error); }
    render() { return this.state.failed ? null : this.props.children; }
  }
  for (const props of [{ springLoading: true }, { dragImage: "view" as const }, { ignoreModifierKeys: true }, { source: { promisedFiles: [{ name: "a.txt" }] }, onPromisedFileWrite: () => {} }]) {
    errors.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { rendered = create(React.createElement(Boundary, null, React.createElement(DragDropView, props))); });
    expect(errors[0]).toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await act(async () => { rendered.unmount(); rendered = undefined; });
  }
});
test("promised files need a writer; each request is answered once, with the failure when the writer throws", async () => {
  await expect(mount({ source: { promisedFiles: [{ name: "a.txt" }] } })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const written: unknown[] = [], onError = vi.fn();
  let fail = false;
  await mount({ source: { promisedFiles: [{ name: "a.txt" }] }, onError, onPromisedFileWrite: async request => { written.push(request); if (fail) throw new Error("disk full"); } });
  const native = rendered.root.findByType("DesktopDragView");
  expect(JSON.parse(native.props.sourceJson)).toEqual({ promisedFiles: [{ name: "a.txt" }] });
  await act(async () => native.props.onPromisedFileWrite(event({ id: 7, name: "a.txt", path: "/tmp/drop/a.txt" })));
  expect(written).toEqual([{ name: "a.txt", path: "/tmp/drop/a.txt" }]);
  expect(commands.completePromisedFile).toHaveBeenCalledWith({ nativeView: true }, 7, "");
  fail = true;
  await act(async () => native.props.onPromisedFileWrite(event({ id: 8, name: "a.txt", path: "/tmp/drop/a.txt" })));
  expect(commands.completePromisedFile).toHaveBeenLastCalledWith(expect.anything(), 8, "disk full");
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNAVAILABLE" }));
  await act(async () => native.props.onPromisedFileWrite(event({ id: "x" })));
  expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
  expect(commands.completePromisedFile).toHaveBeenCalledTimes(2);
});
test("spring loading and its highlight reach the current callbacks; native timeouts keep their code", async () => {
  const onSpringLoad = vi.fn(), onSpringLoadHighlight = vi.fn(), onError = vi.fn();
  await mount({ springLoading: true, onSpringLoad, onSpringLoadHighlight, onError });
  const native = rendered.root.findByType("DesktopDragView");
  expect(JSON.parse(native.props.optionsJson)).toMatchObject({ springLoading: true });
  native.props.onSpringLoadHighlight(event({ highlight: "standard" }));
  native.props.onSpringLoad({ nativeEvent: { json: "{}" } });
  expect(onSpringLoadHighlight).toHaveBeenCalledWith({ highlight: "standard" });
  expect(onSpringLoad).toHaveBeenCalledTimes(1);
  await act(async () => native.props.onError(event({ message: "The promised file a.txt was not written in time", unavailable: false, code: "E_TIMEOUT" })));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_TIMEOUT" }));
  await act(async () => native.props.onError(event({ message: "x", unavailable: false, code: "E_BOGUS" })));
  expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
});
