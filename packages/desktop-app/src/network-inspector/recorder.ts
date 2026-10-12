import { SparkError } from "../contracts";
import type { NetworkBody, NetworkCallFrame, NetworkEntry, NetworkFrame, NetworkInspectorOptions, NetworkSource } from "../network-inspector";

// Development bundles only. The recorder turns what the interceptors observe into log entries (for
// addNetworkListener) and Chrome DevTools Protocol Network events (for React Native DevTools), redacting headers and
// truncating bodies once for both. It holds state only while somebody observes, within the configured limits.

/** A body as the networking modules carry it: text, base64, or a native blob the reader reads (a capped slice). */
/** `size` of base64 is the whole body's, when `base64` holds only its first bytes. */
export type BodyInput = { text: string } | { base64: string; size?: number } | { blob: BlobData } | { unreadable: true };
export type BlobData = { blobId: string; offset?: number; size: number; type?: string };
/** Reads `size` bytes of a native blob as base64 (React Native's FileReader module, without creating a Blob). */
export type BlobReader = (blob: BlobData) => Promise<string>;
type Options = Required<{ [K in keyof NetworkInspectorOptions]-?: Exclude<NetworkInspectorOptions[K], undefined> }>;

export const DEFAULT_OPTIONS: Options = { redactHeaders: ["Authorization", "Cookie", "Set-Cookie"], maxEntries: 100, maxBodySize: 65536, maxLogSize: 4 * 1024 * 1024 };
const MAX_FRAMES = 50, MAX_STACK = 20;
export const REDACTED = "[redacted]";
const CDP_TYPES: Record<NetworkSource, string> = { fetch: "Fetch", xhr: "XHR", websocket: "WebSocket" };

