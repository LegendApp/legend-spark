import { getAppContext } from "@legendapp/spark/app";
import * as windows from "@legendapp/spark/windows";
import * as clipboard from "@legendapp/spark/clipboard";
import { spawn, runCommand } from "@legendapp/spark/processes";
import { registerGlobalShortcut } from "@legendapp/spark/global-shortcuts";
import * as system from "@legendapp/spark/system";
import { openDatabase } from "@legendapp/spark/sqlite";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function runExpansionChecks(check: (name: string, action: () => Promise<void>) => Promise<void>) {
  const context = await getAppContext();
  if (context.launchArguments.includes("--spark-window-config-probe")) await check("canonical config reaches main window in this runtime", async () => {
    const main = await windows.getWindow();
    assert(main.title === "Configured main" && main.frame.width === 930 && !main.resizable && main.minWidth === 400 && main.maxWidth === 1400, `Wrong startup configuration: ${JSON.stringify(main)}`);
  });
  await check("window styles, constraints and child cleanup", async () => {
    const id = "expansion-window";
    try {
      const info = await windows.openWindow({ id, parentId: "main", title: "Style probe", width: 450, height: 300, minWidth: 300, maxWidth: 800, titleBarStyle: "overlay", resizable: false, alwaysOnTop: true });
      assert(!info.resizable && info.alwaysOnTop && info.minWidth === 300 && info.maxWidth === 800, `Window style did not reach AppKit: ${JSON.stringify(info)}`);
      await windows.setWindowOptions(id, { resizable: true, alwaysOnTop: false, material: "sidebar", appearance: "dark" });
      const changed = await windows.getWindow(id); assert(changed.resizable && !changed.alwaysOnTop, "Window update failed");
    } finally { await windows.closeWindow(id); }
  });
  await check("modal windows close programmatically and release their parent", async () => {
    await windows.openWindow({ id: "modal-probe", parentId: "main", modal: true, width: 450, height: 300 });
    let allow = false;
    const guard = await windows.beforeWindowClose("modal-probe", () => allow);
    await windows.closeWindow("modal-probe");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert((await windows.listWindows()).some(window => window.id === "modal-probe"), "Modal close ignored guard");
    allow = true;
    await windows.closeWindow("modal-probe");
    const deadline = Date.now() + 3000;
    while ((await windows.listWindows()).some(window => window.id === "modal-probe") && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    await guard.remove();
    assert(!(await windows.listWindows()).some(window => window.id === "modal-probe"), "Modal window remained open");
    await windows.openWindow({ id: "modal-next", parentId: "main", modal: true, width: 450, height: 300 });
    await windows.closeWindow("modal-next");
  });
  await check("process argv, input, stderr and streaming output", async () => {
    const chunks: Uint8Array[] = [];
    const child = await spawn({ target: { type: "executable", path: "/bin/cat" }, timeoutMs: 5000, onOutput: chunk => chunks.push(chunk.bytes) });
    await child.write("Unicode 🦀 input\n"); await child.closeInput();
    const result = await child.exited;
    assert(result.exit.type === "exited" && result.exit.code === 0 && new TextDecoder().decode(result.stdout) === "Unicode 🦀 input\n" && chunks.length > 0, "Process IO failed");
    const failure = await runCommand({ target: { type: "executable", path: "/bin/sh" }, args: ["-c", "printf error >&2; exit 7"] });
    assert(failure.exit.type === "exited" && failure.exit.code === 7 && new TextDecoder().decode(failure.stderr) === "error", "Exit status or stderr missing");
  });
  await check("process timeouts and cancellation reap children", async () => {
    const result = await runCommand({ target: { type: "executable", path: "/bin/sleep" }, args: ["10"], timeoutMs: 100 });
    assert(result.timedOut && result.exit.type === "terminated", "Timeout did not terminate process");
    const child = await spawn({ target: { type: "executable", path: "/bin/sleep" }, args: ["10"] }); await child.terminate();
    assert((await child.exited).exit.type === "terminated", "Cancellation did not terminate process");
  });
  await check("global shortcut multiple registrations and conflict cleanup", async () => {
    const first = await registerGlobalShortcut("Cmd+Shift+F18", () => {});
    try {
      const second = await registerGlobalShortcut("Cmd+Shift+F19", () => {}); await second.remove();
      let failed = false; try { await registerGlobalShortcut("Cmd+Shift+F18", () => {}); } catch { failed = true; }
      assert(failed, "Duplicate global shortcut unexpectedly registered");
    } finally { await first.remove(); }
    await (await registerGlobalShortcut("Cmd+Shift+F18", () => {})).remove();
  });
  await check("system state, startup availability and sleep assertion disposal", async () => {
    const state = await system.getSystemInfo(); assert(Number.isFinite(state.idleSeconds) && typeof state.dark === "boolean", "Invalid system state");
    assert((await system.getLoginItemStatus()) === "unavailable", "Development runtime could change login startup");
    const events = await system.onSystemEvent(() => {}); const blocker = await system.preventSleep({ reason: "Automated integration test" }); await blocker.remove(); await blocker.remove(); await events.remove();
  });
  await check("SQLite persistence, parameters and transaction rollback", async () => {
    let db = await openDatabase("expansion-test.sqlite");
    try {
      await db.run("DROP TABLE IF EXISTS checks"); await db.run("CREATE TABLE checks (id INTEGER PRIMARY KEY, value TEXT)");
      await db.run("INSERT INTO checks VALUES (?, ?)", [1, "literal ' parameter"]);
      try { await db.transaction(async transaction => { await transaction.run("INSERT INTO checks VALUES (2, 'rolled back')"); throw new Error("rollback"); }); } catch {}
      assert((await db.getAll("SELECT count(*) AS total FROM checks"))[0]?.total === 1, "Transaction did not roll back");
      await db.close(); db = await openDatabase("expansion-test.sqlite");
      assert((await db.getAll("SELECT value FROM checks WHERE id = ?", [1]))[0]?.value === "literal ' parameter", "Database did not persist");
    } finally { await db.close(); }
  });
}
