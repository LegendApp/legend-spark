import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/sharing and the default URL handler of /links against a mocked bridge: validation, wire shapes,
// result contracts, listener delivery and cleanup, and availability.
const calls: { native: string; method: string; args: any }[] = [];
const handlers = new Map<string, (args: any) => unknown>();
const desktop = new Set<(event: unknown) => void>();
const platform = { OS: "macos" };
const modules = new Map<string, object>();
const module = (name: string) => {
  if (!modules.has(name)) modules.set(name, { call: async (method: string, json: string) => {
    const args = JSON.parse(json);
    calls.push({ native: name, method, args });
    return JSON.stringify((await handlers.get(`${name}.${method}`)?.(args)) ?? null);
  } });
  return modules.get(name);
};
class NativeEventEmitter { addListener(_name: string, listener: (event: unknown) => void) { desktop.add(listener); return { remove: () => desktop.delete(listener) }; } }
const views = new Map<object, number>();
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: module, getEnforcing: module }, NativeEventEmitter, findNodeHandle: (view: object) => views.get(view) ?? null }));
const sharing = await import("../packages/sharing/src/index.ts");
const links = await import("../packages/desktop-links/src/index.ts");
const emit = (event: object) => [...desktop].forEach(listener => listener(event));
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
beforeEach(() => { platform.OS = "macos"; calls.length = 0; handlers.clear(); });

