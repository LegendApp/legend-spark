import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const call = vi.fn();
  return { call, native: { call: (...args: unknown[]) => call(...args) }, listeners: new Set<(event: any) => void>() };
});
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => mocks.native }, NativeEventEmitter: class { addListener(_: string, listener: (event: any) => void) { mocks.listeners.add(listener); return { remove: () => { mocks.listeners.delete(listener); } }; } } }));
import { exposeTestState } from "../packages/desktop-app/src/test-state";
const tick = async () => { for (let n = 0; n < 5; n++) await Promise.resolve(); };
let request = 0;
/** Asks as the driver's `state` command does, and returns the app's answer. */
async function ask(path: unknown) {
  mocks.call.mockClear();
  const requestId = ++request;
  for (const listener of mocks.listeners) listener({ type: "driverState", requestId, path });
  await tick();
  const replies = mocks.call.mock.calls.filter(([method]) => method === "replyDriverState").map(([, json]) => JSON.parse(json));
  if (!replies.length) return undefined;
  expect(replies).toHaveLength(1);
  const { requestId: answered, ...rest } = replies[0];
  expect(answered).toBe(requestId);
  return rest;
}
beforeEach(() => { mocks.call.mockReset().mockResolvedValue("null"); });

test("exposed state answers driver requests by path: own properties, array indices and length, as JSON", async () => {
  let documents = { open: [{ title: "a.md", dirty: false }, { title: "b.md", dirty: true }] };
  const registration = exposeTestState("documents", () => documents);
  expect(await ask("documents.open.length")).toEqual({ value: 2 });
  expect(await ask("documents.open.1")).toEqual({ value: { title: "b.md", dirty: true } });
  expect(await ask("documents")).toEqual({ value: documents });
  // read runs on every request, so the answer is current.
  documents = { open: [] };
  expect(await ask("documents.open.length")).toEqual({ value: 0 });
  registration.remove();
});

test("missing names and keys, inherited properties, non-JSON values and read failures are typed errors", async () => {
  const first = exposeTestState("store", () => ({ items: [1], nothing: undefined, run() {} })), second = exposeTestState("other", () => { throw new Error("boom"); });
  expect(await ask("nope.x")).toEqual({ error: { code: "E_NOT_FOUND", message: "No test state named nope; exposed: store, other" } });
  expect(await ask("store.items.3")).toEqual({ error: { code: "E_NOT_FOUND", message: 'store.items has no "3"' } });
  expect(await ask("store.constructor")).toEqual({ error: { code: "E_NOT_FOUND", message: 'store has no "constructor"' } });
  expect(await ask("store.nothing")).toEqual({ error: { code: "E_INVALID_DATA", message: "store.nothing is not JSON data" } });
  expect(await ask("store.run")).toEqual({ error: { code: "E_INVALID_DATA", message: "store.run is not JSON data" } });
  expect(await ask("other")).toEqual({ error: { code: "E_STATE", message: "Reading test state other failed: boom" } });
  expect(await ask(3)).toBeUndefined();
  first.remove(); second.remove();
});

test("names are identifiers, exposed once; removing the last one stops listening, and removal is idempotent", async () => {
  expect(() => exposeTestState("a.b", () => 1)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => exposeTestState("a", 1 as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  const first = exposeTestState("a", () => 1);
  expect(() => exposeTestState("a", () => 2)).toThrow(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
  const second = exposeTestState("b", () => 2);
  first.remove(); first.remove();
  expect(mocks.listeners.size).toBe(1);
  expect(await ask("a")).toEqual({ error: { code: "E_NOT_FOUND", message: "No test state named a; exposed: b" } });
  second.remove();
  expect(mocks.listeners.size).toBe(0);
  expect(await ask("b")).toBeUndefined();
  const again = exposeTestState("a", () => 3);
  expect(await ask("a")).toEqual({ value: 3 });
  again.remove();
});

test("the desktop event hub answers the driver's listeners counter with its live subscriptions", async () => {
  const { onDesktopEvent } = await import("../packages/desktop-app/src/events");
  const count = async () => {
    mocks.call.mockClear();
    for (const listener of mocks.listeners) listener({ type: "driverListeners", requestId: 9 });
    await tick();
    return mocks.call.mock.calls.filter(([method]) => method === "replyDriverState").map(([, json]) => JSON.parse(json));
  };
  const feature = vi.fn(), first = onDesktopEvent(feature, { types: ["opened"] }), second = onDesktopEvent(feature);
  expect(await count()).toEqual([{ requestId: 9, value: 2 }]);
  expect(feature).not.toHaveBeenCalled();
  second.remove();
  expect(await count()).toEqual([{ requestId: 9, value: 1 }]);
  (globalThis as { __THREADED_RUNTIME_ENV__?: unknown }).__THREADED_RUNTIME_ENV__ = true;
  expect(await count()).toEqual([]);
  delete (globalThis as { __THREADED_RUNTIME_ENV__?: unknown }).__THREADED_RUNTIME_ENV__;
  first.remove();
});
