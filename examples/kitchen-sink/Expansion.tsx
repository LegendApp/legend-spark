import { AuthDemo } from "./AuthDemo";
import { MediaSessionDemo } from "./MediaSessionDemo";
import { DesktopFoundations } from "./DesktopFoundations";
import { ActionButton } from "./ActionButton";
import { EventResults, useEventResults } from "./EventResults";
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useUniwind, withUniwind } from "uniwind";
import { DragDropView as NativeDragDropView } from "@legendapp/spark/drag-drop";
import { registerGlobalShortcut } from "@legendapp/spark/global-shortcuts";
import { runCommand, spawn } from "@legendapp/spark/processes";
import { showMessage } from "@legendapp/spark/dialogs";
import * as clipboard from "@legendapp/spark/clipboard";
import * as system from "@legendapp/spark/system";
import * as windows from "@legendapp/spark/windows";
import { openDatabase } from "@legendapp/spark/sqlite";
import { WebView } from "@legendapp/spark/webview";
const DragDropView = withUniwind(NativeDragDropView);
const webHTML = `<html><body style="font:16px system-ui;padding:16px"><h3>Embedded WebView</h3><input aria-label="WebView keyboard test" placeholder="Type here to test keyboard handling"><button onclick="window.ReactNativeWebView.postMessage('Hello from WebView')">Send a message to React Native</button></body></html>`;
const dragSource = { text: "Hello from the desktop kitchen sink" };
const dockItems: system.TaskbarMenuItem[] = [{ type: "action", id: "show", label: "Show kitchen sink" }, { type: "checkbox", id: "checked", label: "Checked item", checked: true }];
type Removable = { remove(): unknown };
export function Expansion({ report }: { report: (value: unknown) => void }) {
  const { theme } = useUniwind();
  const webSource = useMemo(() => ({ html: webHTML.replace("<html>", `<html style="color-scheme:${theme}">`) }), [theme]);
  const [style, setStyle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [login, setLogin] = useState("Loading…");
  const [hotkey, setHotkey] = useState(false);
  const resources = useRef<Removable[]>([]);
  const shortcut = useRef<Awaited<ReturnType<typeof registerGlobalShortcut>> | undefined>(undefined);
  const dock = useRef<Removable | undefined>(undefined);
  const child = useRef<Awaited<ReturnType<typeof spawn>> | undefined>(undefined);
  const mounted = useRef(false);
  const [dragEvents, reportDrag] = useEventResults(report);
  const [shortcutEvents, reportShortcut] = useEventResults(report);
  const [processEvents, reportProcess] = useEventResults(report);
  const [systemEvents, reportSystem] = useEventResults(report);
  const [webEvents, reportWeb] = useEventResults(report);
  const act = useCallback(async (action: () => Promise<unknown>) => { try { const result = await action(); if (result !== undefined) report(result); return result; } catch (error) { report(String(error)); throw error; } }, [report]);
  useEffect(() => {
    mounted.current = true; let disposed = false;
    void system.getLoginItemStatus().then(value => { if (!disposed) setLogin(value); }).catch(reportSystem);
    void system.onSystemEvent(reportSystem).then(value => { if (disposed) void value.remove().catch(reportSystem); else resources.current.push(value); }).catch(reportSystem);
    return () => { disposed = true; mounted.current = false; for (const resource of resources.current) void Promise.resolve(resource.remove()).catch(reportSystem); resources.current = []; void shortcut.current?.remove(); void child.current?.terminate(); };
  }, [reportSystem]);
  async function toggleShortcut() {
    setBusy(true);
    try {
      if (shortcut.current) { await shortcut.current.remove(); shortcut.current = undefined; setHotkey(false); }
      else {
        const value = await registerGlobalShortcut("Cmd+Shift+F12", () => reportShortcut("Global shortcut fired: ⌘⇧F12"));
        if (!mounted.current) await value.remove(); else { shortcut.current = value; setHotkey(true); }
      }
    } finally { if (mounted.current) setBusy(false); }
  }
  async function sql() {
    const db = await openDatabase("kitchen.sqlite");
    try {
      await db.run("CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, label TEXT)");
      await db.run("INSERT INTO visits(label) VALUES (?)", ["Hello SQLite"]);
      return (await db.getAll("SELECT count(*) AS count FROM visits"));
    } finally { await db.close(); }
  }
  return <View style={styles.section}>
    <DesktopFoundations report={report} />
    <MediaSessionDemo report={report} />
    <AuthDemo />
    <Text style={styles.heading} className="text-foreground">Window styling</Text>
    <View style={styles.row}>
      <ActionButton onPress={() => act(async () => { await windows.setWindowOptions("main", { titleBarStyle: style ? "default" : "overlay" }); setStyle(!style); })}>{style ? "Default title bar" : "Overlay title bar"}</ActionButton>
      <ActionButton onPress={() => act(() => windows.openWindow({ id: "floating", parentId: "main", title: "Floating child", alwaysOnTop: true, macos: { titleBar: { material: "sidebar" } }, component: "main", size: { width: 500, height: 350 }, minSize: { width: 300, height: 100 }, props: { windowId: "floating", windowProps: {} } }))}>Floating child</ActionButton>
      <ActionButton onPress={() => act(() => windows.openWindow({ id: "modal", parentId: "main", modal: true, title: "Modal window", component: "main", size: { width: 450, height: 300 }, kind: "window", props: { windowId: "modal", windowProps: {} } }))}>Modal window</ActionButton>
    </View>
    <Text style={styles.heading} className="text-foreground">Drag and drop</Text>
    <DragDropView onDrop={event => { setOver(false); reportDrag({ type: "drop", ...event }); }} onDragEnter={() => setOver(true)} onDragLeave={() => setOver(false)} style={styles.drop} className={over ? "border-border bg-highlight" : "border-border"}>
      <Text className="text-muted">Drop files, URLs or text here</Text>
    </DragDropView>
    <DragDropView source={dragSource} onDragEnd={event => reportDrag(event.accepted ? "Drag accepted by the destination." : "Drag ended without being accepted.")} style={styles.drop} className="border-border"><Text className="text-muted">Drag this text into another app</Text></DragDropView>
    <EventResults entries={dragEvents} empty="Drop something here or drag the sample text to see the result." testID="drag-events" />
    <Text style={styles.heading} className="text-foreground">Global shortcut and processes</Text>
    <View style={styles.row}>
      <ActionButton disabled={busy} onPress={() => act(toggleShortcut)}>{hotkey ? "Remove global shortcut" : "Register ⌘⇧F12"}</ActionButton>
      <ActionButton onPress={() => act(() => runCommand({ target: { type: "executable", path: "/usr/bin/uname" }, args: ["-a"] }))}>Run /usr/bin/uname</ActionButton>
      <ActionButton disabled={busy} onPress={() => act(async () => {
        setBusy(true);
        const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
        reportProcess("Process starting…");
        try {
          child.current = await spawn({ target: { type: "executable", path: "/bin/sh" }, args: ["-c", "printf 'First output\\n'; sleep 1; printf 'Second output\\n'; printf 'Example stderr\\n' >&2"], timeoutMs: 5000, onOutput: chunk => {
            const text = decoders[chunk.stream].decode(chunk.bytes, { stream: true });
            if (text) reportProcess(`${chunk.stream}: ${text}`);
          } });
          const result = await child.current.exited;
          reportProcess(`Process exited with code ${result.exit.type === "exited" ? result.exit.code : "terminated"}${result.timedOut ? " (timed out)" : ""}.`);
          report(result);
          return `Process exited with code ${result.exit.type === "exited" ? result.exit.code : "terminated"}${result.timedOut ? " (timed out)" : ""}.`;
        } catch (error) { reportProcess(error); throw error; }
        finally {
          for (const stream of ["stdout", "stderr"] as const) {
            const text = decoders[stream].decode();
            if (text) reportProcess(`${stream}: ${text}`);
          }
          child.current = undefined; if (mounted.current) setBusy(false);
        }
      })}>Stream a process</ActionButton>
      <ActionButton onPress={() => act(async () => child.current?.terminate())}>Cancel process</ActionButton>
    </View>
    <EventResults entries={shortcutEvents} empty="Register the shortcut, then press ⌘⇧F12 to see it fire." testID="global-shortcut-events" />
    <EventResults entries={processEvents} empty="Stream a process to see stdout, stderr, and exit events here." testID="process-events" />
    <Text style={styles.heading} className="text-foreground">Dialogs and rich clipboard</Text>
    <View style={styles.row}>
      <ActionButton onPress={() => act(() => showMessage({ title: "Keep these changes?", message: "Native sheet with explicit buttons and checkbox.", windowId: "main", buttons: [{ id: "cancel", label: "Cancel" }, { id: "keep", label: "Keep" }], defaultButtonId: "keep", cancelButtonId: "cancel", checkbox: { label: "Remember my choice" } }))}>Confirmation sheet</ActionButton>
      <ActionButton onPress={() => act(() => clipboard.writeClipboard({ text: "Hello desktop", html: "<b>Hello desktop</b>", rtf: "{\\rtf1\\ansi Hello desktop}" }))}>Copy rich text</ActionButton>
      <ActionButton onPress={() => act(clipboard.readClipboard)}>Read clipboard</ActionButton>
    </View>
    <Text style={styles.heading} className="text-foreground">Dock, startup and power</Text>
    <Text className="text-muted">Launch at login: {login}</Text>
    <View style={styles.row}>
      <ActionButton onPress={() => act(system.getSystemInfo)}>System state</ActionButton>
      <ActionButton onPress={() => act(() => system.setAppBadge("3"))}>Dock badge</ActionButton>
      <ActionButton onPress={() => act(() => system.setAppBadge(""))}>Clear badge</ActionButton>
      <ActionButton onPress={() => act(async () => { await dock.current?.remove(); const value = await (Platform.OS === "windows" ? system.createTaskbarMenu : system.createDockMenu)({ items: dockItems, onAction: event => { reportSystem(`Menu selected: ${event.itemId}`); void windows.showWindow("main").catch(reportSystem); } }); dock.current = value; resources.current.push(value); })}>Dock menu</ActionButton>
      <ActionButton onPress={() => act(async () => { const value = await system.preventSleep({ reason: "Kitchen sink demonstration" }); resources.current.push(value); setTimeout(() => void value.remove().catch(reportSystem), 5000); })}>Prevent sleep for 5 seconds</ActionButton>
      <ActionButton disabled={login === "unavailable" || login === "Loading…"} onPress={() => act(async () => { await system.setLaunchAtLogin(login !== "enabled"); setLogin(await system.getLoginItemStatus()); })}>{login === "enabled" ? "Disable launch at login" : "Enable launch at login"}</ActionButton>
    </View>
    <EventResults entries={systemEvents} empty="Dock menu selections and system changes appear here." testID="system-events" />
    <Text style={styles.heading} className="text-foreground">SQLite</Text><ActionButton onPress={() => act(sql)}>Insert and count persisted rows</ActionButton>
    <Text style={styles.heading} className="text-foreground">WebView</Text>
    <WebView source={webSource} style={styles.web} onMessage={event => reportWeb(event.data)} onError={event => reportWeb(new Error(event.message))} onNavigationRequest={request => request.uri === "about:blank"} />
    <EventResults entries={webEvents} empty="Use the button inside the WebView to send a message here." testID="webview-events" />
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 16 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, heading: { fontSize: 18, fontWeight: "600" }, drop: { padding: 24, borderWidth: 1, borderRadius: 8 }, web: { height: 220, flex: 0 } });
