import { Text } from "react-native";

export function GeolocationDemo() {
  return <Text selectable testID="system-integration-geolocation-unsupported" style={{ padding: 24 }}>@react-native-community/geolocation has no Windows implementation: its native module ships only for Apple and Android platforms. Location is unavailable through it on Windows.</Text>;
}
