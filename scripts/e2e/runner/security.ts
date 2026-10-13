// Security audits of the release build on disk (docs/e2e-flows.md#security-audits): entitlements, signature flags and
// dylib load paths. The runner runs them over `app` itself, with no backend, so they audit the exact artifact the gate tests.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { macAppReader, type AppReader, type CodeSignature, type MachOSlice } from "../macho.ts";
import { Failure, type Platform } from "./backend.ts";

const MH_EXECUTE = 2;
const GET_TASK_ALLOW = ["com.apple.security.get-task-allow", "get-task-allow"];
const SANDBOX = "com.apple.security.app-sandbox", INHERIT = "com.apple.security.inherit";
/** Hardened runtime exceptions: each lets other code into the process or weakens its memory protections. */
const RUNTIME_EXCEPTIONS: Record<string, string> = {
  "com.apple.security.cs.disable-library-validation": "loads libraries signed by anyone",
  "com.apple.security.cs.allow-dyld-environment-variables": "honors DYLD_* injection",
  "com.apple.security.cs.allow-unsigned-executable-memory": "allows unsigned executable memory",
  "com.apple.security.cs.disable-executable-page-protection": "disables executable page protection",
  "com.apple.security.cs.allow-jit": "allows JIT (MAP_JIT) memory",
  "com.apple.security.cs.debugger": "may attach to other processes",
};
/** Locations System Integrity Protection keeps unwritable; dyld finds system libraries there (or in the shared cache). */
const SYSTEM = ["/System/", "/usr/lib/"];

export type ArtifactCommand = (args: Record<string, unknown>, platform: Platform, reader?: AppReader) => void;

type Code = { file: string; relative: string; process: boolean; slices: MachOSlice[] };
function codeOf(app: string, reader: AppReader): { root: string; main: string; code: Code[] } {
  if (!existsSync(app)) throw new Failure("invalid", `${app} does not exist`);
  const root = realpathSync(app), main = realpathSync(reader.executable(root));
  const code = reader.code(root).map(file => {
    const slices = reader.machO(file);
    return { file, relative: path.relative(root, file), process: slices.some(slice => slice.filetype === MH_EXECUTE), slices };
  });
  if (!code.some(item => item.file === main && item.process)) throw new Failure("invalid", `${path.relative(root, main)} is not an executable Mach-O file in ${app}`);
  return { root, main, code };
}

function macOnly(command: string, platform: Platform) {
  if (platform === "windows") throw new Failure("unsupported", `${command} audits macOS code signatures; the Windows release build has no equivalent here`);
}

/** Fails `command` with its problems, the first 40 listed. */
export function verdict(command: string, problems: string[]) {
  if (!problems.length) return;
  const shown = problems.slice(0, 40);
  throw new Failure("assertion", `${command} found ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n${shown.map(problem => `  ${problem}`).join("\n")}${problems.length > shown.length ? `\n  … and ${problems.length - shown.length} more` : ""}`);
}

const enabled = (entitlements: Record<string, unknown>, key: string) => entitlements[key] !== undefined && entitlements[key] !== false;

/**
 * Every process is signed with only the entitlements `allow` names, each with its reason; `get-task-allow` never. An
 * `allow` entry no process carries fails too, so the list stays the minimal set. `sandbox` is the variant: a direct
 * build sandboxes no process, a Mac App Store build every process.
 */
export const assertEntitlements: ArtifactCommand = (args, platform, reader = macAppReader) => {
  macOnly("assertEntitlements", platform);
  const allow = (args.allow ?? {}) as Record<string, string>, sandbox = args.sandbox as boolean;
  const unexplained = Object.entries(allow).filter(([, reason]) => !reason.trim()).map(([key]) => key);
  if (unexplained.length) throw new Failure("invalid", `assertEntitlements allow needs a reason for ${unexplained.join(", ")}`);
  const { code } = codeOf(String(args.app), reader), problems: string[] = [], used = new Set<string>();
  for (const item of code) {
    const { entitlements } = reader.signature(item.file), keys = Object.keys(entitlements);
    if (!item.process) {
      if (keys.length) problems.push(`${item.relative}: a library is signed with entitlements (${keys.join(", ")}); entitlements belong on executables`);
      continue;
    }
    for (const key of keys) {
      if (GET_TASK_ALLOW.includes(key)) { if (enabled(entitlements, key)) problems.push(`${item.relative}: ${key} lets any process debug it; a release build never carries it`); }
      else if (key in allow) used.add(key);
      else if (key !== SANDBOX) problems.push(`${item.relative}: ${key} is not in allow${RUNTIME_EXCEPTIONS[key] ? ` (a hardened runtime exception: it ${RUNTIME_EXCEPTIONS[key]})` : ""}`);
    }
    if (sandbox && !enabled(entitlements, SANDBOX)) problems.push(`${item.relative}: not sandboxed (${SANDBOX}); a sandboxed app sandboxes every process`);
    if (!sandbox && enabled(entitlements, SANDBOX)) problems.push(`${item.relative}: sandboxed (${SANDBOX}) in a build that is not the sandbox variant`);
  }
  if (sandbox) used.add(SANDBOX);
  for (const key of Object.keys(allow)) if (!used.has(key)) problems.push(`allow lists ${key}, which no process carries; remove it`);
  verdict("assertEntitlements", problems);
};

