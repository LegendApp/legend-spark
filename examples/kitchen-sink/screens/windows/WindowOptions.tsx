import { Text, View } from "react-native";
import { ActionButton } from "../../ActionButton";
import { Button } from "../../Controls";
import { Panel, Status } from "../../Panel";
import { TOGGLES, availabilityLines, probeRejections, useWindowOptions } from "./window-options";

export function WindowOptions() {
  const { status, rows, open, close, next } = useWindowOptions();
  return <Panel title="Window options">
    <Status testID="windows-window-options-status">{status}</Status>
    <View className="flex-row flex-wrap justify-center gap-2">
      <Button testID="windows-window-options-open" onPress={open}>Open child window</Button>
      <Button testID="windows-window-options-close" onPress={close}>Close child window</Button>
    </View>
    <View className="gap-1" testID="windows-window-options-availability">
      {availabilityLines().map(({ option, text }) => <Text key={option} className="text-sm text-foreground" testID={`windows-window-options-availability-${option}`}>{text}</Text>)}
    </View>
    <View className="w-full max-w-3xl gap-1">
      {TOGGLES.map(toggle => {
        const row = rows[toggle.id]!;
        return <View key={toggle.id} className="flex-row items-center gap-3 border-b border-border py-1">
          <Text className="w-44 text-sm font-semibold text-foreground">{toggle.label}</Text>
          <Text className="flex-1 text-sm text-foreground" testID={`windows-window-options-${toggle.id}-value`}>{toggle.values[row.index]!.label}</Text>
          {!!row.error && <Text className="flex-1 text-sm text-danger" testID={`windows-window-options-${toggle.id}-error`}>{row.error}</Text>}
          <Button testID={`windows-window-options-${toggle.id}`} accessibilityLabel={`Next ${toggle.label}`} onPress={() => next(toggle, row.index)}>Next</Button>
        </View>;
      })}
    </View>
    <ActionButton testID="windows-window-options-probe" onPress={probeRejections}>Probe rejected requests</ActionButton>
  </Panel>;
}
