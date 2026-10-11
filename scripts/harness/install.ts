// The release harness's install and verification steps (docs/release-harness.md): install a downloaded .dmg or .zip
// the way a person does, then ask macOS what it thinks of the signature before anything runs.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";

export type Command = { code: number; stdout: string; stderr: string };
/** Runs a command to completion. Tests pass a double; `sh` is the real one. */
export type Sh = (argv: string[]) => Command;
export const sh: Sh = ([command, ...args]) => {
  const result = spawnSync(command!, args, { encoding: "utf8" });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr || result.error?.message || "" };
};

export type HarnessCheck = "usage" | "target" | "source" | "artifact" | "install" | "quarantine" | "signature" | "notarization" | "gate" | "vm";
export type HarnessReason = { check: HarnessCheck; message: string };
/** A step that cannot continue. The harness records it as a reason. */
export class HarnessError extends Error {
  constructor(readonly check: HarnessCheck, message: string) { super(message); }
}

function must(run: Sh, argv: string[], check: HarnessCheck): Command {
  const result = run(argv);
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
export function packageDmg(app: string, work: string, run: Sh): string {
  const stage = path.join(work, "dmg");
  mkdirSync(stage, { recursive: true });
  must(run, ["ditto", app, path.join(stage, path.basename(app))], "artifact");
  symlinkSync("/Applications", path.join(stage, "Applications"));
  const dmg = path.join(work, `${path.basename(app, ".app")}.dmg`);
  must(run, ["hdiutil", "create", "-quiet", "-srcfolder", stage, "-volname", path.basename(app, ".app"), "-format", "UDZO", "-o", dmg], "artifact");
  return dmg;
}

export type Installed = { app: string; format: "dmg" | "zip"; sha256: string; quarantine: string };

/**
 * Copies the artifact into `work/Downloads` and quarantines it as a download, then installs into a fresh
 * `work/Applications`: a .dmg is mounted read-only and its app copied out; a .zip is extracted as Archive Utility does.
 * Both propagate the quarantine; an installed app without it fails.
 */
export function install(artifact: string, work: string, run: Sh, now = new Date()): Installed {
  const format = artifact.endsWith(".dmg") ? "dmg" : artifact.endsWith(".zip") ? "zip" : undefined;
  if (!format) throw new HarnessError("artifact", `${artifact} is not a .dmg or .zip; the harness installs macOS distributables`);
  const downloads = path.join(work, "Downloads"), applications = path.join(work, "Applications");
  mkdirSync(downloads, { recursive: true });
  mkdirSync(applications, { recursive: true });
  const downloaded = path.join(downloads, path.basename(artifact));
  copyFileSync(artifact, downloaded);
  must(run, ["xattr", "-w", QUARANTINE, quarantineValue(now), downloaded], "quarantine");
  let app: string;
  if (format === "dmg") {
    const volume = path.join(work, "Volume");
    mkdirSync(volume);
    must(run, ["hdiutil", "attach", downloaded, "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", volume], "install");
    try {
      app = onlyApp(volume, path.basename(artifact));
      must(run, ["ditto", path.join(volume, app), path.join(applications, app)], "install");
    } finally { must(run, ["hdiutil", "detach", volume], "install"); }
  } else {
    must(run, ["ditto", "-x", "-k", downloaded, applications], "install");
    app = onlyApp(applications, path.basename(artifact));
  }
  const installed = path.join(applications, app);
  const quarantine = run(["xattr", "-p", QUARANTINE, installed]);
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
};

export function verify(app: string, run: Sh): Verification {
  const strict = run(["codesign", "--verify", "--deep", "--strict", "--verbose", app]);
  const details = run(["codesign", "-dvvv", app]);
  const text = details.stderr;
  const authority = /^Authority=(.*)$/m.exec(text)?.[1];
  const assess = run(["spctl", "--assess", "--type", "execute", "--verbose=4", app]);
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
  };
}

/** One line for the console and the report, such as `ad-hoc / not notarized`. */
export function describeSignature(verification: Verification): string {
  const signer = verification.signature === "developer-id" || verification.signature === "other" ? verification.authority ?? verification.signature : verification.signature;
  return `${signer} / ${verification.notarized ? "notarized" : "not notarized"}`;
}

/** A broken signature fails in every mode. A release also needs Developer ID, hardened runtime, a timestamp and notarization; `--local` records their absence instead. */
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
  return reasons;
}
