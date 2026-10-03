import { expect, test } from "vitest";
import { runtimeTestArgs } from "../scripts/runtime-test-args.ts";

test("runtime test accepts a manifest option with or without an explicit app path", () => {
  expect(runtimeTestArgs(["/tmp/app", "--packages", "/tmp/packages/manifest.json", "--prebuilt"], "/default/app")).toEqual({ root: "/tmp/app", packageManifest: "/tmp/packages/manifest.json" });
  expect(runtimeTestArgs(["--packages", "/tmp/packages/manifest.json", "--prebuilt"], "/default/app")).toEqual({ root: "/default/app", packageManifest: "/tmp/packages/manifest.json" });
});

test("runtime test rejects missing manifest values and extra app paths", () => {
  expect(() => runtimeTestArgs(["--packages", "--prebuilt"], "/default/app")).toThrow("--packages requires a path");
  expect(() => runtimeTestArgs(["/tmp/app", "/tmp/other"], "/default/app")).toThrow("Unexpected extra runtime test path");
});
