import { afterEach, beforeEach, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishDirectory } from "../packages/cli/src/publish-directory.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), "spark-publish-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

// A product the shape of a build output: the app, a framework deep inside it, and the dSYMs next to it.
const files = ["App.app/Contents/Info.plist", "App.app/Contents/MacOS/App", "App.app/Contents/Frameworks/App.debug.dylib", "dSYMs/App.app.dSYM/Contents/Info.plist"];
const marker = (generation: number) => `generation ${String(generation).padStart(3, "0")} `.repeat(4096);
function stage(generation: number) {
  const staged = path.join(root, "release.staging");
  for (const file of files) {
    mkdirSync(path.dirname(path.join(staged, file)), { recursive: true });
    writeFileSync(path.join(staged, file), marker(generation));
  }
  symlinkSync("Contents/MacOS/App", path.join(staged, "App.app/link"));
  return staged;
}

test("publishes into a missing target and replaces an existing one, keeping symlinks and removing the old copy", () => {
  const target = path.join(root, "release");
  publishDirectory(stage(1), target);
  publishDirectory(stage(2), target);
  expect(files.map(file => readFileSync(path.join(target, file), "utf8"))).toEqual(files.map(() => marker(2)));
  expect(readlinkSync(path.join(target, "App.app/link"))).toBe("Contents/MacOS/App");
  expect(existsSync(path.join(root, "release.staging"))).toBe(false);
});

test("a reader polling during repeated rebuilds always finds the whole product", async () => {
  const target = path.join(root, "release");
  publishDirectory(stage(0), target);
  const stop = path.join(root, "stop");
  // Polls from another process because publishing blocks this one. Every file must exist and hold one full marker.
  const reader = spawn(process.execPath, ["-e", `
    const { existsSync, readFileSync } = require("node:fs");
    const [target, stop, length, ...files] = process.argv.slice(1);
    let reads = 0;
    const failures = [];
    console.log("ready");
    while (!existsSync(stop)) {
      for (const file of files) {
        let text;
        try { text = readFileSync(target + "/" + file, "utf8"); } catch (error) { failures.push(file + ": " + error.code); continue; }
        if (text.length !== Number(length) || !/^(generation \\d+ )+$/.test(text)) failures.push(file + ": partial");
      }
      reads++;
    }
    console.log(JSON.stringify({ reads, failures: failures.slice(0, 10) }));
  `, target, stop, String(marker(0).length), ...files], { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  reader.stdout.on("data", chunk => { output += chunk; });
  await new Promise<void>(resolve => reader.stdout.once("data", () => resolve()));
  for (let generation = 1; generation <= 20; generation++) publishDirectory(stage(generation), target);
  writeFileSync(stop, "");
  await new Promise(resolve => reader.once("exit", resolve));
  const { reads, failures } = JSON.parse(output.trim().split("\n").at(-1)!);
  expect(failures).toEqual([]);
  expect(reads).toBeGreaterThan(20);
  expect(readFileSync(path.join(target, files[0]!), "utf8")).toBe(marker(20));
}, 60_000);
