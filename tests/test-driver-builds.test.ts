import { afterAll, beforeAll, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toExpo } from "@legendapp/spark-desktop-config/config.cjs";
import { testDriverPodfile } from "../packages/config-plugin/test-driver.cjs";
import { checkReleaseTestDriver, testDriverMarkers } from "../packages/cli/src/release-driver.ts";
import { outcome, run, runOk } from "./subprocess.ts";

// The in-app test driver compiles in Debug builds, and in release builds only for apps that set
// macos.testDriverInRelease; its private CoreGraphics event functions only with macos.testDriverPrivateEvents
// (docs/test-driver.md#builds). tests/test-driver-native.test.ts checks the private event functions in binaries.
const root = path.resolve(import.meta.dirname, "..");
const darwin = process.platform === "darwin";
const base = { name: "Demo", projectId: "demo", version: "1.0.0", macos: { bundleIdentifier: "com.example.demo" } };
const hasRuby = (() => { try { execFileSync("ruby", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("macos.testDriverInRelease and macos.testDriverPrivateEvents are optional booleans carried to the Expo config", () => {
  for (const key of ["testDriverInRelease", "testDriverPrivateEvents"] as const) {
    expect(toExpo(base).expo.macos?.[key]).toBeUndefined();
    expect(toExpo({ ...base, macos: { ...base.macos, [key]: true } }).expo.macos?.[key]).toBe(true);
    expect(() => toExpo({ ...base, macos: { ...base.macos, [key]: "yes" } })).toThrow(`macos.${key} must be a boolean`);
  }
});

test("the Podfile exports each opt-in only when it is set, once, and drops it when it is unset", () => {
  const podfile = "platform :osx, '14.0'\ntarget 'App' do\nend\n";
  const release = "ENV['SPARK_TEST_DRIVER_RELEASE'] = '1' # spark: test driver in release builds";
  const privateEvents = "ENV['SPARK_TEST_DRIVER_PRIVATE_EVENTS'] = '1' # spark: test driver private events";
  const both = testDriverPodfile(podfile, { testDriverInRelease: true, testDriverPrivateEvents: true });
  expect(both).toBe(`${privateEvents}\n${release}\n${podfile}`);
  expect(testDriverPodfile(both, { testDriverInRelease: true, testDriverPrivateEvents: true })).toBe(both);
  expect(testDriverPodfile(both, { testDriverInRelease: true })).toBe(`${release}\n${podfile}`);
  expect(testDriverPodfile(both, { testDriverPrivateEvents: true })).toBe(`${privateEvents}\n${podfile}`);
  for (const macos of [undefined, {}, { testDriverInRelease: false, testDriverPrivateEvents: false }]) {
    expect(testDriverPodfile(podfile, macos)).toBe(podfile);
    expect(testDriverPodfile(both, macos)).toBe(podfile);
  }
});

// Evaluates a real podspec against a stub Pod::Spec and prints its pod and app target build settings.
const podspecSettings = (podspec: string, environment: Record<string, string>) => {
  const env = { ...process.env, ...environment };
  for (const name of ["SPARK_TEST_DRIVER_RELEASE", "SPARK_TEST_DRIVER_PRIVATE_EVENTS"]) if (!(name in environment)) delete env[name];
  return JSON.parse(execFileSync("ruby", ["-rjson", "-e", `
    module Pod; class Spec
      attr_reader :pod, :user
      def initialize; yield self; end
      def pod_target_xcconfig=(value); @pod = value; end
      def user_target_xcconfig=(value); @user = value; end
      def method_missing(*); self; end
    end; end
    spec = eval(File.read(ARGV[0]), binding, ARGV[0])
    puts JSON.generate({ pod: spec.pod, user: spec.user })`, path.join(root, podspec)],
    { cwd: path.dirname(path.join(root, podspec)), env, encoding: "utf8" })) as { pod: Record<string, string>; user: Record<string, string> | null };
};
const DRIVER_DEFINITION = "$(inherited) SPARK_TEST_DRIVER=$(SPARK_TEST_DRIVER)";
// Every pod that includes SparkTestDriver.h (a pod without the setting would get the driver declarations, and fail
// to link in a release build without the driver), and diagnostics, whose simulated crashes need the driver.
const DRIVER_PODS = ["packages/ui/RNSparkUI.podspec", "packages/motion/RNSparkMotion.podspec", "packages/system/RNDesktopSystem.podspec",
  "packages/desktop-windows/RNDesktopWindows.podspec", "packages/diagnostics/RNDesktopDiagnostics.podspec", "packages/clipboard/RNDesktopClipboard.podspec", "packages/drag-drop/RNDesktopDrag.podspec",
  "packages/permissions/RNDesktopPermissions.podspec", "packages/biometrics/RNDesktopBiometrics.podspec", "packages/authentication/RNDesktopAuthentication.podspec", "packages/privileged-helper/RNDesktopPrivilegedHelper.podspec", "packages/sharing/RNDesktopSharing.podspec", "packages/desktop-links/RNDesktopLinks.podspec",
  "packages/global-shortcuts/RNDesktopGlobalShortcuts.podspec", "packages/media/RNDesktopMedia.podspec", "packages/app-intents/RNDesktopAppIntents.podspec"];

test("every Spark source that includes SparkTestDriver.h belongs to a pod that sets SPARK_TEST_DRIVER", () => {
  const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? (entry.name === "node_modules" ? [] : sources(path.join(directory, entry.name))) : /\.(mm?|h)$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
  const including = new Set(readdirSync(path.join(root, "packages")).flatMap(name => sources(path.join(root, "packages", name)))
    .filter(file => /SparkTestDriver\.h|SparkTestDriverPrivate\.h/.test(readFileSync(file, "utf8")))
    .map(file => path.relative(path.join(root, "packages"), file).split(path.sep)[0]));
  expect([...including].sort()).toEqual(["app-intents", "authentication", "biometrics", "clipboard", "desktop-app", "desktop-host", "desktop-links", "desktop-windows", "drag-drop", "global-shortcuts", "media", "motion", "permissions", "privileged-helper", "sharing", "system", "ui"]);
});

test("driver command registrations sit in the driver's excluded sources or inside #if SPARK_TEST_DRIVER", () => {
  const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? (entry.name === "node_modules" ? [] : sources(path.join(directory, entry.name))) : entry.name.endsWith(".mm") ? [path.join(directory, entry.name)] : []);
  const registering = readdirSync(path.join(root, "packages")).flatMap(name => sources(path.join(root, "packages", name)))
    .filter(file => readFileSync(file, "utf8").includes("SparkTestDriverRegisterCommand("));
  expect(registering.length).toBeGreaterThan(0);
  for (const file of registering) {
    if (path.dirname(file) === path.join(root, "packages/desktop-app/macos") && /^SparkTestDriver.*\.mm$/.test(path.basename(file))) continue;
    const text = readFileSync(file, "utf8"), guard = text.indexOf("#if SPARK_TEST_DRIVER\n");
    expect(guard, path.relative(root, file)).toBeGreaterThanOrEqual(0);
    expect(guard, path.relative(root, file)).toBeLessThan(text.indexOf("SparkTestDriverRegisterCommand("));
  }
});

test.skipIf(!hasRuby)("Spark pods compile the driver in Debug, and in other configurations only with SPARK_TEST_DRIVER_RELEASE", () => {
  for (const podspec of DRIVER_PODS) {
    for (const [environment, value] of [[{}, "0"], [{ SPARK_TEST_DRIVER_RELEASE: "0" }, "0"], [{ SPARK_TEST_DRIVER_RELEASE: "1" }, "1"]] as const) {
      const { pod } = podspecSettings(podspec, environment);
      expect(pod, podspec).toMatchObject({ SPARK_TEST_DRIVER: value, "SPARK_TEST_DRIVER[config=Debug]": "1", GCC_PREPROCESSOR_DEFINITIONS: DRIVER_DEFINITION });
    }
  }
}, 60_000);

test.skipIf(!hasRuby)("RNDesktopApp excludes the driver's sources without it, gives the app target the setting, and defines SPARK_TEST_DRIVER_PRIVATE_EVENTS only on request", () => {
  const podspec = "packages/desktop-app/RNDesktopApp.podspec";
  const driver = (value: string) => ({ SPARK_TEST_DRIVER: value, "SPARK_TEST_DRIVER[config=Debug]": "1" });
  const pod = (value: string, definitions: string) => ({
    ...driver(value), CLANG_CXX_LANGUAGE_STANDARD: "c++20", GCC_PREPROCESSOR_DEFINITIONS: definitions,
    SPARK_TEST_DRIVER_SOURCES_0: "SparkTestDriver*.mm", EXCLUDED_SOURCE_FILE_NAMES: "$(SPARK_TEST_DRIVER_SOURCES_$(SPARK_TEST_DRIVER))",
  });
  expect(podspecSettings(podspec, {})).toEqual({ pod: pod("0", DRIVER_DEFINITION), user: { ...driver("0"), GCC_PREPROCESSOR_DEFINITIONS: DRIVER_DEFINITION } });
  expect(podspecSettings(podspec, { SPARK_TEST_DRIVER_PRIVATE_EVENTS: "0" }).pod).toEqual(pod("0", DRIVER_DEFINITION));
  expect(podspecSettings(podspec, { SPARK_TEST_DRIVER_RELEASE: "1" })).toEqual({ pod: pod("1", DRIVER_DEFINITION), user: { ...driver("1"), GCC_PREPROCESSOR_DEFINITIONS: DRIVER_DEFINITION } });
  expect(podspecSettings(podspec, { SPARK_TEST_DRIVER_PRIVATE_EVENTS: "1" }).pod).toEqual(pod("0", `${DRIVER_DEFINITION} SPARK_TEST_DRIVER_PRIVATE_EVENTS=1`));
  // Only the driver's own sources match the exclusion.
  const excluded = readdirSync(path.join(root, "packages/desktop-app/macos")).filter(name => /^SparkTestDriver.*\.mm$/.test(name));
  expect(excluded.sort()).toEqual(["SparkTestDriver.mm", "SparkTestDriverAudit.mm", "SparkTestDriverCommits.mm", "SparkTestDriverCursor.mm",
    "SparkTestDriverFrames.mm", "SparkTestDriverInput.mm", "SparkTestDriverState.mm"]);
}, 60_000);

test("the Kitchen Sink, which the gate drives as a release build, opts in", () => {
  const { macos } = JSON.parse(readFileSync(path.join(root, "examples/kitchen-sink/desktop.config.json"), "utf8"));
  expect(macos).toMatchObject({ testDriverInRelease: true, testDriverPrivateEvents: true });
});

// A release-style binary built without the driver and one built with it, checked the way `spark build` checks every
// macOS release build.
// Both include the crash reporter and the hang watchdog, whose native simulated crashes and simulated hangs need the driver.
const native = path.join(root, "packages/desktop-app/macos"), diagnostics = path.join(root, "packages/diagnostics/macos");
const driverSources = ["SparkTestDriver.mm", "SparkTestDriverInput.mm", "SparkTestDriverCursor.mm", "SparkTestDriverFrames.mm", "SparkTestDriverCommits.mm",
  "SparkTestDriverAudit.mm", "SparkFrameTimeline.mm", "SparkSandbox.mm"].map(file => path.join(native, file));
const crashSources = ["SparkCrashReporter.mm", "SparkHangWatchdog.mm", "SparkStack.mm"].map(file => path.join(diagnostics, file));
const host = `#import "SparkTestDriver.h"
#import "SparkCrashReporter.h"
#import "SparkHangWatchdog.h"
int main(void) {
  @autoreleasepool {
    BOOL driven = SparkTestDriverStart();
    SparkTestDriverDidMount();
    printf("started %d active %d ending %d\\n", driven, SparkTestDriverActive(), SparkTestDriverEnding());
#if !SPARK_TEST_DRIVER
    NSError *error;
    printf("simulateCrash %s\\n", SparkSimulateCrash(@"/tmp", @"abort", &error) ? "ran" : [error.userInfo[SparkCrashCodeKey] UTF8String]);
#endif
    NSDate *start = NSDate.date;
    BOOL hung = SparkSimulateHang(300);
    printf("simulateHang %s\\n", hung ? (-start.timeIntervalSinceNow >= 0.3 ? "blocked" : "returned early") : "unavailable");
  }
  return 0;
}
`;
let directory = "";
const app = (name: string) => path.join(directory, `${name}.app`);
beforeAll(async () => {
  if (!darwin) return;
  directory = mkdtempSync("/tmp/spark-driver-builds-");
  writeFileSync(path.join(directory, "host.mm"), host);
  const compile = (name: string, sources: string[], flags: string[]) => {
    mkdirSync(path.join(app(name), "Contents/MacOS"), { recursive: true });
    return runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Oz", "-Wl,-dead_strip", "-framework", "AppKit", "-framework", "QuartzCore", "-framework", "Security",
      ...flags, "-I", native, "-I", diagnostics, path.join(directory, "host.mm"), ...sources, ...crashSources, "-o", path.join(app(name), "Contents/MacOS", name)], { timeout: 120_000 });
  };
  await Promise.all([compile("Consumer", [], ["-DSPARK_TEST_DRIVER=0"]), compile("Gate", driverSources, ["-DSPARK_TEST_DRIVER=1"])]);
  await runOk("strip", ["-x", path.join(app("Consumer"), "Contents/MacOS/Consumer")]);
  await runOk("strip", ["-x", path.join(app("Gate"), "Contents/MacOS/Gate")]);
}, 240_000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(!darwin)("a build without the driver has none of its code, ignores SPARK_TEST_DRIVER_DIR and SPARK_SIMULATE_CRASH, cannot simulate a hang, and passes the release check", async () => {
  const binary = path.join(app("Consumer"), "Contents/MacOS/Consumer");
  expect(testDriverMarkers(app("Consumer"))).toEqual([]);
  expect(execFileSync("nm", [binary], { encoding: "utf8" })).not.toContain("SparkTestDriver");
  expect(() => checkReleaseTestDriver(app("Consumer"), false)).not.toThrow();
  expect(() => checkReleaseTestDriver(app("Consumer"), true)).toThrow("macos.testDriverInRelease is set, but the release build lacks the test driver (driver.sock, Spark test driver:");
  const result = await run(binary, [], { env: { ...process.env, SPARK_TEST_DRIVER_DIR: "/nonexistent", SPARK_SIMULATE_CRASH: "abort", SPARK_SIMULATE_CRASH_DIRECTORY: directory }, timeout: 30_000 });
  expect(result.status, outcome(result)).toBe(0);
  expect(result.stdout).toBe("started 0 active 0 ending 0\nsimulateCrash E_UNAVAILABLE\nsimulateHang unavailable\n");
  expect(result.stderr).toContain("Spark: this build has no test driver; SPARK_TEST_DRIVER_DIR is ignored");
}, 60_000);

test.skipIf(!darwin)("a build with the driver has it, simulates a hang, and the release check requires it with macos.testDriverInRelease and refuses it without", async () => {
  const result = await run(path.join(app("Gate"), "Contents/MacOS/Gate"), [], { timeout: 30_000 });
  expect(result.status, outcome(result)).toBe(0);
  expect(result.stdout).toBe("started 0 active 0 ending 0\nsimulateHang blocked\n");
  expect(testDriverMarkers(app("Gate"))).toEqual(expect.arrayContaining(["driver.sock", "Spark test driver:", "startCommits", "accessibilityAudit", "SPARK_SIMULATE_CRASH"]));
  expect(() => checkReleaseTestDriver(app("Gate"), true)).not.toThrow();
  expect(() => checkReleaseTestDriver(app("Gate"), false)).toThrow("The release build contains test driver code (driver.sock, Spark test driver:");
}, 60_000);
