import { useCallback, useEffect, useState } from "react";
import * as files from "@legendapp/spark/files";
import { openFileDialog } from "@legendapp/spark/dialogs";
import { restoreBookmark, runFileAPIChecks, saveBookmark, type FileAPIDemo, type FileAPIOptions } from "./file-system-api-checks";

export type FileAPIReport = FileAPIOptions & { report: string };
/** Restores the persisted bookmark on mount; in report mode runs every check once and writes the JSON report. report is read once, on mount. */
export function useFileSystemAPIs(initialReport?: FileAPIReport) {
  // Launch arguments fix the report; a caller re-rendering with a new object must not rerun the checks.
  const [report] = useState(initialReport);
  const [demo, setDemo] = useState<FileAPIDemo>();
  const [restored, setRestored] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [running, setRunning] = useState(false);
  const run = useCallback(async (options: FileAPIOptions = {}) => {
    setRunning(true);
    try { const result = await runFileAPIChecks(options); setDemo(result); return result; }
    finally { setRunning(false); }
  }, []);
  // Restore before any report run: the checks rewrite the persisted bookmark.
  useEffect(() => {
    let disposed = false;
    void restoreBookmark().then(value => value ?? "No bookmark saved yet", error => `Restore failed: ${String(error)}`).then(async value => {
      if (disposed) return;
      setRestored(value);
      if (!report) return;
      const { report: path, ...options } = report;
      await run(options)
        .then(result => files.writeText(path, JSON.stringify({ passed: result.checks.every(check => check.passed), restored: value, ...result, icon: !!result.icon, thumbnail: !!result.thumbnail }, null, 2)))
        .catch(error => files.writeText(path, JSON.stringify({ passed: false, error: String(error) })));
    });
    return () => { disposed = true; };
  }, [report, run]);
  const act = useCallback(async (label: string, action: () => Promise<unknown>) => {
    try { await action(); setStatus(label); } catch (error) { setStatus(`${label} failed: ${String(error)}`); }
  }, []);
  return {
    demo, restored, status, running,
    run: () => void run().catch(error => setStatus(String(error))),
    bookmarkFolder: () => act("Bookmark saved; relaunch to restore it", async () => {
      const selected = await openFileDialog({ selection: "directories", title: "Choose a folder to bookmark" });
      if (selected.canceled) return;
      setRestored(`Saved ${await saveBookmark(selected.paths[0])}`);
    }),
    quickLook: (paths: string[]) => act("Quick Look shown", () => files.showQuickLook(paths)),
    openWith: (path: string, app: files.FileApplication) => act(`Opened with ${app.name}`, () => files.openWithApplication(path, app.path)),
    openFullDiskAccessSettings: () => act("Opened Full Disk Access settings", files.openFullDiskAccessSettings),
  };
}
