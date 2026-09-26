import { expect, test } from "vitest";
import { devArguments, devTargets } from "../packages/cli/src/dev-command.ts";

test("desktop launch arguments remain separate from Expo options", () => {
  expect(devArguments(["--app-arg=/tmp/a file.md", "--clear", "--app-arg=--preview", "--app-arg", "x=y"])).toEqual({
    appArgs: ["/tmp/a file.md", "--preview", "x=y"], expo: ["--clear"],
  });
  expect(() => devArguments(["--app-arg"])).toThrow("needs a value");
});

test("dev consumes spark options and forwards Expo flags and aliases unchanged", () => {
  const expo = ["--go", "--clear", "--offline", "-p", "8123", "--max-workers=2", "-w", "--scheme", "my-app", "--future-expo-flag"];
  expect(devArguments(["--project", "/tmp/My App", ...expo, "--platform=ios", "--runner-binary=/tmp/Go=1.app", "--no-open"])).toEqual({
    project: "/tmp/My App", platform: "ios", prebuiltBinary: "/tmp/Go=1.app", noOpen: true, expo,
  });
  expect(devArguments(["-g", "-c", "-m", "lan"])).toEqual({ expo: ["-g", "-c", "-m", "lan"] });
  for (const args of [["--runner-binary"], ["--platform", "--clear"], ["--project="], ["--no-open=false"]]) expect(() => devArguments(args)).toThrow();
});

test("initial mobile launch keeps host desktop actions available", () => {
  const platforms = ["ios", "android", "web", "macos", "windows"];
  expect(devTargets(platforms, "ios", "macos")).toEqual({ initial: "ios", desktop: "macos" });
  expect(devTargets(platforms, "web", "windows")).toEqual({ initial: "web", desktop: "windows" });
  expect(devTargets(platforms, "windows", "macos")).toEqual({ initial: "windows", desktop: "windows" });
  expect(devTargets(["ios", "android", "web"], "android")).toEqual({ initial: "android", desktop: undefined });
  expect(() => devTargets(["macos"], "ios")).toThrow("not supported");
});


test("legacy binary override aliases prebuilt without consuming Expo Go", () => {
  expect(devArguments(["--go-binary", "/tmp/Legacy.app", "--go"])).toEqual({ prebuiltBinary: "/tmp/Legacy.app", expo: ["--go"] });
  expect(devArguments(["--runner-binary=/tmp/Runtime.app", "--go"])).toEqual({ prebuiltBinary: "/tmp/Runtime.app", expo: ["--go"] });
});

test("Runner binary option retains prebuilt and Go aliases", () => {
  for (const flag of ["--runner-binary", "--prebuilt-binary", "--go-binary"]) {
    expect(devArguments([flag, "/tmp/SparkRunner.app"]).prebuiltBinary).toBe("/tmp/SparkRunner.app");
  }
});
