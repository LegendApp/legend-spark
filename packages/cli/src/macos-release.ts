import { chmodSync, closeSync, cpSync, existsSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

// Shared by the compiler invocation and runtime cache fingerprint.
export const macOSReleaseSettings = [
  "DEPLOYMENT_POSTPROCESSING=YES",
  "DEAD_CODE_STRIPPING=YES",
  "LLVM_LTO=YES_THIN",
  "GCC_OPTIMIZATION_LEVEL=z",
  // Symbols go to a dSYM next to the app (sourceSymbols), not into it.
  "DEBUG_INFORMATION_FORMAT=dwarf-with-dsym",
];

/**
 * The directory whose paths a release must not embed: the workspace root (a package.json with `workspaces`, or
 * pnpm-workspace.yaml) that contains the app, or the app itself. Hoisted node_modules and linked packages live under it.
 */
export function sourceRoot(appRoot: string): string {
  for (let dir = path.dirname(appRoot); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(path.join(dir, "pnpm-workspace.yaml")) || (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).workspaces)) return dir;
  }
  return appRoot;
}

/** Compiler settings that write source paths (__FILE__ in asserts and logs) relative to the source root. */
export function macOSReleasePathSettings(appRoot: string): string[] {
  const map = `"-ffile-prefix-map=${sourceRoot(appRoot)}=."`;
  return [`OTHER_CFLAGS=$(inherited) ${map}`, `OTHER_CPLUSPLUSFLAGS=$(inherited) ${map}`];
}

/**
 * A hermesc that compiles the bundle by its file name from its own folder, so the bytecode's debug info (which names the
 * source file for stack traces) holds `main.jsbundle`, not the build folder's absolute path. React Native's bundling
 * script runs the compiler named by HERMES_CLI_PATH.
 */
export function relativeHermesCompiler(nativeRoot: string, file: string): string {
  const hermesc = path.join(nativeRoot, "Pods/hermes-engine/destroot/bin/hermesc");
  writeFileSync(file, `#!/bin/bash\nset -e\ninput="\${@: -1}"\ncd "$(dirname "$input")"\nexec ${JSON.stringify(hermesc)} "\${@:1:$#-1}" "$(basename "$input")"\n`);
  chmodSync(file, 0o755);
  return file;
}

/**
 * Removes App Transport Security's local networking exemption (NSAllowsLocalNetworking, which the Spark config plugin
 * sets for the development server) from a release app's Info.plist, and the NSAppTransportSecurity dictionary when that
 * was its only key. Release builds load their embedded JavaScript and reach no development server.
 */
export function removeLocalNetworking(app: string) {
  const plist = path.join(app, "Contents/Info.plist");
  const extracted = spawnSync("plutil", ["-extract", "NSAppTransportSecurity", "json", "-o", "-", plist], { encoding: "utf8" });
  if (extracted.status !== 0) {
    if (extracted.stderr.includes("No value at that key path")) return;
    throw new Error(`plutil could not read NSAppTransportSecurity from ${plist}: ${extracted.stderr.trim()}`);
  }
  const ats = JSON.parse(extracted.stdout) as Record<string, unknown>;
  if (!("NSAllowsLocalNetworking" in ats)) return;
  execFileSync("plutil", ["-remove", Object.keys(ats).length === 1 ? "NSAppTransportSecurity" : "NSAppTransportSecurity.NSAllowsLocalNetworking", plist]);
}

const MACH_O = new Set([0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);
function isMachO(file: string): boolean {
  const fd = openSync(file, "r"), magic = Buffer.alloc(4);
  try { return readSync(fd, magic, 0, 4, 0) === 4 && MACH_O.has(magic.readUInt32BE(0)); } finally { closeSync(fd); }
}
const uuids = (file: string) => [...execFileSync("dwarfdump", ["--uuid", file], { encoding: "utf8" }).matchAll(/^UUID: ([0-9A-F-]{36})/gm)].map(match => match[1]!);

/**
 * Copies the dSYMs under `searchRoots` that match a binary of the app into `destination`: the build's own and those vendors
 * ship in their pods (Sparkle's Symbols folder). dSYMs already in `destination` count too. Returns the binaries of the
 * app that no dSYM matches.
 */
export function collectDsyms(app: string, searchRoots: string[], destination: string): string[] {
  const binaries = new Map<string, string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && isMachO(file)) for (const uuid of uuids(file)) binaries.set(uuid, path.relative(app, file));
    }
  };
  visit(app);
  const dsyms: string[] = [];
  const find = (dir: string, depth: number) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith(".dSYM")) dsyms.push(path.join(dir, entry.name));
      else if (depth > 0) find(path.join(dir, entry.name), depth - 1);
    }
  };
  for (const root of [destination, ...searchRoots]) find(root, 3);
  const matched = new Set<string>();
  for (const dsym of dsyms) {
    const dwarf = path.join(dsym, "Contents/Resources/DWARF");
    if (!existsSync(dwarf)) continue;
    const found = readdirSync(dwarf).flatMap(name => uuids(path.join(dwarf, name))).filter(uuid => binaries.has(uuid));
    if (!found.length) continue;
    found.forEach(uuid => matched.add(uuid));
    if (path.dirname(dsym) !== destination) cpSync(dsym, path.join(destination, path.basename(dsym)), { recursive: true, verbatimSymlinks: true });
  }
  return [...new Set([...binaries].filter(([uuid]) => !matched.has(uuid)).map(([, binary]) => binary))];
}
