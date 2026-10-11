import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { SdkSurface } from "../scripts/api-surface.ts";
import type { GateEnv, GateReport } from "../scripts/e2e/gate/gate.ts";
import type { Host } from "../scripts/e2e/gate/plan.ts";
import type { CommandHandler } from "../scripts/e2e/runner/backend.ts";
import { harnessProblems, releaseTargets, reportDir, requireHarnessPass } from "../scripts/harness/guard.ts";
import { guestScript, harnessCommand, type HarnessEnv, type HarnessReport } from "../scripts/harness/harness.ts";
import { judgeSignature, quarantineValue, verify } from "../scripts/harness/install.ts";
import { tartDriver, vmProblem } from "../scripts/harness/vm.ts";
import { element, MemoryBackend, VirtualClock } from "./e2e-runner-backend.ts";
import { FakeMac, FakeVm, guestArgs, type Signing } from "./release-harness-doubles.ts";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const AIR: Host = { os: "macos-14", arch: "arm64", model: "MacBookAir10,1", memoryGB: 8 };
const SEQUOIA: Host = { os: "macos-15", arch: "arm64", model: "VirtualMac2,1", memoryGB: 8 };
const SURFACE: SdkSurface = { "./app": { values: ["launch", "setTheme"], types: [], flags: {} } };
const SEQUOIA_SIGNOFF = `  - { flow: flows/app/ime, target: macos-15/arm64, commit: ${COMMIT}, verdict: pass, by: QA, at: "2026-10-10T12:00:00Z" }\n`;

/** A copy of the green gate fixture (tests/fixtures/e2e-gate) with its release build, as a git checkout unless `git: false`. */
function repo({ git = true } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "release-harness-"));
  cpSync("tests/fixtures/e2e-gate", dir, { recursive: true });
  mkdirSync(path.join(dir, "build/macos-arm64/KitchenSink.app/Contents"), { recursive: true });
  if (git) mkdirSync(path.join(dir, ".git"));
  writeFileSync(path.join(dir, "signoffs/release.yaml"), readFileSync(path.join(dir, "signoffs/release.yaml"), "utf8") + SEQUOIA_SIGNOFF);
  return dir;
}

/** A signed artifact on disk; FakeMac supplies its contents when it is mounted or extracted. */
function artifact(name: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "release-harness-artifact-")), name);
  writeFileSync(file, `bytes of ${name}`);
  return file;
}

type Options = { signing?: Signing; propagate?: boolean; host?: Host; dirty?: boolean; elements?: ReturnType<typeof element>[]; vm?: FakeVm; dir?: string };

/** The gate runs the fixture's flows on in-memory backends (tests/e2e-runner-backend.ts); `apps` records the app each backend was given. */
function env(options: Options = {}) {
  const clock = new VirtualClock(), out: string[] = [], err: string[] = [], apps: Array<string | undefined> = [];
  const mac = new FakeMac(options.signing ?? "notarized", options.propagate ?? true);
  const launchApp: CommandHandler = async () => { await clock.sleep(100); };
  const gate: GateEnv = {
    backends: {
      app: ({ app }) => { apps.push(app); return new MemoryBackend(clock, { name: "app", matrix: ["appearance"], elements: options.elements ?? [element("catalog", { id: "catalog" }), element("toggle", { id: "theme-toggle" })], commands: { launchApp } }); },
      driver: () => new MemoryBackend(clock, { name: "driver", kind: "driver", commands: { assertStartup: async (_args, context) => { context.metric("startup.coldMs", 690); } } }),
    },
    host: () => options.host ?? AIR,
    source: () => ({ commit: COMMIT, dirty: options.dirty ?? false }),
    verifySignature: () => undefined,
    surface: () => SURFACE,
    stdout: line => out.push(line),
    stderr: line => err.push(line),
    clock,
  };
  const harnessEnv: HarnessEnv = { repo: options.dir ?? repo(), gate, sh: mac.sh, vm: options.vm ?? new FakeVm(async () => { throw new Error("no VM expected"); }), bun: process.execPath, now: () => new Date("2026-10-11T08:00:00Z") };
  return { env: harnessEnv, mac, out, err, apps };
}