const limit = (value: unknown, name: string, min: number) => {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new SparkError("E_INVALID_ARGUMENT", `${name} must be an integer of at least ${min}`);
  return value as number;
};
export function validOptions(current: Options, options: NetworkInspectorOptions): Options {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected network inspector options");
  const next = { ...current };
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    if (key === "redactHeaders") {
      if (!Array.isArray(value) || !value.every(name => typeof name === "string" && name.length > 0)) throw new SparkError("E_INVALID_ARGUMENT", "redactHeaders must be header names");
      next.redactHeaders = [...value];
    } else if (key === "maxEntries" || key === "maxBodySize" || key === "maxLogSize") next[key] = limit(value, key, key === "maxEntries" ? 1 : 0);
    else throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown network inspector option: ${key}`);
  }
  return next;
}

/** Hermes stack lines (`at name (url:line:column)`, `at url:line:column`) as call frames; native frames are skipped. */
export function callFrames(stack: string | undefined, skip: number): NetworkCallFrame[] {
  const frames: NetworkCallFrame[] = [];
  for (const line of (stack ?? "").split("\n").slice(1 + skip)) {
    const match = /^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (match && !match[2]!.startsWith("address at ")) frames.push({ functionName: match[1] ?? "", url: match[2]!, line: Number(match[3]), column: Number(match[4]) });
    if (frames.length === MAX_STACK) break;
  }
  return frames;
}

const decodedSize = (base64: string) => Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
/** A body cut to `max` bytes (characters of text); base64 is cut on a 3-byte boundary so it stays valid. */
export function capture(input: { text: string } | { base64: string; size?: number }, max: number): NetworkBody {
  if ("text" in input) return { data: input.text.slice(0, max), base64: false, size: input.text.length, truncated: input.text.length > max };
  const held = decodedSize(input.base64), size = input.size ?? held;
  return held <= max ? { data: input.base64, base64: true, size, truncated: size > held } : { data: input.base64.slice(0, Math.floor(max / 3) * 4), base64: true, size, truncated: true };
}
const bodyBytes = (body: NetworkBody | undefined) => body?.data?.length ?? 0;
const headerBytes = (headers: Readonly<Record<string, string>> | undefined) => Object.entries(headers ?? {}).reduce((sum, [name, value]) => sum + name.length + value.length, 0);
const entryBytes = (entry: NetworkEntry) => entry.url.length + headerBytes(entry.requestHeaders) + headerBytes(entry.responseHeaders) + bodyBytes(entry.requestBody) + bodyBytes(entry.responseBody) + (entry.frames ?? []).reduce((sum, frame) => sum + bodyBytes(frame), 0);
const ended = (entry: NetworkEntry) => entry.state !== "pending" && entry.state !== "open";
const mime = (headers: Readonly<Record<string, string>> | undefined) => Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1].split(";")[0]!.trim() ?? "";

export type RecorderSinks = {
  /** Called with each new or changed entry while JavaScript listeners exist. */
  entry?(entry: NetworkEntry): void;
  /** Called with each CDP message while React Native DevTools is attached. */
  devtools?(method: string, params: object): void;
};

/**
 * The entries of one JavaScript runtime. `observe` decides what is produced: nothing while neither sink is set. Ids
 * are unique per runtime load (`prefix`), so DevTools never merges requests from before a reload.
 */
export class NetworkRecorder {
  options: Options = DEFAULT_OPTIONS;
  private sinks: RecorderSinks = {};
  private readonly entries = new Map<string, NetworkEntry>();
  private readonly bytes = new Map<string, number>();
  private total = 0;
  private next = 0;
  private snapshot?: readonly NetworkEntry[];
  /** CDP responses whose blob body is still being read: loadingFinished waits for it. */
  private readonly reading = new Map<string, Promise<void>>();

  constructor(private readonly prefix: string, private readonly readBlob: BlobReader) {}

  get active() { return !!(this.sinks.entry || this.sinks.devtools); }
  observe(sinks: RecorderSinks) {
    this.sinks = sinks;
    if (this.active) return;
    this.entries.clear(); this.bytes.clear(); this.reading.clear(); this.total = 0; this.snapshot = undefined;
  }
  configure(options: NetworkInspectorOptions) {
    this.options = validOptions(this.options, options);
    this.evict();
  }
  log(): readonly NetworkEntry[] { return this.snapshot ??= Object.freeze([...this.entries.values()]); }

  private redact(headers: Record<string, unknown> | undefined): Record<string, string> {
    const names = new Set(this.options.redactHeaders.map(name => name.toLowerCase()));
    return Object.fromEntries(Object.entries(headers ?? {}).map(([name, value]) => [name, names.has(name.toLowerCase()) ? REDACTED : String(value)]));
  }
  private put(entry: NetworkEntry) {
    const size = entryBytes(entry);
    this.total += size - (this.bytes.get(entry.id) ?? 0);
    this.bytes.set(entry.id, size);
    this.entries.set(entry.id, entry);
    this.snapshot = undefined;
    this.evict();
    if (this.entries.has(entry.id)) this.sinks.entry?.(entry);
  }
  /** Drops the oldest finished entries, then the oldest of all, until both limits hold. */
  private evict() {
    while (this.entries.size > this.options.maxEntries || (this.total > this.options.maxLogSize && this.entries.size)) {
      const victim = [...this.entries.values()].find(ended) ?? this.entries.values().next().value!;
      this.entries.delete(victim.id);
      this.total -= this.bytes.get(victim.id) ?? 0;
      this.bytes.delete(victim.id);
      this.snapshot = undefined;
    }
  }
  private update(id: string, change: (entry: NetworkEntry) => Partial<NetworkEntry>): NetworkEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const updated = { ...entry, ...change(entry) };
    this.put(updated);
    return updated;
  }
  /** The entry while it is pending or open: events after it ended (an abort's completion) or was evicted are ignored. */
  private live(id: string) { const entry = this.entries.get(id); return entry && !ended(entry) ? entry : undefined; }
  private cdp(method: string, params: Record<string, unknown>) {
    this.sinks.devtools?.(method, { ...params, timestamp: performance.now() / 1000 });
  }
  /** A captured body, and for a blob the read of its first `maxBodySize` bytes (`data` stays absent if the read fails). */
  private body(input: BodyInput): { body: NetworkBody; read?: Promise<NetworkBody> } {
    const max = this.options.maxBodySize;
    if ("unreadable" in input) return { body: { base64: false, truncated: false } };
    if (!("blob" in input)) return { body: capture(input, max) };
    const { blob } = input;
    const body: NetworkBody = { base64: true, size: blob.size, truncated: blob.size > max };
    if (max === 0 || blob.size === 0) return { body: { ...body, data: "" } };
    return { body, read: this.readBlob({ ...blob, size: Math.min(blob.size, max) }).then(data => ({ ...body, data }), () => body) };
  }

  /** Starts an HTTP request or a WebSocket; returns its id, or undefined while nothing observes. */
  request(init: { source: NetworkSource; method: string; url: string; headers?: Record<string, unknown>; body?: BodyInput; stack?: string }): string | undefined {
    if (!this.active) return undefined;
    const id = `${this.prefix}${++this.next}`, startedAt = Date.now();
    const entry: NetworkEntry = { id, source: init.source, method: init.method.toUpperCase(), url: init.url, requestHeaders: this.redact(init.headers), initiator: callFrames(init.stack, 1), state: "pending", startedAt };
    const initiator = { type: "script", stack: { callFrames: entry.initiator.map(frame => ({ functionName: frame.functionName, scriptId: "", url: frame.url, lineNumber: frame.line - 1, columnNumber: frame.column - 1 })) } };
    if (init.source === "websocket") {
      this.put({ ...entry, frames: [] });
      this.cdp("Network.webSocketCreated", { requestId: id, url: init.url, initiator });
      this.cdp("Network.webSocketWillSendHandshakeRequest", { requestId: id, wallTime: startedAt / 1000, request: { headers: entry.requestHeaders } });
      return id;
    }
    const captured = init.body && this.body(init.body);
    const requestBody = captured?.body;
    this.put(requestBody ? { ...entry, requestBody } : entry);
    void captured?.read?.then(body => this.update(id, () => ({ requestBody: body })));
    const post = requestBody?.data === undefined ? {} : requestBody.base64 ? { hasPostData: true, postDataEntries: [{ bytes: requestBody.data }] } : { hasPostData: true, postData: requestBody.data };
    this.cdp("Network.requestWillBeSent", { requestId: id, loaderId: "", documentURL: "mobile", request: { url: init.url, method: entry.method, headers: entry.requestHeaders, ...post }, wallTime: startedAt / 1000, initiator, redirectHasExtraInfo: false, type: CDP_TYPES[init.source] });
    return id;
  }

  response(id: string, response: { status: number; headers?: Record<string, unknown>; url?: string }) {
    if (!this.live(id)) return;
    const entry = this.update(id, () => ({ status: response.status, responseHeaders: this.redact(response.headers), responseURL: response.url, respondedAt: Date.now() }));
    if (!entry) return;
    const mimeType = mime(entry.responseHeaders);
    this.cdp("Network.responseReceived", { requestId: id, loaderId: "", type: CDP_TYPES[entry.source], response: { url: response.url || entry.url, status: response.status, statusText: "", headers: entry.responseHeaders, mimeType, encodedDataLength: 0 }, hasExtraInfo: false });
  }

  /** A response body, or the next part of an incremental text response. */
  data(id: string, input: BodyInput) {
    const entry = this.live(id);
    if (!entry) return;
    const previous = entry.responseBody;
    let length: number;
    if ("text" in input && previous && !previous.base64 && previous.data !== undefined) {
      // Incremental text: append within the cap and count the whole size.
      const text = previous.data + input.text.slice(0, Math.max(0, this.options.maxBodySize - previous.data.length));
      length = input.text.length;
      const size = (previous.size ?? 0) + length;
      this.update(id, () => ({ responseBody: { data: text, base64: false, size, truncated: size > text.length } }));
    } else {
      const { body, read } = this.body(input);
      length = body.size ?? 0;
      this.update(id, () => ({ responseBody: body }));
      if (read) this.reading.set(id, read.then(done => { this.update(id, () => ({ responseBody: done })); }));
    }
    this.cdp("Network.dataReceived", { requestId: id, dataLength: length, encodedDataLength: length });
  }

  finish(id: string) {
    if (!this.live(id)) return;
    const entry = this.update(id, () => ({ state: "finished", endedAt: Date.now() }))!;
    const timestamp = performance.now() / 1000;
    const report = () => {
      const body = this.entries.get(id)?.responseBody ?? entry.responseBody;
      if (body?.data !== undefined) this.sinks.devtools?.("Expo(Network.receivedResponseBody)", { requestId: id, body: body.data, base64Encoded: body.base64 });
      this.sinks.devtools?.("Network.loadingFinished", { requestId: id, timestamp, encodedDataLength: body?.size ?? 0 });
    };
    const reading = this.reading.get(id);
    this.reading.delete(id);
    if (reading) void reading.then(report); else report();
  }

  fail(id: string, error: string, canceled = false) {
    const entry = this.live(id);
    if (!entry) return;
    this.update(id, () => ({ state: canceled ? "canceled" : "failed", error, endedAt: Date.now() }));
    this.cdp("Network.loadingFailed", { requestId: id, type: CDP_TYPES[entry.source], errorText: error, canceled });
  }

  socketOpened(id: string, protocol: string | undefined) {
    const headers: Record<string, string> = protocol ? { "Sec-WebSocket-Protocol": protocol } : {};
    if (!this.live(id) || !this.update(id, () => ({ state: "open", status: 101, responseHeaders: headers, respondedAt: Date.now() }))) return;
    this.cdp("Network.webSocketHandshakeResponseReceived", { requestId: id, response: { status: 101, statusText: "Switching Protocols", headers } });
  }

  frame(id: string, direction: NetworkFrame["direction"], input: { text: string } | { base64: string; size?: number } | { blob: BlobData }) {
    if (!this.live(id)) return;
    const at = Date.now(), opcode = "text" in input ? 1 : 2;
    const report = (payload: NetworkBody) => this.cdp(direction === "sent" ? "Network.webSocketFrameSent" : "Network.webSocketFrameReceived", { requestId: id, response: { opcode, mask: direction === "sent", payloadData: payload.data ?? "" } });
    const { body, read } = this.body(input);
    const frame: NetworkFrame = { ...body, direction, opcode, at };
    this.update(id, current => ({ frames: [...(current.frames ?? []), frame].slice(-MAX_FRAMES) }));
    if (!read) { report(body); return; }
    void read.then(done => {
      const replaced = { ...frame, ...done };
      this.update(id, current => ({ frames: (current.frames ?? []).map(item => item === frame ? replaced : item) }));
      report(done);
    });
  }

  socketClosed(id: string, code: number, reason: string) {
    if (!this.live(id) || !this.update(id, () => ({ state: "closed", close: { code, reason }, endedAt: Date.now() }))) return;
    this.cdp("Network.webSocketClosed", { requestId: id });
  }

  socketFailed(id: string, message: string) {
    if (!this.live(id) || !this.update(id, () => ({ state: "failed", error: message, endedAt: Date.now() }))) return;
    this.cdp("Network.webSocketFrameError", { requestId: id, errorMessage: message });
    this.cdp("Network.webSocketClosed", { requestId: id });
  }
}
