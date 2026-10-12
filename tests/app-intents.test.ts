import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/app-intents against a mocked bridge: availability, validation, wire shapes, handler delivery,
// answers and cleanup.
const calls: { method: string; args: any }[] = [];
const handlers = new Map<string, (args: any) => unknown>();
const desktop = new Set<(event: unknown) => void>();
const platform = { OS: "macos" };
const state = { available: true };
const native = {
  isAvailable: () => state.available,
  call: async (method: string, json: string) => {
    const args = JSON.parse(json);
    calls.push({ method, args });
    return JSON.stringify((await handlers.get(method)?.(args)) ?? null);
  },
};
class NativeEventEmitter { addListener(_name: string, listener: (event: unknown) => void) { desktop.add(listener); return { remove: () => desktop.delete(listener) }; } }
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: () => native, getEnforcing: () => native }, NativeEventEmitter }));
const intents = await import("../packages/app-intents/src/index.ts");
const { SparkError } = await import("../packages/desktop-app/src/contracts/index.ts");
const emit = (event: object) => [...desktop].forEach(listener => listener(event));
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const fail = (code: string, message = code) => () => { throw Object.assign(new Error(message), { code }); };
beforeEach(() => { platform.OS = "macos"; state.available = true; calls.length = 0; handlers.clear(); });

test("availability reports whether the build carries the app's intents; Windows rejects every call E_UNSUPPORTED_PLATFORM after validating", async () => {
  expect(intents.getAppIntentsAvailability()).toEqual({ available: true });
  state.available = false;
  expect(intents.getAppIntentsAvailability()).toEqual({ available: false, reason: "host-restriction" });
  platform.OS = "windows";
  expect(intents.getAppIntentsAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(intents.getAppIntents()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(intents.addAppIntentHandler("showRecipe", () => {})).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(intents.donateAppIntent("showRecipe", { recipe: "Pancakes" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(intents.addAppIntentHandler("", () => {})).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(intents.donateAppIntent("showRecipe", { recipe: {} } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toEqual([]);
});

test("getAppIntents returns the declarations native reports, checked against their contract", async () => {
  const declared = [{ id: "showRecipe", title: "Show Recipe", returnsText: true, parameters: [{ name: "recipe", title: "Recipe", type: "string", optional: false }] }];
  handlers.set("declarations", () => declared);
  expect(await intents.getAppIntents()).toEqual(declared);
  handlers.set("declarations", () => [{ id: "showRecipe", title: "Show Recipe", parameters: [] }]);
  await expect(intents.getAppIntents()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("a handler runs its intent's invocations and answers each with its text, nothing, or its error", async () => {
  const received: unknown[] = [], errors: string[] = [];
  const registration = await intents.addAppIntentHandler("showRecipe", async ({ id, parameters }) => {
    received.push([id, parameters]);
    if (parameters.recipe === "fail") throw new SparkError("E_INVALID_ARGUMENT", "No such recipe");
    if (parameters.recipe === "crash") throw new Error("Boom");
    if (parameters.recipe === "number") return 3 as never;
    return parameters.recipe === "none" ? undefined : `${parameters.recipe} for ${parameters.servings ?? 1}`;
  }, { onError: error => errors.push(error.code) });
  expect(calls.at(-1)).toEqual({ method: "register", args: { id: "showRecipe" } });
  emit({ type: "appIntentInvoked", requestId: "r1", id: "showRecipe", parameters: { recipe: "Pancakes", servings: 2 } });
  emit({ type: "appIntentInvoked", requestId: "r2", id: "startTimer", parameters: { minutes: 3 } });
  emit({ type: "appIntentInvoked", requestId: "r3", id: "showRecipe", parameters: { recipe: "fail", servings: null } });
  emit({ type: "appIntentInvoked", requestId: "r4", id: "showRecipe", parameters: { recipe: "crash" } });
  emit({ type: "appIntentInvoked", requestId: "r5", id: "showRecipe", parameters: { recipe: "none" } });
  emit({ type: "appIntentInvoked", requestId: "r6", id: "showRecipe", parameters: { recipe: "number" } });
  emit({ type: "appIntentInvoked", requestId: "r7", id: "showRecipe", parameters: { recipe: { nested: true } } });
  await settle();
  expect(received).toEqual([["showRecipe", { recipe: "Pancakes", servings: 2 }], ["showRecipe", { recipe: "fail", servings: null }], ["showRecipe", { recipe: "crash" }], ["showRecipe", { recipe: "none" }], ["showRecipe", { recipe: "number" }]]);
  expect(calls.filter(call => call.method === "answer").map(call => call.args)).toEqual([
    { requestId: "r1", text: "Pancakes for 2" },
    { requestId: "r3", error: { code: "E_INVALID_ARGUMENT", message: "No such recipe" } },
    { requestId: "r4", error: { code: "E_NATIVE", message: "Boom" } },
    { requestId: "r5", text: null },
    { requestId: "r6", error: { code: "E_INVALID_DATA", message: "The handler for showRecipe returned number; return text or nothing" } },
  ]);
  // A malformed event is reported, as is an answer the system no longer waits for.
  expect(errors).toEqual(["E_INVALID_DATA"]);
  handlers.set("answer", fail("E_CLOSED"));
  emit({ type: "appIntentInvoked", requestId: "r8", id: "showRecipe", parameters: { recipe: "Late" } });
  await settle();
  expect(errors).toEqual(["E_INVALID_DATA", "E_CLOSED"]);
  await Promise.all([registration.remove(), registration.remove()]);
  expect(calls.filter(call => call.method === "unregister")).toEqual([{ method: "unregister", args: { id: "showRecipe" } }]);
  emit({ type: "appIntentInvoked", requestId: "r9", id: "showRecipe", parameters: { recipe: "After" } });
  await settle();
  expect(received).toHaveLength(6);
});

test("registration failures leave nothing subscribed; options and handlers are validated", async () => {
  handlers.set("register", fail("E_NOT_FOUND", "macos.appIntents declares no intent missing"));
  const received: unknown[] = [];
  await expect(intents.addAppIntentHandler("missing", () => { received.push(1); })).rejects.toMatchObject({ code: "E_NOT_FOUND", message: "macos.appIntents declares no intent missing" });
  emit({ type: "appIntentInvoked", requestId: "r1", id: "missing", parameters: {} });
  await settle();
  expect(received).toEqual([]);
  await expect(intents.addAppIntentHandler("a", "nope" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(intents.addAppIntentHandler("a", () => {}, { other: 1 } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  handlers.set("register", fail("E_UNAVAILABLE"));
  await expect(intents.addAppIntentHandler("a", () => {})).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
});

test("donateAppIntent sends the id and parameters, and passes native failures through typed", async () => {
  await intents.donateAppIntent("showRecipe", { recipe: "Pancakes", servings: 2, loud: true, note: null });
  expect(calls.at(-1)).toEqual({ method: "donate", args: { id: "showRecipe", parameters: { recipe: "Pancakes", servings: 2, loud: true, note: null } } });
  await intents.donateAppIntent("ping");
  expect(calls.at(-1)!.args).toEqual({ id: "ping", parameters: {} });
  await expect(intents.donateAppIntent("showRecipe", { servings: Number.NaN })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  handlers.set("donate", fail("E_UNAVAILABLE"));
  await expect(intents.donateAppIntent("showRecipe")).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
});
