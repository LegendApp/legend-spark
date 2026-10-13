import { beforeEach, expect, test, vi } from "vitest";
// Window choreography over a mocked native transport (packages/desktop-windows/src/choreography.ts). The animator, Reduce
// Motion, the virtual clock, interruption, close transitions, focus handoff and attachments are native: tests/window.native.mm
// (choreography suite). Driver flows: e2e/flows/multiwindow/choreography-*.yaml.
const mocks = vi.hoisted(() => ({
  platform: { OS: "macos" },
  calls: [] as [string, any][],
  results: new Map<string, unknown>(),
  failures: new Map<string, Error>(),
  listeners: new Map<string, (event: any) => void>(),
}));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("../packages/desktop-windows/src/api", () => ({
  getWindowAvailability: () => ({ available: true }),
  openWindow: vi.fn(async (options: any) => { mocks.calls.push(["open", options]); return { id: options.id, bounds: { displayId: "1", x: 10, y: 20, width: 400, height: 300 } }; }),
}));
vi.mock("../packages/desktop-windows/src/transport", () => ({
  record: (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value),
  windowCall: vi.fn(async (method: string, args: any, validate: (value: unknown) => boolean) => {
    mocks.calls.push([method, args]);
    const failure = mocks.failures.get(method); if (failure) throw failure;
    const value = mocks.results.has(method) ? mocks.results.get(method) : { finished: true, reducedMotion: false };
    if (!validate(value)) throw new Error("invalid");
    return value;
  }),
  windowCommand: vi.fn(async (method: string, args: any) => { mocks.calls.push([method, args]); const failure = mocks.failures.get(method); if (failure) throw failure; }),
  subscribeToWindowInstance: vi.fn(async (id: string, listener: (event: any) => void) => { mocks.listeners.set(id, listener); return { remove: async () => { mocks.listeners.delete(id); } }; }),
}));
import { SparkError } from "../packages/desktop-app/src/contracts";
import * as choreography from "../packages/desktop-windows/src/choreography";

const calls = (method: string) => mocks.calls.filter(([name]) => name === method).map(([, args]) => args);
const code = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return (error as SparkError).code; } return "resolved"; };
const display = { displayId: "1", x: 0, y: 50, width: 40, height: 30 };
const row = { windowId: "main", x: 12, y: 80, width: 300, height: 28 };

beforeEach(() => {
  mocks.platform.OS = "macos"; mocks.calls.length = 0; mocks.results.clear(); mocks.failures.clear(); mocks.listeners.clear();
});

test("availability is truthful per platform and every operation rejects E_UNSUPPORTED_PLATFORM on Windows before any native call", async () => {
  for (const feature of ["zoom", "frame", "closeTransition", "attach"] as const) expect(choreography.getWindowChoreographyAvailability(feature)).toEqual({ available: true });
  expect(() => choreography.getWindowChoreographyAvailability("tabs" as never)).toThrow(SparkError);
  mocks.platform.OS = "windows";
  expect(choreography.getWindowChoreographyAvailability("zoom")).toEqual({ available: false, reason: "unsupported-platform" });
  const bounds = { displayId: "1", x: 0, y: 0, width: 400, height: 300 };
  expect(await code(choreography.animateWindowBounds("a", bounds))).toBe("E_UNSUPPORTED_PLATFORM");
  expect(await code(choreography.stopWindowAnimation("a"))).toBe("E_UNSUPPORTED_PLATFORM");
  expect(await code(choreography.setWindowCloseTransition("a", { to: display }))).toBe("E_UNSUPPORTED_PLATFORM");
  expect(await code(choreography.openWindowFrom({ id: "a", component: "main" }, { from: display }))).toBe("E_UNSUPPORTED_PLATFORM");
  expect(await code(choreography.attachWindow("a", "b", { edge: "trailing" }))).toBe("E_UNSUPPORTED_PLATFORM");
  expect(mocks.calls).toEqual([]);
});

