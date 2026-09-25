import { writeFile } from "node:fs/promises";
import { readAppConfig } from "./project.ts";
import { existsSync, openSync, closeSync, readSync, readdirSync, realpathSync, lstatSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { run } from "./commands.ts";
import { digest, nativePackages, readJson, stateFile, writeJson } from "./project.ts";
import type { Runner, SigningCredentials } from "./credentials.ts";

const { resolveEntitlements } = createRequire(import.meta.url)("@legendapp/spark-desktop-config/entitlements.cjs");
export type Entitlements = Record<string, unknown>;

export function distributionEntitlements(value: Entitlements) {
  for (const key of ["com.apple.security.get-task-allow", "get-task-allow"]) {
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
  const targets = new Map(order.map((file) => [file, byPath[path.relative(app, file)] ?? {}]));
  targets.set(app, entitlements);
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

export async function signApp(root: string, app: string, credentials: SigningCredentials, entitlements: Entitlements, byPath: Record<string, Entitlements> = {}, execute: Runner = run) {
  app = realpathSync(app);
  distributionEntitlements(entitlements);
  const order = signingOrder(app);
  const relatives = new Set(order.map((file) => path.relative(app, file) || "."));
  for (const [relative, value] of Object.entries(byPath)) {
    if (!relatives.has(relative) || relative === ".") throw new Error(`Unknown nested signing target: ${relative}`);
    distributionEntitlements(value);
  }
  const targets = await entitlementTargets(root, app, order, entitlements, byPath, execute);
  for (const file of order) {
    const relative = path.relative(app, file) || ".";
    const value = targets.get(file)!;
    const processTarget = /\.(app|xpc|appex)$/.test(file) || (lstatSync(file).isFile() && machOType(file) === 2);
    if (!processTarget && Object.keys(value).length) throw new Error(`Entitlements belong on executable processes, not libraries: ${relative}`);
    const plist = stateFile(root, `packaging/entitlements/${digest(relative)}.plist`);
    writeJson(plist, value);
    await execute(root, ["plutil", "-convert", "xml1", plist], { capture: true });
    await execute(root, ["codesign", "--force", "--sign", credentials.hash, "--options", "runtime", "--timestamp", ...(processTarget ? ["--entitlements", plist] : []),
      ...(credentials.keychain ? ["--keychain", credentials.keychain] : []), file], { capture: true });
  }
  return order;
}

export async function validateApp(root: string, app: string, credentials: SigningCredentials, expected: { arch: "arm64" | "x64"; runner?: boolean; bundleId: string; version: string; buildVersion: string; entitlements: Entitlements; byPath: Record<string, Entitlements> }, notarized: boolean, execute: Runner = run) {
  app = realpathSync(app);
  if (expected.runner) {
    const runtime = readJson(path.join(app, "Contents/Resources/spark-runtime.json"));
    if (runtime.mode !== "go" || runtime.platform !== "macos" || runtime.arch !== expected.arch) throw new Error("Distribution app is not a macOS Spark Runner.");
  } else if (!existsSync(path.join(app, "Contents/Resources/main.jsbundle"))) throw new Error("Distribution app is missing its JavaScript bundle.");
  const info = JSON.parse(await execute(root, ["plutil", "-convert", "json", "-o", "-", path.join(app, "Contents/Info.plist")], { capture: true }));
  for (const [key, value] of Object.entries({ CFBundleIdentifier: expected.bundleId, CFBundleShortVersionString: expected.version, CFBundleVersion: expected.buildVersion })) {
    if (info[key] !== value) throw new Error(`Packaged ${key} does not match the release build.`);
  }
  const arches = (await execute(root, ["lipo", "-archs", path.join(app, "Contents/MacOS", info.CFBundleExecutable)], { capture: true })).trim().split(/\s+/);
  const expectedArch = expected.arch === "x64" ? "x86_64" : "arm64";
  if (arches.length !== 1 || arches[0] !== expectedArch) throw new Error(`The package must contain a ${expectedArch} app.`);
  await execute(root, ["codesign", "--verify", "--deep", "--strict", "--verbose=2", app], { capture: true });
  const order = signingOrder(app);
  const targets = await entitlementTargets(root, app, order, expected.entitlements, expected.byPath, execute);
  for (const file of order) {
    const signature = await execute(root, ["codesign", "-dvvv", file], { capture: true });
    if (!signature.includes(`Authority=${credentials.name}\n`) || !signature.includes(`TeamIdentifier=${credentials.teamId}\n`) || !/flags=.*\bruntime\b/.test(signature) || !/^Timestamp=/m.test(signature)) {
      throw new Error(`Invalid Developer ID signature, hardened runtime, or timestamp: ${file}`);
    }
    const signedEntitlements = await execute(root, ["codesign", "-d", "--entitlements", ":-", file], { capture: true });
    // Inspect the final signature, not just the input entitlement file.
    const xml = signedEntitlements.match(/<\?xml[\s\S]*?<\/plist>|<plist[\s\S]*?<\/plist>/)?.[0];
    let actual: Entitlements = {};
    if (xml) {
      const plist = stateFile(root, "packaging/verified-entitlements.plist");
      await writeFile(plist, xml);
      actual = distributionEntitlements(JSON.parse(await execute(root, ["plutil", "-convert", "json", "-o", "-", plist], { capture: true })));
    }
    const desired = targets.get(file);
    if (!isDeepStrictEqual(actual, desired)) throw new Error(`Signed entitlements do not match the release configuration: ${file}`);
  }
  if (notarized) {
    await execute(root, ["xcrun", "stapler", "validate", app], { capture: true });
    await execute(root, ["spctl", "--assess", "--type", "execute", "--verbose=4", app], { capture: true });
  }
}
