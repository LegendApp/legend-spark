import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { getTrackingStatus, requestTrackingPermission, type TrackingStatus } from "react-native-tracking-transparency";
import { Button } from "../../Controls";

// Test IDs: security-tracking-transparency-status-<status> shows getTrackingStatus(); "unavailable" means
// the native module did not run.
const ID = "security-tracking-transparency";

/** react-native-tracking-transparency through its own API; Spark adds the AppKit build. */
export function TrackingTransparencyDemo() {
  const [status, setStatus] = useState<TrackingStatus | string>();
  useEffect(() => { getTrackingStatus().then(setStatus, error => setStatus(`error ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">ATTrackingManager status. Requesting shows the system prompt only with NSUserTrackingUsageDescription in Info.plist.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={status ? `${ID}-status-${status}` : undefined}>{`status: ${status ?? "…"}`}</Text>
    <Button onPress={() => void requestTrackingPermission().then(setStatus)}>Request tracking permission</Button>
  </ScrollView>;
}
