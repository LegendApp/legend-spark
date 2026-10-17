import { Text, View } from "react-native";
import { ActionButton } from "../../ActionButton";
import { Panel, Status } from "../../Panel";
import { actions, tabbingAvailability, useWindowTabs, type TabGroupRow } from "./window-tabs";

/** Stable test IDs for the readout: a group's windows in tab order, its selected window and its tab bar. */
const groupID = ({ labels, selected, tabBarVisible }: TabGroupRow) => `windows-window-tabs-group-${labels.join("-")}-selected-${selected ?? "none"}-bar-${tabBarVisible ? "shown" : "hidden"}`;

export function WindowTabs() {
  const { groups, groupEvent, selectionEvent, steps, error } = useWindowTabs();
  return <Panel title="Window tabs">
    <Status testID={`windows-window-tabs-availability-${tabbingAvailability()}`}>Native window tabs: {tabbingAvailability()}</Status>
    <View className="w-full max-w-xl gap-1 rounded-md border border-border p-3" testID="windows-window-tabs-groups">
      <Text className="text-sm font-semibold text-foreground" testID={`windows-window-tabs-group-count-${groups.length}`}>Tab groups: {groups.length}</Text>
      {groups.map(group => <Text key={group.labels.join("-")} className="text-sm text-foreground" testID={groupID(group)}>
        {group.labels.map(name => name === group.selected ? `[${name}]` : name).join("  ")} · tab bar {group.tabBarVisible ? "shown" : "hidden"}
      </Text>)}
      <Text className="text-sm text-muted" testID={`windows-window-tabs-group-event-${groupEvent ?? "none"}`}>Window 1's last tab group change: {groupEvent ?? "none"}</Text>
      <Text className="text-sm text-muted" testID={`windows-window-tabs-selection-event-${selectionEvent ?? "none"}`}>Window 1's last selection change: {selectionEvent ?? "none"}</Text>
      <Text className="text-sm text-muted" testID={`windows-window-tabs-steps-${steps}`}>Linked steps run: {steps}</Text>
      {!!error && <Text className="text-sm text-danger" testID={`windows-window-tabs-error-${/^E_[A-Z_]+/.exec(error)?.[0] ?? "other"}`}>{error}</Text>}
    </View>
    <View className="flex-row flex-wrap justify-center gap-2">
      <ActionButton testID="windows-window-tabs-open" onPress={actions.open}>Open window</ActionButton>
      <ActionButton testID="windows-window-tabs-new-tab" onPress={actions.newTab}>New tab in window 1</ActionButton>
      <ActionButton testID="windows-window-tabs-select" onPress={actions.selectNext}>Select the next tab of window 1</ActionButton>
      <ActionButton testID="windows-window-tabs-reorder" onPress={actions.moveToEnd}>Move window 1's tab to the end</ActionButton>
      <ActionButton testID="windows-window-tabs-merge" onPress={actions.merge}>Merge all windows into window 1</ActionButton>
      <ActionButton testID="windows-window-tabs-move" onPress={actions.moveSelected}>Move the selected tab to a new window</ActionButton>
      <ActionButton testID="windows-window-tabs-tab-bar" onPress={actions.toggleTabBar}>Show or hide window 1's tab bar</ActionButton>
      <ActionButton testID="windows-window-tabs-open-disallowed" onPress={actions.openDisallowed}>Open a window that never tabs</ActionButton>
      <ActionButton testID="windows-window-tabs-close" onPress={actions.closeAll}>Close all tab windows</ActionButton>
    </View>
  </Panel>;
}
