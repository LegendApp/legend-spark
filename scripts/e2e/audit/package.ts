// The gate's package audit: the `spark package` output as a person downloads it (docs/e2e-flows.md#audits, #151).
// It extracts the distribution ZIP and checks its layout, the dSYMs archive next to it, versions, architectures, the
// Sparkle feed, and, by installing it as a quarantined download, its signature, notarization and quarantine. It mounts
// the DMG next to it read-only and checks its layout, that its app is the ZIP's, and its signature and notarization.
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { artifactHash } from "../../../packages/cli/src/package.ts";
import { compareBuildNumbers, verifyUpdateSignature } from "../../../packages/cli/src/updates.ts";
import { describeSignature, detach, install, judgeSignature, sh, verify, type Sh } from "../../harness/install.ts";
import { check, dsymFindings, isMachO, tool, walk, type AuditOptions, type AuditResult } from "./bundle.ts";

export const PACKAGE_CHECKS = ["DIST-PKG-01", "DIST-PKG-02", "DIST-PKG-03", "DIST-PKG-04", "DIST-PKG-05", "DIST-PKG-06", "DIST-PKG-07", "DIST-PKG-08", "DIST-PKG-09"] as const;
/** Mach-O architecture names of the gate's target arches. */
const MACHO_ARCH = { arm64: "arm64", x64: "x86_64" } as const;
type Info = Record<string, unknown>;
type Outcome = { findings: string[]; evidence: string[] };

const plist = (file: string): Info => JSON.parse(tool("plutil", ["-convert", "json", "-o", "-", file])) as Info;
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const versionParts = (version: string) => version.split(".").map(Number);
/** Compares dotted OS versions such as 14.0 and 11. */
const compareVersions = (a: string, b: string) => {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let index = 0; index < Math.max(x.length, y.length); index++) if ((x[index] ?? 0) !== (y[index] ?? 0)) return (x[index] ?? 0) - (y[index] ?? 0);
  return 0;
};

/** The distribution ZIP: `location` itself, or the one `<name>-<version>-<arch>.zip` in that folder. */
function distributionZip(location: string, arch: string): string {
  if (location.endsWith(".zip")) {
    if (!existsSync(location)) throw new Error(`${location} does not exist`);
    return location;
  }
  if (!existsSync(location)) throw new Error(`the package folder ${location} does not exist; run spark package`);
  const zips = readdirSync(location).filter(name => name.endsWith(`-${arch}.zip`));
  if (zips.length !== 1) throw new Error(`${location} must hold one distribution ZIP named <name>-<version>-${arch}.zip; found ${zips.length ? zips.join(", ") : "none"}`);
  return path.join(location, zips[0]!);
}

/** Extended attribute names a ZIP stores in AppleDouble entries (`__MACOSX/…` or `._<name>`), and how many entries there are. */
function storedAttributes(zip: string): { entries: number; names: string[] } {
  const entries = tool("zipinfo", ["-1", zip]).split("\n").filter(name => /(^|\/)(__MACOSX\/.*[^/]|\._[^/]+)$/.test(name));
  if (!entries.length) return { entries: 0, names: [] };
  const sequestered = entries.some(name => name.startsWith("__MACOSX/")), inline = entries.some(name => !name.startsWith("__MACOSX/"));
  const data = tool("unzip", ["-p", zip, ...(sequestered ? ["__MACOSX/*"] : []), ...(inline ? ["*._*"] : [])]);
  return { entries: entries.length, names: [...new Set(data.match(/[A-Za-z][\w-]*(\.[\w-]+)+(?=\0)/g) ?? [])].sort() };
}

