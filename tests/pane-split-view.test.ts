import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform } = vi.hoisted(() => ({ platform: { OS: "macos", Version: "26.0" } }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: () => true }, View: "View" }));
vi.mock("../packages/ui/src/appkit-split-view/SplitViewNativeComponent", () => ({ default: "SparkSplitView" }));
import { SplitView, type SplitViewProps } from "../packages/ui/src/appkit-split-view/SplitView";

let rendered: ReturnType<typeof create>;
const panes = [
  { id: "files", content: "Files", initialSize: 120, minSize: 70, maxSize: 180 },
  { id: "detail", content: "Detail", minSize: 110 },
  { id: "status", content: "Status", initialSize: 90 },
];
const frame = (id: string, x: number, y: number, width: number, height: number) => ({ id, x, y, width, height });
const layout = (horizontal: boolean, panes: ReturnType<typeof frame>[], rightToLeft = false) => ({ nativeEvent: { horizontal, panes, rightToLeft } });
const native = () => rendered.root.findByType("SparkSplitView");
const wrappers = () => native().findAllByType("View").filter((element: { parent: unknown }) => element.parent === native());
const mount = (props: SplitViewProps) => act(async () => { rendered = create(React.createElement(SplitView, props)); });

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  platform.OS = "macos";
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args);
  });
});

afterEach(async () => {
  if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; });
  vi.restoreAllMocks();
});

test("pane frames drive Fabric layout and onResize reports only changes along the split axis", async () => {
  const onResize = vi.fn(), onError = vi.fn();
  await mount({ panes, onResize, onError });
  expect(native().props).toMatchObject({ horizontal: true, dividerStyle: "thin", panes: [
    { id: "files", initialSize: 120, minSize: 70, maxSize: 180 },
    { id: "detail", initialSize: -1, minSize: 110, maxSize: -1 },
    { id: "status", initialSize: 90, minSize: 0, maxSize: -1 },
  ] });
  const frames = [frame("files", 0, 0, 120, 300), frame("detail", 121, 0, 188, 300), frame("status", 310, 0, 90, 300)];
  await act(async () => native().props.onSplitViewLayout(layout(true, frames)));
  expect(wrappers()[1].props.style).toMatchObject({ start: 121, width: 188, height: 300 });
  await act(async () => native().props.onSplitViewLayout(layout(true, frames.map(value => ({ ...value, height: 240 })), true)));
  expect(wrappers()[1].props.style).toMatchObject({ end: 121, width: 188, height: 240 });
  expect(onResize.mock.calls).toEqual([[[120, 188, 90]]]);
  await act(async () => native().props.onSplitViewLayout(layout(true, [frame("files", 0, 0, NaN, 300)])));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
  expect(onResize).toHaveBeenCalledTimes(1);
});

test("reordering keyed panes preserves their content and discards stale native layouts", async () => {
  const mountCount = vi.fn();
  function Content() { React.useEffect(() => { mountCount(); }, []); return null; }
  const keyed = panes.map(pane => ({ ...pane, content: React.createElement(Content) }));
  const onResize = vi.fn();
  await mount({ panes: keyed, onResize });
  const next = [keyed[2], keyed[0]];
  await act(async () => rendered.update(React.createElement(SplitView, { panes: next, orientation: "vertical", dividerStyle: "thick", onResize })));
  expect(mountCount).toHaveBeenCalledTimes(3);
  expect(native().props).toMatchObject({ horizontal: false, dividerStyle: "thick" });
  await act(async () => native().props.onSplitViewLayout(layout(true, [frame("status", 0, 0, 90, 300), frame("files", 91, 0, 120, 300)])));
  await act(async () => native().props.onSplitViewLayout(layout(false, [frame("files", 0, 0, 400, 90), frame("status", 0, 91, 400, 120)])));
  expect(onResize).toHaveBeenCalledTimes(0);
  await act(async () => native().props.onSplitViewLayout(layout(false, [frame("status", 0, 0, 400, 90), frame("files", 0, 99, 400, 120)])));
  expect(wrappers()[1].props.style).toMatchObject({ top: 99, width: 400, height: 120 });
  expect(onResize.mock.calls).toEqual([[[90, 120]]]);
});

test("unsupported platforms render static panes using the requested axis and sizing", async () => {
  platform.OS = "windows";
  const onError = vi.fn(), onResize = vi.fn();
  await mount({ panes, orientation: "vertical", onError, onResize });
  expect(rendered.root.findAllByType("SparkSplitView")).toHaveLength(0);
  const [parent, files] = rendered.root.findAllByType("View");
  expect(parent.props.style[0]).toEqual({ flexDirection: "column" });
  expect(files.props.style).toMatchObject({ flexBasis: 120, minHeight: 70, maxHeight: 180 });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  expect(onResize).toHaveBeenCalledTimes(0);
});

test("split views reject invalid options before mounting native panes", async () => {
  for (const invalid of [
    { orientation: "diagonal" }, { dividerStyle: "dotted" }, { onResize: 1 },
    { panes: [panes[0], panes[0]] }, { panes: [{ ...panes[0], maxSize: 10 }] },
    { panes: [{ ...panes[0], initialSize: 300 }] }, { panes: [{ ...panes[0], minSize: -5 }] },
  ]) await expect(mount({ panes, ...invalid } as SplitViewProps)).rejects.toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});
