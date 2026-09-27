import { expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => ({ call: mocks.call }) } }));
import { createAuthSession, getRandomBytesAsync, digestStringAsync, maybeCompleteAuthSession } from "../packages/auth-session/src/index";
test("desktop crypto rejects malformed, noncanonical and wrong-size native results", async () => {
  for (const value of [null, "AA==", "not base64!!", "AB=="]) {
    mocks.call.mockResolvedValue(JSON.stringify(value));
    await expect(getRandomBytesAsync(value === "AB==" ? 1 : 32)).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  mocks.call.mockResolvedValue('"AA=="'); await expect(getRandomBytesAsync(1)).resolves.toEqual(new Uint8Array([0]));
  mocks.call.mockResolvedValue('"bad"'); await expect(digestStringAsync("SHA-256", "text")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(maybeCompleteAuthSession().type).toBe("failed");
});
test("unexpected loopback binding is rejected and disposed", async () => {
  mocks.call.mockImplementation(async method => method === "cryptoRandom" ? JSON.stringify(Buffer.alloc(32).toString("base64")) : method === "authPrepare" ? '"http://evil.example/auth/callback"' : 'null');
  await expect(createAuthSession()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(mocks.call).toHaveBeenCalledWith("authClose", expect.any(String));
});
