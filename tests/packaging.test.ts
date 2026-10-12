import { spawnProcess } from "../packages/cli/src/process.ts";
import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseIdentity, parseIdentities, type Runner, type SigningCredentials } from "../packages/cli/src/credentials.ts";
import { artifactHash, packageApp } from "../packages/cli/src/package.ts";
import { appEntitlements, distributionEntitlements, signApp, signingOrder } from "../packages/cli/src/signing.ts";
import { run } from "../packages/cli/src/commands.ts";
import { nativePackages, readJson, VERSION, writeJson, type Runtime } from "../packages/cli/src/project.ts";

const { resolveEntitlements } = createRequire(import.meta.url)("../packages/config-plugin/entitlements.cjs");
const identity: SigningCredentials = { hash: "A".repeat(40), name: "Developer ID Application: Test Team (ABCDEFGHIJ)", teamId: "ABCDEFGHIJ", keychainProfile: "test-profile" };
const id = "12345678-1234-1234-1234-123456789abc", dmgId = "87654321-4321-4321-4321-cba987654321";
function temporary() { return mkdtempSync(path.join(os.tmpdir(), "spark-package-")); }
function machO(file: string, type = 2) {
  mkdirSync(path.dirname(file), { recursive: true });
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(type, 12);
  writeFileSync(file, header, { mode: 0o755 });
}
function appFixture(root: string) {
  const app = path.join(root, "Probe.app");
  machO(path.join(app, "Contents/MacOS/Probe"));
  machO(path.join(app, "Contents/Frameworks/Hermes.framework/Versions/A/Hermes"), 6);
  symlinkSync("A", path.join(app, "Contents/Frameworks/Hermes.framework/Versions/Current"));
  writeJson(path.join(app, "Contents/Info.plist"), { CFBundleIdentifier: "test.probe", CFBundleShortVersionString: "1.0.0", CFBundleVersion: "1", CFBundleExecutable: "Probe" });
  mkdirSync(path.join(app, "Contents/Resources"));
  writeFileSync(path.join(app, "Contents/Resources/main.jsbundle"), "hello");
  return app;
}

test("only valid Developer ID identities are selectable and team filters are enforced", () => {
  const output = `1) ${identity.hash} "${identity.name}"\n2) ${"B".repeat(40)} "Apple Development: Test (ABCDEFGHIJ)"`;
  const result = parseIdentities(output);
  expect(result).toEqual([{ hash: identity.hash, name: identity.name, teamId: identity.teamId }]);
  expect(chooseIdentity(result, identity.hash.toLowerCase())).toHaveLength(1);
  expect(() => chooseIdentity(result, undefined, "OTHERTEAM1")).toThrow("No matching");
});

test("CNG entitlements use selected modules, reject conflicts, and exclude debug privileges from distribution", () => {
  expect(resolveEntitlements({ expo: { macos: { entitlements: { groups: ["app"] } } } }, [{ spark: { entitlements: { macos: { groups: ["module"], camera: true } } } }])).toEqual({ groups: ["module", "app"], camera: true });
  expect(resolveEntitlements({}, [])).toEqual({});
  expect(() => resolveEntitlements({ macos: { entitlements: { camera: false } } }, [{ spark: { entitlements: { macos: { camera: true } } } }])).toThrow("Conflicting");
  for (const value of [true, "true", 1]) expect(() => distributionEntitlements({ "com.apple.security.get-task-allow": value })).toThrow("absent or false");
  expect(() => distributionEntitlements({ groups: "$(AppIdentifierPrefix)app" })).toThrow("resolved values");
});

