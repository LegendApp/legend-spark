import { Text, View } from "react-native";
import { ActionButton } from "../../ActionButton";
import { actions, sessionTabsAvailability, useSessions, type NoteRow } from "./window-sessions";

/** Stable test IDs: a note's restorable view and its frame. */
const viewID = ({ label, view }: NoteRow) => view ? `multiwindow-windows-session-${label}-${view.route}-scroll-${view.scrollY}-item-${view.selected ?? "none"}-split-${view.split}` : `multiwindow-windows-session-${label}-unset`;
const frameID = ({ label, frame }: NoteRow) => `multiwindow-windows-frame-${label}-${frame.x}-${frame.y}-${frame.width}-${frame.height}`;

/** Multiwindow > Sessions and messages: window sessions, New Window and typed messages. */
export function Sessions() {
  const { rows, tabs, saved, reply, delivered, heard, steps, error } = useSessions();
  const tabsAvailability = sessionTabsAvailability();
  return <>
    <Text className="font-semibold text-foreground" accessibilityRole="header">Sessions and messages</Text>
    <Text className="text-sm text-muted" testID={`multiwindow-windows-session-tabs-${tabsAvailability}`}>Tab groups in sessions: {tabsAvailability}</Text>
    <View className="flex-row flex-wrap justify-center gap-2">
      <ActionButton testID="multiwindow-windows-save-session" onPress={actions.save}>Save session</ActionButton>
      <ActionButton testID="multiwindow-windows-close-notes" onPress={actions.close}>Close note windows</ActionButton>
      <ActionButton testID="multiwindow-windows-restore-session" onPress={actions.restore}>Restore saved session</ActionButton>
      <ActionButton testID="multiwindow-windows-duplicate" onPress={actions.duplicate}>New Window from note 1</ActionButton>
      <ActionButton testID="multiwindow-windows-detach" onPress={actions.detach}>New detached window from note 1</ActionButton>
      <ActionButton testID="multiwindow-windows-request" onPress={actions.request}>Ask note 1 for its summary</ActionButton>
      <ActionButton testID="multiwindow-windows-broadcast" onPress={actions.broadcast}>Broadcast "hello" to every window</ActionButton>
    </View>
    <View className="w-96 max-w-full gap-1 rounded-md border border-border p-3" testID="multiwindow-windows-session">
      <Text className="text-sm font-semibold text-foreground" testID={`multiwindow-windows-session-count-${rows.length}`}>Note windows in the session: {rows.length}</Text>
      {rows.map(row => <View key={row.label}>
        <Text className="text-sm text-foreground" testID={viewID(row)}>Note {row.label} · {row.view ? `${row.view.route} · scroll ${row.view.scrollY} · item ${row.view.selected ?? "none"} · sidebar ${row.view.split}` : "no view yet"}</Text>
        <Text className="text-sm text-muted" testID={frameID(row)}>{row.frame.x}, {row.frame.y} · {row.frame.width} × {row.frame.height}</Text>
      </View>)}
      <Text className="text-sm text-muted" testID={`multiwindow-windows-tabs-${tabs.join("_") || "none"}`}>Tab groups: {tabs.join(", ") || "none"}</Text>
      <Text className="text-sm text-muted" testID={`multiwindow-windows-saved-${saved ?? "none"}`}>Saved windows: {saved ?? "none"}</Text>
      <Text className="text-sm text-muted" testID={`multiwindow-windows-reply-${reply ?? "none"}`}>Last summary: {reply ?? "none"}</Text>
      <Text className="text-sm text-muted" testID={`multiwindow-windows-delivered-${delivered ?? "none"}`}>Last broadcast reached: {delivered ?? "none"}</Text>
      <Text className="text-sm text-muted" testID={`multiwindow-windows-heard-${heard ?? "none"}`}>Main window heard: {heard ?? "none"}</Text>
      <Text className="text-sm text-muted" testID={`multiwindow-windows-steps-${steps}`}>Linked steps run: {steps}</Text>
      {!!error && <Text className="text-sm text-danger" testID={`multiwindow-windows-session-error-${/^E_[A-Z_]+/.exec(error)?.[0] ?? "other"}`}>{error}</Text>}
    </View>
  </>;
}
