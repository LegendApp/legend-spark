import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify, isDeepStrictEqual } from "node:util";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { compareBuildNumbers, prepareUpdate, sparkleTools, verifyUpdateSignature } from "../packages/cli/src/updates.ts";
import { run } from "../packages/cli/src/commands.ts";
import { writeJson } from "../packages/cli/src/project.ts";
const root = mkdtempSync(path.join(os.tmpdir(), "spark-sparkle-test-"));
// Unique per run: the Sparkle client keeps preferences under the fixture identifier and URL caches under its executable name.
const runId = path.basename(root).replace(/[^A-Za-z0-9]/g, "");
const bundleIdentifier = `so.legend.spark.update-fixture.${runId}`;
const updater = path.join(root, `sparkle-updater-${runId}`);
const app = path.join(root, "Fixture.app");
let checked = false;
try {
  const bin = await sparkleTools(root);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).subarray(-32).toString("base64");
  const key = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64");
  const keyFile = path.join(root, "ephemeral-test-key"); writeFileSync(keyFile, seed, { mode: 0o600 });
  const feedURL = "https://example.com/updates/appcast.xml";
  writeJson(path.join(root, "app.json"), { expo: { macos: { bundleIdentifier }, extra: { spark: { projectId: "ephemeral-fixture", updates: { feedURL, publicKey: key, maximumDeltas: 2 } } } } });
  mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
  copyFileSync("/bin/echo", path.join(app, "Contents/MacOS/Fixture"));
  async function bundle(version: string) {
    writeJson(path.join(app, "Contents/Info.plist"), { CFBundleExecutable: "Fixture", CFBundleIdentifier: bundleIdentifier, CFBundleName: "Fixture", CFBundlePackageType: "APPL", CFBundleVersion: version, CFBundleShortVersionString: `1.${version}`, LSMinimumSystemVersion: "14.0", SUFeedURL: feedURL, SUPublicEDKey: key, SURequireSignedFeed: true, SUVerifyUpdateBeforeExtraction: true, SUEnableAutomaticChecks: false });
    await run(root, ["plutil", "-convert", "xml1", path.join(app, "Contents/Info.plist")], { capture: true });
    await run(root, ["codesign", "--force", "--sign", "-", app], { capture: true });
  }
  async function archive(version: string) {
    await bundle(version);
    const file = path.join(root, `fixture-${version}.zip`); await run(root, ["ditto", "-c", "-k", "--keepParent", app, file], { capture: true }); return file;
  }
  const deps = { run, tools: async () => bin, keyFile };
  const first = await archive("1");
  let result = await prepareUpdate(root, first, "1", deps);
  if (!result || !existsSync(result.feed)) throw new Error("No signed feed");
  const second = await archive("2"); result = await prepareUpdate(root, second, "2", deps);
  if (!result || !readFileSync(result.feed, "utf8").includes('<sparkle:version>2</sparkle:version>')) throw new Error("Second release missing");
  if (result.deltas.map(file => path.basename(file)).join() !== "Fixture2-1.delta") throw new Error(`Second release deltas: ${result.deltas}`);
  result = await prepareUpdate(root, second, "2", deps);
  if (result?.deltas.map(file => path.basename(file)).join() !== "Fixture2-1.delta") throw new Error(`Retried release deltas: ${result?.deltas}`);
  const rejects = async (archive: string, build: string, message: string) => {
    try { await prepareUpdate(root, archive, build, deps); } catch (error) { if (String(error).includes(message)) return; throw error; }
    throw new Error(`Accepted ${archive} as build ${build}`);
  };
  await rejects(first, "2", "different bytes");
  await rejects(first, "1.9", "must be greater");
  const third = await archive("3"); result = await prepareUpdate(root, third, "3", deps);
  if (!result) throw new Error("Third release missing");
  // Only this build's deltas are reported, kept in dist/updates and referenced by the feed, each signed over its exact bytes.
  const updates = path.join(root, "dist/updates");
  const feed = readFileSync(result.feed, "utf8");
  const deltas = [...feed.matchAll(/<enclosure url="[^"]*\/([^"/]+\.delta)"[^>]*sparkle:deltaFrom="(\d+)"[^>]*sparkle:edSignature="([^"]+)"/g)];
  const expected = ["Fixture3-1.delta", "Fixture3-2.delta"];
  const sorted = (files: string[]) => [...files].sort().join();
  if (sorted(result.deltas.map(file => path.basename(file))) !== expected.join() || sorted(readdirSync(updates).filter(file => file.endsWith(".delta"))) !== expected.join() || sorted(deltas.map(delta => delta[1])) !== expected.join()) throw new Error(`Expected only build 3 deltas: reported ${result.deltas}; feed ${feed}`);
  if (feed.split("<sparkle:deltas>").length !== 2 || feed.indexOf("<sparkle:deltas>") > feed.indexOf("<sparkle:version>2</sparkle:version>")) throw new Error(`Deltas outside the newest item: ${feed}`);
  for (const [, file, , signature] of deltas) verifyUpdateSignature(path.join(updates, decodeURIComponent(file)), signature, key);
  // Spark's publication order must match Sparkle's runtime comparator, which refuses downgrades.
  const pairs = [["1", "2"], ["2.9", "2.10"], ["1.10", "1.9"], ["1", "1.0"], ["2", "10"], ["1.2.3", "1.2"], ["9", "10"], ["0", "1"]];
  const source = path.join(root, "compare.m");
  writeFileSync(source, `#import <Sparkle/Sparkle.h>\nint main(int c, char **v) { @autoreleasepool { for (int i = 1; i + 1 < c; i += 2) printf("%ld\\n", (long)[[SUStandardVersionComparator defaultComparator] compareVersion:@(v[i]) toVersion:@(v[i + 1])]); } }`);
  const framework = path.dirname(bin);
  const clang = (input: string, output: string) => run(root, ["clang", "-fobjc-arc", "-F", framework, "-framework", "Sparkle", "-framework", "Foundation", "-Wl,-rpath," + framework, input, "-o", output], { capture: true });
  await clang(source, path.join(root, "compare"));
  const sparkle = (await run(root, [path.join(root, "compare"), ...pairs.flat()], { capture: true })).trim().split("\n").map(Number);
  pairs.forEach(([a, b], index) => { if (sparkle[index] !== compareBuildNumbers(a, b)) throw new Error(`Sparkle orders ${a} vs ${b} as ${sparkle[index]}, Spark as ${compareBuildNumbers(a, b)}`); });
  console.log("PASS: real Sparkle archive signing, signed appcast generation, feed verification, three releases, signed deltas for only the newest build (reported, retained and referenced), idempotency, conflicting and downgraded build rejection, publication order matches Sparkle's downgrade comparator; no Keychain mutation");

  // Runtime: a real SPUUpdater checks the signed feeds as an installed build, emitting Spark's events.
  await clang(path.join(import.meta.dirname, "sparkle-updater.m"), updater);
  type Output = { events: Record<string, unknown>[]; status: { skippedBuild: string | null; skippedMajorBuild: string | null } };
  // Sparkle fetches feeds over HTTP(S); this loopback server only serves feed files under root.
  const server = createServer((request, response) => {
    const file = path.join(root, new URL(request.url!, "http://127.0.0.1").pathname);
    if (!file.endsWith("appcast.xml") || !existsSync(file)) response.writeHead(404).end();
    else response.writeHead(200, { "content-type": "application/xml" }).end(readFileSync(file));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  // stdout carries only the client's JSON lines; Sparkle logs go to stderr.
  async function client(feedFile: string, mode: string, action: string) {
    checked = true;
    return (await promisify(execFile)(updater, [app, new URL(path.relative(root, feedFile), origin).href, mode, action], { timeout: 90000 })).stdout;
  }
  async function check(feedFile: string, installed: string, mode: "background" | "interactive", action: "install" | "skip" | "dismiss" | "clear"): Promise<Output> {
    await bundle(installed);
    const lines = (await client(feedFile, mode, action)).trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    const status = lines.pop()?.status as Output["status"] | undefined;
    if (!status) throw new Error(`No status from the Sparkle client: ${JSON.stringify(lines)}`);
    return { events: lines, status };
  }
  const expect = (label: string, actual: Output, events: object[], status: Output["status"]) => {
    const strip = actual.events.map(event => event.state === "error" && typeof event.message === "string" ? { type: event.type, state: event.state } : event);
    if (!isDeepStrictEqual(strip, events) || !isDeepStrictEqual(actual.status, status)) throw new Error(`${label}: expected ${JSON.stringify({ events, status })}, got ${JSON.stringify(actual)}`);
  };
  const none = { skippedBuild: null, skippedMajorBuild: null };
  const item = { type: "update", version: "1.3", build: "3" };
  const available = { ...item, state: "available" }, notAvailable = { type: "update", state: "notAvailable" }, failed = { type: "update", state: "error" };
  // Delta selection: build 1 has a published delta, so Sparkle downloads it first and reports the full-archive fallback when it fails.
  expect("delta from build 1", await check(result.feed, "1", "background", "install"), [available, { ...item, state: "downloading", delta: true }, { ...item, state: "downloading", delta: false }, failed], none);
  expect("no delta from build 0", await check(result.feed, "0", "interactive", "install"), [available, { ...item, state: "downloading", delta: false }, failed], none);
  // Downgrade refusal: a feed whose newest signed build is older than the installed one offers nothing.
  for (const mode of ["background", "interactive"] as const) expect(`downgrade ${mode}`, await check(result.feed, "4", mode, "install"), [notAvailable], none);
  expect("current build", await check(result.feed, "3", "background", "install"), [notAvailable], none);
  // Skip This Version and skip-major: event and status carry the same build; background checks honor the choice,
  // clearSkippedUpdate() forgets it, and an interactive check offers the build and clears the choice (Sparkle behavior).
  async function skips(label: string, feedFile: string, major: boolean) {
    const skipped = { skippedBuild: major ? null : "3", skippedMajorBuild: major ? "3" : null };
    for (const forget of ["clear", "interactive"] as const) {
      expect(`${label} skip`, await check(feedFile, "1", "background", "skip"), [available, { ...item, state: "skipped", major }], skipped);
      expect(`${label} skipped background`, await check(feedFile, "2", "background", "dismiss"), [notAvailable], skipped);
      if (forget === "clear") expect(`${label} clear`, await check(feedFile, "1", "background", "clear"), [], none);
      else expect(`${label} interactive`, await check(feedFile, "1", "interactive", "dismiss"), [available], none);
      expect(`${label} offered again after ${forget}`, await check(feedFile, "1", "background", "dismiss"), [available], none);
    }
  }
  await skips("minor", result.feed, false);
  // A major upgrade is an item whose minimumAutoupdateVersion (3) the installed build does not meet.
  const major = path.join(root, "major"); mkdirSync(major);
  copyFileSync(third, path.join(major, "fixture-3.zip"));
  await run(root, [path.join(bin, "generate_appcast"), "--ed-key-file", keyFile, "--major-version", "3", "--maximum-deltas", "0", "--download-url-prefix", "https://example.com/major/", "-o", path.join(major, "appcast.xml"), major], { capture: true });
  await skips("major", path.join(major, "appcast.xml"), true);
  server.close();
  console.log("PASS: real SPUUpdater with signed feeds: delta selected for a build with a delta, full-archive fallback reported with delta false, full archive without one; older-only feed offers no update in background and interactive checks; Skip This Version and skip-major events match status builds, background checks honor them, clearSkippedUpdate and interactive checks (which offer the build) forget them");
} finally {
  // Remove the client's preferences (through cfprefsd, then the empty file it leaves) and URL caches.
  if (checked) await run(root, ["defaults", "delete", bundleIdentifier], { capture: true });
  for (const name of [bundleIdentifier, path.basename(updater)]) {
    rmSync(path.join(os.homedir(), "Library/Preferences", `${name}.plist`), { force: true });
    for (const library of ["Caches", "HTTPStorages"]) rmSync(path.join(os.homedir(), "Library", library, name), { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
}
