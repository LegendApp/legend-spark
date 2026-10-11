import { useCallback, useEffect, useState } from "react";
import * as app from "@legendapp/spark/app";
import { SparkError } from "@legendapp/spark/contracts";
import { saveFileDialog } from "@legendapp/spark/dialogs";
import { getDirectory, readText, remove, writeText } from "@legendapp/spark/files";
import {
  addLoggingErrorListener, configureLogging, createLogger, exportDiagnostics, flushLogs, getLogFiles, getLoggingAvailability,
  LogWriteError, type DiagnosticsExport, type LogFile, type Logger, type LoggingErrorEvent,
} from "@legendapp/spark/logging";

export type DemoId = "write-entries" | "write-burst" | "flush" | "write-failure" | "export";
/** `--ks-diagnostics-dir <folder>` makes Export write <folder>/Diagnostics.zip without a save panel, for the driver flow. */
export const DIAGNOSTICS_FLAG = "--ks-diagnostics-dir";
/** Small files, so a burst of entries shows rotation on screen. */
export const DEMO_FILES = { maxFileBytes: 4096, maxFiles: 3 } as const;
export type Entry = { time: string; level: string; category: string; message: string; fields?: unknown };

/** Availability readouts, keyed by the testID suffix that shows them. */
export function loggingAvailability() {
  return { logging: getLoggingAvailability(), "system-log": getLoggingAvailability("systemLog"), files: getLoggingAvailability("files"), diagnostics: getLoggingAvailability("diagnostics") };
}

const describe = (value: unknown) => value instanceof LogWriteError ? JSON.stringify({ error: value.code, dropped: value.dropped }) : value instanceof SparkError ? `SparkError:${value.code}` : value instanceof Error ? `Error: ${value.message}` : JSON.stringify(value ?? null);

let logger: Logger | undefined;
/** One logger for the screen, created on first use so Windows reports its typed failure per action. */
// The demo's messages are fixed text, so they can be public in the unified log.
const demoLog = () => (logger ??= createLogger("kitchen-sink.logging", { publicMessages: true }));

/** Failure events as the screen shows them: the code, count and whether writing works again. */
function useLoggingErrors() {
  const [events, setEvents] = useState<Pick<LoggingErrorEvent, "code" | "dropped" | "recovered">[]>([]);
  useEffect(() => {
    if (!getLoggingAvailability("files").available) return;
    const subscription = addLoggingErrorListener(({ code, dropped, recovered }) => setEvents(current => [...current, { code, dropped, recovered }]));
    return () => subscription.remove();
  }, []);
  return events;
}

/**
 * Configures demo-sized log files, writes entries, lists the files with the newest entries of app.log,
 * and exports diagnostics. Each result is JSON (or SparkError:<code>) for the screen and its flows.
 */
export function useLoggingDemo(info: () => Record<string, string>) {
  const [ready, setReady] = useState(false);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [exported, setExported] = useState<DiagnosticsExport>();
  const [results, setResults] = useState<Partial<Record<DemoId | "setup", string>>>({});
  const errors = useLoggingErrors();
  const record = useCallback((id: DemoId | "setup", value: unknown) => setResults(current => ({ ...current, [id]: describe(value) })), []);

  const refresh = useCallback(async () => {
    const current = await getLogFiles();
    setFiles(current);
    const text = current[0] ? await readText(current[0].path) : "";
    setRecent(text.split("\n").filter(Boolean).slice(-5).map(line => JSON.parse(line) as Entry).reverse());
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await configureLogging({ level: "debug", files: DEMO_FILES });
      demoLog().notice("Logging screen opened");
      if (!active) return;
      setReady(true);
      await refresh();
    })().catch(error => { if (active) record("setup", error); });
    return () => { active = false; };
  }, [refresh, record]);

  const run = useCallback(async (id: DemoId) => {
    try {
      switch (id) {
        case "write-entries": {
          const log = demoLog();
          log.debug("Cache lookup", { key: "projects", hit: false });
          log.info("Sync started", { account: "work", pending: 12 });
          log.notice("Document saved", { name: "Notes.md", bytes: 2048 });
          log.error("Upload failed", { file: "photo.heic", status: 503, attempt: 2 });
          log.fault("Index is inconsistent", { expected: 40, found: 39 });
          await flushLogs();
          record(id, { written: 5 });
          break;
        }
        case "write-burst": {
          const log = demoLog();
          for (let index = 1; index <= 100; index++) log.info(`Burst entry ${String(index).padStart(3, "0")} of 100`, { index, batch: "rotation" });
          await flushLogs();
          record(id, { written: 100 });
          break;
        }
        case "flush": record(id, await flushLogs()); break;
        case "write-failure": {
          // A file takes the log folder's place: two entries cannot reach it, the listener hears the
          // failure, writing resumes once the folder can be made again, and flush reports the count.
          const folder = `${await getDirectory("temp")}/logging-failure`;
          await configureLogging({ files: { directory: folder } });
          await remove(folder, { recursive: true });
          await writeText(folder, "Not a folder");
          demoLog().error("Lost entry 1");
          demoLog().error("Lost entry 2");
          await getLogFiles(); // Runs after both entries, so they have failed before the folder returns.
          await remove(folder);
          demoLog().notice("Written again");
          const failure = await flushLogs().then(() => undefined, (error: unknown) => error);
          await configureLogging({ files: null });
          await configureLogging({ files: DEMO_FILES });
          record(id, failure ?? "no failure");
          break;
        }
        case "export": {
          const args = (await app.getAppContext()).launchArguments;
          const folder = args.includes(DIAGNOSTICS_FLAG) ? args[args.indexOf(DIAGNOSTICS_FLAG) + 1] : undefined;
          const target = folder ? { canceled: false as const, path: `${folder}/Diagnostics.zip` } : await saveFileDialog({ defaultName: "Kitchen Sink Diagnostics.zip", filters: [{ name: "Zip", extensions: ["zip"] }], windowId: "main" });
          if (target.canceled) { record(id, target); break; }
          const result = await exportDiagnostics(target.path, { info: info() });
          setExported(result);
          record(id, { entries: result.entries });
          break;
        }
      }
      await refresh();
    } catch (error) {
      record(id, error);
    }
  }, [info, record, refresh]);

  return { ready, files, recent, exported, results, errors, run };
}
