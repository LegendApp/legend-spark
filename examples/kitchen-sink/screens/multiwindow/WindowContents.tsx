import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useValue } from "@legendapp/state/react";
import { useUndoState, useWindowInstance, useWindowState } from "@legendapp/spark/windows";
import { Button } from "../../Controls";
import { PINNED, addStar, document$, settings$, stars } from "./state";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** A note window: the shared document (app scope) and its own stars (window scope, promotable). */
export function NoteWindow({ title }: { title: string }) {
  const window = useWindowInstance();
  const count = useValue(useWindowState(stars).count);
  const text = useValue(document$.text);
  const uppercase = useValue(settings$.uppercase);
  const undo = useUndoState();
  const binding = stars.getBinding(window);
  const [error, setError] = useState("");
  const attempt = (action: () => void) => { try { action(); setError(""); } catch (cause) { setError(errorText(cause)); } };
  return <View className="flex-1 gap-3 bg-background p-5">
    <Text className="text-xl font-bold text-foreground" testID="multiwindow-note-title">{title}</Text>
    <Text className="text-muted" testID="multiwindow-note-identity">{window.id}</Text>
    <Text className="font-semibold text-foreground">Shared document</Text>
    <TextInput testID="multiwindow-note-document" accessibilityLabel="Shared document" className="rounded-md border border-border bg-surface p-2 text-foreground" value={uppercase ? text.toUpperCase() : text} onChangeText={value => document$.text.set(value)} />
    <Text className="font-semibold text-foreground" testID="multiwindow-note-stars">Stars: {count} · {binding ? `app scope (${binding})` : "this window"}</Text>
    <View className="flex-row flex-wrap gap-2">
      <Button testID="multiwindow-note-star" onPress={() => addStar(window)}>Add star</Button>
      <Button testID="multiwindow-note-undo" disabled={!undo.canUndo} onPress={() => window.undo.undo()}>{undo.undoLabel ? `Undo ${undo.undoLabel}` : "Undo"}</Button>
      <Button testID="multiwindow-note-promote" disabled={!!binding} onPress={() => attempt(() => stars.promote(window, PINNED))}>Promote stars to app scope</Button>
      <Button testID="multiwindow-note-attach" disabled={binding === PINNED} onPress={() => attempt(() => stars.attach(window, PINNED))}>Use promoted stars</Button>
    </View>
    {!!error && <Text className="text-danger" testID="multiwindow-note-error">{error}</Text>}
  </View>;
}

export function SettingsWindow() {
  const uppercase = useValue(settings$.uppercase);
  return <View className="flex-1 gap-3 bg-background p-5">
    <Text className="text-xl font-bold text-foreground">Settings</Text>
    <Text className="text-muted">Only one Settings window exists; opening it again focuses this one.</Text>
    <Button testID="multiwindow-settings-uppercase" onPress={() => settings$.uppercase.set(value => !value)}>{uppercase ? "Show original case" : "Show the document in uppercase"}</Button>
  </View>;
}

export function CrashWindow() {
  const [crash, setCrash] = useState(false);
  if (crash) throw new Error("Render failure in this window only");
  return <View className="flex-1 gap-3 bg-background p-5">
    <Text className="text-xl font-bold text-foreground">Error isolation</Text>
    <Text className="text-muted">Throwing here replaces only this window's content.</Text>
    <Button testID="multiwindow-crash-throw" onPress={() => setCrash(true)}>Throw a render error</Button>
  </View>;
}
