// Reads the security attributes of a built macOS app: its Mach-O files, their load commands and their code signatures.
// Load commands are parsed here, not with otool, because the release harness runs on machines without developer tools.
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { signingOrder } from "../../packages/cli/src/signing.ts";

export type DylibKind = "load" | "weak" | "reexport" | "lazy" | "upward";
/** One architecture of a Mach-O file. `filetype` 2 is an executable (a process); 6 a dylib; 8 a bundle. */
export type MachOSlice = { arch: string; filetype: number; dylibs: Array<{ kind: DylibKind; name: string }>; rpaths: string[]; dyldEnvironment: string[] };
/** `flags`: the CodeDirectory flag names codesign prints, such as `runtime` or `library-validation`. */
export type CodeSignature = { signed: boolean; adhoc: boolean; team?: string; flags: string[]; entitlements: Record<string, unknown> };

/** What the security commands read from an app. Tests pass a double; `macAppReader` reads the real bundle. */
export type AppReader = {
  /** The main executable: Contents/MacOS/<CFBundleExecutable>. */
  executable(app: string): string;
  /** Every Mach-O file in the bundle, by real path. */
  code(app: string): string[];
  machO(file: string): MachOSlice[];
  signature(file: string): CodeSignature;
};

const DYLIB_COMMANDS: Record<number, DylibKind> = { 0xc: "load", 0x80000018: "weak", 0x8000001f: "reexport", 0x20: "lazy", 0x80000023: "upward" };
const LC_RPATH = 0x8000001c, LC_DYLD_ENVIRONMENT = 0x27;
const ARCHES: Record<number, string> = { 0x0100000c: "arm64", 0x01000007: "x86_64" };

/** The slices of a thin or universal Mach-O file; `read(offset, length)` returns at most `length` bytes of the file. */
export function parseMachO(read: (offset: number, length: number) => Buffer): MachOSlice[] {
  const head = read(0, 8);
  if (head.length < 8) return [];
  const magic = head.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const wide = magic === 0xcafebabf, entry = wide ? 32 : 20, count = head.readUInt32BE(4);
    const table = read(8, count * entry);
    return Array.from({ length: count }, (_, index) => {
      const at = index * entry;
      return slice(read, wide ? Number(table.readBigUInt64BE(at + 8)) : table.readUInt32BE(at + 8));
    }).filter((value): value is MachOSlice => !!value);
  }
  const thin = slice(read, 0);
  return thin ? [thin] : [];
}

function slice(read: (offset: number, length: number) => Buffer, base: number): MachOSlice | undefined {
  const header = read(base, 32);
  if (header.length < 28) return undefined;
  const magic = header.readUInt32LE(0);
  if (magic !== 0xfeedface && magic !== 0xfeedfacf) return undefined;
  const commands = read(base + (magic === 0xfeedfacf ? 32 : 28), header.readUInt32LE(20));
  const result: MachOSlice = { arch: ARCHES[header.readUInt32LE(4)] ?? `cpu-${header.readUInt32LE(4).toString(16)}`, filetype: header.readUInt32LE(12), dylibs: [], rpaths: [], dyldEnvironment: [] };
  const text = (at: number, size: number) => {
    const start = at + commands.readUInt32LE(at + 8), end = commands.indexOf(0, start);
    return commands.toString("utf8", start, end < 0 || end > at + size ? at + size : end);
  };
  for (let index = 0, at = 0; index < header.readUInt32LE(16) && at + 8 <= commands.length; index++) {
    const cmd = commands.readUInt32LE(at), size = commands.readUInt32LE(at + 4);
    if (size < 8 || at + size > commands.length) break;
    if (DYLIB_COMMANDS[cmd]) result.dylibs.push({ kind: DYLIB_COMMANDS[cmd], name: text(at, size) });
    else if (cmd === LC_RPATH) result.rpaths.push(text(at, size));
    else if (cmd === LC_DYLD_ENVIRONMENT) result.dyldEnvironment.push(text(at, size));
    at += size;
  }
  return result;
}

/** `codesign -d --verbose=4` (stderr) and `codesign -d --entitlements - --xml` (stdout) as a CodeSignature. */
export function parseSignature(details: string, entitlements: Record<string, unknown>): CodeSignature {
  if (/code object is not signed at all/.test(details)) return { signed: false, adhoc: false, flags: [], entitlements: {} };
  const team = /^TeamIdentifier=(.+)$/m.exec(details)?.[1];
  const flags = /^CodeDirectory .*\bflags=0x[0-9a-f]+\(([^)]*)\)/m.exec(details)?.[1];
  return { signed: true, adhoc: /^Signature=adhoc$/m.test(details), team: team && team !== "not set" ? team : undefined, flags: flags ? flags.split(",") : [], entitlements };
}

function readFile(file: string) {
  const fd = openSync(file, "r");
  try {
    return parseMachO((offset, length) => {
      const buffer = Buffer.alloc(length);
      return buffer.subarray(0, readSync(fd, buffer, 0, length, offset));
    });
  } finally { closeSync(fd); }
}

const tool = (command: string, args: string[], input?: string) => spawnSync(command, args, { encoding: "utf8", input, maxBuffer: 16 * 2 ** 20 });

export const macAppReader: AppReader = {
  executable: app => path.join(app, "Contents/MacOS", execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim()),
  code: app => signingOrder(app).filter(file => lstatSync(file).isFile()),
  machO: readFile,
  signature(file) {
    const details = tool("codesign", ["-d", "--verbose=4", file]);
    if (details.status !== 0 && !/not signed at all/.test(details.stderr)) throw new Error(`codesign -d ${file}: ${details.stderr.trim() || details.error?.message}`);
    const xml = details.status === 0 ? tool("codesign", ["-d", "--entitlements", "-", "--xml", file]).stdout : "";
    const json = xml.trim() ? tool("plutil", ["-convert", "json", "-o", "-", "-"], xml) : undefined;
    if (json && json.status !== 0) throw new Error(`entitlements of ${file} are not a property list: ${json.stderr.trim()}`);
    return parseSignature(details.stderr, json ? JSON.parse(json.stdout) : {});
  },
};
