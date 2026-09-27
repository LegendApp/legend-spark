import { useEffect } from "react";
import { subscribeToOpenRequests } from "@legendapp/spark/app/documents";
import { mountSerial } from "./lifetime";
import type { OpenFilesProps } from "./OpenFiles";
// Each subscription replays queued launches to each subscription. Remounts must not import twice.
const imported = new Set<string>();
const importing = new Set<string>();
export function OpenFiles({ windowId = "main", onFile, onError }: OpenFilesProps) {
  useEffect(() => {
    if (windowId !== "main") return;
    return mountSerial("file-activation", async retain => { await retain(subscribeToOpenRequests(event => {
      if (event.type !== "file") return;
      if (imported.has(event.id) || importing.has(event.id)) return;
      importing.add(event.id);
      void (async () => {
        await onFile(event.path);
        imported.add(event.id);
        if (imported.size > 200) imported.delete(imported.values().next().value!);
      })().catch(error => onError(String(error))).finally(() => importing.delete(event.id));
    })); }, onError);
  }, [windowId, onFile, onError]);
  return null;
}
