import * as documents from "@legendapp/spark/app/documents";
import { Button } from "./Controls";
import { ActionButton } from "./ActionButton";
import { EventResults, useEventResults } from "./EventResults";
import React, { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as app from "@legendapp/spark/app";
import * as windows from "@legendapp/spark/windows";
import * as files from "@legendapp/spark/files";
import { settings } from "@legendapp/spark/settings";
import * as clipboard from "@legendapp/spark/clipboard";
import * as links from "@legendapp/spark/links";
import * as secureStore from "@legendapp/spark/secure-storage";
import { registerShortcut } from "@legendapp/spark/shortcuts";
import { showContextMenu } from "@legendapp/spark/context-menu";
import { useMenu, type MenuRootItem } from "@legendapp/spark/menus";
import { openFileDialog, saveFileDialog } from "@legendapp/spark/dialogs";
import { revealInFileManager } from "@legendapp/spark/files";
import { AuthChecks } from "./AuthChecks";
import { AudioChecks } from "./AudioChecks";
import { FileStreamChecks } from "./FileStreamChecks";
import { FoundationChecks } from "./FoundationChecks";
import { runSidecarChecks } from "./sidecar-checks";
import { runChecks, type Check } from "./checks";
import { APIChecks } from "./APIChecks";
import { NativeControls } from "./NativeControls";
import { ExpansionChecks } from "./ExpansionChecks";
import { Expansion } from "./Expansion";
import { Integrations } from "./Integrations";
import { ThemeToggle } from "./ThemeToggle";
import { testDriver } from "./test-driver";

const applicationMenuItems: MenuRootItem[] = [{ type: "submenu", id: "document", label: "Document", items: [{ type: "action", id: "open", label: "Open…", shortcut: "CmdOrCtrl+O" }, { type: "action", id: "save", label: "Save…", shortcut: "CmdOrCtrl+S" }] }];

type Props = Partial<app.AppContext> & { windowId?: string; windowProps?: { overlay?: boolean; message?: string; readyFile?: string } };
function argument(args: readonly string[], name: string) { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; }
export default function App(props: Props) {
  const args = props.launchArguments ?? [];
  const report = argument(args, "--spark-test-report");
  if (props.windowId && props.windowId !== "main") return <SecondaryWindow {...props} />;
  const authReport = argument(args, "--spark-auth-report");
  if (authReport) return <AuthChecks report={authReport} provider={argument(args, "--spark-auth-provider")!} />;
  const audioReport = argument(args, "--spark-audio-report");
  if (audioReport) return <AudioChecks report={audioReport} source={argument(args, "--spark-audio-source")!} />;
  const filesReport = argument(args, "--spark-files-report");
  if (filesReport) return <FileStreamChecks report={filesReport} />;
  const foundationReport = argument(args, "--spark-foundation-report");
  if (foundationReport) return <FoundationChecks report={foundationReport} />;
  const uiReport = argument(args, "--spark-ui-report");
  if (uiReport) return <NativeControls report={uiReport} />;
  const apiReport = argument(args, "--spark-api-report");
  if (apiReport) return <APIChecks report={apiReport} expectedInitial={argument(args, "--spark-api-initial") ?? null} />;
  const expansionReport = argument(args, "--spark-expansion-report");
  if (expansionReport) return <ExpansionChecks report={expansionReport} />;
  if (report) return <AutomatedChecks report={report} args={args} />;
  return <KitchenSink {...props} />;
}
function SecondaryWindow(props: Props) {
  useEffect(() => {
    const file = props.windowProps?.readyFile;
    if (file) void files.writeText(file, props.windowProps?.message ?? "").catch(console.error);
    return () => { if (file) void files.writeText(`${file}.closed`, "unmounted").catch(console.error); };
  }, [props.windowProps?.readyFile, props.windowProps?.message]);
  if (props.windowProps?.overlay) return <View style={{ flex: 1, padding: 12, backgroundColor: "transparent" }}>
    <View style={{ borderRadius: 12, padding: 12, gap: 8 }} className="bg-background">
      <Text className="text-foreground">Overlay — keyboard focus stays in your app</Text>
      <Button onPress={() => void windows.closeWindow(props.windowId!).catch(console.error)}>Close overlay</Button>
    </View>
  </View>;
  return <View style={styles.root} className="bg-background" testID="secondary-window">
    <Text style={styles.title} className="text-foreground">Secondary window</Text><Text className="text-muted">{props.windowProps?.message ?? props.windowId}</Text>
    <Button onPress={() => void windows.closeWindow(props.windowId!).catch(console.error)}>Close this window</Button>
  </View>;
}
function AutomatedChecks({ report, args }: { report: string; args: readonly string[] }) {
  const [checks, setChecks] = useState<Check[]>([]);
  useEffect(() => {
    let started = false;
    // Let the main React window mount before opening secondary roots.
    const timer = setTimeout(() => {
      if (started) return; started = true;
      void (args.includes("--spark-sidecar-probe") ? runSidecarChecks() : runChecks(async result => { setChecks(previous => [...previous, result]); await files.writeText(`${report}.progress`, JSON.stringify(result)); }, testDriver, argument(args, "--spark-isolation-expect") ? { expect: argument(args, "--spark-isolation-expect") as "absent" | "present", cleanup: args.includes("--spark-isolation-cleanup") } : undefined))
        .then(async result => {
          await files.writeText(report, JSON.stringify(result, null, 2));
          if (args.includes("--spark-test-quit-on-complete")) { await new Promise(resolve => setTimeout(resolve, 2500)); await app.beforeQuit(() => true); await app.quit(); }
        })
        .catch(error => files.writeText(report, JSON.stringify({ passed: false, error: String(error), results: [] })));
    }, 500);
    return () => clearTimeout(timer);
  }, [report, args]);
  return <ScrollView style={styles.root} className="bg-background" testID="automated-checks"><Text style={styles.title} className="text-foreground">Native SDK checks</Text>{checks.map(check => <Text key={check.name} className="text-muted">{check.passed ? "PASS" : "FAIL"} {check.name} {check.error}</Text>)}</ScrollView>;
}
function Card({ title, children }: React.PropsWithChildren<{ title: string }>) { return <View style={styles.card} className="bg-surface"><Text style={styles.heading} className="text-foreground">{title}</Text>{children}</View>; }
function KitchenSink({ runtime, projectId }: Props) {
  const [log, setLog] = useState<string[]>([]);
  const [document, setDocument] = useState({ path: "", saved: "", text: "Hello from a native desktop app.\n" });
  const contextMenuAnchor = useRef<ComponentRef<typeof View>>(null);
  const documentRef = useRef(document); documentRef.current = document;
  const [count, setCount] = useState<number | null>(null);
  const [secret, setSecret] = useState("");
  const report = useCallback((value: unknown) => setLog(previous => [`${new Date().toLocaleTimeString()}  ${typeof value === "string" ? value : JSON.stringify(value)}`, ...previous].slice(0, 60)), []);
  const [windowEvents, reportWindow] = useEventResults(report);
  const [fileEvents, reportFile] = useEventResults(report);
  const [menuEvents, reportMenu] = useEventResults(report);
  const [linkEvents, reportLink] = useEventResults(report);
  const action = useCallback(async (fn: () => unknown | Promise<unknown>) => { try { const result = await fn(); if (result !== undefined) report(result); return result; } catch (error) { report(String(error)); throw error; } }, [report]);
  const load = useCallback(async () => {
    const selected = await openFileDialog({ title: "Open a text document", filters: [{ extensions: ["txt", "md", "json"] }], multiple: false });
    if (selected.canceled) return "Open cancelled.";
    const path = selected.paths[0]; const text = await files.readText(path);
    setDocument({ path, text, saved: text }); await documents.noteRecentDocument(path); reportFile(`Opened ${path}`);
  }, [reportFile]);
  const save = useCallback(async () => {
    const current = documentRef.current;
    const result = current.path ? { canceled: false as const, path: current.path } : await saveFileDialog({ defaultName: "Hello.txt" });
    if (result.canceled) return "Save cancelled.";
    const path = result.path;
    if (!path) return "Save cancelled.";
    await files.writeText(path, current.text); setDocument(previous => ({ ...previous, path, saved: current.text })); reportFile(`Saved ${path}`);
  }, [reportFile]);
  useMenu({ id: "kitchen-sink", items: applicationMenuItems, onAction: event => { reportMenu(`Document menu: ${event.itemId}`); void (event.itemId === "open" ? load() : save()).catch(reportFile); }, onError: reportMenu });
  useEffect(() => {
    const removers: Array<() => unknown> = []; let disposed = false;
    function retain(sub: { remove(): unknown }) { if (disposed) void sub.remove(); else removers.push(() => sub.remove()); }
    for (const type of ["activate", "deactivate", "reopen", "secondInstance", "willQuit"] as const) retain(app.addAppListener(type, reportWindow)); for (const type of ["focusChanged", "boundsChanged", "visibilityChanged", "fullscreenChanged", "closed"] as const) void windows.addWindowListener("main", type, reportWindow).then(retain).catch(reportWindow);
    void registerShortcut("Command+Shift+K", () => reportMenu("Shortcut fired: Command+Shift+K")).then(retain).catch(reportMenu);
    void documents.subscribeToOpenRequests(event => { if (event.type === "file") reportLink(event); }).then(retain).catch(reportLink);
    retain(links.addEventListener("url", event => reportLink({ url: event.url })));
    void links.getInitialURL().then(url => { if (!disposed && url) reportLink({ initialURL: url }); }).catch(reportLink);
    const confirmClose = () => documentRef.current.text === documentRef.current.saved || new Promise<boolean>(resolve => Alert.alert("Unsaved document", "Discard your changes?", [{ text: "Keep editing", style: "cancel", onPress: () => resolve(false) }, { text: "Discard", style: "destructive", onPress: () => resolve(true) }]));
    void app.beforeQuit(confirmClose).then(retain).catch(reportWindow);
    void windows.beforeWindowClose("main", confirmClose).then(retain).catch(reportWindow);
    void settings.get("kitchen-count", { decode(value) { if (typeof value !== "number") throw new Error("Invalid counter setting"); return value; } }).then(value => { if (!disposed) setCount(value ?? 0); }).catch(report);
    return () => { disposed = true; for (const remove of removers) void remove(); };
  }, [load, report, reportWindow, reportFile, reportMenu, reportLink, save]);
  useEffect(() => {
    if (!document.path) return;
    let disposed = false; let sub: Awaited<ReturnType<typeof files.watch>> | undefined;
    void files.watch(document.path, path => reportFile(`File changed: ${path}`)).then(value => { sub = value; if (disposed) void value.remove(); }).catch(reportFile);
    return () => { disposed = true; void sub?.remove(); };
  }, [document.path, reportFile]);
  return <View style={{ flex: 1 }} className="bg-background">
    <View style={styles.header} className="border-border"><Text style={styles.title} className="text-foreground">Desktop Kitchen Sink</Text><Text className="text-muted">{runtime?.mode ?? "unknown"} · {projectId}</Text><ThemeToggle /></View>
    <ScrollView contentContainerStyle={styles.content} testID="kitchen-sink">
      <Card title="Streaming files and Trash"><FileStreamChecks /></Card>
      <Card title="App and windows"><View style={styles.row}>
        <ActionButton onPress={() => action(() => windows.openWindow({ id: "demo", title: "Kitchen Sink · Second window", restoreBounds: true, component: "main", props: { windowId: "demo", windowProps: { message: "Same JavaScript bundle, separate native window." } } }).then(window => { report(window); return `Opened ${window.title}.`; }))}>Open second window</ActionButton>
        <ActionButton testID="list-windows" onPress={() => action(async () => {
          const [openWindows, displays] = await Promise.all([windows.listWindows(), windows.getDisplays()]);
          report({ windows: openWindows, displays });
          return [`${openWindows.length} ${openWindows.length === 1 ? "window" : "windows"}: ${openWindows.map(window => `${window.title} (${window.id})`).join(", ") || "none"}`, `${displays.length} ${displays.length === 1 ? "display" : "displays"}: ${displays.map(display => display.name).join(", ") || "none"}`].join("\n");
        })}>List windows and displays</ActionButton>
        <ActionButton onPress={() => action(app.quit)}>Quit (checks unsaved edits)</ActionButton>
      </View><EventResults entries={windowEvents} empty="Open or close a window to see its events here." testID="window-events" /></Card>
      <Card title="Document, dialogs and filesystem"><Text className="text-muted">{document.path || "Untitled"}{document.text !== document.saved ? " · Unsaved" : ""}</Text>
        <TextInput multiline accessibilityLabel="Document text" testID="document-text" style={styles.editor} className="border-border bg-surface text-foreground" value={document.text} onChangeText={text => setDocument(previous => ({ ...previous, text }))} />
        <View style={styles.row}><ActionButton onPress={() => action(load)}>Open document</ActionButton><ActionButton onPress={() => action(save)}>Save document</ActionButton><ActionButton disabled={!document.path} onPress={() => action(() => revealInFileManager(document.path))}>Reveal in Finder</ActionButton><ActionButton onPress={() => action(() => files.getDirectory("data"))}>App data directory</ActionButton></View>
        <EventResults entries={fileEvents} empty="Open, save, or change the open file to see filesystem events here." testID="file-events" />
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
      </View><EventResults entries={menuEvents} empty="Press ⌘⇧K or use the Document menu to see the action here." testID="menu-events" /></Card>
      <Card title="Links and documents"><View style={styles.row}><ActionButton onPress={() => action(() => links.openURL("https://example.com"))}>Open example.com</ActionButton><ActionButton testID="initial-url" onPress={() => action(async () => await links.getInitialURL() ?? "No URL was used to launch this app.")}>Initial URL</ActionButton><ActionButton testID="can-open-https" onPress={() => action(async () => await links.canOpenURL("https://example.com") ? "HTTPS URLs can be opened." : "HTTPS URLs cannot be opened.")}>Can open HTTPS</ActionButton><ActionButton onPress={() => action(documents.getRecentDocuments)}>Recent documents</ActionButton></View><Text className="text-muted">OS associations require a custom build.</Text><EventResults entries={linkEvents} empty="Waiting for an incoming URL or file." testID="link-events" /></Card>
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
const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, gap: 16 }, header: { padding: 24, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { padding: 24, gap: 16 }, title: { fontSize: 28, fontWeight: "700" }, heading: { fontSize: 18, fontWeight: "600" },
  card: { padding: 20, borderRadius: 12, gap: 12 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  editor: { height: 150, borderWidth: 1, padding: 12, borderRadius: 6, fontSize: 15 }, input: { borderWidth: 1, padding: 8, borderRadius: 6 }, log: { fontFamily: "Menlo", fontSize: 12 },
});
