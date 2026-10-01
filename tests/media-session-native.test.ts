import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { call, listeners } = vi.hoisted(() => ({ call: vi.fn(), listeners: new Set<(value: unknown) => void>() }));
vi.mock("react-native", () => ({ NativeEventEmitter: class { addListener(_name: string, listener: (value: unknown) => void) { listeners.add(listener); return { remove() { listeners.delete(listener); } }; } } }));
vi.mock("../packages/audio/src/NativeSparkAudio", () => ({ default: { call } }));
import { createMediaSession } from "../packages/audio/src/media-session";
beforeEach(() => { listeners.clear(); call.mockReset(); call.mockResolvedValue("null"); });
afterEach(() => vi.useRealTimers());

test("session callbacks belong in creation options and seek commands require a position", async () => {
  const onCommand = vi.fn(), onError = vi.fn();
  const session = await createMediaSession({ onCommand, onError });
  const id = JSON.parse(call.mock.calls[0][1]).id;
  for (const listener of listeners) listener({ id, value: { command: "seekTo" } });
  expect(onError).toHaveBeenCalled();
  expect(onError.mock.calls[0][0]).toMatchObject({ code: "E_INVALID_DATA" }); expect(onCommand).not.toHaveBeenCalled();
  await session.remove();
});

test("native command events are delivered immediately without idle polling and stop on replacement", async () => {
  vi.useFakeTimers();
  const firstCommand = vi.fn(), secondCommand = vi.fn();
  const first = await createMediaSession({ onCommand: firstCommand });
  const firstID = JSON.parse(call.mock.calls[0][1]).id;
  const idleCalls = call.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(call).toHaveBeenCalledTimes(idleCalls); expect(vi.getTimerCount()).toBe(0);
  for (const listener of listeners) listener({ id: firstID, value: { command: "play" } });
  expect(firstCommand).toHaveBeenCalledWith({ command: "play" });
  const second = await createMediaSession({ onCommand: secondCommand });
  const secondID = JSON.parse(call.mock.calls.at(-1)![1]).id;
  for (const listener of listeners) listener({ id: firstID, value: { command: "pause" } });
  for (const listener of listeners) listener({ id: secondID, value: { command: "seekTo", position: 12 } });
  expect(firstCommand).toHaveBeenCalledTimes(1); expect(secondCommand).toHaveBeenCalledWith({ command: "seekTo", position: 12 });
  const removal = second.remove();
  expect(listeners.size).toBe(0);
  await removal; await first.remove();
});

test("commands received during native allocation are buffered until the new owner is ready", async () => {
  let release!: () => void, id = "";
  call.mockImplementation((method: string, json: string) => {
    if (method !== "sessionCreate") return Promise.resolve("null");
    id = JSON.parse(json).id;
    return new Promise(resolve => { release = () => resolve("null"); });
  });
  const onCommand = vi.fn(); const pending = createMediaSession({ onCommand });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  for (const listener of listeners) listener({ id, value: { command: "nextTrack" } });
  expect(onCommand).not.toHaveBeenCalled(); release();
  const session = await pending;
  expect(onCommand).toHaveBeenCalledWith({ command: "nextTrack" }); await session.remove();
});

test("failed native allocation releases its command subscription", async () => {
  call.mockRejectedValueOnce(new Error("allocation"));
  await expect(createMediaSession({ onCommand() {} })).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(listeners.size).toBe(0);
});

test("replacement invalidates old updates and old cleanup cannot remove the new owner", async () => {
  const first = await createMediaSession({ onCommand() {} });
  const second = await createMediaSession({ onCommand() {} });
  await expect(first.update({ position: 1 })).rejects.toMatchObject({ code: "E_CLOSED" });
  const count = call.mock.calls.filter(args => args[0] === "sessionRemove").length;
  await first.remove(); expect(call.mock.calls.filter(args => args[0] === "sessionRemove")).toHaveLength(count);
  await second.remove(); expect(call.mock.calls.filter(args => args[0] === "sessionRemove")).toHaveLength(count + 1);
});

test("removal stops commands immediately, joins attempts and retries native cleanup", async () => {
  let fail = true;
  call.mockImplementation(async (method: string) => {
    if (method === "sessionRemove" && fail) { fail = false; throw new Error("native busy"); }
    return method === "sessionCommands" ? "[]" : "null";
  });
  const session = await createMediaSession({ onCommand() {} });
  const removal = session.remove(); expect(session.remove()).toBe(removal);
  await expect(removal).rejects.toMatchObject({ code: "E_NATIVE" });
  await expect(session.update({ position: 2 })).rejects.toMatchObject({ code: "E_CLOSED" });
  await session.remove(); await session.remove();
  expect(call.mock.calls.filter(args => args[0] === "sessionRemove")).toHaveLength(2);
});

test("accepted updates snapshot fields, omit undefined and finish before cleanup", async () => {
  const session = await createMediaSession({ metadata: { title: "Original" }, onCommand() {} });
  const metadata = { title: "Before" }; const updating = session.update({ metadata, position: undefined }); metadata.title = "After";
  const removing = session.remove(); await Promise.all([updating, removing]);
  const updates = call.mock.calls.filter(args => args[0] === "sessionUpdate");
  expect(JSON.parse(updates[0][1])).toMatchObject({ metadata: { title: "Before" } });
  expect(JSON.parse(updates[0][1])).not.toHaveProperty("position");
  expect(call.mock.calls.at(-1)?.[0]).toBe("sessionRemove");
});

test("invalid creation options never allocate a session", async () => {
  for (const options of [{}, { onCommand: true }, { onCommand() {}, unknown: true }, { onCommand() {}, metadata: false }]) await expect(createMediaSession(options as never)).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
