import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, runOk } from "./subprocess";

const darwin = process.platform === "darwin";
const marker = ".spark-bundle-identifier";
let build = "", binary = "";
const roots: string[] = [];
beforeAll(async () => {
  if (!darwin) return;
  build = mkdtempSync(path.join(os.tmpdir(), "spark-storage-build-"));
  binary = path.join(build, "migrate");
  const input = path.join(build, "main.mm");
  const native = path.resolve("packages/desktop-app/macos");
  writeFileSync(input, `#import "SparkStorage.h"
int main(int argc, char **argv) { @autoreleasepool {
  NSMutableArray *legacy = [NSMutableArray new];
  for (int i = 4; i < argc; i++) [legacy addObject:[NSURL fileURLWithPath:@(argv[i]) isDirectory:YES]];
  NSError *error;
  BOOL result = SparkMigrateStorage([NSURL fileURLWithPath:@(argv[1]) isDirectory:YES], legacy, @(argv[2]), @(argv[3]), &error);
  if (!result) fprintf(stderr, "%s\\n", error.localizedDescription.UTF8String);
  return result ? 0 : 1;
} }
`);
  await runOk("clang++", ["-fobjc-arc", "-framework", "Foundation", "-I", native, path.join(native, "SparkStorage.mm"), input, "-o", binary]);
});
afterAll(() => { if (build) rmSync(build, { recursive: true, force: true }); });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-storage-")); roots.push(root);
  const legacy = path.join(root, "Legacy Display Name");
  const destination = path.join(root, "test.original", "Spark");
  mkdirSync(legacy);
  writeFileSync(path.join(legacy, "settings.json"), "saved-before-upgrade");
  return { root, legacy, destination };
}
const migrate = (destination: string, legacy: string[], bundle = "test.original", configured = "test.original") => run(binary, [destination, bundle, configured, ...legacy]);

test.skipIf(!darwin)("the configured app adopts unmarked legacy data once with an atomic move of the owned source", async () => {
  const f = fixture();
  // An existing AsyncStorage/Nitro SQLite bundle folder does not mask legacy Spark data.
  mkdirSync(path.dirname(f.destination));
  writeFileSync(path.join(path.dirname(f.destination), "unrelated.sqlite"), "existing-db");
  expect((await migrate(f.destination, [f.legacy])).status).toBe(0);
  expect(readFileSync(path.join(f.destination, "settings.json"), "utf8")).toBe("saved-before-upgrade");
  expect(existsSync(f.legacy)).toBe(false);
  expect(readFileSync(path.join(f.destination, marker), "utf8")).toBe("test.original");

  writeFileSync(path.join(f.destination, "settings.json"), "saved-after-upgrade");
  expect((await migrate(f.destination, [f.legacy])).status).toBe(0);
  expect(readFileSync(path.join(f.destination, "settings.json"), "utf8")).toBe("saved-after-upgrade");
});
test.skipIf(!darwin)("a changed-bundle clone never adopts unmarked data, before or after the original migrates", async () => {
  const f = fixture();
  const clone = path.join(f.root, "test.clone", "Spark");
  expect((await migrate(clone, [f.legacy], "test.clone")).status).toBe(0);
  expect(existsSync(path.join(clone, "settings.json"))).toBe(false);
  expect(existsSync(path.join(f.legacy, marker))).toBe(false);
  expect((await migrate(f.destination, [f.legacy])).status).toBe(0);
  expect((await migrate(clone, [f.legacy], "test.clone")).status).toBe(0);
  expect(existsSync(path.join(clone, "settings.json"))).toBe(false);
});
test.skipIf(!darwin)("a matching recorded owner can migrate even after configuration changes", async () => {
  const f = fixture();
  writeFileSync(path.join(f.legacy, marker), "test.original");
  expect((await migrate(f.destination, [f.legacy], "test.original", "test.other")).status).toBe(0);
  expect(existsSync(path.join(f.destination, "settings.json"))).toBe(true);
});
test.skipIf(!darwin)("another recorded owner is preserved and never copied even by the configured app", async () => {
  const f = fixture();
  writeFileSync(path.join(f.legacy, marker), "test.other");
  expect((await migrate(f.destination, [f.legacy])).status).toBe(0);
  expect(existsSync(path.join(f.destination, "settings.json"))).toBe(false);
  expect(readFileSync(path.join(f.legacy, marker), "utf8")).toBe("test.other");
});
test.skipIf(!darwin)("existing destination data is never overwritten and a different destination owner rejects", async () => {
  const f = fixture();
  mkdirSync(f.destination, { recursive: true });
  writeFileSync(path.join(f.destination, "settings.json"), "current");
  expect((await migrate(f.destination, [f.legacy])).status).toBe(0);
  expect(readFileSync(path.join(f.destination, "settings.json"), "utf8")).toBe("current");
  writeFileSync(path.join(f.destination, marker), "test.other");
  expect((await migrate(f.destination, [f.legacy])).stderr).toContain("another bundle");
  expect(readFileSync(path.join(f.destination, "settings.json"), "utf8")).toBe("current");
});
test.skipIf(!darwin)("ambiguous legacy directories and missing default identity fail without creating a destination", async () => {
  const f = fixture(), second = path.join(f.root, "legacy-namespace");
  mkdirSync(second);
  expect((await migrate(f.destination, [f.legacy, second])).stderr).toContain("Multiple legacy");
  expect(existsSync(f.destination)).toBe(false);
  expect(existsSync(path.join(f.legacy, marker))).toBe(false);
  expect((await migrate(f.destination, [f.legacy], "test.original", "")).stderr).toContain("SparkDefaultBundleIdentifier");
  expect(existsSync(f.destination)).toBe(false);
});
test.skipIf(!darwin)("symlinked storage rejects without writing through the link", async () => {
  const f = fixture();
  mkdirSync(path.dirname(f.destination));
  symlinkSync(f.legacy, f.destination);
  expect((await migrate(f.destination, [])).stderr).toContain("symlink");
  expect(existsSync(path.join(f.legacy, marker))).toBe(false);
});
