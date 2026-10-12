// The gate's bundle audit: release bundle hygiene of the artifact (docs/e2e-flows.md#audits, #153).
// File checks are portable; Mach-O, dSYM and Info.plist checks use the Xcode command line tools and run on macOS.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { NOTICES_FILE } from "../../../packages/cli/src/notices.ts";
import type { Audit } from "../format/primitives.ts";
import type { Platform } from "../runner/backend.ts";

export type AuditOptions = {
  /** The artifact: the .app bundle on macOS. */
  app: string;
  platform: Platform;
  /** The gate's appId: the bundle identifier the artifact must have. */
  appId: string;
  sizeBudgetMB?: number;
  /** The folder of the build's debug symbols. */
  symbols?: string;
};
/** `details`: the findings when the check fails, what it found when it passes, and why when it is unsupported. */
export type AuditResult = { check: string; status: "passed" | "failed" | "unsupported"; details: string[] };

type Entry = { rel: string; abs: string; size: number; kind: "file" | "dir" | "link" };

/** Hermes bytecode files start with this magic number (little-endian 0x1F1903C103BC1FC6). */
const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
const MACH_O = new Set([0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xfeedface, 0xcefaedfe]);
const WINDOWS_TODO = "needs a Windows release build and PE/PDB tooling (#51)";

/** Names a release bundle must not contain: development, build and test leftovers. */
const STRAY: Array<[RegExp, string]> = [
  [/(^|\/)\.DS_Store$/, "Finder metadata"],
  [/\.map$/, "source map"],
  [/(^|\/)node_modules(\/|$)/, "node_modules"],
  [/(^|\/)(__tests__|__mocks__|__fixtures__|e2e|fixtures?)(\/|$)/, "test fixtures"],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, "test file"],
  [/(?<!\.d)\.tsx?$/, "TypeScript source"],
  [/\.(o|a|hmap|swiftmodule|swiftinterface|swiftdoc|xcconfig|pbxproj|xcworkspacedata|log|orig|rej|swp)$|~$/, "build or editor leftover"],
  [/(^|\/)(Podfile(\.lock)?|package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|\.git(ignore|attributes)?|\.env(\..*)?|\.npmrc)$/, "project file"],
  [/\.dSYM(\/|$)/, "debug symbols (dSYMs ship separately)"],
  [/\.(debug\.dylib)$|(^|\/)__preview\.dylib$|(^|\/)libclang_rt\.[^/]*\.dylib$/, "debug or sanitizer dylib"],
  [/(^|\/)(Headers|PrivateHeaders|Modules)(\/|$)/, "framework headers or module maps"],
  [/\.(pem|p12|key|mobileprovision|cer)$|(^|\/)id_(rsa|ed25519|ecdsa)$/, "key or certificate"],
];