test("frame animations pass validated bounds and timing, and report interruption and Reduce Motion as native reports them", async () => {
  const bounds = { displayId: "1", x: 0, y: 0, width: 400, height: 300 };
  expect(await choreography.animateWindowBounds("a", bounds)).toEqual({ finished: true, reducedMotion: false });
  expect(calls("animate")).toEqual([{ id: "a", bounds, durationMs: 250, easing: "easeInOut" }]);
  mocks.results.set("animate", { finished: false, reducedMotion: true, extra: 1 });
  expect(await choreography.animateWindowBounds("a", bounds, { durationMs: 0, easing: "linear" })).toEqual({ finished: false, reducedMotion: true });
  expect(await code(choreography.animateWindowBounds("a", bounds, { durationMs: 5001 }))).toBe("E_INVALID_ARGUMENT");
  expect(await code(choreography.animateWindowBounds("a", bounds, { easing: "spring" as never }))).toBe("E_INVALID_ARGUMENT");
  expect(await code(choreography.animateWindowBounds("a", bounds, { delayMs: 1 } as never))).toBe("E_UNSUPPORTED_OPTION");
  expect(await code(choreography.animateWindowBounds("a", { ...bounds, width: 10 }))).toBe("E_INVALID_ARGUMENT");
  await choreography.stopWindowAnimation("a");
  expect(calls("stopAnimation")).toEqual([{ id: "a" }]);
});

test("a zoom opens the window hidden at its frame, sets the close transition back into the source, then grows from it", async () => {
  const zoom = await choreography.openWindowFrom({ id: "detail", component: "main", size: { width: 400, height: 300 } }, { from: row, focusOnClose: "main", transition: { durationMs: 300, easing: "easeOut" } });
  expect(zoom.id).toBe("detail");
  expect(zoom.bounds).toEqual({ displayId: "1", x: 10, y: 20, width: 400, height: 300 });
  expect(await zoom.finished).toEqual({ finished: true, reducedMotion: false });
  expect(mocks.calls.map(([name]) => name)).toEqual(["open", "closeTransition", "zoomIn"]);
  expect(calls("open")[0].show).toBe(false);
  expect(calls("closeTransition")).toEqual([{ id: "detail", transition: { to: row, focus: "main", durationMs: 300, easing: "easeOut" } }]);
  expect(calls("zoomIn")).toEqual([{ id: "detail", from: row, durationMs: 300, easing: "easeOut" }]);
  // closeTo: null opens without a close transition; a different closeTo shrinks somewhere else.
  mocks.calls.length = 0;
  await (await choreography.openWindowFrom({ id: "b", component: "main" }, { from: display, closeTo: null })).finished;
  expect(calls("closeTransition")).toEqual([]);
  await (await choreography.openWindowFrom({ id: "c", component: "main" }, { from: display, closeTo: row })).finished;
  expect(calls("closeTransition")[0].transition.to).toEqual(row);
});

test("a zoom that cannot start closes the window it opened and rejects with the cause", async () => {
  mocks.failures.set("zoomIn", new SparkError("E_NOT_FOUND", "The window of the rectangle has closed"));
  const zoom = await choreography.openWindowFrom({ id: "d", component: "main" }, { from: row });
  expect(await code(zoom.finished)).toBe("E_NOT_FOUND");
  expect(calls("discard")).toEqual([{ id: "d" }]);
  mocks.failures.set("discard", new Error("gone"));
  const both = await choreography.openWindowFrom({ id: "e", component: "main" }, { from: row });
  const error = await both.finished.catch(cause => cause);
  expect(error.code).toBe("E_NATIVE");
  expect((error.cause as AggregateError).errors).toHaveLength(2);
});

test("a failed zoom whose finished promise is ignored raises no unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", listener);
  try {
    mocks.failures.set("zoomIn", new SparkError("E_NOT_FOUND", "The window of the rectangle has closed"));
    await choreography.openWindowFrom({ id: "f", component: "main" }, { from: row });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(unhandled).toEqual([]);
    expect(calls("discard")).toEqual([{ id: "f" }]);
  } finally { process.off("unhandledRejection", listener); }
});