test("availability is per feature on macOS; other platforms reject every call E_UNSUPPORTED_PLATFORM without reaching native", async () => {
  for (const feature of ["share", "services", "spotlight"] as const) expect(sharing.getSharingAvailability(feature)).toEqual({ available: true });
  expect(links.getDefaultURLHandlerAvailability()).toEqual({ available: true });
  expect(() => sharing.getSharingAvailability("airdrop" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  platform.OS = "windows";
  expect(sharing.getSharingAvailability("share")).toEqual({ available: false, reason: "unsupported-platform" });
  expect(links.getDefaultURLHandlerAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(sharing.share([{ type: "text", text: "Hi" }])).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(sharing.addServiceListener("Log", () => {})).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(sharing.indexSpotlightItems([{ id: "a", title: "A" }])).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(sharing.deleteSpotlightItems({ all: true })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  expect(() => sharing.addSpotlightListener(() => {})).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  await expect(links.isDefaultURLHandler("myapp")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(links.setDefaultURLHandler("myapp")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  expect(calls).toEqual([]);
});

test("share sends text, web URLs and native file paths with the anchor's tag, and resolves the chosen service or null", async () => {
  handlers.set("NativeDesktopSharing.share", () => ({ service: "Mail" }));
  const anchor = {};
  views.set(anchor, 42);
  expect(await sharing.share([{ type: "text", text: "Hi" }, { type: "url", url: "https://legendapp.com" }, { type: "file", path: "file:///tmp/a%20b.txt" }], { anchor })).toEqual({ service: "Mail" });
  expect(calls.at(-1)).toEqual({ native: "NativeDesktopSharing", method: "share", args: { items: [{ type: "text", text: "Hi" }, { type: "url", url: "https://legendapp.com" }, { type: "file", path: "/tmp/a b.txt" }], tag: 42 } });
  handlers.set("NativeDesktopSharing.share", () => ({ service: null }));
  expect(await sharing.share([{ type: "text", text: "Hi" }])).toEqual({ service: null });
  expect(calls.at(-1)!.args).toEqual({ items: [{ type: "text", text: "Hi" }] });
  handlers.set("NativeDesktopSharing.share", () => ({ service: "" }));
  await expect(sharing.share([{ type: "text", text: "Hi" }])).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  const before = calls.length;
  await expect(sharing.share([])).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(sharing.share([{ type: "url", url: "file:///tmp/a" }])).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(sharing.share([{ type: "file", path: "relative.txt" }])).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(sharing.share([{ type: "text", text: "Hi", subject: "x" } as never])).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(sharing.share([{ type: "text", text: "Hi" }], { dialogTitle: "x" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(sharing.share([{ type: "text", text: "Hi" }], { anchor: {} })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  expect(calls.length).toBe(before);
});

test("a service listener registers its declared name, receives only that service's invocations, and unregisters once", async () => {
  const received: unknown[] = [], errors: string[] = [];
  const registration = await sharing.addServiceListener("Log", invocation => received.push(invocation), { onError: error => errors.push(error.code) });
  expect(calls.at(-1)).toMatchObject({ method: "registerService", args: { name: "Log" } });
  emit({ type: "serviceInvoked", name: "Log", text: "selected", files: ["/tmp/a"], urls: [] });
  emit({ type: "serviceInvoked", name: "Other", text: "x", files: [], urls: [] });
  emit({ type: "serviceInvoked", name: "Log", text: 3, files: [], urls: [] });
  expect(received).toEqual([{ name: "Log", text: "selected", files: ["/tmp/a"], urls: [] }]);
  expect(errors).toEqual(["E_INVALID_DATA"]);
  await Promise.all([registration.remove(), registration.remove()]);
  expect(calls.filter(call => call.method === "unregisterService")).toHaveLength(1);
  emit({ type: "serviceInvoked", name: "Log", text: "late", files: [], urls: [] });
  expect(received).toHaveLength(1);
  handlers.set("NativeDesktopSharing.registerService", () => { throw Object.assign(new Error("undeclared"), { code: "E_UNAVAILABLE" }); });
  await expect(sharing.addServiceListener("Missing", () => received.push("missing"))).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  emit({ type: "serviceInvoked", name: "Missing", text: "x", files: [], urls: [] });
  expect(received).toHaveLength(1);
  await expect(sharing.addServiceListener("", () => {})).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(sharing.addServiceListener("Log", () => {}, { extra: 1 } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
});

test("Spotlight items and deletions are validated and sent as given", async () => {
  await sharing.indexSpotlightItems([{ id: "a", title: "A", domain: "recipes", description: "d", keywords: ["k"], expiresAt: 1e12 }, { id: "b", title: "B" }]);
  expect(calls.at(-1)).toEqual({ native: "NativeDesktopSharing", method: "index", args: { items: [{ id: "a", title: "A", domain: "recipes", description: "d", keywords: ["k"], expiresAt: 1e12 }, { id: "b", title: "B" }] } });
  await sharing.deleteSpotlightItems({ ids: ["a"] });
  await sharing.deleteSpotlightItems({ domains: ["recipes"] });
  await sharing.deleteSpotlightItems({ all: true });
  expect(calls.slice(-3).map(call => call.args)).toEqual([{ ids: ["a"] }, { domains: ["recipes"] }, {}]);
  const before = calls.length;
  await expect(sharing.indexSpotlightItems([])).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(sharing.indexSpotlightItems([{ id: "a", title: "A" }, { id: "a", title: "B" }])).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(sharing.indexSpotlightItems([{ id: "a", title: "" }])).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(sharing.indexSpotlightItems([{ id: "a", title: "A", keywords: [] }])).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(sharing.indexSpotlightItems([{ id: "a", title: "A", url: "x" } as never])).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(sharing.deleteSpotlightItems({ ids: [] })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(sharing.deleteSpotlightItems({ ids: ["a"], domains: ["b"] } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(sharing.deleteSpotlightItems({ all: false } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls.length).toBe(before);
});

test("a Spotlight listener gets held openings once from native, then live ones, and nothing after remove", async () => {
  handlers.set("NativeDesktopSharing.takeSpotlightItems", () => ["launched"]);
  const opened: string[] = [], errors: string[] = [];
  const subscription = sharing.addSpotlightListener(({ id }) => opened.push(id), { onError: error => errors.push(error.code) });
  emit({ type: "spotlightItemOpened", identifier: "launched", held: true }); // Comes back from takeSpotlightItems instead.
  await tick();
  emit({ type: "spotlightItemOpened", identifier: "live", held: false });
  emit({ type: "spotlightItemOpened", identifier: 4, held: false });
  expect(opened).toEqual(["launched", "live"]);
  expect(errors).toEqual(["E_INVALID_DATA"]);
  subscription.remove();
  emit({ type: "spotlightItemOpened", identifier: "after", held: false });
  expect(opened).toEqual(["launched", "live"]);
});

test("default URL handlers take a bare scheme, lowercased, and validate the native answer", async () => {
  handlers.set("NativeDesktopLinks.isDefaultHandler", () => true);
  expect(await links.isDefaultURLHandler("Spark-KS")).toBe(true);
  expect(calls.at(-1)).toEqual({ native: "NativeDesktopLinks", method: "isDefaultHandler", args: { scheme: "spark-ks" } });
  await links.setDefaultURLHandler("spark-ks");
  expect(calls.at(-1)).toEqual({ native: "NativeDesktopLinks", method: "setDefaultHandler", args: { scheme: "spark-ks" } });
  handlers.set("NativeDesktopLinks.isDefaultHandler", () => "yes");
  await expect(links.isDefaultURLHandler("spark-ks")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  handlers.set("NativeDesktopLinks.setDefaultHandler", () => { throw Object.assign(new Error("undeclared"), { code: "E_UNAVAILABLE" }); });
  await expect(links.setDefaultURLHandler("other")).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  for (const bad of ["", "spark-ks:", "1abc", "a b"]) await expect(links.isDefaultURLHandler(bad)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});
