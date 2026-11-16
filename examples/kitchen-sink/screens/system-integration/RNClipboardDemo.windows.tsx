import { Text } from "react-native";

export function RNClipboardDemo() {
  return <Text selectable testID="system-integration-rn-clipboard-unsupported" style={{ padding: 24 }}>@react-native-clipboard/clipboard is not supported on Windows yet: its Windows project uses packages.config, which can't resolve the Windows App SDK 1.8 dependencies React Native Windows 0.83 needs. Use Spark's clipboard or expo-clipboard on Windows.</Text>;
}
