import { expect, test } from "vitest";
import { validateSession, validateVolume, validateMetadata } from "../packages/audio/src/media-types.ts";
import { createMediaSession } from "../packages/audio/src/media-session.web.ts";
test("media contracts reject invalid positions, operations and artwork", () => {
  for (const value of [-1, 2, NaN]) expect(() => validateVolume(value)).toThrow();
  for (const options of [{ position: NaN }, { duration: -1 }, { commands: ["delete"] }, { commands: ["play", "play"] }]) expect(() => validateSession(options as never)).toThrow();
  expect(() => validateMetadata({ artworkUrl: "javascript:alert(1)" })).toThrow();
});
test("browser media session replacement preserves owner and command routing", async () => {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldMetadata = Object.getOwnPropertyDescriptor(globalThis, "MediaMetadata");
  const handlers = new Map<string, Function | null>();
  const media = { metadata: null as any, playbackState: "none", setActionHandler: (name: string, fn: Function | null) => handlers.set(name, fn), setPositionState() {} };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaSession: media } });
  Object.defineProperty(globalThis, "MediaMetadata", { configurable: true, value: class { constructor(public value: unknown) {} } });
  try {
    const first = await createMediaSession({ metadata: { title: "First" }, commands: ["nextTrack"], onCommand: () => { throw new Error("Stale session called"); } });
    const stale = handlers.get("nexttrack")!;
    const commands: unknown[] = [];
    const second = await createMediaSession({ metadata: { title: "Second" }, commands: ["seekTo"], onCommand: command => commands.push(command) });
    stale({}); handlers.get("seekto")!({ seekTime: 12 });
    expect(commands).toEqual([{ command: "seekTo", position: 12 }]);
    await first.remove(); expect(media.metadata.value.title).toBe("Second");
    await expect(first.update({ position: 1 })).rejects.toThrow("replaced");
    await second.update({ metadata: null }); expect(media.metadata.value.title).toBeUndefined();
    await second.remove(); expect(media.metadata).toBeNull(); expect(handlers.get("seekto")).toBeNull();
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else delete (globalThis as any).navigator;
    if (oldMetadata) Object.defineProperty(globalThis, "MediaMetadata", oldMetadata); else delete (globalThis as any).MediaMetadata;
  }
});
