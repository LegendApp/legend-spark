import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface SettingsStorage {
  read(key: string): Promise<string | undefined>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface SettingsStoreOptions { storage: SettingsStorage }
export interface SettingsReadOptions<T> { decode(value: Json): T }
export interface SettingsStore {
  get(key: string): Promise<Json | undefined>;
  get<T>(key: string, options: SettingsReadOptions<T>): Promise<T | undefined>;
  set(key: string, value: Json): Promise<void>;
  remove(key: string): Promise<void>;
  update<T extends Json>(key: string, updater: (value: Json | undefined) => T | Promise<T>): Promise<T>;
}
function jsonSnapshot(value: unknown, ancestors = new Set<object>()): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || !value || ancestors.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new SparkError("E_INVALID_ARGUMENT", "Settings must contain finite JSON values without cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Array.from(value, item => jsonSnapshot(item, ancestors));
    if (Object.getOwnPropertySymbols(value).length) throw new SparkError("E_INVALID_ARGUMENT", "Settings cannot have symbol keys");
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSnapshot(item, ancestors)]));
  } finally { ancestors.delete(value); }
}
const serialize = (value: Json) => JSON.stringify(jsonSnapshot(value));
/** This store serializes operations per key. It does not lock other stores/processes.
 * Updaters must not await another operation on the same key in this store. */
export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected settings store options");
  if (Object.keys(options).some(key => key !== "storage")) throw new SparkError("E_UNSUPPORTED_OPTION", "Unsupported settings store option");
  const { storage } = options;
  if (!storage || [storage.read, storage.write, storage.remove].some(method => typeof method !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected read/write/remove storage methods");
  const pending = new Map<string, Promise<unknown>>();
  async function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (typeof key !== "string" || !key.length || key.length > 200 || key.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "Setting keys must contain 1–200 characters without NUL");
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
    pending.set(key, next);
    void next.finally(() => { if (pending.get(key) === next) pending.delete(key); }).catch(() => {});
    return next;
  }
  async function read(key: string): Promise<Json | undefined> {
    const value = await storage.read(key);
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new SparkError("E_INVALID_DATA", "Storage reads must return text or undefined");
    try { return jsonSnapshot(JSON.parse(value)); }
    catch (cause) { throw new SparkError("E_INVALID_DATA", "Stored settings are not valid JSON", { cause }); }
  }
  async function get(key: string): Promise<Json | undefined>;
  async function get<T>(key: string, options: SettingsReadOptions<T>): Promise<T | undefined>;
  async function get<T>(key: string, options?: SettingsReadOptions<T>): Promise<Json | T | undefined> {
    if (options !== undefined && (!options || typeof options.decode !== "function" || Object.keys(options).some(key => key !== "decode"))) throw new SparkError("E_INVALID_ARGUMENT", "Expected a settings decoder");
    return enqueue(key, async () => { const value = await read(key); return value === undefined || !options ? value : options.decode(value); });
  }
  return {
    get,
    async set(key, value) { const json = serialize(value); await enqueue(key, () => storage.write(key, json)); },
    async remove(key) { await enqueue(key, () => storage.remove(key)); },
    async update(key, updater) {
      if (typeof updater !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a settings updater");
      return enqueue(key, async () => {
        const value = await updater(await read(key));
        await storage.write(key, serialize(value)); return value;
      });
    },
  };
}
