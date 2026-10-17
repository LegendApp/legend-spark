// The gate's templates audit (docs/e2e-flows.md#audits, #171): `spark create` from the packed SDK, headless, in a
// scratch directory, then two clean release builds of the macOS template compared file by file. Everything runs with
// CI=1, no TTY and no stdin, as on a CI runner, with a scratch SPARK_HOME, so the developer's registered SDKs and
// runners are untouched. The built apps are unregistered from LaunchServices and the scratch directory is removed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson, stateFile } from "../../../packages/cli/src/project.ts";
import { isMachO, type AuditResult } from "./bundle.ts";

const repo = path.resolve(import.meta.dirname, "../../..");
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
/** The templates `spark create` offers, by the flag that selects each. */
const TEMPLATES: Array<[name: string, flags: string[]]> = [["DxMac", ["--platform", "macos"]], ["DxWindows", ["--platform", "windows"]], ["DxUniversal", ["--universal"]]];
export const TEMPLATE_CHECKS = ["DX-TPL-01", "DX-TPL-02", "DX-REPRO-01", "DX-REPRO-02"] as const;

class StepError extends Error {}

/** Every file and link in an app bundle, by its path inside the bundle: a SHA-256 of a file's bytes, a link's target. */
function digests(app: string, rel = ""): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(path.join(app, rel), { withFileTypes: true })) {
    const name = path.join(rel, entry.name), abs = path.join(app, name);
    if (entry.isSymbolicLink()) files.set(name, `-> ${readlinkSync(abs)}`);
    else if (entry.isDirectory()) for (const [key, value] of digests(app, name)) files.set(key, value);
    else files.set(name, createHash("sha256").update(readFileSync(abs)).digest("hex"));
  }
  return files;
}

const isScript = (name: string) => /\.(jsbundle|hbc|js)$/.test(name);
const output = (argv: string[]) => spawnSync(argv[0]!, argv.slice(1), { encoding: "utf8", maxBuffer: 1 << 28 }).stdout;
/** A Mach-O file's load commands apart from LC_UUID, and its symbols. */
const machOShape = (file: string) => [output(["otool", "-l", file]).split("\n").slice(1).filter(line => !/^\s*uuid /.test(line)).join("\n"), output(["nm", "-m", file])].join("\n");
/** An asset catalog's renditions without what actool makes unique per build: its timestamp, rendition names' unique suffixes and digests. */
const catalogShape = (file: string) => output(["xcrun", "assetutil", "--info", file]).replace(/"Timestamp" : \d+/g, "").replace(/_[0-9A-F]{8}-[0-9A-F-]{27}-\d+-[0-9A-F]+\.png/g, ".png").replace(/"SHA1Digest" : "\w+"/g, "");
/**
 * A compiled nib (NIBArchive) as the sorted list of its objects: each its class and its values, with a reference to
 * another object written as that object's class. The same objects archived in another order have the same list.
 */
function nibShape(file: string): string {
  const data = readFileSync(file);
  if (data.subarray(0, 10).toString("latin1") !== "NIBArchive") return data.toString("hex");
  const header = Array.from({ length: 8 }, (_, index) => data.readUInt32LE(18 + index * 4));
  let at = 0;
  const varint = () => { let value = 0, shift = 0, byte; do { byte = data[at++]!; value |= (byte & 0x7f) << shift; shift += 7; } while (!(byte & 0x80)); return value; };
  const list = <T>(count: number, offset: number, read: () => T) => { at = offset; return Array.from({ length: count }, read); };
  const objects = list(header[0]!, header[1]!, () => ({ type: varint(), start: varint(), count: varint() }));
  const keys = list(header[2]!, header[3]!, () => { const length = varint(); return data.subarray(at, (at += length)).toString("latin1"); });
  const SIZES: Record<number, number> = { 0: 1, 1: 2, 2: 4, 3: 8, 4: 0, 5: 0, 6: 4, 7: 8, 9: 0, 10: 4 };
  const values = list(header[4]!, header[5]!, () => {
    const key = keys[varint()]!, type = data[at++]!;
    const length = type === 8 ? varint() : SIZES[type] ?? 0;
    return { key, type, bytes: data.subarray(at, (at += length)) };
  });
  const classes = list(header[6]!, header[7]!, () => { const length = varint(), extra = varint(); at += extra * 4; return data.subarray(at, (at += length)).toString("latin1"); });
  const value = ({ key, type, bytes }: typeof values[number]) => `${key}=${type === 10 ? `@${classes[objects[bytes.readUInt32LE(0)]!.type]}` : `${type}:${bytes.toString("hex")}`}`;
  return objects.map(object => `${classes[object.type]}{${values.slice(object.start, object.start + object.count).map(value).sort().join(",")}}`).sort().join("\n");
}
/**
 * Files Apple's tools do not write reproducibly (docs/e2e-flows.md#reproducible-builds), and what of them must still match:
 * a difference anywhere else, or in what these compare, fails.
 */
