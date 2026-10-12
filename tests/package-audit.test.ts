import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AuditOptions } from "../scripts/e2e/audit/bundle.ts";
import { auditPackage, PACKAGE_CHECKS } from "../scripts/e2e/audit/package.ts";
import { parseCheckRegistry } from "../scripts/e2e/format/parser.ts";
import { createDmg } from "../packages/cli/src/dmg.ts";
import { sh, type Sh } from "../scripts/harness/install.ts";
import { FakeMac } from "./release-harness-doubles.ts";

const darwin = process.platform === "darwin";
const run = (command: string, ...args: string[]) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const FEED = "https://updates.example.com/app/appcast.xml";
const keys = generateKeyPairSync("ed25519");
const PUBLIC_KEY = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const edSign = (bytes: Buffer) => sign(null, bytes, keys.privateKey).toString("base64");

type Fixture = { options: AuditOptions; dir: string; zip: string };

/**
 * A spark package output made as `spark package` makes it: a real arm64 app (compiled, ad-hoc signed, with a dSYM) in
 * `App-1.2.0-arm64.zip`, its dSYMs archive, a signed Sparkle feed whose update is the package and, with `dmg`, its
 * `App-1.2.0-arm64.dmg` made by spark package's createDmg. `change` edits the app's Info.plist, archiving, the feed or
 * the names.
 */
async function fixture(root: string, name: string, change: { info?: Record<string, unknown>; feed?: (xml: string) => string; zipArgs?: string[]; dsyms?: boolean; zipName?: string; signed?: (app: string) => void; dmg?: boolean } = {}): Promise<Fixture> {
  const dir = path.join(root, name), stage = path.join(root, `${name}-stage`), app = path.join(stage, "App.app");
  mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
  mkdirSync(path.join(app, "Contents/Resources"), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(stage, "main.c"), "int main(void) { return 0; }\n");
  // Compiled outside the app: cc -g leaves a dSYM next to its output.
  run("cc", "-arch", "arm64", "-mmacosx-version-min=14.0", "-g", "-o", path.join(stage, "App"), path.join(stage, "main.c"));
  run("dsymutil", path.join(stage, "App"), "-o", path.join(stage, "dSYMs/App.app.dSYM"));
  cpSync(path.join(stage, "App"), path.join(app, "Contents/MacOS/App"));
  const info = {
    CFBundleIdentifier: "so.legend.app", CFBundleExecutable: "App", CFBundlePackageType: "APPL", CFBundleShortVersionString: "1.2.0", CFBundleVersion: "7",
    LSMinimumSystemVersion: "14.0", SUFeedURL: FEED, SUPublicEDKey: PUBLIC_KEY, SURequireSignedFeed: true, ...change.info,
  };
  writeFileSync(path.join(app, "Contents/Info.plist"), JSON.stringify(info));
  run("plutil", "-convert", "xml1", path.join(app, "Contents/Info.plist"));
  writeFileSync(path.join(app, "Contents/Resources/spark-runtime.json"), JSON.stringify({ fingerprint: "f1", sourceRevision: "a".repeat(40) }));
  run("codesign", "--force", "--sign", "-", "--options", "runtime", app);
  change.signed?.(app);
  const zip = path.join(dir, change.zipName ?? "App-1.2.0-arm64.zip");
  run("ditto", "-c", "-k", ...(change.zipArgs ?? ["--norsrc"]), "--keepParent", app, zip);
  if (change.dsyms !== false) run("ditto", "-c", "-k", "--norsrc", "--keepParent", path.join(stage, "dSYMs"), path.join(dir, `${path.basename(zip, ".zip")}-dSYMs.zip`));
  if (change.dmg) await createDmg(app, zip.replace(/\.zip$/, ".dmg"), async argv => run(argv[0]!, ...argv.slice(1)));
  // The feed spark package writes with generate_appcast: the update archive next to it, signed, and the feed signed.
  const updates = path.join(dir, "updates"), update = path.join(updates, "App-1.2.0-arm64-build-7.zip");
  mkdirSync(updates);
  cpSync(zip, update);
  const xml = `<?xml version="1.0" standalone="yes"?><rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0"><channel><title>App</title>
<item><title>1.1.0</title><sparkle:version>6</sparkle:version><sparkle:shortVersionString>1.1.0</sparkle:shortVersionString></item>
<item><title>1.2.0</title><sparkle:version>7</sparkle:version><sparkle:shortVersionString>1.2.0</sparkle:shortVersionString><sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion><sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>
<enclosure url="https://updates.example.com/app/App-1.2.0-arm64-build-7.zip" length="${readFileSync(update).length}" type="application/octet-stream" sparkle:edSignature="${edSign(readFileSync(update))}"></enclosure></item>
</channel></rss>`;
  const body = Buffer.from((change.feed ?? (text => text))(xml));
  writeFileSync(path.join(updates, "appcast.xml"), Buffer.concat([body, Buffer.from(`<!-- sparkle-signatures:\nedSignature: ${edSign(body)}\nlength: ${body.length}\n-->\n`)]));
  return { dir, zip, options: { app, platform: "macos", arch: "arm64", appId: "so.legend.app", package: dir } };
}

