import { Text } from "react-native";

export function ConfigDemo() {
  return <Text selectable testID="system-integration-config-unsupported" style={{ padding: 24 }}>react-native-config is not supported on Windows yet: its Windows project uses the pre-0.63 UWP template, which React Native Windows 0.83 can't restore. .env values are unavailable through it on Windows.</Text>;
}
