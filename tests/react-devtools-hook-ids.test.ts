import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { patchReactDevToolsHookIdsSource } = require("../packages/cli/src/react-devtools-hook-ids.cjs");
const installed = readFileSync(require.resolve("react-devtools-core/dist/backend.js"), "utf8");

test("React DevTools hook ids count React's hook objects, idempotently", () => {
  const patched = patchReactDevToolsHookIdsSource(installed);
  expect(patched).toContain("var sparkFiberHookObjects = { SyncExternalStore: 2, Transition: 2, FormState: 3, ActionState: 3 };");
  expect(patched).toContain("(nativeHookID += sparkFiberHookObjects[hookStack] || 1) - (sparkFiberHookObjects[hookStack] || 1)");
  expect(patched).not.toMatch(/\? null : nativeHookID\+\+,/);
  expect(patchReactDevToolsHookIdsSource(patched)).toBe(patched);
});

test("a changed react-devtools-core rejects instead of skipping the patch", () => {
  // The installed file may already carry the patch (spark dev applies it), so replace either form of the id line.
  const changed = installed.replace(/nativeHookID\+\+,|\(nativeHookID \+= [^\n]*/, "nextHookID(),");
  expect(changed).not.toBe(installed);
  expect(() => patchReactDevToolsHookIdsSource(changed)).toThrow("review Spark's React DevTools hook id patch");
});