/** FakeMac's signing tools with the real hdiutil, which mounts the fixture's real DMG. */
const withDisks = (mac: FakeMac): Sh => argv => argv[0] === "hdiutil" ? sh(argv) : mac.sh(argv);
const statuses = async (options: AuditOptions, mac = new FakeMac("notarized"), run = withDisks(mac)) => Object.fromEntries((await auditPackage(options, run)).map(result => [result.check, result]));

describe.skipIf(!darwin)("package audit on a real package", () => {
  let root: string;
  beforeAll(() => { root = mkdtempSync(path.join(tmpdir(), "package-audit-")); });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("a Developer ID signed, notarized package with dSYMs and a signed feed passes every check", async () => {
    const results = await statuses((await fixture(root, "clean", { dmg: true })).options);
    for (const id of PACKAGE_CHECKS) expect([id, results[id]!.status, results[id]!.details]).toEqual([id, "passed", expect.any(Array)]);
    expect(results["DIST-PKG-04"]!.details[0]).toMatch(/^1 Mach-O binaries have arm64 code, needing at most macOS 14\.0 \(LSMinimumSystemVersion 14\.0\); the executable is arm64 only$/);
    expect(results["DIST-PKG-05"]!.details[0]).toBe("appcast.xml is signed; build 7 (1.2.0) is the newest of 2 item(s); 1 enclosure(s) signed, and the update is App-1.2.0-arm64.zip");
    expect(results["DIST-PKG-06"]!.details[0]).toMatch(/^Developer ID Application: Example Corp \(ABCDE12345\) \/ notarized \/ stapled; /);
    expect(results["DIST-PKG-08"]!.details).toEqual(["App-1.2.0-arm64.dmg (UDZO, mounted read-only) holds exactly App.app, the same files as the ZIP's, whose signature codesign --verify --deep --strict accepts, and an Applications link to /Applications; no extended attributes"]);
    expect(results["DIST-PKG-09"]!.details).toEqual(["App-1.2.0-arm64.dmg: Developer ID Application: Example Corp (ABCDE12345), timestamped; notarization ticket stapled; Gatekeeper accepts opening it (Notarized Developer ID)"]);
  }, 120_000); // Runs every check on a real signed package and DMG: seconds locally, much slower on a loaded CI runner.

  test("the DMG must be there, mount read-only, hold exactly the ZIP's app and the Applications link, store no attributes, and be detached again", async () => {
    const missing = await statuses((await fixture(root, "no-dmg")).options);
    for (const id of ["DIST-PKG-08", "DIST-PKG-09"]) expect(missing[id]!.details).toEqual(["App-1.2.0-arm64.dmg is missing next to App-1.2.0-arm64.zip; spark package writes it"]);
    // A writable image of another app, with a stray file and an attribute from the build machine.
    const odd = await fixture(root, "odd-dmg"), stage = path.join(root, "odd-dmg-image");
    mkdirSync(stage);
    cpSync(odd.options.app, path.join(stage, "App.app"), { recursive: true });
    writeFileSync(path.join(stage, "App.app/Contents/Resources/extra.txt"), "extra");
    run("xattr", "-w", "com.example.builder", "x", path.join(stage, "App.app/Contents/Info.plist"));
    writeFileSync(path.join(stage, "README.txt"), "read me");
    run("hdiutil", "create", "-quiet", "-srcfolder", stage, "-format", "UDRW", "-o", path.join(odd.dir, "App-1.2.0-arm64.dmg"));
    const mac = new FakeMac("notarized"), disks = withDisks(mac), mounts: string[] = [];
    const found = await statuses(odd.options, mac, async argv => { if (argv[0] === "hdiutil" && ["attach", "detach"].includes(argv[1]!)) mounts.push(`${argv[1]} ${argv.at(argv[1] === "attach" ? -1 : 2)}`); return disks(argv); });
    expect(found["DIST-PKG-08"]!.details).toEqual([
      "App-1.2.0-arm64.dmg is a UDRW image, not a compressed read-only one (UDZO, UDBZ, ULFO, ULMO)",
      "App-1.2.0-arm64.dmg holds App.app, README.txt; it must hold exactly App.app and an Applications link",
      "its App.app is not the ZIP's: their files, modes or links differ",
      expect.stringMatching(/^codesign --verify --deep --strict rejects its App\.app: .*a sealed resource is missing or invalid/s),
      expect.stringMatching(/^App-1\.2\.0-arm64\.dmg stores extended attributes of the build machine \(.*com\.example\.builder.*\)$/),
    ]);
    expect(mounts).toEqual([expect.stringMatching(/^attach .*\/spark-package-dmg-\w+$/), mounts[0]!.replace("attach", "detach")]);
    expect(existsSync(mounts[0]!.slice("attach ".length))).toBe(false);
  }, 120_000); // Makes and mounts real disk images: seconds locally, much slower on a loaded CI runner.

  test("finds stored attributes, a missing dSYMs archive, another build, the wrong architecture and a broken feed", async () => {
    const leaky = await fixture(root, "leaky", { zipArgs: ["--sequesterRsrc"], dsyms: false, signed: app => run("xattr", "-w", "com.example.builder", "x", path.join(app, "Contents/Resources/spark-runtime.json")) });
    const results = await statuses(leaky.options);
    expect(results["DIST-PKG-01"]!.details).toEqual([expect.stringMatching(/^App-1\.2\.0-arm64\.zip stores extended attributes of the build machine in \d+ AppleDouble entries \(.*com\.example\.builder.*\); archive with ditto --norsrc$/)]);
    expect(results["DIST-PKG-02"]!.details).toEqual(["App-1.2.0-arm64-dSYMs.zip is missing next to App-1.2.0-arm64.zip: the release's crash reports could not be symbolicated"]);

    const other = await fixture(root, "other", { zipName: "App-1.3.0-arm64.zip", info: { LSMinimumSystemVersion: "13.0" }, feed: xml => xml.replace("<sparkle:version>6<", "<sparkle:version>8<").replace("<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>", "") });
    const build = (await fixture(root, "build")).options.app;
    const found = await statuses({ ...other.options, app: build });
    expect(found["DIST-PKG-03"]!.details).toEqual(["App-1.3.0-arm64.zip names version 1.3.0; the app's CFBundleShortVersionString is 1.2.0"]);
    expect(found["DIST-PKG-04"]!.details).toEqual(["Contents/MacOS/App needs macOS 14.0; LSMinimumSystemVersion is 13.0, so it would fail to load there"]);
    expect(found["DIST-PKG-05"]!.details).toEqual([
      "build 7 is not the newest item; 8 is",
      "the item's sparkle:minimumSystemVersion is 14.0; Info.plist says 13.0",
      "the arm64-only item has no sparkle:hardwareRequirements arm64, so Intel Macs would download it",
    ]);
    expect((await statuses({ ...(await fixture(root, "intel", { zipName: "App-1.2.0-x64.zip" })).options, arch: "x64" }))["DIST-PKG-04"]!.details).toEqual(["Contents/MacOS/App has no x86_64 code (arm64)"]);
  }, 120_000); // Builds, signs and audits real packages: seconds locally, much slower on a loaded CI runner.

  test("an unsigned or tampered feed fails, and an app without SUFeedURL needs none", async () => {
    const tampered = await fixture(root, "tampered");
    writeFileSync(path.join(tampered.dir, "updates/appcast.xml"), readFileSync(path.join(tampered.dir, "updates/appcast.xml"), "utf8").replace("<title>App</title>", "<title>Evil</title>"));
    expect((await statuses(tampered.options))["DIST-PKG-05"]!.details).toEqual(["appcast.xml: its signature does not verify with SUPublicEDKey"]);
    const unsigned = await fixture(root, "unsigned", { info: { SURequireSignedFeed: false } });
    writeFileSync(path.join(unsigned.dir, "updates/appcast.xml"), readFileSync(path.join(unsigned.dir, "updates/appcast.xml"), "utf8").replace(/<!-- sparkle-signatures:[\s\S]*$/, ""));
    expect((await statuses(unsigned.options))["DIST-PKG-05"]!.details).toEqual(["SURequireSignedFeed is not true: Sparkle would accept an unsigned feed", "appcast.xml is not signed (no sparkle-signatures block)"]);
    const local = await fixture(root, "local", { info: { SUFeedURL: undefined } });
    expect((await statuses(local.options))["DIST-PKG-05"]).toEqual({ check: "DIST-PKG-05", status: "passed", details: ["the app has no SUFeedURL: it does not update through Sparkle, so the package has no feed"] });
  }, 120_000); // Builds, signs and audits real packages: seconds locally, much slower on a loaded CI runner.

  test("an ad-hoc package fails the credentials check; a quarantine that does not reach the app fails", async () => {
    const { options } = await fixture(root, "ad-hoc", { dmg: true });
    const adHoc = await statuses(options, new FakeMac("ad-hoc"));
    expect(adHoc["DIST-PKG-06"]!.status).toBe("failed");
    expect(adHoc["DIST-PKG-06"]!.details[0]).toBe("the app is signed ad-hoc; a release needs a Developer ID Application signature");
    const unsigned = new FakeMac("ad-hoc");
    unsigned.failures.set("codesign", { code: 1, stdout: "", stderr: "code object is not signed at all" });
    const dmg = await statuses(options, unsigned);
    expect(dmg["DIST-PKG-09"]!.status).toBe("failed");
    expect(dmg["DIST-PKG-09"]!.details.slice(0, 2)).toEqual(["codesign --verify --strict rejects App-1.2.0-arm64.dmg: code object is not signed at all", "App-1.2.0-arm64.dmg is not signed; a release DMG needs a Developer ID Application signature"]);
    const lost = await statuses(options, new FakeMac("notarized", false));
    expect(lost["DIST-PKG-07"]!.details[0]).toMatch(/^installing App-1\.2\.0-arm64\.zip as a quarantined download failed: the installed KitchenSink\.app has no com\.apple\.quarantine attribute/);
  }, 120_000); // Builds, signs and audits real packages: seconds locally, much slower on a loaded CI runner.
});

describe("package audit", () => {
  test("fails closed without a package and reports Windows unsupported", async () => {
    const options: AuditOptions = { app: "/nowhere/App.app", platform: "macos", arch: "arm64", appId: "so.legend.app" };
    expect(new Set((await auditPackage(options)).map(result => `${result.status}: ${result.details.join("; ")}`))).toEqual(new Set(["failed: gate.yaml sets no build.macos.package"]));
    expect(new Set((await auditPackage({ ...options, package: "/nowhere/dist" })).map(result => result.details[0]))).toEqual(new Set(["the package folder /nowhere/dist does not exist; run spark package"]));
    expect((await auditPackage({ ...options, platform: "windows", package: "dist" })).every(result => result.status === "unsupported")).toBe(true);
  });

  test("the packaging-distribution registry lists exactly the package audit's checks", () => {
    const registry = parseCheckRegistry(readFileSync("e2e/checks/packaging-distribution.yaml", "utf8"), "packaging-distribution.yaml");
    expect(Object.entries(registry.checks).filter(([, check]) => check.audit === "package").map(([id]) => id)).toEqual([...PACKAGE_CHECKS]);
  });
});
