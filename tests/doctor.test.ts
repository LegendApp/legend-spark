import { spawnProcess, which } from "../packages/cli/src/process.ts";
import { expect, test } from "vitest";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
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
