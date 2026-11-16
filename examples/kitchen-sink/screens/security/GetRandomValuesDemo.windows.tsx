import { Text } from "react-native";

export function GetRandomValuesDemo() {
  return <Text selectable testID="security-get-random-values-unsupported" style={{ padding: 24 }}>react-native-get-random-values has no Windows implementation: its native module ships only for Apple and Android platforms, so crypto.getRandomValues is not installed on Windows.</Text>;
}
