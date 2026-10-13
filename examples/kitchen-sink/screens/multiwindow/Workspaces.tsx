import { ScrollView, Text, TextInput, View } from "react-native";
import { ActionButton } from "../../ActionButton";
import { availability, refreshNow, runStep, setName, useWindowWorkspaces, type WorkspacesState } from "./window-workspaces";
import { useWorkspacesMessages } from "./workspaces-messages";

const BUTTONS = ["editor", "inspector", "save", "restore", "delete", "close", "clear", "corrupt"] as const;
const named = (step: string, name: string) => step === "save" || step === "restore" || step === "delete" ? `${step}-${name}` : step;
const restoreID = (restore: WorkspacesState["restore"]) => restore === null ? "none" : "stopped" in restore ? `stopped-${restore.stopped}`
  : restore.placements.map(({ label, displayId, layout }) => `${label}-${displayId}-${layout}`).join("_") || "empty";

/** Multiwindow > Workspaces: named window layouts saved in the app's data directory and adapted to the connected displays. */
export function Workspaces() {
  const t = useWorkspacesMessages();
  const { name, displays, saved, windows, restore, runs, steps, error } = useWindowWorkspaces();
  const value = availability();
  const rows: [string, string, string][] = [
    ...displays.map((display): [string, string, string] => [t.displays, t.display(display), `multiwindow-workspaces-display-${display.id}-${display.persistentId ?? "none"}-${display.primary ? "primary-" : ""}${display.width}x${display.height}`]),
    ...windows.map((window): [string, string, string] => [t.windows, t.window(window), `multiwindow-workspaces-window-${window.label}-${window.displayId}-${window.x}-${window.y}-${window.width}x${window.height}`]),
    [t.lastRestore, t.restore(restore), `multiwindow-workspaces-restore-${restoreID(restore)}`],
  ];
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="text-sm text-foreground" testID={`multiwindow-workspaces-availability-${value}`}>{t.availabilityLabel}: {t.availability(value)}</Text>
    <View className="w-full max-w-3xl gap-2">
      <Text className="text-sm font-semibold text-foreground">{t.name}</Text>
      <TextInput testID="multiwindow-workspaces-name" accessibilityLabel={t.name} className="w-64 rounded-md border border-border bg-surface p-2 text-foreground" value={name} onChangeText={setName} />
    </View>
    <View className="w-full max-w-3xl gap-1 rounded-md border border-border p-3" testID={`multiwindow-workspaces-saved-count-${saved?.length ?? "unreadable"}`}>
      <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{t.saved}</Text>
      {saved === null ? <Text className="text-sm text-muted">{t.unreadable}</Text> : !saved.length ? <Text className="text-sm text-muted">{t.none}</Text> : null}
      {saved?.map(row => <View key={row.name} className="flex-row items-center gap-3">
        <Text className="flex-1 text-sm text-foreground" testID={`multiwindow-workspaces-saved-${row.name}-${row.windows}-windows-${row.displays}-displays`}>{t.savedRow(row)}</Text>
        <ActionButton testID={`multiwindow-workspaces-restore-${row.name}-button`} onPress={() => runStep(`restore-${row.name}`)}>{t.restoreButton}</ActionButton>
      </View>)}
    </View>
    <View className="w-full max-w-3xl gap-1 rounded-md border border-border p-3" testID="multiwindow-workspaces-readout">
      {rows.map(([label, text, testID]) => <View key={testID} className="flex-row gap-3">
        <Text className="w-44 text-sm font-semibold text-foreground">{label}</Text>
        <Text className="flex-1 text-sm text-foreground" testID={testID}>{text}</Text>
      </View>)}
      <Text className="text-sm text-muted" testID={`multiwindow-workspaces-run-${runs}-steps-${steps}`}>{t.run(runs, steps)}</Text>
      {!!error && <Text className="text-sm text-danger" testID={`multiwindow-workspaces-error-${/^E_[A-Z_]+/.exec(error)?.[0] ?? "other"}`}>{error}</Text>}
    </View>
    <Text className="max-w-3xl text-sm text-muted" testID="multiwindow-workspaces-note">{t.note}</Text>
    <View className="w-full max-w-3xl flex-row flex-wrap gap-2">
      {BUTTONS.map(step => <ActionButton key={step} testID={`multiwindow-workspaces-${step}-button`} onPress={() => runStep(named(step, name.trim()))}>{t.buttons[step]}</ActionButton>)}
      <ActionButton testID="multiwindow-workspaces-refresh" onPress={refreshNow}>{t.buttons.refresh}</ActionButton>
    </View>
  </ScrollView>;
}
