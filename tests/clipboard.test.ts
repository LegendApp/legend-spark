import { setTimeout as sleep } from "node:timers/promises";
import { beforeEach, describe, expect, test, vi } from "vitest";

// @legendapp/spark/clipboard over a recording native module and desktop event emitter.
const calls: { method: string; args: any }[] = [];
const handlers = new Map<string, (args: any) => unknown>();
const listeners = new Set<(event: any) => void>();
const nativeClipboard = {
  call: async (method: string, json: string) => {
    calls.push({ method, args: JSON.parse(json) });
    return JSON.stringify((await handlers.get(method)?.(JSON.parse(json))) ?? null);
  },
  binaryCall: async (method: string, json: string, buffer?: ArrayBuffer, offset?: number, length?: number) => {
    const args = JSON.parse(json);
    if (buffer) args.bytes = new Uint8Array(buffer, offset, length).slice();
    calls.push({ method, args });
    return (await handlers.get(method)?.(args)) ?? null;
  },
};
const nativeApp = { call: async () => "null" };
const platform = { OS: "macos" };
vi.doMock("react-native", () => ({
  Platform: platform,
  TurboModuleRegistry: { get: (name: string) => name === "NativeDesktopClipboard" ? nativeClipboard : name === "NativeDesktopApp" ? nativeApp : null },
  NativeEventEmitter: class {
    addListener(_event: string, listener: (event: any) => void) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; }
  },
}));
vi.doMock("expo-clipboard", () => ({ StringFormat: { PLAIN_TEXT: "plainText", HTML: "html" }, getStringAsync: async () => "", setStringAsync: async () => true, hasStringAsync: async () => false }));
const clipboard = await import("../packages/clipboard/src/index.ts");
const mobile = await import("../packages/clipboard/src/expo.ts");
const emit = (event: object) => { for (const listener of [...listeners]) listener(event); };
const tick = () => sleep(1);
const nativeError = (code: string) => Object.assign(new Error(code), { code });
beforeEach(() => { platform.OS = "macos"; calls.length = 0; handlers.clear(); });

