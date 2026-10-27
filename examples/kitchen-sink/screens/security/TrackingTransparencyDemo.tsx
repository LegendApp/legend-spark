import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { getTrackingStatus, requestTrackingPermission, type TrackingStatus } from "react-native-tracking-transparency";
import { Button } from "../../Controls";

// Test ID: security-tracking-transparency-status-<status> shows getTrackingStatus(). On macOS the library
// reports unavailable without native code; App Tracking Transparency does nothing on the Mac.
const ID = "security-tracking-transparency";

/** react-native-tracking-transparency through its own API; it imports and answers on macOS unpatched. */
export function TrackingTransparencyDemo() {
  const [status, setStatus] = useState<TrackingStatus | string>();
  useEffect(() => { getTrackingStatus().then(setStatus, error => setStatus(`error ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Tracking status. On the Mac, App Tracking Transparency never prompts, so the library reports unavailable.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={status ? `${ID}-status-${status}` : undefined}>{`status: ${status ?? "…"}`}</Text>
    <Button onPress={() => void requestTrackingPermission().then(setStatus, error => setStatus(`error ${String(error)}`))}>Request tracking permission</Button>
  </ScrollView>;
}