/** The `minos` of each LC_BUILD_VERSION or LC_VERSION_MIN_MACOSX of one architecture's slice. */
function minimumOS(file: string, arch: string): string | undefined {
  const commands = tool("otool", ["-arch", arch, "-l", file]);
  return /\n\s*minos (\S+)/.exec(commands)?.[1] ?? /cmd LC_VERSION_MIN_MACOSX\n.*\n\s*version (\S+)/.exec(commands)?.[1];
}

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1]?.trim();
const attributes = (element: string) => Object.fromEntries([...element.matchAll(/([\w:]+)="([^"]*)"/g)].map(([, key, value]) => [key!, value!]));

/**
 * The Sparkle update of this package: `dir/updates/` holds the signed feed of the app's SUFeedURL, whose newest item is
 * this build, with the same versions and minimum macOS, and whose archive is this ZIP, signed with SUPublicEDKey.
 * `packages/cli/src/updates.ts` writes it; an app without SUFeedURL does not update and has no feed.
 */
export function appcastFindings(info: Info, zip: string, arch: "arm64" | "x64"): Outcome {
  const feedURL = info.SUFeedURL;
  if (feedURL === undefined) return { findings: [], evidence: ["the app has no SUFeedURL: it does not update through Sparkle, so the package has no feed"] };
  const findings: string[] = [], key = info.SUPublicEDKey;
  if (typeof feedURL !== "string" || !URL.canParse(feedURL) || new URL(feedURL).protocol !== "https:") return { findings: [`SUFeedURL ${JSON.stringify(feedURL)} is not an HTTPS URL`], evidence: [] };
  if (typeof key !== "string" || Buffer.from(key, "base64").length !== 32) return { findings: [`SUPublicEDKey ${JSON.stringify(key)} is not a base64 Ed25519 public key`], evidence: [] };
  if (info.SURequireSignedFeed !== true) findings.push("SURequireSignedFeed is not true: Sparkle would accept an unsigned feed");
  const updates = path.join(path.dirname(zip), "updates"), feed = path.join(updates, path.basename(new URL(feedURL).pathname));
  if (!existsSync(feed)) return { findings: [...findings, `${feed} is missing: SUFeedURL names it, and spark package writes it`], evidence: [] };
  const bytes = readFileSync(feed), text = bytes.toString("utf8");
  const signed = /<!-- sparkle-signatures:\nedSignature: (\S+)\nlength: (\d+)\n-->\s*$/.exec(text);
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(key, "base64")]), format: "der", type: "spki" });
  if (!signed) findings.push(`${path.basename(feed)} is not signed (no sparkle-signatures block)`);
  else if (!verifySignature(null, bytes.subarray(0, Number(signed[2])), publicKey, Buffer.from(signed[1]!, "base64"))) findings.push(`${path.basename(feed)}: its signature does not verify with SUPublicEDKey`);
  const build = String(info.CFBundleVersion), items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => match[1]!);
  const item = items.find(candidate => tag(candidate, "sparkle:version") === build);
  if (!item) return { findings: [...findings, `${path.basename(feed)} has no item for build ${build}`], evidence: [] };
  const newest = items.map(candidate => tag(candidate, "sparkle:version") ?? "0").sort(compareBuildNumbers).at(-1)!;
  if (newest !== build) findings.push(`build ${build} is not the newest item; ${newest} is`);
  const expect = (name: string, value: unknown) => { if (tag(item, name) !== value) findings.push(`the item's ${name} is ${tag(item, name) ?? "missing"}; Info.plist says ${value}`); };
  expect("sparkle:shortVersionString", info.CFBundleShortVersionString);
  expect("sparkle:minimumSystemVersion", info.LSMinimumSystemVersion);
  if (arch === "arm64" && !tag(item, "sparkle:hardwareRequirements")?.split(/[\s,]+/).includes("arm64")) findings.push("the arm64-only item has no sparkle:hardwareRequirements arm64, so Intel Macs would download it");
  const prefix = new URL(".", feedURL).href;
  const enclosures = [...item.matchAll(/<enclosure\b[^>]*>/g)].map(match => attributes(match[0]));
  if (!enclosures.length) findings.push(`the item for build ${build} has no enclosure`);
  for (const enclosure of enclosures) {
    const url = enclosure.url ?? "", name = url.startsWith(prefix) ? url.slice(prefix.length) : undefined;
    if (!name || name.includes("/")) { findings.push(`enclosure ${url} is not next to the feed (${prefix})`); continue; }
    const file = path.join(updates, name);
    if (!existsSync(file)) { findings.push(`enclosure ${name} is missing from ${updates}`); continue; }
    if (Number(enclosure.length) !== statSync(file).size) findings.push(`enclosure ${name}: length ${enclosure.length}, the file has ${statSync(file).size} bytes`);
    try { verifyUpdateSignature(file, enclosure["sparkle:edSignature"] ?? "", key); } catch (error) { findings.push(`enclosure ${name}: ${(error as Error).message}`); }
    // The full update (not a delta) is the package itself.
    if (!enclosure["sparkle:deltaFrom"] && sha256(file) !== sha256(zip)) findings.push(`enclosure ${name} is not the same bytes as ${path.basename(zip)}`);
  }
  return { findings, evidence: [`${path.basename(feed)} is signed; build ${build} (${info.CFBundleShortVersionString}) is the newest of ${items.length} item(s); ${enclosures.length} enclosure(s) signed, and the update is ${path.basename(zip)}`] };
}

