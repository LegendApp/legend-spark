import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/logging against a mocked bridge: entries, level filtering, validation, wire shapes and availability.
const entries: unknown[][] = [];
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
const record = (method: string, args: string) => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(reply(method, JSON.parse(args)))); };
let call = record;
const platform = { OS: "macos" };
let module: object | null = { log: (...args: unknown[]) => { entries.push(args); }, call: (method: string, args: string) => call(method, args) };
const emitted: ((event: unknown) => void)[] = [];
class NativeEventEmitter { addListener(_name: string, listener: (event: unknown) => void) { emitted.push(listener); return { remove() {} }; } }
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: () => module }, NativeEventEmitter }));
const logging = await import("../packages/logging/src/index.ts");
beforeEach(async () => {
  platform.OS = "macos"; call = record; reply = () => null;
  await logging.configureLogging({ level: "info" });
  entries.length = 0; calls.length = 0;
});

test("a logger sends each entry with its time, level, category, message and fields as JSON", () => {
  vi.spyOn(Date, "now").mockReturnValue(1760220000123);
  const log = logging.createLogger("sync");
  expect(log.category).toBe("sync");
  log.info("Started");
  log.notice("Queued", { count: 3, names: ["a", "b"], nested: { ok: true, none: null } });
  log.error("Failed", { code: "E_TIMEOUT" });
  log.fault("Corrupt store");
  expect(entries).toEqual([
    [1760220000123, "info", "sync", "Started", "", false],
    [1760220000123, "notice", "sync", "Queued", '{"count":3,"names":["a","b"],"nested":{"ok":true,"none":null}}', false],
    [1760220000123, "error", "sync", "Failed", '{"code":"E_TIMEOUT"}', false],
    [1760220000123, "fault", "sync", "Corrupt store", "", false],
  ]);
  // Messages are private in the unified log unless the logger opts in.
  entries.length = 0;
  logging.createLogger("ui", { publicMessages: true }).info("Opened");
  expect(entries).toEqual([[1760220000123, "info", "ui", "Opened", "", true]]);
  vi.restoreAllMocks();
});

test("entries below the configured level never cross to native", async () => {
  const log = logging.createLogger("level");
  log.debug("hidden");
  expect(entries).toEqual([]);
  await logging.configureLogging({ level: "debug" });
  log.debug("shown");
  await logging.configureLogging({ level: "error" });
  log.info("hidden");
  log.notice("hidden");
  log.error("shown");
  expect(entries.map(entry => entry[3])).toEqual(["shown", "shown"]);
  // The new level applies to entries logged right after the call, before native acknowledges it.
  let acknowledge!: () => void;
  call = () => new Promise(resolve => { acknowledge = () => resolve("null"); });
  const configured = logging.configureLogging({ level: "debug" });
  log.debug("shown before the acknowledgment");
  acknowledge();
  await configured;
  expect(entries.map(entry => entry[3])).toEqual(["shown", "shown", "shown before the acknowledgment"]);
  // A rejected configuration restores the previous level.
  call = record;
  await logging.configureLogging({ level: "error" });
  call = () => Promise.reject(Object.assign(new Error("denied"), { code: "E_PERMISSION" }));
  await expect(logging.configureLogging({ level: "debug", files: { directory: "/private/logs" } })).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
  log.info("still hidden");
  expect(entries).toHaveLength(3);
});

test("configureLogging sends only the supplied settings; files null turns files off", async () => {
  await logging.configureLogging({ level: "notice", files: { directory: "file:///tmp/my%20logs", maxFileBytes: 4096, maxFiles: 1 } });
  await logging.configureLogging({ files: { maxFiles: 100 } });
  await logging.configureLogging({ files: null });
  await logging.configureLogging({});
  expect(calls).toEqual([
    { method: "configure", args: { level: "notice", files: { directory: "/tmp/my logs", maxFileBytes: 4096, maxFiles: 1 } } },
    { method: "configure", args: { files: { maxFiles: 100 } } },
    { method: "configure", args: { files: null } },
    { method: "configure", args: {} },
  ]);
});

