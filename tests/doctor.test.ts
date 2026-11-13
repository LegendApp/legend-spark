import { spawnProcess, which } from "../packages/cli/src/process.ts";
import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

test.skipIf(process.platform !== "darwin")(
  "missing Xcode produces an actionable diagnostic without starting a build",
  async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "spark-doctor-"));
    try {
      for (const command of ["node", "pod"])
        symlinkSync(
          which(command) ?? process.execPath,
          path.join(root, command),
        );
      const child = spawnProcess(
        [
          process.execPath,
          path.resolve(import.meta.dirname, "../packages/cli/src/index.ts"),
          "doctor",
          "--project",
          root,
        ],
        { env: { ...process.env, PATH: root }, stdout: "pipe", stderr: "pipe" },
      );
      const error = await new Response(child.stderr).text();
      expect(await child.exited).toBe(1);
      expect(error).toContain("Missing xcodebuild");
      expect(error).toContain("retry");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform !== "darwin")("preparation tooling checks never require or invoke xcodebuild", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-prebuild-doctor-"));
  try {
    for (const command of ["node", "pod"]) symlinkSync(which(command) ?? process.execPath, path.join(root, command));
    symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"));
    writeFileSync(path.join(root, "package.json"), "{}");
    writeFileSync(path.join(root, "xcrun"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const commands = path.resolve("packages/cli/src/commands.ts");
    const child = spawnProcess([process.execPath, "-e", `import { doctor } from ${JSON.stringify(commands)}; await doctor(${JSON.stringify(root)}, { nativeBuild: false });`], {
      env: { ...process.env, PATH: root }, stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, out + err).toBe(0);
    const log = readFileSync(path.join(root, ".spark/commands.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(log.map(command => command.argv[0])).toEqual(["xcrun"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("doctor exits 1 with app patch fixes before probing native tooling", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-doctor-patches-"));
  try {
    mkdirSync(path.join(root, "patches"));
    mkdirSync(path.join(root, "node_modules/plain-lib"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), "{}");
    writeFileSync(path.join(root, "node_modules/plain-lib/package.json"), JSON.stringify({ name: "plain-lib", version: "2.0.0" }));
    writeFileSync(path.join(root, "patches/plain-lib@1.0.0.patch"), "");
    writeFileSync(path.join(root, "patches/missing-lib@1.0.0.patch"), "");
    const child = spawnProcess([
      process.execPath, path.resolve("packages/cli/src/index.ts"), "doctor", "--project", root,
    ], { env: { ...process.env, PATH: "" }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(code, out + err).toBe(1);
    expect(err).toContain("plain-lib@1.0.0, but 2.0.0 is installed");
    expect(err).toContain("missing-lib, which isn't installed");
    expect(err.match(/Fix:/g)).toHaveLength(2);
    expect(err).not.toContain("Missing node");
    expect(existsSync(path.join(root, ".spark"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
