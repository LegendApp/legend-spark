import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), listeners: new Set<(event: any) => void>(), platform: { OS: "macos" } }));
vi.mock("react-native", () => ({ Platform: mocks.platform, TurboModuleRegistry: { get: () => ({ call: mocks.call }) }, NativeEventEmitter: class { addListener(_: string, listener: (event: any) => void) { mocks.listeners.add(listener); return { remove: () => { mocks.listeners.delete(listener); } }; } } }));
import { getAppContext, addAppListener, beforeQuit, quit } from "../packages/desktop-app/src/api";
const tick = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function emit(event: any) { for (const listener of mocks.listeners) listener(event); }
function calls(method: string) { return mocks.call.mock.calls.filter(([name]) => name === method).map(([, json]) => JSON.parse(json)); }
beforeEach(() => { mocks.call.mockReset().mockResolvedValue("null"); mocks.listeners.clear(); });
test("app context validates the complete contract and exposes only owned metadata", async () => {
  for (const value of [null, {}, { projectId: "a", name: "App", version: "1", launchArguments: [], runtime: { mode: "dev", modules: [] } }]) {
    mocks.call.mockResolvedValue(JSON.stringify(value)); await expect(getAppContext()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  mocks.call.mockResolvedValue(JSON.stringify({ projectId: "a", name: "App", version: "1", launchArguments: ["app"], runtime: { mode: "dev", modules: { a: "1" }, internal: "secret" }, extra: true }));
  expect(await getAppContext()).toEqual({ projectId: "a", name: "App", version: "1", launchArguments: ["app"], runtime: { mode: "dev", modules: { a: "1" } } });
});
test("quit joins concurrent requests and waits for the native decision", async () => {
  let resolve!: (value: string) => void;
  mocks.call.mockImplementation(() => new Promise(done => { resolve = done; }));
  const first = quit(), second = quit(); expect(first).toBe(second);
  let done = false; void first.then(() => { done = true; }); await tick(); expect(done).toBe(false); expect(calls("quit")).toHaveLength(1);
  resolve('{"quitRequested":false,"reason":"vetoed"}'); await expect(first).resolves.toEqual({ quitRequested: false, reason: "vetoed" });
  mocks.call.mockResolvedValue('{"quitRequested":true}'); await expect(quit()).resolves.toEqual({ quitRequested: true });
  mocks.call.mockResolvedValue('null'); await expect(quit()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
test("live app events validate payloads and never expose guard protocol or unrelated events", () => {
  const listener = vi.fn(), registration = addAppListener("secondInstance", listener);
  emit({ type: "secondInstance" }); emit({ type: "beforeQuit", requestId: 1 }); emit({ type: "secondInstance", arguments: ["app", "file"], nativePrivate: true });
  expect(listener).toHaveBeenCalledExactlyOnceWith({ type: "secondInstance", arguments: ["app", "file"] }); registration.remove();
  emit({ type: "secondInstance", arguments: [] }); expect(listener).toHaveBeenCalledTimes(1);
  expect(() => addAppListener("beforeQuit" as never, () => {})).toThrow();
});
test("independent guards ignore other owners, duplicate requests and stale approvals", async () => {
  let finish!: (allow: boolean) => void;
  const handler = vi.fn(() => new Promise<boolean>(done => { finish = done; }));
  const first = await beforeQuit(handler), id = calls("quitGuard")[0].id;
  const secondHandler = vi.fn(() => true), second = await beforeQuit(secondHandler);
  emit({ type: "beforeQuit", guardId: id, requestId: 1 }); emit({ type: "beforeQuit", guardId: id, requestId: 1 }); await tick();
  expect(handler).toHaveBeenCalledTimes(1); expect(secondHandler).not.toHaveBeenCalled();
  await first.remove(); finish(true); await tick(); expect(calls("replyQuit").at(-1)).toMatchObject({ id, requestId: 1, allow: false });
  await second.remove(); expect(mocks.listeners.size).toBe(0);
});
test("removal stops callbacks immediately, joins concurrent cleanup and retries failure", async () => {
  const handler = vi.fn(() => true), guard = await beforeQuit(handler), id = calls("quitGuard")[0].id;
  mocks.call.mockRejectedValueOnce(Error("disable failed"));
  const first = guard.remove(); expect(guard.remove()).toBe(first);
  emit({ type: "beforeQuit", guardId: id, requestId: 1 }); expect(handler).not.toHaveBeenCalled();
  await expect(first).rejects.toMatchObject({ code: "E_NATIVE" }); await guard.remove();
  expect(calls("quitGuard").filter(call => !call.enabled)).toHaveLength(2);
});
test("failed guard creation retains orphan cleanup and retries it before the next quit", async () => {
  mocks.call.mockImplementation(async () => { throw Error("bridge failed"); });
  await expect(beforeQuit(() => true)).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(mocks.listeners.size).toBe(0);
  mocks.call.mockImplementation(async method => method === "quit" ? '{"quitRequested":true}' : 'null');
  await expect(quit()).resolves.toEqual({ quitRequested: true });
  expect(mocks.call.mock.calls.slice(-2).map(([method]) => method)).toEqual(["quitGuard", "quit"]);
});
