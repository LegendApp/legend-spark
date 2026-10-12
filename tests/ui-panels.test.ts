import { beforeEach, expect, test, vi } from "vitest";

type Listener = (event: Record<string, unknown>) => void;
const { platform, native, events } = vi.hoisted(() => ({
  platform: { OS: "macos" },
  native: { module: undefined as undefined | { call: ReturnType<typeof vi.fn> } },
  events: { listeners: [] as { listener: (event: Record<string, unknown>) => void; filter: { types: string[]; target: { field: string; value: string } }; removed: boolean }[] },
}));
vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("../packages/ui/src/panel-host", () => ({
  getPanelsNative: () => native.module,
  onPanelEvent: (listener: Listener, filter: { types: string[]; target: { field: string; value: string } }) => {
    const entry = { listener, filter, removed: false };
    events.listeners.push(entry);
    return { remove() { entry.removed = true; } };
  },
}));
import { getColorPanelAvailability, getFontPanelAvailability, sampleScreenColor, showColorPanel, showFontPanel } from "../packages/ui/src/panels";

// Routes like the desktop event hub: by type, then by the target field.
function emit(event: Record<string, unknown>) {
  for (const entry of events.listeners) if (!entry.removed && entry.filter.types.includes(event.type as string) && event[entry.filter.target.field] === entry.filter.target.value) entry.listener(event);
}
const resolved = { family: "Helvetica Neue", postScriptName: "HelveticaNeue-Bold", size: 14, weight: 700, italic: false };
let calls: [string, Record<string, unknown>][];
beforeEach(() => {
  platform.OS = "macos"; events.listeners = []; calls = [];
  native.module = { call: vi.fn(async (method: string, args: string) => {
    calls.push([method, JSON.parse(args)]);
    if (method === "fontPanel.show") return JSON.stringify(resolved);
    if (method === "sampleScreenColor") return '{"canceled":false,"color":"#a1b2c3"}';
    return "null";
  }) };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
const sessionOf = (index = 0) => calls.filter(([method]) => method.endsWith(".show"))[index]![1].sessionId as string;

test("availability is truthful per platform and module, and the sampler is a known feature", () => {
  expect(getColorPanelAvailability()).toEqual({ available: true });
  expect(getColorPanelAvailability("sampler")).toEqual({ available: true });
  expect(getFontPanelAvailability()).toEqual({ available: true });
  expect(() => getColorPanelAvailability("magnifier" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  native.module = undefined;
  expect(getFontPanelAvailability()).toEqual({ available: false, reason: "missing-module" });
  for (const os of ["windows", "ios", "android", "web"]) {
    platform.OS = os;
    expect(getColorPanelAvailability("sampler")).toEqual({ available: false, reason: "unsupported-platform" });
    expect(getFontPanelAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  }
});

test("unsupported platforms and a missing module reject with typed errors before any native call", async () => {
  platform.OS = "windows";
  await expect(showColorPanel({ onChange() {} })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(showFontPanel({ font: { family: "Helvetica", size: 12 }, onChange() {} })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(sampleScreenColor()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  platform.OS = "macos"; native.module = undefined;
  await expect(showColorPanel({ onChange() {} })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  expect(events.listeners.every(entry => entry.removed)).toBe(true);
});

test("color panel options are validated before native work", async () => {
  const onChange = () => {};
  for (const options of [{ onChange, color: "red" }, { onChange, color: "#11223344" }, { onChange, alpha: "yes" }, { onChange, mode: "crayons" }, {}, { onChange, onClose: 1 }]) {
    await expect(showColorPanel(options as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  }
  await expect(showColorPanel({ onChange, extra: undefined } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toEqual([]);
});

test("a color session streams validated colors, ends on dismissal, and close() after that touches nothing", async () => {
  const onChange = vi.fn(), onClose = vi.fn();
  const session = await showColorPanel({ color: "#FF000080", alpha: true, mode: "wheel", onChange, onClose });
  expect(calls[0]).toEqual(["colorPanel.show", { color: "#ff000080", alpha: true, mode: "wheel", sessionId: sessionOf() }]);
  emit({ type: "colorPanelChange", sessionId: sessionOf(), color: "#00ff0040" });
  emit({ type: "colorPanelChange", sessionId: "someone-else", color: "#000000ff" });
  emit({ type: "colorPanelChange", sessionId: sessionOf(), color: null });
  emit({ type: "colorPanelChange", sessionId: sessionOf(), color: "#00ff00" });
  expect(onChange.mock.calls).toEqual([[{ color: "#00ff0040" }]]);
  expect(console.error).toHaveBeenCalledTimes(2);
  emit({ type: "colorPanelClose", sessionId: sessionOf(), reason: "dismissed" });
  emit({ type: "colorPanelChange", sessionId: sessionOf(), color: "#ffffffff" });
  expect(onClose).toHaveBeenCalledExactlyOnceWith({ reason: "dismissed" });
  expect(onChange).toHaveBeenCalledTimes(1);
  await Promise.all([session.close(), session.close()]);
  expect(calls.filter(([method]) => method === "colorPanel.close")).toEqual([["colorPanel.close", { sessionId: sessionOf() }]]);
});

test("close() stops callbacks at once, joins concurrent calls and can retry after native failure", async () => {
  const onChange = vi.fn(), onClose = vi.fn();
  const session = await showColorPanel({ onChange, onClose });
  expect(calls[0]![1]).toMatchObject({ color: "", alpha: false, mode: "" });
  native.module!.call.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "E_BUSY" }));
  const first = session.close(), second = session.close();
  emit({ type: "colorPanelChange", sessionId: sessionOf(), color: "#123456" });
  emit({ type: "colorPanelClose", sessionId: sessionOf(), reason: "replaced" });
  expect(first).toBe(second);
  await expect(first).rejects.toMatchObject({ code: "E_BUSY" });
  await session.close();
  expect(onChange).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
});

test("a newer session replaces the older one; each hears only its own events", async () => {
  const older = { onChange: vi.fn(), onClose: vi.fn() }, newer = { onChange: vi.fn(), onClose: vi.fn() };
  await showColorPanel(older); await showColorPanel(newer);
  expect(sessionOf(0)).not.toBe(sessionOf(1));
  emit({ type: "colorPanelClose", sessionId: sessionOf(0), reason: "replaced" });
  emit({ type: "colorPanelChange", sessionId: sessionOf(1), color: "#abcdef" });
  expect(older.onClose).toHaveBeenCalledExactlyOnceWith({ reason: "replaced" });
  expect(newer.onChange).toHaveBeenCalledExactlyOnceWith({ color: "#abcdef" });
  expect(older.onChange).not.toHaveBeenCalled(); expect(newer.onClose).not.toHaveBeenCalled();
});

test("a failed show removes its listener and rejects with the native code", async () => {
  native.module!.call.mockRejectedValueOnce(Object.assign(new Error("Font family is not installed: Nope"), { code: "E_NOT_FOUND" }));
  await expect(showFontPanel({ font: { family: "Nope", size: 12 }, onChange() {} })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  expect(events.listeners).toHaveLength(1); expect(events.listeners[0]!.removed).toBe(true);
});

test("font panel: typed descriptor in, resolved font out, and every change is a validated font", async () => {
  const onChange = vi.fn();
  for (const font of [{ family: "", size: 12 }, { family: "A", size: 0 }, { family: "A", size: 12, weight: 450 }, { family: "A", size: 12, italic: 1 }, "Helvetica"]) {
    await expect(showFontPanel({ font: font as never, onChange })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  }
  await expect(showFontPanel({ font: { family: "A", size: 12, style: "bold" } as never, onChange })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  const session = await showFontPanel({ font: { family: "Helvetica Neue", size: 14, weight: 700 }, onChange });
  expect(calls[0]).toEqual(["fontPanel.show", { family: "Helvetica Neue", size: 14, weight: 700, italic: false, sessionId: sessionOf() }]);
  expect(session.font).toEqual(resolved);
  const italic = { ...resolved, postScriptName: "HelveticaNeue-BoldItalic", italic: true };
  emit({ type: "fontPanelChange", sessionId: sessionOf(), font: italic });
  emit({ type: "fontPanelChange", sessionId: sessionOf(), font: { ...italic, weight: 650 } });
  expect(onChange.mock.calls).toEqual([[{ font: italic }]]);
  await session.close();
  expect(calls.at(-1)).toEqual(["fontPanel.close", { sessionId: sessionOf() }]);
});

test("a malformed resolved font closes the session it opened and rejects", async () => {
  native.module!.call.mockResolvedValueOnce('{"family":"X"}');
  await expect(showFontPanel({ font: { family: "X", size: 9 }, onChange() {} })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(calls.map(([method]) => method)).toEqual(["fontPanel.close"]);
});

test("the eyedropper returns an opaque color or a distinct cancellation, and rejects malformed results", async () => {
  expect(await sampleScreenColor()).toEqual({ canceled: false, color: "#a1b2c3" });
  native.module!.call.mockResolvedValueOnce('{"canceled":true}');
  expect(await sampleScreenColor()).toEqual({ canceled: true });
  for (const result of ['{"canceled":false,"color":"#a1b2c3ff"}', '{"canceled":false}', "{}", "null"]) {
    native.module!.call.mockResolvedValueOnce(result);
    await expect(sampleScreenColor()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  // A sampler already running, and test driver mode, keep their native codes.
  for (const code of ["E_BUSY", "E_UNAVAILABLE"]) {
    native.module!.call.mockRejectedValueOnce(Object.assign(new Error("refused"), { code }));
    await expect(sampleScreenColor()).rejects.toMatchObject({ code });
  }
});
