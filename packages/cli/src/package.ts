import { setTimeout as sleep } from "node:timers/promises";
import { readAppConfig } from "./project.ts";
import { prepareUpdate } from "./updates.ts";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, lstatSync, rmSync, renameSync, openSync, closeSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "./build.ts";
import { credentials, notaryAuth, type Runner, type SigningCredentials } from "./credentials.ts";
import { run } from "./commands.ts";
import { appEntitlements, distributionEntitlements, signApp, validateApp, validateDmg } from "./signing.ts";
import { createDmg } from "./dmg.ts";
import { digest, readJson, stateFile, writeJson } from "./project.ts";

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

export function artifactHash(file: string): string {
  const hash = createHash("sha256");
  function visit(current: string) {
    const stat = lstatSync(current);
    hash.update(path.relative(file, current)).update(`:${stat.mode & 0o777}:`);
    if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(current)}`);
    else if (stat.isDirectory()) for (const name of readdirSync(current).sort()) visit(path.join(current, name));
    else hash.update(readFileSync(current));
  }
  visit(file);
  return hash.digest("hex");
}

/** One notarization submission: of the signed app (the package state itself), then of the signed DMG. */
type Submission = { phase: "signed" | "submitting" | "submitted" | "accepted" | "complete"; archiveHash: string; submissionId?: string };
/** The signed DMG (`archiveHash`) made from the stapled app with the verified ZIP (`zipHash`), and once complete its distributed copy. */
type DmgState = Submission & { zipHash: string; output?: string; outputHash?: string };
type PackageState = Submission & { stagedHash: string; output?: string; outputHash?: string; symbols?: string; dmg?: DmgState };
type PackageOptions = { force?: boolean; submissionId?: string; waitMs?: number; runner?: boolean; adHoc?: boolean };
/** `spark package --ad-hoc`: signs without an identity and is never notarized; a test package that Gatekeeper rejects as a download. */
const AD_HOC: SigningCredentials = { hash: "-", name: "ad-hoc", teamId: "", keychainProfile: "" };
type Dependencies = { run: Runner; build: typeof build; credentials: (root: string) => Promise<SigningCredentials>; wait: (ms: number) => Promise<unknown>; prepareUpdate?: typeof prepareUpdate };
const defaults: Dependencies = { run, build, credentials, wait: (ms) => sleep(ms) };

export async function packageApp(root: string, options: PackageOptions = {}, dependencies: Dependencies = defaults) {
  if (options.submissionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.submissionId)) throw new Error("Submission ID must be a UUID returned by Apple.");
  mkdirSync(stateFile(root, "packaging"), { recursive: true });
  const lock = stateFile(root, "package.lock");
  try {
    const fd = openSync(lock, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(readFileSync(lock, "utf8"));
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); }
      catch (check: any) {
        if (check.code === "ESRCH") {
          rmSync(lock);
          return packageApp(root, options, dependencies);
        }
      }
    }
    throw new Error(`Another packaging run owns this app (${lock}). Wait for it to finish; check the recorded PID before removing a stale lock.`);
  }
  try { return await packageUnlocked(root, options, dependencies); }
  finally { rmSync(lock, { force: true }); }
}

async function packageUnlocked(root: string, options: PackageOptions, deps: Dependencies) {
  const execute = deps.run;
  const exec = (argv: string[]) => execute(root, argv, { capture: true });
  if (options.adHoc && (options.runner || options.submissionId)) throw new Error("--ad-hoc packages are never notarized: it cannot be combined with a Runner package or --submission-id.");
  const identity = options.adHoc ? AD_HOC : await deps.credentials(root);
  console.log(`Signing identity: ${identity.name}`);
  const result = await deps.build(root, options.runner ? "go" : "release", options.force);
  const config = readAppConfig(root).expo;
  if (config.extra?.spark?.updates && !result.runtime.modules["@legendapp/spark-updates"]) throw new Error("Updates are configured but the module was pruned. Import @legendapp/spark/updates from the app entry.");
  const entitlements = distributionEntitlements(appEntitlements(root, result.runtime.modules));
  if (!config.macos?.bundleIdentifier || !config.version) throw new Error("Packaging requires macos.bundleIdentifier and version");
  const byPath = config.extra?.spark?.signing?.macos?.entitlementsByPath ?? {};
  const info = JSON.parse(await execute(root, ["plutil", "-convert", "json", "-o", "-", path.join(result.app, "Contents/Info.plist")], { capture: true }));
  const expected = { arch: result.runtime.arch, runner: options.runner, bundleId: config.macos.bundleIdentifier, version: config.version, buildVersion: info.CFBundleVersion, entitlements, byPath };
  if (!expected.bundleId || !expected.version || !expected.buildVersion) throw new Error("Bundle identifier and release version metadata must be configured before packaging.");
  const inputHash = artifactHash(result.app);
  const key = digest(JSON.stringify({ recipe: 2, inputHash, identity: identity.hash, entitlements, byPath }));
  const folder = stateFile(root, `packaging/${key}`);
  const app = path.join(folder, path.basename(result.app));
  const safeName = `${config.slug ?? config.name}-${config.version}-${result.runtime.arch}`.replace(/[^A-Za-z0-9._-]/g, "-");
  const upload = path.join(folder, `${safeName}-${key.slice(0, 16)}-notary.zip`);
  // A release build writes its dSYMs next to the app; the package archives them when it stages the app, so a later
  // build cannot replace them while notarization is pending.
  const symbolsSource = path.join(path.dirname(result.app), "dSYMs"), symbols = options.runner ? undefined : path.join(folder, `${safeName}-dSYMs.zip`);
  if (symbols && !existsSync(symbolsSource)) throw new Error(`The release build has no dSYMs folder at ${symbolsSource}. Rebuild it with spark package --force.`);
  const statePath = path.join(folder, "state.json");
  mkdirSync(folder, { recursive: true });
  let state: PackageState;
  if (existsSync(statePath)) {
    state = readJson(statePath);
    if (!existsSync(app) || artifactHash(app) !== state.stagedHash || !existsSync(upload) || sha256(upload) !== state.archiveHash) {
      throw new Error(`The staged notarization artifacts changed. Preserve ${statePath} for submission recovery; rebuild from clean inputs before retrying.`);
    }
  } else {
    rmSync(app, { recursive: true, force: true });
    cpSync(result.app, app, { recursive: true, verbatimSymlinks: true });
    if (artifactHash(app) !== inputHash) throw new Error("The release app changed while copying it. Retry packaging after the other build finishes.");
    await signApp(root, app, identity, entitlements, byPath, execute);
    await validateApp(root, app, identity, expected, false, execute);
    console.log(`✓ Release app signed${options.adHoc ? " ad-hoc" : ""} and verified`);
    // --norsrc: archives keep no extended attributes, so none of the build machine's (com.apple.provenance, quarantine)
    // ship; signatures live in the bundle.
    if (symbols) await execute(root, ["ditto", "-c", "-k", "--norsrc", "--keepParent", symbolsSource, symbols], { capture: true });
    await execute(root, ["ditto", "-c", "-k", "--norsrc", "--keepParent", app, upload], { capture: true });
    state = { phase: "signed", stagedHash: artifactHash(app), archiveHash: sha256(upload) };
    writeJson(statePath, state);
  }
  const distribution = path.join(root, "dist", ...(options.adHoc ? ["ad-hoc"] : []));
  // The distribution ZIP and DMG are staged here; the DMG Apple notarizes keeps its unique upload name.
  const zip = path.join(folder, `${safeName}.zip`), dmg = path.join(folder, `${safeName}.dmg`), signedDmg = path.join(folder, `${safeName}-${key.slice(0, 16)}.dmg`);
  /** Archives the final app as the staged ZIP and validates the extracted copy. */
  const archive = async (finalApp: string, notarized: boolean) => {
    await exec(["ditto", "-c", "-k", "--norsrc", "--keepParent", finalApp, zip]);
    const extracted = path.join(folder, "verify-archive");
    rmSync(extracted, { recursive: true, force: true });
    mkdirSync(extracted, { recursive: true });
    try {
      await exec(["ditto", "-x", "-k", zip, extracted]);
      const entries = readdirSync(extracted).filter((name) => name !== "__MACOSX");
      if (entries.length !== 1 || !entries[0]!.endsWith(".app")) throw new Error("Distribution archive must contain exactly one app.");
      await validateApp(root, path.join(extracted, entries[0]!), identity, expected, notarized, execute);
    } finally { rmSync(extracted, { recursive: true, force: true }); }
  };
  /** Copies staged files to `distribution`, replacing each atomically, and returns their paths there. */
  const publish = (...files: string[]) => files.map((source) => {
    const target = path.join(distribution, path.basename(source)), temporary = `${target}.${process.pid}.tmp`;
    mkdirSync(distribution, { recursive: true });
    cpSync(source, temporary);
    renameSync(temporary, target);
    return target;
  });
  if (options.adHoc) {
    await archive(app, false);
    // An ad-hoc package's DMG is unsigned: only a Developer ID signature would make Gatekeeper trust it.
    await createDmg(app, dmg, exec);
    const [output, image, dsyms] = publish(zip, dmg, ...(symbols ? [symbols] : [])) as [string, string, string?];
    console.log(`✓ Distribution archive verified\n\nReady (ad-hoc and not notarized: for testing the package, Gatekeeper rejects it as a download): ${output}\nDisk image: ${image}${dsyms ? `\nDebug symbols: ${dsyms}` : ""}`);
    return { pending: false as const, output, dmg: image, symbols: dsyms, update: undefined, submissionId: undefined };
  }
  const prepare = (output: string) => options.runner ? Promise.resolve(undefined) : (deps.prepareUpdate ?? prepareUpdate)(root, output, String(expected.buildVersion));
  // Reuse the exact verified distribution bytes on retries, including when feed
  // signing failed after notarization. Re-stapling could change the archive.
  if (state.phase === "complete") {
    // A deleted output is copied again from the staged file with the same bytes.
    for (const { output = "", staged, hash } of [{ output: state.output, staged: zip, hash: state.outputHash }, ...(state.dmg ? [{ output: state.dmg.output, staged: dmg, hash: state.dmg.outputHash }] : [])]) {
      if (!existsSync(output) && existsSync(staged) && sha256(staged) === hash) publish(staged);
      if (!existsSync(output) || sha256(output) !== hash) throw new Error(`The completed distribution archive changed: ${output}. Restore it or package a new build number.`);
    }
    const update = await prepare(state.output!);
    console.log(`Ready: ${state.output}${state.dmg ? `\nDisk image: ${state.dmg.output}` : ""}`);
    return { pending: false as const, output: state.output!, dmg: state.dmg?.output, symbols: state.symbols, update, submissionId: state.submissionId };
  }
  const notary = async (command: string, ...args: string[]) => JSON.parse(await exec(["xcrun", "notarytool", command, ...args, ...notaryAuth(identity), "--output-format", "json"]));
  /**
   * Notarizes `upload` once: submits it, or adopts the `recovery` submission, then waits up to `waitMs` for Apple and
   * checks Apple's hash of it. Returns false while Apple is still processing it. Each step is saved, so a rerun resumes.
   */
  const notarize = async (submission: Submission, upload: string, log: string, recovery?: string) => {
    if (submission.phase === "accepted" || submission.phase === "complete") return true;
    const name = path.basename(upload);
    if (recovery) {
      if (submission.submissionId && submission.submissionId !== recovery) throw new Error(`${name} already has a different notarization submission ID.`);
      const recovered = await notary("info", recovery);
      if (recovered.id !== recovery || recovered.name !== name) throw new Error("That notarization submission does not match this upload filename.");
      submission.submissionId = recovery;
      submission.phase = "submitted";
      writeJson(statePath, state);
    }
    if (!submission.submissionId) {
      if (submission.phase !== "signed") throw new Error(`The previous notarization submission of ${name} has an unknown outcome. Find its ID using notarytool history, then run spark package --submission-id <id>. spark will not submit it twice automatically.`);
      submission.phase = "submitting";
      writeJson(statePath, state);
      console.log(`Submitting ${name} to Apple for notarization…`);
      const submitted = await notary("submit", upload, "--no-wait");
      if (typeof submitted.id !== "string" || !/^[0-9a-f-]{36}$/i.test(submitted.id)) throw new Error("Apple did not return a valid submission ID. Run spark package again for recovery instructions.");
      submission.submissionId = submitted.id;
      submission.phase = "submitted";
      writeJson(statePath, state);
    }
    const submissionId = submission.submissionId;
    if (!submissionId || !/^[0-9a-f-]{36}$/i.test(submissionId)) throw new Error("Invalid saved notarization submission ID.");
    const deadline = Date.now() + (options.waitMs ?? 120_000);
    while (true) {
      const response = await notary("info", submissionId);
      if (response.status === "Accepted") break;
      if (response.status !== "In Progress") {
        writeJson(path.join(folder, log), await notary("log", submissionId));
        throw new Error(`Notarization ${response.status}. See ${path.join(folder, log)}. Fix the reported issues and package a new build.`);
      }
      console.log(`Apple is processing submission ${submissionId}…`);
      if (Date.now() >= deadline) {
        console.log("Notarization is still pending. Run spark package again to resume; the app will not be rebuilt or resubmitted if its inputs are unchanged.");
        return false;
      }
      await deps.wait(Math.min(15_000, Math.max(0, deadline - Date.now())));
    }
    const result = await notary("log", submissionId);
    writeJson(path.join(folder, log), result);
    if (result.sha256?.toLowerCase() !== submission.archiveHash) throw new Error("Apple’s notarization log does not match the uploaded archive hash.");
    submission.phase = "accepted";
    writeJson(statePath, state);
    console.log(`✓ Notarization of ${name} accepted`);
    return true;
  };
  const appAccepted = state.phase === "accepted";
  if (!await notarize(state, upload, "notary-log.json", appAccepted ? undefined : options.submissionId)) return { pending: true as const, submissionId: state.submissionId };
  // The DMG holds the stapled app and is notarized itself; a Runner package is only a ZIP.
  if (!state.dmg) {
    // Keep the submitted artifact immutable. An interrupted staple/validation run
    // can recreate this final copy without losing its accepted submission.
    const finalApp = path.join(folder, "final", path.basename(app));
    rmSync(path.dirname(finalApp), { recursive: true, force: true });
    mkdirSync(path.dirname(finalApp), { recursive: true });
    cpSync(app, finalApp, { recursive: true, verbatimSymlinks: true });
    await exec(["xcrun", "stapler", "staple", finalApp]);
    await validateApp(root, finalApp, identity, expected, true, execute);
    await archive(finalApp, true);
    console.log("✓ Notarization ticket attached\n✓ Distribution archive verified");
    if (options.runner) {
      const [output] = publish(zip) as [string];
      state.phase = "complete";
      state.output = output;
      state.outputHash = sha256(output);
      writeJson(statePath, state);
      console.log(`\nReady: ${output}`);
      return { pending: false as const, output, dmg: undefined, symbols: undefined, update: undefined, submissionId: state.submissionId };
    }
    await createDmg(finalApp, signedDmg, exec);
    await exec(["codesign", "--force", "--sign", identity.hash, "--timestamp", ...(identity.keychain ? ["--keychain", identity.keychain] : []), signedDmg]);
    state.dmg = { phase: "signed", archiveHash: sha256(signedDmg), zipHash: sha256(zip) };
    writeJson(statePath, state);
    console.log("✓ Disk image signed");
  } else if (!existsSync(zip) || sha256(zip) !== state.dmg.zipHash || !existsSync(signedDmg) || sha256(signedDmg) !== state.dmg.archiveHash) {
    throw new Error(`The staged distribution archive or disk image changed. Preserve ${statePath} for submission recovery; rebuild from clean inputs before retrying.`);
  }
  // --submission-id names the app's submission until Apple accepts the app, then the DMG's.
  const dmgRecovery = appAccepted && options.submissionId !== state.submissionId ? options.submissionId : undefined;
  if (!await notarize(state.dmg, signedDmg, "dmg-notary-log.json", dmgRecovery)) return { pending: true as const, submissionId: state.dmg.submissionId };
  // Staple a copy, so the submitted DMG stays immutable for a retry.
  cpSync(signedDmg, dmg);
  await exec(["xcrun", "stapler", "staple", dmg]);
  await validateDmg(root, dmg, identity, execute);
  const [output, image, dsyms] = publish(zip, dmg, ...(symbols ? [symbols] : [])) as [string, string, string?];
  state.phase = "complete";
  state.output = output;
  state.outputHash = sha256(output);
  state.symbols = dsyms;
  state.dmg.output = image;
  state.dmg.outputHash = sha256(image);
  writeJson(statePath, state);
  const update = await prepare(output);
  console.log(`✓ Disk image notarization ticket attached and verified\n\nReady: ${output}\nDisk image: ${image}${dsyms ? `\nDebug symbols: ${dsyms}` : ""}`);
  return { pending: false as const, output, dmg: image, symbols: dsyms, update, submissionId: state.submissionId };
}