test("Sign in with Apple and passkey entitlements are added only when the app opts in to them", () => {
  const { validateOwned } = createRequire(import.meta.url)("../packages/config-plugin/validation.cjs");
  expect(resolveEntitlements({ macos: { authentication: {} } }, [])).toEqual({});
  expect(resolveEntitlements({ macos: { authentication: { signInWithApple: false, passkeyDomains: [] } } }, [])).toEqual({});
  expect(resolveEntitlements({ expo: { macos: { authentication: { signInWithApple: true, passkeyDomains: ["example.com", "dev.example.com?mode=developer"] }, entitlements: { "com.apple.developer.associated-domains": ["applinks:example.com"] } } } }, []))
    .toEqual({ "com.apple.developer.applesignin": ["Default"], "com.apple.developer.associated-domains": ["webcredentials:example.com", "webcredentials:dev.example.com?mode=developer", "applinks:example.com"] });
  const macos = (authentication: unknown) => ({ macos: { bundleIdentifier: "com.example.app", authentication } });
  validateOwned(macos({ signInWithApple: true, passkeyDomains: ["example.com", "login.example.com?mode=managed"] }));
  for (const invalid of [{ signInWithApple: "yes" }, { passkeyDomains: ["Example.com"] }, { passkeyDomains: ["https://example.com"] }, { passkeyDomains: ["a.com", "a.com"] }, { passkeys: true }, []])
    expect(() => validateOwned(macos(invalid))).toThrow("macos.authentication");
});

