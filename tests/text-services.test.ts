import { beforeEach, expect, test, vi } from "vitest";

const { platform, native, modules, tags } = vi.hoisted(() => ({
  platform: { OS: "macos" },
  native: {
    isWritingToolsAvailable: vi.fn(() => true),
    findText: vi.fn(async (..._args: unknown[]) => JSON.stringify({ matchCount: 3, matchIndex: 1 })),
    showFindBar: vi.fn(async (_tag: number) => {}),
    lookUp: vi.fn(async (_tag: number) => {}),
  },
  modules: { present: true },
  tags: new Map<object, number>(),
}));
vi.mock("react-native", () => ({
  Platform: platform,
  TurboModuleRegistry: { get: () => modules.present ? native : null },
  findNodeHandle: (target: object) => tags.get(target) ?? null,
}));
import * as services from "../packages/ui/src/text-services/index";
import { findText, getTextServicesAvailability, lookUp, showFindBar, type TextServicesTarget } from "../packages/ui/src/text-services/index";

const input = {} as TextServicesTarget, unmounted = {} as TextServicesTarget;
const rejection = (promise: Promise<unknown>) => promise.then(() => "resolved", (error: { code?: string; name?: string }) => `${error.name}:${error.code}`);
beforeEach(() => {
  platform.OS = "macos"; modules.present = true; tags.clear(); tags.set(input, 42);
  for (const fn of Object.values(native)) fn.mockClear();
  native.isWritingToolsAvailable.mockReturnValue(true);
});

test("the public entry exports availability and the three operations, and no hooks", () => {
  expect(Object.keys(services).sort()).toEqual(["findText", "getTextServicesAvailability", "lookUp", "showFindBar"]);
});

test("availability is truthful per platform, module and Writing Tools hardware", async () => {
  expect(["services", "lookUp", "writingTools", "findBar"].map(feature => getTextServicesAvailability(feature as never))).toEqual(Array(4).fill({ available: true }));
  native.isWritingToolsAvailable.mockReturnValue(false);
  expect(getTextServicesAvailability("writingTools")).toEqual({ available: false, reason: "host-restriction" });
  expect(getTextServicesAvailability("findBar")).toEqual({ available: true });
  expect(() => getTextServicesAvailability("spelling" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  for (const os of ["windows", "ios", "web"]) {
    platform.OS = os;
    for (const feature of ["services", "lookUp", "writingTools", "findBar"] as const) expect(getTextServicesAvailability(feature)).toEqual({ available: false, reason: "unsupported-platform" });
    expect(await rejection(findText(input, "spark"))).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
    expect(await rejection(showFindBar(input))).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
    expect(await rejection(lookUp(input))).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
  }
  expect(native.findText).not.toHaveBeenCalled();
  // Without the native module, Services (AppKit) stay available and the Spark operations do not.
  platform.OS = "macos"; modules.present = false; vi.resetModules();
  const missing = await import("../packages/ui/src/text-services/index");
  expect(missing.getTextServicesAvailability("services")).toEqual({ available: true });
  for (const feature of ["lookUp", "writingTools", "findBar"] as const) expect(missing.getTextServicesAvailability(feature)).toEqual({ available: false, reason: "missing-module" });
  expect(await rejection(missing.lookUp(input))).toBe("SparkError:E_MODULE_UNAVAILABLE");
});

test("findText sends the target tag and options with defaults, and validates the native result", async () => {
  expect(await findText(input, "spark")).toEqual({ matchCount: 3, matchIndex: 1 });
  expect(native.findText).toHaveBeenLastCalledWith(42, "spark", false, true, false);
  await findText(input, "Spark", { caseSensitive: true, wrap: false, backwards: true });
  expect(native.findText).toHaveBeenLastCalledWith(42, "Spark", true, false, true);
  native.findText.mockResolvedValueOnce(JSON.stringify({ matchCount: 1, matchIndex: 2 }));
  expect(await rejection(findText(input, "spark"))).toBe("SparkError:E_INVALID_DATA");
  native.findText.mockRejectedValueOnce(Object.assign(new Error("The text services target has no text view"), { code: "E_INVALID_ARGUMENT" }));
  expect(await rejection(findText(input, "spark"))).toBe("SparkError:E_INVALID_ARGUMENT");
});

test("operations reject invalid targets, queries and options before reaching native code", async () => {
  native.findText.mockClear();
  expect(await rejection(findText(input, ""))).toBe("SparkError:E_INVALID_ARGUMENT");
  expect(await rejection(findText(input, 1 as never))).toBe("SparkError:E_INVALID_ARGUMENT");
  expect(await rejection(findText(input, "spark", { wrap: "yes" as never }))).toBe("SparkError:E_INVALID_ARGUMENT");
  expect(await rejection(findText(input, "spark", { wholeWord: true } as never))).toBe("SparkError:E_UNSUPPORTED_OPTION");
  expect(await rejection(findText(input, "spark", { wholeWord: undefined } as never))).toBe("SparkError:E_UNSUPPORTED_OPTION");
  expect(await rejection(findText(null, "spark"))).toBe("SparkError:E_INVALID_ARGUMENT");
  expect(await rejection(findText(unmounted, "spark"))).toBe("SparkError:E_NOT_FOUND");
  expect(await rejection(showFindBar(unmounted))).toBe("SparkError:E_NOT_FOUND");
  expect(await rejection(lookUp(null))).toBe("SparkError:E_INVALID_ARGUMENT");
  expect(native.findText).not.toHaveBeenCalled();
});

test("showFindBar and lookUp target the mounted view and keep native error codes", async () => {
  await showFindBar(input); await lookUp(input);
  expect(native.showFindBar).toHaveBeenCalledWith(42);
  expect(native.lookUp).toHaveBeenCalledWith(42);
  native.showFindBar.mockRejectedValueOnce(Object.assign(new Error("The text view has no find bar"), { code: "E_UNSUPPORTED_OPTION" }));
  expect(await rejection(showFindBar(input))).toBe("SparkError:E_UNSUPPORTED_OPTION");
  native.lookUp.mockRejectedValueOnce(Object.assign(new Error("unexpected"), { code: "SOMETHING" }));
  expect(await rejection(lookUp(input))).toBe("SparkError:E_NATIVE");
});
