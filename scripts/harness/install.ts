// The release harness's install and verification steps (docs/release-harness.md): install a downloaded .dmg or .zip
// the way a person does, then ask macOS what it thinks of the signature before anything runs.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";

export type Command = { code: number; stdout: string; stderr: string };
/** Runs a command to completion with all its output; `signal` kills it. Tests pass a double; `sh` is the real one. */
export type Sh = (argv: string[], signal?: AbortSignal) => Promise<Command>;
/**
 * Async on purpose: Bun 1.3's spawnSync can drop a child's output that it has not read when the child exits
 * (tests/subprocess.ts), which would misread codesign, spctl and xattr. A command that cannot start, or is killed,
 * exits 1 with the reason in stderr.
 */
export const sh: Sh = ([command, ...args], signal) => new Promise(resolve => {
  execFile(command!, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, signal }, (error, stdout, stderr) => {
    const code = !error ? 0 : typeof error.code === "number" ? error.code : 1;
    resolve({ code, stdout, stderr: error && typeof error.code !== "number" ? `${stderr}${error.message}` : stderr });
  });
});

export type HarnessCheck = "usage" | "target" | "source" | "artifact" | "install" | "quarantine" | "signature" | "notarization" | "revision" | "gate" | "vm";
export type HarnessReason = { check: HarnessCheck; message: string };
/** A step that cannot continue. The harness records it as a reason. */
export class HarnessError extends Error {
  constructor(readonly check: HarnessCheck, message: string) { super(message); }
}

async function must(run: Sh, argv: string[], check: HarnessCheck): Promise<Command> {
  const result = await run(argv);
  if (result.code) throw new HarnessError(check, `${argv.join(" ")} exited ${result.code}: ${(result.stderr || result.stdout).trim()}`);
  return result;
}

export const QUARANTINE = "com.apple.quarantine";
/** What a browser leaves on a download: flags 0081 (quarantined, downloaded), the time in hex and the agent. */
export const quarantineValue = (now: Date) => `0081;${Math.floor(now.getTime() / 1000).toString(16)};Spark release harness;`;
export const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function onlyApp(dir: string, what: string): string {
  const apps = readdirSync(dir).filter(name => name.endsWith(".app"));
  if (apps.length !== 1) throw new HarnessError("install", `${what} must contain exactly one .app; found ${apps.length ? apps.join(", ") : "none"}`);
  return apps[0]!;
}

/** A local distributable for `--local`: the app and an /Applications link in a compressed, read-only disk image, as a release DMG is laid out. */
export async function packageDmg(app: string, work: string, run: Sh): Promise<string> {
  const stage = path.join(work, "dmg");
  mkdirSync(stage, { recursive: true });
  await must(run, ["ditto", app, path.join(stage, path.basename(app))], "artifact");
  symlinkSync("/Applications", path.join(stage, "Applications"));
  const dmg = path.join(work, `${path.basename(app, ".app")}.dmg`);
  await must(run, ["hdiutil", "create", "-quiet", "-srcfolder", stage, "-volname", path.basename(app, ".app"), "-format", "UDZO", "-o", dmg], "artifact");
  return dmg;
}

export type Installed = { app: string; format: "dmg" | "zip"; sha256: string; quarantine: string };

/** Detaches a mounted disk image, forcing it if a plain detach fails. Returns why it is still mounted, or undefined. */
async function detach(volume: string, run: Sh): Promise<string | undefined> {
  const plain = await run(["hdiutil", "detach", volume]);
  if (!plain.code) return undefined;
  const forced = await run(["hdiutil", "detach", "-force", volume]);
  if (!forced.code) return undefined;
  return `hdiutil detach could not detach ${volume}, even with -force: ${(forced.stderr || forced.stdout || plain.stderr).trim()}`;
}

/**
 * Copies the artifact into `work/Downloads` and quarantines it as a download, then installs into a fresh
 * `work/Applications`: a .dmg is mounted read-only and its app copied out; a .zip is extracted as Archive Utility does.
 * Both propagate the quarantine; an installed app without it fails. A disk image that will not detach is added to
 * `reasons` without hiding the install's own error.
 */
