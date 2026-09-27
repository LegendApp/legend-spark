import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { publish, listeners } = vi.hoisted(() => ({ publish: vi.fn(), listeners: new Set<(event: unknown) => void>() }));
vi.mock("../packages/native-menu/src/NativeMenu", () => ({ default: { publish } }));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, NativeEventEmitter: class { addListener(_name: string, listener: (event: unknown) => void) { listeners.add(listener); return { remove() { listeners.delete(listener); } }; } } }));
import { useMenu, type MenuState, type UseMenuOptions } from "../packages/native-menu/src/hooks";
const items: UseMenuOptions["items"] = [{ type: "submenu", id: "file", label: "File", items: [{ type: "action", id: "open", label: "Open" }] }];
let latest: MenuState, rendered: { update(element: React.ReactElement): void; unmount(): void } | undefined;
function Component(options: UseMenuOptions) { latest = useMenu(options); return null; }
function emit() { const snapshot = JSON.parse(publish.mock.calls.at(-1)![0]); for (const listener of listeners) listener({ ownerId: snapshot[0]._sparkOwner, itemId: "open" }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  publish.mockReset(); publish.mockResolvedValue(undefined); listeners.clear();
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) { await act(async () => rendered!.unmount()); rendered = undefined; } vi.restoreAllMocks(); });
test("Strict Mode owns one live menu and callback changes do not republish", async () => {
  const first = vi.fn(), second = vi.fn();
  await act(async () => { rendered = create(React.createElement(StrictMode, null, React.createElement(Component, { id: "strict", items, onAction: first }))); });
  expect(latest.status).toBe("ready"); expect(publish).toHaveBeenCalledTimes(1); expect(listeners.size).toBe(1);
  await act(async () => { rendered!.update(React.createElement(StrictMode, null, React.createElement(Component, { id: "strict", items, onAction: second }))); });
  emit(); expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledWith({ type: "action", itemId: "open" }); expect(publish).toHaveBeenCalledTimes(1);
  await act(async () => { rendered!.unmount(); rendered = undefined; });
  expect(listeners.size).toBe(0); expect(JSON.parse(publish.mock.calls.at(-1)![0])).toEqual([]);
});
test("unmount during creation disposes the late menu before a same-ID remount", async () => {
  let finish!: () => void;
  publish.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const old = vi.fn(), next = vi.fn();
  await act(async () => { rendered = create(React.createElement(Component, { id: "late", items, onAction: old })); });
  expect(latest.status).toBe("loading");
  await act(async () => { rendered!.unmount(); rendered = create(React.createElement(Component, { id: "late", items, onAction: next })); });
  expect(publish).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(publish).toHaveBeenCalledTimes(3); expect(JSON.parse(publish.mock.calls[1][0])).toEqual([]); expect(latest.status).toBe("ready");
  emit(); expect(old).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledTimes(1);
});
test("structural changes update the same handle and cleanup failures expose it for retry", async () => {
  const onCleanupError = vi.fn();
  await act(async () => { rendered = create(React.createElement(Component, { id: "changes", items, onCleanupError })); });
  const first = latest;
  await act(async () => { rendered!.update(React.createElement(Component, { id: "changes", items: [], onCleanupError })); });
  expect(latest.status).toBe("ready"); if (first.status === "ready" && latest.status === "ready") expect(latest.menu).toBe(first.menu);
  publish.mockRejectedValueOnce(new Error("Native cleanup failed"));
  await act(async () => { rendered!.unmount(); rendered = undefined; });
  expect(onCleanupError).toHaveBeenCalledTimes(1); expect(listeners.size).toBe(0);
  await onCleanupError.mock.calls[0][1].remove();
});
