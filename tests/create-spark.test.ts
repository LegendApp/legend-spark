import { afterEach, beforeEach, expect, test, vi } from "vitest";
import path from "node:path";
import { creatorArguments, rerunCommand, rerunNewerCreator, resolveCreatorVersion } from "../packages/create-spark/src/version.ts";
import { VERSION } from "../packages/cli/src/project.ts";

vi.mock("../packages/cli/src/create.ts", () => ({ create: vi.fn() }));
import { create } from "../packages/cli/src/create.ts";
import { createSpark } from "../packages/create-spark/src/create.ts";
vi.mock("../packages/cli/src/process.ts", async importOriginal => ({ ...await importOriginal<object>(), spawnProcess: vi.fn() }));
import { spawnProcess, type ManagedProcess } from "../packages/cli/src/process.ts";

// Keep tests off the registry; rerun tests clear this guard explicitly.
beforeEach(() => { vi.stubEnv("SPARK_CREATOR_RERUN", "1"); });
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

test("create launcher delegates the app path, local archives, template, manager and bundle ID to the shared creator", async () => {
  vi.stubEnv("SPARK_PLATFORM", undefined);
  await createSpark(["MyApp", "--packages", "archives/manifest.json", "--platform", "windows", "--universal", "--example", "notes-lite", "--package-manager", "npm", "--bundle-id", "com.acme.myapp"]);
  expect(create).toHaveBeenCalledExactlyOnceWith(path.resolve("MyApp"), path.resolve("archives/manifest.json"), "windows", true, "notes-lite", "npm", "com.acme.myapp");
  expect(process.env.SPARK_PLATFORM).toBe("windows");
});

test("published creation uses release metadata and the host platform", async () => {
  vi.stubEnv("SPARK_PLATFORM", undefined);
  await createSpark(["MyApp"]);
  expect(create).toHaveBeenCalledExactlyOnceWith(path.resolve("MyApp"), undefined, process.platform === "win32" ? "windows" : "macos", false, undefined, undefined, undefined);
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
  ["Use create --universal for mobile/web targets", `Use npx @legendapp/create-spark@${VERSION} MyApp --universal for mobile/web targets`],
  ["Invalid project. Run spark --help.", "Invalid project. Run npm create @legendapp/spark@next -- --help."],
])("creator error uses launcher flag syntax: %s", async (message, expected) => {
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

const tags = (value: Record<string, string>) => vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(value)));

test("creator reruns itself through the same package manager at a newer dist-tag version", async () => {
  vi.mocked(spawnProcess).mockReturnValue({ exited: Promise.resolve(3) } as ManagedProcess);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const env = { npm_config_user_agent: "pnpm/11.0.0 npm/? node/v24.19.0 darwin arm64" };
  try {
    expect(await rerunNewerCreator(undefined, ["MyApp", "--platform", "macos"], tags({ latest: "9.0.0", next: "9.1.0-next.1" }), env)).toBe(3);
    expect(spawnProcess).toHaveBeenCalledExactlyOnceWith(["pnpm", "dlx", "@legendapp/create-spark@9.0.0", "MyApp", "--platform", "macos"], expect.objectContaining({ env: expect.objectContaining({ SPARK_CREATOR_RERUN: "1", pnpm_config_minimum_release_age: "0" }) }));
    vi.mocked(spawnProcess).mockClear();
    expect(await rerunNewerCreator("latest", ["MyApp", "--latest"], tags({ latest: "9.0.0", next: "9.1.0-next.1" }), env)).toBe(3);
    expect(vi.mocked(spawnProcess).mock.calls[0]![0]).toEqual(["pnpm", "dlx", "@legendapp/create-spark@9.0.0", "MyApp", "--latest"]);
  } finally { log.mockRestore(); }
});

test("creator continues when offline, current, guarded, or given an exact version", async () => {
  const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
  expect(await rerunNewerCreator(undefined, ["MyApp"], offline, {})).toBeUndefined();
  expect(await rerunNewerCreator(undefined, ["MyApp"], vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 503 })), {})).toBeUndefined();
  expect(await rerunNewerCreator(undefined, ["MyApp"], tags({ latest: VERSION, next: "9.0.0-next.1" }), {})).toBeUndefined();
  expect(await rerunNewerCreator(undefined, ["MyApp"], tags({ latest: "0.0.0" }), {})).toBeUndefined();
  const newer = tags({ latest: "9.0.0" });
  expect(await rerunNewerCreator(undefined, ["MyApp"], newer, { SPARK_CREATOR_RERUN: "1" })).toBeUndefined();
  expect(await rerunNewerCreator(VERSION, ["MyApp"], newer, {})).toBeUndefined();
  expect(newer).not.toHaveBeenCalled();
  expect(spawnProcess).not.toHaveBeenCalled();
});

test("creator continues when npm's bundled semver cannot load", async () => {
  vi.resetModules();
  vi.doMock("node:module", async importOriginal => {
    const original = await importOriginal<typeof import("node:module")>();
    return { ...original, createRequire: (from: string) => {
      const require = original.createRequire(from);
      return Object.assign((id: string) => require(id), require, { resolve: (id: string) => { if (id === "npm/package.json") throw new Error("Cannot find module"); return require.resolve(id); } });
    } };
  });
  try {
    const { rerunNewerCreator } = await import("../packages/create-spark/src/version.ts");
    expect(await rerunNewerCreator(undefined, ["MyApp"], tags({ latest: "9.0.0" }), {})).toBeUndefined();
  } finally { vi.doUnmock("node:module"); vi.resetModules(); }
});

