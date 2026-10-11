import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/printing against a mocked bridge: validation, wire shapes, results and availability.
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
const record = (method: string, args: string) => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(reply(method, JSON.parse(args)))); };
let call = record;
const platform = { OS: "macos" };
const mounted = new Map<object, number>();
const mockReactNative = (module: object | null) => vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: () => module }, findNodeHandle: (view: object) => mounted.get(view) ?? null }));
mockReactNative({ call: (method: string, args: string) => call(method, args) });
const printing = await import("../packages/printing/src/index.ts");
beforeEach(() => { platform.OS = "macos"; call = record; calls.length = 0; reply = () => null; });

const a4 = { paperSize: printing.paperSizes.a4, orientation: "landscape", margins: { top: 36, right: 54, bottom: 72, left: 18 } } as const;
const text = { type: "text", text: "Hello" } as const;

test("exportPDF sends validated content, path and page setup and returns the typed result", async () => {
  reply = (_, args) => ({ path: args.path, numberOfPages: 3, pageSetup: args.pageSetup });
  expect(await printing.exportPDF(text, "/tmp/out.pdf", { pageSetup: a4, title: "Report" })).toEqual({ path: "/tmp/out.pdf", numberOfPages: 3, pageSetup: a4 });
  expect(calls).toEqual([{ method: "exportPDF", args: { content: text, path: "/tmp/out.pdf", pageSetup: a4, title: "Report" } }]);
  // File URLs become native paths; omitted options stay off the wire, so native uses the system setup.
  calls.length = 0;
  reply = (_, args) => ({ path: args.path, numberOfPages: 1, pageSetup: a4 });
  await printing.exportPDF({ type: "pdf", path: "file:///tmp/in%20put.pdf" }, "file:///tmp/out.pdf");
  expect(calls[0]!.args).toEqual({ content: { type: "pdf", path: "/tmp/in put.pdf" }, path: "/tmp/out.pdf" });
});