/** Compressed, read-only disk image formats (zlib, bzip2, LZFSE, LZMA). */
const COMPRESSED_READ_ONLY = ["UDZO", "UDBZ", "ULFO", "ULMO"];

/**
 * The DMG next to the ZIP, mounted read-only and without Finder (`-nobrowse`) at a temporary mountpoint and always
 * detached: its layout must be exactly `app` (the ZIP's app, the same files, its signature valid there) and an
 * `/Applications` link, in a compressed read-only image that stores no extended attributes.
 */
async function dmgLayout(dmg: string, app: string, run: Sh): Promise<Outcome> {
  const findings: string[] = [], name = path.basename(app);
  const format = /<key>Format<\/key>\s*<string>([^<]*)<\/string>/.exec(tool("hdiutil", ["imageinfo", "-plist", dmg]))?.[1];
  if (!COMPRESSED_READ_ONLY.includes(format ?? "")) findings.push(`${path.basename(dmg)} is a ${format ?? "unknown"} image, not a compressed read-only one (${COMPRESSED_READ_ONLY.join(", ")})`);
  // Outside the audit's work folder, which is deleted: a volume that will not detach stays mounted there, read-only.
  const volume = mkdtempSync(path.join(os.tmpdir(), "spark-package-dmg-"));
  const attach = await run(["hdiutil", "attach", dmg, "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", volume]);
  if (attach.code) {
    rmSync(volume, { recursive: true });
    return { findings: [...findings, `hdiutil attach ${path.basename(dmg)} exited ${attach.code}: ${(attach.stderr || attach.stdout).trim()}`], evidence: [] };
  }
  try {
    const entries = readdirSync(volume).sort(), link = path.join(volume, "Applications");
    if (entries.join() !== [name, "Applications"].sort().join()) findings.push(`${path.basename(dmg)} holds ${entries.join(", ") || "nothing"}; it must hold exactly ${name} and an Applications link`);
    if (entries.includes("Applications") && !(lstatSync(link).isSymbolicLink() && readlinkSync(link) === "/Applications")) findings.push("its Applications entry is not a link to /Applications");
    if (entries.includes(name) && artifactHash(path.join(volume, name)) !== artifactHash(app)) findings.push(`its ${name} is not the ZIP's: their files, modes or links differ`);
    if (entries.includes(name)) {
      const strict = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=1", path.join(volume, name)], { encoding: "utf8" });
      if (strict.status !== 0) findings.push(`codesign --verify --deep --strict rejects its ${name}: ${strict.stderr.trim()}`);
    }
    // HFS+ stores a symbolic link's type in its Finder info; any other attribute came from the build machine.
    const attributes = [...new Set(tool("xattr", ["-r", "-s", volume]).split("\n").filter(Boolean).map(line => [line.slice(0, line.lastIndexOf(": ")), line.slice(line.lastIndexOf(": ") + 2)] as const)
      .filter(([file, attribute]) => !(attribute === "com.apple.FinderInfo" && lstatSync(file).isSymbolicLink())).map(([, attribute]) => attribute))].sort();
    if (attributes.length) findings.push(`${path.basename(dmg)} stores extended attributes of the build machine (${attributes.join(", ")})`);
  } finally {
    const stuck = await detach(volume, run).catch((error: Error) => `hdiutil detach ${volume} failed: ${error.message}`);
    if (stuck) findings.push(stuck);
    else rmSync(volume, { recursive: true });
  }
  return { findings, evidence: [`${path.basename(dmg)} (${format}, mounted read-only) holds exactly ${name}, the same files as the ZIP's, whose signature codesign --verify --deep --strict accepts, and an Applications link to /Applications; no extended attributes`] };
}

