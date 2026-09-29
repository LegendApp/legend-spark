import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const mocks = vi.hoisted(() => ({ watch: vi.fn(), requests: vi.fn(), createMenu: vi.fn(), app: new Map<string, Set<(event: any) => void>>() }));
vi.mock("@legendapp/spark-file-system", () => ({ watch: mocks.watch }));
vi.mock("../packages/documents/src/requests", () => ({ subscribeToOpenRequests: mocks.requests }));
vi.mock("@legendapp/spark-native-menu", () => ({ createMenu: mocks.createMenu }));
vi.mock("@legendapp/spark-desktop-app", () => ({ addAppListener: (type: string, listener: (event: any) => void) => {
  let listeners = mocks.app.get(type); if (!listeners) mocks.app.set(type, listeners = new Set());
  listeners.add(listener); return { remove: () => listeners.delete(listener) };
} }));
import { useDocumentAppController, useWatchedDocumentReload, type DocumentAppControllerState, type UseDocumentAppControllerOptions } from "../packages/documents/src/hooks";
let rendered: any;
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.app.clear(); mocks.watch.mockReset().mockResolvedValue({ remove: vi.fn(async () => {}) });
  mocks.requests.mockReset().mockResolvedValue({ remove: vi.fn() });
  mocks.createMenu.mockReset().mockResolvedValue({ update: vi.fn(async () => {}), remove: vi.fn(async () => {}) });
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); vi.useRealTimers(); });

test("document hook owns a controller under Strict Mode, keeps callbacks fresh and observes its state", async () => {
  const first = vi.fn(), second = vi.fn(), initial = vi.fn(), reportError = vi.fn(), menus: [] = [];
  let state!: DocumentAppControllerState;
  const root = (handler: () => void) => React.createElement(StrictMode, null, React.createElement(Root, { handler }));
  function Root({ handler }: { handler: () => void }) {
    state = useDocumentAppController({ ownerId: "editor", windowId: "main", menus, onMenuAction: action => { if (action.itemId === "open") handler(); }, onInitialOpen: initial, reportError });
    return React.createElement("State", { open: state.status === "ready" && state.controller.isDocumentWindowOpen() });
  }
  await act(async () => { rendered = create(root(first)); });
  expect(mocks.createMenu).toHaveBeenCalledTimes(1); expect(initial).toHaveBeenCalledTimes(1); expect(state.status).toBe("ready");
  await act(async () => { rendered.update(root(second)); });
  mocks.createMenu.mock.calls[0][0].onAction({ itemId: "open" }); expect(second).toHaveBeenCalledTimes(1); expect(first).not.toHaveBeenCalled();
  if (state.status !== "ready") throw Error("Expected readiness");
  const controller = state.controller;
  await act(async () => controller.setDocumentWindowOpen(true)); expect(rendered.root.findByType("State").props.open).toBe(true);
  await act(async () => rendered.unmount()); expect((await mocks.createMenu.mock.results[0].value).remove).toHaveBeenCalledTimes(1);
  expect(() => controller.setDocumentWindowOpen(false)).toThrow(/removed/); expect(reportError).not.toHaveBeenCalled();
});

test("unmount during controller setup releases a late menu without initializing the document", async () => {
  let resolve!: (menu: any) => void;
  const remove = vi.fn(async () => {}), onInitialOpen = vi.fn();
  mocks.createMenu.mockReturnValue(new Promise(r => { resolve = r; }));
  const options: UseDocumentAppControllerOptions = { ownerId: "editor", windowId: "main", menus: [], onInitialOpen, reportError: vi.fn() };
  function Root() { useDocumentAppController(options); return null; }
  await act(async () => { rendered = create(React.createElement(Root)); });
  await act(async () => rendered.unmount()); await act(async () => resolve({ remove, update: vi.fn() }));
  expect(remove).toHaveBeenCalledTimes(1); expect(onInitialOpen).not.toHaveBeenCalled();
});

