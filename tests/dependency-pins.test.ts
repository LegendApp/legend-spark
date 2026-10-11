import { expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { supportedPlatforms } from "@legendapp/spark-desktop-config/config.cjs";
import { dependencyPinIssues, expectedDependencyPins as pins, printDependencyPins, upgradeDependencyPins } from "../packages/cli/src/dependency-pins.ts";

test("uses the desktop starter compatibility matrix and accepts exact direct pins", () => {
  const template = JSON.parse(readFileSync(new URL("../packages/cli/templates/blank-typescript/package.json", import.meta.url), "utf8"));
  const spark = JSON.parse(readFileSync(new URL("../packages/desktop/package.json", import.meta.url), "utf8"));
  for (const [name, version] of Object.entries(pins)) {
    expect(version).toBe(template.dependencies[name]);
    if (spark.peerDependencies[name]) expect(version).toBe(spark.peerDependencies[name]);
  }
  expect(dependencyPinIssues(template, ["macos"])).toEqual([]);
  expect(dependencyPinIssues({ dependencies: { react: pins.react }, devDependencies: { ...pins } }, ["macos"])).toEqual([]);
});

test("reports incompatible and permissive ranges, duplicate declarations and missing direct pins", () => {
  const { expo, ...dependencies } = pins;
  const issues = dependencyPinIssues({ dependencies: { ...dependencies, react: `^${pins.react}` }, devDependencies: { "react-native": "0.80.0" }, overrides: { expo } }, ["macos"]);
  expect(issues).toEqual([
    { package: "react", found: `^${pins.react}`, expected: pins.react, where: ["dependencies", "react"] },
    { package: "react-native", found: "0.80.0", expected: pins["react-native"], where: ["devDependencies", "react-native"] },
    { package: "expo", found: "(missing)", expected: pins.expo, where: ["dependencies", "expo"], missing: true },
  ]);
  expect(dependencyPinIssues({}, ["macos"]).map(issue => issue.package)).toEqual(Object.keys(pins));
});

test("checks npm/Bun overrides, Yarn resolutions and pnpm overrides, including selectors and references", () => {
  const issues = dependencyPinIssues({
    dependencies: pins,
    overrides: { react: "$react", "react-native@*": { ".": "0.80.0", react: "18.0.0" }, parent: { expo: "~54.0.0" }, unrelated: "1" },
    resolutions: { "**/react": "18.0.0", "parent/react-native-macos": "*", expo: pins.expo },
    pnpm: { overrides: { "parent@1>react-native@*": "0.80.0", "react@>=18 <20": "18.0.0", "react@18>unrelated": "1.0.0", expo: "54.0.0" } },
  }, ["macos"]);
  expect(issues.map(issue => issue.where)).toEqual([
    ["overrides", "react-native@*", "."], ["overrides", "react-native@*", "react"], ["overrides", "parent", "expo"],
    ["resolutions", "**/react"], ["resolutions", "parent/react-native-macos"],
    ["pnpm", "overrides", "parent@1>react-native@*"], ["pnpm", "overrides", "react@>=18 <20"], ["pnpm", "overrides", "expo"],
  ]);
  expect(dependencyPinIssues({ dependencies: { ...pins, react: "^19.0.0" }, overrides: { react: "$react" } }, ["macos"]).map(issue => issue.where)).toEqual([["dependencies", "react"], ["overrides", "react"]]);
});

test("prints package, found, expected and the full location", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    printDependencyPins(dependencyPinIssues({ dependencies: { ...pins, react: "18.0.0" } }, ["macos"]));
    expect(log.mock.calls.map(call => call[0]).join("\n")).toMatch(/Package\s+Found\s+Expected\s+Where/);
    expect(log.mock.calls[1][0]).toMatch(new RegExp(`react\\s+18.0.0\\s+${pins.react.replaceAll(".", "\\.")}\\s+dependencies → react`));
  } finally { log.mockRestore(); }
});

