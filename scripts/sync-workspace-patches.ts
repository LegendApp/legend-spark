import { packAudio } from "./prepare-audio.ts";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { packRuntimes } from "./prepare-runtimes.ts";
import { packWindowsLibraries } from "./prepare-windows-libraries.ts";
import { run } from "../packages/cli/src/commands.ts";
import { readJson, writeJson } from "../packages/cli/src/project.ts";

// Maintainer command, never an install/start hook. Generate workspace install-time
// patches from the same source recipes used for the distributable SDK archives.
const root = path.resolve(import.meta.dirname, "..");
const cache = path.join(root, ".spark/workspace-patches");
mkdirSync(cache, { recursive: true });
const archives: Record<string, string> = { ...await packRuntimes(root, cache), ...await packWindowsLibraries(cache), ...await packAudio(root, cache) };
const pins = readJson(path.join(root, "patches/workspace/upstream.json"));
const patches: Record<string, string> = {};
for (const [name, pin] of Object.entries(pins) as [string, { version: string; url: string; integrity: string }][]) {
  const work = path.join(cache, name.replaceAll("/", "-"));
  mkdirSync(work, { recursive: true });
  const download = path.join(work, "upstream.tgz");
  if (!existsSync(download)) {
    const response = await fetch(pin.url);
    if (!response.ok) throw new Error(`Download ${name}: HTTP ${response.status}`);
    writeFileSync(download, new Uint8Array(await response.arrayBuffer()));
  }
  if (`sha512-${createHash("sha512").update(readFileSync(download)).digest("base64")}` !== pin.integrity) throw new Error(`Integrity mismatch: ${name}`);
  const before = path.join(work, "a"), after = path.join(work, "b");
  for (const dir of [before, after]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir); }
  await run(before, ["tar", "-xzf", download, "--strip-components=1"], { capture: true });
  cpSync(before, after, { recursive: true });
  await run(after, ["tar", "-xzf", path.join(cache, archives[name]!)], { capture: true });
  for (const dir of [before, after]) rmSync(path.join(dir, ".spark"), { recursive: true, force: true });
  const diff = spawnProcess(["git", "diff", "--no-index", "--binary", "--", "a", "b"], { cwd: work, stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([new Response(diff.stdout).text(), new Response(diff.stderr).text(), diff.exited]);
  if (code !== 0 && code !== 1) throw new Error(error);
  const file = `patches/workspace/${name.replace(/^@/, "").replaceAll("/", "-")}@${pin.version}.patch`;
  writeFileSync(path.join(root, file), output.split("\n").map(line => /^(diff --git|--- |\+\+\+ )/.test(line) ? line.replace(/([ab])\/[ab]\//g, "$1/") : line).join("\n"));
  patches[`${name}@${pin.version}`] = file;
}
const pkg = readJson(path.join(root, "package.json"));
pkg.sparkWorkspacePatches = patches;
writeJson(path.join(root, "package.json"), pkg);
console.log("Updated workspace install patches. Run npm run postinstall to apply them.");
