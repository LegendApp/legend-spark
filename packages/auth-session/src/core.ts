import { SparkError, asyncRegistration, nativeError } from "@legendapp/spark-desktop-app/src/contracts";
import { authorize, callbackMatches, timeout, validateRedirect, type AuthSession, type AuthSessionOptions, type AuthSessionResult } from "./types";
export type AuthTransport = {
  randomState(): Promise<string>;
  prepare(id: string, port: number, path: string): Promise<string>;
  subscribeLoopback(id: string, listener: (url: string) => void): Promise<{ remove(): void }>;
  close(id: string): Promise<void>;
  subscribe(listener: (url: string) => void): Promise<{ remove(): void }>;
  open(url: string): Promise<unknown>;
};
export function authSessions(transport: AuthTransport) {
  let busy = false, sequence = 0;
  let orphan: { remove(): Promise<void> } | undefined;
  return async function createAuthSession(options: AuthSessionOptions = {}): Promise<AuthSession> {
    const duration = timeout(options);
    options = { ...options };
    const requestedRedirect = options.redirectUri;
    let port = 0, path = "/auth/callback";
    const loopback = !requestedRedirect || validateRedirect(requestedRedirect).protocol === "http:";
    if (requestedRedirect) {
      const uri = validateRedirect(requestedRedirect);
      if (loopback) {
        if (uri.hostname !== "127.0.0.1" || !uri.port || !/^\/[a-zA-Z0-9/_-]*$/.test(uri.pathname)) throw new SparkError("E_INVALID_ARGUMENT", "Desktop HTTP callbacks require 127.0.0.1, an explicit port, and a plain path");
        port = Number(uri.port); path = uri.pathname;
      } else if (uri.protocol === "https:") throw new SparkError("E_UNSUPPORTED_OPTION", "Desktop callbacks require a loopback URI or registered application scheme");
    }
    if (orphan) { const previous = orphan; await previous.remove(); if (orphan === previous) orphan = undefined; }
    if (busy) throw new SparkError("E_BUSY", "An authentication session is already active");
    if (options.signal?.aborted) throw new SparkError("E_ABORTED", "Authentication was cancelled");
    busy = true;
    const started = Date.now(), id = `auth-${started}-${++sequence}`;
    let allocated = false, closed = false, opened = false, subscription: { remove(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    type Outcome = { value: AuthSessionResult; error?: unknown };
    let resolve!: (outcome: Outcome) => void;
    const result = new Promise<Outcome>(done => { resolve = done; });
    const readResult = async () => { const outcome = await result; if (outcome.error) throw outcome.error; return outcome.value; };
    const cleanup = asyncRegistration(() => {
      closed = true; clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
    }, async () => {
      try {
        subscription?.remove(); subscription = undefined;
        if (allocated) await transport.close(id);
        busy = false;
      } catch (error) { throw nativeError(error); }
    });
    const finish = async (value: AuthSessionResult, error?: unknown) => {
      if (closed) return;
      try { await cleanup.remove(); } catch (cause) { error ??= cause; }
      resolve({ value, error: error === undefined ? undefined : nativeError(error) });
    };
    const cancel = () => { void finish({ type: "cancel" }); };
    try {
      const state = await transport.randomState();
      let redirect = requestedRedirect!;
      const received = (url: string) => { if (opened && !closed && callbackMatches(url, redirect, state)) void finish({ type: "success", url }); };
      if (loopback) {
        subscription = await transport.subscribeLoopback(id, received);
        allocated = true; redirect = await transport.prepare(id, port, path);
      } else subscription = await transport.subscribe(received);
      options.signal?.addEventListener("abort", cancel, { once: true });
      const remaining = duration - (Date.now() - started);
      if (options.signal?.aborted) cancel();
      else if (remaining <= 0) void finish({ type: "timeout" });
      else timer = setTimeout(() => { void finish({ type: "timeout" }); }, remaining);
      return {
        state, redirectUri: redirect,
        async open(url) {
          if (opened) throw new SparkError("E_CLOSED", "Auth sessions can only be opened once");
          if (closed) return readResult();
          try {
            authorize(url, state, redirect); opened = true;
            // A slow browser launch must not suppress cancellation or callback delivery.
            const launch = transport.open(url).catch(async error => { await finish({ type: "dismiss" }, error); });
            await Promise.race([result, launch.then(() => result)]);
            return readResult();
          } catch (error) { await finish({ type: "dismiss" }, error); return readResult(); }
        },
        async dismiss() { if (!closed) { await finish({ type: "dismiss" }); await readResult(); } else await cleanup.remove(); },
      };
    } catch (error) {
      try { await cleanup.remove(); } catch { orphan = cleanup; }
      throw nativeError(error);
    }
  };
}
