import { observable, type Observable } from "@legendapp/state";
import { SparkError, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { instanceRecord, isClosedWindow, jsonCopy, restorableStates, windowStates, type StateSeed, type WindowStateInternals } from "./instances";
import type { WindowInstance } from "./types";

export interface WindowStateOptions<T> {
  initial: (window: WindowInstance) => T;
  /**
   * Makes each window's private value part of its navigator's session under this key: `getSession`
   * saves it (it must be JSON), `restoreSession` starts the window with it, and value changes notify
   * `subscribeToSession`. One live state per key.
   */
  restorationKey?: string;
}
/**
 * A value with two scopes. Each navigator window starts with a private value, freed with that window;
 * `promote` turns it into an app-scoped value by key, and `attach` binds another window to that value.
 * A window opened by `duplicate` starts attached to the same app value, or with a copy of a restorable
 * private value. Calls for a closed window reject `E_CLOSED`.
 */
export interface WindowState<T> {
  /** The window's binding: its private value (created on first access) or its attached app value. */
  get(window: WindowInstance): Observable<T>;
  /** The app key bound to the window, or null while it uses its private value. */
  getBinding(window: WindowInstance): string | null;
  /** Moves the window's private value to app scope under `key`, keeping the observable's identity. */
  promote(window: WindowInstance, key: string): Observable<T>;
  /** Creates an app-scoped value. Rejects E_ALREADY_EXISTS for a live key. */
  share(key: string, value: T): Observable<T>;
  /** Binds the window to an app-scoped value, discarding its private value. */
  attach(window: WindowInstance, key: string): Observable<T>;
  getShared(key: string): Observable<T> | undefined;
  /** Deletes an app-scoped value. E_BUSY while an open window is attached to it. */
  release(key: string): void;
  /** Notifies when the window's binding changes (promote/attach), not on value changes. */
  subscribe(window: WindowInstance, listener: () => void): Subscription;
  /** Drops every value and frees the restoration key. */
  remove(): void;
}

const keyPattern = /^[a-zA-Z0-9_.:-]{1,200}$/;
function validKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !keyPattern.test(key)) throw new SparkError("E_INVALID_ARGUMENT", "State keys require 1–200 letters, numbers or _ . : -");
}

