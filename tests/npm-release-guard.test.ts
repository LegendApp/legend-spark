import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishAndWait, requireNpmTerminal, verifyCreatorArchive } from "../scripts/npm-release.ts";

test.each(["valid", "missing metadata", "wrong release", "wrong package", "dev folder", "symlink"])("creator publication guard: %s", async scenario => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-creator-guard-"));
  const version = "0.0.1-next.7";
  try {
    const source = path.join(root, "source/package");
    mkdirSync(path.join(source, "dist"), { recursive: true });
    writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "@legendapp/create-spark", version: scenario === "wrong package" ? "0.0.1-next.5" : version }));
    if (scenario !== "missing metadata") writeFileSync(path.join(source, "dist/release.json"), JSON.stringify({ version: scenario === "wrong release" ? "0.0.1-next.5" : version }));
    const folder = path.join(root, scenario === "dev folder" || scenario === "symlink" ? "artifacts/packages" : `artifacts/releases/${version}`);
    mkdirSync(folder, { recursive: true });
    let archive = path.join(folder, "create.tgz");
    execFileSync("tar", ["-czf", archive, "-C", path.dirname(source), "package"]);
    if (scenario === "symlink") {
      const link = path.join(root, `artifacts/releases/${version}/create.tgz`);
      mkdirSync(path.dirname(link), { recursive: true });
      symlinkSync(archive, link); archive = link;
    }
    if (scenario === "valid") expect(() => verifyCreatorArchive(root, version, archive)).not.toThrow();
    else {
      const message = scenario === "missing metadata" ? "dist/release.json" : scenario.includes("wrong") ? "must match SDK" : "must be under";
      expect(() => verifyCreatorArchive(root, version, archive)).toThrow(message);
      await expect(publishAndWait(root, { name: "@legendapp/create-spark", version, revision: "a".repeat(40), archive, published: false }, async () => { throw new Error("must not query registry"); }, async () => { throw new Error("must not publish"); })).rejects.toThrow(message);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each([[true, true], [false, true], [true, false], [false, false]])("npm requires stdin TTY %s and stdout TTY %s", (input, output) => {
  const check = () => requireNpmTerminal({ isTTY: input }, { isTTY: output });
  if (input && output) expect(check).not.toThrow();
  else expect(check).toThrow("both stdin and stdout");
});
