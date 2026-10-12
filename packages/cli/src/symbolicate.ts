// `spark symbolicate`: names the frames of crash and hang reports (@legendapp/spark/diagnostics) with dSYMs,
// on this Mac. A frame is matched to a dSYM by its image's UUID; atos reads the symbol and source line.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

type Frame = { address: string; imageAddress?: string; imageUUID?: string; symbol?: string; symbolOffset?: number; location?: string };
type Report = { stack?: unknown };
type Dwarf = { file: string; arch: string };

/** DWARF files under the given paths (a .dSYM bundle, a folder holding them, or a binary with debug info), by UUID. */
export function findDwarf(paths: string[]): Map<string, Dwarf> {
  const files: string[] = [];
  const visit = (entry: string, depth: number) => {
    if (!existsSync(entry)) throw new Error(`No such dSYM or folder: ${entry}`);
    if (!statSync(entry).isDirectory()) { files.push(entry); return; }
    if (entry.endsWith(".dSYM")) {
      const dwarf = path.join(entry, "Contents/Resources/DWARF");
      if (existsSync(dwarf)) files.push(...readdirSync(dwarf).map(name => path.join(dwarf, name)));
      return;
    }
    if (depth < 6) for (const name of readdirSync(entry)) if (statSync(path.join(entry, name)).isDirectory()) visit(path.join(entry, name), depth + 1);
  };
  for (const entry of paths) visit(path.resolve(entry), 0);
  const found = new Map<string, Dwarf>();
  for (const file of files) {
    // UUID: 0F2C…-… (arm64) /path
    const output = execFileSync("dwarfdump", ["--uuid", file], { encoding: "utf8" });
    for (const [, uuid, arch] of output.matchAll(/^UUID: ([0-9A-F-]{36}) \(([^)]+)\)/gm)) found.set(uuid!, { file, arch: arch! });
  }
  return found;
}

// atos prints one line per address: "name (in image) (file:line)", "name (in image) + offset", or the address again when it knows none.
const ATOS_LINE = /^(.*) \(in [^()]+\)(?: \(([^()]+:\d+)\)| \+ (\d+))?$/;

/** The report with `symbol` (and `location`, file:line, when the dSYM has it) on every frame a dSYM covers. */
export function symbolicateReport<T extends Report>(report: T, dwarf: Map<string, Dwarf>): T {
  if (!Array.isArray(report.stack)) return report;
  const stack = (report.stack as Frame[]).map(frame => ({ ...frame }));
  // Every frame but the first is a return address, just after its call; the call is what belongs to the caller (after
  // a call to a noreturn function such as abort(), the return address is already the next function's), so atos is
  // asked about the byte before it, as the in-process symbols are.
  const groups = new Map<string, Array<{ frame: Frame; back: number }>>();
  stack.forEach((frame, depth) => {
    if (!frame.imageUUID || !frame.imageAddress || !dwarf.has(frame.imageUUID)) return;
    const key = `${frame.imageUUID} ${frame.imageAddress}`;
    groups.set(key, [...groups.get(key) ?? [], { frame, back: depth > 0 ? 1 : 0 }]);
  });
  for (const frames of groups.values()) {
    const { file, arch } = dwarf.get(frames[0]!.frame.imageUUID!)!;
    const lookups = frames.map(({ frame, back }) => `0x${(BigInt(frame.address) - BigInt(back)).toString(16)}`);
    const lines = execFileSync("atos", ["-o", file, "-arch", arch, "-l", frames[0]!.frame.imageAddress!, ...lookups], { encoding: "utf8" }).trimEnd().split("\n");
    frames.forEach(({ frame, back }, index) => {
      const match = ATOS_LINE.exec(lines[index] ?? "");
      if (!match) return;
      frame.symbol = match[1]!;
      if (match[2]) { frame.location = match[2]; delete frame.symbolOffset; }
      else if (match[3]) frame.symbolOffset = Number(match[3]) + back;
    });
  }
  return { ...report, stack };
}
