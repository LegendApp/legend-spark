import { Text, View } from "react-native";
import { ActionButton } from "../../ActionButton";
import { Button } from "../../Controls";
import { Panel, Status } from "../../Panel";
import { TOGGLES, availabilityLines, probeRejections, stateLines, useToolbarDemo } from "./toolbar-demo";

export function Toolbar() {
  const { status, rows, errors, state, lastEvent, open, close, next, customize, refresh } = useToolbarDemo();
  return <Panel title="Toolbar">
    <Status testID="windows-toolbar-status">{status}</Status>
    <View className="flex-row flex-wrap justify-center gap-2">
      <Button testID="windows-toolbar-open" onPress={open}>Open child window</Button>
      <Button testID="windows-toolbar-close" onPress={close}>Close child window</Button>
    </View>
    <View className="gap-1" testID="windows-toolbar-availability">
      {availabilityLines().map(({ feature, text }) => <Text key={feature} className="text-sm text-foreground" testID={`windows-toolbar-availability-${feature}`}>{text}</Text>)}
    </View>
    <View className="w-full max-w-3xl gap-1">
      {TOGGLES.map(toggle => <View key={toggle.id} className="flex-row items-center gap-3 border-b border-border py-1">
        <Text className="w-44 text-sm font-semibold text-foreground">{toggle.label}</Text>
        <Text className="flex-1 text-sm text-foreground" testID={`windows-toolbar-${toggle.id}-value`}>{toggle.values[rows[toggle.id]!]}</Text>
        {!!errors[toggle.id] && <Text className="flex-1 text-sm text-danger" testID={`windows-toolbar-${toggle.id}-error`}>{errors[toggle.id]}</Text>}
        <Button testID={`windows-toolbar-${toggle.id}`} accessibilityLabel={`Next ${toggle.label}`} onPress={() => next(toggle, rows[toggle.id]!)}>Next</Button>
      </View>)}
    </View>
    <View className="w-full max-w-3xl gap-1" testID="windows-toolbar-state">
      <Text className="text-sm font-semibold text-foreground">getToolbarState</Text>
      {stateLines(state).map(({ id, text }) => <Text key={id} className="text-sm text-foreground" testID={`windows-toolbar-state-${id}`}>{text}</Text>)}
      <Text className="text-sm text-foreground" testID="windows-toolbar-event">last event: {lastEvent}</Text>
    </View>
    <View className="flex-row flex-wrap justify-center gap-2">
      <Button testID="windows-toolbar-refresh" onPress={() => void refresh()}>Refresh state</Button>
      <ActionButton testID="windows-toolbar-customize" onPress={customize}>Customize toolbar…</ActionButton>
    </View>
    <ActionButton testID="windows-toolbar-probe" onPress={probeRejections}>Probe rejected requests</ActionButton>
  </Panel>;
}
