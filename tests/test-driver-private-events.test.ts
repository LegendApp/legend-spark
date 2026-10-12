import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { toExpo } from "@legendapp/spark-desktop-config/config.cjs";
import { privateEventsPodfile } from "../packages/config-plugin/private-events.cjs";

// The test driver's gesture and extra mouse button synthesis uses private CoreGraphics functions, compiled only in apps
// that opt in (docs/test-driver.md#private-event-functions). tests/test-driver-native.test.ts checks the binaries.
const root = path.resolve(import.meta.dirname, "..");
const base = { name: "Demo", projectId: "demo", version: "1.0.0", macos: { bundleIdentifier: "com.example.demo" } };
const hasRuby = (() => { try { execFileSync("ruby", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("macos.testDriverPrivateEvents is an optional boolean carried to the Expo config", () => {
  expect(toExpo(base).expo.macos?.testDriverPrivateEvents).toBeUndefined();
  expect(toExpo({ ...base, macos: { ...base.macos, testDriverPrivateEvents: true } }).expo.macos?.testDriverPrivateEvents).toBe(true);
  expect(() => toExpo({ ...base, macos: { ...base.macos, testDriverPrivateEvents: "yes" } })).toThrow("macos.testDriverPrivateEvents must be a boolean");
});

test("the Podfile exports the opt-in only when it is set, once, and drops it when it is unset", () => {
  const podfile = "platform :osx, '14.0'\ntarget 'App' do\nend\n";
  const enabled = privateEventsPodfile(podfile, true);
  expect(enabled.split("\n")[0]).toBe("ENV['SPARK_TEST_DRIVER_PRIVATE_EVENTS'] = '1' # spark: test driver private events");
  expect(privateEventsPodfile(enabled, true)).toBe(enabled);
  for (const value of [undefined, false]) {
    expect(privateEventsPodfile(podfile, value)).toBe(podfile);
    expect(privateEventsPodfile(enabled, value)).toBe(podfile);
  }
});

// Evaluates the real podspec against a stub Pod::Spec and prints its pod target build settings.
const podspecEnvironment = (environment: Record<string, string>) => {
  const env = { ...process.env, ...environment };
  if (!("SPARK_TEST_DRIVER_PRIVATE_EVENTS" in environment)) delete env.SPARK_TEST_DRIVER_PRIVATE_EVENTS;
  return env;
};
const podspecSettings = (environment: Record<string, string>) => JSON.parse(execFileSync("ruby", ["-rjson", "-e", `
  module Pod; class Spec
    attr_reader :settings
    def initialize; yield self; end
    def pod_target_xcconfig=(value); @settings = value; end
    def method_missing(*); self; end
  end; end
  spec = eval(File.read(ARGV[0]), binding, ARGV[0])
  puts JSON.generate(spec.settings)`, path.join(root, "packages/desktop-app/RNDesktopApp.podspec")],
  { cwd: path.join(root, "packages/desktop-app"), env: podspecEnvironment(environment), encoding: "utf8" }));

test.skipIf(!hasRuby)("RNDesktopApp defines SPARK_TEST_DRIVER_PRIVATE_EVENTS only for an app that opts in", () => {
  expect(podspecSettings({})).toEqual({ CLANG_CXX_LANGUAGE_STANDARD: "c++20" });
  expect(podspecSettings({ SPARK_TEST_DRIVER_PRIVATE_EVENTS: "0" })).toEqual({ CLANG_CXX_LANGUAGE_STANDARD: "c++20" });
  expect(podspecSettings({ SPARK_TEST_DRIVER_PRIVATE_EVENTS: "1" })).toEqual({ CLANG_CXX_LANGUAGE_STANDARD: "c++20", GCC_PREPROCESSOR_DEFINITIONS: "$(inherited) SPARK_TEST_DRIVER_PRIVATE_EVENTS=1" });
});

test("the Kitchen Sink, which the gate drives, opts in", () => {
  expect(JSON.parse(readFileSync(path.join(root, "examples/kitchen-sink/desktop.config.json"), "utf8")).macos.testDriverPrivateEvents).toBe(true);
});