test("zoom and close transition options are validated before anything opens", async () => {
  const open = (options: any, zoom: any) => code(choreography.openWindowFrom({ id: "z", component: "main", ...options }, zoom));
  expect(await open({ show: false }, { from: display })).toBe("E_INVALID_ARGUMENT");
  expect(await open({ modal: true, parentId: "main" }, { from: display })).toBe("E_INVALID_ARGUMENT");
  expect(await open({ tabbedWith: "main" }, { from: display })).toBe("E_INVALID_ARGUMENT");
  expect(await open({}, { from: { ...display, width: -1 } })).toBe("E_INVALID_ARGUMENT");
  expect(await open({}, { from: { windowId: "main", displayId: "1", x: 0, y: 0, width: 1, height: 1 } })).toBe("E_UNSUPPORTED_OPTION");
  expect(await open({}, { from: display, focusOnClose: "z" })).toBe("E_INVALID_ARGUMENT");
  expect(await open({}, { from: display, bounce: true })).toBe("E_UNSUPPORTED_OPTION");
  expect(mocks.calls).toEqual([]);
  await choreography.setWindowCloseTransition("a", { to: null });
  await choreography.setWindowCloseTransition("a", null);
  expect(calls("closeTransition")).toEqual([{ id: "a", transition: { to: null, durationMs: 250, easing: "easeInOut" } }, { id: "a", transition: null }]);
});

test("an attachment docks with defaults, tracks its own docking events, and removing it detaches only itself", async () => {
  const changes: boolean[] = [];
  const attachment = await choreography.attachWindow("palette", "main", { edge: "trailing", hideWhenInactive: true, onChange: ({ attached }) => changes.push(attached) });
  expect(calls("attach")[0]).toMatchObject({ id: "palette", parentId: "main", edge: "trailing", align: "start", gap: 0, magnetic: 24, hideWhenInactive: true, durationMs: 250, easing: "easeInOut" });
  const token = calls("attach")[0].token;
  expect(attachment.attached).toBe(true);
  const emit = mocks.listeners.get("palette")!;
  emit({ type: "attachmentChanged", token: "someone-else", attached: false });
  expect(attachment.attached).toBe(true);
  emit({ type: "attachmentChanged", token, attached: false });
  emit({ type: "attachmentChanged", token, attached: true });
  expect(changes).toEqual([false, true]);
  const errors: SparkError[] = [];
  const second = await choreography.attachWindow("inspector", "main", { edge: "leading", onError: error => errors.push(error) });
  mocks.listeners.get("inspector")!({ type: "attachmentChanged", token: calls("attach")[1].token, attached: "yes" });
  expect(errors.map(error => error.code)).toEqual(["E_INVALID_DATA"]);
  mocks.listeners.get("inspector")!({ type: "closed" });
  expect(second.attached).toBe(false);
  await attachment.remove();
  expect(calls("detach")).toEqual([{ id: "palette", token }]);
  expect(attachment.attached).toBe(false);
  expect(mocks.listeners.has("palette")).toBe(false);
});

test("attach options are validated, and a failed attach removes its listener", async () => {
  const attach = (options: any, parent = "main") => code(choreography.attachWindow("p", parent, options));
  expect(await attach({ edge: "trailing" }, "p")).toBe("E_INVALID_ARGUMENT");
  expect(await attach({ edge: "middle" })).toBe("E_INVALID_ARGUMENT");
  expect(await attach({ edge: "top", align: "middle" })).toBe("E_INVALID_ARGUMENT");
  expect(await attach({ edge: "top", magnetic: 500 })).toBe("E_INVALID_ARGUMENT");
  expect(await attach({ edge: "top", onChange: 1 })).toBe("E_INVALID_ARGUMENT");
  expect(await attach({ edge: "top", follow: true })).toBe("E_UNSUPPORTED_OPTION");
  expect(mocks.calls).toEqual([]);
  mocks.failures.set("attach", new SparkError("E_NOT_FOUND", "The parent window was not found"));
  expect(await attach({ edge: "top" })).toBe("E_NOT_FOUND");
  expect(mocks.listeners.has("p")).toBe(false);
});
