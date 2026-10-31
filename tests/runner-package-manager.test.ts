import { expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { VERSION } from "../packages/cli/src/project.ts";

const state = vi.hoisted(() => ({ home: "", manifest: "", create: vi.fn(), run: vi.fn(), build: vi.fn() }));
vi.mock("../packages/cli/src/local.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../packages/cli/src/local.ts")>(),
  sparkHome: () => state.home,
  packageManifest: () => state.manifest,
}));
vi.mock("../packages/cli/src/create.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../packages/cli/src/create.ts")>(),
  create: state.create,
}));
vi.mock("../packages/cli/src/commands.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../packages/cli/src/commands.ts")>(),
  run: state.run,
}));
vi.mock("../packages/cli/src/build.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../packages/cli/src/build.ts")>(),
  build: state.build,
}));

for (const existing of [false, true]) {
  test(`Runner CLI honors explicit Bun with competing lockfiles (${existing ? "refresh" : "create"})`, async () => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-runner-manager-"));
    const argv = process.argv;
    const exitCode = process.exitCode;
    try {
      vi.resetModules();
      vi.clearAllMocks();
      state.home = temporary;
      state.manifest = path.join(temporary, "manifest.json");
      writeFileSync(state.manifest, JSON.stringify({ "@legendapp/spark": "sdk.tgz" }));
      const bin = path.join(temporary, "bin");
      mkdirSync(bin);
      writeFileSync(path.join(bin, "bun"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
      const root = path.join(temporary, "sdk-builds", VERSION, "SparkRunner");
      const initialize = () => {
        mkdirSync(root, { recursive: true });
        writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { "@legendapp/spark": VERSION } }));
        writeFileSync(path.join(root, "desktop.config.json"), "{}");
        writeFileSync(path.join(root, "package-lock.json"), "{}");
        writeFileSync(path.join(root, "bun.lock"), "{}");
      };
      state.create.mockImplementation(async () => initialize());
      state.run.mockResolvedValue("");
      state.build.mockResolvedValue(undefined);
      if (existing) initialize();
      process.argv = [process.execPath, "spark", "sdk", "build-runner", "--platform", "macos", "--package-manager", "bun"];
      await import("../packages/cli/src/index.ts");
      expect(state.build).toHaveBeenCalledWith(root, "go", false);
      if (existing) expect(state.create).not.toHaveBeenCalled();
      else expect(state.create).toHaveBeenCalledWith(root, state.manifest, "macos", false, undefined, "bun", "so.legend.spark.prototype.sparkrunner");
      expect(state.run).toHaveBeenCalledTimes(existing ? 2 : 1);
      for (const call of state.run.mock.calls) expect(call).toEqual([root, ["bun", "install"]]);
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      vi.unstubAllEnvs();
      rmSync(temporary, { recursive: true, force: true });
    }
  });
}
