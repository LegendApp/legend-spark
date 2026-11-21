import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { checkReleaseLoadPaths, checkReleasePayload } from "../packages/cli/src/release-app.ts";
import { distributionEntitlements } from "../packages/cli/src/signing.ts";
import { stripSwiftToolchainRunpath } from "../packages/config-plugin/rpaths.cjs";
import { releaseSocketProblems } from "../scripts/e2e/release-probe.ts";

test("the toolchain runpath hook also applies to a multiline React Native post-install call", () => {
  const podfile = "  post_install do |installer|\n    react_native_post_install(\n      installer,\n      react_native_macos_path\n    )\n  end\n";
  const patched = stripSwiftToolchainRunpath(podfile);
  expect(patched).toContain("post_install do |installer|\n    # spark: remove Swift toolchain runpath");
  expect(patched).toContain(podfile.slice(podfile.indexOf("    react_native_post_install")));
  expect(stripSwiftToolchainRunpath(patched)).toBe(patched);
});

test("release payload requires Hermes bytecode and rejects source maps and local networking", () => {
  const app = mkdtempSync(path.join(os.tmpdir(), "spark-payload-"));
  try {
    const resources = path.join(app, "Contents/Resources");
    mkdirSync(resources, { recursive: true });
    expect(() => checkReleasePayload(app, false, {})).toThrow("missing spark-runtime.json");
    writeFileSync(path.join(resources, "spark-runtime.json"), "{}");
    expect(() => checkReleasePayload(app, false, {})).toThrow("missing its JavaScript bundle");
    const bundle = path.join(resources, "main.jsbundle");
    writeFileSync(bundle, "console.log('Metro source')");
    expect(() => checkReleasePayload(app, false, {})).toThrow("Hermes bytecode");
    writeFileSync(bundle, Buffer.from("c61fbc03c103191f", "hex"));
    checkReleasePayload(app, false, {});
    expect(() => checkReleasePayload(app, false, { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } })).toThrow("allows local networking");
    const asset = path.join(resources, "web.js");
    writeFileSync(asset, "//# sourceMappingURL=data:application/json;base64,e30=");
    expect(() => checkReleasePayload(app, false, {})).toThrow("Source map reference");
    rmSync(asset);
    writeFileSync(path.join(resources, "main.jsbundle.map"), "{}");
    expect(() => checkReleasePayload(app, false, {})).toThrow("Development artifact");
  } finally { rmSync(app, { recursive: true, force: true }); }
});

test("runtime probe accepts the driver socket, reports other sockets and requires the process snapshot", () => {
  const driver = "/var/folders/job/driver.sock";
  const regular = "p42\nf0\ntCHR\nn/dev/null\nf1\ntunix\nn/private" + driver + "\n";
  expect(releaseSocketProblems(regular, 42, driver)).toEqual([]);
  expect(releaseSocketProblems(regular + "f2\ntIPv4\nn127.0.0.1:8081\nf3\ntIPv6\nn[::1]:4321\nf4\ntunix\nn/tmp/exposed.sock\n", 42, driver)).toEqual([
    "IPv4 127.0.0.1:8081", "IPv6 [::1]:4321", "unix /tmp/exposed.sock",
  ]);
  expect(() => releaseSocketProblems("p42\n", 42, driver)).toThrow("did not list files");
});

test("distribution entitlements keep hardened runtime library validation enabled", () => {
  const entitlement = "com.apple.security.cs.disable-library-validation";
  expect(distributionEntitlements({ [entitlement]: false })).toEqual({ [entitlement]: false });
  expect(() => distributionEntitlements({ [entitlement]: true })).toThrow(entitlement);
});

describe.skipIf(process.platform !== "darwin")("macOS release load paths", () => {
  let root: string;
  let fixture: string;
  const appPaths = (app: string) => ({
    main: path.join(app, "Contents/MacOS/Fixture"),
    first: path.join(app, "Contents/Frameworks/libfirst.dylib"),
    second: path.join(app, "Contents/Frameworks/libsecond.dylib"),
  });
  const xcrun = (...args: string[]) => execFileSync("xcrun", args, { cwd: root });
  const verify = (app: string) => {
    const { main, first, second } = appPaths(app);
    return checkReleaseLoadPaths(root, app, main, [main, first, second].filter(existsSync), async (cwd, [tool, ...args]) =>
      execFileSync(tool!, args, { cwd, encoding: "utf8" }));
  };

  beforeAll(() => {
    root = mkdtempSync(path.join(realpathSync(os.tmpdir()), "spark-load-paths-"));
    fixture = path.join(root, "Fixture.app");
    const { main, first, second } = appPaths(fixture);
    mkdirSync(path.dirname(main), { recursive: true });
    mkdirSync(path.dirname(first), { recursive: true });
    writeFileSync(path.join(root, "second.c"), "int second(void) { return 42; }");
    writeFileSync(path.join(root, "first.c"), "extern int second(void); int first(void) { return second(); }");
    writeFileSync(path.join(root, "main.c"), "extern int first(void); int main(void) { return first() != 42; }");
    xcrun("clang", "-dynamiclib", "second.c", "-install_name", "@rpath/libsecond.dylib", "-o", second);
    xcrun("clang", "-dynamiclib", "first.c", second, "-install_name", "@rpath/libfirst.dylib", "-o", first);
    xcrun("clang", "main.c", first, "-Wl,-rpath,@executable_path/../Frameworks", "-o", main);
  }, 20_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test("resolves transitive dylibs through the main executable's runpath", async () => {
    await expect(verify(fixture)).resolves.toBeUndefined();
  });
  test.each([
    ["build host runpath", "Invalid LC_RPATH", (app: string) => xcrun("install_name_tool", "-add_rpath", "/Users/build/toolchain", appPaths(app).main)],
    ["absolute install name", "Invalid LC_ID_DYLIB", (app: string) => xcrun("install_name_tool", "-id", "/Users/build/libfirst.dylib", appPaths(app).first)],
    ["missing dependency", "Unresolved load path @rpath/libsecond.dylib", (app: string) => rmSync(appPaths(app).second)],
  ] as const)("rejects %s", async (label, message, change) => {
    const app = path.join(root, `${label}.app`);
    cpSync(fixture, app, { recursive: true, verbatimSymlinks: true });
    change(app);
    await expect(verify(app)).rejects.toThrow(message);
  });
});
