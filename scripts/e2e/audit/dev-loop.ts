// The gate's dev-loop audit (docs/e2e-flows.md#audits, #170): a real `spark dev` session of the Kitchen Sink with its
// dev build launched in driver mode (no window, no focus; scripts/testing/dev-session.ts), timed against the budgets of
// the reference MacBook Air (M1, 8 GB). Edits go to two Kitchen Sink files and are always restored.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readJson, stateFile } from "../../../packages/cli/src/project.ts";
import { startDevSession, type Cdp, type DevSession } from "../../testing/dev-session.ts";
import { KITCHEN_SINK } from "../kitchen-sink.ts";
import type { AuditResult } from "./bundle.ts";

/**
 * Budgets for the reference MacBook Air (M1, 8 GB), in milliseconds. They apply on every Mac: a faster one meets them
 * more easily. Not measured on the M1: they are three times what an M4 Max (Mac16,5) measured, rounded up (see
 * docs/e2e-flows.md#dev-loop-budgets); replace them with values measured on the reference machine.
 */
export const DEV_LOOP_BUDGETS = { coldStartMs: 45_000, fastRefreshMs: 2_000, nativeChangeMs: 5_000 };
export const DEV_LOOP_CHECKS = ["DX-LOOP-01", "DX-LOOP-02", "DX-LOOP-03", "DX-LOOP-04"] as const;

