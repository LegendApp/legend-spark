import { expect, test } from "vitest";
import { cliArguments } from "../packages/cli/src/cli-arguments.ts";
test("rejects ignored flags, obsolete aliases and excess arguments before project lookup", () => {
  for (const args of [ ["package", "--example", "notes-lite"], ["create", "App", "--force"], ["prebuild", "--release"], ["build", "extra"], ["sdk", "register", "runtime", "--packages", "ignored"], ["sdk", "build-go"], ["sdk", "build-prebuilt"], ["build", "--go"], ["build", "--prebuilt"], ["build", "--no-open"], ["sdk", "build-runner", "--project", "app", "--package-manager", "npm"] ]) expect(() => cliArguments(args), args.join(" ")).toThrow();
});
test("accepts documented command shapes and rejects incompatible build modes", () => {
  expect(cliArguments(["create", "App", "--example", "notes-lite", "--platform", "ios"]).values.example).toBe("notes-lite");
  expect(cliArguments(["sdk", "export", "out", "--runtime", "one", "--runtime", "two"]).values.runtime).toEqual(["one", "two"]);
  expect(cliArguments(["build", "--dev", "--platform", "ios", "--device", "Phone", "--port", "8082"]).values.device).toBe("Phone");
  for (const args of [["build", "--dev", "--release"], ["build", "--runner", "--preview"], ["build", "--port", "0"], ["create", "App", "--package-manager", "unknown"]]) expect(() => cliArguments(args)).toThrow();
  expect(cliArguments(["create", "--help"]).values.help).toBe(true);
  expect(cliArguments(["sdk", "--help"]).values.help).toBe(true);
});