test("invalid entries and options throw or reject before reaching native", async () => {
  for (const category of ["", "x".repeat(101), "a\0b", 3]) expect(() => logging.createLogger(category as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  const log = logging.createLogger("checks");
  expect(() => log.info(42 as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  for (const fields of [[1], "text", null]) expect(() => log.info("x", fields as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  for (const options of [{ public: true }, { publicMessages: "yes" }]) expect(() => logging.createLogger("x", options as never)).toThrow(expect.objectContaining({ code: options.public ? "E_UNSUPPORTED_OPTION" : "E_INVALID_ARGUMENT" }));
  expect(entries).toEqual([]);

  const rejected: [unknown, string][] = [
    [null, "E_INVALID_ARGUMENT"], [{ level: "verbose" }, "E_INVALID_ARGUMENT"], [{ colors: true }, "E_UNSUPPORTED_OPTION"], [{ level: undefined, extra: undefined }, "E_UNSUPPORTED_OPTION"],
    [{ files: { directory: "relative/logs" } }, "E_INVALID_ARGUMENT"], [{ files: { maxFileBytes: 4095 } }, "E_INVALID_ARGUMENT"], [{ files: { maxFileBytes: 1.5e4 + 0.5 } }, "E_INVALID_ARGUMENT"],
    [{ files: { maxFileBytes: 1024 ** 3 + 1 } }, "E_INVALID_ARGUMENT"], [{ files: { maxFiles: 0 } }, "E_INVALID_ARGUMENT"], [{ files: { maxFiles: 101 } }, "E_INVALID_ARGUMENT"],
    [{ files: { compress: true } }, "E_UNSUPPORTED_OPTION"], [{ files: "on" }, "E_INVALID_ARGUMENT"],
  ];
  for (const [options, code] of rejected) await expect(logging.configureLogging(options as never)).rejects.toMatchObject({ name: "SparkError", code });
  await expect(logging.exportDiagnostics("Diagnostics.zip")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(logging.exportDiagnostics("/tmp/d.zip", { info: [] as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(logging.exportDiagnostics("/tmp/d.zip", { upload: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toEqual([]);
});

test("fields JSON cannot hold are marked, never thrown, so a catch block's error is still logged", () => {
  const log = logging.createLogger("fields");
  const cyclic: Record<string, unknown> = { name: "loop" };
  cyclic.self = cyclic;
  const shared = { id: 1 };
  const failure = Object.assign(new TypeError("bad input"), { extra: 1n });
  log.error("Import failed", { error: failure, cyclic, pair: [shared, shared], big: 12n, skip: undefined, broken: { toJSON() { throw new Error("no JSON"); } } });
  log.error("Only broken", { broken: { toJSON() { throw new Error("no JSON"); } } });
  expect(entries.map(entry => JSON.parse(entry[4] as string))).toEqual([
    { unserializable: "no JSON" },
    { unserializable: "no JSON" },
  ]);
  entries.length = 0;
  log.error("Import failed", { error: failure, cyclic, pair: [shared, shared], big: 12n, skip: undefined });
  expect(JSON.parse(entries[0]![4] as string)).toEqual({ error: { name: "TypeError", message: "bad input" }, cyclic: { name: "loop", self: "[Circular]" }, pair: [{ id: 1 }, { id: 1 }], big: "12n" });
});

test("getLogFiles, flushLogs and exportDiagnostics return validated results", async () => {
  const files = [{ path: "/tmp/logs/app.log", bytes: 120, modifiedAt: 1760220000123 }, { path: "/tmp/logs/app.1.log", bytes: 4090, modifiedAt: 1760210000000 }];
  reply = method => method === "files" ? files : null;
  expect(await logging.getLogFiles()).toEqual(files);
  await logging.flushLogs();
  reply = (_, args) => ({ path: args.path, bytes: 2048, entries: ["diagnostics.json", "logs/app.log"] });
  expect(await logging.exportDiagnostics("file:///tmp/Kitchen%20Sink.zip", { info: { ticket: "KS-1" } })).toEqual({ path: "/tmp/Kitchen Sink.zip", bytes: 2048, entries: ["diagnostics.json", "logs/app.log"] });
  await logging.exportDiagnostics("/tmp/plain.zip");
  expect(calls).toEqual([
    { method: "files", args: {} }, { method: "flush", args: {} },
    { method: "exportDiagnostics", args: { path: "/tmp/Kitchen Sink.zip", info: { ticket: "KS-1" } } },
    { method: "exportDiagnostics", args: { path: "/tmp/plain.zip" } },
  ]);

  // A failed write surfaces at the next flush with its code and the entries lost; malformed native results reject E_INVALID_DATA.
  call = () => Promise.reject(Object.assign(new Error("No space left on device (3 entries not written)"), { code: "E_NO_SPACE", userInfo: { dropped: 3 } }));
  const flushed = await logging.flushLogs().catch(error => error);
  expect(flushed).toBeInstanceOf(logging.LogWriteError);
  expect(flushed).toMatchObject({ name: "LogWriteError", code: "E_NO_SPACE", dropped: 3, message: "No space left on device (3 entries not written)" });
  call = record;
  for (const value of [null, [{ path: "/a", bytes: -1, modifiedAt: 0 }], [{ path: 1, bytes: 1, modifiedAt: 0 }]]) {
    reply = () => value;
    await expect(logging.getLogFiles()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  for (const value of [{ path: "/tmp/other.zip", bytes: 1, entries: ["diagnostics.json"] }, { path: "/tmp/d.zip", bytes: 0, entries: ["diagnostics.json"] }, { path: "/tmp/d.zip", bytes: 1, entries: [] }]) {
    reply = () => value;
    await expect(logging.exportDiagnostics("/tmp/d.zip")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
});

test("addLoggingErrorListener reports failures and recovery with counts until removed", () => {
  const events: unknown[] = [];
  const subscription = logging.addLoggingErrorListener(event => events.push(event));
  const emit = (event: unknown) => emitted.forEach(listener => listener(event));
  emit({ type: "loggingError", code: "E_PERMISSION", message: "Permission denied", dropped: 1 });
  emit({ type: "loggingError", code: "E_BUSY", message: "The log queue held 10000 entries", dropped: 12, recovered: true });
  emit({ type: "somethingElse", code: "E_BUSY", message: "x", dropped: 1 });
  subscription.remove();
  emit({ type: "loggingError", code: "E_BUSY", message: "x", dropped: 1 });
  expect(events).toEqual([
    { code: "E_PERMISSION_DENIED", message: "Permission denied", dropped: 1, recovered: false },
    { code: "E_BUSY", message: "The log queue held 10000 entries", dropped: 12, recovered: true },
  ]);
});

test("availability is reported per feature; Windows and a missing module are typed failures", async () => {
  expect(logging.getLoggingAvailability()).toEqual({ available: true });
  for (const feature of ["systemLog", "files", "diagnostics"] as const) expect(logging.getLoggingAvailability(feature)).toEqual({ available: true });
  expect(() => logging.getLoggingAvailability("crashes" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));

  platform.OS = "windows";
  for (const feature of [undefined, "systemLog", "files", "diagnostics"] as const) expect(logging.getLoggingAvailability(feature)).toEqual({ available: false, reason: "unsupported-platform" });
  expect(() => logging.createLogger("app")).toThrow(expect.objectContaining({ name: "SparkError", code: "E_UNSUPPORTED_PLATFORM" }));
  for (const operation of [() => logging.configureLogging({ level: "debug" }), () => logging.flushLogs(), () => logging.getLogFiles(), () => logging.exportDiagnostics("C:\\Temp\\d.zip")]) {
    await expect(operation()).rejects.toMatchObject({ name: "SparkError", code: "E_UNSUPPORTED_PLATFORM" });
  }
  // Validation still comes first.
  await expect(logging.configureLogging({ level: "loud" as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toEqual([]);

  platform.OS = "macos";
  module = null;
  vi.resetModules();
  const missing = await import("../packages/logging/src/index.ts");
  expect(missing.getLoggingAvailability("files")).toEqual({ available: false, reason: "missing-module" });
  expect(() => missing.createLogger("app")).toThrow(expect.objectContaining({ code: "E_MODULE_UNAVAILABLE" }));
});
