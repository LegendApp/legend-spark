import { SparkError, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { instanceRecord } from "./instances";
import { keys, object } from "../validation";
import type { WindowInstance } from "./types";

/** Request types and their handlers' signatures, for example `{ getSelection(payload: { full: boolean }): { text: string } }`. */
export type WindowRequests = { [type: string]: (payload: any) => unknown };
/** Broadcast types and their payloads. */
export type WindowBroadcasts = { [type: string]: unknown };
/** The payload type of request `K`: its handler's first parameter. */
export type WindowRequestPayload<R extends WindowRequests, K extends keyof R> = Parameters<R[K]>[0];
/** The result type of request `K`: what its handler returns, awaited. */
export type WindowRequestResult<R extends WindowRequests, K extends keyof R> = Awaited<ReturnType<R[K]>>;
/** Answers one request type for one window. `from` is the sending window, or null for app code such as the main window. */
export type WindowRequestHandler<R extends WindowRequests, K extends keyof R> =
  (payload: WindowRequestPayload<R, K>, from: WindowInstance | null) => WindowRequestResult<R, K> | Promise<WindowRequestResult<R, K>>;
/** Receives broadcast `K`. `from` is the sending window, or null for app code. */
export type WindowBroadcastListener<B extends WindowBroadcasts, K extends keyof B> = (payload: B[K], from: WindowInstance | null) => void;
/** Options for `WindowMessages.request`. */
export interface WindowRequestOptions {
  /** The sending window, passed to the handler. */
  from?: WindowInstance;
  /** Rejects `E_TIMEOUT` when the handler has not settled by then. 1–2147483647 ms; defaults to 30000. */
  timeoutMs?: number;
}
/** Options for `WindowMessages.broadcast`. */
export interface WindowBroadcastOptions {
  /** The sending window: its own listeners are skipped. */
  from?: WindowInstance;
}
/** Options for `WindowMessages.addListener`. */
export interface WindowBroadcastListenerOptions {
  /** The listening window: the listener ends when it closes and skips that window's own broadcasts. */
  window?: WindowInstance;
}

/**
 * Typed messages between navigator windows that share the JavaScript runtime. Payloads and results
 * pass by reference within the one heap; nothing is serialized or copied. Code in an isolated runtime
 * has its own heap and cannot use this object.
 */
export interface WindowMessages<R extends WindowRequests, B extends WindowBroadcasts> {
  /**
   * Answers `type` requests sent to `window`. One handler per window and type (a second rejects
   * `E_BUSY`); it is removed when the window closes.
   */
  handle<K extends keyof R & string>(window: WindowInstance, type: K, handler: WindowRequestHandler<R, K>): Subscription;
  /**
   * Sends a request to one window and resolves its handler's result. Rejects `E_NOT_FOUND` when the
   * window has no handler for `type`, `E_CLOSED` when it has closed or closes first, `E_TIMEOUT`, or
   * with the handler's own error.
   */
  request<K extends keyof R & string>(window: WindowInstance, type: K, payload: WindowRequestPayload<R, K>, options?: WindowRequestOptions): Promise<WindowRequestResult<R, K>>;
  /**
   * Calls every listener for `type` now, in registration order, except those of the sending window, and
   * returns how many it called. A listener that throws is reported to `console.error`; the rest still run.
   */
  broadcast<K extends keyof B & string>(type: K, payload: B[K], options?: WindowBroadcastOptions): number;
  addListener<K extends keyof B & string>(type: K, listener: WindowBroadcastListener<B, K>, options?: WindowBroadcastListenerOptions): Subscription;
  /** Removes every handler and listener; pending requests reject `E_CLOSED`. */
  remove(): void;
}

const typePattern = /^[a-zA-Z0-9_.:-]{1,100}$/;
function messageType(type: unknown): asserts type is string {
  if (typeof type !== "string" || !typePattern.test(type)) throw new SparkError("E_INVALID_ARGUMENT", "Message types require 1–100 letters, numbers or _ . : -");
}
function liveWindow(window: unknown, name: string): WindowInstance {
  if (instanceRecord(window as WindowInstance).disposed) throw new SparkError("E_CLOSED", `The ${name} window has closed`);
  return window as WindowInstance;
}
function fn(value: unknown, name: string) {
  if (typeof value !== "function") throw new SparkError("E_INVALID_ARGUMENT", `Expected a ${name} function`);
}

type Listener = { type: string; listener: (payload: unknown, from: WindowInstance | null) => void; window?: WindowInstance };

/** Creates a typed request and broadcast channel between navigator windows in the shared JavaScript runtime. */
export function createWindowMessages<R extends WindowRequests = WindowRequests, B extends WindowBroadcasts = WindowBroadcasts>(): WindowMessages<R, B> {
  let handlers = new WeakMap<WindowInstance, Map<string, (payload: unknown, from: WindowInstance | null) => unknown>>();
  const listeners = new Set<Listener>(), pending = new Set<(error: SparkError) => void>();
  /** Detaches every close callback this object added to a window, for remove(). */
  const detaches = new Set<() => void>();
  let removed = false;
  const live = () => { if (removed) throw new SparkError("E_CLOSED", "Window messages were removed"); };
  /** Runs `cleanup` when the window closes; the returned function cancels that. */
  const whenClosed = (window: WindowInstance, cleanup: () => void) => {
    const { closeListeners } = instanceRecord(window);
    const run = () => { detaches.delete(detach); cleanup(); };
    const detach = () => { detaches.delete(detach); closeListeners.delete(run); };
    closeListeners.add(run); detaches.add(detach);
    return detach;
  };

  return {
    handle(window, type, handler) {
      live(); liveWindow(window, "handling"); messageType(type); fn(handler, "request handler");
      let byType = handlers.get(window);
      if (!byType) handlers.set(window, byType = new Map());
      if (byType.has(type)) throw new SparkError("E_BUSY", `Window ${window.id} already handles ${type}`);
      const entry = handler as (payload: unknown, from: WindowInstance | null) => unknown;
      byType.set(type, entry);
      const stop = whenClosed(window, () => { byType.delete(type); });
      return { remove() { stop(); if (byType.get(type) === entry) byType.delete(type); } };
    },
    request(window, type, payload, options = {}) {
      try {
        live(); liveWindow(window, "receiving"); messageType(type);
        object(options, "request options"); keys(options, ["from", "timeoutMs"]);
        if (options.from !== undefined) liveWindow(options.from, "sending");
        const timeoutMs = options.timeoutMs ?? 30000;
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new SparkError("E_INVALID_ARGUMENT", "timeoutMs must be an integer from 1 to 2147483647");
        const handler = handlers.get(window)?.get(type);
        if (!handler) throw new SparkError("E_NOT_FOUND", `Window ${window.id} has no ${type} handler`);
        return new Promise((resolve, reject) => {
          const fail = (error: unknown) => { finish(); reject(error); };
          const closed = () => fail(new SparkError("E_CLOSED", `Window ${window.id} closed before answering ${type}`));
          const stop = whenClosed(window, closed);
          const timer = setTimeout(() => fail(new SparkError("E_TIMEOUT", `Window ${window.id} did not answer ${type} within ${timeoutMs} ms`)), timeoutMs);
          const finish = () => { clearTimeout(timer); stop(); pending.delete(fail); };
          pending.add(fail);
          // Always asynchronous: a handler never runs inside its caller's stack.
          Promise.resolve().then(() => handler(payload, options.from ?? null)).then(result => { finish(); resolve(result as WindowRequestResult<R, typeof type>); }, fail);
        });
      } catch (error) { return Promise.reject(error); }
    },
    broadcast(type, payload, options = {}) {
      live(); messageType(type);
      object(options, "broadcast options"); keys(options, ["from"]);
      if (options.from !== undefined) liveWindow(options.from, "sending");
      let delivered = 0;
      for (const entry of [...listeners]) {
        if (entry.type !== type || !listeners.has(entry) || (entry.window && entry.window === options.from)) continue;
        delivered++;
        try { entry.listener(payload, options.from ?? null); } catch (error) { console.error(error); }
      }
      return delivered;
    },
    addListener(type, listener, options = {}) {
      live(); messageType(type); fn(listener, "broadcast listener");
      object(options, "listener options"); keys(options, ["window"]);
      const entry: Listener = { type, listener: listener as Listener["listener"], window: options.window && liveWindow(options.window, "listening") };
      listeners.add(entry);
      const stop = entry.window ? whenClosed(entry.window, () => { listeners.delete(entry); }) : () => {};
      return { remove() { stop(); listeners.delete(entry); } };
    },
    remove() {
      if (removed) return;
      removed = true; listeners.clear(); handlers = new WeakMap();
      for (const fail of [...pending]) fail(new SparkError("E_CLOSED", "Window messages were removed"));
      for (const detach of [...detaches]) detach();
    },
  };
}
