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
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
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

test("same-ID remount retries failed cleanup without requiring a callback handle", async () => {
  let attempts = 0;
  publish.mockImplementation(async () => { if (++attempts === 2) throw Error("Native cleanup failed"); });
  const onError = vi.fn();
  await act(async () => { rendered = create(React.createElement(Component, { id: "retry-remount", items, onError })); });
  expect(latest.status).toBe("ready");
  await act(async () => { rendered!.unmount(); rendered = undefined; });
  expect(attempts).toBe(2);
  expect(listeners.size).toBe(0);

  await act(async () => { rendered = create(React.createElement(Component, { id: "retry-remount", items, onError })); });
  expect(attempts).toBe(4); // retry the old removal, then publish the replacement
  expect(latest.status).toBe("ready");
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Native cleanup failed" }));
  expect(listeners.size).toBe(1);
});

test("a stale remount that cannot retry cleanup leaves the failed lifetime available", async () => {
  let attempts = 0;
  publish.mockImplementation(async () => { const attempt = ++attempts; if (attempt === 2 || attempt === 3) throw Error(`cleanup ${attempt} failed`); });
  const cleanupError = vi.fn(() => { throw Error("cleanup observer failed"); });
  const onError = vi.fn(() => { throw Error("error observer failed"); });
  await act(async () => { rendered = create(React.createElement(Component, { id: "retry-chain", items, onCleanupError: cleanupError, onError })); });
  await act(async () => { rendered!.unmount(); rendered = undefined; });
  expect(attempts).toBe(2);

  await act(async () => { rendered = create(React.createElement(Component, { id: "retry-chain", items, onCleanupError: cleanupError, onError })); });
  expect(attempts).toBe(3);
  expect(latest).toMatchObject({ status: "error", error: { message: "cleanup 3 failed" } });
  await act(async () => { rendered!.unmount(); rendered = undefined; });

  await act(async () => { rendered = create(React.createElement(Component, { id: "retry-chain", items })); });
  expect(attempts).toBe(5);
  expect(latest.status).toBe("ready");
  expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: "cleanup observer failed" }));
});

test("same-ID remount waits for deferred removal before creating its replacement", async () => {
  let finishRemoval!: () => void, attempts = 0;
  publish.mockImplementation(() => {
    if (++attempts === 2) return new Promise<void>(resolve => { finishRemoval = resolve; });
    return Promise.resolve();
  });
  await act(async () => { rendered = create(React.createElement(Component, { id: "deferred-remove", items })); });
  await act(async () => { rendered!.unmount(); rendered = create(React.createElement(Component, { id: "deferred-remove", items })); });
  expect(attempts).toBe(2);
  await act(async () => { finishRemoval(); });
  expect(attempts).toBe(3);
  expect(latest.status).toBe("ready");
});

test("a failed pending structural update still removes its menu on unmount", async () => {
  let finishCreation!: () => void, attempts = 0;
  publish.mockImplementation(() => {
    const attempt = ++attempts;
    if (attempt === 1) return new Promise<void>(resolve => { finishCreation = resolve; });
    if (attempt === 2) return Promise.reject(Error("structural update failed"));
    return Promise.resolve();
  });
  const onError = vi.fn();
  await act(async () => { rendered = create(React.createElement(Component, { id: "update-failure", items, onError })); });
  expect(latest.status).toBe("loading");
  await act(async () => { rendered!.update(React.createElement(Component, { id: "update-failure", items: [], onError })); });
  await act(async () => { finishCreation(); });
  expect(latest).toMatchObject({ status: "error", error: { message: "structural update failed" } });
  expect(attempts).toBe(2);

  await act(async () => { rendered!.unmount(); rendered = undefined; });
  expect(attempts).toBe(3);
  expect(JSON.parse(publish.mock.calls[2][0])).toEqual([]);
});

test("a later queued update can keep the menu ready after an initial update fails", async () => {
  const finishCreation = deferred<void>(), firstUpdate = deferred<void>();
  let attempts = 0;
  publish.mockImplementation(() => {
    const attempt = ++attempts;
    if (attempt === 1) return finishCreation.promise;
    if (attempt === 2) return firstUpdate.promise;
    return Promise.resolve();
  });
  const revised: UseMenuOptions["items"] = [{ type: "submenu", id: "edit", label: "Edit", items: [] }];
  const onError = vi.fn();
  await act(async () => { rendered = create(React.createElement(Component, { id: "queued-updates", items, onError })); });
  await act(async () => { rendered!.update(React.createElement(Component, { id: "queued-updates", items: [], onError })); });
  await act(async () => { finishCreation.resolve(); });
  expect(attempts).toBe(2);

  await act(async () => { rendered!.update(React.createElement(Component, { id: "queued-updates", items: revised, onError })); });
  firstUpdate.reject(Error("first update failed"));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  expect(attempts).toBe(3);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "first update failed" }));
  expect(latest.status).toBe("ready");
  if (latest.status === "ready") expect(latest.menu.id).toBe("queued-updates");

  await act(async () => { rendered!.unmount(); rendered = undefined; });
  expect(attempts).toBe(4);
  expect(JSON.parse(publish.mock.calls[3][0])).toEqual([]);
});