/** The DMG's own Developer ID signature (with the app's team and a secure timestamp), stapled ticket and Gatekeeper's verdict on opening it. */
async function dmgSignature(dmg: string, team: string | undefined, run: Sh): Promise<Outcome> {
  const findings: string[] = [], file = path.basename(dmg);
  const strict = await run(["codesign", "--verify", "--strict", "--verbose=2", dmg]);
  if (strict.code) findings.push(`codesign --verify --strict rejects ${file}: ${(strict.stderr || strict.stdout).trim()}`);
  const details = (await run(["codesign", "-dvvv", dmg])).stderr;
  const authority = /^Authority=(.*)$/m.exec(details)?.[1], teamId = /^TeamIdentifier=(.*)$/m.exec(details)?.[1];
  if (!authority?.startsWith("Developer ID Application: ")) findings.push(`${file} is ${authority ? `signed by ${authority}` : /^Signature=adhoc$/m.test(details) ? "signed ad-hoc" : "not signed"}; a release DMG needs a Developer ID Application signature`);
  else {
    if (team && teamId !== team) findings.push(`${file} is signed by team ${teamId}; the app by ${team}`);
    if (!/^Timestamp=/m.test(details)) findings.push(`${file}'s signature has no secure timestamp`);
  }
  const staple = await run(["xcrun", "stapler", "validate", dmg]);
  if (staple.code) findings.push(`${file} has no valid stapled notarization ticket: ${(staple.stdout + staple.stderr).trim()}`);
  const assess = await run(["spctl", "--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", dmg]);
  const verdict = (assess.stderr + assess.stdout).trim(), source = /^source=(.*)$/m.exec(verdict)?.[1];
  if (assess.code || source !== "Notarized Developer ID") findings.push(`Gatekeeper ${assess.code ? "rejects" : "accepts"} opening ${file}${source ? ` (source=${source})` : ""}; a release DMG must be notarized: ${verdict}`);
  return { findings, evidence: [`${file}: ${authority}, timestamped; notarization ticket stapled; Gatekeeper accepts opening it (${source})`] };
}

