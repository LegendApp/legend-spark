import { Platform, Text, View } from "react-native";
import { ActionButton } from "../../ActionButton";
import { EventResults } from "../../EventResults";
import { Panel, Status, errorText } from "../../Panel";
import { menuAvailabilityLines, probeRejections, useMenuAudit } from "./menu-audit";

const guide = Platform.OS === "macos"
  ? "Open Menu Audit in the menu bar. Hold Option to reveal Close All Samples. Search in the Help menu finds Menu Audit Guide."
  : "Open Menu Audit in the menu bar. The Help contribution merges into the Help menu. Alternates, mixed state, icons and open/close events report host-restriction on Windows.";

export function MenuAudit() {
  const { state, events } = useMenuAudit();
  return <Panel title="Application menu audit">
    <Text className="max-w-xl text-center text-sm text-muted">{guide}</Text>
    <Status testID="menus-audit-status">{state.status === "ready" ? "Menu ready" : state.status === "error" ? `Menu error: ${errorText(state.error)}` : "Installing menu…"}</Status>
    <View className="gap-1" testID="menus-audit-availability">
      {menuAvailabilityLines().map(({ feature, text }) => <Text key={feature} className="text-sm text-foreground" testID={`menus-audit-availability-${feature}`}>{text}</Text>)}
    </View>
    <ActionButton testID="menus-audit-probe" onPress={probeRejections}>Probe rejected requests</ActionButton>
    <EventResults entries={events} empty="Open, close or choose a Menu Audit item." testID="menus-audit-events" />
  </Panel>;
}
