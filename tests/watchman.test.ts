import { afterEach, expect, test, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { watchmanStalls } from "../packages/cli/src/watchman.ts";

const { withDesktop } = createRequire(import.meta.url)("../packages/cli/src/metro.cjs");
const folder = mkdtempSync(path.join(os.tmpdir(), "spark-watchman-"));
const fakeWatchman = (script: string) => {
  writeFileSync(path.join(folder, "watchman"), `#!/bin/sh\n${script}\n`);
  chmodSync(path.join(folder, "watchman"), 0o755);
  vi.stubEnv("PATH", folder);
};
afterEach(() => { vi.unstubAllEnvs(); rmSync(path.join(folder, "watchman"), { force: true }); });

test.skipIf(process.platform === "win32")("only an unresponsive Watchman makes Metro skip it", async () => {
  fakeWatchman("exec /bin/sleep 5");
  expect(await watchmanStalls(folder, 100)).toBe(true);
  fakeWatchman('echo \'{"watch":"/"}\'');
  expect(await watchmanStalls(folder, 2_000)).toBe(false);
  fakeWatchman("exit 1");
  expect(await watchmanStalls(folder, 2_000)).toBe(false);
  rmSync(path.join(folder, "watchman"));
  expect(await watchmanStalls(folder, 2_000)).toBe(false);
});

test("desktop Metro config disables Watchman only when spark dev asks", () => {
  expect(withDesktop({ projectRoot: folder }, { runtimes: false }).resolver.useWatchman).toBeUndefined();
  vi.stubEnv("SPARK_METRO_NO_WATCHMAN", "1");
  expect(withDesktop({ projectRoot: folder, resolver: { useWatchman: true } }, { runtimes: false }).resolver.useWatchman).toBe(false);
});
