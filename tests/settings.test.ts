import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { createSettingsStore, type SettingsStorage } from "../packages/settings/src/store.ts";
function fixture() {
  const values = new Map<string, string>();
  const storage: SettingsStorage = { async read(key) { return values.get(key); }, async write(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); } };
  return { values, storage, store: createSettingsStore({ storage }) };
}
test("settings persist JSON, distinguish missing/false/empty, and remove keys", async () => {
  const { store } = fixture();
  expect(await store.get("absent")).toBeUndefined();
  for (const value of [false, 0, "", null, [1, "two"], { enabled: true }]) { await store.set("key", value); expect(await store.get("key")).toEqual(value); }
  await store.remove("key"); expect(await store.get("key")).toBeUndefined();
});
test("concurrent async updates serialize without losing writes", async () => {
  const { store } = fixture();
  await Promise.all(Array.from({ length: 50 }, () => store.update<number>("counter", async value => { await sleep(1); if (value !== undefined && typeof value !== "number") throw new Error("Invalid counter"); return (value ?? 0) + 1; })));
  expect(await store.get("counter")).toBe(50);
});
test("failed update does not poison queue or overwrite previous value", async () => {
  const { store } = fixture(); await store.set("key", 5);
  await expect(store.update("key", () => { throw new Error("cancel"); })).rejects.toThrow("cancel");
  expect(await store.update<number>("key", value => { if (typeof value !== "number") throw new Error("Invalid counter"); return value + 1; })).toBe(6);
});
test("invalid JSON values and cyclic values cannot silently corrupt settings", async () => {
  const { store } = fixture();
  for (const value of [undefined, NaN, Infinity, { bad: undefined }, () => {}, 1n, new Date(), new Map(), new Set(), Array(2)]) await expect(store.set("key", value as never)).rejects.toThrow();
  const circular: any = {}; circular.self = circular; await expect(store.set("key", circular)).rejects.toThrow();
  await expect(store.get("")).rejects.toThrow(); await expect(store.get("x".repeat(201))).rejects.toThrow();
});
test("corrupt on-disk JSON rejects, preserves bytes and can be explicitly replaced", async () => {
  const { store, values } = fixture(); values.set("key", "{broken");
  await expect(store.get("key")).rejects.toThrow(); expect(values.get("key")).toBe("{broken");
  await store.set("key", 42); expect(await store.get("key")).toBe(42);
});
test("independent keys do not block each other", async () => {
  const { store } = fixture(); let release!: () => void;
  const pending = store.update("slow", () => new Promise<number>(resolve => { release = () => resolve(1); }));
  await store.set("fast", true); expect(await store.get("fast")).toBe(true); release(); await pending;
});
test("storage failure is surfaced, and later writes recover", async () => {
  const { store, storage } = fixture(); const write = storage.write;
  storage.write = async () => { throw new Error("disk full"); };
  await expect(store.set("key", 1)).rejects.toThrow("disk full");
  storage.write = write; await store.set("key", 2); expect(await store.get("key")).toBe(2);
});

test("typed reads validate stored data through an explicit decoder", async () => {
  const { store } = fixture();
  const options = { decode(value: unknown) { if (typeof value !== "number") throw new Error("Expected a number"); return value; } };
  expect(await store.get("key", options)).toBeUndefined();
  await store.set("key", 3); expect(await store.get("key", options)).toBe(3);
  await store.set("key", null); await expect(store.get("key", options)).rejects.toThrow("Expected a number");
  expect(await store.get("key")).toBeNull();
});
test("queued sets snapshot input and allow shared acyclic references", async () => {
  const { store } = fixture();
  const shared = { value: 1 }; const input = { first: shared, second: shared };
  const write = store.set("key", input); shared.value = 9; await write;
  expect(await store.get("key")).toEqual({ first: { value: 1 }, second: { value: 1 } });
});
test("invalid storage results reject without overwriting them", async () => {
  const { store, storage } = fixture();
  storage.read = async () => null as never;
  await expect(store.get("key")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  storage.read = async () => "1e999";
  await expect(store.get("key")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  storage.read = async () => '{"nested":[1e999]}';
  await expect(store.get("key")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
