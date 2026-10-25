import { writeFile } from "node:fs/promises";
import { readAppConfig, writeUpdates } from "./project.ts";
import { createHash, createPublicKey, verify } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { sparkHome } from "./local.ts";
import { run } from "./commands.ts";
import { readJson, writeJson } from "./project.ts";
import type { Runner } from "./credentials.ts";

const { updateConfiguration } = createRequire(import.meta.url)("@legendapp/spark-desktop-config/updates.cjs");
export const SPARKLE_VERSION = "2.9.6";
const archiveHash = "52bf9e88cdd972fc0c81501377a880e90d47031bd8ca5462488f843e2609e192";
export async function sparkleTools(root: string, execute: Runner = run) {
  const directory = path.join(sparkHome(), "tools", `sparkle-${SPARKLE_VERSION}`);
  if (existsSync(path.join(directory, "bin/generate_appcast"))) return path.join(directory, "bin");
  const temporary = `${directory}-${crypto.randomUUID()}`;
  mkdirSync(temporary, { recursive: true });
  try {
    console.log(`Downloading Sparkle ${SPARKLE_VERSION} release tools…`);
    const response = await fetch(`https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-${SPARKLE_VERSION}.tar.xz`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Sparkle tools download failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== archiveHash) throw new Error("Sparkle tools archive checksum mismatch");
    const archive = path.join(temporary, "tools.tar.xz");
    await writeFile(archive, bytes);
    await execute(root, ["tar", "-xJf", archive, "-C", temporary], { capture: true });
    rmSync(archive);
    try { renameSync(temporary, directory); } catch (error) { if (!existsSync(path.join(directory, "bin/generate_appcast"))) throw error; }
    return path.join(directory, "bin");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
function account(expo: any) { return `spark.${expo.extra?.spark?.projectId ?? expo.macos.bundleIdentifier}`; }
export async function initializeUpdates(root: string, feedURL: string, execute: Runner = run) {
  const config = readAppConfig(root);
  // Validate the URL before creating a Keychain entry. This placeholder is public.
  updateConfiguration({ extra: { spark: { updates: { feedURL, publicKey: Buffer.alloc(32).toString("base64") } } } });
  const bin = await sparkleTools(root, execute);
  await execute(root, [path.join(bin, "generate_keys"), "--account", account(config.expo)], { capture: true });
  const publicKey = (await execute(root, [path.join(bin, "generate_keys"), "--account", account(config.expo), "-p"], { capture: true })).trim();
  updateConfiguration({ extra: { spark: { updates: { feedURL, publicKey } } } });
  if (config.expo.extra?.spark?.updates?.publicKey && config.expo.extra.spark.updates.publicKey !== publicKey) throw new Error("This Mac's update key differs from the configured public key. Import the existing Sparkle key instead of replacing it.");
  writeUpdates(root, { ...config.expo.extra?.spark?.updates, feedURL, publicKey });
  console.log("Updates configured. The private key stays in Keychain. Import @legendapp/spark/updates and run spark package to generate a signed feed.");
}
export function verifyUpdateSignature(archive: string, signature: string, publicKey: string) {
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "base64")]), format: "der", type: "spki" });
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature) || !verify(null, readFileSync(archive), key, Buffer.from(signature, "base64"))) throw new Error("Update signature does not match the app's public key or archive");
}
type UpdateDependencies = { run: Runner; tools: typeof sparkleTools; keyFile?: string };
const buildNumberPattern = /^[0-9]+(?:\.[0-9]+){0,2}$/;
function buildNumberParts(version: string) { return version.split(".").map(part => part.replace(/^0+(?=\d)/, "")); }
function canonicalBuildNumber(version: string) { return buildNumberParts(version).concat(["0", "0"]).slice(0, 3).join("."); }
export function compareBuildNumbers(left: string, right: string) {
  const a = buildNumberParts(left), b = buildNumberParts(right);
  for (let index = 0; index < 3; index++) {
    const x = a[index] ?? "0", y = b[index] ?? "0";
    if (x.length !== y.length) return x.length < y.length ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
export function validateUpdateBuildVersion(buildVersion: string, records: Record<string, { sha256: string }>, archiveHash: string) {
  if (!buildNumberPattern.test(buildVersion)) throw new Error("Updates require a numeric macOS buildNumber, increasing for every release");
  const seen = new Map<string, string>();
  for (const version of Object.keys(records)) {
    if (!buildNumberPattern.test(version)) throw new Error(`Invalid build number in Spark update history: ${version}`);
    const canonical = canonicalBuildNumber(version);
    const equivalent = seen.get(canonical);
    if (equivalent && equivalent !== version) throw new Error(`Spark update history reuses the numeric build number as both ${equivalent} and ${version}.`);
    seen.set(canonical, version);
    if (compareBuildNumbers(version, buildVersion) === 0 && version !== buildVersion) throw new Error(`Build ${buildVersion} aliases the recorded build number ${version}; use a new increasing macos.buildNumber spelling.`);
  }
  const existing = records[buildVersion];
  if (existing) {
    if (existing.sha256 !== archiveHash) throw new Error(`Build ${buildVersion} was already packaged with different bytes. Increase macos.buildNumber before publishing another update.`);
    return;
  }
  for (const version of Object.keys(records)) {
    if (compareBuildNumbers(buildVersion, version) <= 0) throw new Error(`Build ${buildVersion} must be greater than every published build number. Increase macos.buildNumber before publishing another update.`);
  }
}
export async function prepareUpdate(root: string, archive: string, buildVersion: string, dependencies: UpdateDependencies = { run, tools: sparkleTools }) {
  const expo = readAppConfig(root).expo;
  const updates = updateConfiguration(expo);
  if (!updates) return undefined;
  const directory = path.join(root, "dist/updates");
  const recordsFile = path.join(directory, "releases.json");
  const records = existsSync(recordsFile) ? readJson(recordsFile) : {};
  const hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
  validateUpdateBuildVersion(buildVersion, records, hash);
  const bin = await dependencies.tools(root, dependencies.run);
  const keyArgs = dependencies.keyFile ? ["--ed-key-file", dependencies.keyFile] : ["--account", account(expo)];
  const signature = (await dependencies.run(root, [path.join(bin, "sign_update"), ...keyArgs, "-p", archive], { capture: true })).trim();
  verifyUpdateSignature(archive, signature, updates.publicKey);
  const staging = path.join(root, ".spark", `update-feed-${crypto.randomUUID()}`);
  mkdirSync(staging, { recursive: true });
  try {
    // Sparkle only uses deltas of the newest item, so generate_appcast gets no old deltas or
    // references to them; it signs the feed again and creates deltas for this build only.
    if (existsSync(directory)) cpSync(directory, staging, { recursive: true, filter: source => !source.endsWith(".delta") });
    const name = `${path.basename(archive, ".zip")}-build-${buildVersion}.zip`;
    cpSync(archive, path.join(staging, name));
    const url = new URL(updates.feedURL);
    const feed = path.join(staging, path.basename(url.pathname));
    if (existsSync(feed)) writeFileSync(feed, readFileSync(feed, "utf8").replace(/\s*<sparkle:deltas>[\s\S]*?<\/sparkle:deltas>/g, ""));
    await dependencies.run(root, [path.join(bin, "generate_appcast"), ...keyArgs, "--download-url-prefix", new URL(".", url).href, "--maximum-deltas", String(updates.maximumDeltas ?? 0), "--maximum-versions", "0", "-o", feed, staging], { capture: true });
    if (!existsSync(feed) || !readFileSync(feed, "utf8").includes(`sparkle:edSignature="${signature}"`)) throw new Error("Generated appcast did not include the signed update archive");
    // Verify the signed feed using the same key; Sparkle verifies it in the app.
    await dependencies.run(root, [path.join(bin, "sign_update"), ...keyArgs, "--verify", feed], { capture: true });
    records[buildVersion] = { sha256: hash, archive: name };
    writeJson(path.join(staging, "releases.json"), records);
    mkdirSync(directory, { recursive: true });
    // Publish archives and deltas before the feed, so a feed never points at incomplete bytes.
    cpSync(path.join(staging, name), path.join(directory, name));
    const deltas = readdirSync(staging).filter(file => file.endsWith(".delta"));
    for (const delta of deltas) cpSync(path.join(staging, delta), path.join(directory, delta));
    cpSync(path.join(staging, "releases.json"), recordsFile);
    const target = path.join(directory, path.basename(feed));
    const temporary = `${target}.${process.pid}.tmp`;
    cpSync(feed, temporary); renameSync(temporary, target);
    for (const file of readdirSync(directory)) if (file.endsWith(".delta") && !deltas.includes(file)) rmSync(path.join(directory, file));
    console.log(`Signed update ready: ${target}\nUpload the ZIP${deltas.length ? `, ${deltas.join(", ")}` : ""} and then the appcast to ${new URL(".", url).href}`);
    return { feed: target, archive: path.join(directory, name), deltas: deltas.map(delta => path.join(directory, delta)) };
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
