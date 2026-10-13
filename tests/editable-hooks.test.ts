import React, { act, StrictMode } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const source = vi.hoisted(() => ({ get: vi.fn(), listeners: new Set<(state: any) => void>() }));
vi.mock("../packages/desktop-app/src/editable", () => ({ getEditingState: source.get, onEditingState: (listener: (state: any) => void) => { source.listeners.add(listener); return { remove: () => source.listeners.delete(listener) }; } }));
import { useEditingState, type EditingHookState } from "../packages/desktop-app/src/editable-hooks";
let renderer: any, state: EditingHookState;
function Root() { state = useEditingState(); return null; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  source.listeners.clear(); source.get.mockReset();
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (renderer) await act(async () => { renderer.unmount(); renderer = undefined; }); vi.restoreAllMocks(); });
test("observes an app-owned session under Strict Mode and keeps newer events over a late snapshot", async () => {
  const pending: Array<(value: any) => void> = [];
  source.get.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  await act(async () => { renderer = create(React.createElement(StrictMode, null, React.createElement(Root))); });
  expect(source.listeners.size).toBe(1); expect(state.status).toBe("loading");
  await act(async () => { for (const listener of source.listeners) listener({ message: "Generating" }); });
  await act(async () => { for (const resolve of pending) resolve({ message: "Old snapshot" }); });
  expect(state).toEqual({ status: "ready", state: { message: "Generating" } });
  await act(async () => renderer.unmount()); expect(source.listeners.size).toBe(0);
});
test("reports setup failure and suppresses late snapshots after unmount", async () => {
  source.get.mockRejectedValue(new Error("Unavailable"));
  await act(async () => { renderer = create(React.createElement(Root)); });
  expect(state.status).toBe("error");
  await act(async () => renderer.unmount());
  let resolve!: (value: any) => void; source.get.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => { renderer = create(React.createElement(Root)); });
  await act(async () => renderer.unmount());
  await act(async () => resolve({ message: "Late" })); expect(state.status).toBe("loading"); expect(source.listeners.size).toBe(0);
});