/** Absolute paths of a developer machine or build host. */
const MACHINE_PATHS = /(\/Users\/(?!Shared\/)[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|\/private\/var\/folders\/|\/var\/folders\/[a-z0-9_]{2}\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\)[^\0\n"']{0,120}/g;
/** Credentials that must never ship. Each pattern names what it found. */
const SECRETS: Array<[RegExp, string]> = [
  [/-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, "private key"],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "AWS access key ID"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, "GitHub token"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, "Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "Google API key"],
  [/\b[rs]k_live_[0-9A-Za-z]{20,}\b/g, "Stripe live key"],
  [/\bnpm_[A-Za-z0-9]{36}\b/g, "npm token"],
  [/\bsk-(ant-|proj-)?[A-Za-z0-9_-]{32,}\b/g, "API secret key"],
];

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

function walk(root: string): Entry[] {
  const entries: Entry[] = [];
  const visit = (abs: string, rel: string) => {
    const stat = lstatSync(abs), kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "dir" : "file";
    if (rel) entries.push({ rel, abs, size: kind === "file" ? stat.size : 0, kind });
    if (kind === "dir") for (const name of readdirSync(abs).sort()) visit(path.join(abs, name), rel ? `${rel}/${name}` : name);
  };
  visit(root, "");
  return entries;
}

function head(file: string, length: number): Buffer {
  const fd = openSync(file, "r");
  try { const buffer = Buffer.alloc(length); return buffer.subarray(0, readSync(fd, buffer, 0, length, 0)); } finally { closeSync(fd); }
}

const isMachO = (entry: Entry) => entry.kind === "file" && entry.size >= 4 && MACH_O.has(head(entry.abs, 4).readUInt32BE(0));
const isHermes = (file: string) => head(file, 8).equals(HERMES_MAGIC);
/** JavaScript the app could load: bundles and scripts by extension. */
const isScript = (entry: Entry) => entry.kind === "file" && /\.(jsbundle|bundle|hbc|[cm]?js)$/.test(entry.rel);

function tool(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${(result.stderr || result.error?.message || `exit ${result.status}`).trim()}`);
  return result.stdout;
}

/** Printable runs of at least 6 bytes, as `strings` finds them, from any file. */
const printable = (file: string) => readFileSync(file).toString("latin1").match(/[\x20-\x7e]{6,}/g) ?? [];

function check(id: string, run: () => { findings: string[]; evidence: string[] } | string[]): AuditResult {
  try {
    const outcome = run();
    if (Array.isArray(outcome)) return { check: id, status: "unsupported", details: outcome };
    return outcome.findings.length ? { check: id, status: "failed", details: outcome.findings } : { check: id, status: "passed", details: outcome.evidence };
  } catch (error) {
    return { check: id, status: "failed", details: [(error as Error).message] };
  }
}

/** Every check of the bundle audit. A check that this platform cannot run reports `unsupported`, which fails the gate. */
export function auditBundle(options: AuditOptions): AuditResult[] {
  const { app, platform } = options, mac = platform === "macos";
  if (!existsSync(app)) return [{ check: "DIST-HYG-01", status: "failed", details: [`${app} does not exist`] }];
  const entries = walk(app), files = entries.filter(entry => entry.kind === "file");
  const machO = mac ? files.filter(isMachO) : [];
  const resources = mac ? "Contents/Resources" : "";
  const bundle = mac ? `${resources}/main.jsbundle` : undefined;

  return [
    // No Metro dependency: the release runs its embedded JavaScript, compiled to Hermes bytecode, and nothing else.
    check("DIST-HYG-01", () => {
      if (!mac) return [`the Windows bundle layout ${WINDOWS_TODO}`];
      const findings: string[] = [], scripts = files.filter(isScript);
      if (!files.some(entry => entry.rel === bundle)) findings.push(`${bundle} is missing: the app would need a Metro server`);
      for (const entry of scripts) if (!isHermes(entry.abs)) findings.push(`${entry.rel} is not Hermes bytecode`);
      const version = files.some(entry => entry.rel === bundle) && isHermes(path.join(app, bundle!)) ? head(path.join(app, bundle!), 12).readUInt32LE(8) : undefined;
      return { findings, evidence: [`${bundle}: Hermes bytecode version ${version}, ${mb(files.find(entry => entry.rel === bundle)!.size)}`, `${scripts.length} script file(s), all Hermes bytecode`] };
    }),
    // No source maps, as files or as references in the bundles.
    check("DIST-HYG-02", () => {
      const findings = files.filter(entry => /\.map$/.test(entry.rel)).map(entry => `${entry.rel}: source map file`);
      for (const entry of files.filter(isScript)) if (readFileSync(entry.abs).includes("sourceMappingURL")) findings.push(`${entry.rel}: references a source map (sourceMappingURL)`);
      return { findings, evidence: ["no .map files; no sourceMappingURL in any script"] };
    }),
    // No development, build or test leftovers.
    check("DIST-HYG-03", () => {
      const findings = entries.flatMap(entry => {
        const found = STRAY.find(([pattern]) => pattern.test(entry.rel));
        // Report a directory once, not each file under it.
        const parent = path.dirname(entry.rel);
        return found && !STRAY.some(([pattern]) => parent !== "." && pattern.test(parent)) ? [`${entry.rel}: ${found[1]}`] : [];
      });
      return { findings, evidence: [`${entries.length} entries, none a development, build or test leftover`] };
    }),
    // Release binaries: stripped, no debug map or DWARF in the app.
    check("DIST-HYG-04", () => {
      if (!mac) return [`PE stripping and PDB separation ${WINDOWS_TODO}`];
      const findings: string[] = [];
      for (const entry of machO) {
        const stabs = tool("nm", ["-ap", entry.abs]).split("\n").filter(line => / - [0-9a-f]{2} [0-9a-f]{4} +(SO|OSO|SOL|FUN|BNSYM) /.test(line)).length;
        if (stabs) findings.push(`${entry.rel}: ${stabs} debug map entries (not stripped)`);
        if (/segname __DWARF/.test(tool("otool", ["-l", entry.abs]))) findings.push(`${entry.rel}: has a __DWARF segment`);
      }
      return { findings, evidence: [`${machO.length} Mach-O binaries, none with a debug map or DWARF`] };
    }),
    // Debug symbols ship separately: a dSYM outside the app for every Mach-O UUID in it.
    check("DIST-HYG-05", () => {
      if (!mac) return [`PDB symbol files ${WINDOWS_TODO}`];
      if (!options.symbols) return { findings: ["gate.yaml sets no build.macos.symbols folder"], evidence: [] };
      if (!existsSync(options.symbols)) return { findings: [`the symbols folder ${options.symbols} does not exist`], evidence: [] };
      const dwarf = new Set<string>(), dsyms = walk(options.symbols).filter(entry => entry.kind === "file" && /\.dSYM\/Contents\/Resources\/DWARF\//.test(entry.rel));
      for (const entry of dsyms) for (const [, uuid] of tool("dwarfdump", ["--uuid", entry.abs]).matchAll(/^UUID: ([0-9A-F-]{36})/gm)) dwarf.add(uuid!);
      const findings: string[] = [];
      for (const entry of machO) {
        const uuids = [...tool("dwarfdump", ["--uuid", entry.abs]).matchAll(/^UUID: ([0-9A-F-]{36}) \(([^)]+)\)/gm)];
        for (const [, uuid, arch] of uuids) if (!dwarf.has(uuid!)) findings.push(`${entry.rel} (${arch} ${uuid}): no dSYM in ${options.symbols}`);
        if (!uuids.length) findings.push(`${entry.rel}: no LC_UUID, so no dSYM can match it`);
      }
      return { findings, evidence: [`${machO.length} Mach-O binaries matched by ${dsyms.length} dSYM file(s) in ${options.symbols}`] };
    }),
    // No absolute paths of the build machine in any file.
    check("DIST-HYG-06", () => {
      const findings: string[] = [];
      for (const entry of files) {
        const hits = new Set(printable(entry.abs).flatMap(text => text.match(MACHINE_PATHS) ?? []));
        if (hits.size) findings.push(`${entry.rel}: ${hits.size} build-machine path(s), such as ${[...hits].slice(0, 3).join(", ")}`);
      }
      return { findings, evidence: [`${files.length} files, no build-machine paths`] };
    }),
    // No credentials in any file.
    check("DIST-HYG-07", () => {
      const findings: string[] = [];
      for (const entry of files) {
        const text = readFileSync(entry.abs).toString("latin1");
        for (const [pattern, what] of SECRETS) {
          const hits = new Set(text.match(pattern) ?? []);
          // Name the match without printing the secret.
          if (hits.size) findings.push(`${entry.rel}: ${hits.size} ${what}(s), starting ${[...hits].map(hit => `${hit.slice(0, 8)}…`).join(", ")}`);
        }
      }
      return { findings, evidence: [`${files.length} files, no credentials`] };
    }),
    // Info.plist: the keys a macOS release needs, with release values.
    check("DIST-HYG-08", () => {
      if (!mac) return [`the Windows app manifest and version resources ${WINDOWS_TODO}`];
      const info = JSON.parse(tool("plutil", ["-convert", "json", "-o", "-", path.join(app, "Contents/Info.plist")])) as Record<string, unknown>;
      const findings: string[] = [];
      const expect = (key: string, ok: (value: unknown) => boolean, want: string) => { if (!ok(info[key])) findings.push(`${key} is ${JSON.stringify(info[key]) ?? "missing"}; expected ${want}`); };
      const nonEmpty = (value: unknown) => typeof value === "string" && value.trim() !== "";
      expect("CFBundleIdentifier", value => value === options.appId, options.appId);
      expect("CFBundlePackageType", value => value === "APPL", "APPL");
      expect("CFBundleInfoDictionaryVersion", value => value === "6.0", "6.0");
      expect("CFBundleName", nonEmpty, "a name");
      expect("CFBundleExecutable", value => typeof value === "string" && files.some(entry => entry.rel === `Contents/MacOS/${value}`), "an executable in Contents/MacOS");
      expect("CFBundleShortVersionString", value => typeof value === "string" && /^\d+(\.\d+){0,2}$/.test(value), "a version such as 1.2.3");
      expect("CFBundleVersion", value => typeof value === "string" && /^\d+(\.\d+){0,2}$/.test(value), "a build number such as 42 or 1.2.3");
      expect("LSMinimumSystemVersion", value => typeof value === "string" && Number(value.split(".")[0]) <= 14, "14.0 or earlier (the oldest gate target is macOS 14)");
      expect("NSPrincipalClass", value => value === "NSApplication", "NSApplication");
      const ats = (info.NSAppTransportSecurity ?? {}) as Record<string, unknown>;
      if (ats.NSAllowsArbitraryLoads === true) findings.push("NSAppTransportSecurity.NSAllowsArbitraryLoads is true: release builds keep App Transport Security on");
      const exceptions = Object.keys((ats.NSExceptionDomains ?? {}) as object).filter(domain => /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(domain));
      if (exceptions.length) findings.push(`NSAppTransportSecurity exempts ${exceptions.join(", ")}: that is for a development server`);
      return { findings, evidence: [`${info.CFBundleIdentifier} ${info.CFBundleShortVersionString} (${info.CFBundleVersion}), minimum macOS ${info.LSMinimumSystemVersion}`] };
    }),
    // The artifact fits its size budget.
    check("DIST-HYG-09", () => {
      const total = files.reduce((sum, entry) => sum + entry.size, 0);
      const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 5).map(entry => `${entry.rel} ${mb(entry.size)}`);
      if (options.sizeBudgetMB === undefined) return { findings: [`gate.yaml sets no build.${platform}.sizeBudgetMB; the artifact is ${mb(total)}`], evidence: [] };
      const over = total > options.sizeBudgetMB * 1e6;
      return { findings: over ? [`${mb(total)} is over the ${options.sizeBudgetMB} MB budget; largest: ${largest.join(", ")}`] : [], evidence: [`${mb(total)} of ${options.sizeBudgetMB} MB; largest: ${largest.join(", ")}`] };
    }),
    // Third-party license notices for what the app bundles.
    check("DIST-HYG-10", () => {
      if (!mac) return [`license notices for the Windows build ${WINDOWS_TODO}`];
      const file = path.join(app, resources, NOTICES_FILE);
      if (!existsSync(file)) return { findings: [`${path.posix.join(resources, NOTICES_FILE)} is missing`], evidence: [] };
      return noticesFindings(readFileSync(file, "utf8"), machO.map(entry => entry.rel));
    }),
  ];
}

/**
 * The notices name each bundled package with its license, and every embedded framework is among them. Packages are
 * `## <name> <version>` sections (packages/cli/src/notices.ts writes them) followed by `License: <id>` and the license text.
 */
export function noticesFindings(text: string, binaries: string[]): { findings: string[]; evidence: string[] } {
  const sections = text.split(/^## /m).slice(1).map(section => ({ title: section.split("\n")[0]!, body: section }));
  const findings = sections.filter(section => !/^License: \S/m.test(section.body) || /^License: UNKNOWN$/m.test(section.body)).map(section => `${section.title}: no license`);
  if (!sections.length) findings.push("lists no packages");
  const names = sections.map(section => section.title.split(" ")[0]!.toLowerCase());
  for (const framework of new Set(binaries.flatMap(binary => binary.match(/Contents\/Frameworks\/([^/]+)\.framework\//)?.[1] ?? []))) {
    if (!names.some(name => name === framework.toLowerCase() || name.startsWith(`${framework.toLowerCase()}-`))) findings.push(`the embedded ${framework}.framework is not in the notices`);
  }
  return { findings, evidence: [`${sections.length} packages, each with a license`] };
}

/** The gate audit steps by the name a check registers with `audit:`. */
export const AUDIT_STEPS: Readonly<Record<Audit, (options: AuditOptions) => AuditResult[]>> = { bundle: auditBundle };