export async function install(artifact: string, work: string, run: Sh, reasons: HarnessReason[], now = new Date()): Promise<Installed> {
  const format = artifact.endsWith(".dmg") ? "dmg" : artifact.endsWith(".zip") ? "zip" : undefined;
  if (!format) throw new HarnessError("artifact", `${artifact} is not a .dmg or .zip; the harness installs macOS distributables`);
  const downloads = path.join(work, "Downloads"), applications = path.join(work, "Applications");
  mkdirSync(downloads, { recursive: true });
  mkdirSync(applications, { recursive: true });
  const downloaded = path.join(downloads, path.basename(artifact));
  copyFileSync(artifact, downloaded);
  await must(run, ["xattr", "-w", QUARANTINE, quarantineValue(now), downloaded], "quarantine");
  let app: string;
  if (format === "dmg") {
    const volume = path.join(work, "Volume");
    mkdirSync(volume);
    await must(run, ["hdiutil", "attach", downloaded, "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", volume], "install");
    try {
      app = onlyApp(volume, path.basename(artifact));
      await must(run, ["ditto", path.join(volume, app), path.join(applications, app)], "install");
    } finally {
      const stuck = await detach(volume, run).catch((error: Error) => `hdiutil detach ${volume} failed: ${error.message}`);
      if (stuck) reasons.push({ check: "install", message: stuck });
    }
  } else {
    await must(run, ["ditto", "-x", "-k", downloaded, applications], "install");
    app = onlyApp(applications, path.basename(artifact));
  }
  const installed = path.join(applications, app);
  const quarantine = await run(["xattr", "-p", QUARANTINE, installed]);
  if (quarantine.code) throw new HarnessError("quarantine", `the installed ${app} has no ${QUARANTINE} attribute: installing from the ${format} did not carry the download's quarantine`);
  return { app: installed, format, sha256: sha256(artifact), quarantine: quarantine.stdout.trim() };
}

export type Verification = {
  /** `codesign --verify --deep --strict`. */
  codesign: { valid: boolean; output: string };
  signature: "developer-id" | "ad-hoc" | "other" | "unsigned";
  authority?: string;
  teamId?: string;
  hardenedRuntime: boolean;
  timestamp: boolean;
  /** `spctl --assess --type execute`: Gatekeeper's verdict, and its `source=` line. */
  gatekeeper: { accepted: boolean; source?: string; output: string };
  notarized: boolean;
  /** `xcrun stapler validate`: the notarization ticket is stapled to the app, so Gatekeeper accepts it offline. */
  stapled: { valid: boolean; output: string };
};

export async function verify(app: string, run: Sh): Promise<Verification> {
  const strict = await run(["codesign", "--verify", "--deep", "--strict", "--verbose", app]);
  const details = await run(["codesign", "-dvvv", app]);
  const text = details.stderr;
  const authority = /^Authority=(.*)$/m.exec(text)?.[1];
  const assess = await run(["spctl", "--assess", "--type", "execute", "--verbose=4", app]);
  const staple = await run(["xcrun", "stapler", "validate", app]);
  const gatekeeper = { accepted: assess.code === 0, source: /^source=(.*)$/m.exec(assess.stderr + assess.stdout)?.[1], output: (assess.stderr + assess.stdout).trim() };
  return {
    codesign: { valid: strict.code === 0, output: (strict.stderr + strict.stdout).trim() },
    signature: details.code ? "unsigned" : /^Signature=adhoc$/m.test(text) ? "ad-hoc" : authority?.startsWith("Developer ID Application: ") ? "developer-id" : "other",
    authority,
    teamId: /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(text)?.[1],
    hardenedRuntime: /^CodeDirectory .*flags=0x[0-9a-f]+\([^)]*\bruntime\b/m.test(text),
    timestamp: /^Timestamp=/m.test(text),
    gatekeeper,
    notarized: gatekeeper.accepted && gatekeeper.source === "Notarized Developer ID",
    stapled: { valid: staple.code === 0, output: (staple.stdout + staple.stderr).trim() },
  };
}

/** One line for the console and the report, such as `ad-hoc / not notarized / not stapled`. */
export function describeSignature(verification: Verification): string {
  const signer = verification.signature === "developer-id" || verification.signature === "other" ? verification.authority ?? verification.signature : verification.signature;
  return `${signer} / ${verification.notarized ? "notarized" : "not notarized"} / ${verification.stapled.valid ? "stapled" : "not stapled"}`;
}

/** A broken signature fails in every mode. A release also needs Developer ID, hardened runtime, a timestamp and a stapled notarization (`spark package` staples); `--local` records their absence instead. */
export function judgeSignature(verification: Verification, local: boolean): HarnessReason[] {
  const reasons: HarnessReason[] = [];
  if (!verification.codesign.valid) reasons.push({ check: "signature", message: `codesign --verify --deep --strict failed: ${verification.codesign.output}` });
  if (local) return reasons;
  if (verification.signature !== "developer-id") reasons.push({ check: "signature", message: `the app is signed ${verification.signature === "other" ? `by ${verification.authority}` : verification.signature}; a release needs a Developer ID Application signature` });
  if (verification.signature !== "unsigned" && verification.signature !== "ad-hoc") {
    if (!verification.hardenedRuntime) reasons.push({ check: "signature", message: "the signature does not enable the hardened runtime" });
    if (!verification.timestamp) reasons.push({ check: "signature", message: "the signature has no secure timestamp" });
  }
  if (!verification.notarized) reasons.push({ check: "notarization", message: `Gatekeeper ${verification.gatekeeper.accepted ? "accepted" : "rejected"} the app${verification.gatekeeper.source ? ` (source=${verification.gatekeeper.source})` : ""}; a release must be notarized: ${verification.gatekeeper.output}` });
  else if (!verification.stapled.valid) reasons.push({ check: "notarization", message: `the notarization ticket is not stapled, so Gatekeeper needs the network to accept the app: ${verification.stapled.output}` });
  return reasons;
}
