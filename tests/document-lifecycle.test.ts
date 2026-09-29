import { beforeEach, afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  watch: vi.fn(), requests: vi.fn(), createMenu: vi.fn(),
  app: new Map<string, Set<(event: any) => void>>(),
}));
vi.mock("@legendapp/spark-file-system", () => ({ watch: mocks.watch }));
vi.mock("../packages/documents/src/requests", () => ({ subscribeToOpenRequests: mocks.requests }));
vi.mock("@legendapp/spark-native-menu", () => ({ createMenu: mocks.createMenu }));
vi.mock("@legendapp/spark-desktop-app", () => ({ addAppListener: (type: string, listener: (event: any) => void) => {
  let listeners = mocks.app.get(type); if (!listeners) mocks.app.set(type, listeners = new Set());
  listeners.add(listener); return { remove: () => listeners.delete(listener) };
} }));
import { watchDocumentReload } from "../packages/documents/src/reload";
import { createDocumentAppController, type DocumentAppControllerOptions } from "../packages/documents/src/controller";
import { createPrimaryWindowLifecycle } from "../packages/desktop-windows/src/windows/primaryWindowLifecycle";
const event = (type: string, payload: object) => mocks.app.get(type)?.forEach(listener => listener(payload));
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function options(): DocumentAppControllerOptions {
  return { ownerId: "editor", windowId: "main", menus: [], onInitialOpen: vi.fn(), onOpenDocument: vi.fn(), reportError: vi.fn() };
}
beforeEach(() => {
  mocks.app.clear(); mocks.watch.mockReset().mockResolvedValue({ remove: vi.fn(async () => {}) });
  mocks.requests.mockReset().mockResolvedValue({ remove: vi.fn() });
  mocks.createMenu.mockReset().mockResolvedValue({ update: vi.fn(async () => {}), remove: vi.fn(async () => {}) });
});
afterEach(() => { vi.useRealTimers(); });

test("imperative window lifecycle initializes, filters events, reports errors and stops queued callbacks", async () => {
  const initial = vi.fn(), reopen = vi.fn().mockRejectedValue(Error("reopen failed")), closed = vi.fn(), error = vi.fn();
  const registration = createPrimaryWindowLifecycle({ windowId: "main", onInitialOpen: initial, onReopenRequested: reopen, onWindowClosed: closed, onError: error });
  await tick(); expect(initial).toHaveBeenCalledTimes(1);
  event("windowClosed", { windowId: "other" }); expect(closed).not.toHaveBeenCalled();
  event("windowClosed", { windowId: "main" }); expect(closed).toHaveBeenCalledTimes(1);
  event("reopen", { hasVisibleWindows: true }); await tick(); expect(reopen).not.toHaveBeenCalled();
  event("reopen", { hasVisibleWindows: false }); await tick(); expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "reopen failed" }));
  event("reopen", { hasVisibleWindows: false }); registration.remove(); registration.remove();
  await tick(); expect(reopen).toHaveBeenCalledTimes(1); expect([...mocks.app.values()].every(value => !value.size)).toBe(true);
});

