import { afterEach, expect, test, vi } from "vitest";
import path from "node:path";

vi.mock("../packages/cli/src/create.ts", () => ({ create: vi.fn() }));
import { create } from "../packages/cli/src/create.ts";
import { createSpark } from "../packages/create-spark/src/create.ts";

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

test("create launcher delegates the app path, local archives, template and manager to the shared creator", async () => {
  vi.stubEnv("SPARK_PLATFORM", undefined);
  await createSpark(["MyApp", "--packages", "archives/manifest.json", "--platform", "windows", "--universal", "--example", "notes-lite", "--package-manager", "npm"]);
  expect(create).toHaveBeenCalledExactlyOnceWith(path.resolve("MyApp"), path.resolve("archives/manifest.json"), "windows", true, "notes-lite", "npm");
  expect(process.env.SPARK_PLATFORM).toBe("windows");
});

test("published creation uses release metadata and the host platform", async () => {
  vi.stubEnv("SPARK_PLATFORM", undefined);
  await createSpark(["MyApp"]);
  expect(create).toHaveBeenCalledExactlyOnceWith(path.resolve("MyApp"), undefined, process.platform === "win32" ? "windows" : "macos", false, undefined, undefined);
});

test("help and invalid create options do not scaffold an app", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await createSpark(["--help"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("npm create @legendapp/spark"));
    for (const args of [[], ["MyApp", "Extra"], ["MyApp", "--force"], ["MyApp", "--platform", "linux"], ["MyApp", "--package-manager", "unknown"], ["MyApp", "--example", "unknown"]]) {
      await expect(createSpark(args)).rejects.toThrow();
    }
    expect(create).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

test("installation errors propagate to the launcher", async () => {
  vi.stubEnv("SPARK_PLATFORM", undefined);
  vi.mocked(create).mockRejectedValueOnce(new Error("Dependency installation failed"));
  await expect(createSpark(["MyApp"])).rejects.toThrow("Dependency installation failed");
});

test.each([
  ["Use create --universal for mobile/web targets", "Use npm create @legendapp/spark@next MyApp -- --universal for mobile/web targets"],
  ["Invalid project. Run spark --help.", "Invalid project. Run npm create @legendapp/spark@next -- --help."],
])("creator error uses npm create flag syntax: %s", async (message, expected) => {
  vi.mocked(create).mockRejectedValueOnce(new Error(message));
  await expect(createSpark(["MyApp", "--platform", "ios"])).rejects.toThrow(expected);
});