/**
 * Every Mach-O file is signed with the main executable's Developer ID team (not ad-hoc), every process with the hardened
 * runtime, and library validation is in force: no process carries disable-library-validation.
 */
export const assertCodeSigning: ArtifactCommand = (args, platform, reader = macAppReader) => {
  macOnly("assertCodeSigning", platform);
  const { root, code, main } = codeOf(String(args.app), reader), problems: string[] = [];
  const signatures = new Map<string, CodeSignature>(code.map(item => [item.file, reader.signature(item.file)]));
  const team = signatures.get(main)!.team;
  const mainName = path.relative(root, main);
  if (signatures.get(main)!.adhoc) problems.push(`${mainName}: signed ad-hoc; the hardened runtime and library validation need a Developer ID signature (spark package, docs/packaging.md)`);
  else if (!team) problems.push(`${mainName}: the signature has no team identifier`);
  for (const item of code) {
    const signature = signatures.get(item.file)!;
    if (!signature.signed) { problems.push(`${item.relative}: not signed`); continue; }
    if (team && signature.team !== team) problems.push(`${item.relative}: signed by team ${signature.team ?? "none"}, not ${team}; library validation refuses it`);
    if (!item.process) continue;
    if (!signature.flags.includes("runtime")) problems.push(`${item.relative}: the hardened runtime is not enabled (flags: ${signature.flags.join(",") || "none"})`);
    if (enabled(signature.entitlements, "com.apple.security.cs.disable-library-validation")) problems.push(`${item.relative}: com.apple.security.cs.disable-library-validation turns library validation off`);
  }
  verdict("assertCodeSigning", problems);
};

/** `@executable_path` and `@loader_path` expanded; undefined for a path dyld resolves against the working directory. */
function expand(entry: string, loader: string, executable: string): string | undefined {
  if (entry.startsWith("@executable_path/")) return path.join(path.dirname(executable), entry.slice("@executable_path/".length));
  if (entry.startsWith("@loader_path/")) return path.join(path.dirname(loader), entry.slice("@loader_path/".length));
  return path.isAbsolute(entry) ? path.normalize(entry) : undefined;
}
const inside = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
const system = (file: string) => SYSTEM.some(prefix => file.startsWith(prefix));
/** Where an existing file really is, so a symlink out of the bundle does not count as inside it. */
const real = (file: string) => existsSync(file) ? realpathSync(file) : file;

/**
 * No load path lets a library from outside the sealed bundle or the system into a process: every LC_RPATH is inside the
 * bundle or a system location, every dependency (weak ones too) resolves to a file inside the bundle or a system
 * library, and no LC_DYLD_ENVIRONMENT sets dyld variables. A library resolves @executable_path against the main
 * executable, the process that loads it; its @rpath lookups also use the main executable's LC_RPATH entries.
 */
