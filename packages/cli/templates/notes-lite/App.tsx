import { Activation } from "./Activation";
import { memo, useEffect, useMemo, useRef, useState, useContext, type ComponentRef } from "react";
import { FlatList, Pressable, SafeAreaView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { io } from "./shared/io";
import { Lifecycle } from "./shared/Lifecycle";
import { useModel } from "./shared/useModel";
import { notes, dirty } from "./store";
import { title, type Note } from "./model";
import { desktop, openNote, openSettings, showNotebook, restoreSession, watchSession, flushSession } from "./Desktop";
import { requestSearch, onSearch } from "./search";
import { Text, ThemeContext, usePalette } from "./Theme";
const Row = memo(function Row({ note, selected }: { note: Note; selected: boolean }) {
  const palette = useContext(ThemeContext);
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => notes.select(note.id)} style={[styles.row, { borderColor: palette.border }, selected && { backgroundColor: palette.selected }]}>
    <Text numberOfLines={1} style={styles.noteTitle}>{title(note)}</Text>
    <Text numberOfLines={1}>{note.text.split("\n").slice(1).join(" ") || "Empty note"}</Text>
  </Pressable>;
});
export default function App({ windowId = "main", windowProps }: { windowId?: string; windowProps?: { noteId?: string; settings?: boolean } }) {
  const state = useModel(notes);
  const palette = usePalette(state.theme ?? "system");
  const { width } = useWindowDimensions();
  const search = useRef<ComponentRef<typeof TextInput>>(null);
  const [query, setQuery] = useState("");
  const [trash, setTrash] = useState(false);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchRequested, setSearchRequested] = useState(0);
  const selected = state.notes.find(note => note.id === (windowProps?.noteId ?? state.selectedId) && !note.deleted);
  const isSettings = windowProps?.settings || settings;
  const visible = useMemo(() => state.notes.filter(note => note.deleted === trash && note.text.toLowerCase().includes(query.toLowerCase())), [state.notes, query, trash]);
  // Native menu/shortcut registrations retain these callbacks; read current model at invocation.
  const commands = useMemo(() => {
    const run = (action: () => void | Promise<unknown>) => () => { setError(null); void Promise.resolve().then(action).catch(error => setError(String(error))); };
    const current = () => windowProps?.settings ? undefined : notes.getSnapshot().notes.find(note => note.id === (windowProps?.noteId ?? notes.getSnapshot().selectedId) && !note.deleted);
    return [
      { id: "new", title: "New note", key: "N", run: run(async () => { setSettings(false); setTrash(false); setQuery(""); const id = notes.create(); if (id && (windowProps?.noteId || windowProps?.settings)) await openNote(id); }) },
      { id: "save", title: "Save notes", key: "S", run: run(async () => { await notes.flush(); }) },
      { id: "open", title: "Import text…", key: "O", run: run(async () => { const file = await io.open(); if (file) { const id = notes.create(file.text); if (id && (windowProps?.noteId || windowProps?.settings)) await openNote(id); } }) },
      { id: "search", title: "Search notes", key: "F", run: run(async () => { if (desktop) await showNotebook(); requestSearch(); }) },
      { id: "delete", title: "Delete note", key: "Shift+Backspace", run: run(() => { const note = current(); if (note) notes.setDeleted(note.id, true); }) },
      ...(desktop ? [{ id: "window", title: "Open in new window", key: "Shift+N", run: run(async () => { const note = current(); if (note) await openNote(note.id); }) }] : []),
      { id: "settings", title: "Settings…", key: ",", run: run(async () => { if (desktop) await openSettings(); else setSettings(value => !value); }) },
    ];
  }, [windowProps?.noteId, windowProps?.settings]);
  useEffect(() => { void notes.load(); }, []);
  useEffect(() => {
    if (windowId !== "main") return;
    return onSearch(() => { setSettings(false); setTrash(false); notes.select(null); setSearchRequested(value => value + 1); });
  }, [windowId]);
  useEffect(() => {
    if (!desktop || windowId !== "main") return;
    void restoreSession().catch(error => setError(String(error)));
    const subscription = watchSession(setError);
    return () => subscription.remove();
  }, [windowId]);
  useEffect(() => { if (searchRequested) search.current?.focus(); }, [searchRequested]);
  const sidebar = !windowProps?.noteId && (width >= 720 || !selected);
  const fieldStyle = { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border };
  return <ThemeContext.Provider value={palette}><SafeAreaView style={[styles.root, { backgroundColor: palette.background }]}>
    <Activation windowId={windowId} onError={setError} />
    <Lifecycle title={isSettings ? "Notes Settings" : selected ? `${title(selected)} — Notes` : "Notes"} windowId={windowId} flush={notes.flush} quit={desktop ? flushSession : notes.flush} dirty={dirty} commands={commands} onError={setError} />
    <View style={styles.header}><Text style={styles.heading}>{isSettings ? "Settings" : "Notes"}</Text><Text accessibilityLiveRegion="polite">{state.saving ? "Saving…" : state.dirty ? "Changes pending" : state.ready ? "Saved on this device" : "Opening notes…"}</Text>{!isSettings ? <Button onPress={commands.find(command => command.id === "settings")!.run}>Settings</Button> : null}</View>
    {state.recovered ? <Text style={styles.notice}>Recovered the previous saved snapshot after an incomplete or unreadable write.</Text> : null}
    {error ? <View style={styles.notice}><Text accessibilityRole="alert">{error}</Text><Button onPress={() => setError(null)}>Dismiss</Button></View> : null}
    {state.error ? <View style={styles.notice}><Text accessibilityRole="alert">{state.error}</Text>{state.ready ? <Button onPress={() => { void notes.flush(); }}>Retry save</Button> : <Text>Storage could not be opened. Restart after resolving the storage problem.</Text>}</View> : null}
    {isSettings ? <View style={styles.editorPane}><Text style={styles.noteTitle}>Appearance</Text><Text>Choose a theme for every Notes window.</Text><View style={styles.toolbar}>{(["system", "light", "dark"] as const).map(theme => <Button key={theme} disabled={!state.ready || (state.theme ?? "system") === theme} onPress={() => notes.setTheme(theme)}>{`${theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}${(state.theme ?? "system") === theme ? " ✓" : ""}`}</Button>)}</View>{!desktop ? <Button onPress={() => setSettings(false)}>Back to notes</Button> : null}</View> : <View style={styles.body}>
      {sidebar ? <View style={[styles.sidebar, { borderColor: palette.border }, width < 720 && { width: "100%" }]}>
        <TextInput ref={search} accessibilityLabel="Search notes" placeholder="Search notes" placeholderTextColor={palette.text} value={query} onChangeText={setQuery} style={[styles.search, fieldStyle]} />
        <View style={styles.toolbar}><Button disabled={!state.ready} onPress={commands[0]!.run}>New note</Button><Button disabled={!state.ready} onPress={commands[2]!.run}>Import text</Button><Button onPress={commands.find(command => command.id === "search")!.run}>Search</Button><Button onPress={() => setTrash(value => !value)}>{trash ? "Show notes" : "Recently deleted"}</Button></View>
        <FlatList data={visible} keyExtractor={note => note.id} extraData={state.selectedId} renderItem={({ item }) => trash ? <View style={styles.row}><Text>{title(item)}</Text><Button onPress={() => notes.setDeleted(item.id, false)}>Restore</Button></View> : <Row note={item} selected={item.id === state.selectedId} />} ListEmptyComponent={<Text style={styles.notice}>{query ? "No matching notes" : trash ? "No deleted notes" : "Create your first note"}</Text>} />
      </View> : null}
      {(!sidebar || width >= 720) ? selected ? <View style={styles.editorPane}>
        <View style={styles.toolbar}>
          {width < 720 && !windowProps?.noteId ? <Button onPress={() => notes.select(null)}>Back to notes</Button> : null}
          <Button onPress={() => { void io.save({ name: `${title(selected).replace(/[^a-zA-Z0-9 _-]/g, "_")}.md` }, selected.text, "", true).catch(error => setError(String(error))); }}>Export text</Button>
          <Button onPress={commands.find(command => command.id === "delete")!.run}>Delete note</Button>
          {desktop ? <Button onPress={commands.find(command => command.id === "window")!.run}>Open in new window</Button> : null}
        </View>
        <TextInput key={selected.id} accessibilityLabel="Note text" testID="note-text" multiline value={selected.text} onChangeText={text => notes.edit(selected.id, text)} textAlignVertical="top" style={[styles.editor, fieldStyle]} autoFocus />
      </View> : <View style={styles.editorPane}><Text>{windowProps?.noteId ? "This note was deleted. Restore it from Recently deleted in the main window." : "Select a note to begin."}</Text></View> : null}
    </View>}
  </SafeAreaView></ThemeContext.Provider>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, header: { padding: 20, gap: 6 }, heading: { fontSize: 28, fontWeight: "600" },
  body: { flex: 1, flexDirection: "row" }, sidebar: { width: 320, borderRightWidth: 1 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12 }, search: { padding: 12, margin: 12, borderWidth: 1, borderRadius: 6 },
  row: { padding: 16, gap: 6, borderBottomWidth: 1 }, noteTitle: { fontSize: 16, fontWeight: "600" },
  editorPane: { flex: 1, padding: 12 }, editor: { flex: 1, minHeight: 180, padding: 16, fontSize: 17, borderWidth: 1, borderRadius: 6 }, notice: { padding: 12 },
});