async function harness(args: string[], options: Options = {}) {
  const context = env(options);
  const code = await harnessCommand(args, context.env);
  const target = args.includes("--target") ? args[args.indexOf("--target") + 1] ?? "none" : (options.host ?? AIR) === AIR ? "macos-14/arm64@air-m1" : "macos-15/arm64";
  const dir = reportDir(context.env.repo, COMMIT, target);
  const report: HarnessReport | undefined = existsSync(path.join(dir, "report.json")) ? JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) : undefined;
  return { ...context, code, dir, report: report!, reasons: report?.reasons.map(reason => `${reason.check}: ${reason.message}`) ?? [] };
}

describe("release harness on this machine", () => {
  test("a notarized .zip installs as a quarantined download, verifies, and the gate runs against the installed app", async () => {
    const zip = artifact("KitchenSink-1.0-arm64.zip");
    const run = await harness(["--artifact", zip]);
    expect(run.code).toBe(0);
    expect(run.report).toMatchObject({ verdict: "PASS", releasable: true, local: false, target: "macos-14/arm64@air-m1", commit: COMMIT, dirty: false, reasons: [], environment: { kind: "host", host: AIR } });
    expect(run.report.artifact).toEqual({ file: zip, format: "zip", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const installed = run.report.install!.app;
    expect(installed).toMatch(/\/Applications\/KitchenSink\.app$/);
    expect(run.report.install!.quarantine).toBe("0081;00000000;;");
    expect(run.report.signature).toMatchObject({ summary: "Developer ID Application: Example Corp (ABCDE12345) / notarized", signature: "developer-id", teamId: "ABCDE12345", hardenedRuntime: true, timestamp: true, notarized: true, codesign: { valid: true } });
    // Downloaded, quarantined, then extracted into the fresh Applications folder.
    const downloaded = path.join(path.dirname(path.dirname(installed)), "Downloads", "KitchenSink-1.0-arm64.zip");
    expect(run.mac.calls.slice(0, 3)).toEqual([
      ["xattr", "-w", "com.apple.quarantine", quarantineValue(new Date("2026-10-11T08:00:00Z")), downloaded],
      ["ditto", "-x", "-k", downloaded, path.dirname(installed)],
      ["xattr", "-p", "com.apple.quarantine", installed],
    ]);
    expect(run.apps.every(app => app === installed)).toBe(true);
    const gate: GateReport = JSON.parse(readFileSync(path.join(run.dir, "gate/report.json"), "utf8"));
    expect([gate.verdict, gate.build.artifact, gate.run]).toEqual(["PASS", installed, path.relative(run.env.repo, path.join(run.dir, "gate/run"))]);
    expect(run.report.gate).toEqual({ verdict: "PASS", report: "gate/report.json", reasons: [] });
    expect(existsSync(path.join(run.dir, "gate/index.html"))).toBe(true);
    expect(existsSync(installed)).toBe(false); // The temporary install is removed.
    expect(run.out.at(-1)).toMatch(/^Harness PASS on macos-14\/arm64@air-m1 \(this machine\): releasable\. Report: /);
  });

  test("a .dmg is mounted read-only and its app copied out", async () => {
    const run = await harness(["--artifact", artifact("KitchenSink.dmg")]);
    expect(run.code).toBe(0);
    const volume = run.mac.calls.find(call => call[1] === "attach")!.at(-1)!;
    expect(run.mac.calls.find(call => call[1] === "attach")).toEqual(["hdiutil", "attach", expect.stringMatching(/\/Downloads\/KitchenSink\.dmg$/), "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", volume]);
    expect(run.mac.calls).toContainEqual(["ditto", path.join(volume, "KitchenSink.app"), run.report.install!.app]);
    expect(run.mac.calls).toContainEqual(["hdiutil", "detach", volume]);
    expect(run.report.artifact!.format).toBe("dmg");
  });

  test("release mode fails an ad-hoc, unnotarized build and never launches it", async () => {
    const run = await harness(["--artifact", artifact("KitchenSink.dmg")], { signing: "ad-hoc" });
    expect(run.code).toBe(1);
    expect(run.report).toMatchObject({ verdict: "FAIL", releasable: false, local: false });
    expect(run.report.signature!.summary).toBe("ad-hoc / not notarized");
    expect(run.reasons).toEqual([
      "signature: the app is signed ad-hoc; a release needs a Developer ID Application signature",
      expect.stringMatching(/^notarization: Gatekeeper rejected the app; a release must be notarized: .*KitchenSink\.app: rejected$/),
      "gate: not run: Gatekeeper would not let a person open this app",
    ]);
    expect(run.apps).toEqual([]);
    expect(existsSync(path.join(run.dir, "gate"))).toBe(false);
  });

  test("Developer ID without notarization or hardened runtime fails in release mode", async () => {
    const run = await harness(["--artifact", artifact("KitchenSink.zip")], { signing: "developer-id" });
    expect(run.reasons).toEqual([
      "signature: the signature does not enable the hardened runtime",
      "signature: the signature has no secure timestamp",
      expect.stringMatching(/^notarization: Gatekeeper rejected the app \(source=Unnotarized Developer ID\); a release must be notarized: /),
      "gate: not run: Gatekeeper would not let a person open this app",
    ]);
  });

  test("--local packages the ad-hoc release build as a DMG, installs it, reports it truthfully and runs the gate, but is never releasable", async () => {
    const run = await harness(["--local"], { signing: "ad-hoc" });
    expect(run.code).toBe(0);
    expect(run.report).toMatchObject({ verdict: "PASS", local: true, releasable: false, reasons: [] });
    expect(run.report.signature).toMatchObject({ summary: "ad-hoc / not notarized", signature: "ad-hoc", notarized: false, gatekeeper: { accepted: false } });
    const create = run.mac.calls.find(call => call[1] === "create")!;
    expect(create).toEqual(["hdiutil", "create", "-quiet", "-srcfolder", expect.stringMatching(/\/dmg$/), "-volname", "KitchenSink", "-format", "UDZO", "-o", expect.stringMatching(/\/KitchenSink\.dmg$/)]);
    expect(run.mac.calls).toContainEqual(["ditto", path.join(run.env.repo, "build/macos-arm64/KitchenSink.app"), path.join(create[4]!, "KitchenSink.app")]);
    expect(run.report.artifact).toEqual({ file: path.relative(run.env.repo, path.join(run.dir, "KitchenSink.dmg")), format: "dmg", sha256: expect.any(String), packagedFrom: "build/macos-arm64/KitchenSink.app" });
    expect(existsSync(path.join(run.dir, "KitchenSink.dmg"))).toBe(true);
    expect(run.report.gate!.verdict).toBe("PASS");
    expect(run.out.at(-1)).toContain("--local, not releasable");
  });

  test("a signature that does not verify fails even under --local, and the gate still runs", async () => {
    const run = await harness(["--local"], { signing: "broken" });
    expect(run.reasons).toEqual([expect.stringMatching(/^signature: codesign --verify --deep --strict failed: .*a sealed resource is missing or invalid$/)]);
    expect(run.report.gate!.verdict).toBe("PASS");
  });

  test("an install that loses the download's quarantine fails", async () => {
    const run = await harness(["--artifact", artifact("KitchenSink.dmg")], { propagate: false });
    expect(run.reasons).toEqual(["quarantine: the installed KitchenSink.app has no com.apple.quarantine attribute: installing from the dmg did not carry the download's quarantine"]);
  });

  test("a gate failure fails the harness and lists the gate's reasons", async () => {
    const run = await harness(["--artifact", artifact("KitchenSink.zip")], { elements: [element("catalog", { id: "catalog" })] });
    expect(run.code).toBe(1);
    expect(run.report.gate!.verdict).toBe("FAIL");
    expect(run.reasons).toEqual([expect.stringMatching(/^gate: the release gate failed \(artifacts\/harness\/.*\/gate\/index\.html\):\n {2}\[flows\] flows\/app\/theme\[appearance=light\]: .*\n {2}\[flows\] flows\/app\/theme\[appearance=dark\]: /)]);
  });

  test("an artifact that is missing or not a .dmg or .zip fails", async () => {
    expect((await harness(["--artifact", "/nowhere/KitchenSink.dmg"])).reasons).toEqual(["artifact: /nowhere/KitchenSink.dmg does not exist"]);
    expect((await harness(["--artifact", artifact("KitchenSink.pkg")])).reasons).toEqual([expect.stringMatching(/^artifact: .*KitchenSink\.pkg is not a \.dmg or \.zip; the harness installs macOS distributables$/)]);
    const dir = repo();
    const missing = await harness(["--local", "--target", "macos-15/arm64"], { host: SEQUOIA, dir: (cpSync(dir, `${dir}-nobuild`, { recursive: true }), writeFileSync(path.join(`${dir}-nobuild`, "e2e/gate.yaml"), readFileSync(path.join(dir, "e2e/gate.yaml"), "utf8").replace("build/macos-${ARCH}", "missing/macos-${ARCH}")), `${dir}-nobuild`) });
    expect(missing.reasons).toEqual(["artifact: the release build missing/macos-arm64/KitchenSink.app does not exist; build it with cd examples/kitchen-sink && bun run build"]);
  });

  test("a target this machine cannot be fails without installing, and suggests a VM when one fits", async () => {
    const vm = await harness(["--artifact", artifact("KitchenSink.zip"), "--target", "macos-15/arm64"]);
    expect(vm.reasons).toEqual([expect.stringMatching(/^target: --target macos-15\/arm64 needs macos-15\/arm64; this machine is macos-14\/arm64, .*, or bun run harness --vm <image> to install in a VM$/)]);
    expect(vm.mac.calls).toEqual([]);
    const windows = await harness(["--artifact", artifact("KitchenSink.zip"), "--target", "windows-11/x64"], { host: { os: "windows-11", arch: "x64" } });
    expect(windows.reasons).toEqual(["install: windows-11/x64: the harness installs macOS .dmg and .zip artifacts; Spark has no Windows release build to install yet"]);
  });

  test("usage errors exit 2", async () => {
    const cases: Array<[string[], string, boolean?]> = [
      [[], "a release run installs a signed artifact: pass --artifact <.dmg|.zip>, or --local"],
      [["--local", "--frobnicate"], "unknown argument --frobnicate"],
      [["--local", "--target"], "--target needs a value"],
      [["--local", "--vm", "ghcr.io/cirruslabs/macos-sequoia-vanilla:latest"], "--vm needs --target"],
      [["--local", "--commit", "abc"], "--commit must be a full 40-character commit SHA", false],
      [["--local", "--commit", COMMIT], "--commit is only for a source archive inside a VM"],
      [["--local", "--commit", COMMIT, "--vm", "image", "--target", "macos-15/arm64"], "--commit is set by --vm for the guest"],
      [["--local", "--target", "macos-99/arm64"], "--target macos-99/arm64 is not in gate.yaml"],
    ];
    for (const [args, message, git = true] of cases) {
      const run = await harness(args, { dir: repo({ git }) });
      expect([run.code, run.err.join("\n")]).toEqual([2, expect.stringContaining(message)]);
    }
  });
});

describe("release harness in a VM", () => {
  /** A guest that runs the real harness on a copy of the repository without .git, as the guest script does after unpacking. */
  function guest(host: Host, guestEnv: Options = {}) {
    const seen: { script?: string; share?: string[] } = {};
    const vm = new FakeVm(async (share, argv) => {
      seen.script = argv[2];
      seen.share = ["source.tar.gz", "bun", "KitchenSink.zip", "KitchenSink.dmg"].filter(name => existsSync(path.join(share, name)));
      const inside = repo({ git: false });
      const args = guestArgs(argv[2]!).map(arg => arg.replace("/Volumes/Guest Share", share));
      const context = env({ ...guestEnv, host, dir: inside });
      const code = await harnessCommand(args, context.env);
      cpSync(path.join(inside, "artifacts/harness"), path.join(share, "out"), { recursive: true });
      return { code, output: context.out.join("\n") };
    });
    return { vm, seen };
  }

  test("--vm boots a clone, installs inside on a git archive of the commit, takes the guest's report and disposes the clone", async () => {
    const { vm, seen } = guest(SEQUOIA);
    const zip = artifact("KitchenSink.zip");
    const run = await harness(["--artifact", zip, "--target", "macos-15/arm64", "--vm", "ghcr.io/cirruslabs/macos-sequoia-vanilla:latest"], { vm });
    expect(run.code).toBe(0);
    expect(vm.events).toEqual(["boot ghcr.io/cirruslabs/macos-sequoia-vanilla:latest", "exec", "dispose"]);
    expect(seen.share).toEqual(["source.tar.gz", "bun", "KitchenSink.zip"]);
    expect(run.mac.calls).toContainEqual(["git", "-C", run.env.repo, "archive", "--format=tar.gz", "-o", expect.stringMatching(/\/source\.tar\.gz$/), COMMIT]);
    expect(guestArgs(seen.script!)).toEqual(["--target", "macos-15/arm64", "--artifact", "/Volumes/Guest Share/KitchenSink.zip", "--commit", COMMIT]);
    expect(seen.script).toContain("bun install --frozen-lockfile");
    expect(run.report).toMatchObject({
      verdict: "PASS", releasable: true, target: "macos-15/arm64", commit: COMMIT,
      environment: { kind: "vm", host: SEQUOIA, vm: { driver: "fake", image: "ghcr.io/cirruslabs/macos-sequoia-vanilla:latest" } },
      artifact: { file: zip, format: "zip" },
    });
    expect(existsSync(path.join(run.dir, "gate/report.json"))).toBe(true);
    expect(run.out.at(-1)).toMatch(/^Harness PASS on macos-15\/arm64 \(fake VM ghcr\.io\/cirruslabs\/macos-sequoia-vanilla:latest\): releasable\./);
  });

  test("--vm --local packages the release build on the host and passes --local to the guest", async () => {
    const { vm, seen } = guest(SEQUOIA, { signing: "ad-hoc" });
    const run = await harness(["--local", "--target", "macos-15/arm64", "--vm", "image"], { vm, signing: "ad-hoc" });
    expect(guestArgs(seen.script!)).toEqual(["--target", "macos-15/arm64", "--artifact", "/Volumes/Guest Share/KitchenSink.dmg", "--commit", COMMIT, "--local"]);
    expect(run.report).toMatchObject({ verdict: "PASS", local: true, releasable: false, environment: { kind: "vm" }, artifact: { packagedFrom: "build/macos-arm64/KitchenSink.app" } });
  });

  test("a guest whose image is another macOS fails on the guest's target check", async () => {
    const { vm } = guest({ os: "macos-26", arch: "arm64", model: "VirtualMac2,1", memoryGB: 8 });
    const run = await harness(["--artifact", artifact("KitchenSink.zip"), "--target", "macos-15/arm64", "--vm", "tahoe"], { vm });
    expect(run.reasons).toEqual([expect.stringMatching(/^target: --target macos-15\/arm64 needs macos-15\/arm64; this machine is macos-26\/arm64/)]);
    expect(vm.events.at(-1)).toBe("dispose");
  });

  test("reference machines, Intel and Windows targets, and uncommitted changes never boot a VM", async () => {
    const { vm } = guest(SEQUOIA);
    const zip = artifact("KitchenSink.zip");
    expect((await harness(["--artifact", zip, "--target", "macos-14/arm64@air-m1", "--vm", "image"], { vm, host: SEQUOIA })).reasons).toEqual([
      "vm: macos-14/arm64@air-m1 is bound to the reference machine MacBook Air (M1, 2020), 8 GB; a VM is not that hardware, so run bun run harness on the machine itself",
    ]);
    expect((await harness(["--artifact", zip, "--target", "windows-11/x64", "--vm", "image"], { vm })).reasons).toEqual([
      "vm: windows-11/x64: there is no Windows VM driver, because Spark has no Windows release build to install yet (gate.yaml has no build.windows)",
    ]);
    expect((await harness(["--artifact", zip, "--target", "macos-15/arm64", "--vm", "image"], { vm, dirty: true })).reasons).toEqual([
      "source: the VM installs from a git archive of HEAD; commit your changes first",
    ]);
    expect(vm.events).toEqual([]);
    expect(vmProblem({ os: "macos-15", arch: "x64", id: "macos-15/x64" }, undefined)).toBe("macos-15/x64: tart runs Apple Silicon macOS guests only; run bun run harness on an Intel Mac");
  });

  test("a guest that writes no report fails, and the clone is disposed even when the command throws", async () => {
    const silent = new FakeVm(async () => ({ code: 70, output: "bun install failed" }));
    const run = await harness(["--artifact", artifact("KitchenSink.zip"), "--target", "macos-15/arm64", "--vm", "image"], { vm: silent });
    expect(run.reasons).toEqual(["vm: the guest wrote no harness report (exit 70); its output is above"]);
    expect(run.out).toContain("bun install failed");
    expect(silent.events).toEqual(["boot image", "exec", "dispose"]);
    const broken = new FakeVm(async () => { throw new Error("the guest agent went away"); });
    await expect(harness(["--artifact", artifact("KitchenSink.zip"), "--target", "macos-15/arm64", "--vm", "image"], { vm: broken })).rejects.toThrow("the guest agent went away");
    expect(broken.events).toEqual(["boot image", "exec", "dispose"]);
  });

  test("the guest script unpacks the archive, installs with the shared Bun, and copies reports back even on failure", () => {
    expect(guestScript("/Volumes/My Shared Files/harness", ["--target", "macos-15/arm64", "--artifact", "/Volumes/My Shared Files/harness/it's.dmg"])).toBe([
      "share='/Volumes/My Shared Files/harness'",
      'export PATH="$share:$PATH"',
      'dir="$HOME/spark-harness"',
      'rm -rf "$dir" && mkdir -p "$dir" && tar -xzf "$share/source.tar.gz" -C "$dir" && cd "$dir" && bun install --frozen-lockfile || exit 70',
      "bun scripts/harness/cli.ts '--target' 'macos-15/arm64' '--artifact' '/Volumes/My Shared Files/harness/it'\\''s.dmg'",
      "status=$?",
      'mkdir -p "$share/out" && cp -R artifacts/harness/. "$share/out/"',
      "exit $status",
    ].join("\n"));
  });
});

describe("tart driver", () => {
  function tart(results: Record<string, Array<{ code: number; output: string }>> = {}) {
    const calls: string[] = [];
    let killed = false;
    const driver = tartDriver({
      run: async argv => { calls.push(argv.join(" ")); return results[argv.slice(0, 2).join(" ")]?.shift() ?? { code: 0, output: "" }; },
      spawn: argv => { calls.push(`spawn ${argv.join(" ")}`); return { exited: Promise.resolve(0), kill: () => { killed = true; } }; },
      sleep: async () => {},
    });
    return { driver, calls, killed: () => killed };
  }

  test("boots a clone with the share mounted, waits for the guest agent, runs commands in it and deletes it", async () => {
    const { driver, calls, killed } = tart({ "tart exec": [{ code: 1, output: "agent not ready" }, { code: 0, output: "" }, { code: 0, output: "ran" }] });
    const guest = await driver.boot("ghcr.io/cirruslabs/macos-sequoia-vanilla:latest", "/tmp/share");
    expect(guest.share).toBe("/Volumes/My Shared Files/harness");
    expect(await guest.exec(["/bin/bash", "-c", "echo ran"])).toEqual({ code: 0, output: "ran" });
    await guest.dispose();
    const name = calls[0]!.split(" ").at(-1)!;
    expect(name).toMatch(/^spark-harness-\d+-\d+$/);
    expect(calls).toEqual([
      `tart clone ghcr.io/cirruslabs/macos-sequoia-vanilla:latest ${name}`,
      `spawn tart run ${name} --no-graphics --dir=harness:/tmp/share`,
      `tart ip ${name} --wait 300`,
      `tart exec ${name} true`,
      `tart exec ${name} true`,
      `tart exec ${name} /bin/bash -c echo ran`,
      `tart stop ${name}`,
      `tart delete ${name}`,
    ]);
    expect(killed()).toBe(true);
  });

  test("a clone that never boots is stopped and deleted, and the error says why", async () => {
    const { driver, calls } = tart({ "tart ip": [{ code: 1, output: "no IP address found" }] });
    await expect(driver.boot("image", "/tmp/share")).rejects.toThrow(/^tart ip spark-harness-\d+-\d+ --wait 300 exited 1: no IP address found$/);
    expect(calls.slice(-2)).toEqual([expect.stringMatching(/^tart stop /), expect.stringMatching(/^tart delete /)]);
    const clone = tart({ "tart clone": [{ code: 1, output: "image not found" }] });
    await expect(clone.driver.boot("missing", "/tmp/share")).rejects.toThrow("image not found");
    expect(clone.calls).toHaveLength(1);
  });
});

describe("signature verification", () => {
  test("reads codesign and spctl output and judges it per mode", () => {
    const mac = new FakeMac("ad-hoc");
    const adhoc = verify("/x/KitchenSink.app", mac.sh);
    expect(adhoc).toMatchObject({ signature: "ad-hoc", authority: undefined, hardenedRuntime: false, notarized: false, codesign: { valid: true }, gatekeeper: { accepted: false, source: undefined } });
    expect(judgeSignature(adhoc, true)).toEqual([]);
    expect(judgeSignature(adhoc, false).map(reason => reason.check)).toEqual(["signature", "notarization"]);
    mac.signing = "notarized";
    const notarized = verify("/x/KitchenSink.app", mac.sh);
    expect(notarized).toMatchObject({ signature: "developer-id", gatekeeper: { accepted: true, source: "Notarized Developer ID" }, notarized: true });
    expect(judgeSignature(notarized, false)).toEqual([]);
  });
});

describe("publish guard", () => {
  test("the release targets are the macOS Apple Silicon gate targets, reference machines included", () => {
    expect(releaseTargets(repo())).toEqual(["macos-14/arm64@air-m1", "macos-15/arm64"]);
    expect(releaseTargets(path.resolve("."))).toEqual(["macos-14/arm64@macbook-air-m1-8gb", "macos-15/arm64", "macos-26/arm64", "macos-27/arm64", "macos-27/arm64@macbook-pro-14-base"]);
  });

  test("refuses without a passing non-local report for this exact commit on every release target, and accepts real passing reports", async () => {
    const dir = repo();
    expect(harnessProblems(dir, COMMIT)).toEqual([
      `macos-14/arm64@air-m1: no harness report at artifacts/harness/${COMMIT}/macos-14-arm64@air-m1/report.json; run bun run harness --target macos-14/arm64@air-m1 --artifact <signed .dmg or .zip> for ${COMMIT}`,
      `macos-15/arm64: no harness report at artifacts/harness/${COMMIT}/macos-15-arm64/report.json; run bun run harness --target macos-15/arm64 --artifact <signed .dmg or .zip> for ${COMMIT}`,
    ]);
    await harness(["--local"], { dir, signing: "ad-hoc" });
    await harness(["--artifact", artifact("KitchenSink.zip"), "--target", "macos-15/arm64"], { dir, host: SEQUOIA, signing: "ad-hoc" });
    expect(harnessProblems(dir, COMMIT)).toEqual([
      `macos-14/arm64@air-m1: artifacts/harness/${COMMIT}/macos-14-arm64@air-m1/report.json is from a --local run, which is never releasable`,
      expect.stringMatching(/^macos-15\/arm64: the harness did not pass: \[signature\] the app is signed ad-hoc; .*; \[notarization\] .*; \[gate\] not run: /),
    ]);
    expect(() => requireHarnessPass(dir, COMMIT)).toThrow(/^Refusing to publish 0123456789abcdef0123456789abcdef01234567: every release target needs a passing harness report for this build/);
    await harness(["--artifact", artifact("KitchenSink.zip")], { dir });
    await harness(["--artifact", artifact("KitchenSink.dmg"), "--target", "macos-15/arm64"], { dir, host: SEQUOIA });
    expect(harnessProblems(dir, COMMIT)).toEqual([]);
    expect(() => requireHarnessPass(dir, COMMIT)).not.toThrow();
    const other = "f".repeat(40);
    expect(harnessProblems(dir, other)).toHaveLength(2);
    // A report copied to another commit's directory does not certify that commit.
    cpSync(path.join(dir, "artifacts/harness", COMMIT), path.join(dir, "artifacts/harness", other), { recursive: true });
    expect(harnessProblems(dir, other)).toEqual([
      `macos-14/arm64@air-m1: artifacts/harness/${other}/macos-14-arm64@air-m1/report.json is not a harness report for macos-14/arm64@air-m1 at ${other}`,
      `macos-15/arm64: artifacts/harness/${other}/macos-15-arm64/report.json is not a harness report for macos-15/arm64 at ${other}`,
    ]);
  });
});
