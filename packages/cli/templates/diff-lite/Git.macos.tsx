import { useState } from "react";
import { Button } from "@legendapp/spark/ui";
import { openFileDialog } from "@legendapp/spark/dialogs";
import { runCommand } from "@legendapp/spark/processes";
export function Git({ onResult, onError }: { onResult(text: string): void; onError(message: string): void }) {
  const [busy, setBusy] = useState(false);
  return <Button disabled={busy} onPress={() => { setBusy(true); void (async () => {
    const paths = await openFileDialog({ selection: "directories" }); if (paths.canceled) return;
    const result = await runCommand({ executable: "/usr/bin/git", args: ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--", "."], cwd: paths.paths[0], timeoutMs: 10_000 });
    if (result.timedOut || result.outputTruncated || result.exitCode !== 0) throw new Error(result.stderr || "Git comparison failed or exceeded its output limit");
    onResult(result.stdout || "No unstaged changes.");
  })().catch(error => onError(String(error))).finally(() => setBusy(false)); }}>{busy ? "Reading Git…" : "Open Git changes"}</Button>;
}
