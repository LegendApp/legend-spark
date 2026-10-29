import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyKitchenSinkScreens, prepareKitchenSink } from "../scripts/prepare-kitchen-sink.ts";
import { optionalBackendIssues } from "../packages/cli/src/dependency-pins.ts";
import { nativePackages } from "../packages/cli/src/project.ts";
import { planMigrations } from "../packages/cli/src/migrations.cjs";

test("packaged consumers receive screens without workspace manifests or native projects", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kitchen-copy-"));
  const source = path.join(root, "source"), consumer = path.join(root, "consumer");
  mkdirSync(source); mkdirSync(consumer);
  try {
    mkdirSync(path.join(root, "sidecar"));
    writeFileSync(path.join(root, "sidecar/client.ts"), "standalone helper client");
    writeFileSync(path.join(source, "sidecar-client.ts"), 'export * from "../sidecar/client";');
    for (const [file, value] of Object.entries({ "App.tsx": "screen", "global.css": "styles", "metro.config.js": "metro", "package.json": "workspace dependencies", "desktop.config.json": "checkout identity", "app.config.js": "checkout config" })) writeFileSync(path.join(source, file), value);
    mkdirSync(path.join(source, "macos")); writeFileSync(path.join(source, "macos/keep"), "native source");
    mkdirSync(path.join(source, "shell")); writeFileSync(path.join(source, "shell/Shell.tsx"), "shell");
    mkdirSync(path.join(source, "screens/infra"), { recursive: true }); writeFileSync(path.join(source, "screens/infra/index.tsx"), "infra screens");
    writeFileSync(path.join(consumer, "package.json"), "SDK archives");
    writeFileSync(path.join(consumer, "desktop.config.json"), "test identity");
    copyKitchenSinkScreens(source, consumer);
    expect(readFileSync(path.join(consumer, "App.tsx"), "utf8")).toBe("screen");
    expect(readFileSync(path.join(consumer, "global.css"), "utf8")).toBe("styles");
    expect(readFileSync(path.join(consumer, "sidecar-client.ts"), "utf8")).toBe("standalone helper client");
    expect(readFileSync(path.join(consumer, "package.json"), "utf8")).toBe("SDK archives");
    expect(readFileSync(path.join(consumer, "desktop.config.json"), "utf8")).toBe("test identity");
    expect(readFileSync(path.join(consumer, "shell/Shell.tsx"), "utf8")).toBe("shell");
    expect(readFileSync(path.join(consumer, "screens/infra/index.tsx"), "utf8")).toBe("infra screens");
    expect(existsSync(path.join(consumer, "macos"))).toBe(false);
    expect(existsSync(path.join(consumer, "app.config.js"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("packaged preparation refuses an old live source consumer", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kitchen-live-"));
  try {
    mkdirSync(path.join(root, ".spark"));
    writeFileSync(path.join(root, ".spark/kitchen-sink.json"), JSON.stringify({ managed: true, mode: "live" }));
    await expect(prepareKitchenSink(root)).rejects.toThrow("separate directory");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("packaged preparation refuses the checked-in or any unmanaged application", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kitchen-unmanaged-"));
  try {
    writeFileSync(path.join(root, "package.json"), "{}");
    await expect(prepareKitchenSink(root)).rejects.toThrow("Refusing to overwrite");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a clean checkout of kitchen sink has no pending migrations", () => {
  const file = "examples/kitchen-sink/.spark/version";
  expect(execFileSync("git", ["ls-files", "--error-unmatch", "--", file], { encoding: "utf8" }).trim()).toBe(file);
  // Ignore local startup state: a fresh clone only receives the committed stamp.
  const stamp = execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" });
  const version = JSON.parse(readFileSync("packages/cli/package.json", "utf8")).version;
  const root = mkdtempSync(path.join(os.tmpdir(), "kitchen-migrations-"));
  try {
    mkdirSync(path.join(root, ".spark"));
    writeFileSync(path.join(root, ".spark/version"), stamp);
    const plan = planMigrations(root, version, { automatic: true });
    expect(plan.versions).toEqual([]);
    expect(plan.manualSteps).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("kitchen sink declares its backends and excludes unsupported rich text on Windows", () => {
  const root = path.resolve("examples/kitchen-sink");
  expect(optionalBackendIssues(root)).toEqual([]);
  const previous = process.env.SPARK_PLATFORM;
  try {
    process.env.SPARK_PLATFORM = "windows";
    const names = nativePackages(root).map(pkg => pkg.name);
    expect(names).toContain("react-native-webview");
    expect(names).toContain("@op-engineering/op-sqlite");
    expect(names).not.toContain("react-native-enriched-html");
    expect(names).not.toContain("react-native-enriched-markdown");
  } finally {
    if (previous === undefined) delete process.env.SPARK_PLATFORM;
    else process.env.SPARK_PLATFORM = previous;
  }
});
