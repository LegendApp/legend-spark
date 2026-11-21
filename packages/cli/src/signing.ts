import { execFileSync } from "node:child_process";
import { readAppConfig } from "./project.ts";
import { existsSync, openSync, closeSync, readSync, readdirSync, realpathSync, lstatSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { run } from "./commands.ts";
import { digest, nativePackages, readJson, stateFile, writeJson, type Runtime } from "./project.ts";
import type { Runner, SigningCredentials } from "./credentials.ts";
import { checkReleaseLoadPaths, checkReleasePayload } from "./release-app.ts";
import { checkReleaseTestDriver } from "./release-driver.ts";

const { resolveEntitlements } = createRequire(import.meta.url)("@legendapp/spark-desktop-config/entitlements.cjs");
export type Entitlements = Record<string, unknown>;

export function distributionEntitlements(value: Entitlements) {
  for (const key of ["com.apple.security.get-task-allow", "get-task-allow", "com.apple.security.cs.disable-library-validation"]) {
    if (value[key] !== undefined && value[key] !== false) throw new Error(`${key} must be absent or false in a distribution app.`);
  }
  function inspect(item: unknown) {
    if (typeof item === "string" && item.includes("$(")) throw new Error("Distribution entitlements must contain resolved values, not Xcode build variables.");
    if (item && typeof item === "object") for (const nested of Object.values(item)) inspect(nested);
  }
  inspect(value);
  return value;
}

export function appEntitlements(root: string, modules: Record<string, string>): Entitlements {
  const names = Object.keys(modules);
  const selected = names.length ? nativePackages(root).filter((pkg) => names.includes(pkg.name)) : [];
  if (selected.length !== names.length || selected.some((pkg) => pkg.signature !== modules[pkg.name])) throw new Error("Native packages changed after the release build. Rebuild before packaging.");
  // A cached release can coexist with a last-generated dev graph. Use the
  // release binary's module set, not whichever selection file was written last.
  return resolveEntitlements(readAppConfig(root), selected.map((pkg) => pkg.json));
}

export function releaseAppExpectation(root: string, runtime: Runtime, config: ReturnType<typeof readAppConfig>["expo"], buildVersion: string) {
  if (runtime.platform !== "macos" || !["release", "go"].includes(runtime.mode)) throw new Error("Expected a macOS release app or Spark Runner.");
  const bundleId = config.macos?.bundleIdentifier, version = config.version;
  if (!bundleId || !version || typeof buildVersion !== "string" || !buildVersion) throw new Error("Bundle identifier and release version metadata must be configured before packaging.");
  return {
    runtime, bundleId, version, buildVersion,
    entitlements: appEntitlements(root, runtime.modules),
    byPath: config.extra?.spark?.signing?.macos?.entitlementsByPath ?? {},
    testDriverInRelease: config.macos?.testDriverInRelease === true,
  };
}

function machOType(file: string): number | undefined {
  const fd = openSync(file, "r");
  try {
    const header = Buffer.alloc(32);
    if (readSync(fd, header, 0, 32, 0) < 16) return undefined;
    let magic = header.readUInt32BE(0);
    if ([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) {
      const little = magic === 0xbebafeca || magic === 0xbfbafeca;
      const read32 = (offset: number) => little ? header.readUInt32LE(offset) : header.readUInt32BE(offset);
      if (read32(4) < 1 || read32(4) > 128) return undefined;
      const wide = magic === 0xcafebabf || magic === 0xbfbafeca;
      const offset = wide ? Number(little ? header.readBigUInt64LE(16) : header.readBigUInt64BE(16)) : read32(16);
      if (!Number.isSafeInteger(offset) || readSync(fd, header, 0, 16, offset) < 16) return undefined;
      magic = header.readUInt32BE(0);
    }
    if (magic === 0xfeedface || magic === 0xfeedfacf) return header.readUInt32BE(12);
    if (magic === 0xcefaedfe || magic === 0xcffaedfe) return header.readUInt32LE(12);
    return undefined;
  } finally { closeSync(fd); }
}

export function signingOrder(app: string): string[] {
  app = realpathSync(app);
  const code: string[] = [];
  const bundles: string[] = [];
  function visit(file: string) {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      const resolved = realpathSync(file);
      if (resolved !== app && !resolved.startsWith(app + path.sep)) throw new Error(`App contains a symlink outside its bundle: ${file}`);
      return;
    }
    if (stat.isDirectory()) {
      if (/\.(app|xpc|appex|framework|bundle)$/.test(file)) bundles.push(file);
      for (const name of readdirSync(file).sort()) visit(path.join(file, name));
    } else if (stat.isFile() && [2, 6, 8].includes(machOType(file) ?? 0)) code.push(file);
  }
  visit(app);
  if (!code.length) throw new Error("App contains no Mach-O executables.");
  const containers = bundles.filter((bundle) => code.some((file) => file.startsWith(bundle + path.sep)));
  return [...new Set([...code, ...containers])].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length || a.localeCompare(b));
}

