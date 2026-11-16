import { expect, test } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { limitFileStore, installMetroCacheLimit } = require("../packages/cli/src/metro-cache-limit.cjs");

test("metro-cache FileStore reads and writes run with bounded concurrency, subclasses included", async () => {
  let active = 0, peak = 0;
  const tick = () => new Promise(resolve => setTimeout(resolve, 1));
  class Base {
    #values = new Map<string, number>();
    async get(key: string) { active++; peak = Math.max(peak, active); await tick(); active--; return this.#values.get(key) ?? null; }
    async set(key: string, value: number) { active++; peak = Math.max(peak, active); await tick(); active--; this.#values.set(key, value); }
  }
  class Subclass extends Base { async set(key: string, value: number) { return super.set(key, value * 2); } }
  limitFileStore(Base, 8);
  limitFileStore(Base, 8);
  const store = new Subclass();
  await Promise.all(Array.from({ length: 100 }, (_, i) => store.set(`k${i}`, i)));
  expect(await Promise.all(Array.from({ length: 100 }, (_, i) => store.get(`k${i}`)))).toEqual(Array.from({ length: 100 }, (_, i) => i * 2));
  expect(peak).toBe(8);
  class Failing { async get() { throw new Error("EIO"); } async set() {} }
  limitFileStore(Failing, 1);
  await expect(new Failing().get()).rejects.toThrow("EIO");
  expect(await new Failing().set()).toBeUndefined();
});

test("the limit installs on the app's metro-cache FileStore", () => {
  expect(installMetroCacheLimit(path.join(import.meta.dirname, "../examples/kitchen-sink"))).toBe(true);
  const FileStore = createRequire(path.join(import.meta.dirname, "../examples/kitchen-sink/package.json"))("metro-cache/private/stores/FileStore");
  expect((FileStore.default ?? FileStore).prototype.get.sparkLimited).toBe(true);
});
