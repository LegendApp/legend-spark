import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { packArchive } from "../packages/cli/src/pack-archive.ts";
import { readJson } from "../packages/cli/src/project.ts";
import { run } from "../packages/cli/src/commands.ts";

export function audioPatchHash(root: string) {
  const pin = readJson(path.join(root, "patches/workspace/upstream.json"))["expo-audio"];
  return createHash("sha256").update(JSON.stringify(pin)).update(readFileSync(import.meta.filename)).update(readFileSync(path.join(root, `patches/workspace/expo-audio@${pin.version}.patch`))).digest("hex");
}

/** The workspace and distributed SDK consume the same pinned Expo Audio delta. */
export async function packAudio(root: string, output: string) {
  const pin = readJson(path.join(root, "patches/workspace/upstream.json"))["expo-audio"];
  const cache = path.join(root, ".spark/vendor/audio"); mkdirSync(cache, { recursive: true }); mkdirSync(output, { recursive: true });
  const archive = path.join(cache, "upstream.tgz");
  if (!existsSync(archive)) {
    const response = await fetch(pin.url); if (!response.ok) throw new Error(`Download expo-audio: HTTP ${response.status}`);
    writeFileSync(archive, new Uint8Array(await response.arrayBuffer()));
  }
  if (`sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}` !== pin.integrity) throw new Error("Integrity mismatch: expo-audio");
  const stage = path.join(cache, "stage"); rmSync(stage, { recursive: true, force: true }); mkdirSync(stage);
  await run(stage, ["tar", "-xzf", archive, "--strip-components=1"], { capture: true });
  if (readJson(path.join(stage, "package.json")).version !== pin.version) throw new Error("Unexpected expo-audio version");
  const { parsePatch, applyPatch } = createRequire(import.meta.url)("diff");
  for (const patch of parsePatch(readFileSync(path.join(root, `patches/workspace/expo-audio@${pin.version}.patch`), "utf8"))) {
    const target = path.join(stage, patch.newFileName.replace(/^b\//, ""));
    const next = applyPatch(readFileSync(target, "utf8"), patch);
    if (next === false) throw new Error(`Could not apply Expo Audio patch to ${target}`);
    writeFileSync(target, next);
  }
  const pkg = readJson(path.join(stage, "package.json"));
  pkg.spark = { ...pkg.spark, sdk: true, upstreamIntegrity: pin.integrity, patchHash: audioPatchHash(root) };
  writeFileSync(path.join(stage, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  const temporary = path.join(output, "expo-audio.tgz"); await packArchive(stage, temporary);
  const hash = createHash("sha256").update(readFileSync(temporary)).digest("hex").slice(0, 12);
  const file = `expo-audio-${pin.version}-${hash}.tgz`; renameSync(temporary, path.join(output, file));
  return { "expo-audio": file };
}
