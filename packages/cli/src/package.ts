import { setTimeout as sleep } from "node:timers/promises";
import { readAppConfig } from "./project.ts";
import { prepareUpdate } from "./updates.ts";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, lstatSync, rmSync, renameSync, openSync, closeSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "./build.ts";
import { credentials, notaryAuth, type Runner, type SigningCredentials } from "./credentials.ts";
import { run } from "./commands.ts";
import { appEntitlements, distributionEntitlements, signApp, validateApp } from "./signing.ts";
import { digest, readJson, stateFile, writeJson } from "./project.ts";

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

type PackageState = { phase: "signed" | "submitting" | "submitted" | "accepted" | "complete"; stagedHash: string; archiveHash: string; submissionId?: string; output?: string; outputHash?: string; symbols?: string };
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
  const key = digest(JSON.stringify({ recipe: 1, inputHash, identity: identity.hash, entitlements, byPath }));
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
    if (!existsSync(app) || artifactHash(app) !== state.stagedHash || !existsSync(upload) || createHash("sha256").update(readFileSync(upload)).digest("hex") !== state.archiveHash) {
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
    state = { phase: "signed", stagedHash: artifactHash(app), archiveHash: createHash("sha256").update(readFileSync(upload)).digest("hex") };
    writeJson(statePath, state);
  }
  const distribution = path.join(root, "dist", ...(options.adHoc ? ["ad-hoc"] : []));
  /** Archives the final app, validates the extracted copy, and writes it with its dSYMs archive to `distribution`. */
  const distribute = async (finalApp: string, notarized: boolean) => {
    const archive = path.join(folder, `${safeName}.zip`);
    await execute(root, ["ditto", "-c", "-k", "--norsrc", "--keepParent", finalApp, archive], { capture: true });
    const extracted = path.join(folder, "verify-archive");
    rmSync(extracted, { recursive: true, force: true });
    mkdirSync(extracted, { recursive: true });
    try {
      await execute(root, ["ditto", "-x", "-k", archive, extracted], { capture: true });
      const entries = readdirSync(extracted).filter((name) => name !== "__MACOSX");
      if (entries.length !== 1 || !entries[0]!.endsWith(".app")) throw new Error("Distribution archive must contain exactly one app.");
      await validateApp(root, path.join(extracted, entries[0]!), identity, expected, notarized, execute);
    } finally { rmSync(extracted, { recursive: true, force: true }); }
    const output = path.join(distribution, `${safeName}.zip`);
    mkdirSync(distribution, { recursive: true });
    for (const [source, target] of [[archive, output], ...(symbols ? [[symbols, path.join(distribution, path.basename(symbols))]] : [])] as const) {
      const temporary = `${target}.${process.pid}.tmp`;
      cpSync(source, temporary);
      renameSync(temporary, target);
    }
    return { output, symbols: symbols && path.join(distribution, path.basename(symbols)) };
  };
  if (options.adHoc) {
    const { output, symbols: dsyms } = await distribute(app, false);
    console.log(`✓ Distribution archive verified\n\nReady (ad-hoc and not notarized: for testing the package, Gatekeeper rejects it as a download): ${output}${dsyms ? `\nDebug symbols: ${dsyms}` : ""}`);
    return { pending: false as const, output, symbols: dsyms, update: undefined, submissionId: undefined };
  }
  // Reuse the exact verified distribution bytes on retries, including when feed
  // signing failed after notarization. Re-stapling could change the archive.
  if (state.phase === "complete" && state.output && state.outputHash && existsSync(state.output)) {
    if (createHash("sha256").update(readFileSync(state.output)).digest("hex") !== state.outputHash) throw new Error("The completed distribution archive changed. Restore it or package a new build number.");
    const update = await (options.runner ? Promise.resolve(undefined) : (deps.prepareUpdate ?? prepareUpdate)(root, state.output, String(expected.buildVersion)));
    console.log(`Ready: ${state.output}`);
    return { pending: false as const, output: state.output, symbols: state.symbols, update, submissionId: state.submissionId };
  }
  const notary = async (command: string, ...args: string[]) => JSON.parse(await execute(root, ["xcrun", "notarytool", command, ...args, ...notaryAuth(identity), "--output-format", "json"], { capture: true }));
  if (options.submissionId) {
    if (state.submissionId && state.submissionId !== options.submissionId) throw new Error("This artifact already has a different notarization submission ID.");
    const recovered = await notary("info", options.submissionId);
    if (recovered.id !== options.submissionId || recovered.name !== path.basename(upload)) throw new Error("That notarization submission does not match this upload filename.");
    state.submissionId = options.submissionId;
    state.phase = "submitted";
    writeJson(statePath, state);
  }
  if (!state.submissionId) {
    if (state.phase !== "signed") throw new Error("The previous notarization submission has an unknown outcome. Find its ID using notarytool history, then run spark package --submission-id <id>. spark will not submit it twice automatically.");
    state.phase = "submitting";
    writeJson(statePath, state);
    console.log("Submitting the signed app to Apple for notarization…");
    const submitted = await notary("submit", upload, "--no-wait");
    if (typeof submitted.id !== "string" || !/^[0-9a-f-]{36}$/i.test(submitted.id)) throw new Error("Apple did not return a valid submission ID. Run spark package again for recovery instructions.");
    state.submissionId = submitted.id;
    state.phase = "submitted";
    writeJson(statePath, state);
  }
  const submissionId = state.submissionId;
  if (!submissionId || !/^[0-9a-f-]{36}$/i.test(submissionId)) throw new Error("Invalid saved notarization submission ID.");
  const deadline = Date.now() + (options.waitMs ?? 120_000);
  while (true) {
    const response = await notary("info", submissionId);
    if (response.status === "Accepted") break;
    if (response.status !== "In Progress") {
      const log = await notary("log", submissionId);
      writeJson(path.join(folder, "notary-log.json"), log);
      throw new Error(`Notarization ${response.status}. See ${path.join(folder, "notary-log.json")}. Fix the reported issues and package a new build.`);
    }
    console.log(`Apple is processing submission ${state.submissionId}…`);
    if (Date.now() >= deadline) {
      console.log("Notarization is still pending. Run spark package again to resume; the app will not be rebuilt or resubmitted if its inputs are unchanged.");
      return { pending: true as const, submissionId: state.submissionId };
    }
    await deps.wait(Math.min(15_000, Math.max(0, deadline - Date.now())));
  }
  const log = await notary("log", submissionId);
  writeJson(path.join(folder, "notary-log.json"), log);
  if (log.sha256?.toLowerCase() !== state.archiveHash) throw new Error("Apple’s notarization log does not match the uploaded archive hash.");
  state.phase = "accepted";
  writeJson(statePath, state);
  console.log("✓ Notarization accepted");
  // Keep the submitted artifact immutable. An interrupted staple/validation run
  // can recreate this final copy without losing its accepted submission.
  const finalApp = path.join(folder, "final", path.basename(app));
  rmSync(path.dirname(finalApp), { recursive: true, force: true });
  mkdirSync(path.dirname(finalApp), { recursive: true });
  cpSync(app, finalApp, { recursive: true, verbatimSymlinks: true });
  await execute(root, ["xcrun", "stapler", "staple", finalApp], { capture: true });
  await validateApp(root, finalApp, identity, expected, true, execute);
  const { output, symbols: dsyms } = await distribute(finalApp, true);
  state.phase = "complete";
  state.output = output;
  state.outputHash = createHash("sha256").update(readFileSync(output)).digest("hex");
  state.symbols = dsyms;
  writeJson(statePath, state);
  const update = await (options.runner ? Promise.resolve(undefined) : (deps.prepareUpdate ?? prepareUpdate)(root, output, String(expected.buildVersion)));
  console.log(`✓ Notarization ticket attached\n✓ Distribution archive verified\n\nReady: ${output}${dsyms ? `\nDebug symbols: ${dsyms}` : ""}`);
  return { pending: false as const, output, symbols: dsyms, update, submissionId: state.submissionId };
}