async function entitlementTargets(root: string, app: string, order: string[], entitlements: Entitlements, byPath: Record<string, Entitlements>, execute: Runner) {
  const targets = new Map<string, Entitlements>(order.map(file => [file, {}]));
  targets.set(app, distributionEntitlements(entitlements));
  for (const [relative, value] of Object.entries(byPath)) {
    const file = path.join(app, relative);
    if (path.relative(app, file) !== relative || !targets.has(file) || file === app) throw new Error(`Unknown nested signing target: ${relative}`);
    if (!isProcessTarget(file) && Object.keys(value).length) throw new Error(`Entitlements belong on executable processes, not libraries: ${relative}`);
    targets.set(file, distributionEntitlements(value));
  }
  for (const container of order.filter((file) => /\.(app|xpc|appex)$/.test(file))) {
    const plist = existsSync(path.join(container, "Contents/Info.plist")) ? path.join(container, "Contents/Info.plist") : path.join(container, "Info.plist");
    const info = JSON.parse(await execute(root, ["plutil", "-convert", "json", "-o", "-", plist], { capture: true }));
    if (typeof info.CFBundleExecutable !== "string" || path.basename(info.CFBundleExecutable) !== info.CFBundleExecutable) throw new Error(`Invalid executable name in ${plist}`);
    const executable = plist.endsWith("Contents/Info.plist") ? path.join(container, "Contents/MacOS", info.CFBundleExecutable) : path.join(container, info.CFBundleExecutable);
    if (!order.includes(executable)) throw new Error(`Bundle executable is missing from the signing plan: ${executable}`);
    const explicit = byPath[path.relative(app, executable)];
    const value = targets.get(container)!;
    if (explicit && !isDeepStrictEqual(explicit, value)) throw new Error(`Configure process entitlements on its bundle, not a conflicting executable override: ${executable}`);
    targets.set(executable, value);
  }
  return targets;
}

function isProcessTarget(file: string) {
  return /\.(app|xpc|appex)$/.test(file) || (lstatSync(file).isFile() && machOType(file) === 2);
}

export async function signApp(root: string, app: string, credentials: Pick<SigningCredentials, "hash" | "keychain">, entitlements: Entitlements, byPath: Record<string, Entitlements> = {}, execute: Runner = run) {
  app = realpathSync(app);
  const order = signingOrder(app);
  const targets = await entitlementTargets(root, app, order, entitlements, byPath, execute);
  for (const file of order) {
    const args = ["codesign", "--force", "--sign", credentials.hash, "--options", "runtime", "--timestamp"];
    if (isProcessTarget(file)) {
      const relative = path.relative(app, file) || ".";
      const plist = stateFile(root, `packaging/entitlements/${digest(relative)}.plist`);
      writeJson(plist, targets.get(file)!);
      await execute(root, ["plutil", "-convert", "xml1", plist], { capture: true });
      args.push("--entitlements", plist);
    }
    if (credentials.keychain) args.push("--keychain", credentials.keychain);
    await execute(root, [...args, file], { capture: true });
  }
  return order;
}

export async function validateApp(root: string, app: string, identity: Pick<SigningCredentials, "name" | "teamId">, expected: ReturnType<typeof releaseAppExpectation>, notarized: boolean, execute: Runner = run) {
  app = realpathSync(app);
  const info = JSON.parse(await execute(root, ["plutil", "-convert", "json", "-o", "-", path.join(app, "Contents/Info.plist")], { capture: true }));
  checkReleasePayload(app, expected.runtime.mode === "go", info);
  if (expected.runtime.mode === "release") checkReleaseTestDriver(app, expected.testDriverInRelease);
  const runtime = readJson(path.join(app, "Contents/Resources/spark-runtime.json"));
  if (!isDeepStrictEqual(runtime, expected.runtime)) throw new Error("The packaged runtime receipt does not match the release build.");
  for (const [key, value] of Object.entries({ CFBundleIdentifier: expected.bundleId, CFBundleShortVersionString: expected.version, CFBundleVersion: expected.buildVersion })) {
    if (info[key] !== value) throw new Error(`Packaged ${key} does not match the release build.`);
  }
  const executable = info.CFBundleExecutable;
  if (info.CFBundlePackageType !== "APPL" || typeof executable !== "string" || !executable || path.basename(executable) !== executable) throw new Error("Invalid app package type or executable name in Info.plist.");
  const main = path.join(app, "Contents/MacOS", executable);
  const arches = (await execute(root, ["lipo", "-archs", main], { capture: true })).trim().split(/\s+/);
  const expectedArch = expected.runtime.arch === "x64" ? "x86_64" : "arm64";
  if (arches.length !== 1 || arches[0] !== expectedArch) throw new Error(`The package must contain a ${expectedArch} app.`);
  // Apple TN3127's Developer ID Application requirement, independent of the certificate's display name.
  const developerId = "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists";
  await execute(root, ["codesign", "--verify", "--deep", "--strict", "--verbose=2", "-R=" + developerId, app], { capture: true });
  const order = signingOrder(app);
  const targets = await entitlementTargets(root, app, order, expected.entitlements, expected.byPath, execute);
  for (const file of order) {
    const signature = await execute(root, ["codesign", "-dvvv", file], { capture: true });
    if (!signature.includes(`Authority=${identity.name}\n`) || !signature.includes(`TeamIdentifier=${identity.teamId}\n`) || !/flags=.*\bruntime\b/.test(signature) || !/^Timestamp=/m.test(signature)) {
      throw new Error(`Invalid Developer ID signature, hardened runtime, or timestamp: ${file}`);
    }
    const signedEntitlements = await execute(root, ["codesign", "-d", "--entitlements", "-", "--xml", file], { capture: true });
    const xml = signedEntitlements.match(/<\?xml[\s\S]*?<\/plist>|<plist[\s\S]*?<\/plist>/)?.[0];
    const actual = xml ? distributionEntitlements(JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], { input: xml, encoding: "utf8" }))) : {};
    const desired = targets.get(file);
    if (!isDeepStrictEqual(actual, desired)) throw new Error(`Signed entitlements do not match the release configuration: ${file}`);
  }
  await checkReleaseLoadPaths(root, app, main, order.filter(file => lstatSync(file).isFile()), execute);
  if (notarized) {
    await execute(root, ["xcrun", "stapler", "validate", app], { capture: true });
    await execute(root, ["spctl", "--assess", "--type", "execute", "--verbose=4", app], { capture: true });
  }
}