describe("availability", () => {
  test("macOS has every feature; Windows only the base module; other platforms none", () => {
    for (const feature of [undefined, "promisedData", "changeEvents", "privacyMarkers"] as const) expect(clipboard.getRichClipboardAvailability(feature)).toEqual({ available: true });
    platform.OS = "windows";
    expect(clipboard.getRichClipboardAvailability()).toEqual({ available: true });
    for (const feature of ["promisedData", "changeEvents", "privacyMarkers"] as const) expect(clipboard.getRichClipboardAvailability(feature)).toEqual({ available: false, reason: "unsupported-platform" });
    platform.OS = "ios";
    expect(clipboard.getRichClipboardAvailability("changeEvents")).toEqual({ available: false, reason: "unsupported-platform" });
    expect(() => clipboard.getRichClipboardAvailability("history" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  });
  test("mobile and web report unsupported and reject typed errors", async () => {
    expect(mobile.getRichClipboardAvailability("promisedData")).toEqual({ available: false, reason: "unsupported-platform" });
    await expect(mobile.writePromisedClipboard({ types: ["text"], provide: () => "" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(mobile.onClipboardChange(() => {})).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(mobile.getClipboardChangeCount()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  });
  test("Windows rejects the macOS features before calling native", async () => {
    platform.OS = "windows";
    await expect(clipboard.writePromisedClipboard({ types: ["text"], provide: () => "x" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(clipboard.onClipboardChange(() => {})).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(clipboard.getClipboardChangeCount()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(clipboard.writeClipboard({ text: "secret" }, { concealed: true })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    expect(calls).toEqual([]);
    await clipboard.writeClipboard({ text: "plain" }, { concealed: false });
    expect(calls).toEqual([{ method: "write", args: { text: "plain" } }]);
  });
});

describe("concealed and transient", () => {
  test("markers go with the write; unknown or non-boolean options reject", async () => {
    await clipboard.writeClipboard({ text: "secret" }, { concealed: true, transient: true });
    await clipboard.writeClipboard({ files: ["/tmp/a"] }, { transient: true });
    expect(calls.map(call => call.args)).toEqual([{ text: "secret", concealed: true, transient: true }, { files: ["/tmp/a"], transient: true }]);
    await expect(clipboard.writeClipboard({ text: "x" }, { secret: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
    await expect(clipboard.writeClipboard({ text: "x" }, { concealed: "yes" } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  });
});

describe("promised data", () => {
  test("promising sends the types and provides each on request, as text or PNG bytes", async () => {
    const provided: string[] = [];
    await clipboard.writePromisedClipboard({ types: ["text", "png"], provide: async type => { provided.push(type); return type === "png" ? new Uint8Array([137, 80]) : "lazy text"; } }, { concealed: true, timeoutMs: 2000 });
    const { id, ...args } = calls[0]!.args;
    expect([calls[0]!.method, args]).toEqual(["writePromised", { types: ["text", "png"], timeoutMs: 2000, concealed: true }]);
    expect(provided).toEqual([]);
    emit({ type: "clipboardProvide", id, requestId: 1, dataType: "text" });
    emit({ type: "clipboardProvide", id, requestId: 2, dataType: "png" });
    await tick();
    expect(provided).toEqual(["text", "png"]);
    expect(calls.slice(1)).toEqual([{ method: "provide", args: { requestId: 1, text: "lazy text" } }, { method: "provide", args: { requestId: 2, bytes: new Uint8Array([137, 80]) } }]);
    emit({ type: "clipboardProviderReleased", id });
    expect(listeners.size).toBe(0);
  });
  test("a failing or wrong provider reports onError and answers nothing at once; a late answer reports E_TIMEOUT", async () => {
    const errors: string[] = [];
    let mode = "throw";
    await clipboard.writePromisedClipboard({ types: ["html", "png"], provide: () => { if (mode === "throw") throw new Error("offline"); return mode === "wrong" ? "not bytes" as never : "<b>x</b>"; } }, { onError: error => errors.push(error.code) });
    const id = calls[0]!.args.id;
    emit({ type: "clipboardProvide", id, requestId: 1, dataType: "html" }); await tick();
    mode = "wrong";
    emit({ type: "clipboardProvide", id, requestId: 2, dataType: "png" }); await tick();
    mode = "late";
    handlers.set("provide", () => { throw nativeError("E_TIMEOUT"); });
    emit({ type: "clipboardProvide", id, requestId: 3, dataType: "html" }); await tick();
    expect(errors).toEqual(["E_UNAVAILABLE", "E_INVALID_DATA", "E_TIMEOUT"]);
    expect(calls.slice(1).map(call => call.args)).toEqual([{ requestId: 1 }, { requestId: 2 }, { requestId: 3, text: "<b>x</b>" }]);
    // A request for a provider this runtime no longer has is answered with nothing.
    emit({ type: "clipboardProviderReleased", id });
    expect(listeners.size).toBe(0);
  });
  test("invalid content and options reject before native; a failed write drops its provider", async () => {
    await expect(clipboard.writePromisedClipboard({ types: [], provide: () => "" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(clipboard.writePromisedClipboard({ types: ["text", "text"], provide: () => "" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(clipboard.writePromisedClipboard({ types: ["pdf" as never], provide: () => "" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(clipboard.writePromisedClipboard({ types: ["text"] } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(clipboard.writePromisedClipboard({ types: ["text"], provide: () => "" }, { timeoutMs: 0 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(clipboard.writePromisedClipboard({ types: ["text"], provide: () => "" }, { retries: 1 } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
    expect(calls).toEqual([]);
    handlers.set("writePromised", () => { throw nativeError("E_NATIVE"); });
    await expect(clipboard.writePromisedClipboard({ types: ["text"], provide: () => "" })).rejects.toMatchObject({ code: "E_NATIVE" });
    expect(listeners.size).toBe(0);
  });
});

describe("change monitoring", () => {
  test("a registration observes at its interval, receives changes until removed, and removes once", async () => {
    const counts: number[] = [];
    const registration = await clipboard.onClipboardChange(event => counts.push(event.changeCount), { intervalMs: 250 });
    const { id, intervalMs } = calls[0]!.args;
    expect([calls[0]!.method, intervalMs]).toEqual(["observe", 250]);
    emit({ type: "clipboardChanged", changeCount: 7 });
    emit({ type: "clipboardProvide", id: "other", requestId: 9, dataType: "text" }); // not a change
    await Promise.all([registration.remove(), registration.remove()]);
    emit({ type: "clipboardChanged", changeCount: 8 });
    expect(counts).toEqual([7]);
    expect(calls.filter(call => call.method === "unobserve")).toEqual([{ method: "unobserve", args: { id } }]);
    expect(listeners.size).toBe(0);
  });
  test("the default interval is 500 ms; invalid handlers and intervals reject; a failed observe leaves no listener", async () => {
    await (await clipboard.onClipboardChange(() => {})).remove();
    expect(calls[0]!.args.intervalMs).toBe(500);
    await expect(clipboard.onClipboardChange(null as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(clipboard.onClipboardChange(() => {}, { intervalMs: 50 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(clipboard.onClipboardChange(() => {}, { intervalMs: 1.5 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(clipboard.onClipboardChange(() => {}, { every: 1 } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
    handlers.set("observe", () => { throw nativeError("E_CLOSED"); });
    await expect(clipboard.onClipboardChange(() => {})).rejects.toMatchObject({ code: "E_CLOSED" });
    expect(listeners.size).toBe(0);
  });
  test("getClipboardChangeCount validates the native count", async () => {
    handlers.set("changeCount", () => 42);
    expect(await clipboard.getClipboardChangeCount()).toBe(42);
    handlers.set("changeCount", () => "42");
    await expect(clipboard.getClipboardChangeCount()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  });
});
