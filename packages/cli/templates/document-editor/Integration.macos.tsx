import { useEffect, useState } from "react";
import { Text } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { beforeWindowClose, openWindow, setWindowOptions, addWindowListener } from "@legendapp/spark/windows";
import { beforeQuit } from "@legendapp/spark/app";
import { useMenu, type MenuRootItem } from "@legendapp/spark/menus";
import { registerShortcut } from "@legendapp/spark/shortcuts";
import { subscribeToOpenRequests } from "@legendapp/spark/app/documents";
import { readText } from "@legendapp/spark/files";
import { sessions } from "./sessions";
import type { DocumentSession } from "./document";
const items: MenuRootItem[] = [{ type: "submenu", id: "file", target: { menu: "file" }, label: "File", items: [
  { type: "action", id: "new", label: "New" }, { type: "action", id: "open", label: "Open…" }, { type: "action", id: "save", label: "Save" }, { type: "action", id: "saveAs", label: "Save As…" },
] }];
let nextWindow = 0;
export function Integration({ session, windowId, documentId, onReady }: { session: DocumentSession; windowId: string; documentId: string; onReady: (ready: boolean) => void }) {
  const [error, setError] = useState<string | null>(null);
  const menu = useMenu({ id: `editor-${windowId}`, items, onAction: event => {
    const actions: Record<string, () => unknown> = { new: () => session.newDocument(), open: () => session.open(), save: () => session.save(), saveAs: () => session.save(true) };
    actions[event.itemId]?.();
  }, onError: error => setError(String(error)) });
  useEffect(() => {
    if (menu.status !== "ready") return;
    let disposed = false, focus: Awaited<ReturnType<typeof addWindowListener>> | undefined;
    void addWindowListener(windowId, "focusChanged", event => { if (event.focused) void menu.menu.update({ items }).catch(error => setError(String(error))); }).then(value => { if (disposed) void value.remove(); else focus = value; }).catch(error => setError(String(error)));
    return () => { disposed = true; void focus?.remove(); };
  }, [menu, windowId]);
  useEffect(() => {
    let removed = false;
    const cleanups: (() => void | Promise<void>)[] = [];
    const retain = async (registration: Promise<{ remove(): void | Promise<void> }>) => {
      const subscription = await registration;
      if (removed) await subscription.remove(); else cleanups.push(() => subscription.remove());
    };
    const actions: Record<string, () => unknown> = { new: () => session.newDocument(), open: () => session.open(), save: () => session.save(), saveAs: () => session.save(true) };
    const title = () => { const state = session.getSnapshot(); void setWindowOptions(windowId, { title: `${state.file.name}${session.dirty ? " •" : ""}` }).catch(e => setError(String(e))); };
    title(); cleanups.push(session.subscribe(title));
    void (async () => {
      await retain(beforeWindowClose(windowId, session.canClose));
      for (const [key, action] of Object.entries({ "Command+N": actions.new!, "Command+O": actions.open!, "Command+S": actions.save!, "Command+Shift+S": actions.saveAs! })) {
        await retain(registerShortcut(key, () => { action(); }, { windowId }));
      }
      if (windowId === "main") {
        await retain(beforeQuit(async () => { for (const document of sessions.values()) if (!await document.canClose()) return false; return true; }));
        await retain(subscribeToOpenRequests(event => {
          if (event.type !== "file") return;
          const location = event.path;
          void readText(location).then(text => session.load({ location, name: location.split("/").pop()! }, text)).catch(e => setError(String(e)));
        }));
      }
      if (!removed) onReady(true);
    })().catch(e => setError(String(e)));
    return () => { removed = true; for (const cleanup of cleanups.reverse()) void Promise.resolve().then(cleanup).catch(console.error); };
  }, [session, windowId, onReady]);
  return <>
    <Button onPress={() => { const id = `document-${++nextWindow}`; void openWindow({ id, title: session.getSnapshot().file.name, component: "main", size: { width: 800, height: 600 }, props: { windowId: id, windowProps: { documentId } } }).catch(e => setError(String(e))); }}>Open another view</Button>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
  </>;
}
