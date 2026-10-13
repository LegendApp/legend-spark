import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/privileged-helper against a mocked bridge: validation, wire shapes, results versus typed errors,
// authorization handles, abort and availability.
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
let availabilityAnswer = "available";
const platform = { OS: "macos" };
const module = {
  call: (method: string, args: string) => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(reply(method, JSON.parse(args)))); },
  availability: () => availabilityAnswer,
};
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: () => module } }));
const helper = await import("../packages/privileged-helper/src/index.ts");
const { SparkError } = await import("../packages/desktop-app/src/contracts/index.ts");
beforeEach(() => { platform.OS = "macos"; reply = () => null; availabilityAnswer = "available"; calls.length = 0; });
const failure = (reason: string, code: string) => ({ type: "failure", reason, code, message: `${reason} happened` });

test("availability is truthful per platform and signature; Windows calls reject E_UNSUPPORTED_PLATFORM after validation", async () => {
  expect(helper.getPrivilegedHelperAvailability()).toEqual({ available: true });
  availabilityAnswer = "unsigned";
  expect(helper.getPrivilegedHelperAvailability()).toEqual({ available: false, reason: "unsigned" });
  availabilityAnswer = "maybe";
  expect(() => helper.getPrivilegedHelperAvailability()).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
  platform.OS = "windows";
  expect(helper.getPrivilegedHelperAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  for (const run of [() => helper.getPrivilegedHelperStatus("tool"), () => helper.registerPrivilegedHelper("tool"), () => helper.unregisterPrivilegedHelper("tool"),
    () => helper.openPrivilegedHelperSettings(), () => helper.requestAdminAuthorization({ prompt: "Why" }), () => helper.sendPrivilegedHelperMessage("tool", { a: 1 })])
    await expect(run()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(helper.registerPrivilegedHelper("../tool")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toEqual([]);
});

test("registration resolves statuses and rejects named ServiceManagement failures", async () => {
  reply = () => "requiresApproval";
  expect(await helper.registerPrivilegedHelper("tool")).toBe("requiresApproval");
  reply = () => "enabled";
  expect(await helper.getPrivilegedHelperStatus("tool")).toBe("enabled");
  reply = () => null;
  await helper.unregisterPrivilegedHelper("tool");
  await helper.openPrivilegedHelperSettings();
  expect(calls).toEqual([{ method: "register", args: { name: "tool" } }, { method: "status", args: { name: "tool" } }, { method: "unregister", args: { name: "tool" } }, { method: "openSettings", args: {} }]);
  for (const [reason, code] of [["unsigned", "E_UNAVAILABLE"], ["notFound", "E_NOT_FOUND"], ["invalidSignature", "E_UNAVAILABLE"], ["invalidPlist", "E_INVALID_DATA"], ["serviceUnavailable", "E_UNAVAILABLE"], ["unknown", "E_NATIVE"]]) {
    reply = () => failure(reason!, code!);
    const error = await helper.registerPrivilegedHelper("tool").catch(cause => cause);
    expect(error).toBeInstanceOf(helper.PrivilegedHelperError);
    expect(error).toBeInstanceOf(SparkError);
    expect(error).toMatchObject({ code, reason, message: `${reason} happened` });
  }
  // A reason with the wrong code, an unknown reason or an unknown status is a contract violation.
  for (const value of [failure("notFound", "E_NATIVE"), failure("exploded", "E_NATIVE"), "approved", 1]) {
    reply = () => value;
    await expect(helper.registerPrivilegedHelper("tool")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  for (const name of ["", "a b", "a/b", "x".repeat(65), 1, null]) await expect(helper.getPrivilegedHelperStatus(name as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("the admin prompt resolves an authorization handle or cancel; the handle closes once and travels with messages", async () => {
  reply = (method) => method === "authorize" ? { type: "authorized", id: "auth-1", expiresAt: 1700000300000 } : method === "send" ? { value: { ok: true } } : null;
  const result = await helper.requestAdminAuthorization({ prompt: "Kitchen Sink checks its helper" });
  expect(calls[0]).toEqual({ method: "authorize", args: { prompt: "Kitchen Sink checks its helper" } });
  if (result.type !== "authorized") throw new Error("expected an authorization");
  const { authorization } = result;
  expect(authorization.closed).toBe(false);
  expect(authorization.expiresAt).toBe(1700000300000);
  expect(Object.keys(authorization)).toEqual(["closed", "expiresAt", "close"]); // The native identifier is not exposed.
  expect(await helper.sendPrivilegedHelperMessage("tool", { command: "whoami" }, { authorization })).toEqual({ ok: true });
  expect(calls[1]).toEqual({ method: "send", args: { id: expect.any(String), name: "tool", message: { command: "whoami" }, authorization: "auth-1", timeoutMs: 30000 } });
  await Promise.all([authorization.close(), authorization.close()]);
  expect(authorization.closed).toBe(true);
  expect(calls.filter(call => call.method === "release")).toEqual([{ method: "release", args: { id: "auth-1" } }]);
  await expect(helper.sendPrivilegedHelperMessage("tool", {}, { authorization })).rejects.toMatchObject({ code: "E_CLOSED" });
  await expect(helper.sendPrivilegedHelperMessage("tool", {}, { authorization: { closed: false, expiresAt: null, close: async () => {} } })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  reply = () => ({ type: "cancel" });
  expect(await helper.requestAdminAuthorization({ prompt: "Again" })).toEqual({ type: "cancel" });
  for (const [reason, code] of [["denied", "E_PERMISSION_DENIED"], ["notInteractive", "E_UNAVAILABLE"]]) {
    reply = () => failure(reason!, code!);
    await expect(helper.requestAdminAuthorization({ prompt: "Again" })).rejects.toMatchObject({ code, reason });
  }
  reply = () => ({ type: "authorized", id: "a", expiresAt: null });
  expect(await helper.requestAdminAuthorization({ prompt: "Again" })).toMatchObject({ authorization: { expiresAt: null } });
  reply = () => ({ type: "authorized", id: "a" });
  await expect(helper.requestAdminAuthorization({ prompt: "Again" })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  const count = calls.length;
  for (const options of [{}, { prompt: "" }, { prompt: "x".repeat(501) }, { prompt: "a", icon: "x" }, null])
    await expect(helper.requestAdminAuthorization(options as never)).rejects.toMatchObject({ code: expect.stringMatching(/E_INVALID_ARGUMENT|E_UNSUPPORTED_OPTION/) });
  expect(calls.length).toBe(count);
});

test("messages are JSON, validated before native; replies and the helper's errors come back typed", async () => {
  reply = (_method, args) => ({ value: { received: args.message } });
  expect(await helper.sendPrivilegedHelperMessage("tool", ["a", 1, true, null, { nested: [] }], { timeoutMs: 5 })).toEqual({ received: ["a", 1, true, null, { nested: [] }] });
  expect(calls[0]!.args).toMatchObject({ timeoutMs: 5 });
  expect(await helper.sendPrivilegedHelperMessage("tool", "text")).toEqual({ received: "text" });
  const deep: any = []; let cursor = deep; for (let i = 0; i < 70; i++) { const next: any[] = []; cursor.push(next); cursor = next; }
  const count = calls.length;
  for (const message of [undefined, NaN, Infinity, () => 1, new Date(), new Map(), { a: undefined }, deep, "x".repeat(1024 * 1024 + 1)])
    await expect(helper.sendPrivilegedHelperMessage("tool", message as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 600001 }, { timeoutMs: 1.5 }, { signal: {} }, { retries: 1 }])
    await expect(helper.sendPrivilegedHelperMessage("tool", {}, options as never)).rejects.toMatchObject({ code: expect.stringMatching(/E_INVALID_ARGUMENT|E_UNSUPPORTED_OPTION/) });
  expect(calls.length).toBe(count);
  for (const [reason, code] of [["notRegistered", "E_UNAVAILABLE"], ["requiresApproval", "E_PERMISSION_DENIED"], ["connectionInvalid", "E_CLOSED"], ["connectionInterrupted", "E_CLOSED"], ["authorizationExpired", "E_PERMISSION_DENIED"], ["helperFailed", "E_PERMISSION_DENIED"], ["helperFailed", "E_NATIVE"]]) {
    reply = () => failure(reason!, code!);
    await expect(helper.sendPrivilegedHelperMessage("tool", {})).rejects.toMatchObject({ name: "PrivilegedHelperError", code, reason });
  }
  reply = () => failure("helperFailed", "E_WHATEVER");
  await expect(helper.sendPrivilegedHelperMessage("tool", {})).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  reply = () => ({ reply: 1 });
  await expect(helper.sendPrivilegedHelperMessage("tool", {})).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("aborting cancels the native request; an aborted signal never sends", async () => {
  let abortSend!: () => void;
  module.call = (method: string, args: string) => {
    calls.push({ method, args: JSON.parse(args) });
    // Native ends the pending send with E_ABORTED when it is cancelled.
    if (method === "send") return new Promise((_, reject) => { abortSend = () => reject(Object.assign(new Error("aborted"), { code: "E_ABORTED" })); });
    if (method === "cancel") abortSend();
    return Promise.resolve("null");
  };
  const controller = new AbortController();
  const pending = helper.sendPrivilegedHelperMessage("tool", {}, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "E_ABORTED" });
  const send = calls.find(call => call.method === "send")!;
  expect(calls.find(call => call.method === "cancel")).toEqual({ method: "cancel", args: { id: send.args.id } });
  calls.length = 0;
  await expect(helper.sendPrivilegedHelperMessage("tool", {}, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "E_ABORTED" });
  expect(calls).toEqual([]);
});