test("scoped selectors stay untouched while paths after scoped parents are checked", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-pin-scoped-"));
  const file = path.join(root, "package.json");
  const scoped = { "@types/react": "~19.1.10", "@types/react-native@*": "*", "**/@types/expo": "*", "parent@1>@types/react": "*" };
  const pkg = { dependencies: pins, overrides: scoped, resolutions: { ...scoped, "@scope/parent/react": "wrong" }, pnpm: { overrides: scoped } };
  try {
    writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ platforms: ["macos"] }));
    const source = JSON.stringify(pkg);
    writeFileSync(file, source);
    expect(dependencyPinIssues(pkg, ["macos"]).map(issue => issue.where)).toEqual([["resolutions", "@scope/parent/react"]]);
    upgradeDependencyPins(root);
    expect(readFileSync(file, "utf8")).toBe(source.replace('"wrong"', JSON.stringify(pins.react)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each(["catalog:", "catalog:desktop", "workspace:*", "workspace:^", "workspace:../react"])("skips %s specs with a note and leaves them untouched", spec => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-pin-managed-"));
  const file = path.join(root, "package.json");
  const pkg = { dependencies: { ...pins, react: spec }, devDependencies: { expo: spec }, overrides: { react: "$react", expo: spec }, resolutions: { "**/react": spec }, pnpm: { overrides: { "parent>react-native": spec } } };
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ platforms: ["macos"] }));
    const source = JSON.stringify(pkg);
    writeFileSync(file, source);
    const mtime = statSync(file).mtimeMs;
    expect(upgradeDependencyPins(root)).toEqual([]);
    expect(log.mock.calls).toHaveLength(6);
    expect(log.mock.calls.every(([note]) => note.includes("Skipping dependency pin check") && note.includes(spec))).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(source);
    expect(statSync(file).mtimeMs).toBe(mtime);
  } finally {
    log.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("upgrade fixes mismatches across all sections, adds missing pins and dry-run writes nothing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-dependency-pins-"));
  const file = path.join(root, "package.json");
  const original = JSON.stringify({ name: "app", devDependencies: { ...pins, react: "^19.0.0", expo: undefined }, overrides: { react: "18.0.0", "react-native@*": { ".": "0.80.0" } }, resolutions: { "**/expo": "*" }, pnpm: { overrides: { "parent>react-native-macos": "0.80.0" }, retained: true }, scripts: { build: "custom" } }, null, 4) + "\n";
  try {
    writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ platforms: ["macos"] }));
    writeFileSync(file, original);
    const mtime = statSync(file).mtimeMs;
    const preview = upgradeDependencyPins(root, true);
    expect(preview.length).toBe(6);
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(statSync(file).mtimeMs).toBe(mtime);
    expect(upgradeDependencyPins(root)).toEqual(preview);
    const changed = readFileSync(file, "utf8");
    const pkg = JSON.parse(changed);
    expect(dependencyPinIssues(pkg, ["macos"])).toEqual([]);
    expect(pkg.dependencies).toEqual({ expo: pins.expo });
    expect(pkg.devDependencies.react).toBe(pins.react);
    expect(Object.keys(pkg)).toEqual(["name", "devDependencies", "overrides", "resolutions", "pnpm", "scripts", "dependencies"]);
    expect(pkg.scripts).toEqual({ build: "custom" });
    expect(pkg.pnpm.retained).toBe(true);
    expect(changed).toContain('    "dependencies": {\n        "expo":');
    expect(changed.endsWith("\n")).toBe(true);
    const upgradedTime = statSync(file).mtimeMs;
    expect(upgradeDependencyPins(root)).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(changed);
    expect(statSync(file).mtimeMs).toBe(upgradedTime);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mismatch-only upgrades preserve all formatting and handle $ref overrides", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-pin-formatting-"));
  const file = path.join(root, "package.json");
  const original = `{\r\n\t"name" : "app",\r\n\t"dependencies": { "react":"wrong", "react-native":"${pins["react-native"]}", "react-native-macos":"${pins["react-native-macos"]}", "expo":"${pins.expo}" },\r\n\t"overrides": { "react": "$react", "react-native@*": { ".": "wrong-native" } },\r\n\t"resolutions": { "**/expo": "wrong-expo" },\r\n\t"pnpm": { "overrides": { "parent>react-native-macos": "wrong-macos" } },\r\n\t"untouched": [ 1,  2 ]\r\n}`;
  try {
    writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ platforms: ["macos"] }));
    writeFileSync(file, original);
    upgradeDependencyPins(root);
    const changed = original.replace('"wrong"', JSON.stringify(pins.react)).replace('"wrong-native"', JSON.stringify(pins["react-native"])).replace('"wrong-expo"', JSON.stringify(pins.expo)).replace('"wrong-macos"', JSON.stringify(pins["react-native-macos"]));
    expect(readFileSync(file, "utf8")).toBe(changed);
    expect(upgradeDependencyPins(root)).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(changed);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each([true, false])("adding a missing pin preserves existing formatting (dependencies present: %s)", hasDependencies => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-pin-insert-"));
  const file = path.join(root, "package.json");
  const { expo, ...dependencies } = pins;
  const section = hasDependencies ? "dependencies" : "devDependencies";
  const source = `{\r\n\t"name" : "app",\r\n\t"${section}": ${JSON.stringify({ ...dependencies, react: "wrong" })},\r\n\t"overrides": { "expo": "$expo" },\r\n\t"untouched": [ 1,  2 ]\r\n}`;
  try {
    writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ platforms: ["macos"] }));
    writeFileSync(file, source);
    upgradeDependencyPins(root);
    const fixed = source.replace('"wrong"', JSON.stringify(pins.react));
    const expected = hasDependencies
      ? fixed.replace(`"react-native-macos":"${pins["react-native-macos"]}"}`, `"react-native-macos":"${pins["react-native-macos"]}", "expo": "${expo}"}`)
      : fixed.replace('[ 1,  2 ]', `[ 1,  2 ],\r\n\t"dependencies": {\r\n\t\t"expo": "${expo}"\r\n\t}`);
    expect(readFileSync(file, "utf8")).toBe(expected);
    expect(upgradeDependencyPins(root)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("adds missing pins to an existing dependency object with detected indent and newlines", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-pin-missing-"));
  try {
    writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ platforms: ["macos"] }));
    const source = '{\r\n\t"dependencies": {}\r\n}\r\n';
    writeFileSync(path.join(root, "package.json"), source);
    upgradeDependencyPins(root);
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(JSON.stringify({ dependencies: pins }, null, "\t").replaceAll("\n", "\r\n") + "\r\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("invalid manifests fail without being rewritten", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-pin-invalid-"));
  const file = path.join(root, "package.json");
  try {
    writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ platforms: ["macos"] }));
    for (const source of ['{"dependencies":', '{"dependencies":null}']) {
      writeFileSync(file, source);
      expect(() => upgradeDependencyPins(root)).toThrow();
      expect(readFileSync(file, "utf8")).toBe(source);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each([
  ["desktop.config.json", ["windows"]],
  ["app.json", ["ios"]],
  ["desktop.config.json", ["ios", "macos"]],
] satisfies [string, string[]][])("gates macOS pins using %s platforms %j", (configFile, platforms) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-pin-platform-"));
  const file = path.join(root, "package.json");
  const { "react-native-macos": macos, ...dependencies } = pins;
  try {
    writeFileSync(path.join(root, configFile), JSON.stringify(configFile === "app.json" ? { expo: { platforms } } : { platforms }));
    const configured = supportedPlatforms(root);
    const targetsMacOS = platforms.includes("macos");
    expect(dependencyPinIssues({ dependencies }, configured).map(issue => issue.package)).toEqual(targetsMacOS ? ["react-native-macos"] : []);
    const original = JSON.stringify({ dependencies, overrides: { "react-native-macos": "wrong" }, resolutions: { "**/react-native-macos": "wrong" }, pnpm: { overrides: { "react-native-macos": "wrong" } } });
    writeFileSync(file, original);
    expect(dependencyPinIssues({ dependencies: { ...dependencies, "react-native-macos": "wrong" } }, configured).length).toBe(targetsMacOS ? 1 : 0);
    expect(upgradeDependencyPins(root).length).toBe(targetsMacOS ? 4 : 0);
    if (targetsMacOS) expect(JSON.parse(readFileSync(file, "utf8")).dependencies["react-native-macos"]).toBe(macos);
    else expect(readFileSync(file, "utf8")).toBe(original);
    expect(upgradeDependencyPins(root)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each([false, true])("doctor completes toolchain checks (malformed app manifest: %s)", async malformed => {
  vi.resetModules();
  const commands = await import("../packages/cli/src/commands.ts");
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-doctor-"));
  const argv = process.argv;
  const exitCode = process.exitCode;
  const doctor = vi.spyOn(commands, "doctor").mockResolvedValue(undefined);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    if (malformed) {
      writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ platforms: ["macos"] }));
      writeFileSync(path.join(root, "package.json"), '{"dependencies":');
    }
    process.argv = [argv[0], "spark", "doctor", "--project", root];
    await import("../packages/cli/src/index.ts");
    expect(doctor).toHaveBeenCalledWith(root);
    expect(log).toHaveBeenCalledWith("Native toolchain available.");
    if (malformed) {
      expect(error).toHaveBeenCalledWith(expect.stringContaining("Dependency pin check failed:"));
      expect(process.exitCode).toBe(1);
    } else {
      expect(log).toHaveBeenCalledWith("No Spark app found; skipping dependency pin check.");
      expect(error).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(exitCode);
    }
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  }
});