test("every content type reaches the bridge in its wire form; a view ref becomes its mounted tag", async () => {
  reply = (_, args) => ({ path: args.path, numberOfPages: 1, pageSetup: a4 });
  const view = {};
  mounted.set(view, 42);
  for (const [input, wire] of [
    [{ type: "html", html: "<h1>Hi</h1>" }, { type: "html", html: "<h1>Hi</h1>" }],
    [{ type: "window", windowId: "main" }, { type: "window", windowId: "main" }],
    [{ type: "view", view }, { type: "view", tag: 42 }],
  ] as const) {
    calls.length = 0;
    await printing.exportPDF(input as never, "/tmp/out.pdf");
    expect(calls[0]!.args.content).toEqual(wire);
  }
  await expect(printing.exportPDF({ type: "view", view: {} as never }, "/tmp/out.pdf")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});

test("print and showPageSetup return printed, canceled or a typed rejection", async () => {
  reply = () => ({ canceled: false, pageSetup: a4 });
  expect(await printing.print(text, { pageSetup: a4, windowId: "main", title: "Notes" })).toEqual({ canceled: false, pageSetup: a4 });
  expect(calls[0]).toEqual({ method: "print", args: { content: text, pageSetup: a4, windowId: "main", jobTitle: "Notes" } });
  reply = () => ({ canceled: true });
  expect(await printing.print(text)).toEqual({ canceled: true });
  expect(await printing.showPageSetup({ pageSetup: a4 })).toEqual({ canceled: true });
  reply = () => ({ canceled: false, pageSetup: { ...a4, orientation: "portrait" } });
  expect(await printing.showPageSetup({ windowId: "main" })).toEqual({ canceled: false, pageSetup: { ...a4, orientation: "portrait" } });
  expect(calls.at(-1)).toEqual({ method: "pageSetup", args: { windowId: "main" } });
  reply = () => a4;
  expect(await printing.getDefaultPageSetup()).toEqual(a4);
  // Native failures keep their codes; anything else becomes E_NATIVE.
  for (const code of ["E_BUSY", "E_NOT_FOUND", "E_NATIVE", "E_SOMETHING"]) {
    call = () => Promise.reject(Object.assign(new Error("failed"), { code }));
    await expect(printing.print(text)).rejects.toMatchObject({ name: "SparkError", code: code === "E_SOMETHING" ? "E_NATIVE" : code });
  }
});

test("malformed native results reject E_INVALID_DATA", async () => {
  for (const value of [null, { canceled: false }, { canceled: true, pageSetup: a4 }, { canceled: false, pageSetup: { ...a4, orientation: "sideways" } }, { canceled: false, pageSetup: { ...a4, margins: { top: 1 } } }]) {
    reply = () => value;
    await expect(printing.print(text)).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  for (const value of [{ path: "/tmp/other.pdf", numberOfPages: 1, pageSetup: a4 }, { path: "/tmp/out.pdf", numberOfPages: 0, pageSetup: a4 }, { path: "/tmp/out.pdf", numberOfPages: 1.5, pageSetup: a4 }]) {
    reply = () => value;
    await expect(printing.exportPDF(text, "/tmp/out.pdf")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  reply = () => ({ ...a4, paperSize: { width: "612", height: 792 } });
  await expect(printing.getDefaultPageSetup()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("content, page setup and options are validated before any native call", async () => {
  const setups: unknown[] = [
    null, { ...a4, paperSize: { width: 900, height: 600 } }, { ...a4, paperSize: { width: 0, height: 600 } }, { ...a4, paperSize: { width: 600, height: 20000 } },
    { ...a4, orientation: "upside-down" }, { ...a4, margins: { ...a4.margins, top: -1 } }, { ...a4, margins: { ...a4.margins, left: Number.NaN } },
    { ...a4, margins: { top: 0, right: 0, bottom: 0 } }, { paperSize: a4.paperSize, orientation: "portrait" },
    // Leaves less than an inch: 595.28 wide in portrait minus 300 + 240.
    { ...a4, orientation: "portrait", margins: { top: 0, right: 300, bottom: 0, left: 240 } },
  ];
  for (const pageSetup of setups) await expect(printing.exportPDF(text, "/tmp/out.pdf", { pageSetup: pageSetup as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const contents: unknown[] = [null, "hello", { type: "text", text: "" }, { type: "text" }, { type: "html", html: 1 }, { type: "pdf", path: "relative.pdf" }, { type: "window", windowId: "bad id" }, { type: "window" }, { type: "view", view: null }, { type: "image", uri: "x" }];
  for (const content of contents) await expect(printing.exportPDF(content as never, "/tmp/out.pdf")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(printing.exportPDF(text, "out.pdf")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(printing.print(text, { windowId: "" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(printing.print(text, { title: "" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  // Unknown keys are unsupported options, even when undefined.
  await expect(printing.print(text, { copies: 2 } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(printing.exportPDF(text, "/tmp/out.pdf", { overwrite: undefined } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(printing.showPageSetup({ pageSetup: { ...a4, scale: 1 } } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(printing.exportPDF({ ...text, font: "Menlo" } as never, "/tmp/out.pdf")).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toHaveLength(0);
});

test("availability is per feature; Windows and other platforms reject typed after validation", async () => {
  for (const feature of [undefined, "printPanel", "pageSetup", "pdfExport"] as const) expect(printing.getPrintingAvailability(feature)).toEqual({ available: true });
  expect(() => printing.getPrintingAvailability("preview" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  vi.resetModules();
  mockReactNative(null);
  const missing = await import("../packages/printing/src/index.ts");
  expect(missing.getPrintingAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(missing.exportPDF(text, "/tmp/out.pdf")).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  for (const os of ["windows", "ios", "web"]) {
    platform.OS = os;
    for (const feature of [undefined, "printPanel", "pageSetup", "pdfExport"] as const) expect(printing.getPrintingAvailability(feature)).toEqual({ available: false, reason: "unsupported-platform" });
    await expect(printing.print(text)).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(printing.showPageSetup()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(printing.getDefaultPageSetup()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(printing.exportPDF(text, os === "windows" ? "C:\\out.pdf" : "/tmp/out.pdf")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(printing.print({ type: "text", text: "" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  }
  expect(calls).toHaveLength(0);
});
