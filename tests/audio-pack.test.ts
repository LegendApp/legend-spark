import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { packAudio } from "../scripts/prepare-audio.ts";
import { packArchive } from "../packages/cli/src/pack-archive.ts";
const { parsePatch, applyPatch, reversePatch } = createRequire(import.meta.url)("diff");
test("distributed audio archives apply the exact workspace delta and verify upstream integrity", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-audio-package-"));
  try {
    const actual = path.resolve(import.meta.dirname, "..");
    const patch = readFileSync(path.join(actual, "patches/workspace/expo-audio@1.1.1.patch"), "utf8");
    const stage = path.join(root, "upstream"), cache = path.join(root, ".spark/vendor/audio"), output = path.join(root, "output");
    mkdirSync(cache, { recursive: true }); mkdirSync(path.join(root, "patches/workspace"), { recursive: true });
    const expected = new Map<string, string>();
    for (const file of parsePatch(patch)) {
      const relative = file.newFileName.replace(/^b\//, ""), installed = readFileSync(path.join(actual, "node_modules/expo-audio", relative), "utf8");
      const reversed = applyPatch(installed, reversePatch(file));
      const original = reversed === false ? installed : reversed;
      const patched = applyPatch(original, file); expect(patched).not.toBe(false); expected.set(relative, patched);
      const target = path.join(stage, relative); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, original);
    }
    const archive = path.join(cache, "upstream.tgz"); await packArchive(stage, archive);
    writeFileSync(path.join(root, "patches/workspace/upstream.json"), JSON.stringify({ "expo-audio": { version: "1.1.1", integrity: `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}` } }));
    writeFileSync(path.join(root, "patches/workspace/expo-audio@1.1.1.patch"), patch);
    const manifest = await packAudio(root, output); const packed = path.join(output, manifest["expo-audio"]);
    for (const [relative, value] of expected) expect(execFileSync("tar", ["-xOf", packed, `package/${relative}`], { encoding: "utf8" })).toBe(value);
    writeFileSync(archive, "invalid"); await expect(packAudio(root, output)).rejects.toThrow("Integrity mismatch");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
