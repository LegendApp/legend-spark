import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/biometrics against a mocked bridge: validation, wire shapes, outcomes versus errors, abort and availability.
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
let call = (method: string, args: string): Promise<string> => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(reply(method, JSON.parse(args)))); };
const record = call;
const platform = { OS: "macos" };
const module = { call: (method: string, args: string) => call(method, args) };
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: () => module } }));
const biometrics = await import("../packages/biometrics/src/index.ts");
const { SparkError } = await import("../packages/desktop-app/src/contracts/index.ts");
beforeEach(() => { platform.OS = "macos"; call = record; reply = () => null; calls.length = 0; });

test("availability reports macOS and other platforms; unsupported calls reject after validation", async () => {
  expect(biometrics.getBiometricAvailability()).toEqual({ available: true });
  platform.OS = "windows";
  expect(biometrics.getBiometricAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(biometrics.getBiometricStatus()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(biometrics.authenticateWithBiometrics({ reason: "Unlock" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(biometrics.setBiometricSecret("vault", "x")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(biometrics.getBiometricSecret("vault", { reason: "Unlock" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(biometrics.deleteBiometricSecret("vault")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(biometrics.authenticateWithBiometrics({ reason: "" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toEqual([]);
});

test("status is validated", async () => {
  reply = () => ({ biometryType: "touchId", biometrics: "lockout", password: "available" });
  expect(await biometrics.getBiometricStatus()).toEqual({ biometryType: "touchId", biometrics: "lockout", password: "available" });
  reply = () => ({ biometryType: "faceId", biometrics: "available", password: "available" });
  await expect(biometrics.getBiometricStatus()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  reply = () => ({ biometryType: "touchId", biometrics: "fine", password: "available" });
  await expect(biometrics.getBiometricStatus()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(calls.map(entry => entry.method)).toEqual(["status", "status", "status"]);
});

test("authentication defaults to biometrics only; the password fallback is asked for explicitly", async () => {
  reply = () => ({ success: true });
  expect(await biometrics.authenticateWithBiometrics({ reason: "Unlock the vault" })).toEqual({ success: true });
  expect(calls[0]).toEqual({ method: "authenticate", args: { id: expect.any(String), reason: "Unlock the vault", fallback: "none" } });
  await biometrics.authenticateWithBiometrics({ reason: "Unlock", fallback: "password", cancelLabel: "Not now" });
  expect(calls[1]!.args).toMatchObject({ reason: "Unlock", fallback: "password", cancelLabel: "Not now" });
  await biometrics.authenticateWithBiometrics({ reason: "Unlock", fallback: "app", fallbackLabel: "Sign in" });
  expect(calls[2]!.args).toMatchObject({ fallback: "app", fallbackLabel: "Sign in" });
  expect(new Set(calls.map(entry => entry.args.id)).size).toBe(3);
});

test("authentication options are validated before native", async () => {
  const invalid = [{}, { reason: "   " }, { reason: "x".repeat(301) }, { reason: "Unlock", cancelLabel: "" }, { reason: "Unlock", fallback: "faceId" },
    { reason: "Unlock", fallback: "app", fallbackLabel: "x".repeat(61) }, { reason: "Unlock", signal: {} }, null, "Unlock"];
  for (const options of invalid) await expect(biometrics.authenticateWithBiometrics(options as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(biometrics.authenticateWithBiometrics({ reason: "Unlock", fallbackLabel: "Sign in" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(biometrics.authenticateWithBiometrics({ reason: "Unlock", policy: "any" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(biometrics.authenticateWithBiometrics({ reason: "Unlock", extra: undefined } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toEqual([]);
});

test("the person's outcomes resolve; environment reasons reject a typed BiometricError", async () => {
  for (const reason of ["userCancel", "systemCancel", "userFallback", "authenticationFailed"]) {
    reply = () => ({ success: false, reason, message: reason });
    expect(await biometrics.authenticateWithBiometrics({ reason: "Unlock", fallback: "app" })).toEqual({ success: false, reason });
  }
  const cases: [string, string][] = [["notAvailable", "E_UNAVAILABLE"], ["notEnrolled", "E_UNAVAILABLE"], ["lockout", "E_UNAVAILABLE"], ["passcodeNotSet", "E_UNAVAILABLE"],
    ["disconnected", "E_UNAVAILABLE"], ["notPaired", "E_UNAVAILABLE"], ["notInteractive", "E_UNAVAILABLE"], ["appCancel", "E_ABORTED"], ["invalidContext", "E_CLOSED"]];
  for (const [reason, code] of cases) {
    reply = () => ({ success: false, reason, message: `Simulated ${reason}` });
    const error = await biometrics.authenticateWithBiometrics({ reason: "Unlock" }).catch(cause => cause);
    expect(error).toBeInstanceOf(biometrics.BiometricError);
    expect(error).toBeInstanceOf(SparkError);
    expect(error).toMatchObject({ code, reason, message: `Simulated ${reason}` });
  }
  for (const reason of ["faceNotRecognized", "toString", "constructor"]) {
    reply = () => ({ success: false, reason, message: "?" });
    await expect(biometrics.authenticateWithBiometrics({ reason: "Unlock" })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  reply = () => ({ success: "yes" });
  await expect(biometrics.authenticateWithBiometrics({ reason: "Unlock" })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("native errors keep their Spark codes", async () => {
  call = () => Promise.reject(Object.assign(new Error("Another biometric prompt is pending"), { code: "E_BUSY" }));
  await expect(biometrics.authenticateWithBiometrics({ reason: "Unlock" })).rejects.toMatchObject({ code: "E_BUSY" });
  call = () => Promise.reject(Object.assign(new Error("Test driver: no simulated answer"), { code: "E_UNAVAILABLE" }));
  await expect(biometrics.getBiometricSecret("vault", { reason: "Unlock" })).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  call = () => Promise.reject(new Error("boom"));
  await expect(biometrics.getBiometricStatus()).rejects.toMatchObject({ code: "E_NATIVE" });
});

test("aborting cancels the pending prompt; an aborted signal rejects before native", async () => {
  let settle!: (value: string) => void;
  call = (method, args) => {
    calls.push({ method, args: JSON.parse(args) });
    if (method === "authenticate") return new Promise(resolve => { settle = resolve; });
    if (method === "cancel") settle(JSON.stringify({ success: false, reason: "appCancel", message: "Cancelled" }));
    return Promise.resolve("null");
  };
  const controller = new AbortController();
  const pending = biometrics.authenticateWithBiometrics({ reason: "Unlock", signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "E_ABORTED", reason: "appCancel" });
  expect(calls.map(entry => entry.method)).toEqual(["authenticate", "cancel"]);
  expect(calls[1]!.args).toEqual({ id: calls[0]!.args.id });
  controller.abort();
  expect(calls).toHaveLength(2);
  calls.length = 0;
  await expect(biometrics.authenticateWithBiometrics({ reason: "Unlock", signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "E_ABORTED", reason: "appCancel" });
  expect(calls).toEqual([]);
});

test("secrets: wire shapes, access default, missing values and outcomes", async () => {
  await expect(biometrics.setBiometricSecret("vault", "s3cret")).resolves.toBeUndefined();
  await biometrics.setBiometricSecret("pin", "1234", { access: "biometryOrPassword" });
  expect(calls.slice(0, 2)).toEqual([
    { method: "setSecret", args: { key: "vault", value: "s3cret", access: "biometryCurrentSet" } },
    { method: "setSecret", args: { key: "pin", value: "1234", access: "biometryOrPassword" } },
  ]);
  reply = () => ({ success: true, value: "s3cret" });
  expect(await biometrics.getBiometricSecret("vault", { reason: "Read the vault" })).toEqual({ success: true, value: "s3cret" });
  expect(calls[2]).toEqual({ method: "getSecret", args: { id: expect.any(String), key: "vault", reason: "Read the vault" } });
  reply = () => ({ success: true, value: null });
  expect(await biometrics.getBiometricSecret("missing", { reason: "Read" })).toEqual({ success: true, value: null });
  reply = () => ({ success: false, reason: "userCancel", message: "Cancelled" });
  expect(await biometrics.getBiometricSecret("vault", { reason: "Read" })).toEqual({ success: false, reason: "userCancel" });
  // A secret read has no fallback button, so userFallback cannot be an outcome.
  reply = () => ({ success: false, reason: "userFallback", message: "Fallback" });
  await expect(biometrics.getBiometricSecret("vault", { reason: "Read" })).rejects.toMatchObject({ code: "E_NATIVE" });
  reply = () => ({ success: false, reason: "lockout", message: "Locked out" });
  await expect(biometrics.getBiometricSecret("vault", { reason: "Read" })).rejects.toMatchObject({ code: "E_UNAVAILABLE", reason: "lockout" });
  reply = () => ({ success: false, reason: "missingEntitlement", message: "No keychain entitlement" });
  await expect(biometrics.setBiometricSecret("vault", "x")).rejects.toMatchObject({ code: "E_UNAVAILABLE", reason: "missingEntitlement" });
  reply = () => ({ success: false, reason: "authenticationFailed", message: "?" });
  await expect(biometrics.deleteBiometricSecret("vault")).rejects.toMatchObject({ code: "E_NATIVE" });
  reply = () => ({ success: true, value: 5 });
  await expect(biometrics.getBiometricSecret("vault", { reason: "Read" })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  reply = () => null;
  await expect(biometrics.deleteBiometricSecret("vault")).resolves.toBeUndefined();
});

test("secret arguments are validated before native", async () => {
  calls.length = 0;
  for (const key of ["", "has space", "slash/key", "x".repeat(201), 5]) await expect(biometrics.deleteBiometricSecret(key as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(biometrics.setBiometricSecret("vault", 5 as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(biometrics.setBiometricSecret("vault", "x", { access: "password" as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(biometrics.setBiometricSecret("vault", "x", { prompt: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(biometrics.getBiometricSecret("vault", { reason: "Read", fallback: "password" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(biometrics.getBiometricSecret("vault", undefined as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toEqual([]);
});

test("without the native module, availability reports missing-module and calls reject E_MODULE_UNAVAILABLE", async () => {
  vi.resetModules();
  vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: () => null } }));
  const missing = await import("../packages/biometrics/src/index.ts");
  expect(missing.getBiometricAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(missing.authenticateWithBiometrics({ reason: "Unlock" })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});
