import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  platform: { OS: "ios" }, random: vi.fn(), digest: vi.fn(), auth: vi.fn(), browser: vi.fn(), dismiss: vi.fn(),
  urls: new Set<(event: { url: string }) => void>(), states: new Set<(value: string) => void>(),
}));
vi.mock("react-native", () => ({ Platform: mocks.platform,
  Linking: { addEventListener: (_: string, listener: (event: { url: string }) => void) => { mocks.urls.add(listener); return { remove: () => { mocks.urls.delete(listener); } }; } },
  AppState: { currentState: "active", addEventListener: (_: string, listener: (value: string) => void) => { mocks.states.add(listener); return { remove: () => { mocks.states.delete(listener); } }; } },
}));
vi.mock("expo-crypto", () => ({ getRandomBytesAsync: mocks.random, digestStringAsync: mocks.digest, CryptoDigestAlgorithm: { SHA256: "SHA-256" } }));
vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: mocks.auth, openBrowserAsync: mocks.browser, dismissAuthSession: mocks.dismiss, maybeCompleteAuthSession: () => ({ type: "failed", message: "Not supported on this platform" }) }));
import { createAuthSession, getRandomBytesAsync, digestStringAsync, maybeCompleteAuthSession } from "../packages/auth-session/src/mobile";
const options = { redirectUri: "demo://auth/callback" };
const url = (state: string) => `https://provider.example/?state=${state}`;
beforeEach(() => {
  vi.clearAllMocks(); mocks.platform.OS = "ios";
  mocks.random.mockImplementation(async count => new Uint8Array(count)); mocks.digest.mockResolvedValue("a".repeat(64));
  mocks.auth.mockImplementation(() => new Promise(() => {})); mocks.browser.mockResolvedValue({ type: "opened" }); mocks.dismiss.mockImplementation(() => {});
});
test("mobile validation always rejects asynchronously and verifies crypto responses", async () => {
  await expect(getRandomBytesAsync(0)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  mocks.random.mockResolvedValue(new Uint8Array(1));
  await expect(getRandomBytesAsync(32)).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  mocks.digest.mockResolvedValue("bad");
  await expect(digestStringAsync("SHA-256", "test")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(maybeCompleteAuthSession()).toEqual({ type: "failed", message: "Not supported on this platform" });
});
test("browser open stays in the initiating gesture; cancellation retries failed native dismissal", async () => {
  const session = await createAuthSession(options);
  const opening = session.open(url(session.state));
  expect(mocks.auth).toHaveBeenCalledTimes(1);
  mocks.dismiss.mockImplementationOnce(() => { throw Error("dismiss failed"); });
  await expect(session.dismiss()).rejects.toMatchObject({ code: "E_NATIVE" });
  await expect(opening).rejects.toMatchObject({ code: "E_NATIVE" });
  await expect(createAuthSession(options)).rejects.toMatchObject({ code: "E_BUSY" });
  await session.dismiss(); expect(mocks.dismiss).toHaveBeenCalledTimes(2);
  const next = await createAuthSession(options); await next.dismiss();
});
test("native completion checks callback and does not dismiss an already ended browser", async () => {
  mocks.auth.mockImplementation(async () => ({ type: "success", url: `${options.redirectUri}?state=${"00".repeat(32)}` }));
  const session = await createAuthSession(options);
  await expect(session.open(url(session.state))).resolves.toMatchObject({ type: "success" });
  expect(mocks.dismiss).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValue({ type: "success", url: `${options.redirectUri}?state=wrong` });
  const bad = await createAuthSession(options);
  await expect(bad.open(url(bad.state))).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
test("Android cancellation removes owned observers and allows a new session", async () => {
  mocks.platform.OS = "android";
  const session = await createAuthSession(options), opening = session.open(url(session.state));
  expect(mocks.urls.size).toBe(1); expect(mocks.states.size).toBe(1);
  const stale = [...mocks.urls][0];
  await session.dismiss(); await expect(opening).resolves.toEqual({ type: "dismiss" });
  expect(mocks.urls.size).toBe(0); expect(mocks.states.size).toBe(0);
  expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.dismiss).not.toHaveBeenCalled();
  const next = await createAuthSession(options), result = next.open(url(next.state));
  stale({ url: `${options.redirectUri}?state=${session.state}` });
  for (const listener of mocks.urls) listener({ url: `${options.redirectUri}?state=${next.state}` });
  await expect(result).resolves.toMatchObject({ type: "success" });
  expect(mocks.urls.size).toBe(0); expect(mocks.states.size).toBe(0);
});
test("Android returning from a dismissed tab releases observers", async () => {
  mocks.platform.OS = "android";
  const session = await createAuthSession(options), result = session.open(url(session.state));
  for (const state of ["active", "background", "active"]) for (const listener of mocks.states) listener(state);
  await expect(result).resolves.toEqual({ type: "dismiss" });
  expect(mocks.urls.size).toBe(0);
});