test("packaging entitlements follow the release binary even when the last generated graph was a dev superset", () => {
  const root = temporary();
  try {
    writeJson(path.join(root, "package.json"), { name: "test", dependencies: { used: "1.0.0", unused: "1.0.0" } });
    writeJson(path.join(root, "app.json"), { expo: {} });
    for (const name of ["used", "unused"]) writeJson(path.join(root, "node_modules", name, "package.json"), {
      name, version: "1.0.0", spark: { nativeModules: [name], sdk: true, entitlements: { macos: { [name]: true } } },
    });
    const all = nativePackages(root);
    writeJson(path.join(root, ".spark/native-selection.json"), { included: all });
    const used = all.find((pkg) => pkg.name === "used")!;
    expect(appEntitlements(root, { used: used.signature })).toEqual({ used: true });
    expect(() => appEntitlements(root, { used: "stale" })).toThrow("changed after");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== "darwin")("noninteractive package preflight reports missing credentials before building", async () => {
  const root = temporary();
  try {
    writeJson(path.join(root, "package.json"), { name: "test" });
    writeJson(path.join(root, "app.json"), { expo: { name: "Test" } });
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "security"), '#!/bin/sh\nprintf "0 valid identities found\\n"\n', { mode: 0o755 });
    const child = spawnProcess([process.execPath, path.resolve(import.meta.dirname, "../packages/cli/src/index.ts"), "package"], {
      cwd: root, env: { ...process.env, PATH: bin }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const error = await new Response(child.stderr).text();
    expect(await child.exited).toBe(1);
    expect(error).toContain("No matching Developer ID");
    expect(readFileSync(path.join(root, ".spark/commands.jsonl"), "utf8")).not.toContain("xcodebuild");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("signing traverses nested code inside out without following symlinks outside the bundle", async () => {
  const root = temporary();
  try {
    const app = appFixture(root);
    const helper = path.join(app, "Contents/Helpers/Worker.app");
    machO(path.join(helper, "Contents/MacOS/Worker"));
    writeJson(path.join(helper, "Contents/Info.plist"), { CFBundleExecutable: "Worker" });
    const helperBinary = path.join(app, "Contents/Helpers/backend.helper/bin/backend");
    machO(helperBinary);
    const helperLibrary = path.join(app, "Contents/Helpers/backend.helper/lib/library.dylib");
    machO(helperLibrary, 6);
    const order = signingOrder(app);
    expect(order).toContain(realpathSync(helperBinary));
    expect(order).toContain(realpathSync(helperLibrary));
    expect(order.some(item => item.endsWith("backend.helper"))).toBe(false);
    expect(order.at(-1)).toBe(realpathSync(app));
    const library = order.findIndex((item) => item.endsWith("Versions/A/Hermes"));
    const framework = order.findIndex((item) => item.endsWith("Hermes.framework"));
    expect(library).toBeLessThan(framework);
    const calls: string[][] = [];
    const execute: Runner = async (_root, args) => {
      calls.push(args);
      if (args[0] === "plutil" && args.includes("json")) return readFileSync(args.at(-1)!, "utf8");
      return "";
    };
    await signApp(root, app, identity, {}, { "Contents/Helpers/Worker.app": { "com.apple.security.app-sandbox": true } }, execute);
    const signs = calls.filter((args) => args[0] === "codesign");
    expect(signs.map((args) => args.at(-1))).toEqual(order);
    expect(signs.every((args) => !args.includes("--deep") && args.includes("--timestamp") && args.includes("runtime"))).toBe(true);
    expect(signs.find((args) => args.at(-1)!.endsWith("Versions/A/Hermes"))!.includes("--entitlements")).toBe(false);
    for (const args of signs.filter((args) => args.at(-1)!.endsWith("Worker.app") || args.at(-1)!.endsWith("MacOS/Worker"))) {
      expect(readJson(args[args.indexOf("--entitlements") + 1]!)).toEqual({ "com.apple.security.app-sandbox": true });
    }
    symlinkSync(os.tmpdir(), path.join(app, "Contents/outside"));
    expect(() => signingOrder(app)).toThrow("outside its bundle");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function harness(arch: "arm64" | "x64" = "arm64", binaryArch = arch === "x64" ? "x86_64" : "arm64") {
  const root = temporary();
  const source = appFixture(root);
  // A release build writes its dSYMs next to the app.
  mkdirSync(path.join(root, "dSYMs/Probe.app.dSYM"), { recursive: true });
  writeJson(path.join(root, "app.json"), { expo: { name: "Probe", slug: "probe", version: "1.0.0", macos: { bundleIdentifier: "test.probe" } } });
  writeJson(path.join(root, ".spark/native-selection.json"), { included: [] });
  const runtime: Runtime = { schema: 1, framework: VERSION, platform: "macos", arch, mode: "release", fingerprint: "test", modules: {} };
  const state = { status: "In Progress", dmgStatus: undefined as string | undefined, submits: 0, upload: "", uploads: new Map<string, string>(), badHash: false, invalidSignature: false, uncertainSubmit: false, uncertainDmgSubmit: false, calls: [] as string[][] };
  const execute: Runner = async (_root, args) => {
    state.calls.push(args);
    if (args[0] === "plutil") return args.includes("json") ? readFileSync(args.at(-1)!, "utf8") : "";
    if (args[0] === "lipo") return binaryArch + "\n";
    if (args[0] === "codesign") {
      if (args.includes("-dvvv") && state.calls.some(call => call[0] === "codesign" && call.includes("--sign") && call[call.indexOf("--sign") + 1] === "-")) return "CodeDirectory flags=0x10002(adhoc,runtime)\nSignature=adhoc\n";
      if (args.includes("-dvvv")) return state.invalidSignature ? "Signature=adhoc\n" : `Authority=${identity.name}\nTeamIdentifier=${identity.teamId}\nCodeDirectory flags=0x10000(runtime)\nTimestamp=Sep 10, 2026\n`;
      if (args.includes("--sign") && args.at(-1)!.endsWith(".dmg")) appendFileSync(args.at(-1)!, " signed");
      return "";
    }
    if (args[0] === "ditto") {
      if (args.includes("-x")) cpSync(readJson(args.at(-2)!).app, path.join(args.at(-1)!, "Probe.app"), { recursive: true, verbatimSymlinks: true });
      else if (args.includes("-c")) writeJson(args.at(-1)!, { app: args.at(-2)! });
      else cpSync(args[1]!, args[2]!, { recursive: true, verbatimSymlinks: true });
      return "";
    }
    // The image records what its folder held: the app's files and the Applications link.
    if (args[1] === "makehybrid") writeJson(args.at(-2)!, { image: readdirSync(args.at(-1)!).sort(), app: artifactHash(path.join(args.at(-1)!, "Probe.app")) });
    if (args[1] === "convert") cpSync(args[3]!, args.at(-1)!);
    if (args[1] === "notarytool") {
      if (args[2] === "submit") {
        const dmg = args[3]!.endsWith(".dmg"), submission = dmg ? dmgId : id;
        state.submits++;
        state.uploads.set(submission, args[3]!);
        if (!dmg) state.upload = args[3]!;
        if (dmg ? state.uncertainDmgSubmit : state.uncertainSubmit) throw new Error("connection lost after upload");
        return JSON.stringify({ id: submission });
      }
      const upload = state.uploads.get(args[3]!) ?? state.upload, status = upload.endsWith(".dmg") ? state.dmgStatus ?? state.status : state.status;
      if (args[2] === "info") return JSON.stringify({ id: args[3], name: path.basename(upload), status });
      if (args[2] === "log") return JSON.stringify({ sha256: state.badHash ? "bad" : createHash("sha256").update(readFileSync(upload)).digest("hex"), issues: [] });
    }
    if (args[1] === "stapler" && args[2] === "staple") {
      if (args[3]!.endsWith(".dmg")) appendFileSync(args[3]!, " stapled");
      else writeFileSync(path.join(args[3]!, "ticket"), "stapled");
    }
    return "";
  };
  const dependencies = { run: execute, build: async () => ({ app: source, runtime }), credentials: async () => identity, wait: async () => {} };
  return { root, source, state, dependencies, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("pending notarization resumes without resubmission and verifies the extracted final archive", async () => {
  const h = harness();
  try {
    const original = artifactHash(h.source);
    expect((await packageApp(h.root, { waitMs: 0 }, h.dependencies)).pending).toBe(true);
    expect(existsSync(path.join(h.root, "dist"))).toBe(false);
    h.state.status = "Accepted";
    const result = await packageApp(h.root, { waitMs: 0 }, h.dependencies);
    expect(result.pending).toBe(false);
    // The app once, then the DMG made from the stapled app.
    expect(h.state.submits).toBe(2);
    expect(artifactHash(h.source)).toBe(original);
    expect(h.state.calls.some((args) => args[0] === "spctl" && args.at(-1)!.includes("verify-archive"))).toBe(true);
    expect(existsSync(path.join(h.root, "dist/probe-1.0.0-arm64.zip"))).toBe(true);
    expect(readJson(path.join(h.root, "dist/probe-1.0.0-arm64-dSYMs.zip"))).toEqual({ app: path.join(h.root, "dSYMs") });
    expect(result).toMatchObject({ output: path.join(h.root, "dist/probe-1.0.0-arm64.zip"), dmg: path.join(h.root, "dist/probe-1.0.0-arm64.dmg"), symbols: path.join(h.root, "dist/probe-1.0.0-arm64-dSYMs.zip") });
    expect(h.state.calls.filter(args => args[0] === "ditto" && args[1] === "-c").every(args => args.includes("--norsrc"))).toBe(true);
    const before = h.state.calls.filter(args => args[0] === "ditto").length;
    await packageApp(h.root, { waitMs: 0 }, h.dependencies);
    expect(h.state.calls.filter(args => args[0] === "ditto")).toHaveLength(before);
    expect(h.state.submits).toBe(2);
    rmSync(path.join(h.root, "dist/probe-1.0.0-arm64.dmg"));
    expect((await packageApp(h.root, { waitMs: 0 }, h.dependencies)).dmg).toBe(path.join(h.root, "dist/probe-1.0.0-arm64.dmg"));
    expect(readFileSync(path.join(h.root, "dist/probe-1.0.0-arm64.dmg"), "utf8")).toMatch(/ signed stapled$/);
    writeFileSync(path.join(h.root, "dist/probe-1.0.0-arm64.zip"), "tampered");
    await expect(packageApp(h.root, { waitMs: 0 }, h.dependencies)).rejects.toThrow("archive changed");
  } finally { h.cleanup(); }
});

test("the DMG of the stapled app is signed and notarized after the app, and resumes and recovers like it", async () => {
  const h = harness();
  try {
    h.state.status = "Accepted";
    h.state.dmgStatus = "In Progress";
    expect(await packageApp(h.root, { waitMs: 0 }, h.dependencies)).toEqual({ pending: true, submissionId: dmgId });
    expect(existsSync(path.join(h.root, "dist"))).toBe(false);
    const folder = path.dirname(h.state.uploads.get(dmgId)!);
    // The image holds the stapled app and the Applications link, and is signed with the Developer ID before submission.
    expect(readFileSync(h.state.uploads.get(dmgId)!, "utf8")).toMatch(/ signed$/);
    expect(h.state.calls.find(args => args[1] === "makehybrid")!.at(-1)).toBe(`${h.state.uploads.get(dmgId)}.stage`);
    expect(h.state.calls).toContainEqual(["ditto", path.join(folder, "final/Probe.app"), `${h.state.uploads.get(dmgId)}.stage/Probe.app`]);
    expect(h.state.calls.findIndex(args => args[2] === "staple")).toBeLessThan(h.state.calls.findIndex(args => args[1] === "makehybrid"));
    expect(h.state.calls).toContainEqual(["codesign", "--force", "--sign", identity.hash, "--timestamp", h.state.uploads.get(dmgId)!]);
    const made = h.state.calls.length;
    h.state.dmgStatus = "Accepted";
    const result = await packageApp(h.root, { waitMs: 0 }, h.dependencies);
    expect(result).toMatchObject({ pending: false, output: path.join(h.root, "dist/probe-1.0.0-arm64.zip"), dmg: path.join(h.root, "dist/probe-1.0.0-arm64.dmg") });
    const resumed = h.state.calls.slice(made);
    expect(resumed.some(args => args[0] === "ditto" || args[1] === "makehybrid" || args[2] === "submit")).toBe(false);
    expect(h.state.submits).toBe(2);
    expect(resumed).toContainEqual(["spctl", "--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", path.join(folder, "probe-1.0.0-arm64.dmg")]);
    expect(resumed).toContainEqual(["xcrun", "stapler", "validate", path.join(folder, "probe-1.0.0-arm64.dmg")]);
    // The submitted DMG stays as Apple hashed it; the distributed copy carries the ticket.
    expect(readFileSync(h.state.uploads.get(dmgId)!, "utf8")).toMatch(/ signed$/);
    expect(readFileSync(path.join(h.root, "dist/probe-1.0.0-arm64.dmg"), "utf8")).toMatch(/ signed stapled$/);
  } finally { h.cleanup(); }
  const uncertain = harness();
  try {
    uncertain.state.status = "Accepted";
    uncertain.state.uncertainDmgSubmit = true;
    await expect(packageApp(uncertain.root, { waitMs: 0 }, uncertain.dependencies)).rejects.toThrow("connection lost");
    await expect(packageApp(uncertain.root, { waitMs: 0 }, uncertain.dependencies)).rejects.toThrow(/submission of probe-1\.0\.0-arm64-\w+\.dmg has an unknown outcome/);
    // After the app is accepted, --submission-id names the DMG's submission; the app's own ID changes nothing.
    await expect(packageApp(uncertain.root, { submissionId: id, waitMs: 0 }, uncertain.dependencies)).rejects.toThrow("unknown outcome");
    expect((await packageApp(uncertain.root, { submissionId: dmgId, waitMs: 0 }, uncertain.dependencies)).pending).toBe(false);
    expect(uncertain.state.submits).toBe(2);
  } finally { uncertain.cleanup(); }
});

test("a changed staged DMG is rejected, and a rejected DMG never reaches the distribution", async () => {
  const h = harness();
  try {
    h.state.status = "Accepted";
    h.state.dmgStatus = "In Progress";
    await packageApp(h.root, { waitMs: 0 }, h.dependencies);
    appendFileSync(h.state.uploads.get(dmgId)!, "changed");
    await expect(packageApp(h.root, { waitMs: 0 }, h.dependencies)).rejects.toThrow("disk image changed");
  } finally { h.cleanup(); }
  const rejected = harness();
  try {
    rejected.state.status = "Accepted";
    rejected.state.dmgStatus = "Invalid";
    await expect(packageApp(rejected.root, { waitMs: 0 }, rejected.dependencies)).rejects.toThrow(/Notarization Invalid\. See .*dmg-notary-log\.json/);
    expect(existsSync(path.join(rejected.root, "dist"))).toBe(false);
  } finally { rejected.cleanup(); }
});

test("rejected notarization and mismatched Apple archive hashes never produce a distribution archive", async () => {
  for (const status of ["Invalid", "Accepted"]) {
    const h = harness();
    try {
      h.state.status = status;
      h.state.badHash = true;
      await expect(packageApp(h.root, { waitMs: 0 }, h.dependencies)).rejects.toThrow(status === "Invalid" ? "Notarization Invalid" : "archive hash");
      expect(existsSync(path.join(h.root, "dist"))).toBe(false);
      expect(h.state.calls.some((args) => args[1] === "stapler")).toBe(false);
    } finally { h.cleanup(); }
  }
});

test("an uncertain upload is not resubmitted automatically and can adopt the matching submission", async () => {
  const h = harness();
  try {
    h.state.uncertainSubmit = true;
    await expect(packageApp(h.root, { waitMs: 0 }, h.dependencies)).rejects.toThrow("connection lost");
    await expect(packageApp(h.root, { waitMs: 0 }, h.dependencies)).rejects.toThrow("unknown outcome");
    expect(h.state.submits).toBe(1);
    h.state.status = "Accepted";
    await packageApp(h.root, { submissionId: id, waitMs: 0 }, h.dependencies);
    expect(h.state.submits).toBe(2);
  } finally { h.cleanup(); }
});

test("invalid signatures and changed staged artifacts are rejected before submission or resume", async () => {
  const h = harness();
  try {
    h.state.invalidSignature = true;
    await expect(packageApp(h.root, { waitMs: 0 }, h.dependencies)).rejects.toThrow("Invalid Developer ID");
    expect(h.state.submits).toBe(0);
    h.state.invalidSignature = false;
    await packageApp(h.root, { waitMs: 0 }, h.dependencies);
    const stage = readJson(h.state.upload).app;
    writeFileSync(path.join(stage, "Contents/Resources/main.jsbundle"), "changed");
    await expect(packageApp(h.root, { waitMs: 0 }, h.dependencies)).rejects.toThrow("artifacts changed");
    expect(h.state.submits).toBe(1);
  } finally { h.cleanup(); }
});

test("command arguments, output chunks, and error messages redact credentials", async () => {
  const root = temporary();
  const secret = "example-private-password";
  try {
    let error = "";
    try {
      await run(root, [process.execPath, "-e", 'process.stdout.write(process.argv.at(-1).slice(0, 8)); setTimeout(() => { process.stderr.write(process.argv.at(-1).slice(8)); process.exit(1); }, 20)', "--", "--password", secret], { capture: true });
    } catch (caught) { error = String(caught); }
    expect(error).toContain("[REDACTED]");
    expect(error).not.toContain(secret);
    const commands = readFileSync(path.join(root, ".spark/commands.jsonl"), "utf8");
    expect(commands).not.toContain(secret);
    const output = readdirSync(path.join(root, ".spark/logs")).map((file) => readFileSync(path.join(root, ".spark/logs", file), "utf8")).join("");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain(secret);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("feed-signing retries receive the same verified ZIP without repackaging or resubmitting", async () => {
  const h = harness(); let attempts = 0; let hash = "";
  try {
    h.state.status = "Accepted";
    const deps = { ...h.dependencies, prepareUpdate: async (_root: string, archive: string, buildVersion: string) => {
      expect(buildVersion).toBe("1");
      expect(h.state.calls.some(args => args[0] === "spctl" && args.at(-1)!.includes("verify-archive"))).toBe(true);
      const next = createHash("sha256").update(readFileSync(archive)).digest("hex");
      if (hash) expect(next).toBe(hash); hash = next;
      if (++attempts === 1) throw new Error("Keychain not available");
      return { feed: "appcast.xml", archive, deltas: [] };
    } };
    await expect(packageApp(h.root, {}, deps)).rejects.toThrow("Keychain not available");
    const copies = h.state.calls.filter(args => args[0] === "ditto").length;
    const result = await packageApp(h.root, {}, deps);
    expect(result.pending).toBe(false); expect(attempts).toBe(2);
    expect(h.state.submits).toBe(2); expect(h.state.calls.filter(args => args[0] === "ditto")).toHaveLength(copies);
  } finally { h.cleanup(); }
});
test("configured updates must survive production pruning before packaging", async () => {
  const h = harness();
  try {
    const config = readJson(path.join(h.root, "app.json")); config.expo.extra = { spark: { updates: { feedURL: "https://example.com/appcast.xml" } } }; writeJson(path.join(h.root, "app.json"), config);
    await expect(packageApp(h.root, {}, h.dependencies)).rejects.toThrow("module was pruned");
    expect(h.state.submits).toBe(0);
  } finally { h.cleanup(); }
});

test("Runner packaging preserves development mode, needs no embedded JS, and skips app updates", async () => {
  const h = harness();
  try {
    h.state.status = "Accepted";
    rmSync(path.join(h.source, "Contents/Resources/main.jsbundle"));
    const runtime: Runtime = { schema: 1, framework: VERSION, platform: "macos", arch: "arm64", mode: "go", fingerprint: "runner", modules: {} };
    writeJson(path.join(h.source, "Contents/Resources/spark-runtime.json"), runtime);
    let mode: string | undefined;
    const result = await packageApp(h.root, { runner: true }, { ...h.dependencies,
      build: async (_root, selected) => { mode = selected; return { app: h.source, runtime }; },
      prepareUpdate: async () => { throw new Error("Runner must not generate app update feeds"); },
    });
    expect(mode).toBe("go"); expect(result.pending).toBe(false);
    // A Runner package is only its ZIP: no DMG to make or notarize.
    expect(h.state.submits).toBe(1);
    expect(result.dmg).toBeUndefined();
    expect(h.state.calls.some(args => args[0] === "hdiutil")).toBe(false);
  } finally { h.cleanup(); }
});

test("Intel packaging validates x86_64 and names the distribution by target", async () => {
  const h = harness("x64");
  try {
    h.state.status = "Accepted";
    await packageApp(h.root, { waitMs: 0 }, h.dependencies);
    expect(existsSync(path.join(h.root, "dist/probe-1.0.0-x64.zip"))).toBe(true);
  } finally { h.cleanup(); }
});
test("Intel packaging rejects an ARM executable", async () => {
  const h = harness("x64", "arm64");
  try {
    await expect(packageApp(h.root, { waitMs: 0 }, h.dependencies)).rejects.toThrow("x86_64");
  } finally { h.cleanup(); }
});

test("ad-hoc packaging needs no credentials, never contacts Apple, and writes a test package with its dSYMs", async () => {
  const h = harness();
  try {
    const result = await packageApp(h.root, { adHoc: true }, { ...h.dependencies, credentials: async () => { throw new Error("credentials must not be read"); } });
    expect(result).toMatchObject({ pending: false, output: path.join(h.root, "dist/ad-hoc/probe-1.0.0-arm64.zip"), dmg: path.join(h.root, "dist/ad-hoc/probe-1.0.0-arm64.dmg"), symbols: path.join(h.root, "dist/ad-hoc/probe-1.0.0-arm64-dSYMs.zip") });
    // The unsigned test DMG holds the ad-hoc signed app and the Applications link.
    expect(readJson(result.dmg!)).toEqual({ image: ["Applications", "Probe.app"], app: readJson(path.join(h.root, ".spark/packaging", readdirSync(path.join(h.root, ".spark/packaging")).find(name => /^[0-9a-f]{64}$/.test(name))!, "state.json")).stagedHash });
    expect(h.state.calls.some(args => args[0] === "codesign" && args.at(-1)!.endsWith(".dmg"))).toBe(false);
    expect(existsSync(path.join(h.root, "dist/probe-1.0.0-arm64.zip"))).toBe(false);
    const signs = h.state.calls.filter(args => args[0] === "codesign" && args.includes("--sign"));
    expect(signs.length).toBeGreaterThan(0);
    expect(signs.every(args => args[args.indexOf("--sign") + 1] === "-" && args.includes("--timestamp=none") && args.includes("runtime"))).toBe(true);
    expect(h.state.calls.some(args => args[0] === "xcrun" || args[0] === "spctl")).toBe(false);
    await expect(packageApp(h.root, { adHoc: true, runner: true }, h.dependencies)).rejects.toThrow("never notarized");
  } finally { h.cleanup(); }
});