test("document reload debounces, filters, serializes and waits for an accepted reload on removal", async () => {
  vi.useFakeTimers();
  const running = deferred<void>(), onReload = vi.fn(() => running.promise), onError = vi.fn();
  let allowed = false;
  const registration = await watchDocumentReload({ path: "/draft", onReload, onError, shouldReload: () => allowed });
  const invalidate = mocks.watch.mock.calls[0][1];
  invalidate(); await vi.advanceTimersByTimeAsync(100); expect(onReload).not.toHaveBeenCalled();
  allowed = true; invalidate(); await vi.advanceTimersByTimeAsync(50); invalidate();
  await vi.advanceTimersByTimeAsync(99); expect(onReload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(onReload).toHaveBeenCalledTimes(1);
  invalidate(); await vi.advanceTimersByTimeAsync(100); expect(onReload).toHaveBeenCalledTimes(1);
  let removed = false; const removal = registration.remove().then(() => { removed = true; });
  await tick(); expect(removed).toBe(false);
  running.resolve(); await removal; await vi.advanceTimersByTimeAsync(1000);
  expect(onReload).toHaveBeenCalledTimes(1); expect(onError).not.toHaveBeenCalled();
});

test("reload failures are reported and cleanup retries without restarting callbacks", async () => {
  vi.useFakeTimers(); const remove = vi.fn().mockRejectedValueOnce(Error("busy")).mockResolvedValue(undefined);
  mocks.watch.mockResolvedValue({ remove });
  const onError = vi.fn(), onReload = vi.fn().mockRejectedValue(Error("read failed"));
  const registration = await watchDocumentReload({ path: "/draft", onReload, onError });
  const invalidate = mocks.watch.mock.calls[0][1]; invalidate(); await vi.advanceTimersByTimeAsync(100);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "read failed" }));
  await expect(registration.remove()).rejects.toThrow("busy"); invalidate(); await vi.advanceTimersByTimeAsync(100);
  await registration.remove(); expect(remove).toHaveBeenCalledTimes(2); expect(onReload).toHaveBeenCalledTimes(1);
  await expect(watchDocumentReload({ path: "/draft", delayMs: NaN, onReload, onError })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("document controller works without React and routes menus, open requests, window state and reopen", async () => {
  const opts = options(), action = vi.fn(), changed = vi.fn();
  opts.launchArguments = ["draft.txt"];
  opts.onMenuAction = (event, controller) => { if (event.itemId === "open") action(controller.isDocumentWindowOpen()); };
  const controller = createDocumentAppController(opts);
  const listener = controller.subscribe(changed);
  await controller.ready; await tick();
  expect(opts.onInitialOpen).toHaveBeenCalledWith(["draft.txt"], controller);
  controller.setDocumentWindowOpen(true); controller.setDocumentWindowOpen(true); expect(changed).toHaveBeenCalledTimes(1);
  mocks.createMenu.mock.calls[0][0].onAction({ itemId: "open" }); expect(action).toHaveBeenCalledWith(true);
  const open = mocks.requests.mock.calls[0][0];
  open({ id: "one", type: "url", url: "test:" }); open({ id: "two", type: "file", path: "/draft" }); open({ id: "two", type: "file", path: "/draft" });
  await tick(); expect(opts.onOpenDocument).toHaveBeenCalledExactlyOnceWith("/draft", controller);
  event("windowClosed", { windowId: "main" }); expect(controller.isDocumentWindowOpen()).toBe(false);
  event("reopen", { hasVisibleWindows: false }); await tick(); expect(opts.onInitialOpen).toHaveBeenLastCalledWith(undefined, controller);
  await controller.updateMenus([]); expect((await mocks.createMenu.mock.results[0].value).update).toHaveBeenCalledWith({ items: [] });
  listener.remove(); const calls = changed.mock.calls.length;
  await controller.remove(); open({ id: "late", type: "file", path: "/late" }); await tick();
  expect(opts.onOpenDocument).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(calls);
  expect(() => controller.setDocumentWindowOpen(true)).toThrow(/removed/);
});

test("controller removal during late menu creation releases all ownership and retries failed cleanup", async () => {
  const menu = deferred<any>(), remove = vi.fn().mockRejectedValueOnce(Error("busy")).mockResolvedValue(undefined);
  mocks.createMenu.mockReturnValue(menu.promise);
  const opts = options(), controller = createDocumentAppController(opts);
  await tick(); expect(mocks.createMenu).toHaveBeenCalledTimes(1);
  const first = controller.remove(); expect(controller.remove()).toBe(first);
  menu.resolve({ remove, update: vi.fn() }); await expect(first).rejects.toThrow("busy");
  await controller.remove(); expect(remove).toHaveBeenCalledTimes(2);
  expect(opts.onInitialOpen).not.toHaveBeenCalled();
  expect((await mocks.requests.mock.results[0].value).remove).toHaveBeenCalled();
});

test("controller setup failure releases document listeners and exposes the failure through readiness", async () => {
  mocks.createMenu.mockRejectedValue(Error("menu failed"));
  const controller = createDocumentAppController(options());
  await expect(controller.ready).rejects.toThrow("menu failed"); await controller.remove();
  expect((await mocks.requests.mock.results[0].value).remove).toHaveBeenCalled();
  const removed = createDocumentAppController(options()); await removed.remove();
  expect(mocks.createMenu).toHaveBeenCalledTimes(1);
});

test("reload never runs application code when native registration fails after an early invalidation", async () => {
  vi.useFakeTimers(); const onReload = vi.fn(), onError = vi.fn();
  mocks.watch.mockImplementation(async (_path, invalidate) => {
    invalidate(); await vi.advanceTimersByTimeAsync(1000); throw Error("watch failed");
  });
  await expect(watchDocumentReload({ path: "/draft", onReload, onError })).rejects.toThrow("watch failed");
  await vi.advanceTimersByTimeAsync(1000); expect(onReload).not.toHaveBeenCalled();
});

test("controller cancels pending document subscription setup and never creates a menu", async () => {
  const subscription = deferred<any>(), remove = vi.fn();
  mocks.requests.mockReturnValue(subscription.promise);
  const controller = createDocumentAppController(options()); await tick();
  const removal = controller.remove(); subscription.resolve({ remove }); await removal;
  expect(remove).toHaveBeenCalled(); expect(mocks.createMenu).not.toHaveBeenCalled();
});


test("async document menu failures reach the controller error handler", async () => {
  const opts = options(), error = Error("open failed");
  opts.onMenuAction = async () => { throw error; };
  const controller = createDocumentAppController(opts); await controller.ready;
  mocks.createMenu.mock.calls[0][0].onAction({ itemId: "open" }); await tick();
  expect(opts.reportError).toHaveBeenCalledExactlyOnceWith(error);
  await controller.remove();
});
