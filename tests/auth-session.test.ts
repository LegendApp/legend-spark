import { setTimeout as sleep } from "node:timers/promises";
import { expect, test, vi } from "vitest";
import { authSessions, type AuthTransport } from "../packages/auth-session/src/core.ts";
import { authorize, callbackMatches } from "../packages/auth-session/src/types.ts";
function fixture(overrides: Partial<AuthTransport> = {}) {
  const closed: string[] = [], opened: string[] = [], callbacks: string[] = [];
  let receive: (url: string) => void = () => {};
  const create = authSessions({ randomState: async () => "unpredictable-state", prepare: async () => "http://127.0.0.1:12345/auth/callback",
    subscribeLoopback: async (_id, listener) => { receive = listener; return { remove() { receive = () => {}; } }; }, close: async id => { closed.push(id); },
    subscribe: async listener => { receive = listener; return { remove() { receive = () => {}; } }; },
    open: async url => { opened.push(url); }, ...overrides });
  return { create, closed, opened, callbacks, receive: (url: string) => receive(url) };
}
const authURL = (state: string) => `https://provider.example/authorize?state=${state}`;
test("auth rejects wrong state, duplicate state, wrong origins and paths", () => {
  const redirect = "http://127.0.0.1:12345/auth/callback";
  expect(callbackMatches(`${redirect}?code=secret&state=ok`, redirect, "ok")).toBe(true);
  for (const url of [`${redirect}?state=bad`, `${redirect}?state=ok&state=bad`, `${redirect}?state=ok#state=ok`, "http://127.0.0.1:54321/auth/callback?state=ok", `${redirect}/extra?state=ok`]) expect(callbackMatches(url, redirect, "ok")).toBe(false);
  expect(() => authorize("http://evil.example/?state=ok", "ok", redirect)).toThrow("HTTPS");
  expect(() => authorize("https://example.com/?state=bad", "ok", redirect)).toThrow("state");
});
test("loopback auth ignores invalid callbacks and cleans up after success", async () => {
  const f = fixture(), session = await f.create();
  await expect(f.create()).rejects.toThrow("already active");
  const result = session.open(authURL(session.state));
  f.receive(`${session.redirectUri}?state=bad`); f.receive(`${session.redirectUri}?code=code&state=${session.state}`);
  expect(await result).toEqual({ type: "success", url: `${session.redirectUri}?code=code&state=${session.state}` });
  expect(f.closed).toHaveLength(1); await session.dismiss(); expect(f.closed).toHaveLength(1);
  await expect(session.open(authURL(session.state))).rejects.toThrow("once");
  const next = await f.create(); await next.dismiss();
});
test("auth cancellation releases sockets even while browser launch is unresolved", async () => {
  const controller = new AbortController(); const f = fixture({ open: () => new Promise(() => {}) });
  const session = await f.create({ signal: controller.signal });
  const result = session.open(authURL(session.state)); controller.abort();
  expect(await result).toEqual({ type: "cancel" }); expect(f.closed).toHaveLength(1);
});
test("prepared auth expires, launch failure cleans up, schemes use matching URL events", async () => {
  const f = fixture(); const expired = await f.create({ timeoutMs: 5 }); await sleep(15);
  expect(await expired.open(authURL(expired.state))).toEqual({ type: "timeout" }); expect(f.closed).toHaveLength(1);
  const broken = fixture({ open: async () => { throw Error("No browser"); } });
  const bad = await broken.create(); await expect(bad.open(authURL(bad.state))).rejects.toThrow("No browser"); expect(broken.closed).toHaveLength(1);
  const scheme = await f.create({ redirectUri: "myapp://auth/callback" }); const result = scheme.open(authURL(scheme.state));
  f.receive(`myapp://wrong/callback?state=${scheme.state}`); f.receive(`myapp://auth/callback?state=${scheme.state}`);
  expect((await result).type).toBe("success"); expect(f.closed).toHaveLength(1);
});
test("auth transport errors reject instead of impersonating user cancellation", async () => {
  const f = fixture({ subscribeLoopback: async () => { throw new Error("Native runtime needs a rebuild"); } });
  await expect(f.create()).rejects.toThrow("needs a rebuild");
  expect(f.closed).toHaveLength(0);
});

test("an open loopback session has only its deadline timer and receives callbacks immediately", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(), session = await f.create();
    const result = session.open(authURL(session.state));
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(1);
    f.receive(`${session.redirectUri}?state=${session.state}`);
    expect(await result).toEqual({ type: "success", url: `${session.redirectUri}?state=${session.state}` });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test("failed disposal retains ownership, joins callers, and can retry", async () => {
  let attempts = 0, rejectClose!: (error: Error) => void;
  const f = fixture({ close: () => ++attempts === 1 ? new Promise((_, reject) => { rejectClose = reject; }) : Promise.resolve() });
  const session = await f.create();
  const first = session.dismiss(), second = session.dismiss();
  await sleep(0); expect(attempts).toBe(1);
  await expect(f.create()).rejects.toMatchObject({ code: "E_BUSY" });
  rejectClose(new Error("close failed"));
  await expect(first).rejects.toMatchObject({ code: "E_NATIVE" });
  await expect(second).rejects.toMatchObject({ code: "E_NATIVE" });
  await expect(f.create()).rejects.toMatchObject({ code: "E_BUSY" });
  await session.dismiss(); expect(attempts).toBe(2);
  const next = await f.create(); await next.dismiss();
});

test("failed preparation keeps failed cleanup for the next creation to retry", async () => {
  let attempts = 0, prepare = 0;
  const f = fixture({ prepare: async () => { if (++prepare === 1) throw Error("prepare failed"); return "http://127.0.0.1:12345/auth/callback"; }, close: async () => { if (++attempts === 1) throw Error("cleanup failed"); } });
  await expect(f.create()).rejects.toMatchObject({ code: "E_NATIVE", message: "prepare failed" });
  const next = await f.create(); expect(attempts).toBe(2); await next.dismiss();
});

test("timeout includes preparation and expired sessions never launch a browser", async () => {
  const f = fixture({ prepare: async () => { await sleep(10); return "http://127.0.0.1:12345/auth/callback"; } });
  const session = await f.create({ timeoutMs: 1 });
  await expect(session.open(authURL(session.state))).resolves.toEqual({ type: "timeout" });
  expect(f.opened).toHaveLength(0); expect(f.closed).toHaveLength(1);
});

test("invalid options and pre-abort reject using shared error codes", async () => {
  const f = fixture();
  await expect(f.create({ timeoutMs: 0 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(f.create({ extra: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(f.create({ redirectUri: "relative" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(f.create({ signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "E_ABORTED" });
  const session = await f.create();
  await expect(session.open("not a URL")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const next = await f.create(); await next.dismiss();
});
