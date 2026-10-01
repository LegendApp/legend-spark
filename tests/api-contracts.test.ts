import { expect, test, vi } from "vitest";
import { asyncRegistration, invokeNative, parseNativeResult, SparkError } from "../packages/desktop-app/src/contracts";

test("async registration joins removal, stops callbacks once and retries failed cleanup", async () => {
  const stop = vi.fn();
  const cleanup = vi.fn().mockRejectedValueOnce(new Error("native busy")).mockResolvedValue(undefined);
  const registration = asyncRegistration(stop, cleanup);
  const first = registration.remove();
  expect(registration.remove()).toBe(first);
  await expect(first).rejects.toThrow("native busy");
  await registration.remove();
  await registration.remove();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(2);
});

test("native parsing rejects malformed JSON and wrong shapes with stable codes", () => {
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
  expect(parseNativeResult('["a"]', strings)).toEqual(["a"]);
  for (const json of ["broken", "null", "{}", "[1]"]) {
    try { parseNativeResult(json, strings); expect.unreachable(); }
    catch (error) { expect(error).toBeInstanceOf(SparkError); expect(error).toMatchObject({ code: "E_INVALID_DATA" }); }
  }
});


test("native invocation starts immediately and normalizes synchronous and asynchronous failures", async () => {
  const operation = vi.fn(() => 7);
  const result = invokeNative(operation);
  expect(operation).toHaveBeenCalledOnce();
  await expect(result).resolves.toBe(7);
  const original = Object.assign(new Error("denied"), { code: "E_PERMISSION" });
  await expect(invokeNative(() => { throw original; })).rejects.toMatchObject({ code: "E_PERMISSION_DENIED", cause: original });
  await expect(invokeNative(() => Promise.reject(original))).rejects.toMatchObject({ code: "E_PERMISSION_DENIED", cause: original });
  const sparkError = new SparkError("E_BUSY", "busy");
  await expect(invokeNative(() => Promise.reject(sparkError))).rejects.toBe(sparkError);
});
