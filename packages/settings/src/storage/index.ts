import { internal, observable, type Observable } from "@legendapp/state";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { absolutePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import type { SettingsStorage } from "../store";
import { fileStorage } from "../fileStorage";

export interface ObservableFileOptions<T> {
  /** Absolute native path, including the extension. Parent directory must exist. */
  path: string;
  initialValue: T;
  /** Validate/convert persisted data. Missing files use initialValue. */
  decode(value: unknown): T | Promise<T>;
  /** Convert a snapshot for persistence. Omit to use Legend State serialization. */
  encode?(value: T): unknown | Promise<unknown>;
  storage?: SettingsStorage;
  debounceMs?: number;
  saveDefault?: boolean;
}
export interface ObservableFile<T> {
  /** Legend State owns this observable API. Mutations after close are not persisted. */
  value$: Observable<T>;
  /** Most recent persistence failure; cleared after a successful save. */
  error$: Observable<Error | undefined>;
  /** Save a snapshot of all changes made before this call, including inside batches. */
  flush(): Promise<void>;
  /** Stop automatic saves immediately and flush a final snapshot. Failed closes retry. */
  close(): Promise<void>;
}
function stringify(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  // Legend's helper returns falsy input unchanged. File storage always needs text.
  const text = value ? internal.safeStringify(value) : JSON.stringify(value);
  if (typeof text !== "string") throw new SparkError("E_INVALID_DATA", "Value cannot be serialized");
  return text;
}
function parse(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  if (typeof text !== "string" || text.length === 0) throw new SparkError("E_INVALID_DATA", "Expected serialized settings");
  return internal.safeParse(text);
}

/** Await readiness before editing. Load/decode failures preserve existing bytes.
 * Writes are serialized within this handle, not across handles or processes.
 * Root undefined removes the file; null is persisted. Date/Map/Set use Legend encoding.
 */
export async function createObservableFile<T>(options: ObservableFileOptions<T>): Promise<ObservableFile<T>> {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected observable file options");
  for (const key of Object.keys(options)) if (!["path", "initialValue", "decode", "encode", "storage", "debounceMs", "saveDefault"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported observable file option: ${key}`);
  const path = absolutePath(options.path, typeof options.path === "string" && options.path.startsWith("/") ? "macos" : "windows");
  const { decode, encode, storage = fileStorage, debounceMs = 300, saveDefault = false } = options;
  if (typeof decode !== "function" || (encode !== undefined && typeof encode !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected a decoder and optional encoder");
  if (!Number.isFinite(debounceMs) || debounceMs < 0 || debounceMs > 2147483647 || typeof saveDefault !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Invalid persistence timing options");
  if (!storage || [storage.read, storage.write, storage.remove].some(method => typeof method !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected read/write/remove storage methods");
  const text = await storage.read(path);
  let initial: T;
  try { initial = text === undefined ? parse(stringify(options.initialValue)) as T : await decode(parse(text)); }
  catch (cause) { throw new SparkError("E_INVALID_DATA", "Could not decode observable file", { cause }); }
  const value$ = observable(initial) as Observable<T>;
  const error$ = observable<Error | undefined>();
  const recordError = (error: unknown) => error$.set(error instanceof Error ? error : new SparkError("E_NATIVE", "Persistence failed", { cause: error }));
  let persisted = stringify(initial);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  let closing = false, closed = false;
  let closingSnapshot: string | undefined;
  let capturedClose = false;
  let closePromise: Promise<void> | undefined;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  function snapshot(): string | undefined { return stringify(value$.peek()); }
  function save(snapshotText: string | undefined, force = false): Promise<void> {
    const next = queue.catch(() => {}).then(async () => {
      if (force || persisted !== snapshotText) {
        const value = parse(snapshotText) as T;
        const output = stringify(encode ? await encode(value) : value);
        if (output === undefined) await storage.remove(path);
        else await storage.write(path, output);
        persisted = snapshotText;
      }
      error$.set(undefined);
    }).catch(error => { recordError(error); throw error; });
    queue = next;
    // Automatic writes report through error$; explicit callers still receive rejection.
    void next.catch(() => {});
    return next;
  }
  const unsubscribe = value$.onChange(() => {
    if (closing) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      try { void save(snapshot()); } catch (error) { recordError(error); }
    }, debounceMs);
  }, { immediate: true });
  const handle: ObservableFile<T> = {
    value$, error$,
    async flush() {
      if (closing) throw new SparkError("E_CLOSED", "Observable file is closing or closed");
      clearTimer();
      try { await save(snapshot()); } catch (error) { recordError(error); throw error; }
    },
    close() {
      if (closed) return Promise.resolve();
      if (closePromise) return closePromise;
      closing = true; clearTimer(); unsubscribe();
      // Capture synchronously, before consumers can mutate after calling close.
      try { if (!capturedClose) { closingSnapshot = snapshot(); capturedClose = true; } }
      catch (error) { recordError(error); return Promise.reject(error); }
      closePromise = save(closingSnapshot).then(() => { closed = true; }).finally(() => { closePromise = undefined; });
      return closePromise;
    },
  };
  if (saveDefault && text === undefined) {
    try { await save(persisted, true); }
    catch (error) { unsubscribe(); throw error; }
  }
  return handle;
}

export interface ObservableSettingsField<T> {
  defaultValue: T;
  decode(value: unknown): T;
}
export type ObservableSettingsFields = Record<string, ObservableSettingsField<any>>;
export type ObservableSettingsValues<F extends ObservableSettingsFields> = { [K in keyof F]: F[K] extends ObservableSettingsField<infer T> ? T : never };
export interface ObservableSettingsOptions<F extends ObservableSettingsFields> extends Omit<ObservableFileOptions<ObservableSettingsValues<F>>, "initialValue" | "decode" | "encode"> { fields: F }
/** Field defaults apply only to absent fields; stored null is passed to the decoder.
 * Unknown fields are omitted. Use value$.field directly with Legend State's useValue.
 */
export async function createObservableSettings<const F extends ObservableSettingsFields>(options: ObservableSettingsOptions<F>): Promise<ObservableFile<ObservableSettingsValues<F>>> {
  if (!options || !options.fields || typeof options.fields !== "object" || Array.isArray(options.fields)) throw new SparkError("E_INVALID_ARGUMENT", "Expected settings fields");
  const { fields, ...rest } = options;
  const entries = Object.entries(fields);
  if (entries.some(([, field]) => !field || typeof field.decode !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Each field requires a decoder");
  return createObservableFile({
    ...rest,
    initialValue: Object.fromEntries(entries.map(([key, field]) => [key, field.defaultValue])) as ObservableSettingsValues<F>,
    decode(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_DATA", "Expected a settings object");
      return Object.fromEntries(entries.map(([key, field]) => [key, Object.hasOwn(value, key) ? field.decode((value as Record<string, unknown>)[key]) : field.defaultValue])) as ObservableSettingsValues<F>;
    },
  });
}