const KNOWN: Array<{ match: (name: string, abs: string) => boolean; why: string; shape: (file: string) => string }> = [
  { match: (name, abs) => !name.includes("/_CodeSignature/") && isMachO({ rel: name, abs, size: statSync(abs).size, kind: "file" }), why: "the linker orders some symbol pointers differently, so LC_UUID and the code signature differ; load commands and symbols match", shape: machOShape },
  { match: name => name.endsWith(".car"), why: "actool stamps the build time and unique rendition names; the renditions match", shape: catalogShape },
  { match: name => name.endsWith(".nib"), why: "ibtool archives the same objects in another order; the objects and their values match", shape: nibShape },
  { match: name => name.endsWith("_CodeSignature/CodeResources"), why: "it seals the files above", shape: () => "" },
];

/** DX-REPRO-01 and DX-REPRO-02 for two release builds of the same app. */
export function compareBuilds(first: string, second: string): AuditResult[] {
  const [a, b] = [digests(first), digests(second)];
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  const differing = names.filter(name => a.get(name) !== b.get(name));
  const scripts = names.filter(isScript), jsDiffs = differing.filter(isScript);
  const native: string[] = [], unexplained: string[] = [];
  for (const name of differing.filter(name => !isScript(name))) {
    const [left, right] = [path.join(first, name), path.join(second, name)];
    const known = a.has(name) && b.has(name) && !a.get(name)!.startsWith("-> ") ? KNOWN.find(entry => entry.match(name, left)) : undefined;
    if (known && known.shape(left) === known.shape(right)) native.push(`${name}: ${known.why}`);
    else unexplained.push(`${name}: ${!a.has(name) ? "only in the second build" : !b.has(name) ? "only in the first build" : known ? `differs beyond what ${known.why.split(";")[0]} explains` : "differs"}`);
  }
  return [
    { check: "DX-REPRO-01", status: jsDiffs.length || !scripts.length ? "failed" : "passed", details: jsDiffs.length ? jsDiffs.map(name => `${name} differs between two clean release builds`)
      : scripts.length ? [`${scripts.join(", ")}: byte-identical across two clean release builds`] : ["no JavaScript in the release build"] },
    { check: "DX-REPRO-02", status: unexplained.length ? "failed" : "passed", details: [`${names.length - differing.length} of ${names.length} files and links are byte-identical across two clean release builds`, ...unexplained, ...native] },
  ];
}

