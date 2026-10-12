import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { runOk } from "./subprocess";
import { findDwarf, symbolicateReport } from "../packages/cli/src/symbolicate.ts";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/diagnostics/macos");
// The system crash reporter names its reports after the process, so this name marks the ones these tests cause.
const NAME = "spark-crash-reporting-test";
const REPORTS = path.join(os.homedir(), "Library/Logs/DiagnosticReports");

const SOURCES = [path.join(root, "tests/crash-reporting.native.mm"), path.join(macos, "SparkCrashReporter.mm"), path.join(macos, "SparkStack.mm")];
// Simulated crashes compile only with the test driver (docs/diagnostics.md#checking-your-reporting).
const compile = (flags: string[]) => [...flags, "-DSPARK_TEST_DRIVER=1", "-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos];
async function build(binary: string, flags: string[]) {
  await runOk("clang++", [...compile(flags), "-framework", "Foundation", ...SOURCES, "-o", binary], { timeout: 120_000 });
}
/** An optimized build with a dSYM, then stripped, as Xcode builds a release app. The objects stay until dsymutil has read their debug info. */
async function buildRelease(binary: string) {
  const objects = SOURCES.map(source => `${binary}-${path.basename(source)}.o`);
  for (const [index, source] of SOURCES.entries()) await runOk("clang++", [...compile(["-O2", "-g"]), "-c", source, "-o", objects[index]!], { timeout: 120_000 });
  await runOk("clang++", ["-framework", "Foundation", ...objects, "-o", binary], { timeout: 120_000 });
  await runOk("dsymutil", [binary, "-o", `${binary}.dSYM`]);
  await runOk("strip", [binary]);
  for (const object of objects) rmSync(object);
}
const pids = (output: string, label: string) => output.match(new RegExp(`^${label} pids: (.*)$`, "m"))![1]!.split(" ").filter(Boolean).map(Number);

/** The system crash reports (.ips) of these processes: this test's name, written since `since`, naming one of the pids. */
function systemReports(of: number[], since: number) {
  let names: string[] = [];
  try { names = readdirSync(REPORTS); } catch { return []; }
  return names.filter(name => name.startsWith(`${NAME}-`) && name.endsWith(".ips")).map(name => path.join(REPORTS, name))
    .filter(file => statSync(file).mtimeMs >= since && of.some(pid => readFileSync(file, "utf8").includes(`"pid" : ${pid},`)));
}

// Every crash happens in a child copy of the harness, never in the test process. Each build also runs optimized.
// Then a stripped build (as Xcode strips a release app) shows what a release build without its dSYM reports, and
// that `spark symbolicate` with the dSYM names the frames and their source lines.
// Crashes passed on to the system crash reporter leave .ips reports in ~/Library/Logs/DiagnosticReports; the test
// deletes the ones of its own processes. Simulated crashes leave none.
test.skipIf(process.platform !== "darwin")("crash reporter core: signals and exceptions recorded in children, passed on to earlier handlers and the system, symbolicated later", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-crash-reporting-native-"));
  const since = Date.now() - 1000;
  const chained: number[] = [], simulated: number[] = [];
  let ofSimulated: string[] = [];
  try {
    for (const optimization of ["-O0", "-O2"]) {
      const binary = path.join(directory, optimization, NAME);
      await runOk("mkdir", ["-p", path.dirname(binary)]);
      await build(binary, [optimization]);
      const output = await runOk(binary, [path.join(directory, `run${optimization}`)], { timeout: 120_000 });
      expect(output).toContain("Crash reporting native tests passed");
      chained.push(...pids(output, "chained"));
      simulated.push(...pids(output, "simulated"));
    }

    const stripped = path.join(directory, "stripped", NAME);
    await runOk("mkdir", ["-p", path.dirname(stripped)]);
    await buildRelease(stripped);
    const crashes = path.join(directory, "stripped-crashes");
    await runOk(stripped, ["crash", "badAccess", crashes]).catch(() => undefined); // It dies of SIGSEGV.
    const [report] = JSON.parse(await runOk(stripped, ["report", crashes]));
    const top = report.stack[0];
    expect(top).toMatchObject({ image: stripped.replace(/^\/var\//, "/private/var/"), imageUUID: expect.any(String), imageOffset: expect.any(Number) });
    // Stripped: the loader knows no name for it (or only a neighbouring exported one).
    expect(top.symbol).not.toBe("SparkCrashNow");
    // spark symbolicate finds the dSYM in its folder by the frame's UUID and names the frames with atos.
    const symbolicated = symbolicateReport(report, findDwarf([path.dirname(stripped)]));
    expect(symbolicated.stack[0]).toMatchObject({ symbol: "SparkCrashNow", location: expect.stringMatching(/^SparkCrashReporter\.mm:\d+$/) });
    expect(symbolicated.stack.map((frame: { symbol?: string }) => frame.symbol)).toEqual(expect.arrayContaining(["SparkTestCrash", "main"]));
    chained.push(Number(report.id.split("-").at(-1)));
    // abort() never returns, so the return address after its call is already the next function's; the frame names its caller.
    const aborts = path.join(directory, "stripped-aborts");
    await runOk(stripped, ["crash", "abort", aborts]).catch(() => undefined); // It dies of SIGABRT.
    const [aborted] = JSON.parse(await runOk(stripped, ["report", aborts]));
    expect(symbolicateReport(aborted, findDwarf([path.dirname(stripped)])).stack.map((frame: { symbol?: string }) => frame.symbol)).toEqual(expect.arrayContaining(["SparkCrashNow", "SparkTestCrash", "main"]));
    chained.push(Number(aborted.id.split("-").at(-1)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
    // The system crash reporter writes a little after each process dies; wait until it has settled.
    let count = -1;
    for (let waited = 0; waited < 30_000; waited += 3000) {
      const current = systemReports(chained, since).length;
      if (current === count && current > 0) break;
      count = current;
      await sleep(3000);
    }
    ofSimulated = systemReports(simulated, since);
    const created = systemReports([...chained, ...simulated], since);
    for (const file of created) rmSync(file, { force: true });
    console.log(`Deleted ${created.length} system crash report(s) of this test's children from ${REPORTS}`);
  }
  // A simulated crash exits from its handler, so the system crash reporter never sees it.
  expect(ofSimulated).toEqual([]);
}, 500_000);
