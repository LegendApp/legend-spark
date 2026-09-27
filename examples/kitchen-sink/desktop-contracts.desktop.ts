import { runFileStreamChecks } from "./file-stream-checks";
import { runFoundationChecks } from "./foundation-checks";
import { assertContract } from "./contract-cases";
import * as processes from "@legendapp/spark/processes";
import { Platform } from "react-native";
import { testConfig } from "./platform-test-config";
import * as files from "@legendapp/spark/files";
import * as clipboard from "@legendapp/spark/clipboard";
import * as documents from "@legendapp/spark/app/documents";
import { settings } from "@legendapp/spark/settings";
import { filesystemLifecycle, settingsLifecycle, recentDocumentsLifecycle, richClipboardLifecycle, processLifecycle } from "./desktop-contract-cases";
export async function runDesktopContracts(check: (id: string, action: () => Promise<void>) => Promise<void>, token: string) {
  await runFoundationChecks(check);
  await runFileStreamChecks(check);
  await check("desktop.nitro", async () => {
    const { NitroModules } = await import("react-native-nitro-modules");
    assertContract(NitroModules.version === "0.35.7" && NitroModules.isHybridObject(NitroModules), "Native Nitro proxy is missing or incompatible");
    const buffer = NitroModules.createNativeArrayBuffer(16); new Uint8Array(buffer).set([0, 127, 255]);
    assertContract(buffer.byteLength === 16 && new Uint8Array(buffer)[2] === 255, "Native buffer did not round-trip");
    assertContract(NitroModules.box(NitroModules).unbox().equals(NitroModules), "Hybrid object boxing lost identity");
  });
  await check("desktop.sqlite", async () => {
    const { openDatabase } = await import("@legendapp/spark/sqlite");
    let db = await openDatabase(`contract-${token.replace(/[^a-zA-Z0-9_-]/g, "")}.sqlite`);
    try {
      await db.run("CREATE TABLE checks (id INTEGER PRIMARY KEY, value TEXT, bytes BLOB)");
      await db.run("INSERT INTO checks VALUES (?, ?, ?)", [1, "Unicode 👋 and ' parameter", new Uint8Array([0, 128, 255])]);
      try { await db.transaction(async transaction => { await transaction.run("INSERT INTO checks VALUES (2, 'rollback', NULL)"); throw new Error("rollback"); }); } catch {}
      assertContract((await db.getFirst("SELECT count(*) AS total FROM checks"))?.total === 1, "Transaction rollback failed");
      await db.close(); db = await openDatabase(`contract-${token.replace(/[^a-zA-Z0-9_-]/g, "")}.sqlite`);
      const row = (await db.getAll("SELECT value, bytes FROM checks WHERE id = ?", [1]))[0];
      assertContract(row?.value === "Unicode 👋 and ' parameter" && row.bytes instanceof Uint8Array && row.bytes[2] === 255, "Persisted SQLite parameters or blob changed");
    } finally {
      await db.close();
      const { getDirectory, remove } = await import("@legendapp/spark/files");
      await remove(`${await getDirectory("data")}/contract-${token.replace(/[^a-zA-Z0-9_-]/g, "")}.sqlite`);
    }
  });
  await check("desktop.runtimes", async () => {
    const { ThreadedRuntime } = await import("@react-native-runtimes/core");
    const { runtimeProbe, runtimeFailure } = await import("./platform-runtime-tasks");
    const worker = `contract-${token}`;
    try {
      const first = await ThreadedRuntime.run(worker, runtimeProbe, 4);
      const second = await ThreadedRuntime.run(worker, runtimeProbe, 5);
      assertContract(!first.main && first.name === worker && first.count === 4 && second.count === 9 && first.hermes, "Worker did not retain an independent Hermes heap");
      const local = await runtimeProbe(1);
      assertContract(local.main && local.count === 1, "Worker mutated the main runtime's heap");
      let rejected = false; try { await ThreadedRuntime.run(worker, runtimeFailure); } catch (error) { rejected = String(error).includes("contract-worker-error"); }
      assertContract(rejected, "Worker exception was not returned to the caller");
      assertContract((await ThreadedRuntime.getRuntimeNames()).includes(worker), "Worker is missing from enumeration");
    } finally { await ThreadedRuntime.destroy(worker); }
    assertContract(!(await ThreadedRuntime.getRuntimeNames()).includes(worker), "Destroyed worker remains registered");
    try { assertContract((await ThreadedRuntime.run(worker, runtimeProbe, 2)).count === 2, "Recreated worker retained the old heap"); }
    finally { await ThreadedRuntime.destroy(worker); }
  });
  await check("desktop.rich-clipboard", () => richClipboardLifecycle(files, clipboard, token));
  if (testConfig.processExecutable) await check("desktop.processes", () => processLifecycle(files, processes, testConfig.processExecutable!, Platform.OS === "windows", token));
  await check("desktop.filesystem", () => filesystemLifecycle(files, token));
  await check("desktop.recent-documents", () => recentDocumentsLifecycle(files, documents, token));
  await check("desktop.settings", () => settingsLifecycle(settings, token));
}