export async function auditTemplates(): Promise<AuditResult[]> {
  const results = new Map<string, AuditResult>();
  const set = (check: string, status: AuditResult["status"], details: string[]) => results.set(check, { check, status, details });
  const scratch = mkdtempSync(path.join(os.tmpdir(), "spark-templates-audit-"));
  const env = { ...process.env, CI: "1", SPARK_HOME: path.join(scratch, ".spark-home") };
  const step = (label: string, argv: string[], cwd: string) => {
    const log = path.join(scratch, `${label.replace(/\W+/g, "-")}.log`), fd = openSync(log, "w");
    const started = Date.now();
    try {
      const result = spawnSync(argv[0]!, argv.slice(1), { cwd, env, stdio: ["ignore", fd, fd] });
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      if (result.status !== 0) throw new StepError(`${label} exited ${result.status ?? result.signal} after ${seconds} s:\n${readFileSync(log, "utf8").trim().split("\n").slice(-15).join("\n")}`);
      return seconds;
    } finally { closeSync(fd); }
  };
  const spark = (app: string, label: string, args: string[]) => step(label, ["node", path.join(app, "node_modules/@legendapp/spark/bin/spark.cjs"), ...args], app);
  try {
    const timings: string[] = [`pack ${step("spark sdk pack", [process.execPath, path.join(repo, "scripts/pack.ts")], repo)} s`];
    const manifest = path.join(repo, "artifacts/packages/manifest.json");
    // DX-TPL-01: each template from the packed SDK, through the SDK's own `spark` bin in a scratch directory.
    const sdkBin = path.join(repo, "packages/desktop/bin/spark.cjs");
    for (const [name, flags] of TEMPLATES) {
      const app = path.join(scratch, name);
      timings.push(`create ${name} ${step(`spark create ${name}`, ["node", sdkBin, "create", app, "--packages", manifest, ...flags], scratch)} s`);
      const config = JSON.parse(readFileSync(path.join(app, "desktop.config.json"), "utf8"));
      const dependency = JSON.parse(readFileSync(path.join(app, "package.json"), "utf8")).dependencies["@legendapp/spark"] as string;
      if (!dependency.includes(path.join(repo, "artifacts/packages"))) throw new StepError(`${name} depends on @legendapp/spark ${dependency}, not the packed SDK`);
      if (config.name !== name) throw new StepError(`${name}: desktop.config.json names the app ${config.name}`);
      timings.push(`typecheck ${name} ${step(`tsc ${name}`, ["node", "node_modules/typescript/bin/tsc", "--noEmit"], app)} s`);
    }
    set("DX-TPL-01", "passed", [`spark create made ${TEMPLATES.map(([name, flags]) => `${name} (${flags.join(" ")})`).join(", ")} from the packed SDK (${path.relative(repo, manifest)}), installed and type-checked, headless`, timings.join(", ")]);

    // DX-TPL-02 and the reproducibility checks: two clean release builds of the macOS template.
    // `spark build` prepares the project in place (it patches node_modules and writes the native project and
    // configuration), so each build starts from a clone of the project as `spark create` left it, at the same path.
    const app = path.join(scratch, "DxMac"), pristine = path.join(scratch, "DxMac.pristine");
    step("clone the project", ["cp", "-c", "-R", app, pristine], scratch);
    const builds: string[] = [];
    for (const run of [1, 2]) {
      if (run === 2) {
        rmSync(app, { recursive: true, force: true });
        renameSync(pristine, app);
      }
      const seconds = spark(app, `spark build ${run}`, ["build"]);
      const product = readJson(stateFile(app, "release-build.json")).app as string;
      if (!existsSync(path.join(product, "Contents/Info.plist"))) throw new StepError(`spark build ${run} finished without ${product}`);
      const copy = path.join(scratch, `release-${run}`, path.basename(product));
      mkdirSync(path.dirname(copy), { recursive: true });
      cpSync(product, copy, { recursive: true, verbatimSymlinks: true });
      builds.push(copy);
      if (run === 1) {
        const bundle = path.join(copy, "Contents/Resources/main.jsbundle");
        const hermes = existsSync(bundle) && readFileSync(bundle).subarray(0, 8).equals(HERMES_MAGIC);
        const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", copy], { encoding: "utf8" });
        if (!hermes || verify.status !== 0) throw new StepError(`the release build ${!hermes ? "has no Hermes bytecode main.jsbundle" : `fails codesign --verify: ${verify.stderr.trim()}`}`);
        set("DX-TPL-02", "passed", [`spark build of the macOS template made DxMac.app headless in ${seconds} s (clean): Hermes bytecode main.jsbundle, codesign --verify --deep --strict accepts it`]);
      }
    }
    for (const result of compareBuilds(builds[0]!, builds[1]!)) results.set(result.check, result);
  } catch (error) {
    const message = error instanceof StepError ? error.message : String(error instanceof Error ? error.stack : error);
    for (const check of TEMPLATE_CHECKS) if (!results.has(check)) set(check, "failed", [message]);
  } finally {
    // Xcode registers what it builds with LaunchServices: unregister every app under the scratch directory.
    const registered = () => [...spawnSync(LSREGISTER, ["-dump"], { encoding: "utf8", maxBuffer: 1 << 30 }).stdout.matchAll(/^path:\s+(.+?\.app)\b/gm)]
      .map(match => match[1]!).filter(app => app.startsWith(`${realpathSync(scratch)}/`));
    for (const app of new Set(registered())) spawnSync(LSREGISTER, ["-u", app]);
    const left = [...new Set(registered())];
    if (left.length) for (const check of TEMPLATE_CHECKS) {
      const result = results.get(check);
      if (result) results.set(check, { check, status: "failed", details: [...result.details, `still registered with LaunchServices: ${left.join(", ")}`] });
    }
    rmSync(scratch, { recursive: true, force: true });
  }
  return TEMPLATE_CHECKS.map(check => results.get(check)!);
}
