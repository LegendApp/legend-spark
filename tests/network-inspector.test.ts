// The network inspector (docs/devtools.md#network-inspector): the public API's availability, the recorder's log and
// DevTools messages (redaction, truncation, limits), and the interceptors against React Native's networking modules'
// JavaScript surface, whose originals record every call. Requests against real servers: scripts/test-network-inspector.ts.
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type Listener = (...args: any[]) => void;
  const events = new Map<string, Set<Listener>>();
  const emitter = {
    addListener(type: string, listener: Listener) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type)!.add(listener);
      return { remove: () => events.get(type)!.delete(listener) };
    },
    emit(type: string, ...args: unknown[]) { for (const listener of [...events.get(type) ?? []]) listener(...args); },
    count: () => [...events.values()].reduce((sum, set) => sum + set.size, 0),
    clear: () => events.clear(),
  };
  const calls: unknown[][] = [];
  const networking = {
    sendRequest: vi.fn((...args: unknown[]) => { calls.push(["sendRequest", ...args]); }),
    abortRequest: vi.fn((id: number) => { calls.push(["abortRequest", id]); }),
    addListener: (type: string, listener: Listener) => emitter.addListener(type, listener),
  };
  const sockets = {
    connect: vi.fn((...args: unknown[]) => { calls.push(["connect", ...args]); }),
    send: vi.fn((...args: unknown[]) => { calls.push(["send", ...args]); }),
    sendBinary: vi.fn((...args: unknown[]) => { calls.push(["sendBinary", ...args]); }),
  };
  const originals = { ...networking, ...sockets };
  // NativeDesktopApp: its calls, and its desktop events through the emitter.
  const app = { call: vi.fn(async (method: string, args: string) => { calls.push(["app", method, JSON.parse(args)]); return "null"; }) };
  return { emitter, calls, networking, sockets, originals, app, platform: { OS: "macos" }, read: vi.fn(async (blob: { size: number }) => `data:application/octet-stream;base64,${"QUJD".repeat(Math.ceil(blob.size / 3)).slice(0, Math.ceil(blob.size / 3) * 4)}`) };
});
vi.mock("react-native", () => ({ Platform: mocks.platform, TurboModuleRegistry: { get: (name: string) => name === "NativeDesktopApp" ? mocks.app : null }, NativeEventEmitter: class { addListener(type: string, listener: (...args: unknown[]) => void) { return mocks.emitter.addListener(type, listener); } } }));
vi.mock("react-native/Libraries/Network/RCTNetworking", () => ({ default: mocks.networking }));
vi.mock("react-native/Libraries/WebSocket/NativeWebSocketModule", () => ({ default: mocks.sockets }));
vi.mock("react-native/Libraries/Blob/NativeFileReaderModule", () => ({ default: { readAsDataURL: mocks.read } }));
vi.mock("react-native/Libraries/Utilities/binaryToBase64", () => ({ default: (data: Uint8Array) => Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64") }));

import { NetworkRecorder, callFrames, capture, REDACTED } from "../packages/desktop-app/src/network-inspector/recorder";
import type { NetworkEntry } from "../packages/desktop-app/src/network-inspector";

const globals = globalThis as { __DEV__?: boolean };
type Message = [string, any];
function recorder(options: { log?: boolean; devtools?: boolean } = { log: true, devtools: true }) {
  const entries: NetworkEntry[] = [], messages: Message[] = [];
  const instance = new NetworkRecorder("spark-network-inspector:shared:t:", async blob => Buffer.alloc(blob.size, 7).toString("base64"));
  instance.observe({ entry: options.log ? entry => entries.push(entry) : undefined, devtools: options.devtools ? (method, params) => messages.push([method, params]) : undefined });
  return { instance, entries, messages, methods: () => messages.map(([method]) => method) };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("recorder", () => {
  test("redacts Authorization, Cookie and Set-Cookie in any case by default, and the configured names instead", () => {
    const { instance, messages } = recorder();
    const id = instance.request({ source: "fetch", method: "get", url: "http://127.0.0.1/a", headers: { authorization: "Bearer secret", Cookie: "a=1", Accept: "text/plain" } })!;
    instance.response(id, { status: 200, headers: { "Set-Cookie": "b=2", "Content-Type": "text/plain; charset=utf-8" } });
    expect(instance.log()[0]).toMatchObject({ method: "GET", requestHeaders: { authorization: REDACTED, Cookie: REDACTED, Accept: "text/plain" }, responseHeaders: { "Set-Cookie": REDACTED } });
    expect(messages[0]![1].request.headers).toEqual({ authorization: REDACTED, Cookie: REDACTED, Accept: "text/plain" });
    expect(messages[1]).toMatchObject(["Network.responseReceived", { response: { status: 200, mimeType: "text/plain", headers: { "Set-Cookie": REDACTED } } }]);
    expect(JSON.stringify(messages)).not.toMatch(/secret|a=1|b=2/);
    instance.configure({ redactHeaders: ["X-Api-Key"] });
    instance.request({ source: "xhr", method: "POST", url: "http://127.0.0.1/b", headers: { "x-api-key": "k", Authorization: "visible" } });
    expect(instance.log()[1]!.requestHeaders).toEqual({ "x-api-key": REDACTED, Authorization: "visible" });
  });

  test("bodies are cut to maxBodySize and report their whole size; base64 stays valid", () => {
    expect(capture({ text: "abcdef" }, 4)).toEqual({ data: "abcd", base64: false, size: 6, truncated: true });
    const bytes = Buffer.from(Array.from({ length: 10 }, (_, i) => i));
    const cut = capture({ base64: bytes.toString("base64") }, 7);
    expect(cut).toMatchObject({ base64: true, size: 10, truncated: true });
    expect([...Buffer.from(cut.data!, "base64")]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(capture({ base64: bytes.subarray(0, 4).toString("base64"), size: 10 }, 4)).toMatchObject({ size: 10, truncated: true });
    expect(capture({ base64: "AAEC" }, 3)).toEqual({ data: "AAEC", base64: true, size: 3, truncated: false });

    const { instance, messages } = recorder();
    instance.configure({ maxBodySize: 5 });
    const id = instance.request({ source: "xhr", method: "POST", url: "http://127.0.0.1/", body: { text: "0123456789" } })!;
    expect(messages[0]![1].request).toMatchObject({ postData: "01234", hasPostData: true });
    instance.response(id, { status: 200 });
    // Incremental text appends within the cap and counts every part.
    instance.data(id, { text: "abc" }); instance.data(id, { text: "defgh" }); instance.data(id, { text: "ij" });
    instance.finish(id);
    expect(instance.log()[0]).toMatchObject({ state: "finished", requestBody: { data: "01234", size: 10, truncated: true }, responseBody: { data: "abcde", size: 10, truncated: true } });
    expect(messages.filter(([method]) => method === "Network.dataReceived").map(([, params]) => params.dataLength)).toEqual([3, 5, 2]);
    expect(messages.at(-2)).toEqual(["Expo(Network.receivedResponseBody)", { requestId: id, body: "abcde", base64Encoded: false }]);
  });

  test("a blob body is read as base64, at most maxBodySize bytes, before DevTools hears the request finished", async () => {
    const { instance, messages, methods } = recorder();
    instance.configure({ maxBodySize: 6 });
    const id = instance.request({ source: "fetch", method: "GET", url: "http://127.0.0.1/" })!;
    instance.response(id, { status: 200, headers: { "content-type": "application/octet-stream" } });
    instance.data(id, { blob: { blobId: "b1", offset: 0, size: 9 } });
    instance.finish(id);
    expect(methods()).not.toContain("Network.loadingFinished");
    await settle();
    expect(instance.log()[0]!.responseBody).toEqual({ data: Buffer.alloc(6, 7).toString("base64"), base64: true, size: 9, truncated: true });
    expect(messages.slice(-2)).toEqual([["Expo(Network.receivedResponseBody)", { requestId: id, body: Buffer.alloc(6, 7).toString("base64"), base64Encoded: true }], ["Network.loadingFinished", expect.objectContaining({ requestId: id, encodedDataLength: 9 })]]);
  });

  test("the log keeps maxEntries and maxLogSize, dropping the oldest finished entries first", () => {
    const { instance } = recorder({ log: true });
    instance.configure({ maxEntries: 3 });
    const pending = instance.request({ source: "xhr", method: "GET", url: "http://127.0.0.1/pending" })!;
    for (const name of ["a", "b", "c"]) { const id = instance.request({ source: "fetch", method: "GET", url: `http://127.0.0.1/${name}` })!; instance.finish(id); }
    expect(instance.log().map(entry => entry.url.slice(-1))).toEqual(["g", "b", "c"]);
    expect(instance.log()[0]!.id).toBe(pending);
    instance.configure({ maxLogSize: 40 });
    expect(instance.log().map(entry => entry.url)).toEqual(["http://127.0.0.1/pending"]);
    // The snapshot is the same array until something changes.
    expect(instance.log()).toBe(instance.log());
    expect(Object.isFrozen(instance.log())).toBe(true);
    expect(() => instance.configure({ maxEntries: 0 })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
    expect(() => instance.configure({ frames: 1 } as never)).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
    expect(() => instance.configure({ redactHeaders: [""] })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  });

  test("nothing is recorded while nothing observes, and stopping forgets every entry", () => {
    const { instance } = recorder({});
    expect(instance.active).toBe(false);
    expect(instance.request({ source: "fetch", method: "GET", url: "http://127.0.0.1/" })).toBeUndefined();
    expect(instance.log()).toEqual([]);
    instance.observe({ entry: () => {} });
    instance.request({ source: "fetch", method: "GET", url: "http://127.0.0.1/" });
    expect(instance.log()).toHaveLength(1);
    instance.observe({});
    expect(instance.log()).toEqual([]);
  });

  test("an abort's late completion and events of evicted entries are ignored", () => {
    const { instance, methods } = recorder();
    const id = instance.request({ source: "fetch", method: "GET", url: "http://127.0.0.1/" })!;
    instance.fail(id, "canceled", true);
    instance.finish(id); instance.fail(id, "cancelled"); instance.data(id, { text: "late" });
    expect(instance.log()[0]).toMatchObject({ state: "canceled", error: "canceled" });
    expect(methods()).toEqual(["Network.requestWillBeSent", "Network.loadingFailed"]);
  });

  test("a WebSocket reports its handshake, text and binary frames (the latest 50) and its close", async () => {
    const { instance, messages } = recorder();
    const id = instance.request({ source: "websocket", method: "GET", url: "ws://127.0.0.1/ws", headers: { Cookie: "c" } })!;
    instance.socketOpened(id, "chat");
    instance.frame(id, "sent", { text: "hello" });
    instance.frame(id, "received", { base64: "AAEC/w==" });
    instance.frame(id, "received", { blob: { blobId: "x", size: 2 } });
    await settle();
    for (let i = 0; i < 60; i++) instance.frame(id, "sent", { text: String(i) });
    instance.socketClosed(id, 1000, "done");
    instance.frame(id, "sent", { text: "after close" });
    const entry = instance.log()[0]!;
    expect(entry).toMatchObject({ source: "websocket", state: "closed", status: 101, close: { code: 1000, reason: "done" }, requestHeaders: { Cookie: REDACTED } });
    expect(entry.frames).toHaveLength(50);
    expect(entry.frames!.at(-1)).toMatchObject({ direction: "sent", opcode: 1, data: "59" });
    expect(messages.slice(0, 6).map(([method, params]) => [method, params.response?.opcode, params.response?.payloadData])).toEqual([
      ["Network.webSocketCreated", undefined, undefined], ["Network.webSocketWillSendHandshakeRequest", undefined, undefined],
      ["Network.webSocketHandshakeResponseReceived", undefined, undefined], ["Network.webSocketFrameSent", 1, "hello"],
      ["Network.webSocketFrameReceived", 2, "AAEC/w=="], ["Network.webSocketFrameReceived", 2, Buffer.alloc(2, 7).toString("base64")]]);
    expect(messages.at(-1)).toEqual(["Network.webSocketClosed", expect.objectContaining({ requestId: id })]);
  });

  test("Hermes stack lines become call frames; the interceptor's own frame and native frames are skipped", () => {
    const stack = "Error\n    at sendRequest (http://127.0.0.1:8081/index.bundle:10:5)\n    at send (http://127.0.0.1:8081/index.bundle:20:7)\n    at anonymous (native)\n    at http://127.0.0.1:8081/index.bundle:30:1\n    at f (address at InternalBytecode.js:1:9)";
    expect(callFrames(stack, 1)).toEqual([{ functionName: "send", url: "http://127.0.0.1:8081/index.bundle", line: 20, column: 7 }, { functionName: "", url: "http://127.0.0.1:8081/index.bundle", line: 30, column: 1 }]);
  });
});

describe("interceptors", () => {
  let fetches: unknown[];
  beforeEach(() => { mocks.calls.length = 0; mocks.emitter.clear(); });

  async function setup() {
    vi.resetModules();
    fetches = [];
    // React Native's fetch sends through XMLHttpRequest, synchronously.
    globalThis.fetch = vi.fn(function (this: unknown, ...args: unknown[]) {
      fetches.push(args);
      mocks.networking.sendRequest("GET", undefined, args[0], {}, null, "blob", false, 0, () => {}, true);
      return Promise.resolve(new Response(""));
    }) as never;
    // Each test wraps the modules afresh.
    mocks.networking.sendRequest = mocks.originals.sendRequest; mocks.networking.abortRequest = mocks.originals.abortRequest;
    Object.assign(mocks.sockets, { connect: mocks.originals.connect, send: mocks.originals.send, sendBinary: mocks.originals.sendBinary });
    const { intercept, readBlob } = await import("../packages/desktop-app/src/network-inspector/intercept");
    const { instance, entries, messages } = recorder({});
    const interception = intercept(instance);
    const start = () => { instance.observe({ entry: entry => entries.push(entry), devtools: (method, params) => messages.push([method, params]) }); interception.observe(true); };
    const stop = () => { instance.observe({}); interception.observe(false); };
    return { instance, entries, messages, interception, start, stop, readBlob };
  }

  test("while nothing observes, every call reaches React Native unchanged and nothing listens", async () => {
    const { instance } = await setup();
    const callback = () => {}, body = new Uint8Array([1, 2, 3]);
    mocks.networking.sendRequest("POST", "t", "http://127.0.0.1/", { A: "1" }, body, "text", true, 5, callback, false);
    expect(mocks.calls.at(-1)).toEqual(["sendRequest", "POST", "t", "http://127.0.0.1/", { A: "1" }, body, "text", true, 5, callback, false]);
    expect((mocks.calls.at(-1) as unknown[])[9]).toBe(callback);
    expect(mocks.emitter.count()).toBe(0);
    expect(instance.log()).toEqual([]);
  });

  test("an XMLHttpRequest and a fetch are recorded from send to completion; arguments and events are untouched", async () => {
    const { entries, messages, start, stop } = await setup();
    start();
    const ids: number[] = [];
    const body = new Uint8Array([0, 1, 2, 255]);
    mocks.networking.sendRequest("POST", undefined, "http://127.0.0.1/echo", { Authorization: "Bearer x" }, body, "base64", false, 0, (id: number) => ids.push(id), true);
    const sent = mocks.calls.at(-1) as unknown[];
    expect(sent.slice(0, 9)).toEqual(["sendRequest", "POST", undefined, "http://127.0.0.1/echo", { Authorization: "Bearer x" }, body, "base64", false, 0]);
    expect(sent[5]).toBe(body);
    (sent[9] as (id: number) => void)(41);
    expect(ids).toEqual([41]);
    mocks.emitter.emit("didReceiveNetworkResponse", [41, 200, { "Content-Type": "application/octet-stream" }, "http://127.0.0.1/echo"]);
    mocks.emitter.emit("didReceiveNetworkData", [41, "AAEC/w=="]);
    mocks.emitter.emit("didCompleteNetworkResponse", [41, null, false]);
    expect(entries.at(-1)).toMatchObject({ source: "xhr", state: "finished", status: 200, requestHeaders: { Authorization: REDACTED }, requestBody: { data: "AAEC/w==", base64: true, size: 4 }, responseBody: { data: "AAEC/w==", base64: true, size: 4 } });
    expect(messages[0]![1]).toMatchObject({ type: "XHR", request: { postDataEntries: [{ bytes: "AAEC/w==" }] } });

    await globalThis.fetch("http://127.0.0.1/f");
    expect(entries.at(-1)).toMatchObject({ source: "fetch", url: "http://127.0.0.1/f" });
    expect(fetches).toEqual([["http://127.0.0.1/f"]]);
    stop();
    expect(mocks.emitter.count()).toBe(0);
  });

  test("aborting reports a canceled request and still aborts it; a timeout is a failure", async () => {
    const { entries, messages, start } = await setup();
    start();
    mocks.networking.sendRequest("GET", undefined, "http://127.0.0.1/hang", {}, null, "text", false, 0, () => {}, true);
    (mocks.calls.at(-1) as any)[9](7);
    mocks.networking.abortRequest(7);
    expect(mocks.calls.at(-1)).toEqual(["abortRequest", 7]);
    mocks.emitter.emit("didCompleteNetworkResponse", [7, "cancelled", false]);
    expect(entries.at(-1)).toMatchObject({ state: "canceled" });
    expect(messages.at(-1)).toEqual(["Network.loadingFailed", expect.objectContaining({ canceled: true })]);
    mocks.networking.sendRequest("GET", undefined, "http://127.0.0.1/slow", {}, null, "text", false, 1, () => {}, true);
    (mocks.calls.at(-1) as any)[9](8);
    mocks.emitter.emit("didCompleteNetworkResponse", [8, "The request timed out.", true]);
    expect(entries.at(-1)).toMatchObject({ state: "failed", error: "timeout" });
  });

  test("a blob response is read through the FileReader module by its id, capped, without a Blob", async () => {
    const { entries, start, readBlob } = await setup();
    expect(await readBlob({ blobId: "z", offset: 0, size: 3 })).toBe("QUJD");
    start();
    mocks.networking.sendRequest("GET", undefined, "http://127.0.0.1/b", {}, null, "blob", false, 0, () => {}, true);
    (mocks.calls.at(-1) as any)[9](9);
    mocks.emitter.emit("didReceiveNetworkData", [9, { blobId: "blob-9", offset: 0, size: 3, type: "text/plain" }]);
    mocks.emitter.emit("didCompleteNetworkResponse", [9, null, false]);
    await settle();
    expect(entries.at(-1)).toMatchObject({ state: "finished", responseBody: { base64: true, size: 3, data: expect.any(String) } });
  });

  test("WebSockets: connect, frames and close are recorded and reach the module unchanged; the inspector's own socket is not", async () => {
    const { entries, interception, start } = await setup();
    start();
    mocks.sockets.connect("ws://127.0.0.1/ws", ["chat"], { headers: { Cookie: "c" } }, 3);
    expect(mocks.calls.at(-1)).toEqual(["connect", "ws://127.0.0.1/ws", ["chat"], { headers: { Cookie: "c" } }, 3]);
    mocks.emitter.emit("websocketOpen", { id: 3, protocol: "chat" });
    mocks.sockets.send("hi", 3);
    mocks.sockets.sendBinary("AAE=", 3);
    expect(mocks.calls.slice(-2)).toEqual([["send", "hi", 3], ["sendBinary", "AAE=", 3]]);
    mocks.emitter.emit("websocketMessage", { id: 3, type: "binary", data: "AAE=" });
    mocks.emitter.emit("websocketClosed", { id: 3, code: 1000, reason: "" });
    expect(entries.at(-1)).toMatchObject({ source: "websocket", state: "closed", frames: [{ direction: "sent", opcode: 1, data: "hi" }, { direction: "sent", opcode: 2, data: "AAE=" }, { direction: "received", opcode: 2, data: "AAE=" }] });
    const before = entries.length;
    interception.internal(() => mocks.sockets.connect("ws://127.0.0.1:8081/inspector/network", null, {}, 4));
    mocks.sockets.send("{}", 4);
    expect(entries.length).toBe(before);
  });
});

describe("public API", () => {
  test("availability and errors follow the platform, the bundle and the runtime entry's installation", async () => {
    vi.resetModules();
    globals.__DEV__ = true; mocks.platform.OS = "macos";
    const api = await import("../packages/desktop-app/src/network-inspector");
    expect(api.getNetworkInspectorAvailability()).toEqual({ available: false, reason: "missing-module" });
    expect(() => api.getNetworkLog()).toThrow(expect.objectContaining({ code: "E_MODULE_UNAVAILABLE" }));
    api.registerNetworkInspector({ addListener: () => ({ remove() {} }), log: () => [], configure() {} });
    expect(() => api.registerNetworkInspector({ addListener: () => ({ remove() {} }), log: () => [], configure() {} })).toThrow(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
    expect(api.getNetworkInspectorAvailability()).toEqual({ available: true });
    expect(api.getNetworkLog()).toEqual([]);
    expect(() => api.addNetworkListener(null as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
    globals.__DEV__ = false;
    expect(api.getNetworkInspectorAvailability()).toEqual({ available: false, reason: "development-only" });
    expect(() => api.addNetworkListener(() => {})).toThrow(expect.objectContaining({ code: "E_UNAVAILABLE" }));
    mocks.platform.OS = "windows";
    expect(api.getNetworkInspectorAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
    expect(() => api.configureNetworkInspector({})).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
    globals.__DEV__ = true; mocks.platform.OS = "macos";
  });

  test("the installed inspector records while a listener exists or DevTools is attached, and reports to the development server", async () => {
    vi.resetModules();
    mocks.emitter.clear();
    globals.__DEV__ = true;
    const subscribers = new Set<(active: boolean) => void>();
    const observer = { hasActiveSession: false, subscribers };
    (globalThis as { __DEBUGGER_SESSION_OBSERVER__?: unknown }).__DEBUGGER_SESSION_OBSERVER__ = observer;
    const opened: { url: string; sent: string[]; socket: any }[] = [];
    (globalThis as { WebSocket?: unknown }).WebSocket = class {
      onopen?: () => void; onerror?: unknown; onclose?: unknown; sent: string[] = [];
      constructor(readonly url: string) { mocks.sockets.connect(url, null, {}, 99); opened.push({ url, sent: this.sent, socket: this }); }
      send(message: string) { this.sent.push(message); }
      close() {}
    };
    mocks.networking.sendRequest = mocks.originals.sendRequest; mocks.networking.abortRequest = mocks.originals.abortRequest;
    Object.assign(mocks.sockets, { connect: mocks.originals.connect, send: mocks.originals.send, sendBinary: mocks.originals.sendBinary });
    vi.doMock("react-native/Libraries/Core/Devtools/getDevServer", () => ({ default: () => ({ url: "http://127.0.0.1:8081/", fullBundleUrl: null, bundleLoadedFromServer: true }) }));
    const { installNetworkInspector } = await import("../packages/desktop-app/src/network-inspector/install");
    const api = await import("../packages/desktop-app/src/network-inspector");
    installNetworkInspector();
    expect(mocks.emitter.count()).toBe(0);
    const seen: NetworkEntry[] = [];
    const subscription = api.addNetworkListener(entry => seen.push(entry));
    mocks.networking.sendRequest("GET", undefined, "http://127.0.0.1/x", {}, null, "text", false, 0, () => {}, true);
    expect(seen[0]).toMatchObject({ id: expect.stringMatching(/^spark-network-inspector:shared:/), url: "http://127.0.0.1/x" });
    subscription.remove(); subscription.remove();
    expect(api.getNetworkLog()).toEqual([]);
    expect(mocks.emitter.count()).toBe(0);

    observer.hasActiveSession = true;
    for (const subscriber of subscribers) subscriber(true);
    expect(opened.map(socket => socket.url)).toEqual(["ws://127.0.0.1:8081/inspector/network"]);
    mocks.networking.sendRequest("GET", undefined, "http://127.0.0.1/y", {}, null, "text", false, 0, () => {}, true);
    expect(opened[0]!.sent).toEqual([]);
    opened[0]!.socket.onopen();
    expect(opened[0]!.sent.map(message => JSON.parse(message).method)).toEqual(["Network.requestWillBeSent"]);
    observer.hasActiveSession = false;
    for (const subscriber of subscribers) subscriber(false);
    expect(mocks.emitter.count()).toBe(0);
    // Native modules report only while the shared runtime records: off at install, on with the body cap, off again.
    expect(mocks.calls.filter(call => call[0] === "app")).toEqual([
      ["app", "reportNativeNetwork", { maxBodySize: null }], ["app", "reportNativeNetwork", { maxBodySize: 65536 }], ["app", "reportNativeNetwork", { maxBodySize: null }],
      ["app", "reportNativeNetwork", { maxBodySize: 65536 }], ["app", "reportNativeNetwork", { maxBodySize: null }],
    ]);
  });

  test("the shared runtime lists native modules' requests, redacted and capped, while it records", async () => {
    vi.resetModules();
    mocks.emitter.clear(); mocks.calls.length = 0;
    globals.__DEV__ = true;
    (globalThis as { __DEBUGGER_SESSION_OBSERVER__?: unknown }).__DEBUGGER_SESSION_OBSERVER__ = undefined;
    vi.doMock("react-native/Libraries/Core/Devtools/getDevServer", () => ({ default: () => ({ url: "http://127.0.0.1:8081/", fullBundleUrl: null, bundleLoadedFromServer: true }) }));
    const { installNetworkInspector } = await import("../packages/desktop-app/src/network-inspector/install");
    const api = await import("../packages/desktop-app/src/network-inspector");
    installNetworkInspector();
    const native = (event: object) => mocks.emitter.emit("desktop", { type: "nativeNetwork", ...event });
    const request = { phase: "request", module: "@legendapp/spark/audio", method: "GET", url: "http://127.0.0.1/art.png", headers: { Cookie: "c=1" } };
    native({ ...request, id: "n1" });
    expect(mocks.emitter.count()).toBe(0);

    const seen: NetworkEntry[] = [];
    const subscription = api.addNetworkListener(entry => seen.push(entry));
    api.configureNetworkInspector({ maxBodySize: 4 });
    native({ ...request, id: "n2" });
    native({ phase: "end", id: "n2", status: 200, headers: { "Content-Type": "image/png", "Set-Cookie": "s=1" }, url: "http://127.0.0.1/art.png", body: { base64: "AAECAw==", size: 9 } });
    native({ ...request, id: "n3" });
    native({ phase: "end", id: "n3", error: "cancelled", canceled: true });
    native({ phase: "end", id: "n1", status: 200 });
    const log = api.getNetworkLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ source: "native", module: "@legendapp/spark/audio", initiator: [], state: "finished", status: 200, requestHeaders: { Cookie: REDACTED }, responseHeaders: { "Set-Cookie": REDACTED }, responseBody: { data: "AAECAw==", base64: true, size: 9, truncated: true } });
    expect(log[1]).toMatchObject({ source: "native", state: "canceled", error: "cancelled" });
    expect(seen.length).toBeGreaterThan(0);
    expect(mocks.calls.filter(call => call[0] === "app").map(call => (call[2] as { maxBodySize: unknown }).maxBodySize)).toEqual([null, 65536, 4]);
    subscription.remove();
    expect(mocks.emitter.count()).toBe(0);
    expect(mocks.calls.at(-1)).toEqual(["app", "reportNativeNetwork", { maxBodySize: null }]);
  });

  test("native requests reach DevTools as type Other with the module as initiator; isolated runtimes do not ask for them", async () => {
    const { instance, messages } = recorder();
    const id = instance.request({ source: "native", module: "@legendapp/spark/audio", method: "GET", url: "http://127.0.0.1/art.png" })!;
    expect(messages[0]).toMatchObject(["Network.requestWillBeSent", { type: "Other", initiator: { type: "other", url: "@legendapp/spark/audio" } }]);
    instance.fail(id, "offline");
    expect(messages.at(-1)).toMatchObject(["Network.loadingFailed", { type: "Other", errorText: "offline" }]);

    vi.resetModules();
    mocks.calls.length = 0;
    (globalThis as { __THREADED_RUNTIME_ENV__?: unknown }).__THREADED_RUNTIME_ENV__ = { runtimeName: "worker" };
    try {
      const { installNetworkInspector } = await import("../packages/desktop-app/src/network-inspector/install");
      const api = await import("../packages/desktop-app/src/network-inspector");
      installNetworkInspector();
      api.addNetworkListener(() => {}).remove();
      expect(mocks.calls.filter(call => call[0] === "app")).toEqual([]);
    } finally { delete (globalThis as { __THREADED_RUNTIME_ENV__?: unknown }).__THREADED_RUNTIME_ENV__; }
  });
});
