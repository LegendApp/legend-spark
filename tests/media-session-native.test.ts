import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../packages/audio/src/NativeSparkAudio", () => ({ default: { call } }));
import { createMediaSession } from "../packages/audio/src/media-session";
beforeEach(() => { call.mockReset(); call.mockImplementation(async (method: string) => method === "sessionCommands" ? "[]" : "null"); });
afterEach(() => vi.useRealTimers());

test("session callbacks belong in creation options and seek commands require a position", async () => {
  const onCommand = vi.fn(), onError = vi.fn();
  call.mockImplementation(async (method: string) => method === "sessionCommands" ? '[{"command":"seekTo"}]' : "null");
  const session = await createMediaSession({ onCommand, onError });
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(onError.mock.calls[0][0]).toMatchObject({ code: "E_INVALID_DATA" }); expect(onCommand).not.toHaveBeenCalled();
  await session.remove();
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
