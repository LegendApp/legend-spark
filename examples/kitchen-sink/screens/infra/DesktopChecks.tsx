import * as documents from "@legendapp/spark/app/documents";
import { Button } from "../../Controls";
import { ActionButton } from "../../ActionButton";
import { EventResults, useEventResults } from "../../EventResults";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as app from "@legendapp/spark/app";
import * as windows from "@legendapp/spark/windows";
import * as files from "@legendapp/spark/files";
import { settings } from "@legendapp/spark/settings";
import * as clipboard from "@legendapp/spark/clipboard";
import * as links from "@legendapp/spark/links";
import * as secureStore from "@legendapp/spark/secure-storage";
import { showContextMenu } from "@legendapp/spark/context-menu";
import { revealInFileManager } from "@legendapp/spark/files";
import { FileStreamChecks } from "../../FileStreamChecks";
import { APIChecks } from "../../APIChecks";
import { NativeControls } from "../../NativeControls";
import { Expansion } from "../../Expansion";
import { Integrations } from "../../Integrations";
import { logActivity, openDocument, saveDocument, setDocumentText, useAppState } from "../../shell/app-controller";
import { useRegistrations } from "../../shell/registrations";

// The Document menu, ⌘⇧K and unsaved-changes prompts are app-wide (shell/app-controller.ts);
// this screen edits the shared document and shows their activity.
const ID = "infra-desktop-checks";
function Card({ title, children }: React.PropsWithChildren<{ title: string }>) { return <View style={styles.card} className="bg-surface"><Text style={styles.heading} className="text-foreground">{title}</Text>{children}</View>; }
export function DesktopChecks() {
  const [log, setLog] = useState<string[]>([]);
  const document = useAppState(state => state.document);
  const menuEvents = useAppState(state => state.menuEvents);
  const fileEvents = useAppState(state => state.fileEvents);
  const contextMenuAnchor = useRef<View>(null);
  const [secret, setSecret] = useState("");
  const report = useCallback((value: unknown) => setLog(previous => [`${new Date().toLocaleTimeString()}  ${typeof value === "string" ? value : JSON.stringify(value)}`, ...previous].slice(0, 60)), []);
  const [windowEvents, reportWindow] = useEventResults(report);
  const [linkEvents, reportLink] = useEventResults(report);
  const [count, setCount] = useCounter(report);
  useDesktopEvents(reportWindow, reportLink);
  useDocumentWatch(document.path);
  const action = useCallback(async (fn: () => unknown | Promise<unknown>) => { try { const result = await fn(); if (result !== undefined) report(result); return result; } catch (error) { report(String(error)); throw error; } }, [report]);
  return <View style={{ flex: 1 }} className="bg-background">
    <ScrollView contentContainerStyle={styles.content} testID={`${ID}-content`}>
      <Card title="Streaming files and Trash"><FileStreamChecks /></Card>
      <Card title="App and windows"><View style={styles.row}>
        <ActionButton onPress={() => action(() => windows.openWindow({ id: "demo", title: "Kitchen Sink · Second window", restoreBounds: true, component: "main", props: { windowId: "demo", windowProps: { message: "Same JavaScript bundle, separate native window." } } }).then(window => { report(window); return `Opened ${window.title}.`; }))}>Open second window</ActionButton>
        <ActionButton testID={`${ID}-list-windows`} onPress={() => action(async () => {
          const [openWindows, displays] = await Promise.all([windows.listWindows(), windows.getDisplays()]);
          report({ windows: openWindows, displays });
          return [`${openWindows.length} ${openWindows.length === 1 ? "window" : "windows"}: ${openWindows.map(window => `${window.title} (${window.id})`).join(", ") || "none"}`, `${displays.length} ${displays.length === 1 ? "display" : "displays"}: ${displays.map(display => display.name).join(", ") || "none"}`].join("\n");
        })}>List windows and displays</ActionButton>
        <ActionButton onPress={() => action(app.quit)}>Quit (checks unsaved edits)</ActionButton>
      </View><EventResults entries={windowEvents} empty="Open or close a window to see its events here." testID={`${ID}-window-events`} /></Card>
      <Card title="Document, dialogs and filesystem"><Text className="text-muted">{document.path || "Untitled"}{document.text !== document.saved ? " · Unsaved" : ""}</Text>
        <TextInput multiline accessibilityLabel="Document text" testID={`${ID}-document-text`} style={styles.editor} className="border-border bg-surface text-foreground" value={document.text} onChangeText={setDocumentText} />
        <View style={styles.row}><ActionButton onPress={() => action(openDocument)}>Open document</ActionButton><ActionButton onPress={() => action(saveDocument)}>Save document</ActionButton><ActionButton disabled={!document.path} onPress={() => action(() => revealInFileManager(document.path))}>Reveal in Finder</ActionButton><ActionButton onPress={() => action(() => files.getDirectory("data"))}>App data directory</ActionButton></View>
        <EventResults entries={fileEvents} empty="Open, save, or change the open file to see filesystem events here." testID={`${ID}-file-events`} />
      </Card>
      <Card title="Settings"><Text className="text-muted">Persistent counter: {count ?? "Loading…"}</Text><ActionButton disabled={count === null} onPress={() => action(async () => { const value = await settings.update<number>("kitchen-count", count => { if (count !== undefined && typeof count !== "number") throw new Error("Invalid counter setting"); return (count ?? 0) + 1; }); setCount(value); return value; })}>Increment and persist</ActionButton></Card>
      <Card title="Menus, shortcuts and clipboard"><Text className="text-muted">Use the Document menu or press ⌘⇧K. Right-click-like menus are native popups.</Text><View style={styles.row}>
        <View ref={contextMenuAnchor} collapsable={false} className="max-w-full"><ActionButton onPress={() => action(async () => {
          const anchor = contextMenuAnchor.current;
          if (!anchor) throw new Error("Context menu anchor is unavailable.");
          const point = await new Promise<{ x: number; y: number }>(resolve => anchor.measureInWindow((x, y, _width, height) => resolve({ x, y: y + height })));
          const selected = await showContextMenu({ windowId: "main", items: [{ type: "action", id: "copy", label: "Copy greeting" }, { type: "checkbox", id: "checked", label: "Checked item", checked: true }, { type: "action", id: "disabled", label: "Disabled item", disabled: true }], position: point });
          if (!selected.canceled && selected.itemId === "copy") await clipboard.setStringAsync("Hello desktop");
          return selected.canceled ? "Context menu cancelled" : selected.itemId;
        })}>Show context menu</ActionButton></View>
        <ActionButton onPress={() => action(() => clipboard.setStringAsync("Hello desktop"))}>Copy greeting</ActionButton><ActionButton onPress={() => action(() => clipboard.getStringAsync())}>Read clipboard</ActionButton><ActionButton onPress={() => action(clipboard.hasStringAsync)}>Has clipboard text</ActionButton><ActionButton onPress={() => action(() => clipboard.setStringAsync("<b>Hello desktop</b>", { inputFormat: clipboard.StringFormat.HTML }))}>Copy HTML</ActionButton>
      </View><EventResults entries={menuEvents} empty="Press ⌘⇧K or use the Document menu to see the action here." testID={`${ID}-menu-events`} /></Card>
      <Card title="Links and documents"><View style={styles.row}><ActionButton onPress={() => action(() => links.openURL("https://example.com"))}>Open example.com</ActionButton><ActionButton testID={`${ID}-initial-url`} onPress={() => action(async () => await links.getInitialURL() ?? "No URL was used to launch this app.")}>Initial URL</ActionButton><ActionButton testID={`${ID}-can-open-https`} onPress={() => action(async () => await links.canOpenURL("https://example.com") ? "HTTPS URLs can be opened." : "HTTPS URLs cannot be opened.")}>Can open HTTPS</ActionButton><ActionButton onPress={() => action(documents.getRecentDocuments)}>Recent documents</ActionButton></View><Text className="text-muted">OS associations require a custom build.</Text><EventResults entries={linkEvents} empty="Waiting for an incoming URL or file." testID={`${ID}-link-events`} /></Card>
      <Card title="Secure storage"><TextInput accessibilityLabel="Demo secret" secureTextEntry style={styles.input} className="border-border bg-surface text-foreground" placeholderTextColorClassName="accent-muted" value={secret} onChangeText={setSecret} placeholder="Demo secret (stored in Keychain)" /><View style={styles.row}>
        <ActionButton onPress={() => action(async () => { await secureStore.setItemAsync("kitchen-demo", secret); return "Stored demo secret"; })}>Store demo secret</ActionButton><ActionButton onPress={() => action(async () => { setSecret(await secureStore.getItemAsync("kitchen-demo") ?? ""); return "Loaded demo secret"; })}>Load demo secret</ActionButton><ActionButton onPress={() => action(async () => { await secureStore.deleteItemAsync("kitchen-demo"); setSecret(""); return "Deleted demo secret"; })}>Delete demo secret</ActionButton></View></Card>
      <Card title="Native UI"><NativeControls /></Card>
      <Card title="Expo-aligned APIs"><APIChecks /></Card>
      <Card title="Desktop integrations"><Integrations report={report} />
        <Expansion report={report} /></Card>
      <Card title="Event log"><Button onPress={() => setLog([])}>Clear log</Button>{log.map((line, index) => <Text key={`${index}-${line}`} selectable style={styles.log} className="text-muted">{line}</Text>)}</Card>
    </ScrollView>
  </View>;
}
function useCounter(report: (value: unknown) => void) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    settings.get("kitchen-count", { decode(value) { if (typeof value !== "number") throw new Error("Invalid counter setting"); return value; } }).then(value => { if (active) setCount(value ?? 0); }, report);
    return () => { active = false; };
  }, [report]);
  return [count, setCount] as const;
}
function useDesktopEvents(reportWindow: (value: unknown) => void, reportLink: (value: unknown) => void) {
  useRegistrations(hold => {
    for (const type of ["activate", "deactivate", "reopen", "secondInstance", "willQuit"] as const) hold(app.addAppListener(type, reportWindow));
    for (const type of ["focusChanged", "boundsChanged", "visibilityChanged", "fullscreenChanged", "closed"] as const) hold(windows.addWindowListener("main", type, reportWindow));
  }, reportWindow, [reportWindow]);
  useRegistrations(hold => {
    hold(documents.subscribeToOpenRequests(event => { if (event.type === "file") reportLink(event); }));
    hold(links.addEventListener("url", event => reportLink({ url: event.url })));
  }, reportLink, [reportLink]);
  useEffect(() => {
    let active = true;
    links.getInitialURL().then(url => { if (active && url) reportLink({ initialURL: url }); }, reportLink);
    return () => { active = false; };
  }, [reportLink]);
}
function useDocumentWatch(path: string) {
  useRegistrations(hold => { if (path) hold(files.watch(path, changed => logActivity("fileEvents", `File changed: ${changed}`))); }, error => logActivity("fileEvents", error), [path]);
}
const styles = StyleSheet.create({
  content: { padding: 24, gap: 16 }, heading: { fontSize: 18, fontWeight: "600" },
  card: { padding: 20, borderRadius: 12, gap: 12 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  editor: { height: 150, borderWidth: 1, padding: 12, borderRadius: 6, fontSize: 15 }, input: { borderWidth: 1, padding: 8, borderRadius: 6 }, log: { fontFamily: "Menlo", fontSize: 12 },
});
