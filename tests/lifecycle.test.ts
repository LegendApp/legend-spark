import { expect, test } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateLifecycle } = require("../packages/config-plugin/lifecycle.cjs");
const { toExpo } = require("../packages/config-plugin/config.cjs");
const { identity } = require("../packages/config-plugin/identity.cjs");
test("lifecycle policy has no implicit guards or native plugins", () => {
  expect(validateLifecycle()).toEqual({});
  const config = toExpo({ name: "Plain", projectId: "test.plain", version: "1", macos: { bundleIdentifier: "test.plain" } }).expo;
  expect(identity(config).SparkLifecycleConfiguration).toEqual({});
});
test("native startup policy survives config and identity conversion", () => {
  const lifecycle = { plugins: ["ExampleStartup"], mainWindow: { hidden: true, closeBehavior: "request", reopenBehavior: "manual", autosaveName: "ExistingFrame", backgroundColors: { light: "#ffffff", dark: "#101010" } } };
  const config = toExpo({ name: "Editor", projectId: "test.editor", version: "1", macos: { bundleIdentifier: "test.editor", lifecycle } }).expo;
  expect(identity(config).SparkLifecycleConfiguration).toEqual(lifecycle);
});
test.each([
  { quitGuard: true }, { plugins: ["Missing.Name"] }, { plugins: ["Same", "Same"] },
  { mainWindow: { hidden: "yes" } }, { mainWindow: { closeBehavior: "quit" } },
  { mainWindow: { backgroundColors: { light: "white", dark: "black" } } },
])("rejects invalid lifecycle policy %j", value => { expect(() => validateLifecycle(value)).toThrow(); });