/** Every check of the package audit. `run` runs the harness's install and signature tools (tests pass a double). */
export async function auditPackage(options: AuditOptions, run: Sh = sh): Promise<AuditResult[]> {
  const all = (status: AuditResult["status"], details: string[]) => PACKAGE_CHECKS.map(id => ({ check: id, status, details }));
  if (options.platform !== "macos") return all("unsupported", ["Spark has no Windows release package yet (#51)"]);
  if (!options.package) return all("failed", ["gate.yaml sets no build.macos.package"]);
  const arch = options.arch ?? "arm64", machoArch = MACHO_ARCH[arch];
  let zip: string;
  try { zip = distributionZip(options.package, arch); } catch (error) { return all("failed", [(error as Error).message]); }
  const base = path.basename(zip, ".zip"), work = mkdtempSync(path.join(os.tmpdir(), "spark-package-audit-"));
  try {
    const extracted = path.join(work, "extracted");
    mkdirSync(extracted);
    tool("ditto", ["-x", "-k", zip, extracted]);
    const top = readdirSync(extracted);
    if (top.length !== 1 || !top[0]!.endsWith(".app")) return all("failed", [`${path.basename(zip)} must hold exactly one .app; it holds ${top.join(", ") || "nothing"}`]);
    const app = path.join(extracted, top[0]!), info = plist(path.join(app, "Contents/Info.plist"));
    const machO = walk(app).filter(isMachO);
    // One quarantined install, as a person downloads it, for the signature and quarantine checks.
    const installed = await install(zip, path.join(work, "install"), run, []).catch((error: Error) => error);
    const verification = installed instanceof Error ? installed : await verify(installed.app, run);
    const dmg = path.join(path.dirname(zip), `${base}.dmg`);
    const missing = { findings: [`${path.basename(dmg)} is missing next to ${path.basename(zip)}; spark package writes it`], evidence: [] };
    const [layout, signature] = existsSync(dmg)
      ? [await dmgLayout(dmg, app, run).catch((error: Error) => ({ findings: [error.message], evidence: [] })), await dmgSignature(dmg, verification instanceof Error ? undefined : verification.teamId, run)]
      : [missing, missing];

    return [
      // Layout and naming: <name>-<version>-<arch>.zip holding only the app, no stored extended attributes, signature intact.
      check("DIST-PKG-01", () => {
        const findings: string[] = [], stored = storedAttributes(zip);
        if (!/^[A-Za-z0-9._-]+-\d+(\.\d+){0,2}-(arm64|x64)$/.test(base)) findings.push(`${path.basename(zip)} is not named <name>-<version>-<arch>.zip`);
        if (stored.entries) findings.push(`${path.basename(zip)} stores extended attributes of the build machine in ${stored.entries} AppleDouble entries (${stored.names.join(", ")}); archive with ditto --norsrc`);
        const strict = tool("codesign", ["--verify", "--deep", "--strict", "--verbose=1", app]);
        return { findings, evidence: [`${path.basename(zip)} holds only ${top[0]}, no extended attributes; codesign --verify --deep --strict accepts the extracted app${strict.trim() ? `: ${strict.trim()}` : ""}`] };
      }),
      // The dSYMs archive next to the package covers every binary in it.
      check("DIST-PKG-02", () => {
        const archive = path.join(path.dirname(zip), `${base}-dSYMs.zip`), symbols = path.join(work, "dSYMs");
        if (!existsSync(archive)) return { findings: [`${path.basename(archive)} is missing next to ${path.basename(zip)}: the release's crash reports could not be symbolicated`], evidence: [] };
        mkdirSync(symbols);
        tool("ditto", ["-x", "-k", archive, symbols]);
        const outcome = dsymFindings(machO.map(entry => ({ ...entry, rel: `${top[0]}/${entry.rel}` })), symbols);
        return { findings: outcome.findings.map(finding => finding.replace(symbols, path.basename(archive))), evidence: outcome.evidence.map(line => line.replace(symbols, path.basename(archive))) };
      }),
      // One version everywhere: the package name, the packaged Info.plist, and the release build the gate tests.
      check("DIST-PKG-03", () => {
        const findings: string[] = [], version = /-(\d+(?:\.\d+){0,2})-(?:arm64|x64)$/.exec(base)?.[1];
        if (info.CFBundleIdentifier !== options.appId) findings.push(`CFBundleIdentifier is ${info.CFBundleIdentifier}; the gate tests ${options.appId}`);
        if (version !== info.CFBundleShortVersionString) findings.push(`${path.basename(zip)} names version ${version}; the app's CFBundleShortVersionString is ${info.CFBundleShortVersionString}`);
        if (!existsSync(options.app)) findings.push(`the release build ${options.app} does not exist to compare with`);
        else {
          const build = plist(path.join(options.app, "Contents/Info.plist"));
          for (const key of ["CFBundleShortVersionString", "CFBundleVersion"]) if (build[key] !== info[key]) findings.push(`${key} is ${info[key]} in the package and ${build[key]} in the release build`);
          const runtime = (app: string) => JSON.parse(readFileSync(path.join(app, "Contents/Resources/spark-runtime.json"), "utf8")) as Info;
          const [packaged, built] = [runtime(app), runtime(options.app)];
          for (const key of ["fingerprint", "sourceRevision"]) if (packaged[key] !== built[key]) findings.push(`spark-runtime.json ${key} is ${packaged[key]} in the package and ${built[key]} in the release build: the package is another build`);
        }
        return { findings, evidence: [`${info.CFBundleIdentifier} ${info.CFBundleShortVersionString} (${info.CFBundleVersion}) in the name, the package and the release build`] };
      }),
      // A thin package for the target's architecture whose binaries all run on its minimum macOS.
      check("DIST-PKG-04", () => {
        const findings: string[] = [], universal: string[] = [], minimum = String(info.LSMinimumSystemVersion);
        if (!base.endsWith(`-${arch}`)) findings.push(`${path.basename(zip)} is not named for the target's ${arch}`);
        const executable = `Contents/MacOS/${info.CFBundleExecutable}`;
        let highest = "0";
        for (const entry of machO) {
          const archs = tool("lipo", ["-archs", entry.abs]).trim().split(/\s+/);
          if (!archs.includes(machoArch)) { findings.push(`${entry.rel} has no ${machoArch} code (${archs.join(" ")})`); continue; }
          if (entry.rel === executable && archs.length !== 1) findings.push(`${entry.rel} is ${archs.join(" ")}; the ${arch} package's executable has only ${machoArch}`);
          if (archs.length > 1) universal.push(entry.rel);
          const minos = minimumOS(entry.abs, machoArch);
          if (!minos) findings.push(`${entry.rel} records no minimum macOS`);
          else if (compareVersions(minos, minimum) > 0) findings.push(`${entry.rel} needs macOS ${minos}; LSMinimumSystemVersion is ${minimum}, so it would fail to load there`);
          else if (compareVersions(minos, highest) > 0) highest = minos;
        }
        if (!machO.some(entry => entry.rel === executable)) findings.push(`${executable} is not a Mach-O binary`);
        return { findings, evidence: [`${machO.length} Mach-O binaries have ${machoArch} code, needing at most macOS ${highest} (LSMinimumSystemVersion ${minimum}); the executable is ${machoArch} only${universal.length ? `; also x86_64 (prebuilt, universal): ${universal.join(", ")}` : ""}`] };
      }),
      check("DIST-PKG-05", () => appcastFindings(info, zip, arch)),
      // Needs Developer ID and notarization credentials: an ad-hoc package (spark package --ad-hoc) fails it.
      check("DIST-PKG-06", () => {
        if (verification instanceof Error) return { findings: [`installing ${path.basename(zip)} failed: ${verification.message}`], evidence: [] };
        return { findings: judgeSignature(verification, false).map(reason => reason.message), evidence: [`${describeSignature(verification)}; Gatekeeper accepts the quarantined download (${verification.gatekeeper.source})`] };
      }),
      check("DIST-PKG-07", () => {
        if (installed instanceof Error) return { findings: [`installing ${path.basename(zip)} as a quarantined download failed: ${installed.message}`], evidence: [] };
        return { findings: [], evidence: [`extracted from the quarantined download, ${path.basename(installed.app)} carries com.apple.quarantine ${installed.quarantine}, so Gatekeeper assesses its first launch`] };
      }),
      check("DIST-PKG-08", () => layout),
      // Needs Developer ID and notarization credentials, like DIST-PKG-06: an ad-hoc package's DMG is unsigned.
      check("DIST-PKG-09", () => signature),
    ];
  } finally { rmSync(work, { recursive: true, force: true }); }
}
