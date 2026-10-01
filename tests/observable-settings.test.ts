import { afterEach, expect, test, vi } from "vitest";
import { batch, internal } from "@legendapp/state";
import { createObservableFile, createObservableSettings } from "../packages/settings/src/storage";
import type { SettingsStorage } from "../packages/settings/src/store";
const path = "/data/settings.json";
function fixture(text?: string) {
  const values = new Map<string, string>(text === undefined ? [] : [[path, text]]);
  const storage: SettingsStorage = {
    read: vi.fn(async key => values.get(key)),
    write: vi.fn(async (key, value) => { values.set(key, value); }),
    remove: vi.fn(async key => { values.delete(key); }),
  };
  return { values, storage };
}
const number = (value: unknown) => { if (typeof value !== "number") throw new Error("Expected number"); return value; };
afterEach(() => vi.useRealTimers());

test.each(["{broken", "", "undefined", '"wrong shape"'])("load failure preserves %j and never saves defaults", async text => {
  const { values, storage } = fixture(text);
  await expect(createObservableFile({ path, storage, initialValue: 1, decode: number, saveDefault: true })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(values.get(path)).toBe(text);
  expect(storage.write).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
});

test("missing uses a copied default; null, false, zero and empty string roundtrip", async () => {
  for (const value of [null, false, 0, ""]) {
    const { storage, values } = fixture();
    const file = await createObservableFile<unknown>({ path, storage, initialValue: value, decode: value => value, saveDefault: true });
    expect(values.get(path)).toBe(JSON.stringify(value));
    await file.close();
    const loaded = await createObservableFile({ path, storage, initialValue: 99, decode: value => value });
    expect(loaded.value$.peek()).toBe(value); await loaded.close();
  }
  const initialValue = { count: 1 }, { storage } = fixture();
  const file = await createObservableFile({ path, storage, initialValue, decode: value => value as typeof initialValue });
  initialValue.count = 5; expect(file.value$.count.peek()).toBe(1); await file.close();
});

test("flush snapshots synchronous changes including batches and preserves debounce afterwards", async () => {
  vi.useFakeTimers();
  const { storage, values } = fixture();
  const file = await createObservableFile({ path, storage, initialValue: 0, decode: number, debounceMs: 100 });
  let flush!: Promise<void>;
  batch(() => { file.value$.set(1); flush = file.flush(); file.value$.set(2); });
  await flush; expect(values.get(path)).toBe("1");
  await vi.advanceTimersByTimeAsync(99); expect(values.get(path)).toBe("1");
  await vi.advanceTimersByTimeAsync(1); expect(values.get(path)).toBe("2");
  file.value$.set(3); await vi.advanceTimersByTimeAsync(99); expect(values.get(path)).toBe("2");
  await vi.advanceTimersByTimeAsync(1); expect(values.get(path)).toBe("3");
  await file.close();
});

test("writes serialize across async transforms and capture values before waiting", async () => {
  const { storage, values } = fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const file = await createObservableFile({ path, storage, initialValue: { count: 0 }, decode: value => value as {count: number},
    encode: async value => { if (value.count === 1) await gate; return value; } });
  file.value$.count.set(1); const first = file.flush();
  file.value$.count.set(2); const second = file.flush();
  release(); await Promise.all([first, second]);
  expect(vi.mocked(storage.write).mock.calls.map(call => call[1])).toEqual(['{"count":1}', '{"count":2}']);
  expect(values.get(path)).toBe('{"count":2}'); await file.close();
});

test("without an encoder, flush writes its isolated serialized snapshot without reparsing", async () => {
  const { storage, values } = fixture();
  const file = await createObservableFile({ path, storage, initialValue: { count: 0 }, decode: value => value as { count: number } });
  const parse = vi.spyOn(internal, "safeParse");
  try {
    file.value$.count.set(1);
    const flushed = file.flush();
    file.value$.count.set(2);
    await flushed;
    expect(values.get(path)).toBe('{"count":1}');
    expect(parse).not.toHaveBeenCalled();
    await file.close();
  } finally { parse.mockRestore(); }
});

test("automatic failures are observable and an explicit flush retries them", async () => {
  vi.useFakeTimers(); const { storage, values } = fixture();
  vi.mocked(storage.write).mockRejectedValueOnce(new Error("disk full"));
  const file = await createObservableFile({ path, storage, initialValue: 0, decode: number, debounceMs: 10 });
  file.value$.set(1); await vi.advanceTimersByTimeAsync(10);
  expect(file.error$.peek()?.message).toBe("disk full"); expect(values.has(path)).toBe(false);
  await file.flush(); expect(values.get(path)).toBe("1"); expect(file.error$.peek()).toBeUndefined();
  await file.close();
});

test("close joins, retries a failed final snapshot, and stops observing immediately", async () => {
  const { storage, values } = fixture();
  vi.mocked(storage.write).mockRejectedValueOnce(new Error("disk full"));
  const file = await createObservableFile({ path, storage, initialValue: 0, decode: number });
  file.value$.set(1); const closing = file.close(); expect(file.close()).toBe(closing);
  file.value$.set(2); await expect(closing).rejects.toThrow("disk full");
  await file.close(); expect(values.get(path)).toBe("1");
  file.value$.set(3); await file.close(); expect(values.get(path)).toBe("1");
  await expect(file.flush()).rejects.toMatchObject({ code: "E_CLOSED" });
});

test("root undefined deletes while null writes and Legend Date/Map/Set encoding survives", async () => {
  const { storage, values } = fixture();
  const file = await createObservableFile<object | null | undefined>({ path, storage, initialValue: {}, decode: value => { if (value !== undefined && value !== null && typeof value !== "object") throw new Error("Expected object"); return value; } });
  const value = { date: new Date("2025-01-01T00:00:00Z"), map: new Map([["key", 3]]), set: new Set([1,2]) };
  file.value$.set(value); await file.flush(); await file.close();
  const restored = await createObservableFile<object | null | undefined>({ path, storage, initialValue: {}, decode: value => { if (value !== undefined && value !== null && typeof value !== "object") throw new Error("Expected object"); return value; } });
  expect(restored.value$.peek()).toEqual(value);
  restored.value$.set(null); await restored.flush(); expect(values.get(path)).toBe("null");
  restored.value$.set(undefined); await restored.flush(); expect(values.has(path)).toBe(false); await restored.close();
});

test("settings validate each present field, preserve null, fill missing defaults and omit unknown fields", async () => {
  const { storage } = fixture('{"count":3,"nullable":null,"extra":true}');
  const file = await createObservableSettings({ path, storage, fields: {
    count: { defaultValue: 0, decode: number },
    missing: { defaultValue: 2, decode: number },
    nullable: { defaultValue: 1 as number | null, decode: value => value === null ? null : number(value) },
  } });
  expect(file.value$.peek()).toEqual({ count: 3, missing: 2, nullable: null }); await file.close();
});

test("invalid arguments reject without touching storage", async () => {
  const { storage } = fixture();
  const options = { path, storage, initialValue: 0, decode: number };
  for (const patch of [{ path: "relative.json" }, { debounceMs: -1 }, { decode: undefined }, { unused: true }]) {
    await expect(createObservableFile({ ...options, ...patch } as never)).rejects.toBeInstanceOf(Error);
  }
  expect(storage.read).not.toHaveBeenCalled();
});