test("reload hook disposes late watches and uses current callbacks without recreating the watch", async () => {
  vi.useFakeTimers(); const first = vi.fn(), second = vi.fn(), onError = vi.fn(), remove = vi.fn(async () => {});
  let resolve!: (watch: any) => void;
  mocks.watch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  function Root({ callback }: { callback: () => void }) { useWatchedDocumentReload({ path: "/draft", onReload: callback, onError }); return null; }
  await act(async () => { rendered = create(React.createElement(Root, { callback: first })); });
  await act(async () => rendered.unmount()); await act(async () => resolve({ remove })); expect(remove).toHaveBeenCalledTimes(1);
  const late = mocks.watch.mock.calls[0][1]; late(); await vi.advanceTimersByTimeAsync(100); expect(first).not.toHaveBeenCalled();
  await act(async () => { rendered = create(React.createElement(Root, { callback: first })); });
  await act(async () => rendered.update(React.createElement(Root, { callback: second })));
  mocks.watch.mock.calls[1][1](); await vi.advanceTimersByTimeAsync(100); await tick();
  expect(second).toHaveBeenCalledTimes(1); expect(mocks.watch).toHaveBeenCalledTimes(2); expect(onError).not.toHaveBeenCalled();
});

test("menu edits retain controller ownership and a failed cleanup reports the retryable handle", async () => {
  const remove = vi.fn().mockRejectedValueOnce(Error("busy")).mockResolvedValue(undefined), update = vi.fn(async () => {});
  mocks.createMenu.mockResolvedValue({ remove, update });
  const onCleanupError = vi.fn(), reportError = vi.fn(), initial = vi.fn();
  let state!: DocumentAppControllerState;
  function Root({ menus }: { menus: UseDocumentAppControllerOptions["menus"] }) {
    state = useDocumentAppController({ ownerId: "editor", windowId: "main", menus, onInitialOpen: initial, reportError, onCleanupError }); return null;
  }
  await act(async () => { rendered = create(React.createElement(Root, { menus: [] })); });
  const menus = [{ type: "submenu" as const, id: "file", label: "File", items: [] }];
  await act(async () => rendered.update(React.createElement(Root, { menus })));
  expect(update).toHaveBeenCalledExactlyOnceWith({ items: menus }); expect(mocks.createMenu).toHaveBeenCalledTimes(1);
  if (state.status !== "ready") throw Error("Expected readiness"); const controller = state.controller;
  await act(async () => rendered.unmount());
  expect(onCleanupError).toHaveBeenCalledWith(expect.objectContaining({ message: "busy" }), controller);
  await controller.remove(); expect(remove).toHaveBeenCalledTimes(2); expect(reportError).not.toHaveBeenCalled();
});

test("controller setup errors are exposed as hook state and reported", async () => {
  mocks.createMenu.mockRejectedValue(Error("menu failed")); const reportError = vi.fn();
  let state!: DocumentAppControllerState;
  function Root() { state = useDocumentAppController({ ownerId: "editor", windowId: "main", menus: [], onInitialOpen: vi.fn(), reportError }); return null; }
  await act(async () => { rendered = create(React.createElement(Root)); });
  expect(state).toMatchObject({ status: "error", error: expect.objectContaining({ message: "menu failed" }) });
  expect(reportError).toHaveBeenCalledTimes(1);
});

test("failed menu updates report once without triggering an error render loop", async () => {
  const update = vi.fn().mockRejectedValue(Error("invalid menu")), reportError = vi.fn();
  mocks.createMenu.mockResolvedValue({ update, remove: vi.fn(async () => {}) });
  let state!: DocumentAppControllerState;
  function Root() { state = useDocumentAppController({ ownerId: "editor", windowId: "main", menus: [], onInitialOpen: vi.fn(), reportError }); return null; }
  await act(async () => { rendered = create(React.createElement(Root)); });
  expect(state.status).toBe("ready"); expect(update).toHaveBeenCalledTimes(1); expect(reportError).toHaveBeenCalledTimes(1);
});


test("replacement retries failed cleanup before acquiring the next owner", async () => {
  const remove = vi.fn().mockRejectedValueOnce(Error("busy")).mockResolvedValue(undefined);
  mocks.createMenu.mockResolvedValue({ remove, update: vi.fn(async () => {}) });
  const onCleanupError = vi.fn(), reportError = vi.fn();
  let state!: DocumentAppControllerState;
  function Root({ ownerId }: { ownerId: string }) {
    state = useDocumentAppController({ ownerId, windowId: "main", menus: [], onInitialOpen: vi.fn(), reportError, onCleanupError }); return null;
  }
  await act(async () => { rendered = create(React.createElement(Root, { ownerId: "first" })); });
  await act(async () => rendered.update(React.createElement(Root, { ownerId: "second" })));
  expect(onCleanupError).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(2);
  expect(mocks.createMenu).toHaveBeenCalledTimes(2);
  expect(state.status).toBe("ready");
  expect(reportError).not.toHaveBeenCalled();
});