test("creator prints the exact command when it cannot rerun", async () => {
  vi.mocked(spawnProcess).mockReturnValue({ exited: Promise.reject(new Error("spawn pnpm ENOENT")) } as ManagedProcess);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await expect(rerunNewerCreator(undefined, ["My App"], tags({ latest: "9.0.0" }), {})).rejects.toThrow("npx @legendapp/create-spark@9.0.0 'My App'");
  } finally { log.mockRestore(); }
});

test.each([
  ["npm/11.0.0", ["npm", "exec", "--yes", "--package=@legendapp/create-spark@9.0.0", "--", "create-spark", "MyApp"]],
  ["pnpm/11.0.0", ["pnpm", "dlx", "@legendapp/create-spark@9.0.0", "MyApp"]],
  ["bun/1.3.0", ["bun", "x", "@legendapp/create-spark@9.0.0", "MyApp"]],
  ["yarn/4.9.0", ["yarn", "dlx", "-p", "@legendapp/create-spark@9.0.0", "create-spark", "MyApp"]],
  ["yarn/1.22.0", ["npm", "exec", "--yes", "--package=@legendapp/create-spark@9.0.0", "--", "create-spark", "MyApp"]],
])("creator rerun command for %s", (agent, argv) => {
  expect(rerunCommand("@legendapp/create-spark@9.0.0", ["MyApp"], { npm_config_user_agent: agent })).toEqual(argv);
});

test("a rerun creator replaces scaffolding with its exit code", async () => {
  vi.stubEnv("SPARK_CREATOR_RERUN", undefined);
  vi.stubGlobal("fetch", tags({ latest: "9.0.0" }));
  vi.mocked(spawnProcess).mockReturnValue({ exited: Promise.resolve(0) } as ManagedProcess);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await createSpark(["MyApp"]);
    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  } finally { vi.unstubAllGlobals(); log.mockRestore(); process.exitCode = undefined; }
});

test("creator strips manager separators before parsing app flags", async () => {
  expect(creatorArguments(["MyApp", "--", "--universal", "--next"])).toEqual({ requested: "next", forwarded: ["MyApp", "--universal"] });
  await createSpark(["MyApp", "--", "--universal"]);
  expect(create).toHaveBeenCalledExactlyOnceWith(path.resolve("MyApp"), undefined, process.platform === "win32" ? "windows" : "macos", true, undefined, undefined, undefined);
});

test.each([
  { npm_config_user_agent: "pnpm/11.0.0 @legendapp/spark@0.0.1" },
  { npm_config_user_agent: "npm/12.0.2 create-spark/0.0.1" },
  { npm_config_package: "@legendapp/create-spark@0.0.1" },
  { npm_config_package: '["create-spark@1.2.3", "other@latest"]' },
  { npm_config_argv: JSON.stringify({ original: ["create", "@legendapp/spark@0.0.1", "MyApp"] }) },
  { pnpm_config_package: "@legendapp/create-spark@1.2.3-next.1" },
  { pnpm_config_argv: 'dlx @legendapp/create-spark@^1.0.0 MyApp' },
  { NPX_PACKAGE: "create-spark@1.2.3" },
  { npm_config_package: "@legendapp/create-spark@next" },
])("creator preserves a manager selection: %j", async env => {
  const fetcher = tags({ latest: "9.0.0", next: "9.1.0-next.1" });
  expect(await rerunNewerCreator(undefined, ["MyApp"], fetcher, env)).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
  expect(spawnProcess).not.toHaveBeenCalled();
});

test.each(["latest", "next", VERSION])("--spark-version %s never reruns", async requested => {
  const fetcher = tags({ latest: "9.0.0", next: "9.1.0-next.1" });
  for (const selection of [["--spark-version", requested], [`--spark-version=${requested}`]]) {
    expect(await rerunNewerCreator(requested, ["MyApp", ...selection], fetcher, {})).toBeUndefined();
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect(spawnProcess).not.toHaveBeenCalled();
});

test.each([
  ["0.0.2-next.1", undefined, { latest: "9.0.0", next: "0.0.2-next.2" }, "0.0.2-next.2"],
  ["0.0.2-next.1", "next", { latest: "9.0.0", next: "0.0.2-next.2" }, "0.0.2-next.2"],
  ["0.0.2-next.1", undefined, { latest: "9.0.0", next: "0.0.2-next.1" }, undefined],
  ["0.0.2-next.1", undefined, { latest: "9.0.0", next: "0.0.2" }, undefined],
  ["0.0.2-next.1", "latest", { latest: "9.0.0", next: "0.0.2-next.2" }, undefined],
  ["0.0.2-beta.1", undefined, { latest: "9.0.0", beta: "0.0.2-beta.2" }, "0.0.2-beta.2"],
  ["0.0.1", "next", { latest: "9.0.0", next: "9.1.0-next.1" }, undefined],
  ["0.0.1", "preview", { preview: "9.0.0" }, undefined],
  ["0.0.1", undefined, { latest: "9.0.0-next.1" }, undefined],
] as const)("creator %s only refreshes its default channel (%s)", async (version, requested, distTags, expected) => {
  vi.resetModules();
  vi.doMock("../packages/cli/src/project.ts", () => ({ VERSION: version }));
  vi.mocked(spawnProcess).mockReturnValue({ exited: Promise.resolve(0) } as ManagedProcess);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const { rerunNewerCreator } = await import("../packages/create-spark/src/version.ts");
    expect(await rerunNewerCreator(requested, ["MyApp", ...requested ? [`--${requested}`] : []], tags(distTags), {})).toBe(expected ? 0 : undefined);
    if (expected) expect(vi.mocked(spawnProcess).mock.calls[0]![0]).toContain(`--package=@legendapp/create-spark@${expected}`);
    else expect(spawnProcess).not.toHaveBeenCalled();
  } finally { log.mockRestore(); vi.doUnmock("../packages/cli/src/project.ts"); vi.resetModules(); }
});