test("throwing onError during a structural update does not leak or poison cleanup", async () => {
  publish.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("structural update failed"));
  const onError = vi.fn(() => { throw Error("update observer failed"); });
  await act(async () => { rendered = create(React.createElement(Component, { id: "update-callback", items, onError })); });
  await act(async () => { rendered!.update(React.createElement(Component, { id: "update-callback", items: [], onError })); });
  expect(latest).toMatchObject({ status: "error", error: { message: "structural update failed" } });
  expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: "update observer failed" }));
  await act(async () => { rendered!.unmount(); rendered = undefined; });
  expect(JSON.parse(publish.mock.calls.at(-1)![0])).toEqual([]);
});

test("rapid A-B-C remounts carry a failed A owner until C can retry it", async () => {
  let attempts = 0, releaseB!: () => void;
  publish.mockImplementation(() => {
    const attempt = ++attempts;
    if (attempt === 2) return Promise.reject(Error("A unmount cleanup failed"));
    if (attempt === 3) return new Promise<void>((resolve, reject) => { releaseB = () => reject(Error("B retry failed")); });
    return Promise.resolve();
  });
  const onCleanupError = vi.fn();
  await act(async () => { rendered = create(React.createElement(Component, { id: "rapid-chain", items, onCleanupError })); });
  expect(latest.status).toBe("ready");
  await act(async () => { rendered!.unmount(); rendered = undefined; });
  expect(attempts).toBe(2);

  let b: any, c: any;
  await act(async () => { b = create(React.createElement(Component, { id: "rapid-chain", items, onCleanupError })); });
  expect(attempts).toBe(3);
  await act(async () => { b.unmount(); c = create(React.createElement(Component, { id: "rapid-chain", items, onCleanupError })); });
  releaseB();
  await act(async () => {});
  expect(attempts).toBe(5); // C retries A before publishing its own menu.
  expect(latest.status).toBe("ready");
  expect(JSON.parse(publish.mock.calls[3][0])).toEqual([]);
  expect(JSON.parse(publish.mock.calls[4][0])[0]._sparkOwner).toBeDefined();
  await act(async () => { c.unmount(); rendered = undefined; });
});

test("duplicate active hook owners cannot steal or dispose the registered menu", async () => {
  const firstAction = vi.fn(), duplicateAction = vi.fn(), onError = vi.fn();
  await act(async () => { rendered = create(React.createElement(Component, { id: "duplicate", items, onAction: firstAction })); });
  let duplicate: any;
  await act(async () => { duplicate = create(React.createElement(Component, { id: "duplicate", items, onAction: duplicateAction, onError })); });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
  await act(async () => { duplicate.unmount(); });
  expect(listeners.size).toBe(1);
  emit();
  expect(firstAction).toHaveBeenCalledTimes(1);
  expect(duplicateAction).not.toHaveBeenCalled();
  await act(async () => { rendered!.unmount(); rendered = undefined; });
  expect(listeners.size).toBe(0);
});

test("a throwing onError callback cannot poison a later setup for the same ID", async () => {
  publish.mockRejectedValueOnce(Error("menu publish failed"));
  const onError = vi.fn(() => { throw Error("error observer failed"); });
  await act(async () => { rendered = create(React.createElement(Component, { id: "setup-retry", items, onError })); });
  expect(latest).toMatchObject({ status: "error", error: { message: "menu publish failed" } });
  expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: "error observer failed" }));
  await act(async () => { rendered!.unmount(); rendered = create(React.createElement(Component, { id: "setup-retry", items })); });
  expect(latest.status).toBe("ready");
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
test("inline items across re-renders do not republish once ready", async () => {
  await act(async () => { rendered = create(React.createElement(Component, { id: "churn", items: [{ type: "submenu", id: "file", label: "File", items: [] }], onAction: () => {} })); });
  expect(latest.status).toBe("ready");
  const afterReady = publish.mock.calls.length;
  // The caller recreates the items/options literal on every render, exactly as `useMenu({ items: [...] })` does inline.
  for (let i = 0; i < 5; i++) await act(async () => { rendered!.update(React.createElement(Component, { id: "churn", items: [{ type: "submenu", id: "file", label: "File", items: [] }], onAction: () => {} })); });
  expect(publish.mock.calls.length).toBe(afterReady);
});
