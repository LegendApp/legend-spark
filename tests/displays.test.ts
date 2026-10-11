import { beforeEach, expect, test, vi } from "vitest";
const { call, platform, listeners } = vi.hoisted(() => ({ call: vi.fn(), platform: { OS: "macos" }, listeners: new Set<(event: any) => void>() }));
vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("../packages/desktop-windows/src/NativeDesktopWindowManager", () => ({ default: { call } }));
vi.mock("@legendapp/spark-desktop-app/src/events", () => ({ onDesktopEvent: (fn: (event: any) => void) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } }));
import { addDisplayListener, getDisplayAvailability, getDisplayDetails, type DisplayDetails } from "../packages/desktop/displays";

const builtIn: DisplayDetails = {
  id: "1", persistentId: "A", name: "Built-in Retina Display", primary: true, origin: { x: 0, y: 0 }, size: { width: 1512, height: 982 },
  workArea: { x: 0, y: 32, width: 1512, height: 950 }, scaleFactor: 2, safeArea: { top: 32, left: 0, bottom: 0, right: 0 },
  refreshRate: { minimum: 24, maximum: 120, variable: true }, colorSpace: { name: "Color LCD", gamut: "p3" }, edrHeadroom: { current: 1, potential: 16, reference: null },
};
const external: DisplayDetails = {
  ...builtIn, id: "2", persistentId: "B", name: "Studio Display", primary: false, origin: { x: 1512, y: 0 }, size: { width: 2560, height: 1440 },
  workArea: { x: 0, y: 0, width: 2560, height: 1440 }, safeArea: { top: 0, left: 0, bottom: 0, right: 0 },
  refreshRate: { minimum: 60, maximum: 60, variable: false }, colorSpace: { name: "Studio Display", gamut: "p3" }, edrHeadroom: { current: 1, potential: 1, reference: null },
};
const emit = (sequence: number, displays: unknown) => listeners.forEach(listener => listener({ type: "displayDetailsChanged", sequence, displays }));
const tick = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
let snapshot: { sequence: number; displays: unknown };
beforeEach(() => {
  platform.OS = "macos"; listeners.clear(); snapshot = { sequence: 3, displays: [builtIn] };
  call.mockReset().mockImplementation(async (method: string) => JSON.stringify(method === "displayDetails" ? [builtIn, external] : method === "observeDisplays" ? snapshot : null));
});

