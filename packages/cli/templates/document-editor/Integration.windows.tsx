import { useEffect, useState } from "react";
import { Text } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { beforeWindowClose, openWindow, setWindowTitle, onWindowEvent } from "@legendapp/spark/windows";
import { beforeQuit } from "@legendapp/spark/app";
import { configureMenus, clearMenus, addNativeMenuActionListener } from "@legendapp/spark/menus";
import { registerShortcut } from "@legendapp/spark/shortcuts";
import { onOpen } from "@legendapp/spark/links";
import { readText } from "@legendapp/spark/files";
import { sessions } from "./sessions";
import type { DocumentSession } from "./document";
let nextWindow = 0;
export function Integration({ session, windowId, documentId, onReady }: { session: DocumentSession; windowId: string; documentId: string; onReady: (ready: boolean) => void }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let removed = false;
    const cleanups: (() => void | Promise<void>)[] = [];
    const retain = async (registration: Promise<{ remove(): void | Promise<void> }>) => {
      const subscription = await registration;
      if (removed) await subscription.remove(); else cleanups.push(() => subscription.remove());
    };
    const owner = `editor-${windowId}`;
    const actions: Record<string, () => unknown> = { new: () => session.newDocument(), open: () => session.open(), save: () => session.save(), saveAs: () => session.save(true) };
    const menus = () => configureMenus(owner, [{ id: "file", title: "File", items: [
      { id: "new", title: "New" }, { id: "open", title: "Open…" }, { id: "save", title: "Save" }, { id: "saveAs", title: "Save As…" },
    ] }]);
    menus(); cleanups.push(() => clearMenus(owner));
    const menu = addNativeMenuActionListener(event => { if (event.ownerId === owner) actions[event.itemId]?.(); });
    cleanups.push(() => menu.remove());
    const focus = onWindowEvent(event => { if (event.type === "focus" && event.windowId === windowId) menus(); });
    cleanups.push(() => focus.remove());
    const title = () => { const state = session.getSnapshot(); void setWindowTitle(windowId, `${state.file.name}${session.dirty ? " •" : ""}`).catch(e => setError(String(e))); };
    title(); cleanups.push(session.subscribe(title));
    void (async () => {
      await retain(beforeWindowClose(windowId, session.canClose));
      for (const [key, action] of Object.entries({ "Control+N": actions.new!, "Control+O": actions.open!, "Control+S": actions.save!, "Control+Shift+S": actions.saveAs! })) {
        await retain(registerShortcut(key, () => { action(); }, { windowId }));
      }
      if (windowId === "main") {
        await retain(beforeQuit(async () => { for (const document of sessions.values()) if (!await document.canClose()) return false; return true; }));
        await retain(onOpen(event => {
          if (event.type !== "openFile") return;
          const match = /^file:\/\/(?:localhost)?(\/.*)$/.exec(event.url);
          if (!match) { setError("Unsupported file URL"); return; }
          const location = decodeURIComponent(match[1]!).replace(/^\/([A-Za-z]:)/, "$1").replace(/\//g, "\\");
          void readText(location).then(text => session.load({ location, name: location.split("/").pop()! }, text)).catch(e => setError(String(e)));
        }));
      }
      if (!removed) onReady(true);
    })().catch(e => setError(String(e)));
    return () => { removed = true; for (const cleanup of cleanups.reverse()) void Promise.resolve().then(cleanup).catch(console.error); };
  }, [session, windowId, onReady]);
  return <>
    <Button onPress={() => { void openWindow({ id: `document-${++nextWindow}`, title: session.getSnapshot().file.name, width: 800, height: 600, props: { documentId } }).catch(e => setError(String(e))); }}>Open another view</Button>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
  </>;
}
