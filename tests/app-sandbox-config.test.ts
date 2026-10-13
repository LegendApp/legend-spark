import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { toExpo } from "@legendapp/spark-desktop-config/config.cjs";
import { signSandboxed, signingOrder } from "../packages/cli/src/signing.ts";
import { removeUpdaterKeys } from "../packages/cli/src/macos-release.ts";
import type { Runner } from "../packages/cli/src/credentials.ts";
// macos.sandbox: the App Sandbox (Mac App Store style) variant spark build --sandbox makes (docs/app-sandbox.md).
const require = createRequire(import.meta.url);
const { sandboxEntitlements, SANDBOX_INHERIT, SANDBOX_EXCLUDED } = require("../packages/config-plugin/entitlements.cjs");
const app = (macos: Record<string, unknown>) => ({ name: "Demo", projectId: "demo", version: "1.0.0", macos: { bundleIdentifier: "com.example.demo", ...macos } });
const PRINT = { "com.apple.security.print": true };

test("macos.sandbox is validated: only App Sandbox entitlements, never the implied ones", () => {
  expect(toExpo(app({ sandbox: { entitlements: PRINT } })).expo.macos?.sandbox).toEqual({ entitlements: PRINT });
  expect(toExpo(app({ sandbox: {} })).expo.macos?.sandbox).toEqual({});
  for (const [sandbox, message] of [
    [[], "macos.sandbox must be an object"],
    [{ apps: true }, "Unknown macos.sandbox field: apps"],
    [{ entitlements: [] }, "macos.sandbox.entitlements must be an object"],
    [{ entitlements: { "com.apple.developer.applesignin": ["Default"] } }, "com.apple.developer.applesignin is not an App Sandbox entitlement"],
    [{ entitlements: { "com.apple.security.app-sandbox": true } }, "com.apple.security.app-sandbox is implied"],
    [{ entitlements: { "com.apple.security.inherit": true } }, "com.apple.security.inherit is implied"],
    [{ entitlements: { "com.apple.security.print": null } }, "invalid value for com.apple.security.print"],
  ] as const) expect(() => toExpo(app({ sandbox }))).toThrow(message);
});

test("the variant's main executable carries the app's entitlements, the sandbox ones and app-sandbox; helpers only app-sandbox and inherit", () => {
  expect(sandboxEntitlements({ macos: { sandbox: { entitlements: PRINT } } }, { "com.apple.security.device.camera": true }))
    .toEqual({ "com.apple.security.device.camera": true, ...PRINT, "com.apple.security.app-sandbox": true });
  expect(sandboxEntitlements({ expo: { macos: { sandbox: {} } } }, {})).toEqual({ "com.apple.security.app-sandbox": true });
  expect(() => sandboxEntitlements({ macos: {} }, {})).toThrow("A sandboxed build needs macos.sandbox");
  expect(() => sandboxEntitlements({ macos: { sandbox: { entitlements: { "com.apple.security.print": false } } } }, PRINT)).toThrow("Conflicting entitlement requirements: com.apple.security.print");
  expect(SANDBOX_INHERIT).toEqual({ "com.apple.security.app-sandbox": true, "com.apple.security.inherit": true });
  expect(SANDBOX_EXCLUDED).toEqual(["@legendapp/spark-updates"]);
});

test("the Kitchen Sink declares its sandbox variant and stays unentitled in its direct build", () => {
  const ks = require("../examples/kitchen-sink/desktop.config.json");
  expect(ks.macos.entitlements).toBeUndefined();
  expect(Object.keys(ks.macos.sandbox.entitlements).sort()).toEqual([
    "com.apple.security.files.bookmarks.app-scope", "com.apple.security.files.user-selected.read-write", "com.apple.security.network.client", "com.apple.security.print",
  ]);
});

const machO = (file: string, type = 2) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const header = Buffer.alloc(32);
  header.writeUInt32BE(0xcffaedfe, 0);
  header.writeUInt32LE(type, 12);
  writeFileSync(file, header);
};
test("signSandboxed signs every nested process with app-sandbox and inherit, then the app with its entitlements; libraries keep their signatures", async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "spark-sandbox-sign-")));
  try {
    const bundle = path.join(root, "Probe.app");
    machO(path.join(bundle, "Contents/MacOS/Probe"));
    machO(path.join(bundle, "Contents/Frameworks/Hermes.framework/Versions/A/Hermes"), 6);
    machO(path.join(bundle, "Contents/Helpers/Worker.app/Contents/MacOS/Worker"));
    writeFileSync(path.join(bundle, "Contents/Helpers/Worker.app/Contents/Info.plist"), JSON.stringify({ CFBundleExecutable: "Worker" }));
    machO(path.join(bundle, "Contents/Resources/tool"));
    writeFileSync(path.join(bundle, "Contents/Info.plist"), JSON.stringify({ CFBundleExecutable: "Probe" }));
    const calls: string[][] = [];
    const execute: Runner = async (_root, args) => { calls.push(args); return args[0] === "plutil" && args.includes("json") ? readFileSync(args.at(-1)!, "utf8") : ""; };
    const entitlements = { "com.apple.security.app-sandbox": true, ...PRINT };
    await signSandboxed(root, bundle, entitlements, execute);
    const signs = calls.filter(args => args[0] === "codesign"), plist = (args: string[]) => JSON.parse(readFileSync(args[args.indexOf("--entitlements") + 1]!, "utf8"));
    const order = signingOrder(bundle);
    expect(signs.map(args => path.relative(bundle, args.at(-1)!))).toEqual([
      ...order.filter(file => /Worker|tool$/.test(file)).map(file => path.relative(bundle, file)), "",
    ]);
    for (const args of signs.slice(0, -1)) expect(plist(args)).toEqual(SANDBOX_INHERIT);
    expect(plist(signs.at(-1)!)).toEqual(entitlements);
    expect(signs.every(args => args.includes("-") && !args.includes("--deep"))).toBe(true);
    await expect(signSandboxed(root, bundle, { ...entitlements, "com.apple.security.get-task-allow": true }, execute)).rejects.toThrow("get-task-allow");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the variant drops Sparkle's Info.plist keys and nothing else", async () => {
  const removed: string[] = [];
  const plutil = async (args: string[]) => {
    if (args[0] === "-convert") return JSON.stringify({ CFBundleName: "Demo", SUFeedURL: "https://example.com/appcast.xml", SUPublicEDKey: "k", SupportURL: "https://example.com" });
    removed.push(args[1]!);
    return "";
  };
  expect(await removeUpdaterKeys("/Apps/Demo.app", plutil)).toEqual(["SUFeedURL", "SUPublicEDKey"]);
  expect(removed).toEqual(["SUFeedURL", "SUPublicEDKey"]);
});
