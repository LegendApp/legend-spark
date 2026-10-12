import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const mocks = vi.hoisted(() => ({ addWindowListener: vi.fn(), app: new Map<string, Set<(event: any) => void>>(), roots: new Map<string, () => React.ComponentType<any>>(), openWindow: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, AppRegistry: { registerComponent: (name: string, factory: () => React.ComponentType<any>) => mocks.roots.set(name, factory) } }));
vi.mock("../packages/desktop-windows/src/api", () => ({ addWindowListener: mocks.addWindowListener, openWindow: mocks.openWindow, closeWindow: vi.fn(), showWindow: vi.fn() }));
vi.mock("@legendapp/spark-desktop-app", () => ({ addAppListener: (type: string, listener: (event: any) => void) => { let listeners = mocks.app.get(type); if (!listeners) mocks.app.set(type, listeners = new Set()); listeners.add(listener); return { remove: () => listeners.delete(listener) }; } }));
import { usePrimaryWindowLifecycle } from "../packages/desktop-windows/src/windows/usePrimaryWindowLifecycle";
import { useWindowFocusEffect } from "../packages/desktop-windows/src/windows/useWindowFocusEffect";
import { WindowProvider } from "../packages/desktop-windows/src/windows/WindowProvider";
let rendered: any;
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.addWindowListener.mockReset().mockResolvedValue({ remove: vi.fn(async () => {}) }); mocks.openWindow.mockReset(); mocks.app.clear();
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
function appEvent(type: string, event: object) { mocks.app.get(type)?.forEach(listener => listener(event)); }
test("primary lifecycle initializes once under Strict Mode and follows reopened instances with fresh callbacks", async () => {
  const initial = vi.fn(), reopen = vi.fn(), first = vi.fn(), second = vi.fn(), error = vi.fn();
  function Root({ closed }: { closed: () => void }) { usePrimaryWindowLifecycle({ windowId: "main", onInitialOpen: initial, onReopenRequested: reopen, onWindowClosed: closed, onError: error }); return null; }
  await mount(React.createElement(StrictMode, null, React.createElement(Root, { closed: first })));
  expect(initial).toHaveBeenCalledTimes(1);
  appEvent("windowClosed", { windowId: "other" }); appEvent("windowClosed", { windowId: "main" }); expect(first).toHaveBeenCalledTimes(1);
  await act(async () => rendered.update(React.createElement(StrictMode, null, React.createElement(Root, { closed: second }))));
  await act(async () => { appEvent("reopen", { hasVisibleWindows: false }); }); expect(reopen).toHaveBeenCalledTimes(1);
  appEvent("windowClosed", { windowId: "main" }); expect(second).toHaveBeenCalledTimes(1);
  await act(async () => rendered.unmount()); appEvent("windowClosed", { windowId: "main" }); expect(second).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
});
test("focus hooks dispose registrations arriving after unmount and use current handlers", async () => {
  let finish!: (value: any) => void; const first = vi.fn(), second = vi.fn(), remove = vi.fn(async () => {});
  mocks.addWindowListener.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  function Root({ callback }: { callback: () => void }) { useWindowFocusEffect(callback); return null; }
  const element = (callback: () => void) => React.createElement(WindowProvider, { id: "editor", children: React.createElement(Root, { callback }) });
  await mount(element(first)); const listener = mocks.addWindowListener.mock.calls[0][2];
  await act(async () => rendered.update(element(second))); listener({ focused: false }); listener({ focused: true }); expect(second).toHaveBeenCalledTimes(1); expect(first).not.toHaveBeenCalled();
  await act(async () => rendered.unmount()); await act(async () => finish({ remove })); listener({ focused: true }); expect(remove).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
});