export const assertLoadPaths: ArtifactCommand = (args, platform, reader = macAppReader) => {
  if (platform === "windows") throw new Failure("unsupported", "assertLoadPaths on Windows audits the DLL search order (SetDefaultDllDirectories, DependentLoadFlags, planted DLLs next to the app and in the working directory); that needs Windows hardware and the Windows backend (#51)");
  const { root, main, code } = codeOf(String(args.app), reader), problems: string[] = [];
  const mainSlices = code.find(item => item.file === main)!.slices;
  for (const item of code) {
    const executable = item.process ? item.file : main;
    for (const slice of item.slices) {
      const where = `${item.relative}${item.slices.length > 1 ? ` (${slice.arch})` : ""}`;
      for (const variable of slice.dyldEnvironment) problems.push(`${where}: LC_DYLD_ENVIRONMENT sets ${variable}`);
      const rpaths: string[] = [];
      const addRpaths = (entries: string[], loader: string) => {
        for (const entry of entries) {
          const resolved = expand(entry, loader, executable);
          if (resolved && (system(resolved) || inside(root, real(resolved)))) rpaths.push(resolved);
          else if (loader === item.file) problems.push(`${where}: LC_RPATH ${entry} ${resolved ? "is outside the bundle and the system library locations" : "is relative to the working directory"}`);
        }
      };
      addRpaths(slice.rpaths, item.file);
      if (!item.process) addRpaths(mainSlices.find(other => other.arch === slice.arch)?.rpaths ?? [], main);
      for (const { kind, name } of slice.dylibs) {
        const candidates = name.startsWith("@rpath/") ? rpaths.map(rpath => path.join(rpath, name.slice("@rpath/".length))) : [expand(name, item.file, executable)];
        const found = candidates.find(candidate => candidate && (system(candidate) || (existsSync(candidate) && inside(root, real(candidate)))));
        if (found) continue;
        const what = `${kind === "weak" ? "weak " : ""}dependency ${name}`;
        if (candidates.length === 1 && !candidates[0]) problems.push(`${where}: ${what} is relative to the working directory`);
        else if (!name.startsWith("@") && !system(name)) problems.push(`${where}: ${what} is outside the bundle and the system library locations`);
        else problems.push(`${where}: ${what} is not in the bundle${kind === "weak" ? "; a library planted on its search path would load" : ""}`);
      }
    }
  }
  verdict("assertLoadPaths", problems);
};

/**
 * The App Sandbox (Mac App Store) variant (docs/app-sandbox.md): the main executable is sandboxed without
 * com.apple.security.inherit, and every other process carries exactly app-sandbox and inherit, as Apple requires of a
 * sandboxed app's helpers. It leaves out what a sandboxed app cannot use or the App Store replaces: Sparkle code (its
 * framework, or a library linking it), Sparkle's Info.plist keys (SU*), and launch daemons (Contents/Library/LaunchDaemons:
 * privileged helpers).
 */
export const assertSandboxVariant: ArtifactCommand = (args, platform, reader = macAppReader) => {
  macOnly("assertSandboxVariant", platform);
  const { root, main, code } = codeOf(String(args.app), reader), problems: string[] = [];
  for (const item of code.filter(item => item.process)) {
    const keys = Object.keys(reader.signature(item.file).entitlements).sort();
    if (item.file === main) {
      if (!keys.includes(SANDBOX) || keys.includes(INHERIT)) problems.push(`${item.relative}: the main executable must carry ${SANDBOX} and not ${INHERIT} (it has ${keys.join(", ") || "none"})`);
    } else if (keys.join() !== [SANDBOX, INHERIT].join()) problems.push(`${item.relative}: a helper process must carry exactly ${SANDBOX} and ${INHERIT} (it has ${keys.join(", ") || "none"})`);
  }
  for (const item of code) {
    if (item.relative.split(path.sep).includes("Sparkle.framework")) problems.push(`${item.relative}: Sparkle code; the App Store updates the sandboxed variant`);
    else for (const name of new Set(item.slices.flatMap(slice => slice.dylibs.map(dylib => dylib.name)).filter(name => name.includes("Sparkle.framework"))))
      problems.push(`${item.relative}: links ${name}; the App Store updates the sandboxed variant`);
  }
  const info = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path.join(root, "Contents/Info.plist")], { encoding: "utf8" })) as Record<string, unknown>;
  for (const key of Object.keys(info).filter(key => /^SU[A-Z]/.test(key))) problems.push(`Info.plist: ${key} configures Sparkle`);
  const daemons = path.join(root, "Contents/Library/LaunchDaemons");
  if (existsSync(daemons)) problems.push(`Contents/Library/LaunchDaemons: ${readdirSync(daemons).join(", ") || "an empty folder"}; a sandboxed app cannot install a launch daemon (privileged helper)`);
  verdict("assertSandboxVariant", problems);
};

/** Commands the runner runs over the build on disk; see `runner` in scripts/e2e/format/commands.ts. */
export const ARTIFACT_COMMANDS: Readonly<Record<string, ArtifactCommand>> = { assertEntitlements, assertCodeSigning, assertLoadPaths, assertSandboxVariant };
