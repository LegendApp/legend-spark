import { Text, TextInput, View } from "react-native";
import { useValue } from "@legendapp/state/react";
import { getIsolatedRuntimeAvailability } from "@legendapp/spark/windows";
import { ActionButton } from "../../ActionButton";
import { Panel } from "../../Panel";
import { document$, errors$ } from "./state";
import { openNote, useOpenWindows, windows } from "./windows";

export function Multiwindow() {
  const { open, key } = useOpenWindows();
  const text = useValue(document$.text);
  const errors = useValue(errors$);
  const isolated = getIsolatedRuntimeAvailability();
  return <Panel title="Multiwindow">
    <Text className="text-sm text-muted" testID="multiwindow-windows-isolated-availability">Isolated runtimes: {isolated.available ? "available" : isolated.reason}</Text>
    <ActionButton testID="multiwindow-windows-open-note" onPress={async () => (await openNote()).id}>Open note window</ActionButton>
    <ActionButton testID="multiwindow-windows-open-settings" onPress={async () => (await windows.openInstance("settings")).id}>Open Settings (single window)</ActionButton>
    <ActionButton testID="multiwindow-windows-open-crash" onPress={async () => (await windows.openInstance("crash")).id}>Open error-isolation window</ActionButton>
    <ActionButton testID="multiwindow-windows-open-isolated" onPress={async () => (await windows.openInstance("plugin", { props: { label: "main runtime" } })).id}>Open isolated-runtime window</ActionButton>
    <Text className="font-semibold text-foreground">Shared document (the same observable as every note window)</Text>
    <TextInput testID="multiwindow-windows-document" accessibilityLabel="Shared document in main window" className="w-96 max-w-full rounded-md border border-border bg-surface p-2 text-foreground" value={text} onChangeText={value => document$.text.set(value)} />
    <View className="w-96 max-w-full gap-1 rounded-md border border-border p-3" testID="multiwindow-windows-open">
      <Text className="text-sm font-semibold text-foreground" testID="multiwindow-windows-count">Open windows: {open.length} · key: {key ?? "none"}</Text>
      {open.map(window => <Text key={window.id} className="text-sm text-muted">{window.id} · {window.name} · {window.runtime}</Text>)}
      {errors.map((line, index) => <Text key={`${index}-${line}`} className="text-sm text-danger" testID="multiwindow-windows-error">{line}</Text>)}
    </View>
  </Panel>;
}
