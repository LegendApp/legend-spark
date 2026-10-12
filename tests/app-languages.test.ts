import { beforeEach, expect, test, vi } from "vitest";
// getAppLanguages/setAppLanguage against a mocked NativeDesktopApp bridge.
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
let installed = true;
const platform = { OS: "macos" };
const native = { call: (method: string, args: string) => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(reply(method, JSON.parse(args)))); } };
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: (name: string) => installed && name === "NativeDesktopApp" ? native : null } }));
const app = await import("../packages/desktop/app.ts");
beforeEach(() => { platform.OS = "macos"; installed = true; calls.length = 0; reply = () => null; });

const languages = { supported: ["en", "ar", "fr"], current: "ar", override: null, framework: ["ar", "en", "fr"] };

test("getAppLanguages returns the app's languages as fresh arrays", async () => {
  reply = () => languages;
  const result = await app.getAppLanguages();
  expect(result).toEqual(languages);
  expect(calls).toEqual([{ method: "languages", args: {} }]);
  reply = () => ({ ...languages, override: "fr" });
  expect((await app.getAppLanguages()).override).toBe("fr");
});

test("malformed native language reports are E_INVALID_DATA", async () => {
  for (const value of [null, [], { ...languages, current: "" }, { ...languages, supported: "en" }, { ...languages, framework: [1] }, { ...languages, override: 3 }, { supported: ["en"], current: "en", override: null }]) {
    reply = () => value;
    await expect(app.getAppLanguages()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
});

test("setAppLanguage stores a language or null and validates before the native call", async () => {
  await app.setAppLanguage("ar");
  await app.setAppLanguage("pt-BR");
  await app.setAppLanguage(null);
  expect(calls).toEqual([{ method: "setLanguage", args: { language: "ar" } }, { method: "setLanguage", args: { language: "pt-BR" } }, { method: "setLanguage", args: { language: null } }]);
  calls.length = 0;
  for (const language of ["", "arabic", "ar EG", 3, undefined, ["ar"]]) await expect(app.setAppLanguage(language as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toHaveLength(0);
});

test("availability is truthful and unsupported hosts reject typed before any native call", async () => {
  expect((app as Record<string, unknown>).getAppLanguageAvailability).toBeUndefined();
  expect(app.getAppAvailability("languages")).toEqual({ available: true });
  expect(() => app.getAppAvailability("dock" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  installed = false;
  expect(app.getAppAvailability("languages")).toEqual({ available: false, reason: "missing-module" });
  await expect(app.getAppLanguages()).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  installed = true;
  for (const os of ["windows", "ios", "web"]) {
    platform.OS = os;
    expect(app.getAppAvailability("languages")).toEqual({ available: false, reason: "unsupported-platform" });
    // The rest of the app API is available on Windows.
    expect(app.getAppAvailability()).toEqual(os === "windows" ? { available: true } : { available: false, reason: "unsupported-platform" });
    await expect(app.getAppLanguages()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(app.setAppLanguage("ar")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  }
  expect(calls).toHaveLength(0);
});
