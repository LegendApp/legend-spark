import { afterEach, expect, test, vi } from "vitest";
import path from "node:path";
import { creatorArguments, resolveCreatorVersion } from "../packages/create-spark/src/version.ts";
import { VERSION } from "../packages/cli/src/project.ts";

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

test.each(["--next", "--latest", "--spark-version"])("creator parses %s and keeps app options", flag => {
  const args = flag === "--spark-version" ? [flag, "preview"] : [flag];
  expect(creatorArguments(["MyApp", ...args, "--platform", "macos"])).toEqual({ requested: flag === "--spark-version" ? "preview" : flag.slice(2), forwarded: ["MyApp", "--platform", "macos"] });
});

test.each([
  ["--next", "--latest"], ["--next", "--spark-version", "next"], ["--latest", "--spark-version=latest"],
  ["--next", "--next"], ["--spark-version"], ["--spark-version="], ["--spark-version", "--latest"],
])("invalid creator selection fails before scaffolding: %j", async (...args) => {
  await expect(createSpark(["MyApp", ...args])).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});

test("creator resolves only dist-tags; exact versions need no registry request", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ next: VERSION, latest: "1.0.0" })));
  expect(await resolveCreatorVersion(VERSION, fetcher)).toBe(VERSION);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await resolveCreatorVersion("next", fetcher)).toBe(VERSION);
  expect(fetcher).toHaveBeenCalledWith("https://registry.npmjs.org/-/package/@legendapp%2fspark/dist-tags", expect.anything());
  await expect(resolveCreatorVersion("missing", fetcher)).rejects.toThrow("no exact Spark version");
  await expect(resolveCreatorVersion("^1.0.0", fetcher)).rejects.toThrow("Invalid Spark version");
  fetcher.mockResolvedValue(new Response("", { status: 503 }));
  await expect(resolveCreatorVersion("next", fetcher)).rejects.toThrow("HTTP 503");
});

test("matching creator proceeds and mismatched creator gives an exact command without scaffolding", async () => {
  await createSpark(["MyApp", "--spark-version", VERSION]);
  expect(create).toHaveBeenCalledOnce();
  vi.clearAllMocks();
  await expect(createSpark(["My App", "--spark-version", "9.0.0", "--package-manager", "pnpm"])).rejects.toThrow("npx @legendapp/create-spark@9.0.0 'My App' '--package-manager' 'pnpm'");
  expect(create).not.toHaveBeenCalled();
});

test("channel flags reach the bundled creator when tags match", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ next: VERSION, latest: VERSION }))));
  try {
    await createSpark(["MyApp", "--next"]);
    await createSpark(["MyApp", "--latest"]);
    expect(create).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