test("availability is macOS only and answered without a native call; other platforms reject typed", async () => {
  expect(getDisplayAvailability()).toEqual({ available: true });
  for (const os of ["windows", "ios", "web"]) {
    platform.OS = os;
    expect(getDisplayAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
    await expect(getDisplayDetails()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(addDisplayListener(() => {})).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  }
  expect(call).not.toHaveBeenCalled();
});

test("details carry arrangement, safe area, refresh, color space and EDR headroom, validated", async () => {
  expect(await getDisplayDetails()).toEqual([builtIn, external]);
  const malformed: unknown[] = [
    [{ ...builtIn, refreshRate: { minimum: 24, maximum: 120, variable: false } }],
    [{ ...builtIn, refreshRate: { minimum: 120, maximum: 60, variable: false } }],
    [{ ...builtIn, colorSpace: { name: "Color LCD", gamut: "rec2020" } }],
    [{ ...builtIn, edrHeadroom: { current: 1, potential: 16 } }],
    [{ ...builtIn, safeArea: { top: 32 } }],
    [{ ...builtIn, origin: undefined }],
    [builtIn, { ...external, primary: true }],
    [builtIn, { ...external, id: "1" }],
    [],
  ];
  for (const value of malformed) {
    call.mockResolvedValueOnce(JSON.stringify(value));
    await expect(getDisplayDetails()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
});

test("listeners get added, removed and changed fields, never an unchanged list or an event older than their snapshot", async () => {
  const events: unknown[] = [];
  const registration = await addDisplayListener(event => events.push(event));
  expect(call.mock.calls.map(([method]) => method)).toEqual(["observeDisplays"]);
  emit(3, [builtIn, external]); // Not newer than the snapshot.
  emit(4, [builtIn]);
  expect(events).toEqual([]);
  emit(5, [builtIn, external]);
  expect(events.at(-1)).toEqual({ displays: [builtIn, external], added: ["2"], removed: [], changed: [] });
  const promoted = { ...external, primary: true, origin: { x: 0, y: 0 } }, moved = { ...builtIn, primary: false, origin: { x: -1512, y: 458 } };
  emit(6, [moved, promoted]);
  expect(events.at(-1)).toMatchObject({ added: [], removed: [], changed: [{ id: "1", fields: ["primary", "origin"] }, { id: "2", fields: ["primary", "origin"] }] });
  const mode = { ...promoted, size: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, refreshRate: { minimum: 48, maximum: 144, variable: true } };
  emit(7, [moved, mode]);
  expect(events.at(-1)).toMatchObject({ changed: [{ id: "2", fields: ["size", "workArea", "scaleFactor", "refreshRate"] }] });
  emit(8, [{ ...moved, colorSpace: { name: "sRGB IEC61966-2.1", gamut: "srgb" }, edrHeadroom: { current: 2.5, potential: 16, reference: 4 } }, mode]);
  expect(events.at(-1)).toMatchObject({ changed: [{ id: "1", fields: ["colorSpace", "edrHeadroom"] }] });
  emit(9, [{ ...builtIn }]);
  expect(events.at(-1)).toMatchObject({ added: [], removed: ["2"] });
  expect(events).toHaveLength(5);
  await registration.remove();
  emit(10, [builtIn, external]);
  expect(events).toHaveLength(5);
  expect(call.mock.calls.map(([method]) => method)).toEqual(["observeDisplays", "unobserveDisplays"]);
});

test("events that arrive before the snapshot are applied after it; malformed events and listener failures go to onError", async () => {
  let resolve!: (value: string) => void;
  call.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
  const events: unknown[] = [], errors: unknown[] = [];
  const pending = addDisplayListener(event => { events.push(event); throw new Error("listener"); }, { onError: error => errors.push(error) });
  await tick();
  emit(2, [builtIn, external]); // Older than the snapshot: dropped.
  emit(4, [builtIn, external]);
  resolve(JSON.stringify(snapshot));
  const registration = await pending;
  expect(events).toEqual([{ displays: [builtIn, external], added: ["2"], removed: [], changed: [] }]);
  emit(5, [{ ...builtIn, scaleFactor: "2" }]);
  expect(errors.map(error => (error as { code: string }).code)).toEqual(["E_NATIVE", "E_INVALID_DATA"]);
  await registration.remove();
});

test("invalid listeners reject before native calls; a failed observation unsubscribes", async () => {
  await expect(addDisplayListener(undefined as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(addDisplayListener(() => {}, { since: 1 } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(addDisplayListener(() => {}, { since: undefined } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(addDisplayListener(() => {}, { onError: 1 } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(call).not.toHaveBeenCalled();
  call.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "E_NATIVE" }));
  await expect(addDisplayListener(() => {})).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(listeners.size).toBe(0);
});

test("a snapshot that fails validation releases the native observation it started", async () => {
  for (const bad of [{ sequence: 1, displays: [{ ...builtIn, refreshRate: null }] }, { sequence: "1", displays: [builtIn] }, null]) {
    call.mockClear(); snapshot = bad as never;
    await expect(addDisplayListener(() => {})).rejects.toMatchObject({ code: "E_INVALID_DATA" });
    expect(call.mock.calls.map(([method]) => method)).toEqual(["observeDisplays", "unobserveDisplays"]);
    expect(listeners.size).toBe(0);
  }
  // A failed release is reported; the snapshot's error is the one thrown.
  const errors: unknown[] = [];
  snapshot = { sequence: 1, displays: [] };
  call.mockImplementation(async (method: string) => {
    if (method === "unobserveDisplays") throw Object.assign(new Error("gone"), { code: "E_NATIVE" });
    return JSON.stringify(snapshot);
  });
  await expect(addDisplayListener(() => {}, { onError: error => errors.push(error) })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(errors).toMatchObject([{ code: "E_NATIVE" }]);
});

test("native key order is not a change", async () => {
  const events: unknown[] = [];
  const registration = await addDisplayListener(event => events.push(event));
  const reordered = Object.fromEntries(Object.entries(builtIn).reverse().map(([key, value]) =>
    [key, value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse()) : value]));
  emit(4, [reordered]);
  expect(events).toEqual([]);
  emit(5, [{ ...reordered, refreshRate: { variable: false, maximum: 60, minimum: 60 } }]);
  expect(events).toMatchObject([{ changed: [{ id: "1", fields: ["refreshRate"] }] }]);
  await registration.remove();
});
