import { ScrollView, Text } from "react-native";
import { useNetInfoInstance } from "@react-native-community/netinfo";

// Test ID: networking-webview-netinfo-connected once the native module reports a connected wifi or
// ethernet state, the ways a Mac connects.
const ID = "networking-webview-netinfo";

/** @react-native-community/netinfo through its own API; it supports macOS upstream. */
export function NetInfoDemo() {
  // An isolated instance stops its internet-reachability polling when the screen unmounts.
  const { netInfo: state } = useNetInfoInstance();
  const connected = !!state.isConnected && (state.type === "wifi" || state.type === "ethernet");
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text selectable className="font-mono text-xs text-muted">{JSON.stringify(state, null, 2)}</Text>
    <Text className="font-mono text-xs text-foreground" testID={connected ? `${ID}-connected` : undefined}>{`${state.type}, connected ${state.isConnected}`}</Text>
  </ScrollView>;
}
