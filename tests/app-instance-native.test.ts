import { afterAll, beforeAll, expect, test } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Real processes contend for one instance: tests/app-instance.native.mm compiled with the
// actual packages/desktop-app/macos/SparkInstance.mm.
const darwin = process.platform === "darwin";
let directory = "", binary = "";
beforeAll(() => {
  if (!darwin) return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-instance-"));
  binary = path.join(directory, "instance-test");
  const root = path.resolve(import.meta.dirname, "..");
  const native = path.join(root, "packages/desktop-app/macos");
  execFileSync("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "Foundation", "-I", native,
    path.join(native, "SparkInstance.mm"), path.join(root, "tests/app-instance.native.mm"), "-o", binary]);
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

type Run = { child: ChildProcess; lines: string[]; done: Promise<number | null>; line(prefix: string): Promise<string> };
function run(...args: string[]): Run {
  const child = spawn(binary, args, { stdio: ["ignore", "pipe", "inherit"] });
  const lines: string[] = [], waiters: (() => void)[] = [];
  let buffer = "";
  child.stdout!.on("data", chunk => {
    buffer += chunk;
    for (let index; (index = buffer.indexOf("\n")) >= 0; buffer = buffer.slice(index + 1)) lines.push(buffer.slice(0, index));
    waiters.splice(0).forEach(wake => wake());
  });
  // "close" waits for every holder of stdout, including a relaunched child.
  const done = new Promise<number | null>(resolve => child.on("close", code => resolve(code)));
  const line = (prefix: string) => new Promise<string>((resolve, reject) => {
    const look = () => { const found = lines.find(item => item.startsWith(prefix)); if (found) resolve(found); else waiters.push(look); };
    void done.then(() => { const found = lines.find(item => item.startsWith(prefix)); if (found) resolve(found); else reject(new Error(`No "${prefix}" in ${JSON.stringify(lines)}`)); });
    look();
  });
  return { child, lines, done, line };
}
const launches = (owner: Run) => owner.lines.filter(item => item.startsWith("LAUNCH ")).map(item => JSON.parse(item.slice(7)));

test.skipIf(!darwin)("validation rejects malformed launches and waiting for an exited process returns", async () => {
  const check = run("validate");
  expect(await check.done).toBe(0);
  expect(check.lines).toContain("VALID");
});

test.skipIf(!darwin)("a second process forwards arguments, files and URLs to the owner and exits after acknowledgment", async () => {
  const owner = run("launch", directory, "pair", "owner", "8");
  await owner.line("PRIMARY owner");
  const second = run("launch", directory, "pair", "second", "8");
  expect(await second.done).toBe(0);
  expect(second.lines).toEqual(["FORWARDED second"]);
  // The acknowledgment follows the receiver, so the owner has already printed the launch.
  expect(launches(owner)).toEqual([{ arguments: ["app", "second"], workingDirectory: "/tmp", files: ["/tmp/second"], urls: ["spark-test://open/second"] }]);
  owner.child.kill("SIGKILL");
  await owner.done;
}, 20000);

test.skipIf(!darwin)("simultaneous launches elect exactly one owner and every other launch reaches it", async () => {
  const runs = Array.from({ length: 6 }, (_, index) => run("launch", directory, "race", `p${index}`, "4"));
  const forwarded = await Promise.all(runs.map(async item => {
    const first = await Promise.race([item.line("PRIMARY"), item.line("FORWARDED")]);
    return first.startsWith("FORWARDED") ? first.slice(10) : undefined;
  }));
  const owners = runs.filter((_, index) => forwarded[index] === undefined);
  expect(owners).toHaveLength(1);
  await Promise.all(runs.filter(item => item !== owners[0]).map(item => item.done));
  expect(launches(owners[0]!).map(launch => launch.arguments[1]).sort()).toEqual(forwarded.filter(Boolean).sort());
  owners[0]!.child.kill("SIGKILL");
  await owners[0]!.done;
}, 30000);

test.skipIf(!darwin)("a crashed owner releases the lock and its stale socket is replaced", async () => {
  const crashed = run("launch", directory, "crash", "crashed", "8");
  await crashed.line("PRIMARY crashed");
  crashed.child.kill("SIGKILL");
  await crashed.done;
  const next = run("launch", directory, "crash", "next", "8");
  await next.line("PRIMARY next");
  const later = run("launch", directory, "crash", "later", "8");
  expect(await later.done).toBe(0);
  expect(launches(next).map(launch => launch.arguments[1])).toEqual(["later"]);
  next.child.kill("SIGKILL");
  await next.done;
}, 20000);

test.skipIf(!darwin)("a malformed payload is closed without acknowledgment and later launches still arrive", async () => {
  const owner = run("launch", directory, "bad", "owner", "8");
  await owner.line("PRIMARY owner");
  const bad = run("malformed", directory, "bad");
  expect(await bad.done).toBe(0);
  const good = run("launch", directory, "bad", "good", "8");
  expect(await good.done).toBe(0);
  expect(launches(owner).map(launch => launch.arguments[1])).toEqual(["good"]);
  owner.child.kill("SIGKILL");
  await owner.done;
}, 20000);

test.skipIf(!darwin)("an approved relaunch child waits for its parent to exit, then owns the instance", async () => {
  const relauncher = run("relaunch", directory, "relaunch", "approve");
  expect(await relauncher.done).toBe(0);
  const order = relauncher.lines.filter(item => !item.startsWith("LAUNCH"));
  expect(order).toEqual(["PRIMARY relauncher", "EXITING", "RELAUNCHED child", "PRIMARY child"]);
}, 20000);

test.skipIf(!darwin)("a vetoed relaunch kills the waiting child and the parent keeps the instance", async () => {
  const relauncher = run("relaunch", directory, "veto", "veto");
  await relauncher.line("PRIMARY vetoed");
  const later = run("launch", directory, "veto", "later", "8");
  expect(await later.done).toBe(0);
  expect(relauncher.lines.some(item => item.startsWith("RELAUNCHED"))).toBe(false);
  expect(launches(relauncher).map(launch => launch.arguments[1])).toEqual(["later"]);
  await relauncher.done;
}, 20000);