export function createWindowState<T>(options: WindowStateOptions<T>): WindowState<T> {
  if (!options || typeof options.initial !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected an initial(window) function");
  const { initial, restorationKey } = options;
  if (restorationKey !== undefined) {
    validKey(restorationKey);
    if (restorableStates.has(restorationKey)) throw new SparkError("E_ALREADY_EXISTS", `A window state already uses the restoration key ${restorationKey}`);
  }
  // Keyed by window instance, so a later window reusing an ID never sees an earlier window's value.
  let own = new WeakMap<WindowInstance, Observable<T>>(), listeners = new WeakMap<WindowInstance, Set<() => void>>();
  const bindings = new Map<WindowInstance, string>(), shared = new Map<string, Observable<T>>();
  let removed = false;
  const notify = (window: WindowInstance) => {
    if (restorationKey !== undefined) instanceRecord(window).sessionChanged();
    for (const listener of [...listeners.get(window) ?? []]) listener();
  };
  const sharedValue = (key: string) => {
    const value = shared.get(key);
    if (!value) throw new SparkError("E_NOT_FOUND", `No shared state: ${key}`);
    return value;
  };
  const bind = (window: WindowInstance, key: string) => { own.delete(window); bindings.set(window, key); notify(window); };
  const ownValue = (window: WindowInstance, value: T) => {
    const result = observable(value) as Observable<T>;
    // A restorable value's edits change the window's session.
    if (restorationKey !== undefined) result.onChange(() => instanceRecord(window).sessionChanged());
    own.set(window, result);
    return result;
  };
  /** A window opened by restoreSession or duplicate starts from its seed, on first access. */
  const open = (window: WindowInstance) => {
    if (removed) throw new SparkError("E_CLOSED", "Window state was removed");
    if (isClosedWindow(window)) throw new SparkError("E_CLOSED", `Window ${window.id} has closed`);
    const seed = pending(window);
    // A released app value fails every access instead of quietly starting from initial().
    if (seed && "attach" in seed) sharedValue(seed.attach);
    if (seed) {
      const record = instanceRecord(window);
      record.seeds.delete(internals); if (restorationKey !== undefined) record.restored.delete(restorationKey);
      if ("attach" in seed) bindings.set(window, seed.attach); else ownValue(window, seed.value as T);
    }
    return window;
  };
  const get = (window: WindowInstance) => {
    open(window);
    const key = bindings.get(window);
    if (key !== undefined) return sharedValue(key);
    return own.get(window) ?? ownValue(window, initial(window));
  };
  /** The window's unconsumed seed: from duplicate, else its restored value. */
  const pending = (window: WindowInstance): StateSeed | undefined => {
    const { disposed, seeds, restored } = instanceRecord(window);
    if (disposed) return undefined;
    return seeds.get(internals) ?? (restorationKey !== undefined && restored.has(restorationKey) ? { value: restored.get(restorationKey) } : undefined);
  };
  const internals: WindowStateInternals = {
    restorationKey,
    snapshot(window) {
      if (restorationKey === undefined || removed) return undefined;
      const seed = pending(window);
      if (seed) return "value" in seed ? jsonCopy(seed.value, `Window state ${restorationKey}`) : undefined;
      const value = bindings.has(window) ? undefined : own.get(window);
      return value === undefined ? undefined : jsonCopy(value.peek(), `Window state ${restorationKey}`);
    },
    duplicate(window, detached) {
      if (removed) return undefined;
      const seed = pending(window);
      const key = seed ? ("attach" in seed ? seed.attach : undefined) : bindings.get(window);
      if (key !== undefined && !detached) return { attach: key };
      if (restorationKey === undefined) return undefined;
      if (seed && "value" in seed) return { value: jsonCopy(seed.value, `Window state ${restorationKey}`) };
      const value = key !== undefined ? shared.get(key) : own.get(window);
      return value === undefined ? undefined : { value: jsonCopy(value.peek(), `Window state ${restorationKey}`) };
    },
  };
  windowStates.add(internals);
  if (restorationKey !== undefined) restorableStates.set(restorationKey, internals);
  return {
    get,
    getBinding(window) { return bindings.get(open(window)) ?? null; },
    promote(window, key) {
      validKey(key);
      if (bindings.has(open(window))) throw new SparkError("E_BUSY", "This window already uses shared state");
      if (shared.has(key)) throw new SparkError("E_ALREADY_EXISTS", `Shared state already exists: ${key}`);
      const value = get(window);
      shared.set(key, value); bind(window, key);
      return value;
    },
    share(key, value) {
      if (removed) throw new SparkError("E_CLOSED", "Window state was removed");
      validKey(key);
      if (shared.has(key)) throw new SparkError("E_ALREADY_EXISTS", `Shared state already exists: ${key}`);
      const result = observable(value) as Observable<T>; shared.set(key, result); return result;
    },
    attach(window, key) {
      open(window); validKey(key);
      const value = sharedValue(key);
      if (bindings.get(window) !== key) bind(window, key);
      return value;
    },
    getShared(key) { validKey(key); return shared.get(key); },
    release(key) {
      validKey(key); sharedValue(key);
      for (const [window, bound] of bindings) {
        if (isClosedWindow(window)) bindings.delete(window);
        else if (bound === key) throw new SparkError("E_BUSY", `Windows are attached to shared state: ${key}`);
      }
      shared.delete(key);
    },
    subscribe(window, listener) {
      open(window);
      if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a binding listener");
      let set = listeners.get(window);
      if (!set) listeners.set(window, set = new Set());
      set.add(listener);
      return { remove() { set!.delete(listener); } };
    },
    remove() {
      removed = true; own = new WeakMap(); listeners = new WeakMap(); bindings.clear(); shared.clear();
      windowStates.delete(internals);
      if (restorationKey !== undefined && restorableStates.get(restorationKey) === internals) restorableStates.delete(restorationKey);
    },
  };
}