const MARKER = path.join(KITCHEN_SINK, "screens/devtools/FastRefreshMarker.tsx");
const CONFIG = path.join(KITCHEN_SINK, "desktop.config.json");
const REVISION = 'const REVISION = "1";';
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export async function auditDevLoop(): Promise<AuditResult[]> {
  const results = new Map<string, AuditResult>();
  const set = (check: string, ok: boolean, details: string[]) => results.set(check, { check, status: ok ? "passed" : "failed", details });
  const marker = readFileSync(MARKER, "utf8"), config = readFileSync(CONFIG, "utf8");
  if (!marker.includes(REVISION)) throw new Error(`${MARKER} no longer declares ${REVISION}`);
  const session = () => readJson(stateFile(KITCHEN_SINK, "session.json")) as { compatible: boolean; reason: string; canBuild?: boolean };
  let dev: DevSession | undefined;
  try {
    // DX-LOOP-01: from starting spark dev with an empty Metro cache to the dev build's first settled render.
    const started = performance.now();
    dev = await startDevSession({ prefix: "ks-dev-loop-", args: ["--clear"] });
    const { driver, name } = await dev.launch();
    await driver.startup(300_000);
    const coldMs = performance.now() - started;
    set("DX-LOOP-01", coldMs <= DEV_LOOP_BUDGETS.coldStartMs, [`spark dev --clear to the first settled render: ${seconds(coldMs)} (budget ${seconds(DEV_LOOP_BUDGETS.coldStartMs)})`]);

    const cdp: Cdp = await dev.connect(await dev.target(`${name} (shared runtime)`));
    await cdp.send("Runtime.enable");
    // A global set now survives a hot update and is gone after a reload of the runtime (the debugger stays attached).
    let sentinel = "";
    const arm = async () => { sentinel = `dx-loop-${performance.now()}`; await cdp.evaluate(`globalThis.__dxLoopSentinel = ${JSON.stringify(sentinel)}`); };
    const reloaded = async () => (await cdp.evaluate("globalThis.__dxLoopSentinel")) !== sentinel;
    const revision = () => cdp.evaluate("globalThis.ksDevToolsRevision");
    const edit = async (value: string, label: string) => {
      const begun = performance.now();
      writeFileSync(MARKER, marker.replace(REVISION, `const REVISION = "${value}";`));
      await dev!.until(async () => (await revision()) === value, label, 60_000);
      return performance.now() - begun;
    };
    const pid = driver.app.pid;

    // DX-LOOP-02: three edits, each a hot update of the running runtime.
    await arm();
    const latencies: number[] = [];
    for (const n of [1, 2, 3]) latencies.push(await edit(`dx-${n}`, `Fast Refresh delivers edit ${n}`));
    const hot = !await reloaded(), slowest = Math.max(...latencies);
    set("DX-LOOP-02", hot && slowest <= DEV_LOOP_BUDGETS.fastRefreshMs, [`edit to the running app: ${latencies.map(seconds).join(", ")} (budget ${seconds(DEV_LOOP_BUDGETS.fastRefreshMs)} each)`,
      hot ? "hot updates: the runtime's globals survived" : "the edits reloaded the JavaScript runtime (its globals are gone) instead of a hot update (#291)"]);

    // DX-LOOP-04: a syntax error shows the overlay; the fix dismisses it and refreshes without a reload.
    await arm();
    writeFileSync(MARKER, marker.replace(REVISION, `${REVISION} const broken = ;`));
    const overlay = await dev.until(async () => (await driver.elements()).elements.find(element => /SyntaxError/.test(`${element.text ?? ""} ${element.label ?? ""}`)), "the error overlay shows the syntax error", 30_000);
    const fixedMs = await edit("dx-fixed", "Fast Refresh resumes after the fix");
    await dev.until(async () => !(await driver.elements()).elements.some(element => /SyntaxError/.test(`${element.text ?? ""} ${element.label ?? ""}`)), "the error overlay closes", 30_000);
    const hotFix = !await reloaded();
    set("DX-LOOP-04", hotFix, [`the overlay showed ${JSON.stringify((overlay.text ?? overlay.label ?? "").split("\n")[0]!.slice(0, 160))}; the fix reached the app in ${seconds(fixedMs)} and closed it`,
      hotFix ? "no reload" : "the fix reloaded the JavaScript runtime instead of a hot update (#291)"]);

    // DX-LOOP-03: after the JavaScript edits the dev build is still compatible and the same process runs; a native
    // configuration change (the app's version, which Info.plist carries) needs a rebuild until it is reverted.
    const afterEdits = session(), samePid = driver.app.pid === pid && driver.app.exitCode === null;
    const changed = JSON.parse(config);
    changed.version = changed.version === "9.9.9" ? "9.9.8" : "9.9.9";
    const changedAt = performance.now();
    writeFileSync(CONFIG, JSON.stringify(changed, null, 2) + "\n");
    const stale = await dev.until(async () => { const state = session(); return !state.compatible && /Native configuration/.test(state.reason) && state; }, "spark dev reports the native change", 60_000);
    const detectMs = performance.now() - changedAt;
    writeFileSync(CONFIG, config);
    await dev.until(async () => session().compatible, "reverting the change makes the dev build compatible again", 60_000);
    set("DX-LOOP-03", afterEdits.compatible && samePid && !!stale.canBuild && detectMs <= DEV_LOOP_BUDGETS.nativeChangeMs, [
      `after ${latencies.length + 2} JavaScript edits: ${afterEdits.compatible ? "the dev build is compatible" : `incompatible (${afterEdits.reason})`}, ${samePid ? "the same app process runs" : "the app process changed"}`,
      `a native configuration change: "${stale.reason}"${stale.canBuild ? ", with a rebuild offered" : ", but no rebuild offered"}, in ${seconds(detectMs)} (budget ${seconds(DEV_LOOP_BUDGETS.nativeChangeMs)}); reverting it made the build compatible again`,
    ]);
  } catch (error) {
    dev?.printLogs();
    const message = error instanceof Error ? error.message : String(error);
    for (const check of DEV_LOOP_CHECKS) if (!results.has(check)) results.set(check, { check, status: "failed", details: [message] });
  } finally {
    writeFileSync(MARKER, marker);
    writeFileSync(CONFIG, config);
    await dev?.close();
  }
  return DEV_LOOP_CHECKS.map(check => results.get(check)!);
}
